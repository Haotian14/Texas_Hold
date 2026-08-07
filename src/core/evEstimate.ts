import type { ActionType } from './types';
import type { Rng } from './rng';
import { createRng } from './rng';
import { round2, chipsGreater } from './chips';
import type { Situation } from './situation';
import type { RangeSet } from './rangeSet';
import { equityVsRanges } from './equity';
import { rankRange, topFraction } from './rangeStrength';

export interface EvCandidate {
  /** 面向人的标签：'fold' / 'call' / 'bet 1/2' / 'all-in' */
  label: string;
  actionType: ActionType;
  /** 本次需要投入的筹码 */
  investment: number;
  /** 以「此刻起」为基准的期望值，单位 BB */
  ev: number;
  isRecommended: boolean;
  /** 仅下注/加注候选有：所有对手都弃牌的概率 */
  foldEquity?: number;
  /** 仅下注/加注候选有：对手跟注后 hero 的胜率（W'） */
  equityWhenCalled?: number;
}

export interface EvResult {
  candidates: EvCandidate[];
  /** hero 对当前对手范围的胜率 */
  heroEquity: number;
  /** 跟注所需的最低胜率；无需跟注时为 null */
  requiredEquity: number | null;
  recommended: EvCandidate;
  iterations: number;
}

export interface EvOptions {
  /** 主胜率估算的蒙特卡洛迭代数 */
  iterations?: number;
  /** 范围牌力排序的迭代数（每个组合一次小规模模拟） */
  strengthIterations?: number;
  rng?: Rng;
  /** 是否加入隐含赔率修正，默认开启 */
  impliedOdds?: boolean;
}

/** 候选下注尺度，占底池的比例。spec §8.3 固定这五档，不做连续搜索。 */
const BET_SIZES: Array<{ label: string; fraction: number }> = [
  { label: 'bet 1/3', fraction: 1 / 3 },
  { label: 'bet 1/2', fraction: 1 / 2 },
  { label: 'bet 2/3', fraction: 2 / 3 },
  { label: 'bet pot', fraction: 1 },
];

/**
 * 估算局面下各候选动作的期望值。
 *
 * 以「此刻起」为基准：已经投进池子的筹码是沉没成本，不参与计算。
 * 这是单步近似，不展开未来街的博弈树 —— 它能可靠指出明显错误，
 * 但不应被当作 solver 的精确输出（见设计文档 §12）。
 */
export function estimateEv(sit: Situation, opts: EvOptions = {}): EvResult {
  if (sit.opponents.length === 0) {
    throw new Error('Situation 中没有对手，无法估算 EV');
  }

  const iterations = opts.iterations ?? 2000;
  const strengthIterations = opts.strengthIterations ?? 120;
  const rng = opts.rng ?? createRng('ev-default');
  const useImplied = opts.impliedOdds ?? true;

  const oppRanges: RangeSet[] = sit.opponents.map(o => o.range);
  const dead = [...sit.heroCards, ...sit.board];

  // W：对当前对手范围的胜率
  const heroEquity = equityVsRanges(sit.heroCards, sit.board, oppRanges, iterations, rng);

  // 各对手范围按牌力排好序，供后续切「继续范围」用。排序开销大，只做一次。
  const rankedPerOpp = sit.opponents.map(o =>
    rankRange(o.range, sit.board, dead, strengthIterations, rng),
  );

  const candidates: EvCandidate[] = [];

  // ── 弃牌 / 过牌
  if (chipsGreater(sit.toCall, 0)) {
    candidates.push({ label: 'fold', actionType: 'fold', investment: 0, ev: 0, isRecommended: false });
  } else {
    // 过牌：不投入、不弃权，期望等于「看到摊牌」的份额近似
    candidates.push({
      label: 'check',
      actionType: 'check',
      investment: 0,
      ev: round4(heroEquity * sit.pot),
      isRecommended: false,
    });
  }

  // ── 跟注
  if (chipsGreater(sit.toCall, 0) && chipsGreater(sit.heroStack, sit.toCall)) {
    let ev = heroEquity * (sit.pot + sit.toCall) - sit.toCall;
    if (useImplied) ev += impliedOddsBonus(sit, heroEquity);
    candidates.push({
      label: 'call',
      actionType: 'call',
      investment: sit.toCall,
      ev: round4(ev),
      isRecommended: false,
    });
  }

  // ── 下注 / 加注
  const maxInvest = sit.heroStack;
  for (const size of BET_SIZES) {
    const b = round2(sit.pot * size.fraction + sit.toCall);
    if (!chipsGreater(maxInvest, b)) continue;   // 筹码不足以打出这个尺度
    candidates.push(makeBetCandidate(sit, size.label, b, rankedPerOpp, iterations, rng));
  }

  // all-in 永远是一个候选
  candidates.push(makeBetCandidate(sit, 'all-in', maxInvest, rankedPerOpp, iterations, rng));

  // ── 选出推荐动作
  let best = candidates[0];
  for (const c of candidates) if (c.ev > best.ev) best = c;
  best.isRecommended = true;

  return {
    candidates,
    heroEquity,
    requiredEquity: chipsGreater(sit.toCall, 0) ? sit.toCall / (sit.pot + sit.toCall) : null,
    recommended: best,
    iterations,
  };
}

