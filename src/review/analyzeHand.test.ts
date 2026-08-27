import { describe, it, expect } from 'vitest';
import { startHand, applyAction, settleHand, legalActions } from '../core/gameEngine';
import { toHandRecord } from '../core/handRecord';
import { HERO_SEAT } from '../core/types';
import type { HandRecord } from '../core/types';
import { analyzeHand } from './analyzeHand';
import { REVIEW_SCHEMA_VERSION } from './types';
import { chipsGreater } from '../core/chips';
import { EV_NOISE_SIGMAS } from './taxonomy';

// 注意：这个辅助函数照抄任务书原文，唯一的改动是非 hero、非翻前分支里
// 加了一层"fold 是否合法"的判断（见下方注释）——原文对每个非 hero 玩家在
// 翻后一律送 fold，但 hero 在翻后一律 check，于是紧跟在 hero 之后行动的
// 那个玩家永远面对 toCall = 0，而 gameEngine.legalActions 在 toCall = 0
// 时从不把 fold 列为合法动作（没有欠钱可弃）。原文这样跑必定在第一次
// 翻后行动时抛出"非法动作 fold"，在这次任务开始前已用调试脚本复现确认。
function makeRecord(seed: string): HandRecord {
  let s = startHand({ seed, buttonSeat: 3 });
  let n = 0;
  while (!s.handOver && n++ < 40) {
    if (s.toAct === HERO_SEAT) {
      s = applyAction(s, s.street === 'preflop' ? { type: 'raise', amount: 3 } : { type: 'check' });
    } else if (s.street === 'preflop' && s.toAct === 2) {
      s = applyAction(s, { type: 'call' });
    } else {
      // fold 不合法时（面对 toCall = 0）退化为 check，而不是让 applyAction 抛错
      const canFold = legalActions(s).some(a => a.type === 'fold');
      s = applyAction(s, canFold ? { type: 'fold' } : { type: 'check' });
    }
  }
  return toHandRecord(settleHand(s), { id: seed, heroSeat: HERO_SEAT, personaIds: {}, timestamp: 0 });
}

const OPTS = { iterations: 200, strengthIterations: 15 };

