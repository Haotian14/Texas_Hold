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

/**
 * 判「算不算失误」时，损失要超过多少个标准误才算数。
 *
 * 候选 EV 是蒙特卡洛估计，`EV(推荐) − EV(实际)` 是两个估计的差，本身带噪声。
 * 旧实现直接拿这个差跟 SEVERITY_THRESHOLDS 比，只靠最小档 0.2 BB 这一个
 * 常数挡噪声——注释里写着「默认迭代数下单个 EV 的标准误约与之同量级」，
 * 但那是对**单个** EV 而言，差值的噪声是两者的合成；实测同一个局面只换随机
 * 种子，报出来的损失能在 2.11～2.75 BB 之间摆动（跨度 0.64），远超 0.2。
 * 结果就是一批「你打错了」其实只是这一次采样恰好偏了。
 *
 * 现在改成按每个决策点**自己算出来的**噪声带判：EvCandidate.evStdErr 给出
 * 每个候选 EV 的标准误，差值的标准误取两者平方和开根，损失必须超过
 * EV_NOISE_SIGMAS 倍才算失误，否则按 0 处理。这样底池大、尺度大、迭代少的
 * 决策点自动获得更宽的容忍，而干净的小池子照旧敏感——固定常数做不到这件事。
 *
 * 取 2（约 95% 置信）而不是 1：evStdErr 只涵盖胜率采样那一层噪声，牌力排序
 * 的抖动没算进去，真实误差比它大；而这个闸门的两类错误代价并不对称——漏报
 * 一个小失误，用户少看到一条提示；误报一个不存在的失误，用户会不信任整个
 * 复盘（这正是本轮修复的起点）。宁可漏，不可诬。
 */
export const EV_NOISE_SIGMAS = 2;

/**
 * 「价值下注」判定要求的最低 hero 胜率。
 *
 * 下注拿价值的前提是身位领先 —— 对手范围里会跟注的部分，大部分应该是
 * 被我们的牌打败的。低于这条线时，即使 EV 估算推荐下注，那也是诈唬或
 * 半诈唬，不该被 tagFor 贴上 missed_value_bet（"该拿价值却没下注"）标签，
 * 见 judge.ts 里对这个常量的引用。
 *
 * 0.5 不是精算出来的数字，只是"至少要在对手跟注范围前占先"这个直觉的
 * 一个粗略经验边界，不代表真实的价值下注门槛（那取决于对手跟注范围、
 * 成手牌力分布等，本引擎不建模到这个精细度）。调整判定松紧时改这一个
 * 数即可，不用去翻 judge.ts。
 */
export const VALUE_BET_EQUITY_FLOOR = 0.5;

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
