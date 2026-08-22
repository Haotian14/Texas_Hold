import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { summaryOf, aggregate, SUMMARY_SCHEMA_VERSION } from './summary';
import { emptyStats, applyHand } from './stats';
import type { StoredHand } from './schema';
import { PREFLOP_TAGS, POSTFLOP_TAGS } from '../review/taxonomy';
import type { MistakeTag } from '../review/taxonomy';
import type { Position, Street } from '../core/types';
import type { DecisionView } from '../review/view';

/**
 * 合成输入，抄自 stats.test.ts 的 hand()/decision() 做法——两个测试文件
 * 造的是同一种 StoredHand，没道理各发明一套。
 */
function decision(over: Partial<DecisionView> = {}): DecisionView {
  return {
    actionIndex: 0,
    street: 'preflop',
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
    heroEquity: 0.5,
    requiredEquity: 0.4,
    candidates: [],
    actualLabel: null,
    recommendedLabel: null,
    evLoss: 0,
    severity: 'ok',
    tag: null,
    explanation: '',
    degraded: false,
    ...over,
  };
}

interface DecisionSpec {
  street: Street;
  evLoss: number;
  tag: MistakeTag | null;
}

interface HandSpec {
  id?: string;
  timestamp?: number;
  position?: Position;
  netBB?: number;
  decisions?: DecisionSpec[];
  /** true = 分析失败（view 为 null）。与显式传 view: null 等价，
      两种写法都在下面测试里用到，都要支持 */
  failed?: boolean;
  view?: null;
}

function handWith(spec: HandSpec = {}): StoredHand {
  const {
    id = 'h0',
    timestamp = 0,
    position = 'BTN',
    netBB = 0,
    decisions = [],
    failed = false,
  } = spec;
  const isFailed = failed || spec.view === null;
  const decisionViews = decisions.map(d => decision({ street: d.street, evLoss: d.evLoss, tag: d.tag }));
  const view = isFailed
    ? null
    : {
        schemaVersion: 1,
        recordId: id,
        heroSeat: 0,
        decisions: decisionViews,
        totalEvLoss: decisionViews.reduce((s, d) => s + d.evLoss, 0),
        worstEvLoss: decisionViews.length === 0 ? 0 : Math.max(...decisionViews.map(d => d.evLoss)),
        tags: [...new Set(decisionViews.map(d => d.tag).filter((t): t is MistakeTag => t !== null))],
      };
  return {
    id,
    timestamp,
    worstEvLoss: view?.worstEvLoss ?? 0,
    heroPosition: position,
    mistakeTags: view?.tags ?? [],
    disputed: false,
    // results 里只有 hero 那一行会被读到；其余字段本层用不上
    record: { id, heroSeat: 0, results: [{ seat: 0, netBB, showdown: true }] } as never,
    view,
  };
}

describe('summaryOf', () => {
  it('把一手的分街 evLoss 与分类累计抽出来', () => {
    const hand = handWith({
      position: 'BTN',
      netBB: 12.5,
      decisions: [
        { street: 'turn', evLoss: 2.3, tag: 'chasing_bad_odds' },
        { street: 'river', evLoss: 0, tag: null },
      ],
    });
    const s = summaryOf(hand);
    expect(s.id).toBe(hand.id);
    expect(s.timestamp).toBe(hand.timestamp);
    expect(s.netBB).toBe(12.5);
    expect(s.position).toBe('BTN');
    expect(s.byStreet).toEqual({ preflop: 0, flop: 0, turn: 2.3, river: 0 });
    expect(s.byTag).toEqual({ chasing_bad_odds: { count: 1, evLoss: 2.3 } });
  });

  it('同一分类在一手里出现两次会合并', () => {
    const s = summaryOf(handWith({
      decisions: [
        { street: 'flop', evLoss: 1.5, tag: 'chasing_bad_odds' },
        { street: 'turn', evLoss: 0.5, tag: 'chasing_bad_odds' },
      ],
    }));
    expect(s.byTag.chasing_bad_odds).toEqual({ count: 2, evLoss: 2 });
    expect(s.byStreet.flop).toBe(1.5);
    expect(s.byStreet.turn).toBe(0.5);
  });

  it('view 为 null（分析失败）仍产出摘要：手数与盈亏要进分母', () => {
    const s = summaryOf(handWith({ view: null, netBB: -8 }));
    expect(s.netBB).toBe(-8);
    expect(s.byTag).toEqual({});
    expect(s.byStreet).toEqual({ preflop: 0, flop: 0, turn: 0, river: 0 });
  });

  it('byTag 只含出现过的分类，不填满 15 项', () => {
    const s = summaryOf(handWith({ decisions: [{ street: 'preflop', evLoss: 1, tag: 'preflop_open_too_wide' }] }));
    expect(Object.keys(s.byTag)).toEqual(['preflop_open_too_wide']);
  });

  it('产出的摘要带 schema 版本号，供后续任务判断是否需要重建', () => {
    const s = summaryOf(handWith({}));
    expect(s.v).toBe(SUMMARY_SCHEMA_VERSION);
  });
});

