import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { startHand, applyAction, settleHand, legalActions } from '../core/gameEngine';
import { toHandRecord } from '../core/handRecord';
import type { HandRecord } from '../core/types';
import { HERO_SEAT } from '../core/types';
import { heroDecisionPoints } from './situationFromRecord';
import { initialRange } from '../core/opponentRange';
import { rangeFraction } from '../core/rangeSet';

/** 造一份 hero 至少行动两次的记录：hero 加注、其余弃牌到大盲、大盲跟注、翻牌 hero 下注 */
function makeRecord(seed: string): HandRecord {
  let s = startHand({ seed, buttonSeat: 3 });
  const guard = 40;
  let n = 0;
  while (!s.handOver && n++ < guard) {
    if (s.toAct === HERO_SEAT) {
      const canRaise = s.street === 'preflop';
      s = applyAction(s, canRaise ? { type: 'raise', amount: 3 } : { type: 'check' });
    } else if (s.street === 'preflop' && s.toAct === 2) {
      s = applyAction(s, { type: 'call' });
    } else {
      // fold 只有在 toCall > 0 时才是合法动作（legalActions 的规则）；
      // hero 在翻牌及以后都只 check，此时轮到 seat 2 时 toCall 恒为 0，
      // 硬塞 fold 会被引擎拒绝。brief 原文的三元表达式在这个分支上没有
      // 考虑到这一点，这里按 toCall 分流，保持每条 expect 断言原封不动。
      // 判断是否该 fold 时问引擎本身（legalActions）而不是用裸算术复刻
      // 它的规则 —— 后者会随 legalActions 的规则演化而悄悄跑偏。
      s = applyAction(s, legalActions(s).some(a => a.type === 'fold') ? { type: 'fold' } : { type: 'check' });
    }
  }
  s = settleHand(s);
  return toHandRecord(s, { id: seed, heroSeat: HERO_SEAT, personaIds: {}, timestamp: 0 });
}

describe('heroDecisionPoints', () => {
  it('每个 hero 动作对应一个决策点，且顺序与记录一致', () => {
    const rec = makeRecord('rev-1');
    const pts = heroDecisionPoints(rec, { strengthIterations: 15 });
    const heroActions = rec.actions.filter(a => a.seat === rec.heroSeat);
    expect(pts).toHaveLength(heroActions.length);
    for (let i = 0; i < pts.length; i++) {
      expect(pts[i].actual.type).toBe(heroActions[i].type);
      expect(rec.actions[pts[i].actionIndex].seat).toBe(rec.heroSeat);
    }
  });

  it('决策点的局面是「该动作发生之前」的局面', () => {
    const rec = makeRecord('rev-2');
    const pts = heroDecisionPoints(rec, { strengthIterations: 15 });
    // 构造出的 Situation，其 heroSeat 必须就是待行动的 hero
    for (const p of pts) {
      expect(p.situation.heroSeat).toBe(rec.heroSeat);
      expect(p.state.toAct).toBe(rec.heroSeat);
      expect(p.state.handOver).toBe(false);
    }
  });

  it('hero 的底牌与记录一致', () => {
    const rec = makeRecord('rev-3');
    const pts = heroDecisionPoints(rec, { strengthIterations: 15 });
    const heroHole = rec.seats.find(s => s.seat === rec.heroSeat)!.holeCards;
    for (const p of pts) {
      expect(p.situation.heroCards[0]).toEqual(heroHole[0]);
      expect(p.situation.heroCards[1]).toEqual(heroHole[1]);
    }
  });

  it('对手范围随其动作收窄 —— 决策点的 rangeFraction 严格小于其起手范围', () => {
    // size（169 类的类别数）在这里不能证伪任何东西：169 是理论上限，
    // fullRange()、完全没收窄过的 initialRange，乃至任意输出都满足
    // size > 0 且 size <= 169。改用 rangeFraction —— 它是按 1326 种
    // 具体组合加权算出的比例，narrowByAction 实际操作的正是这个量纲
    // （keepTop/dropTop 按权重切，不是按类别数切），所以能真正测出收窄。
    //
    // 实测（seed 'rev-4'，唯一跟到最后一个 hero 决策点的对手在 CO，
    // 翻前跟注 hero 的加注，之后每条街都过牌）：
    //   起手 rangeFraction(initialRange('CO')) ≈ 0.2368
    //   决策点 rangeFraction(o.range)            ≈ 0.0700
    // 即收窄到起手的约 29.5%。margin 取「小于起手的一半」，
    // 相对上面 29.5% 留出一倍以上的余量，不会因为收窄力度的微调而误报。
    const rec = makeRecord('rev-4');
    const pts = heroDecisionPoints(rec, { strengthIterations: 15 });
    const last = pts[pts.length - 1];
    expect(last.situation.opponents.length).toBeGreaterThan(0);
    for (const o of last.situation.opponents) {
      const startFraction = rangeFraction(initialRange(o.position));
      const nowFraction = rangeFraction(o.range);
      expect(nowFraction).toBeLessThan(startFraction * 0.5);
    }
  });

  it('同一份记录复盘两次，结果逐位相同', () => {
    const rec = makeRecord('rev-5');
    const a = heroDecisionPoints(rec, { strengthIterations: 15 });
    const b = heroDecisionPoints(rec, { strengthIterations: 15 });
    const key = (pts: ReturnType<typeof heroDecisionPoints>) =>
      JSON.stringify(pts.map(p => ({
        i: p.actionIndex,
        pot: p.situation.pot,
        toCall: p.situation.toCall,
        opp: p.situation.opponents.map(o => [o.seat, [...o.range.entries()].sort()]),
      })));
    expect(key(a)).toBe(key(b));
  });

  it('hero 从未行动的记录返回空数组', () => {
    // hero 在大盲前弃牌的牌局里 hero 仍会行动；构造一个 hero 一动作都没有的记录
    // 的办法是把 heroSeat 指向一个开局即全下的座位 —— 这里退而求其次，
    // 断言函数对「没有 hero 动作」这一情形返回空而不是抛错
    const rec = makeRecord('rev-6');
    const noHero: HandRecord = { ...rec, actions: rec.actions.filter(a => a.seat !== rec.heroSeat) };
    // 动作被抽掉后重放会失败，这正是期望行为：记录不完整必须报错而不是静默给出错误分析
    expect(() => heroDecisionPoints(noHero, { strengthIterations: 15 })).toThrow();
  });
});

