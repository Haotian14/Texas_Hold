import { describe, it, expect } from 'vitest';
import type { EvResult, EvCandidate } from '../core/evEstimate';
import type { Action } from '../core/types';
import type { Situation } from '../core/situation';
import { parseCard } from '../core/cards';
import { matchCandidate, judgePreflopFrequency, tagFor } from './judge';
import type { PreflopNode } from '../core/preflopNode';
import { VALUE_BET_EQUITY_FLOOR } from './taxonomy';

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

  // ───────────────────────────────────────────────────────────────────────
  // 缺陷复现与修复回归：estimateEv 给自愿全下的候选定的 actionType 是
  // 'raise' 或 'bet'（取决于 toCall 是否 > 0，见 evEstimate.ts makeBetCandidate），
  // 从不是 'allin'；只有 sit.heroStack <= sit.toCall 的强制短筹码分支
  // （玩家没有加注权，被迫跟出仅剩筹码）才会产出 actionType==='allin' 的候选，
  // 语义是"跟注"不是"加注"。用户实际选择 legalActions 里的 'allin' 类型
  // （自愿把加注封顶到全部筹码，见 gameEngine.ts legalActions：只要有加注权，
  // 'raise'/'bet' 与 'allin' 同时合法）时，旧实现按字符串精确匹配会找不到
  // 候选，返回 null，analyzeHand 的短路规则把这判成"没有失误"——100 BB 的
  // 自愿全下被静默放过。
  // ───────────────────────────────────────────────────────────────────────

  it('用户 allin，候选是 raise 类型、标签为 all-in（面对加注时自愿全下）→ 匹配上该候选', () => {
    const ev = result([
      cand('fold', 'fold', 0, 0),
      cand('call', 'call', 5, 1),
      cand('bet 1/2', 'raise', 8, 2),
      cand('all-in', 'raise', 100, 3),
    ]);
    const matched = matchCandidate(ev, act('allin', 100));
    expect(matched).not.toBeNull();
    expect(matched!.label).toBe('all-in');
    expect(matched!.actionType).toBe('raise');
  });

  it('用户 allin，候选是 bet 类型、标签为 all-in（未加注池自愿全下）→ 匹配上该候选', () => {
    const ev = result([
      cand('check', 'check', 0, 0),
      cand('bet 1/2', 'bet', 5, 1),
      cand('all-in', 'bet', 100, 3),
    ]);
    const matched = matchCandidate(ev, act('allin', 100));
    expect(matched).not.toBeNull();
    expect(matched!.label).toBe('all-in');
    expect(matched!.actionType).toBe('bet');
  });

  it('用户 call 面对全下，候选里只有强制短筹码的 call-for-less（actionType 为 allin）→ 仍匹配上该候选', () => {
    // estimateEv 的强制短筹码分支（heroStack <= toCall）只产出这一个候选，
    // actionType 硬编码为 'allin' 但语义是"跟注"——用户实际动作类型仍是
    // 'call'（legalActions 在这个分支下也只给 'allin' 一个选项，但这里直接
    // 测 matchCandidate 本身的行为，不依赖引擎怎么记录）。
    const ev = result([
      cand('fold', 'fold', 0, 0),
      cand('call all-in', 'allin', 8, 1.5),
    ]);
    const matched = matchCandidate(ev, act('call', 8));
    expect(matched).not.toBeNull();
    expect(matched!.actionType).toBe('allin');
    expect(matched!.label).toBe('call all-in');
  });

  it('用户 allin 不会被误配到 call 候选（即便候选集里同时有 call 和一个进攻候选）', () => {
    // 防止把 call↔allin 的兼容做成对称：一次真正的自愿加注全下不能被错配成
    // "跟注"，那会把进攻动作的 EV 算成跟注的 EV——比原缺陷更隐蔽的错误答案。
    const ev = result([
      cand('call', 'call', 5, 1),
      cand('all-in', 'raise', 100, 3),
    ]);
    const matched = matchCandidate(ev, act('allin', 100));
    expect(matched).not.toBeNull();
    expect(matched!.actionType).toBe('raise');
    expect(matched!.label).toBe('all-in');
  });

  it('多个进攻候选（bet/raise/allin 类型混合）时，就近取投入额最接近的一档', () => {
    const ev = result([
      cand('bet 1/3', 'bet', 3, 1),
      cand('bet 1/2', 'bet', 4.5, 2),
      cand('all-in', 'raise', 100, 3),
    ]);
    expect(matchCandidate(ev, act('allin', 96))!.label).toBe('all-in');
    expect(matchCandidate(ev, act('allin', 3.6))!.label).toBe('bet 1/3');
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

function evFor(recommended: EvCandidate, others: EvCandidate[] = [], heroEquity = 0.5): EvResult {
  return {
    candidates: [recommended, ...others],
    heroEquity,
    requiredEquity: 0.33,
    recommended,
    iterations: 500,
    degraded: null,
    degradedOpponentCount: 0,
  };
}

// 下面这些 PreflopNode 值不是随手编的，是 preflopNodeFor（src/review/preflopNode.ts）
// 对真实局面会返回的那一种：node.kind 决定 tagFor 里的 isOpen，toCall 则取引擎
// 在对应节点上会产出的真实数字（1 BB = UTG 面对大盲开池的 toCall；0.5 BB = SB
// 补齐大盲的 toCall；3 BB = 面对一次开池到 3 的 toCall）。
const RFI_NODE: PreflopNode = { key: 'UTG_rfi', kind: 'rfi', opener: null };
const SB_RFI_NODE: PreflopNode = { key: 'SB_rfi', kind: 'rfi', opener: null };
const VS_OPEN_NODE: PreflopNode = { key: 'BTN_vs_UTG_open', kind: 'vs-open', opener: 'UTG' };

describe('tagFor —— 翻前', () => {
  it('弃牌而推荐继续（call）→ preflop_fold_too_tight', () => {
    // toCall=3：面对一次开池到 3（真实节点，vs-open），不是引擎无法产生的状态。
    const s = sit({ street: 'preflop', toCall: 3 });
    const actual = tagAct('fold', 0, { street: 'preflop', toCall: 3 });
    const rec = cand('call', 'call', 3, 1);
    expect(tagFor(s, actual, null, evFor(rec), VS_OPEN_NODE)).toBe('preflop_fold_too_tight');
  });

  // ───────────────────────────────────────────────────────────────────────
  // 'allin' 补入 fold_too_tight 判据回归（评审发现③）：短筹码翻前场景里
  // EV 引擎推荐的常常是 estimateEv 强制短筹码分支产出的 'call all-in' 候选
  // （actionType 硬编码为 'allin'，语义是"跟注"，见 evEstimate.ts 170-182 行）。
  // 此前 fold_too_tight 只判 `rec.actionType === 'call' || 'raise'`，这类候选
  // 会漏判，弃牌该继续的失误算得出损失却归不进任何一类。
  // ───────────────────────────────────────────────────────────────────────
  it('弃牌而推荐 call all-in（短筹码强制跟注候选，actionType 为 allin）→ preflop_fold_too_tight', () => {
    const s = sit({ street: 'preflop', toCall: 6, heroStack: 3 });
    const actual = tagAct('fold', 0, { street: 'preflop', toCall: 6, stackBefore: 3 });
    const rec = cand('call all-in', 'allin', 3, 1.4);
    expect(tagFor(s, actual, null, evFor(rec), VS_OPEN_NODE)).toBe('preflop_fold_too_tight');
  });

  it('跟注而推荐加注 → preflop_missed_3bet', () => {
    const s = sit({ street: 'preflop', toCall: 3 });
    const actual = tagAct('call', 3, { street: 'preflop', toCall: 3 });
    const rec = cand('raise', 'raise', 9, 2);
    expect(tagFor(s, actual, null, evFor(rec), VS_OPEN_NODE)).toBe('preflop_missed_3bet');
  });

  it('跟注而推荐弃牌 → preflop_cold_call_too_wide', () => {
    const s = sit({ street: 'preflop', toCall: 3 });
    const actual = tagAct('call', 3, { street: 'preflop', toCall: 3 });
    const rec = cand('fold', 'fold', 0, 0);
    expect(tagFor(s, actual, null, evFor(rec), VS_OPEN_NODE)).toBe('preflop_cold_call_too_wide');
  });

  it('SB 无人加注时跟注（跛入）→ preflop_sb_limp', () => {
    // toCall=0.5：SB 已经投入 0.5 BB 盲注，补齐到大盲的 1 BB 还差 0.5——这才是
    // 引擎会产出的数字，不是原先测试里那个引擎永远造不出来的 toCall=0。
    const s = sit({ street: 'preflop', heroPosition: 'SB', toCall: 0.5 });
    const actual = tagAct('call', 0.5, { street: 'preflop', toCall: 0.5 });
    const rec = cand('call', 'call', 0.5, 0.1); // 不是 raise 也不是 fold，才能落到 sb_limp 分支
    expect(tagFor(s, actual, null, evFor(rec), SB_RFI_NODE)).toBe('preflop_sb_limp');
  });

  it('SB 跛入即使推荐动作是弃牌，也判 preflop_sb_limp 而不是 preflop_cold_call_too_wide' +
    '（分支顺序修正的回归测试——sb_limp 现在排在 cold_call_too_wide 前面）', () => {
    const s = sit({ street: 'preflop', heroPosition: 'SB', toCall: 0.5 });
    const actual = tagAct('call', 0.5, { street: 'preflop', toCall: 0.5 });
    const rec = cand('fold', 'fold', 0, 0); // 刻意让 rec 也是 fold，两条分支都"够格"命中
    expect(tagFor(s, actual, null, evFor(rec), SB_RFI_NODE)).toBe('preflop_sb_limp');
  });

  it('面对下注时加注而推荐弃牌 → preflop_over_aggressive（vs-open 节点，不是开池）', () => {
    const s = sit({ street: 'preflop', toCall: 3 });
    const actual = tagAct('raise', 9, { street: 'preflop', toCall: 3 });
    const rec = cand('fold', 'fold', 0, 0);
    expect(tagFor(s, actual, null, evFor(rec), VS_OPEN_NODE)).toBe('preflop_over_aggressive');
  });

  it('无人加注时开池而推荐弃牌 → preflop_open_too_wide（rfi 节点，toCall=1 是 UTG 面对大盲的真实数字）', () => {
    const s = sit({ street: 'preflop', toCall: 1 });
    const actual = tagAct('raise', 3, { street: 'preflop', toCall: 1 });
    const rec = cand('fold', 'fold', 0, 0);
    expect(tagFor(s, actual, null, evFor(rec), RFI_NODE)).toBe('preflop_open_too_wide');
  });

  it('4bet 之后（node 为 null，范围表未覆盖）加注而推荐弃牌 → preflop_over_aggressive，不是 preflop_open_too_wide', () => {
    // node===null 在翻前只可能表示 4bet 及以上：显然不是"开池"，isOpen 应取 false。
    const s = sit({ street: 'preflop', toCall: 20 });
    const actual = tagAct('allin', 100, { street: 'preflop', toCall: 20 });
    const rec = cand('fold', 'fold', 0, 0);
    expect(tagFor(s, actual, null, evFor(rec), null)).toBe('preflop_over_aggressive');
  });

  it('开池过宽（rfi 节点）判 preflop_open_too_wide，面对开池再加注过宽（vs-open 节点）判 ' +
    'preflop_over_aggressive —— 这正是缺陷把两者混为一谈的那一对场景', () => {
    const openNode = sit({ street: 'preflop', toCall: 1 });
    const openActual = tagAct('raise', 3, { street: 'preflop', toCall: 1 });
    const openRec = cand('fold', 'fold', 0, 0);
    expect(tagFor(openNode, openActual, null, evFor(openRec), RFI_NODE)).toBe('preflop_open_too_wide');

    const reraiseSit = sit({ street: 'preflop', toCall: 3 });
    const reraiseActual = tagAct('raise', 9, { street: 'preflop', toCall: 3 });
    const reraiseRec = cand('fold', 'fold', 0, 0);
    expect(tagFor(reraiseSit, reraiseActual, null, evFor(reraiseRec), VS_OPEN_NODE)).toBe('preflop_over_aggressive');
  });

  // ───────────────────────────────────────────────────────────────────────
  // !isOpen 守卫回归（评审发现②）：missed_3bet / cold_call_too_wide 都要求
  // "面对加注"，node.kind==='rfi'（isOpen）时桌上还没有人加注过，即使
  // actual.type==='call' 也不该命中这两条——SB 补齐大盲已经由 sb_limp 分支
  // 单独覆盖（见上面几条用例），这里补的是没有 !isOpen 守卫时会漏判的另一种
  // 处境：跛入者身后再跛入（非 SB，isOpen 仍为 true，因为跛入不计入加注）。
  // ───────────────────────────────────────────────────────────────────────
  it('无人加注时跟注（非 SB 的跛入者身后再跛入）不应判 preflop_missed_3bet，即使推荐动作是 raise —— !isOpen 守卫回归（judge.ts:157 附近）', () => {
    const node: PreflopNode = { key: 'HJ_rfi', kind: 'rfi', opener: null };
    const s = sit({ street: 'preflop', heroPosition: 'HJ', toCall: 1 });
    const actual = tagAct('call', 1, { street: 'preflop', toCall: 1 });
    const rec = cand('raise', 'raise', 3, 1);
    expect(tagFor(s, actual, null, evFor(rec), node)).toBeNull();
  });

  it('无人加注时跟注（非 SB 的跛入者身后再跛入）不应判 preflop_cold_call_too_wide，即使推荐动作是 fold —— !isOpen 守卫回归（judge.ts:168 附近）', () => {
    const node: PreflopNode = { key: 'HJ_rfi', kind: 'rfi', opener: null };
    const s = sit({ street: 'preflop', heroPosition: 'HJ', toCall: 1 });
    const actual = tagAct('call', 1, { street: 'preflop', toCall: 1 });
    const rec = cand('fold', 'fold', 0, 0);
    expect(tagFor(s, actual, null, evFor(rec), node)).toBeNull();
  });

  it('加注且推荐动作也是加注（无失误）→ null（翻前合法但归不进任何一类）', () => {
    const s = sit({ street: 'preflop', toCall: 3 });
    const actual = tagAct('raise', 9, { street: 'preflop', toCall: 3 });
    const rec = cand('raise', 'raise', 9, 2);
    // 前置条件：确认这确实不会先命中 fold_too_tight / missed_3bet 等分支
    expect(actual.type).toBe('raise');
    expect(rec.actionType).toBe('raise');
    expect(tagFor(s, actual, null, evFor(rec), VS_OPEN_NODE)).toBeNull();
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

// ─────────────────────────────────────────────────────────────────────────
// tagFor —— 'allin' 类型的进攻/跟注消歧（isAggressiveActual 回归）。
//
// 缺陷复现：estimateEv 下注/加注候选的 actionType 从不是 'allin'（matchCandidate
// 上 candidateTypeMatches 的文档注释已经说明），但 gameEngine 记录用户实际动作
// 时，'allin' 与 'raise'/'bet' 一样合法——用户自愿全下会被记成
// actual.type==='allin'。tagFor 里 bet_size_too_small/too_large 与
// over_bluffing 曾经只判 `actual.type === 'bet' || actual.type === 'raise'`，
// 没有把 'allin' 并进来（should_have_folded 那组分支倒是写了）：用户一旦自愿
// 全下，这几个分支全部落空、退化到 tagFor 末尾 `return null`——evLoss 仍然算
// 得对（matchCandidate 已经修好），只是分类丢了，复盘只显示"你亏了 X BB"却不
// 说是哪一类错误。
//
// 但 'allin' 不能无条件并入进攻类：estimateEv 的强制短筹码分支（toCall > 0 且
// heroStack <= toCall，玩家没有加注权，见 evEstimate.ts 170-182 行）也会让
// legalActions 只剩 'allin' 一个能继续的选项（core/gameEngine.ts legalActions
// 161-169 行），这时候的 'allin' 语义是"跟注"，不是"主动加码"——如果把它也
// 当进攻处理，一次赔率不足的被迫跟注会被误标成 over_bluffing/bet_size_too_large，
// 比"没有分类"更具误导性。isAggressiveActual 用 toCall>0 且
// !chipsGreater(heroStack,toCall) 这个跟 evEstimate.ts 相同的判据来分辨这两种
// 处境，见 judge.ts 上该函数的文档注释。
// ─────────────────────────────────────────────────────────────────────────

describe('tagFor — allin 的进攻/跟注消歧', () => {
  it('用户自愿全下（toCall=0，非强制）、推荐尺度比实际小 → bet_size_too_large', () => {
    // heroStack(91) > toCall(0)：不是强制短筹码处境，'allin' 是主动把 bet
    // 拉满到筹码上限，理应并入 bet_size_too_large 的判定。
    const s = sit({ street: 'flop', toCall: 0, pot: 9, heroStack: 91 });
    const actual = tagAct('allin', 91, { toCall: 0, potBefore: 9, stackBefore: 91 });
    const actualCand = cand('all-in', 'bet', 91, 3);
    const rec = cand('bet 1/3', 'bet', 3, 6);
    expect(tagFor(s, actual, actualCand, evFor(rec, [actualCand]))).toBe('bet_size_too_large');
  });

  it('用户自愿全下（toCall=0，非强制）、低胜率、推荐过牌 → over_bluffing', () => {
    const s = sit({ street: 'flop', toCall: 0, pot: 10, heroStack: 100 });
    const actual = tagAct('allin', 100, { toCall: 0, potBefore: 10, stackBefore: 100 });
    const rec = cand('check', 'check', 0, 1); // foldEquity 缺失 → over_bluffing，不是 ineffective_bluff
    expect(tagFor(s, actual, null, evFor(rec, [], 0.1))).toBe('over_bluffing');
  });

  it('强制短筹码全下跟注（toCall>0 且 heroStack<=toCall）不算进攻，不会被误判 bet_size_too_large', () => {
    // hero 只剩 5 BB，面对 8 BB 的下注被迫全下跟注。这里手写的 rec 是 bet
    // 类型只为单独钉住 isAggressiveActual 本身的判据——真实的 estimateEv 在
    // 这个处境下只会产出 fold/allin(强制跟注) 两个候选（evEstimate.ts
    // 170-182 行），不会有 bet 候选，所以这个组合在真实数据里不会出现；
    // 但正因为如此，才要在单测里把它单独构造出来验证：即使 rec 恰好是
    // bet/raise 类型、即使投入差距很大，isAggressiveActual 判成"非进攻"后，
    // bet_size_too_large 分支也不会被命中。
    const s = sit({ street: 'flop', toCall: 8, pot: 10, heroStack: 5 });
    const actual = tagAct('allin', 5, { toCall: 8, potBefore: 10, stackBefore: 5 });
    const actualCand = cand('call all-in', 'allin', 5, 0.5);
    const rec = cand('bet 1/2', 'bet', 6, 2);
    expect(tagFor(s, actual, actualCand, evFor(rec, [actualCand]))).toBeNull();
  });

  it('强制短筹码全下跟注不会被误判 over_bluffing/ineffective_bluff（即使推荐过牌、弃牌率信息拼凑得像诈唬）', () => {
    const s = sit({ street: 'flop', toCall: 8, pot: 10, heroStack: 5 });
    const actual = tagAct('allin', 5, { toCall: 8, potBefore: 10, stackBefore: 5 });
    const rec = cand('check', 'check', 0, 1, { foldEquity: 0.1 }); // 若被误判成进攻会命中 ineffective_bluff
    expect(tagFor(s, actual, null, evFor(rec))).toBeNull();
  });

  it('强制短筹码全下不改变 should_have_folded 分支（该分支不区分进攻/跟注，本就该正常命中）', () => {
    const s = sit({ street: 'flop', toCall: 8, pot: 10, heroStack: 5 });
    const actual = tagAct('allin', 5, { toCall: 8, potBefore: 10, stackBefore: 5 });
    const rec = cand('fold', 'fold', 0, 0);
    expect(tagFor(s, actual, null, evFor(rec))).toBe('should_have_folded');
  });

  it('翻前强制短筹码全下跟注不会被误判成 preflop_over_aggressive（forced call ≠ 进攻）', () => {
    const s = sit({ street: 'preflop', toCall: 20, heroStack: 5 });
    const actual = tagAct('allin', 5, { street: 'preflop', toCall: 20, stackBefore: 5 });
    const rec = cand('fold', 'fold', 0, 0);
    expect(tagFor(s, actual, null, evFor(rec), VS_OPEN_NODE)).toBeNull();
  });

  it('翻前自愿全下（heroStack > toCall，非强制）推荐弃牌 → 仍正确判 preflop_over_aggressive（既有行为不受影响）', () => {
    const s = sit({ street: 'preflop', toCall: 20, heroStack: 100 });
    const actual = tagAct('allin', 100, { street: 'preflop', toCall: 20, stackBefore: 100 });
    const rec = cand('fold', 'fold', 0, 0);
    expect(tagFor(s, actual, null, evFor(rec), VS_OPEN_NODE)).toBe('preflop_over_aggressive');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// tag/equity 一致性回归测试。
//
// 复现的缺陷：河牌圈用户过牌，推荐 all-in（97 BB 投入，EV 1.0846），
// heroEquity 只有 9%，tagFor 只看街道与翻前攻击者身份就把它判成
// missed_value_bet（"该拿价值却没下注"），但 9% 胜率下推荐下注只可能是
// 诈唬，不是价值 —— 文案与数字自相矛盾。
// 现在 tagFor 在返回 missed_value_bet 前会检查 ev.heroEquity 是否达到
// taxonomy.ts 里的 VALUE_BET_EQUITY_FLOOR。
// ─────────────────────────────────────────────────────────────────────────

describe('tagFor — missed_value_bet 必须与 heroEquity 一致（回归缺陷复现）', () => {
  // 用 river + heroIsPreflopAggressor: false，确保落入 missed_value_bet 分支
  // 而不会被 missed_cbet（只认翻牌）截走 —— 街道/尺度与缺陷报告里的现场一致。
  const s = sit({ street: 'river', toCall: 0, pot: 7.5, heroIsPreflopAggressor: false });
  const actual = tagAct('check', 0, { street: 'river', toCall: 0, potBefore: 7.5 });
  const rec = cand('all-in', 'bet', 97, 1.0846);

  it('胜率低于 VALUE_BET_EQUITY_FLOOR 时绝不返回 missed_value_bet（复现报告里 9%/16% 胜率被打成"拿价值"的缺陷）', () => {
    for (const heroEquity of [0, 0.09, 0.16, 0.3, 0.49, 0.499]) {
      expect(tagFor(s, actual, null, evFor(rec, [], heroEquity))).not.toBe('missed_value_bet');
    }
  });

  it('胜率低于门槛时返回 null，而不是随便挑一个别的标签', () => {
    // §8.7 的翻后分类里没有"该拿价值但其实是诈唬"这一条 —— 见任务书对此的
    // 选择：宁可少标一类，不能贴错标签；损失额与推荐动作仍照常展示。
    expect(tagFor(s, actual, null, evFor(rec, [], 0.09))).toBeNull();
  });

  it('胜率达到或超过 VALUE_BET_EQUITY_FLOOR 时仍正常返回 missed_value_bet（门槛闭区间，等于门槛值也算价值）', () => {
    for (const heroEquity of [VALUE_BET_EQUITY_FLOOR, 0.6, 0.9, 1]) {
      expect(tagFor(s, actual, null, evFor(rec, [], heroEquity))).toBe('missed_value_bet');
    }
  });

  it('missed_cbet 分支不受这个胜率门槛影响 —— c-bet 本来就常用弱牌打出，翻牌、翻前攻击者、过牌时即便胜率很低也该是 missed_cbet 而不是被误伤成 null', () => {
    const flopS = sit({ street: 'flop', toCall: 0, pot: 10, heroIsPreflopAggressor: true });
    const flopActual = tagAct('check', 0, { toCall: 0, potBefore: 10 });
    const flopRec = cand('bet 1/2', 'bet', 5, 2);
    expect(tagFor(flopS, flopActual, null, evFor(flopRec, [], 0.05))).toBe('missed_cbet');
  });
});