describe('aggregate', () => {
  it('空窗口给出零值而不是 NaN', () => {
    const w = aggregate([]);
    expect(w.hands).toBe(0);
    expect(w.netBB).toBe(0);
    expect(w.netSeries).toEqual([]);
    expect(w.byStreet).toEqual({ preflop: 0, flop: 0, turn: 0, river: 0 });
    expect(w.byPosition.BTN).toEqual({ hands: 0, netBB: 0 });
  });

  it('byTag 骨架是满的，没出现过的分类为零而不是 undefined', () => {
    const w = aggregate([summaryOf(handWith({ decisions: [{ street: 'flop', evLoss: 1, tag: 'chasing_bad_odds' }] }))]);
    expect(w.byTag.chasing_bad_odds).toEqual({ count: 1, evLoss: 1 });
    expect(w.byTag.preflop_open_too_wide).toEqual({ count: 0, evLoss: 0 });
  });

  it('多手累加：手数、净盈亏、分街、分位置', () => {
    const rows = [
      summaryOf(handWith({ position: 'BTN', netBB: 10, decisions: [{ street: 'turn', evLoss: 2, tag: 'chasing_bad_odds' }] })),
      summaryOf(handWith({ position: 'BTN', netBB: -4, decisions: [{ street: 'turn', evLoss: 1, tag: 'chasing_bad_odds' }] })),
      summaryOf(handWith({ position: 'SB', netBB: -6, decisions: [] })),
    ];
    const w = aggregate(rows);
    expect(w.hands).toBe(3);
    expect(w.netBB).toBe(0);
    expect(w.byStreet.turn).toBe(3);
    expect(w.byTag.chasing_bad_odds).toEqual({ count: 2, evLoss: 3 });
    expect(w.byPosition.BTN).toEqual({ hands: 2, netBB: 6 });
    expect(w.byPosition.SB).toEqual({ hands: 1, netBB: -6 });
  });

  it('netSeries 保持入参顺序，不排序不截断', () => {
    const rows = [10, -4, 7].map(n => summaryOf(handWith({ netBB: n })));
    expect(aggregate(rows).netSeries).toEqual([10, -4, 7]);
  });

  it('不修改入参', () => {
    const row = summaryOf(handWith({ decisions: [{ street: 'flop', evLoss: 1, tag: 'chasing_bad_odds' }] }));
    const snapshot = JSON.parse(JSON.stringify(row));
    aggregate([row]);
    expect(row).toEqual(snapshot);
  });
});

describe('一致性闸：增量与窗口聚合必须给出同一批数', () => {
  it('reduce(applyHand) ≡ aggregate(map(summaryOf))', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            position: fc.constantFrom<Position>('UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'),
            netBB: fc.integer({ min: -200, max: 200 }).map(n => n / 2),
            // 约三成的手分析失败，走 view === null 那条路径。
            // 用 fc.oneof 的加权形式而不是 Math.random()：后者不受 fast-check 的种子
            // 控制，属性测试失败时给出的种子没法重放出同一份失败输入，等于白记。
            // （这个版本的 fast-check 没有 fc.frequency，加权 oneof 是等价写法）
            failed: fc.oneof(
              { weight: 3, arbitrary: fc.constant(true) },
              { weight: 7, arbitrary: fc.constant(false) },
            ),
            decisions: fc.array(
              fc.record({
                street: fc.constantFrom<Street>('preflop', 'flop', 'turn', 'river'),
                evLoss: fc.integer({ min: 0, max: 100 }).map(n => n / 10),
                tag: fc.constantFrom<MistakeTag | null>(...PREFLOP_TAGS, ...POSTFLOP_TAGS, null),
              }),
              { maxLength: 6 },
            ),
          }),
          { maxLength: 40 },
        ),
        specs => {
          const hands = specs.map((s, i) => handWith({ ...s, id: `h${i}`, timestamp: 1000 + i }));

          let inc = emptyStats();
          for (const h of hands) inc = applyHand(inc, h);
          const win = aggregate(hands.map(summaryOf));

          expect(win.hands).toBe(inc.hands);
          expect(win.netBB).toBe(inc.netBB);
          expect(win.byTag).toEqual(inc.byTag);
          expect(win.byStreet).toEqual(inc.byStreet);
          expect(win.byPosition).toEqual(inc.byPosition);
          // netSeries 不比对：Stats.recentNet 上限 200，netSeries 没有上限，
          // 两者本来就不该相等，不是漏测了。
        },
      ),
      { numRuns: 200 },
    );
  });
});
