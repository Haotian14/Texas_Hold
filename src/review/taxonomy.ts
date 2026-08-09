/**
 * 复盘引擎的分类法与阈值。
 *
 * 这些数字决定了用户看到多少个红灯。集中放在一处是刻意的 ——
 * 调整判定松紧时只应该改这个文件，不用去翻判定规则本身。
 */

export type Severity = 'ok' | 'minor' | 'notable' | 'severe';

/** 翻前失误分类（spec §8.7） */
export const PREFLOP_TAGS = [
  'preflop_cold_call_too_wide',
  'preflop_missed_3bet',
  'preflop_over_aggressive',
  'preflop_sb_limp',
  'preflop_open_too_wide',
  'preflop_fold_too_tight',
] as const;

/** 翻后失误分类（spec §8.7） */
export const POSTFLOP_TAGS = [
  'missed_cbet',
  'missed_value_bet',
  'chasing_bad_odds',
  'call_too_light_vs_raise',
  'should_have_folded',
  'bet_size_too_small',
  'bet_size_too_large',
  'ineffective_bluff',
  'over_bluffing',
] as const;

export type PreflopTag = (typeof PREFLOP_TAGS)[number];
export type PostflopTag = (typeof POSTFLOP_TAGS)[number];
export type MistakeTag = PreflopTag | PostflopTag;

/**
 * 严重度阈值（spec §8.6）。区间左闭右开：evLoss 恰好等于 0.2 归入 minor。
 * 最小档 0.2 BB 是刻意设的 —— 默认迭代数下单个 EV 的蒙特卡洛标准误约与之同量级，
 * 低于这个数的差异不该拿去指责用户。
 */
export const SEVERITY_THRESHOLDS: readonly { min: number; severity: Severity }[] = [
  { min: 0, severity: 'ok' },
  { min: 0.2, severity: 'minor' },
  { min: 1, severity: 'notable' },
  { min: 3, severity: 'severe' },
];

export function severityOf(evLoss: number): Severity {
  let out: Severity = 'ok';
  for (const t of SEVERITY_THRESHOLDS) {
    if (evLoss >= t.min) out = t.severity;
  }
  return out;
}

/**
 * 翻前判定阈值（spec §8.2）：用户动作在范围表里的频率达到这个值就不算失误。
 *
 * 均衡策略本身是混合的 —— 同一手牌在同一节点可能 30% 加注、70% 跟注。
 * 用户选了低频但合法的那一支，不该被判错。
 */
export const PREFLOP_OK_FREQ = 0.15;