describe('analyzeHand', () => {
  it('每个 hero 动作产出一条分析', () => {
    const rec = makeRecord('an-1');
    const a = analyzeHand(rec, OPTS);
    expect(a.decisions).toHaveLength(rec.actions.filter(x => x.seat === rec.heroSeat).length);
    expect(a.recordId).toBe(rec.id);
    expect(a.schemaVersion).toBe(REVIEW_SCHEMA_VERSION);
  });

  it('噪声闸门：evLoss 要么是 0，要么确实超过了该决策点的噪声带', () => {
    // 这是闸门的**不变式**，对任何一手牌都成立：损失落在噪声带以内时，
    // 「推荐动作更好」这句话在统计上不成立，evLoss 必须是 0 而不是一个小数字。
    // 用 iterations=200（本文件的 OPTS）跑，噪声带很宽，闸门频繁生效，
    // 正好把这条不变式压在最容易出问题的一侧。
    for (const seed of ['gate-1', 'gate-2', 'gate-3']) {
      const a = analyzeHand(makeRecord(seed), OPTS);
      for (const d of a.decisions) {
        if (d.evLoss === 0) continue;
        const band = EV_NOISE_SIGMAS * Math.hypot(
          d.recommended?.evStdErr ?? 0,
          d.candidates.find(c => c.label === d.actualLabel)?.evStdErr ?? 0,
        );
        expect(d.evLoss).toBeGreaterThan(band);
      }
    }
  });

  it('噪声闸门确实在生效：同一手牌，迭代数越少被判失误的越少', () => {
    // 迭代数决定噪声带宽度（标准误 ∝ 1/√n）。同一手牌用两种迭代数跑，
    // 低迭代那次的噪声带更宽，被判为失误的决策点不应该更多。
    // 断言写成"不多于"而不是"严格更少"：一手牌里可能一个失误都没有，
    // 也可能所有失误都大到两种迭代数下都过闸——那些情况下相等是对的。
    const rec = makeRecord('gate-cmp');
    const noisy = analyzeHand(rec, { iterations: 120, strengthIterations: 15 });
    const cleaner = analyzeHand(rec, { iterations: 1200, strengthIterations: 15 });
    const flagged = (a: ReturnType<typeof analyzeHand>) =>
      a.decisions.filter(d => d.evLoss > 0).length;
    expect(flagged(noisy)).toBeLessThanOrEqual(flagged(cleaner));
  });

  it('汇总字段与逐条一致', () => {
    const a = analyzeHand(makeRecord('an-2'), OPTS);
    const sum = a.decisions.reduce((x, d) => x + d.evLoss, 0);
    expect(a.totalEvLoss).toBeCloseTo(sum, 6);
    expect(a.worstEvLoss).toBeCloseTo(Math.max(0, ...a.decisions.map(d => d.evLoss)), 6);
    const tags = new Set(a.decisions.map(d => d.tag).filter(Boolean));
    expect(new Set(a.tags)).toEqual(tags);
  });

  it('evLoss 恒非负', () => {
    for (const seed of ['an-3', 'an-4', 'an-5']) {
      for (const d of analyzeHand(makeRecord(seed), OPTS).decisions) {
        expect(d.evLoss).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('降级的决策点不报损失', () => {
    for (const seed of ['an-6', 'an-7']) {
      for (const d of analyzeHand(makeRecord(seed), OPTS).decisions) {
        if (d.degraded) {
          expect(d.evLoss).toBe(0);
          expect(d.severity).toBe('ok');
          expect(d.tag).toBeNull();
        }
      }
    }
  });

  it('同一记录分析两次结果逐位相同', () => {
    const rec = makeRecord('an-8');
    const a = analyzeHand(rec, OPTS);
    const b = analyzeHand(rec, OPTS);
    expect(JSON.stringify(a.decisions.map(d => [d.evLoss, d.severity, d.tag])))
      .toBe(JSON.stringify(b.decisions.map(d => [d.evLoss, d.severity, d.tag])));
  });

  it('severity 与 evLoss 一致', () => {
    for (const d of analyzeHand(makeRecord('an-9'), OPTS).decisions) {
      if (d.evLoss < 0.2) expect(d.severity).toBe('ok');
      else if (d.evLoss < 1) expect(d.severity).toBe('minor');
      else if (d.evLoss < 3) expect(d.severity).toBe('notable');
      else expect(d.severity).toBe('severe');
    }
  });

  it('导出候选列表、两个胜率与实际动作标签（EV 条形图的数据源）', () => {
    const a = analyzeHand(makeRecord('an-bars-1'), OPTS);
    expect(a.decisions.length).toBeGreaterThan(0);
    let checked = 0;
    for (const d of a.decisions) {
      // degraded 的决策点由 analyzeHand.degraded.test.ts 单独覆盖
      if (d.degraded) continue;
      checked++;

      // 候选列表非空，且恰有一条被标记为推荐 —— 这条推荐必须就是
      // recommended 字段本身，不是另算的一个，否则条形图高亮的那根
      // 和文案里说的「建议 X」会是两回事
      expect(d.candidates.length).toBeGreaterThan(0);
      const flagged = d.candidates.filter(c => c.isRecommended);
      expect(flagged).toHaveLength(1);
      expect(flagged[0].label).toBe(d.recommended!.label);

      // hero 胜率是概率，必在 [0,1]
      expect(d.heroEquity).not.toBeNull();
      expect(d.heroEquity!).toBeGreaterThanOrEqual(0);
      expect(d.heroEquity!).toBeLessThanOrEqual(1);

      // 所需胜率：面对下注时是 (0,1) 的真数，无需跟注时为 null
      if (chipsGreater(d.situation.toCall, 0)) {
        expect(d.requiredEquity).not.toBeNull();
        expect(d.requiredEquity!).toBeGreaterThan(0);
        expect(d.requiredEquity!).toBeLessThan(1);
      } else {
        expect(d.requiredEquity).toBeNull();
      }

      // actualLabel 要么为 null（匹配不到候选），要么必须真的是候选之一 ——
      // 条形图靠它高亮，指向一个不存在的标签等于什么都不高亮
      if (d.actualLabel !== null) {
        expect(d.candidates.map(c => c.label)).toContain(d.actualLabel);
      }
    }
    // 守住空转：上面整段若因为全部 degraded 而一条都没检查，这里会红。
    // 没有这条断言，`if (d.degraded) continue` 会让整个测试变成永远绿的空壳
    expect(checked).toBeGreaterThan(0);
  });
});

describe('analyzeHand 端到端：可读结论', () => {
  // 这不是断言正确性的测试（正确性已经由上面几条覆盖），是「产品第一次
  // 产出人能读的东西」的存在性检查：每条决策的六个字段都必须是有意义的
  // 值，且 explanation 必须是非空句子而不是模板占位符残留。人工阅读的
  // 完整文本走报告，不留在提交的测试里 console.log。
  it('每条决策都有街道、实际动作、推荐动作、evLoss、severity、explanation', () => {
    const rec = makeRecord('an-report-1');
    const a = analyzeHand(rec, OPTS);
    expect(a.decisions.length).toBeGreaterThan(0);
    for (const d of a.decisions) {
      expect(['preflop', 'flop', 'turn', 'river']).toContain(d.street);
      expect(d.actual.type).toBeTruthy();
      // recommended 在 degraded 时强制为 null（见 analyzeHand.degraded.test.ts）；
      // 这条记录不受 mock 影响，走真实 estimateEv，只在两个分支里都断言，
      // 不弱化"非降级时 recommended.label 必须非空"这条原始检查。
      if (d.degraded) {
        expect(d.recommended).toBeNull();
      } else {
        expect(d.recommended).not.toBeNull();
        expect(d.recommended!.label).toBeTruthy();
      }
      expect(typeof d.evLoss).toBe('number');
      expect(['ok', 'minor', 'notable', 'severe']).toContain(d.severity);
      expect(typeof d.explanation).toBe('string');
      expect(d.explanation.length).toBeGreaterThan(0);
    }
  });
});
