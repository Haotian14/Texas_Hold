import { describe, it, expect } from 'vitest';
import { startHand, applyAction, legalActions } from '../core/gameEngine';
import { SEAT_COUNT } from '../core/types';
import { createRng } from '../core/rng';
import { fullRange } from '../core/rangeSet';
import type { RangeSet } from '../core/rangeSet';
import { PERSONAS, getPersona } from './personas';
import { decide, personaScore } from './decide';
import type { EvCandidate } from '../core/evEstimate';

function opts(personaId: string, seed = 'decide') {
  const ranges = new Map<number, RangeSet>();
  const personaIds = new Map<number, string>();
  for (let i = 0; i < SEAT_COUNT; i++) {
    ranges.set(i, fullRange());
    personaIds.set(i, personaId);
  }
  return { ranges, personaIds, rng: createRng(seed), iterations: 300, strengthIterations: 30 };
}

describe('decide 返回合法动作', () => {
  it('翻前首个决策点给出的动作在 legalActions 里', () => {
    const s = startHand({ seed: 'dec-1', buttonSeat: 0 });
    const d = decide(s, opts('tag'));
    const legal = legalActions(s);
    expect(legal.some(a => a.type === d.action.type)).toBe(true);
  });

  it('加注金额落在合法区间内', () => {
    const s = startHand({ seed: 'dec-2', buttonSeat: 0 });
    for (const p of PERSONAS) {
      const d = decide(s, opts(p.id, `amt-${p.id}`));
      const match = legalActions(s).find(a => a.type === d.action.type)!;
      if (d.action.amount !== undefined) {
        expect(d.action.amount).toBeGreaterThanOrEqual(match.min - 1e-9);
        expect(d.action.amount).toBeLessThanOrEqual(match.max + 1e-9);
      }
    }
  });

  it('返回的动作能被引擎接受', () => {
    const s = startHand({ seed: 'dec-3', buttonSeat: 0 });
    const d = decide(s, opts('lag'));
    expect(() => applyAction(s, d.action)).not.toThrow();
  });

  it('本手已结束时抛错', () => {
    let s = startHand({ seed: 'dec-4', buttonSeat: 0 });
    for (let i = 0; i < 5 && !s.handOver; i++) s = applyAction(s, { type: 'fold' });
    expect(() => decide(s, opts('tag'))).toThrow();
  });
});

