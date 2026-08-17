import { describe, it, expect } from 'vitest';
import type { HandAnalysis, DecisionAnalysis } from '../review/types';
import { handGrade } from './reviewModel';

/**
 * 造一个 DecisionAnalysis。这里刻意不跑真实的 analyzeHand ——
 * 本模块是纯数据变形，用合成输入才能精确控制每一档边界；
 * 真实分析路径由 src/review/analyzeHand.test.ts 覆盖。
 */
function decision(over: Partial<DecisionAnalysis> = {}): DecisionAnalysis {
  return {
    actionIndex: 0,
    street: 'preflop',
    // situation 在本任务的断言里用不到，给一个最小可用的壳
    situation: {
      heroSeat: 0,
      heroPosition: 'BTN',
      heroCards: [{ rank: 14, suit: 's' }, { rank: 13, suit: 's' }],
      board: [],
      street: 'preflop',
      pot: 1.5,
      toCall: 1,
      heroStack: 99,
      heroStreetContribution: 0,
      opponents: [],
      heroIsPreflopAggressor: false,
    },
    actual: {
      seat: 0,
      street: 'preflop',
      type: 'call',
      amount: 1,
      potBefore: 1.5,
      toCall: 1,
      stackBefore: 100,
    },
    actualEv: 0,
    recommended: null,
    evLoss: 0,
    severity: 'ok',
    tag: null,
    explanation: '',
    degraded: false,
    candidates: [],
    heroEquity: 0.5,
    requiredEquity: 0.4,
    actualLabel: null,
    ...over,
  } as DecisionAnalysis;
}

function analysis(decisions: DecisionAnalysis[]): HandAnalysis {
  return {
    recordId: 'r1',
    heroSeat: 0,
    schemaVersion: 1,
    decisions,
    totalEvLoss: decisions.reduce((s, d) => s + d.evLoss, 0),
    worstEvLoss: decisions.length === 0 ? 0 : Math.max(...decisions.map(d => d.evLoss)),
    tags: [],
  };
}

describe('handGrade', () => {
  it('没有决策点时是 unknown，而不是「没问题」', () => {
    const g = handGrade(analysis([]));
    expect(g.grade).toBe('unknown');
    expect(g.text).toBe('本手没有可判定的决策点');
  });

  it('全部决策点降级时也是 unknown —— 算不出来不等于打得对', () => {
    const g = handGrade(analysis([
      decision({ degraded: true }),
      decision({ actionIndex: 1, degraded: true }),
    ]));
    expect(g.grade).toBe('unknown');
  });

  it('有一个可判定的决策点且都没亏时是 clean', () => {
    const g = handGrade(analysis([
      decision({ degraded: true }),
      decision({ actionIndex: 1, evLoss: 0.1 }),
    ]));
    expect(g.grade).toBe('clean');
    expect(g.text).toBe('这手没问题');
  });

  it('按最大单点损失定档，不是按累加', () => {
    // 五个 0.5 BB 的小偏差累加是 2.5（若按 totalEvLoss 会判成 notable），
    // 但单点最大只有 0.5，仍是 minor
    const five = [0, 1, 2, 3, 4].map(i => decision({ actionIndex: i, evLoss: 0.5 }));
    expect(handGrade(analysis(five)).grade).toBe('minor');

    // 单点 1.0 恰好踩在 notable 的下界（taxonomy 的区间左闭右开）
    expect(handGrade(analysis([decision({ evLoss: 1 })])).grade).toBe('notable');
    // 单点 3.0 恰好踩在 severe 的下界
    expect(handGrade(analysis([decision({ evLoss: 3 })])).grade).toBe('severe');
  });
});
