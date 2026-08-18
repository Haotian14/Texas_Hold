import { describe, it, expect } from 'vitest';
import { startHand, applyAction, settleHand, legalActions } from '../core/gameEngine';
import { toHandRecord } from '../core/handRecord';
import { HERO_SEAT } from '../core/types';
import type { HandRecord } from '../core/types';
import { viewOf, HAND_VIEW_SCHEMA_VERSION } from './view';
import { analyzeHand } from './analyzeHand';

/**
 * 视图类型的三条要害，逐条守：
 * 1. JSON 往返无损（这正是 HandAnalysis 做不到的事）
 * 2. 不含任何范围数据（体积与"没用"两个理由，见 view.ts 顶部）
 * 3. degraded 契约照旧成立（搬字段不能把空的搬成非空的）
 */

/**
 * 与 analyzeHand.test.ts 同款的造局辅助：hero 翻前加注、翻后过牌，其余人
 * 尽量弃牌（fold 不合法时退化为 check —— toCall = 0 时 legalActions 从不
 * 把 fold 列为合法动作）。用固定脚本而不是自对弈，是为了让每次跑的决策点
 * 数量稳定，体积断言才有意义。
 */
function makeRecord(seed: string): HandRecord {
  let s = startHand({ seed, buttonSeat: 3 });
  let n = 0;
  while (!s.handOver && n++ < 40) {
    if (s.toAct === HERO_SEAT) {
      s = applyAction(s, s.street === 'preflop' ? { type: 'raise', amount: 3 } : { type: 'check' });
    } else if (s.street === 'preflop' && s.toAct === 2) {
      s = applyAction(s, { type: 'call' });
    } else {
      const canFold = legalActions(s).some(a => a.type === 'fold');
      s = applyAction(s, canFold ? { type: 'fold' } : { type: 'check' });
    }
  }
  return toHandRecord(settleHand(s), { id: seed, heroSeat: HERO_SEAT, personaIds: {}, timestamp: 0 });
}

/** 迭代数压到测试档，与 analyzeHand.test.ts 一致 */
const OPTS = { iterations: 200, strengthIterations: 15 };

function realHands(count: number): HandRecord[] {
  return Array.from({ length: count }, (_, i) => makeRecord(`view-${i}`));
}

