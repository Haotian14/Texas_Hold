import { describe, it, expect } from 'vitest';
import type { HandView, DecisionView } from '../review/view';
import type { HandRecord } from '../core/types';
import type { EvCandidate } from '../core/evEstimate';
import {
  handGrade,
  barsOf,
  foldedSeatsOf,
  TAG_TEXT,
  severityText,
  streetSummaries,
  defaultStreetOf,
  heroNetOf,
  endingText,
  handNumberOf,
  handSubtitle,
} from './reviewModel';
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

describe('severityText', () => {
  it('degraded 与 ok 说的不是同一句话 —— 算不出来不等于打得对', () => {
    expect(severityText(true, 'ok')).toBe('无法判定');
    expect(severityText(false, 'ok')).toBe('没问题');
  });

  it('四档 severity 各有一句话，且互不重复', () => {
    const texts = (['ok', 'minor', 'notable', 'severe'] as const).map(s => severityText(false, s));
    expect(texts.every(t => t.length > 0)).toBe(true);
    expect(new Set(texts).size).toBe(4);
  });
});

describe('streetSummaries', () => {
  it('恒返回四条街，即使一条决策点都没有', () => {
    const list = streetSummaries(analysis([]));
    expect(list.map(s => s.street)).toEqual(['preflop', 'flop', 'turn', 'river']);
    expect(list.map(s => s.label)).toEqual(['翻前', '翻牌', '转牌', '河牌']);
    expect(list.every(s => s.status === 'skip')).toBe(true);
    expect(list.every(s => s.evText === 'n/a')).toBe(true);
  });

  it('view 为 null（分析失败）时也给出四条灰卡片，而不是空数组', () => {
    const list = streetSummaries(null);
    expect(list).toHaveLength(4);
    expect(list.every(s => s.status === 'skip' && s.rows.length === 0)).toBe(true);
  });

  it('该街全是 ok / minor → good，EV 文案是破折号', () => {
    const list = streetSummaries(analysis([
      decision({ street: 'flop', actionIndex: 2, severity: 'ok', evLoss: 0 }),
      decision({ street: 'flop', actionIndex: 3, severity: 'minor', evLoss: 0.2 }),
    ]));
    const flop = list[1];
    expect(flop.status).toBe('good');
    expect(flop.evText).toBe('—');
    expect(flop.tagText).toBe('按计划');
    expect(flop.title).toBe('翻牌 — 打得对');
  });

  it('该街出现 notable / severe → leak，EV 文案是该街 evLoss 之和', () => {
    const list = streetSummaries(analysis([
      decision({ street: 'turn', actionIndex: 4, severity: 'minor', evLoss: 0.3 }),
      decision({
        street: 'turn',
        actionIndex: 5,
        severity: 'notable',
        evLoss: 2,
        tag: 'should_have_folded',
      }),
    ]));
    const turn = list[2];
    expect(turn.status).toBe('leak');
    expect(turn.evLoss).toBe(2.3);
    // U+2212 减号，不是连字符
    expect(turn.evText).toBe('−2.3 BB');
    expect(turn.title).toBe('转牌 — 损失 2.3 BB');
    expect(turn.tagText).toBe(TAG_TEXT.should_have_folded);
  });

  it('evLoss 求和不带浮点尾数', () => {
    const list = streetSummaries(analysis([
      decision({ street: 'river', actionIndex: 6, severity: 'notable', evLoss: 1.1 }),
      decision({ street: 'river', actionIndex: 7, severity: 'ok', evLoss: 2.2 }),
    ]));
    // 1.1 + 2.2 在 IEEE754 里是 3.3000000000000003
    expect(list[3].evLoss).toBe(3.3);
  });

  it('该街全部 degraded → skip，不会被当成「打得对」', () => {
    // degraded 的决策点 severity 恒为 ok，剔不干净就会显示成绿 ✓
    const list = streetSummaries(analysis([
      decision({ street: 'preflop', actionIndex: 0, degraded: true, severity: 'ok' }),
    ]));
    const pre = list[0];
    expect(pre.status).toBe('skip');
    expect(pre.evText).toBe('n/a');
    // 但决策点本身仍要交给右栏渲染出来，否则那条街的记录就凭空消失了
    expect(pre.rows).toHaveLength(1);
    expect(pre.title).toBe('翻前 — 不做判定');
  });

  it('同一条街的决策点全部保留，按 actionIndex 升序，index 指回原下标', () => {
    const list = streetSummaries(analysis([
      decision({ street: 'flop', actionIndex: 9 }),
      decision({ street: 'flop', actionIndex: 7 }),
      decision({ street: 'turn', actionIndex: 11 }),
    ]));
    expect(list[1].rows.map(r => r.decision.actionIndex)).toEqual([7, 9]);
    expect(list[1].rows.map(r => r.index)).toEqual([1, 0]);
    expect(list[2].rows).toHaveLength(1);
  });

  it('同严重度时标签取损失更大的那个决策点', () => {
    const list = streetSummaries(analysis([
      decision({
        street: 'flop',
        actionIndex: 2,
        severity: 'notable',
        evLoss: 1,
        tag: 'missed_cbet',
      }),
      decision({
        street: 'flop',
        actionIndex: 3,
        severity: 'notable',
        evLoss: 3,
        tag: 'over_bluffing',
      }),
    ]));
    expect(list[1].tagText).toBe(TAG_TEXT.over_bluffing);
  });

  it('leak 但没有分类时给一句兜底话，不留空胶囊', () => {
    const list = streetSummaries(analysis([
      decision({ street: 'flop', actionIndex: 2, severity: 'severe', evLoss: 5, tag: null }),
    ]));
    expect(list[1].tagText).toBe('有失误');
  });
});

