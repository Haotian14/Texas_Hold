import type { Action } from '../core/types';
import type { Situation } from '../core/situation';
import type { EvResult, EvCandidate } from '../core/evEstimate';
import { classifyHand } from '../core/handClass';
import { actionFreqs } from '../core/ranges';
import { chipsGreater } from '../core/chips';
import type { MistakeTag } from './taxonomy';
import { PREFLOP_OK_FREQ } from './taxonomy';
import type { PreflopNode } from './preflopNode';

/**
 * 把用户的实际动作对应到一个 EV 候选。
 *
 * 已知近似：用户的下注尺度可能落在两个候选档之间（比如 0.4 池），
 * 此时取最接近的一档，EV 会有偏差。候选尺度固定为五档是 spec §8.3
 * 的决定（连续尺度搜索收益低、开销大），所以这个偏差是设计的一部分，
 * 不是缺陷 —— 但要在 UI 与文档里说明。
 */
export function matchCandidate(ev: EvResult, actual: Action): EvCandidate | null {
  const same = ev.candidates.filter(c => c.actionType === actual.type);
  if (same.length === 0) return null;
  if (same.length === 1) return same[0];

  const target = actual.amount;
  let best = same[0];
  let bestGap = Math.abs(best.investment - target);
  for (const c of same) {
    const gap = Math.abs(c.investment - target);
    if (gap < bestGap) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * 翻前按频率表判定是否算失误（spec §8.2）。
 *
 * 范围表只存频率不存 EV，所以它只回答「这算不算失误」，
 * 不回答「亏了多少」—— 后者由同一套 EV 估算给出，量纲才能和翻后相加。
 *
 * 均衡策略是混合的：同一手牌在同一节点可能 30% 加注、70% 跟注。
 * 用户选了低频但合法的那一支不该被判错，所以阈值取 0.15 而不是「最高频动作」。
 */
export function judgePreflopFrequency(
  node: PreflopNode | null,
  situation: Situation,
  actual: Action,
): boolean {
  if (!node) return false;
  const hc = classifyHand(situation.heroCards[0], situation.heroCards[1]);
  const freqs = actionFreqs(node.key, hc);
  if (!freqs) return false;

  // 引擎的动作类型与范围表的动作名对不上：表里用 raise / call / 3bet / 4bet / fold
  const key = preflopActionKey(node, actual.type);
  if (!key) return false;
  return (freqs[key] ?? 0) >= PREFLOP_OK_FREQ;
}

function preflopActionKey(node: PreflopNode, type: Action['type']): string | null {
  if (type === 'fold') return 'fold';
  if (type === 'call') return 'call';
  if (type === 'raise' || type === 'allin') {
    if (node.kind === 'rfi') return 'raise';
    if (node.kind === 'vs-open') return '3bet';
    return '4bet';
  }
  return null;
}

/**
 * 按局面特征给失误打分类标签（spec §8.7）。
 *
 * 规则按「最具体的先判」排序 —— 一个决策可能同时符合多条描述，
 * 取最能说明问题的那一条。返回 null 表示能算出损失但归不进任何一类，
 * 此时 UI 只显示损失额与推荐动作。
 */
export function tagFor(
  situation: Situation,
  actual: Action,
  actualCand: EvCandidate | null,
  ev: EvResult,
): MistakeTag | null {
  const rec = ev.recommended;
  const isPreflop = situation.street === 'preflop';
  const facingBet = chipsGreater(situation.toCall, 0);

  if (isPreflop) {
    if (actual.type === 'fold' && (rec.actionType === 'call' || rec.actionType === 'raise')) {
      return 'preflop_fold_too_tight';
    }
    if (actual.type === 'call' && rec.actionType === 'raise') {
      return 'preflop_missed_3bet';
    }
    if (actual.type === 'call' && rec.actionType === 'fold') {
      return 'preflop_cold_call_too_wide';
    }
    if (actual.type === 'call' && !facingBet && situation.heroPosition === 'SB') {
      return 'preflop_sb_limp';
    }
    if ((actual.type === 'raise' || actual.type === 'allin') && rec.actionType === 'fold') {
      return facingBet ? 'preflop_over_aggressive' : 'preflop_open_too_wide';
    }
    return null;
  }

  // ── 翻后
  if (actual.type === 'fold' && rec.actionType !== 'fold') {
    // 该继续却弃了。§8.7 的翻后分类里没有「弃得太紧」这一条 ——
    // 翻后弃牌过紧的形态太多（弃掉听牌、弃掉成手、弃掉底池赔率足够的边缘牌），
    // 归成一个标签没有指导意义。返回 null，UI 只显示损失额与推荐动作。
    return null;
  }
  if ((actual.type === 'call' || actual.type === 'raise' || actual.type === 'allin') &&
      rec.actionType === 'fold') {
    if (actual.type !== 'call') return 'should_have_folded';
    return isRaiseFaced(situation) ? 'call_too_light_vs_raise' : 'chasing_bad_odds';
  }
  if ((actual.type === 'check' || actual.type === 'call') && (rec.actionType === 'bet' || rec.actionType === 'raise')) {
    if (situation.street === 'flop' && situation.heroIsPreflopAggressor && actual.type === 'check') {
      return 'missed_cbet';
    }
    return 'missed_value_bet';
  }
  if ((actual.type === 'bet' || actual.type === 'raise') && rec.actionType === 'fold') {
    return 'over_bluffing';
  }
  if ((actual.type === 'bet' || actual.type === 'raise') && rec.actionType === 'check') {
    // 下注但推荐过牌：弃牌率不足的诈唬
    if (rec.foldEquity !== undefined && rec.foldEquity < 0.2) return 'ineffective_bluff';
    return 'over_bluffing';
  }
  if (actualCand && (actual.type === 'bet' || actual.type === 'raise') &&
      (rec.actionType === 'bet' || rec.actionType === 'raise')) {
    if (chipsGreater(rec.investment, actualCand.investment)) return 'bet_size_too_small';
    if (chipsGreater(actualCand.investment, rec.investment)) return 'bet_size_too_large';
  }
  return null;
}

/**
 * 面对的是不是一个「大注」——用于区分「面对加注跟太松」与「赔率不足追听牌」。
 *
 * 用 toCall 超过半个底池作为代理，而不是去 actions 里找有没有 raise：
 * 半池以上的下注要求跟注方有 33% 以上的胜率，这个门槛本身就是
 * 「跟太松」的判定依据，比「技术上是不是一次 raise」更贴近要表达的意思。
 */
function isRaiseFaced(situation: Situation): boolean {
  return chipsGreater(situation.toCall, situation.pot * 0.5);
}
