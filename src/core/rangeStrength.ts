import type { Card } from './cards';
import type { Rng } from './rng';
import type { HandClass } from './handClass';
import type { RangeSet, WeightedCombo } from './rangeSet';
import { rangeCombos, totalWeight } from './rangeSet';
import { equityMonteCarlo } from './equity';

export interface RankedCombo extends WeightedCombo {
  /** 该组合对一个随机手的胜率，0..1 */
  strength: number;
}

/**
 * 给范围里的每个组合打上牌力分，按强度降序返回。
 *
 * 牌力定义为「对一个随机手的胜率」：它对翻前和每条街都有定义、单调、
 * 且不依赖于对手的对手是谁。牌型分值只在河牌圈才完整，翻牌圈无法比较
 * 听牌与小对子，因此不适合做排序键。
 *
 * 开销与范围大小成正比，调用方应缓存结果。
 */
export function rankRange(
  range: RangeSet,
  board: Card[],
  dead: readonly Card[],
  iterations: number,
  rng: Rng,
): RankedCombo[] {
  const combos = rangeCombos(range, dead);
  const out: RankedCombo[] = combos.map(c => ({
    ...c,
    strength: equityMonteCarlo(c.cards, board, 1, iterations, rng),
  }));
  out.sort((a, b) => b.strength - a.strength);
  return out;
}

/**
 * 取加权前 fraction 比例的组合，重组成 RangeSet。
 * 同一类别的多个组合可能部分入选，此时该类别的权重按入选组合的比例折算。
 */
export function topFraction(ranked: readonly RankedCombo[], fraction: number): RangeSet {
  if (fraction < 0 || fraction > 1) {
    throw new Error(`比例必须在 [0,1] 内，收到 ${fraction}`);
  }

  const target = totalWeight(ranked) * fraction;
  const acc = new Map<HandClass, number>();
  let taken = 0;

  for (const c of ranked) {
    if (taken >= target) break;
    const room = target - taken;
    const use = Math.min(c.weight, room);
    acc.set(c.handClass, (acc.get(c.handClass) ?? 0) + use);
    taken += use;
  }

  // acc 里累计的是「组合权重之和」，换算回类别权重需除以该类别的组合数。
  // 直接按入选比例还原：类别权重 = 累计权重 / 该类别在 ranked 中的组合数
  const comboCountInRange = new Map<HandClass, number>();
  for (const c of ranked) {
    comboCountInRange.set(c.handClass, (comboCountInRange.get(c.handClass) ?? 0) + 1);
  }

  const out = new Map<HandClass, number>();
  for (const [hc, sum] of acc) {
    const n = comboCountInRange.get(hc) ?? 1;
    const w = sum / n;
    if (w > 0) out.set(hc, Math.min(1, w));
  }
  return out;
}

/** 该类别在范围中的强度分位：0 最弱、1 最强。不在范围内返回 0。 */
export function strengthPercentile(ranked: readonly RankedCombo[], hc: HandClass): number {
  if (ranked.length === 0) return 0;
  const idxs: number[] = [];
  for (let i = 0; i < ranked.length; i++) {
    if (ranked[i].handClass === hc) idxs.push(i);
  }
  if (idxs.length === 0) return 0;
  const avgIdx = idxs.reduce((a, b) => a + b, 0) / idxs.length;
  return 1 - avgIdx / Math.max(1, ranked.length - 1);
}