describe('defaultStreetOf', () => {
  it('优先选第一条有失误的街', () => {
    const list = streetSummaries(analysis([
      decision({ street: 'preflop', actionIndex: 0, severity: 'ok' }),
      decision({ street: 'turn', actionIndex: 4, severity: 'notable', evLoss: 2 }),
      decision({ street: 'river', actionIndex: 6, severity: 'severe', evLoss: 9 }),
    ]));
    // 不是「最严重的那条街」，是**第一条**有失误的街 —— 复盘按时间顺序读
    expect(defaultStreetOf(list)).toBe('turn');
  });

  it('没有失误时选第一条有决策点的街', () => {
    const list = streetSummaries(analysis([
      decision({ street: 'flop', actionIndex: 2, severity: 'ok' }),
    ]));
    expect(defaultStreetOf(list)).toBe('flop');
  });

  it('一条决策点都没有时落回翻前，不返回 null', () => {
    expect(defaultStreetOf(streetSummaries(analysis([])))).toBe('preflop');
  });
});

describe('页头文案', () => {
  function record(over: Partial<HandRecord> = {}): HandRecord {
    return {
      id: 's1700000000000-h38',
      timestamp: 1700000000000,
      heroSeat: 0,
      seats: [
        { seat: 0, position: 'BTN', personaId: 'hero' },
        { seat: 1, position: 'SB', personaId: 'tag' },
        { seat: 2, position: 'BB', personaId: 'rock' },
      ],
      actions: [],
      results: [{ seat: 0, netBB: 3.5, showdown: false }],
      ...over,
    } as unknown as HandRecord;
  }

  it('heroNetOf 取 hero 座位的净盈亏；没有该座位的结果时是 0 而不是 NaN', () => {
    expect(heroNetOf(record())).toBe(3.5);
    expect(heroNetOf(record({ results: [] }))).toBe(0);
  });

  it('endingText 区分摊牌与弃牌结束', () => {
    expect(endingText(record())).toBe('弃牌结束');
    expect(endingText(record({ results: [{ seat: 0, netBB: 1, showdown: true }] }))).toBe('摊牌');
  });

  it('handNumberOf 从 record.id 的 -h 后缀取序号，handIndex 从 0 起所以显示 +1', () => {
    expect(handNumberOf(record())).toBe(39);
    // 认不出来时返回 null，不编一个号出来
    expect(handNumberOf(record({ id: 'imported-abc' }))).toBe(null);
  });

  it('只剩一个对手没弃牌时副标题点名到人', () => {
    const rec = record({
      actions: [
        { seat: 2, street: 'preflop', type: 'fold', amount: 0, toCall: 1, potBefore: 1.5 },
      ] as unknown as HandRecord['actions'],
    });
    expect(handSubtitle(rec)).toBe('第 39 手 · vs SB（紧凶）');
  });

  it('对手不止一个时只说人数，不随手挑一个座位冒充「那个对手」', () => {
    expect(handSubtitle(record())).toBe('第 39 手 · vs 2 名对手');
  });

  it('认不出手牌序号时退回显示日期，而不是「第 NaN 手」', () => {
    const text = handSubtitle(record({ id: 'imported-abc' }));
    expect(text).not.toMatch(/NaN|第 null/);
    expect(text.endsWith('· vs 2 名对手')).toBe(true);
  });
});
