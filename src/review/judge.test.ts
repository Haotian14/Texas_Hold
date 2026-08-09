import { describe, it, expect } from 'vitest';
import type { EvResult, EvCandidate } from '../core/evEstimate';
import type { Action } from '../core/types';
import type { Situation } from '../core/situation';
import { parseCard } from '../core/cards';
import { matchCandidate, judgePreflopFrequency, tagFor } from './judge';
import type { PreflopNode } from './preflopNode';

function cand(
  label: string,
  actionType: EvCandidate['actionType'],
  investment: number,
  ev: number,
  extra: Partial<EvCandidate> = {},
): EvCandidate {
  return { label, actionType, investment, ev, isRecommended: false, ...extra };
}

function result(candidates: EvCandidate[], degraded: EvResult['degraded'] = null): EvResult {
  return {
    candidates,
    heroEquity: 0.5,
    requiredEquity: 0.33,
    recommended: candidates[0],
    iterations: 500,
    degraded,
    degradedOpponentCount: degraded ? 1 : 0,
  };
}

/** Action 的七个字段都是必填的；判定只读 type 与 amount，其余给合理占位值 */
function act(type: Action['type'], amount: number): Action {
  return { seat: 0, street: 'flop', type, amount, potBefore: 9, toCall: 0, stackBefore: 100 };
}

