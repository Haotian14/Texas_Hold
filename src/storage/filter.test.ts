import { describe, it, expect } from 'vitest';
import { matchesFilter, isFilterEmpty } from './filter';
import type { HandFilter } from './filter';
import type { StoredHand } from './schema';
import type { DecisionView } from '../review/view';
import type { MistakeTag } from '../review/taxonomy';
import type { Position, Street } from '../core/types';

function decision(street: Street, tag: MistakeTag | null): DecisionView {
  return {
    actionIndex: 0,
    street,
    pot: 1.5,
    toCall: 1,
    actual: {
      seat: 0,
      street,
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
    evLoss: tag === null ? 0 : 1,
    severity: tag === null ? 'ok' : 'notable',
    tag,
    explanation: '',
    degraded: false,
  };
}

function hand(over: {
  position?: Position;
  decisions?: DecisionView[];
  disputed?: boolean;
  failed?: boolean;
}): StoredHand {
  const decisions = over.decisions ?? [];
  const tags = [...new Set(decisions.map(d => d.tag).filter((t): t is MistakeTag => t !== null))];
  const view = over.failed
    ? null
    : {
        schemaVersion: 1,
        recordId: 'x',
        heroSeat: 0,
        decisions,
        totalEvLoss: 0,
        worstEvLoss: 0,
        tags,
      };
  return {
    id: 'x',
    timestamp: 0,
    worstEvLoss: 0,
    heroPosition: over.position ?? 'BTN',
    mistakeTags: view === null ? [] : tags,
    disputed: over.disputed ?? false,
    record: {} as never,
    view,
  };
}

describe('isFilterEmpty', () => {
  it('空对象、全 null、全 undefined 都算不筛', () => {
    expect(isFilterEmpty({})).toBe(true);
    expect(isFilterEmpty({ position: null, tag: null, street: null, disputed: null })).toBe(true);
    expect(isFilterEmpty({ position: undefined })).toBe(true);
  });

  it('任意一项有值就不算空', () => {
    expect(isFilterEmpty({ position: 'SB' })).toBe(false);
    expect(isFilterEmpty({ tag: 'missed_cbet' })).toBe(false);
    expect(isFilterEmpty({ street: 'turn' })).toBe(false);
    expect(isFilterEmpty({ disputed: true })).toBe(false);
  });

  it('disputed: false 是"只看没标记的"，算在筛', () => {
    expect(isFilterEmpty({ disputed: false })).toBe(false);
  });
});

describe('matchesFilter —— 单项', () => {
  const h = hand({
    position: 'CO',
    decisions: [decision('preflop', 'preflop_open_too_wide'), decision('turn', null)],
    disputed: false,
  });

  it('空筛选放行一切', () => {
    expect(matchesFilter(h, {})).toBe(true);
  });

  it('按位置', () => {
    expect(matchesFilter(h, { position: 'CO' })).toBe(true);
    expect(matchesFilter(h, { position: 'BTN' })).toBe(false);
  });

  it('按分类', () => {
    expect(matchesFilter(h, { tag: 'preflop_open_too_wide' })).toBe(true);
    expect(matchesFilter(h, { tag: 'missed_cbet' })).toBe(false);
  });

  it('按 disputed 是三态：true 只留标记过的，false 只留没标记的，不给才是不筛', () => {
    const marked = { ...h, disputed: true };
    expect(matchesFilter(h, { disputed: true })).toBe(false);
    expect(matchesFilter(marked, { disputed: true })).toBe(true);
    expect(matchesFilter(h, { disputed: false })).toBe(true);
    expect(matchesFilter(marked, { disputed: false })).toBe(false);
    expect(matchesFilter(h, {})).toBe(true);
    expect(matchesFilter(marked, {})).toBe(true);
  });
});

describe('matchesFilter —— 街道的语义', () => {
  it('筛的是"这条街上有失误"，不是"打到了这条街"', () => {
    // 这一手打到了转牌，但只有翻前那一步是错的
    const h = hand({
      decisions: [decision('preflop', 'preflop_open_too_wide'), decision('turn', null)],
    });
    expect(matchesFilter(h, { street: 'preflop' })).toBe(true);
    // 转牌那一步没打错 —— 按"打到了这条街"筛的话这里会是 true，
    // 而那样筛几乎去不掉任何东西（绝大多数手都打过翻前）
    expect(matchesFilter(h, { street: 'turn' })).toBe(false);
    expect(matchesFilter(h, { street: 'river' })).toBe(false);
  });

  it('同一条街上多个决策点，只要有一个错就命中', () => {
    const h = hand({
      decisions: [decision('flop', null), decision('flop', 'missed_cbet')],
    });
    expect(matchesFilter(h, { street: 'flop' })).toBe(true);
  });
});

describe('matchesFilter —— 分析失败的那些手', () => {
  const failed = hand({ position: 'SB', failed: true, disputed: true });

  it('位置与 disputed 照样能筛到它 —— 这两项不依赖分析', () => {
    expect(matchesFilter(failed, { position: 'SB' })).toBe(true);
    expect(matchesFilter(failed, { disputed: true })).toBe(true);
  });

  it('任何街道筛选都筛不到它 —— 我们并不知道它在哪条街上错了', () => {
    for (const street of ['preflop', 'flop', 'turn', 'river'] as Street[]) {
      expect(matchesFilter(failed, { street }), street).toBe(false);
    }
  });

  it('任何分类筛选也筛不到它 —— 它没有分类', () => {
    expect(matchesFilter(failed, { tag: 'missed_cbet' })).toBe(false);
  });

  it('但不加筛选时它必须出现 —— 否则用户永远看不到自己分析失败的手', () => {
    expect(matchesFilter(failed, {})).toBe(true);
  });
});

describe('matchesFilter —— 多项组合', () => {
  const h = hand({
    position: 'BB',
    decisions: [decision('flop', 'missed_cbet'), decision('river', 'should_have_folded')],
    disputed: true,
  });

  it('全部命中才算命中', () => {
    const all: HandFilter = {
      position: 'BB',
      tag: 'missed_cbet',
      street: 'river',
      disputed: true,
    };
    expect(matchesFilter(h, all)).toBe(true);
  });

  it('任意一项不中就整体不中', () => {
    expect(matchesFilter(h, { position: 'BB', tag: 'chasing_bad_odds' })).toBe(false);
    expect(matchesFilter(h, { position: 'SB', tag: 'missed_cbet' })).toBe(false);
    expect(matchesFilter(h, { street: 'turn', disputed: true })).toBe(false);
  });

  it('分类与街道各自独立判断 —— 不要求那个分类恰好出现在那条街上', () => {
    // missed_cbet 在翻牌，should_have_folded 在河牌。两项都给，仍然命中。
    // 这是有意的：用户筛"河牌 + missed_cbet"想问的是"这两件事我都犯过的手"，
    // 不是"我在河牌漏过 c-bet"（后者本身就不成立，c-bet 是翻牌的概念）。
    expect(matchesFilter(h, { tag: 'missed_cbet', street: 'river' })).toBe(true);
  });
});