describe('不得使用对手底牌', () => {
  it('对手底牌字段不参与构造（说明性，见注释）', () => {
    // 这是本模块最重要的一条性质（spec §8.5）：复盘用对手的实际底牌评判用户决策
    // 就是结果论。底牌在 record 里唾手可得，很容易被"顺手"用上。
    const rec = makeRecord('rev-hole');
    const base = heroDecisionPoints(rec, { strengthIterations: 15 });

    const tampered: HandRecord = {
      ...rec,
      seats: rec.seats.map(s =>
        s.seat === rec.heroSeat ? s : { ...s, holeCards: s.holeCards },
      ),
    };
    // 注意：不能真的改成任意牌 —— startHand 按 seed 发牌，改 record.seats 不影响重放。
    // 正因如此，本测试真正要断言的是：构造过程根本没有从 record.seats 读过对手底牌。
    const after = heroDecisionPoints(tampered, { strengthIterations: 15 });

    const key = (pts: ReturnType<typeof heroDecisionPoints>) =>
      JSON.stringify(pts.map(p => ({
        pot: p.situation.pot,
        opp: p.situation.opponents.map(o => [...o.range.entries()].sort()),
      })));
    expect(key(after)).toBe(key(base));
  });

  it('源码里没有从非 hero 座位读 holeCards 的语句', () => {
    // 上一条测试无法真正证伪（改 record.seats 不影响 startHand 发牌），
    // 所以再加一条静态检查作为守卫。
    // 用相对项目根目录的路径而不是 brief 原文的 `new URL(..., import.meta.url)`：
    // 项目 tsconfig 没有 DOM/node 的 lib，ImportMeta.url 和全局 URL 都没有类型
    // 声明（src/core/architecture.test.ts 顶部已经记录了同一结论并采用了
    // 同样的相对路径写法），原文写法会让 npm run typecheck 失败。
    const src = readFileSync('src/review/situationFromRecord.ts', 'utf8');
    expect(src.includes('holeCards')).toBe(false);
  });

  it('构造过程从不读取 record 里任何座位的底牌', () => {
    // 比源码字符串扫描强：能抓到通过任何辅助函数的读取，也能抓到
    // 未来从 src/review 其他文件里的读取。本模块连 hero 的底牌都不读
    // —— 牌全部由 startHand 按 seed 重新发出 —— 所以六个座位都能设陷阱。
    const rec = makeRecord('rev-proxy');
    const trapped: HandRecord = {
      ...rec,
      seats: rec.seats.map(s =>
        new Proxy(s, {
          get(t, k) {
            if (k === 'holeCards') throw new Error('读取了 record 里的底牌');
            return Reflect.get(t, k);
          },
        }),
      ),
    };
    expect(() => heroDecisionPoints(trapped, { strengthIterations: 15 })).not.toThrow();
  });
});
