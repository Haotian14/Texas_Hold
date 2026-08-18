import { describe, it, expect } from 'vitest';
import type { HandView, DecisionView } from '../review/view';
import type { HandRecord } from '../core/types';
import type { EvCandidate } from '../core/evEstimate';
import { handGrade, timelineOf, barsOf, foldedSeatsOf, TAG_TEXT } from './reviewModel';
import { PREFLOP_TAGS, POSTFLOP_TAGS } from '../review/taxonomy';

/**
 * 造一个 DecisionView。这里刻意不跑真实的 analyzeHand ——
 * 本模块是纯数据变形，用合成输入才能精确控制每一档边界；
 * 真实分析路径由 src/review/analyzeHand.test.ts 覆盖，
 * HandAnalysis → HandView 的搬运由 src/review/view.test.ts 覆盖。
 */
// 返回类型标注 + 不加 as：字面量必须真的满足 DecisionView。
// ③-B 复审时去掉了结尾的 `as DecisionView`，正是因为 ③-C 要改这个接口——
// 改的那一刻这里编译失败，而不是在界面上静默显示 undefined。它兑现了。
function decision(over: Partial<DecisionView> = {}): DecisionView {
  return {
    actionIndex: 0,
    street: 'preflop',
    // 底池与待跟注在 view 里是两个平字段，不再是整块 situation ——
    // 对手范围不落库（体积 + 无用，见 review/view.ts 顶部）
    pot: 1.5,
    toCall: 1,
    actual: {
      seat: 0,
      street: 'preflop',
      type: 'call',
      amount: 1,
      potBefore: 1.5,
      toCall: 1,
      stackBefore: 100,
    },
    recommendedLabel: null,
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
  };
}

function analysis(decisions: DecisionView[]): HandView {
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

function candidate(over: Partial<EvCandidate> = {}): EvCandidate {
  return {
    label: 'fold',
    actionType: 'fold',
    investment: 0,
    ev: 0,
    isRecommended: false,
    ...over,
  };
}

describe('timelineOf', () => {
  it('按街分组，只保留有决策点的街，街序固定为翻前→翻牌→转牌→河牌', () => {
    // 刻意乱序传入，验证输出不是照抄输入顺序
    const groups = timelineOf(analysis([
      decision({ actionIndex: 3, street: 'river' }),
      decision({ actionIndex: 0, street: 'preflop' }),
      decision({ actionIndex: 2, street: 'flop' }),
    ]));
    expect(groups.map(g => g.street)).toEqual(['preflop', 'flop', 'river']);
    expect(groups.map(g => g.label)).toEqual(['翻前', '翻牌', '河牌']);
  });

  it('组内按 actionIndex 升序，index 指回 decisions 里的原下标', () => {
    // decisions 数组里的顺序是 2、0、1，actionIndex 是 7、5、6
    const groups = timelineOf(analysis([
      decision({ actionIndex: 7, street: 'flop' }),
      decision({ actionIndex: 5, street: 'flop' }),
      decision({ actionIndex: 6, street: 'flop' }),
    ]));
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map(r => r.decision.actionIndex)).toEqual([5, 6, 7]);
    // index 必须是「在 a.decisions 里的下标」，不是排序后的名次 ——
    // 展开状态用它做 key，错了会展开错的那一行
    expect(groups[0].rows.map(r => r.index)).toEqual([1, 2, 0]);
  });
});

describe('barsOf', () => {
  it('全为非负 EV 时零点在最左，条从零点向右伸', () => {
    const chart = barsOf(decision({
      candidates: [
        candidate({ label: 'fold', ev: 0 }),
        candidate({ label: 'call', ev: 2, actionType: 'call', investment: 1 }),
        candidate({ label: 'bet 1/2', ev: 4, actionType: 'bet', investment: 3, isRecommended: true }),
      ],
      actualLabel: 'call',
    }));
    expect(chart.zeroPct).toBe(0);
    expect(chart.bars.map(b => b.leftPct)).toEqual([0, 0, 0]);
    expect(chart.bars.map(b => b.widthPct)).toEqual([0, 50, 100]);
    expect(chart.bars.map(b => b.isRecommended)).toEqual([false, false, true]);
    expect(chart.bars.map(b => b.isActual)).toEqual([false, true, false]);
  });

  it('出现负 EV 时零点内移，负条向左伸且右端落在零点', () => {
    const chart = barsOf(decision({
      candidates: [
        candidate({ label: 'fold', ev: 0 }),
        candidate({ label: 'call', ev: -2, actionType: 'call', investment: 2 }),
        candidate({ label: 'bet 1/2', ev: 2, actionType: 'bet', investment: 3, isRecommended: true }),
      ],
      actualLabel: 'fold',
    }));
    // 轴是 [-2, 2]，零点在正中
    expect(chart.zeroPct).toBe(50);
    const call = chart.bars.find(b => b.label === 'call')!;
    expect(call.leftPct).toBe(0);
    expect(call.widthPct).toBe(50);
    // 左端 + 宽度 = 零点，负条的右端必须正好贴住基线
    expect(call.leftPct + call.widthPct).toBe(chart.zeroPct);
  });

  it('候选全为零 EV 时不做除零', () => {
    const chart = barsOf(decision({
      candidates: [candidate({ label: 'fold', ev: 0 }), candidate({ label: 'check', ev: 0, actionType: 'check' })],
      actualLabel: 'check',
    }));
    expect(chart.zeroPct).toBe(0);
    for (const b of chart.bars) {
      expect(Number.isFinite(b.widthPct)).toBe(true);
      expect(b.widthPct).toBe(0);
    }
  });

  it('降级的决策点没有候选，返回空图', () => {
    const chart = barsOf(decision({ degraded: true, candidates: [], actualLabel: null }));
    expect(chart.bars).toEqual([]);
    expect(chart.zeroPct).toBe(0);
  });
});

describe('foldedSeatsOf', () => {
  it('列出弃过牌的座位，去重且不含未弃牌的人', () => {
    const rec = {
      actions: [
        { seat: 1, street: 'preflop', type: 'fold', amount: 0, toCall: 1, potBefore: 1.5 },
        { seat: 2, street: 'preflop', type: 'call', amount: 1, toCall: 1, potBefore: 1.5 },
        { seat: 4, street: 'flop', type: 'fold', amount: 0, toCall: 2, potBefore: 4 },
      ],
    } as unknown as HandRecord;
    expect(foldedSeatsOf(rec).sort((x, y) => x - y)).toEqual([1, 4]);
  });
});

describe('TAG_TEXT', () => {
  const ALL_TAGS = [...PREFLOP_TAGS, ...POSTFLOP_TAGS];

  it('每个 MistakeTag 都有中文标签，没有一个漏成枚举名', () => {
    for (const tag of ALL_TAGS) {
      const text = TAG_TEXT[tag];
      expect(text, tag).toBeTruthy();
      // 关键断言：不能等于 tag 本身，也不能含下划线——那正是修掉的那个 bug
      // （卡片里直接印 preflop_cold_call_too_wide）复发的样子。
      expect(text, tag).not.toBe(tag);
      expect(text, tag).not.toMatch(/_/);
    }
    expect(ALL_TAGS.length).toBeGreaterThan(0);
  });

  it('标签互不重复 —— 两个 tag 显示成同一句话，用户分不出自己犯的是哪个错', () => {
    const texts = ALL_TAGS.map(t => TAG_TEXT[t]);
    expect(new Set(texts).size).toBe(texts.length);
  });
});
