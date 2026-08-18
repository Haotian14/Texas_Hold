import { describe, it, expect } from 'vitest';
import {
  emptyStats,
  applyHand,
  bb100,
  trend,
  leaks,
  heroNetOf,
  RECENT_WINDOW,
  STATS_SCHEMA_VERSION,
} from './stats';
import type { Stats } from './stats';
import type { StoredHand } from './schema';
import { PREFLOP_TAGS, POSTFLOP_TAGS } from '../review/taxonomy';
import type { MistakeTag } from '../review/taxonomy';
import type { Position, Street } from '../core/types';
import type { DecisionView } from '../review/view';

/**
 * 合成输入。这一层是纯算术，用真实牌局反而测不准边界——
 * 真实分析路径由 review/ 那边覆盖。
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

interface HandSpec {
  id: string;
  net: number;
  position?: Position;
  decisions?: DecisionView[];
  /** true = 分析失败（view 为 null） */
  failed?: boolean;
}

function hand({ id, net, position = 'BTN', decisions = [], failed = false }: HandSpec): StoredHand {
  const view = failed
    ? null
    : {
        schemaVersion: 1,
        recordId: id,
        heroSeat: 0,
        decisions,
        totalEvLoss: decisions.reduce((s, d) => s + d.evLoss, 0),
        worstEvLoss: decisions.length === 0 ? 0 : Math.max(...decisions.map(d => d.evLoss)),
        tags: [...new Set(decisions.map(d => d.tag).filter((t): t is MistakeTag => t !== null))],
      };
  return {
    id,
    timestamp: 0,
    worstEvLoss: view?.worstEvLoss ?? 0,
    heroPosition: position,
    mistakeTags: view?.tags ?? [],
    disputed: false,
    // results 里只有 hero 那一行会被读到；其余字段本层用不上
    record: { id, heroSeat: 0, results: [{ seat: 0, netBB: net, showdown: true }] } as never,
    view,
  };
}

function applyAll(specs: HandSpec[]): Stats {
  return specs.reduce((s, spec) => applyHand(s, hand(spec)), emptyStats());
}

describe('emptyStats', () => {
  it('每个 MistakeTag 都有一格，没有一个漏成 undefined', () => {
    const s = emptyStats();
    const all = [...PREFLOP_TAGS, ...POSTFLOP_TAGS];
    for (const tag of all) {
      expect(s.byTag[tag], tag).toEqual({ count: 0, evLoss: 0 });
    }
    expect(Object.keys(s.byTag).sort()).toEqual([...all].sort());
  });

  it('四条街与六个位置都有一格', () => {
    const s = emptyStats();
    expect(Object.keys(s.byStreet).sort()).toEqual(['flop', 'preflop', 'river', 'turn']);
    expect(Object.keys(s.byPosition).sort()).toEqual(['BB', 'BTN', 'CO', 'HJ', 'SB', 'UTG']);
  });

  it('起始是零，带 schemaVersion', () => {
    const s = emptyStats();
    expect(s.hands).toBe(0);
    expect(s.netBB).toBe(0);
    expect(s.recentNet).toEqual([]);
    expect(s.lastHandId).toBeNull();
    expect(s.schemaVersion).toBe(STATS_SCHEMA_VERSION);
  });
});

describe('applyHand —— 基本累加', () => {
  it('手数与净盈亏累加', () => {
    const s = applyAll([
      { id: 'a', net: 12 },
      { id: 'b', net: -5 },
      { id: 'c', net: 3.5 },
    ]);
    expect(s.hands).toBe(3);
    expect(s.netBB).toBe(10.5);
  });

  it('不修改入参', () => {
    const before = emptyStats();
    const snapshot = JSON.parse(JSON.stringify(before));
    applyHand(before, hand({ id: 'a', net: 9, decisions: [decision({ tag: 'preflop_sb_limp', evLoss: 1 })] }));
    expect(before).toEqual(snapshot);
  });

  it('分位置记手数与盈亏，只动 hero 当手的那个位置', () => {
    const s = applyAll([
      { id: 'a', net: 10, position: 'BTN' },
      { id: 'b', net: -4, position: 'BTN' },
      { id: 'c', net: 2, position: 'SB' },
    ]);
    expect(s.byPosition.BTN).toEqual({ hands: 2, netBB: 6 });
    expect(s.byPosition.SB).toEqual({ hands: 1, netBB: 2 });
    expect(s.byPosition.UTG).toEqual({ hands: 0, netBB: 0 });
  });

  it('分街累计 evLoss', () => {
    const s = applyAll([
      {
        id: 'a',
        net: 0,
        decisions: [
          decision({ street: 'preflop', evLoss: 1.2 }),
          decision({ street: 'turn', evLoss: 0.8 }),
          decision({ street: 'turn', evLoss: 0.5 }),
        ],
      },
    ]);
    expect(s.byStreet.preflop).toBe(1.2);
    expect(s.byStreet.turn).toBe(1.3);
    expect(s.byStreet.flop).toBe(0);
    expect(s.byStreet.river).toBe(0);
  });

  it('分类记次数与累计损失，没打错的决策点不计入任何分类', () => {
    const s = applyAll([
      {
        id: 'a',
        net: 0,
        decisions: [
          decision({ tag: 'preflop_sb_limp', evLoss: 1.5 }),
          decision({ tag: 'preflop_sb_limp', evLoss: 0.5 }),
          decision({ tag: 'chasing_bad_odds', evLoss: 2 }),
          decision({ tag: null, evLoss: 0 }),
        ],
      },
    ]);
    expect(s.byTag.preflop_sb_limp).toEqual({ count: 2, evLoss: 2 });
    expect(s.byTag.chasing_bad_odds).toEqual({ count: 1, evLoss: 2 });
    expect(s.byTag.missed_cbet).toEqual({ count: 0, evLoss: 0 });
  });
});