describe('decide 反映性格差异', () => {
  it('跟注站比岩石更少弃牌', () => {
    let stationFolds = 0;
    let rockFolds = 0;
    for (let i = 0; i < 40; i++) {
      let s = startHand({ seed: `fold-${i}`, buttonSeat: i % SEAT_COUNT });
      // 先加注一手，制造一个需要跟注的局面
      s = applyAction(s, { type: 'raise', amount: 3 });
      if (s.handOver) continue;
      if (decide(s, opts('station', `st-${i}`)).action.type === 'fold') stationFolds++;
      if (decide(s, opts('rock', `rk-${i}`)).action.type === 'fold') rockFolds++;
    }
    expect(stationFolds).toBeLessThan(rockFolds);
  });

  it('疯子比岩石更常选进攻动作', () => {
    const aggressive = new Set(['bet', 'raise', 'allin']);
    let maniacAgg = 0;
    let rockAgg = 0;
    for (let i = 0; i < 40; i++) {
      const s = startHand({ seed: `agg-${i}`, buttonSeat: i % SEAT_COUNT });
      if (aggressive.has(decide(s, opts('maniac', `mn-${i}`)).action.type)) maniacAgg++;
      if (aggressive.has(decide(s, opts('rock', `rk2-${i}`)).action.type)) rockAgg++;
    }
    expect(maniacAgg).toBeGreaterThan(rockAgg);
  });

  it('GTO 原型不叠加任何偏好，评分等于 EV 本身', () => {
    // GTO 的 aggression / callThresholdMul 都是 1，bluffFreq 为 0，
    // cbetFreq 是 0.5（这一项的中性值是 0.5 而不是 1 —— personaScore 用
    // (cbetFreq - 0.5) 算加成），所以 personaScore 的三项加成在任意街都
    // 恒为 0，不是仅仅因为这个用例恰好停在翻前、c-bet 那一项根本不会触发。
    // score 必须与所选候选的 ev 相等。
    // 注意不能断言「选的就是 ev.recommended」—— 推荐候选可能因非法尺度被过滤掉。
    const s = startHand({ seed: 'dec-gto', buttonSeat: 0 });
    const d = decide(s, { ...opts('gto'), rng: createRng('no-bluff') });
    expect(d.score).toBeCloseTo(d.chosen.ev, 9);
  });

  it('有性格的原型确实叠加了偏好', () => {
    // 旧版本这里跑一手真实牌局，只在「碰巧选中了进攻动作」时才断言——
    // dec-maniac/bias 这个组合选中的其实是 fold（score = ev = 0），
    // if 判断体从未执行过，测试零断言地通过，personaScore 就算被删得
    // 只剩 `return c.ev`，这个测试也照样绿。
    //
    // 直接调用 personaScore：不依赖随机种子恰好落在「选中进攻动作」这个
    // 分支上，用合成的进攻候选（actionType: 'raise'）保证断言每次都执行。
    // 疯子的 aggression（1.85）远大于 1，加成 (aggression-1)*pot*AGGRESSION_WEIGHT
    // 严格为正，score 必然高于 candidate 自己的 ev。
    const maniac = getPersona('maniac');
    const candidate: EvCandidate = {
      label: 'bet pot',
      actionType: 'raise',
      investment: 10,
      ev: 3,
      isRecommended: false,
    };
    const score = personaScore(candidate, /* pot */ 10, /* toCall */ 2, 'flop', false, maniac);
    expect(score).toBeGreaterThan(candidate.ev);
  });

  it("'allin' 类型的候选不算进攻：不足额跟注不应该获得性格加成", () => {
    // estimateEv 只在「筹码不够跟平，全下是被迫的不足额跟注」这一种情况下
    // 把候选类型定成 'allin'（见 evEstimate.ts 的 'call all-in' 分支）；
    // 真正主动选择的全下类型是 'raise'/'bet'。把 'allin' 也塞进 AGGRESSIVE
    // 会让这个被迫的动作凭空获得 aggression 加成——疯子加分、岩石因为
    // aggression < 1 反而被扣分，一个没有选择余地的动作不该因为性格标签
    // 被打压或拔高。这里用疯子（加成方向最容易看出来）验证：'allin' 候选
    // 的 score 必须恰好等于它自己的 ev，不带任何加成。
    const maniac = getPersona('maniac');
    const candidate: EvCandidate = {
      label: 'call all-in',
      actionType: 'allin',
      investment: 20,
      ev: 3,
      isRecommended: false,
    };
    const score = personaScore(candidate, /* pot */ 40, /* toCall */ 100, 'flop', false, maniac);
    expect(score).toBe(candidate.ev);
  });
});