describe('matchCandidate', () => {
  it('按动作类型匹配', () => {
    const ev = result([cand('fold', 'fold', 0, 0), cand('call', 'call', 2, 1.5)]);
    expect(matchCandidate(ev, act('call', 2))!.actionType).toBe('call');
  });

  it('多个下注尺度时取投入最接近的', () => {
    const ev = result([
      cand('bet 1/3', 'bet', 3, 1),
      cand('bet 1/2', 'bet', 4.5, 2),
      cand('bet pot', 'bet', 9, 0.5),
    ]);
    expect(matchCandidate(ev, act('bet', 5))!.label).toBe('bet 1/2');
  });

  it('恰好落在两档中间时取其一，且不抛错', () => {
    // 3 与 4.5 的中点是 3.75，两档距离相等 —— 实现用严格小于比较，取先出现的那档
    const ev = result([cand('bet 1/3', 'bet', 3, 1), cand('bet 1/2', 'bet', 4.5, 2)]);
    expect(matchCandidate(ev, act('bet', 3.75))!.label).toBe('bet 1/3');
  });

  it('没有同类候选时返回 null', () => {
    const ev = result([cand('fold', 'fold', 0, 0)]);
    expect(matchCandidate(ev, act('bet', 5))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// judgePreflopFrequency —— 直接单测（brief 只写了 matchCandidate 的测试，
// 金标准场景任务还很远才会覆盖到这两个函数，先在本任务补上直接单测）
// ─────────────────────────────────────────────────────────────────────────

function preflopSit(overrides: Partial<Situation> = {}): Situation {
  return {
    heroSeat: 0,
    heroPosition: 'UTG',
    heroCards: [parseCard('As'), parseCard('Ah')],
    board: [],
    street: 'preflop',
    pot: 1.5,
    toCall: 0,
    heroStack: 100,
    heroStreetContribution: 0,
    opponents: [],
    heroIsPreflopAggressor: false,
    ...overrides,
  };
}

function preflopAct(type: Action['type'], amount: number, toCall = 0): Action {
  return { seat: 0, street: 'preflop', type, amount, potBefore: 1.5, toCall, stackBefore: 100 };
}

describe('judgePreflopFrequency', () => {
  it('手牌在该节点的频率达到 0.15 时判 ok（UTG 开池 AA 加注，频率 1）', () => {
    const node: PreflopNode = { key: 'UTG_rfi', kind: 'rfi', opener: null };
    const s = preflopSit({ heroCards: [parseCard('As'), parseCard('Ah')] });
    expect(judgePreflopFrequency(node, s, preflopAct('raise', 3))).toBe(true);
  });

  it('手牌在该节点的频率低于 0.15 时判不 ok（UTG 开池 72o 加注，频率 0，不在 raise 范围内）', () => {
    const node: PreflopNode = { key: 'UTG_rfi', kind: 'rfi', opener: null };
    const s = preflopSit({ heroCards: [parseCard('7c'), parseCard('2d')] });
    expect(judgePreflopFrequency(node, s, preflopAct('raise', 3))).toBe(false);
  });

  it('node 为 null（4bet 之后等范围表未覆盖的节点）时判不 ok', () => {
    const s = preflopSit();
    expect(judgePreflopFrequency(null, s, preflopAct('fold', 0))).toBe(false);
  });

  it('vs-3bet 节点下用户 raise 正确映射到表里的 4bet 频率（AKs 在 UTG_vs_BB_3bet 的 4bet 范围内）', () => {
    const node: PreflopNode = { key: 'UTG_vs_BB_3bet', kind: 'vs-3bet', opener: 'BB' };
    const s = preflopSit({ heroCards: [parseCard('As'), parseCard('Ks')], toCall: 9 });
    expect(judgePreflopFrequency(node, s, preflopAct('raise', 30, 9))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// tagFor —— 直接单测，构造合成的 Situation / EvResult / Action，不走重放。
// 覆盖 taxonomy.ts 里全部 15 个 tag，以及两个方向的 null（翻前"合法、归不进
// 任何一类"与翻后"该继续却弃了，翻后没有对应 tag"），外加下注尺度打平手时
// 不误判的边界情况。
// ─────────────────────────────────────────────────────────────────────────

function sit(overrides: Partial<Situation> = {}): Situation {
  return {
    heroSeat: 0,
    heroPosition: 'BTN',
    heroCards: [parseCard('Ah'), parseCard('Kd')],
    board: [],
    street: 'flop',
    pot: 10,
    toCall: 0,
    heroStack: 100,
    heroStreetContribution: 0,
    opponents: [],
    heroIsPreflopAggressor: false,
    ...overrides,
  };
}

function tagAct(
  type: Action['type'],
  amount: number,
  overrides: Partial<Action> = {},
): Action {
  return { seat: 0, street: 'flop', type, amount, potBefore: 10, toCall: 0, stackBefore: 100, ...overrides };
}

function evFor(recommended: EvCandidate, others: EvCandidate[] = []): EvResult {
  return {
    candidates: [recommended, ...others],
    heroEquity: 0.5,
    requiredEquity: 0.33,
    recommended,
    iterations: 500,
    degraded: null,
    degradedOpponentCount: 0,
  };
}

describe('tagFor —— 翻前', () => {
  it('弃牌而推荐继续（call）→ preflop_fold_too_tight', () => {
    const s = sit({ street: 'preflop', toCall: 3 });
    const actual = tagAct('fold', 0, { street: 'preflop', toCall: 3 });
    const rec = cand('call', 'call', 3, 1);
    expect(tagFor(s, actual, null, evFor(rec))).toBe('preflop_fold_too_tight');
  });

  it('跟注而推荐加注 → preflop_missed_3bet', () => {
    const s = sit({ street: 'preflop', toCall: 3 });
    const actual = tagAct('call', 3, { street: 'preflop', toCall: 3 });
    const rec = cand('raise', 'raise', 9, 2);
    expect(tagFor(s, actual, null, evFor(rec))).toBe('preflop_missed_3bet');
  });

  it('跟注而推荐弃牌 → preflop_cold_call_too_wide', () => {
    const s = sit({ street: 'preflop', toCall: 3 });
    const actual = tagAct('call', 3, { street: 'preflop', toCall: 3 });
    const rec = cand('fold', 'fold', 0, 0);
    expect(tagFor(s, actual, null, evFor(rec))).toBe('preflop_cold_call_too_wide');
  });

  it('SB 无人加注时跟注（跛入）→ preflop_sb_limp', () => {
    const s = sit({ street: 'preflop', heroPosition: 'SB', toCall: 0 });
    const actual = tagAct('call', 0.5, { street: 'preflop', toCall: 0 });
    const rec = cand('call', 'call', 0.5, 0.1); // 不是 raise 也不是 fold，才能落到 sb_limp 分支
    expect(tagFor(s, actual, null, evFor(rec))).toBe('preflop_sb_limp');
  });

  it('面对下注时加注而推荐弃牌 → preflop_over_aggressive', () => {
    const s = sit({ street: 'preflop', toCall: 3 });
    const actual = tagAct('raise', 9, { street: 'preflop', toCall: 3 });
    const rec = cand('fold', 'fold', 0, 0);
    expect(tagFor(s, actual, null, evFor(rec))).toBe('preflop_over_aggressive');
  });

  it('无人加注时开池而推荐弃牌 → preflop_open_too_wide', () => {
    const s = sit({ street: 'preflop', toCall: 0 });
    const actual = tagAct('raise', 3, { street: 'preflop', toCall: 0 });
    const rec = cand('fold', 'fold', 0, 0);
    expect(tagFor(s, actual, null, evFor(rec))).toBe('preflop_open_too_wide');
  });

  it('加注且推荐动作也是加注（无失误）→ null（翻前合法但归不进任何一类）', () => {
    const s = sit({ street: 'preflop', toCall: 3 });
    const actual = tagAct('raise', 9, { street: 'preflop', toCall: 3 });
    const rec = cand('raise', 'raise', 9, 2);
    // 前置条件：确认这确实不会先命中 fold_too_tight / missed_3bet 等分支
    expect(actual.type).toBe('raise');
    expect(rec.actionType).toBe('raise');
    expect(tagFor(s, actual, null, evFor(rec))).toBeNull();
  });
});

describe('tagFor —— 翻后', () => {
  it('弃牌而推荐继续（call）→ null（翻后没有"弃得太紧"这一类标签）', () => {
    const s = sit({ street: 'flop', toCall: 5, pot: 10 });
    const actual = tagAct('fold', 0, { toCall: 5, potBefore: 10 });
    const rec = cand('call', 'call', 5, 1);
    expect(tagFor(s, actual, null, evFor(rec))).toBeNull();
  });

  it('加注而推荐弃牌 → should_have_folded', () => {
    const s = sit({ street: 'flop', toCall: 5, pot: 10 });
    const actual = tagAct('raise', 15, { toCall: 5, potBefore: 10 });
    const rec = cand('fold', 'fold', 0, 0);
    expect(tagFor(s, actual, null, evFor(rec))).toBe('should_have_folded');
  });

  it('跟注而推荐弃牌、面对的是大注（toCall > 底池一半）→ call_too_light_vs_raise', () => {
    const s = sit({ street: 'flop', toCall: 8, pot: 10 });
    const actual = tagAct('call', 8, { toCall: 8, potBefore: 10 });
    const rec = cand('fold', 'fold', 0, 0);
    // 前置条件：确认这确实是"面对大注"的场景
    expect(s.toCall).toBeGreaterThan(s.pot * 0.5);
    expect(tagFor(s, actual, null, evFor(rec))).toBe('call_too_light_vs_raise');
  });

  it('跟注而推荐弃牌、面对的是小注（toCall ≤ 底池一半）→ chasing_bad_odds', () => {
    const s = sit({ street: 'flop', toCall: 2, pot: 10 });
    const actual = tagAct('call', 2, { toCall: 2, potBefore: 10 });
    const rec = cand('fold', 'fold', 0, 0);
    expect(s.toCall).toBeLessThanOrEqual(s.pot * 0.5);
    expect(tagFor(s, actual, null, evFor(rec))).toBe('chasing_bad_odds');
  });

  it('翻牌是翻前攻击者、过牌而推荐下注 → missed_cbet', () => {
    const s = sit({ street: 'flop', toCall: 0, pot: 10, heroIsPreflopAggressor: true });
    const actual = tagAct('check', 0, { toCall: 0, potBefore: 10 });
    const rec = cand('bet 1/2', 'bet', 5, 2);
    expect(tagFor(s, actual, null, evFor(rec))).toBe('missed_cbet');
  });

  it('转牌过牌而推荐下注（非翻牌，不适用 missed_cbet）→ missed_value_bet', () => {
    const s = sit({ street: 'turn', toCall: 0, pot: 10, heroIsPreflopAggressor: true });
    const actual = tagAct('check', 0, { street: 'turn', toCall: 0, potBefore: 10 });
    const rec = cand('bet 1/2', 'bet', 5, 2);
    expect(tagFor(s, actual, null, evFor(rec))).toBe('missed_value_bet');
  });

  it('翻牌是攻击者但动作是跟注而非过牌、推荐加注 → missed_value_bet（不是 missed_cbet）', () => {
    const s = sit({ street: 'flop', toCall: 2, pot: 10, heroIsPreflopAggressor: true });
    const actual = tagAct('call', 2, { toCall: 2, potBefore: 10 });
    const rec = cand('raise', 'raise', 8, 3);
    expect(tagFor(s, actual, null, evFor(rec))).toBe('missed_value_bet');
  });

  it('下注而推荐弃牌 → over_bluffing', () => {
    const s = sit({ street: 'flop', toCall: 0, pot: 10 });
    const actual = tagAct('bet', 5, { toCall: 0, potBefore: 10 });
    const rec = cand('fold', 'fold', 0, 0);
    expect(tagFor(s, actual, null, evFor(rec))).toBe('over_bluffing');
  });

  it('下注而推荐过牌、推荐候选弃牌率不足 0.2 → ineffective_bluff', () => {
    const s = sit({ street: 'flop', toCall: 0, pot: 10 });
    const actual = tagAct('bet', 5, { toCall: 0, potBefore: 10 });
    const rec = cand('check', 'check', 0, 1, { foldEquity: 0.1 });
    expect(tagFor(s, actual, null, evFor(rec))).toBe('ineffective_bluff');
  });

  it('下注而推荐过牌、弃牌率信息缺失（未知，不能当作"弃牌率不足"）→ over_bluffing', () => {
    const s = sit({ street: 'flop', toCall: 0, pot: 10 });
    const actual = tagAct('bet', 5, { toCall: 0, potBefore: 10 });
    const rec = cand('check', 'check', 0, 1);
    expect(rec.foldEquity).toBeUndefined();
    expect(tagFor(s, actual, null, evFor(rec))).toBe('over_bluffing');
  });

  it('双方都下注/加注、推荐尺度比实际大 → bet_size_too_small', () => {
    const s = sit({ street: 'flop', toCall: 0, pot: 9 });
    const actual = tagAct('bet', 3, { toCall: 0, potBefore: 9 });
    const actualCand = cand('bet 1/3', 'bet', 3, 1);
    const rec = cand('bet pot', 'bet', 9, 5);
    expect(tagFor(s, actual, actualCand, evFor(rec, [actualCand]))).toBe('bet_size_too_small');
  });

  it('双方都下注/加注、推荐尺度比实际小 → bet_size_too_large', () => {
    const s = sit({ street: 'flop', toCall: 0, pot: 9 });
    const actual = tagAct('bet', 9, { toCall: 0, potBefore: 9 });
    const actualCand = cand('bet pot', 'bet', 9, 1);
    const rec = cand('bet 1/3', 'bet', 3, 5);
    expect(tagFor(s, actual, actualCand, evFor(rec, [actualCand]))).toBe('bet_size_too_large');
  });

  it('双方都下注/加注、投入恰好相等（打平手）→ null，不误判尺度过大或过小', () => {
    const s = sit({ street: 'flop', toCall: 0, pot: 9 });
    const actual = tagAct('bet', 4.5, { toCall: 0, potBefore: 9 });
    const actualCand = cand('bet 1/2', 'bet', 4.5, 2);
    const rec = cand('bet 1/2', 'bet', 4.5, 2);
    // 前置条件：确认两者投入确实相等
    expect(actualCand.investment).toBe(rec.investment);
    expect(tagFor(s, actual, actualCand, evFor(rec, [actualCand]))).toBeNull();
  });
});