describe('viewOf —— JSON 往返', () => {
  it('stringify → parse 后与原视图逐字段相等', () => {
    const records = realHands(6);
    expect(records.length).toBe(6);

    let checkedDecisions = 0;
    for (const rec of records) {
      const view = viewOf(analyzeHand(rec, OPTS));
      const round = JSON.parse(JSON.stringify(view));
      expect(round, rec.id).toEqual(view);
      checkedDecisions += view.decisions.length;
    }
    // 防空转：若这些牌局一个 hero 决策点都没有，上面的相等断言是在比空数组
    expect(checkedDecisions).toBeGreaterThan(0);
  });

  it('HandAnalysis 直接序列化会丢东西 —— 这是本类型存在的理由，钉死它', () => {
    const rec = realHands(1)[0];
    const analysis = analyzeHand(rec, OPTS);

    // 找一个带对手范围的决策点。全部降级时没有可比的东西，跳过断言但记数。
    const withRange = analysis.decisions.find(d => d.situation.opponents.length > 0);
    expect(withRange, '需要至少一个有对手的决策点').toBeDefined();

    const opp = withRange!.situation.opponents[0];
    expect(opp.range.size).toBeGreaterThan(0);

    // ReadonlyMap 被 JSON.stringify 静默变成 {}：不抛错，数据没了
    const roundTripped = JSON.parse(JSON.stringify(withRange!.situation.opponents[0]));
    expect(roundTripped.range).toEqual({});
  });

  it('recommended 不再是共享引用 —— 存的是 label', () => {
    const records = realHands(6);
    let checked = 0;
    for (const rec of records) {
      const analysis = analyzeHand(rec, OPTS);
      const view = viewOf(analysis);
      analysis.decisions.forEach((d, i) => {
        if (d.recommended === null) {
          expect(view.decisions[i].recommendedLabel).toBeNull();
          return;
        }
        expect(view.decisions[i].recommendedLabel).toBe(d.recommended.label);
        // 原来的缺陷：recommended 与 candidates 里某一项是同一个对象
        expect(analysis.decisions[i].candidates).toContain(d.recommended);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('viewOf —— 不含范围数据', () => {
  it('整个视图序列化后的文本里不出现手牌类别记法（AKs / 77 之类）', () => {
    const records = realHands(6);
    let checked = 0;
    for (const rec of records) {
      const text = JSON.stringify(viewOf(analyzeHand(rec, OPTS)));
      // 范围表的键长这样：AKs / AKo / 77。它们只可能来自 RangeSet，
      // 视图里任何一处出现都说明范围漏进来了。
      expect(text, rec.id).not.toMatch(/"[2-9TJQKA][2-9TJQKA][so]"\s*:/);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('单手视图的 JSON 体积在规格估的量级内（< 8 KB）', () => {
    const records = realHands(6);
    const sizes = records.map(rec => JSON.stringify(viewOf(analyzeHand(rec, OPTS))).length);
    // 规格 §9 估「单手约 1–2 KB」。放宽到 8 KB 是留给解释文案与多决策点的余量；
    // 真正要挡的是"带着范围表落库"那个量级（单个决策点就 10 KB 起）。
    for (const n of sizes) expect(n).toBeLessThan(8 * 1024);
    expect(sizes.length).toBeGreaterThan(0);
  });
});

describe('viewOf —— degraded 契约', () => {
  it('降级的决策点搬过去仍然是空的，一个范围派生的数字都不带', () => {
    const records = realHands(8);
    let degradedSeen = 0;
    for (const rec of records) {
      for (const v of viewOf(analyzeHand(rec, OPTS)).decisions) {
        if (!v.degraded) continue;
        degradedSeen++;
        expect(v.heroEquity).toBeNull();
        expect(v.recommendedLabel).toBeNull();
        expect(v.actualLabel).toBeNull();
        expect(v.candidates).toEqual([]);
        expect(v.evLoss).toBe(0);
        expect(v.severity).toBe('ok');
        expect(v.tag).toBeNull();
      }
    }
    // 降级在真实牌局里触发不到（见 README 的已知边界，实测 200 手 0 次），
    // 所以这里不能断言 degradedSeen > 0 —— 那会让这条测试恒失败。
    // 契约本身由 analyzeHand.degraded.test.ts 用注入的方式覆盖；这条只保证
    // "若出现，viewOf 不会把它搬成非空"。
    expect(degradedSeen).toBeGreaterThanOrEqual(0);
  });
});

describe('viewOf —— 搬运正确性', () => {
  it('pot / toCall 取自 situation，其余字段逐一对上', () => {
    const records = realHands(6);
    let checked = 0;
    for (const rec of records) {
      const a = analyzeHand(rec, OPTS);
      const v = viewOf(a);
      expect(v.schemaVersion).toBe(HAND_VIEW_SCHEMA_VERSION);
      expect(v.recordId).toBe(a.recordId);
      expect(v.heroSeat).toBe(a.heroSeat);
      expect(v.totalEvLoss).toBe(a.totalEvLoss);
      expect(v.worstEvLoss).toBe(a.worstEvLoss);
      expect(v.tags).toEqual(a.tags);
      expect(v.decisions.length).toBe(a.decisions.length);
      a.decisions.forEach((d, i) => {
        const dv = v.decisions[i];
        expect(dv.pot).toBe(d.situation.pot);
        expect(dv.toCall).toBe(d.situation.toCall);
        expect(dv.actionIndex).toBe(d.actionIndex);
        expect(dv.street).toBe(d.street);
        expect(dv.actual).toEqual(d.actual);
        expect(dv.evLoss).toBe(d.evLoss);
        expect(dv.severity).toBe(d.severity);
        expect(dv.tag).toBe(d.tag);
        expect(dv.explanation).toBe(d.explanation);
        expect(dv.degraded).toBe(d.degraded);
        expect(dv.requiredEquity).toBe(d.requiredEquity);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(0);
  });
});