describe('applyHand —— 防重复计入', () => {
  it('同一手连着来两次，第二次原样返回同一个引用', () => {
    const s0 = emptyStats();
    const h = hand({ id: 'dup', net: 10, decisions: [decision({ tag: 'preflop_sb_limp', evLoss: 1 })] });
    const s1 = applyHand(s0, h);
    const s2 = applyHand(s1, h);
    // 引用相等：调用方能立刻看出"这次没有变化"
    expect(s2).toBe(s1);
    expect(s2.hands).toBe(1);
    expect(s2.netBB).toBe(10);
    expect(s2.byTag.preflop_sb_limp.count).toBe(1);
  });

  it('不同的手照常计入，lastHandId 跟着走', () => {
    const s = applyAll([{ id: 'a', net: 1 }, { id: 'b', net: 2 }]);
    expect(s.hands).toBe(2);
    expect(s.lastHandId).toBe('b');
  });

  it('隔一手之后重复的那种，挡不住 —— 这是已知边界，钉下来', () => {
    // 见 Stats.lastHandId 的注释：只挡连续重复。这条测试不是在赞美这个行为，
    // 是在防止有人以为它挡得住而去写「批量重跑历史」那类会乱序重放的功能。
    const s = applyAll([{ id: 'a', net: 1 }, { id: 'b', net: 2 }, { id: 'a', net: 1 }]);
    expect(s.hands).toBe(3);
  });
});

describe('applyHand —— 分析失败的那一手', () => {
  it('仍计手数与盈亏，但不产生任何失误归类', () => {
    const s = applyAll([{ id: 'a', net: -7, failed: true }]);
    expect(s.hands).toBe(1);
    expect(s.netBB).toBe(-7);
    expect(s.recentNet).toEqual([-7]);
    for (const tag of [...PREFLOP_TAGS, ...POSTFLOP_TAGS]) {
      expect(s.byTag[tag].count, tag).toBe(0);
    }
    for (const street of ['preflop', 'flop', 'turn', 'river'] as Street[]) {
      expect(s.byStreet[street], street).toBe(0);
    }
  });
});

describe('滚动窗口', () => {
  it('新的在末尾，超出上限从头掉出去', () => {
    const specs = Array.from({ length: RECENT_WINDOW + 30 }, (_, i) => ({
      id: `h${i}`,
      net: i,
    }));
    const s = applyAll(specs);
    expect(s.recentNet).toHaveLength(RECENT_WINDOW);
    expect(s.recentNet[s.recentNet.length - 1]).toBe(RECENT_WINDOW + 29);
    expect(s.recentNet[0]).toBe(30);
  });

  it('窗口是 200 而不是 100 —— §10.5 的趋势要拿"之前那 100 手"', () => {
    expect(RECENT_WINDOW).toBe(200);
  });
});

describe('bb100', () => {
  it('每百手的 BB', () => {
    expect(bb100(100, 450)).toBe(450);
    expect(bb100(200, 450)).toBe(225);
    expect(bb100(37, -18.5)).toBe(-50);
  });

  it('零手返回 0 而不是 NaN', () => {
    expect(bb100(0, 0)).toBe(0);
    expect(Number.isNaN(bb100(0, 12))).toBe(false);
  });
});

describe('trend', () => {
  it('两段都够时各算一个 BB/100', () => {
    // 前 3 手共 -3，后 3 手共 +6
    const t = trend([-1, -1, -1, 2, 2, 2], 3);
    expect(t.previous).toBe(-100);
    expect(t.current).toBe(200);
  });

  it('样本不足的那一段返回 null，不拿几手硬算', () => {
    // [1,2,3] 三手共 6 BB → 6/3*100 = 200
    expect(trend([1, 2, 3], 3)).toEqual({ current: 200, previous: null });
    expect(trend([1, 2], 3)).toEqual({ current: null, previous: null });
  });
});

describe('leaks', () => {
  it('按累计 evLoss 倒序，不是按次数', () => {
    const s = applyAll([
      {
        id: 'a',
        net: 0,
        decisions: [
          // 30 次小偏差，共 6 BB
          ...Array.from({ length: 30 }, () => decision({ tag: 'preflop_sb_limp', evLoss: 0.2 })),
          // 3 次大错，共 9 BB
          ...Array.from({ length: 3 }, () => decision({ tag: 'should_have_folded', evLoss: 3 })),
        ],
      },
    ]);
    const rows = leaks(s.byTag);
    expect(rows[0].tag).toBe('should_have_folded');
    expect(rows[0].count).toBe(3);
    expect(rows[1].tag).toBe('preflop_sb_limp');
    expect(rows[1].count).toBe(30);
  });

  it('没犯过的分类不上榜', () => {
    const s = applyAll([
      { id: 'a', net: 0, decisions: [decision({ tag: 'missed_cbet', evLoss: 1 })] },
    ]);
    expect(leaks(s.byTag).map(r => r.tag)).toEqual(['missed_cbet']);
  });

  it('空统计给空榜', () => {
    expect(leaks(emptyStats().byTag)).toEqual([]);
  });
});

describe('heroNetOf', () => {
  it('取的是 hero 那一行', () => {
    expect(heroNetOf(hand({ id: 'a', net: -13.5 }))).toBe(-13.5);
  });
});

describe('序列化', () => {
  it('Stats 整体 JSON 往返无损 —— 它是要落库的', () => {
    const s = applyAll([
      { id: 'a', net: 3, position: 'CO', decisions: [decision({ tag: 'missed_cbet', evLoss: 1.25 })] },
      { id: 'b', net: -8, position: 'BB', failed: true },
    ]);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