describe('decide 大盲的选项也能加注（bet/raise 类型不匹配的回归）', () => {
  it('限注平跟到大盲选项时，激进性格能选择加注，且引擎接受该动作', () => {
    // 除大盲外全员平跟，制造 toCall === 0 但 currentBet === 1（大盲本身）的
    // 局面：evEstimate 按 toCall 把候选定为 'bet'，legalActions 按 currentBet
    // 把同一个合法动作定为 'raise'。旧的精确字符串匹配会把全部五个进攻候选
    // 筛掉，usable 塌缩成只剩 check，maniac 也只能 check。
    let s = startHand({ seed: 'bbopt-0', buttonSeat: 0 });
    while (s.seats[s.toAct!].position !== 'BB') {
      s = applyAction(s, { type: 'call' });
    }
    const bb = s.seats[s.toAct!];
    expect(bb.position).toBe('BB');
    expect(s.currentBet).toBe(1);
    const toCall = s.currentBet - bb.streetContribution;
    expect(Math.abs(toCall)).toBeLessThan(1e-9);
    const legal = legalActions(s);
    expect(legal.some(a => a.type === 'raise')).toBe(true);

    const ranges = new Map<number, RangeSet>();
    const personaIds = new Map<number, string>();
    for (let k = 0; k < SEAT_COUNT; k++) { ranges.set(k, fullRange()); personaIds.set(k, 'maniac'); }

    const d = decide(s, {
      ranges,
      personaIds,
      rng: createRng('bbopt-0-rng-2'),
      iterations: 120,
      strengthIterations: 15,
    });

    expect(d.action.type).toBe('raise');
    expect(() => applyAction(s, d.action)).not.toThrow();
  });
});

describe('decide 筹码只够跟注不够最小加注时也能全下', () => {
  it('legal 只剩 fold/call/allin（没有 raise）时，AI 仍能选出全下', () => {
    // UTG 加注到 10（currentBet=10, lastRaiseSize=9，minRaiseTo=19）。
    // 下一个行动的 HJ 只有 15 点筹码：够跟注（15 > toCall=10）但不够最小
    // 加注（15 <= minInvest=19），legalActions 因此不给 raise，只给
    // fold/call/allin。estimateEv 的「all-in」候选仍然按 toCall>0 的规则
    // 定为 'raise'类型——如果 matchesLegal 不把 allin 也算进 bet/raise 同族，
    // 这个候选就无处匹配，AI 只能在 call/fold 之间选，喊不出全下。
    // 这个场景在 finding 1 修 matchesLegal 时被顺带修复了，这里单独钉一个
    // 回归测试。
    const stacks = [100, 100, 100, 100, 15, 100];
    let s = startHand({ seed: 'shortraise-0', buttonSeat: 0, startingStacks: stacks });
    s = applyAction(s, { type: 'raise', amount: 10 }); // UTG(seat3)
    expect(s.toAct).toBe(4); // HJ，筹码只有 15

    const legal = legalActions(s);
    expect(legal.some(a => a.type === 'raise')).toBe(false);
    expect(legal.some(a => a.type === 'allin')).toBe(true);

    const ranges = new Map<number, RangeSet>();
    const personaIds = new Map<number, string>();
    for (let k = 0; k < SEAT_COUNT; k++) { ranges.set(k, fullRange()); personaIds.set(k, 'maniac'); }

    let found: ReturnType<typeof decide> | null = null;
    for (let i = 0; i < 20 && !found; i++) {
      const d = decide(s, {
        ranges, personaIds, rng: createRng(`shortraise-rng-${i}`),
        iterations: 150, strengthIterations: 15,
      });
      if (d.action.type === 'allin') found = d;
    }

    expect(found).not.toBeNull();
    expect(() => applyAction(s, found!.action)).not.toThrow();
  });
});

describe('decide 可复现', () => {
  it('相同 seed 决策相同', () => {
    const s = startHand({ seed: 'dec-repro', buttonSeat: 0 });
    const a = decide(s, opts('lag', 'same-seed'));
    const b = decide(s, opts('lag', 'same-seed'));
    expect(a.action).toEqual(b.action);
    expect(a.score).toBe(b.score);
  });
});

describe('decide 返回诊断信息', () => {
  it('带上用到的性格、完整的 EV 结果与被选中的候选', () => {
    const s = startHand({ seed: 'dec-diag', buttonSeat: 0 });
    const d = decide(s, opts('tag'));
    expect(d.persona.id).toBe('tag');
    expect(d.ev.candidates.length).toBeGreaterThan(0);
    expect(d.ev.candidates).toContain(d.chosen);
    expect(Number.isFinite(d.score)).toBe(true);
  });
});
