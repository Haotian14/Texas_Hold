import type { Action } from '../core/types';
import type { Situation } from '../core/situation';
import type { EvCandidate } from '../core/evEstimate';
import type { MistakeTag, Severity } from './taxonomy';

export interface ExplainInput {
  tag: MistakeTag | null;
  severity: Severity;
  situation: Situation;
  actual: Action;
  actualEv: number | null;
  recommended: EvCandidate;
  evLoss: number;
  degraded: boolean;
  /** hero 对当前对手范围的胜率，来自 EvResult.heroEquity */
  heroEquity: number;
  /** 跟注所需最低胜率，来自 EvResult.requiredEquity；无需跟注时为 null */
  requiredEquity: number | null;
}

/** 模板可用的数值，先算好再填，避免每条模板各算一遍 */
interface Ctx {
  pot: string;
  toCall: string;
  loss: string;
  equity: string;
  /** 跟注所需胜率；无需跟注时为 '—'。只有确定面对下注的 tag 才应引用它。 */
  required: string;
  recLabel: string;
  /** 用户实际动作投入的筹码（fold/check 恒为 0） */
  actualAmount: string;
  /** 推荐动作需要投入的筹码 */
  recInvestment: string;
}

function formatBB(v: number): string {
  return v.toFixed(1);
}

function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function buildCtx(input: ExplainInput): Ctx {
  return {
    pot: formatBB(input.situation.pot),
    toCall: formatBB(input.situation.toCall),
    loss: formatBB(input.evLoss),
    equity: formatPct(input.heroEquity),
    required: input.requiredEquity === null ? '—' : formatPct(input.requiredEquity),
    recLabel: input.recommended.label,
    actualAmount: formatBB(input.actual.amount),
    recInvestment: formatBB(input.recommended.investment),
  };
}

// 以下 15 条模板：先给数字，再给替代方案，不评价用户水平，不用感叹号。
//
// requiredEquity 在「无需跟注」时为 null（格式化为「—」）。只有 tagFor 里保证
// 该 tag 只在面对下注时触发的模板才引用 c.required：
// preflop_fold_too_tight / preflop_cold_call_too_wide / preflop_missed_3bet /
// preflop_over_aggressive（面对加注分支）/ chasing_bad_odds / call_too_light_vs_raise。
// 其余 tag（见 tagFor，src/review/judge.ts）可能在 toCall = 0 时触发，模板不引用 c.required：
// preflop_open_too_wide、preflop_sb_limp、missed_cbet、missed_value_bet、
// over_bluffing、ineffective_bluff、bet_size_too_small、bet_size_too_large。
const TEMPLATES: Record<MistakeTag, (c: Ctx) => string> = {
  preflop_open_too_wide: c =>
    `这手牌不在该位置的开池范围内，开池损失约 ${c.loss} BB。建议${c.recLabel}。`,
  preflop_fold_too_tight: c =>
    `底池 ${c.pot} BB，跟注 ${c.toCall} BB 只需 ${c.required} 的胜率，而这手牌有 ${c.equity}。弃牌损失约 ${c.loss} BB。`,
  chasing_bad_odds: c =>
    `跟注 ${c.toCall} BB 需要 ${c.required} 的胜率，这手牌只有 ${c.equity}，损失约 ${c.loss} BB。`,

  preflop_cold_call_too_wide: c =>
    `面对加注跟注 ${c.toCall} BB，需要 ${c.required} 的胜率，这手牌只有 ${c.equity}，不在冷跟范围内，损失约 ${c.loss} BB。建议${c.recLabel}。`,
  preflop_missed_3bet: c =>
    `面对加注只跟注了 ${c.toCall} BB，这手牌值得加注施压而不是跟注，多赢的期望约 ${c.loss} BB。建议${c.recLabel}。`,
  preflop_over_aggressive: c =>
    `面对加注又加注到 ${c.actualAmount} BB，这手牌只有 ${c.equity} 的胜率，撑不起这次加注，损失约 ${c.loss} BB。建议${c.recLabel}。`,
  preflop_sb_limp: c =>
    `小盲无人加注时只跟注 ${c.actualAmount} BB 跛入，这个位置更适合主动加注，损失约 ${c.loss} BB。建议${c.recLabel}。`,
  missed_cbet: c =>
    `底池 ${c.pot} BB，翻牌是持续下注的位置却选择过牌，损失约 ${c.loss} BB。建议${c.recLabel}。`,
  missed_value_bet: c =>
    `底池 ${c.pot} BB，这手牌有 ${c.equity} 的胜率，本该下注拿价值却过牌或只是跟注，损失约 ${c.loss} BB。建议${c.recLabel}。`,
  call_too_light_vs_raise: c =>
    `面对 ${c.toCall} BB 的大注跟注，需要 ${c.required} 的胜率，这手牌只有 ${c.equity}，损失约 ${c.loss} BB。建议${c.recLabel}。`,
  should_have_folded: c =>
    `投入 ${c.actualAmount} BB 继续这手牌，胜率只有 ${c.equity}，撑不起这次投入，损失约 ${c.loss} BB。建议${c.recLabel}。`,
  bet_size_too_small: c =>
    `下注 ${c.actualAmount} BB，尺度偏小，推荐下注到 ${c.recInvestment} BB 以拿到更多价值，损失约 ${c.loss} BB。`,
  bet_size_too_large: c =>
    `下注 ${c.actualAmount} BB，尺度偏大，推荐下注到 ${c.recInvestment} BB 更合适，损失约 ${c.loss} BB。`,
  ineffective_bluff: c =>
    `下注 ${c.actualAmount} BB 诈唬，对手弃牌率不够，很难让对手弃牌，损失约 ${c.loss} BB。建议${c.recLabel}。`,
  over_bluffing: c =>
    `下注 ${c.actualAmount} BB，这手牌只有 ${c.equity} 的胜率，诈唬频率过高，损失约 ${c.loss} BB。建议${c.recLabel}。`,
};

export function explain(input: ExplainInput): string {
  // 降级优先于一切：此时任何 BB 数字都不可信，绝不能出现在文案里
  if (input.degraded) {
    return '本手此处对手范围过窄，估算已降级，不做判定。';
  }
  if (!input.tag) {
    return input.severity === 'ok' ? '这一步没问题。' : `建议${input.recommended.label}。`;
  }
  return TEMPLATES[input.tag](buildCtx(input));
}