/**
 * EV(下注 B) = Fe × 底池 + (1 − Fe) × [ W' × (底池 + 2B) − B ]
 *
 * Fe   所有对手都弃牌的概率
 * W'   对手跟注后的胜率 —— 必须对「继续范围」单独算，
 *      沿用 W 会系统性高估诈唬价值
 */
function makeBetCandidate(
  sit: Situation,
  label: string,
  investment: number,
  rankedPerOpp: ReturnType<typeof rankRange>[],
  iterations: number,
  rng: Rng,
): EvCandidate {
  const b = investment;

  // 每个对手面对该尺度时理论上必须防守的比例（MDF）
  const mdf = Math.min(1, sit.pot / (sit.pot + b));
  const continueRanges: RangeSet[] = rankedPerOpp.map(r => topFraction(r, mdf));

  // 所有人都弃牌的概率：每个对手独立以 (1 - mdf) 的概率弃牌
  const foldEquity = Math.pow(1 - mdf, continueRanges.length);

  // W'：对手跟注后的胜率。必须对「继续范围」单独算 ——
  // 沿用 W 会系统性高估诈唬价值，因为对手跟注时留下的是更强的那部分范围。
  // 若任一继续范围被死牌清空，回落到原范围（此时该近似会偏保守）。
  const allUsable = continueRanges.every(r => r.size > 0);
  const rangesForCalled = allUsable ? continueRanges : sit.opponents.map(o => o.range);
  const wPrime = equityVsRanges(sit.heroCards, sit.board, rangesForCalled, iterations, rng);

  const ev = foldEquity * sit.pot + (1 - foldEquity) * (wPrime * (sit.pot + 2 * b) - b);

  return {
    label,
    actionType: chipsGreater(sit.toCall, 0) ? 'raise' : 'bet',
    investment: round2(b),
    ev: round4(ev),
    isRecommended: false,
    foldEquity: round4(foldEquity),
    equityWhenCalled: round4(wPrime),
  };
}

/**
 * 隐含赔率修正（spec §8.4）。
 *
 * 纯即时 EV 低估听牌与小口袋对：击中之后还能从对手后续街的下注里赚到钱。
 * 这是启发式近似，会在 UI 上标注。
 */
function impliedOddsBonus(sit: Situation, heroEquity: number): number {
  if (sit.street === 'river') return 0;          // 河牌之后没有未来街
  if (heroEquity > 0.5) return 0;                // 已经领先，不属于「博击中」

  const effectiveStack = Math.min(
    sit.heroStack,
    ...sit.opponents.map(o => o.stack),
  );
  if (!chipsGreater(effectiveStack, 0)) return 0;

  // 击中概率用「距离摊牌的胜率缺口」粗略代表
  const hitChance = Math.max(0, Math.min(0.35, heroEquity));
  // 击中后预期能从对手那里多赚的比例
  const realiseRate = 0.35;

  return effectiveStack * hitChance * realiseRate * 0.1;
}

/** EV 保留 4 位小数，避免测试因浮点尾数抖动 */
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
