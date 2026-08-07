import type { Card } from './cards';
import { sameCard } from './cards';
import type { Rng } from './rng';
import type { HandClass } from './handClass';
import { allHandClasses, expandCombos } from './handClass';

/** 对手可能持有的手牌分布：类别 -> 权重（0..1）。未出现的类别视为 0。 */
export type RangeSet = ReadonlyMap<HandClass, number>;

export interface WeightedCombo {
  cards: [Card, Card];
  weight: number;
  handClass: HandClass;
}

/**
 * 把范围展开成具体的两张牌组合，剔除与死牌冲突的。
 *
 * dead 应包含 hero 的底牌与所有已知公共牌 —— 这些牌已不在牌堆里，
 * 对手不可能持有。漏掉会让胜率系统性偏低。
 */
export function rangeCombos(range: RangeSet, dead: readonly Card[]): WeightedCombo[] {
  const out: WeightedCombo[] = [];
  for (const [handClass, weight] of range) {
    if (weight <= 0) continue;
    for (const cards of expandCombos(handClass)) {
      if (dead.some(d => sameCard(d, cards[0]) || sameCard(d, cards[1]))) continue;
      out.push({ cards, weight, handClass });
    }
  }
  return out;
}

export function totalWeight(combos: readonly WeightedCombo[]): number {
  let sum = 0;
  for (const c of combos) sum += c.weight;
  return sum;
}

/**
 * 按权重采样一个组合。
 * totalW 由调用方传入，避免在蒙特卡洛内层循环里反复求和。
 */
export function sampleCombo(
  combos: readonly WeightedCombo[],
  totalW: number,
  rng: Rng,
): [Card, Card] {
  if (combos.length === 0) throw new Error('无法从空范围中采样');
  let target = rng.nextFloat() * totalW;
  for (const c of combos) {
    target -= c.weight;
    if (target <= 0) return c.cards;
  }
  // 浮点累加误差导致走到末尾时，返回最后一个
  return combos[combos.length - 1].cards;
}

/** 169 类全在、权重均为 1 的范围 */
export function fullRange(): RangeSet {
  const m = new Map<HandClass, number>();
  for (const hc of allHandClasses()) m.set(hc, 1);
  return m;
}

/** 该范围占全部 1326 种组合的加权比例 */
export function rangeFraction(range: RangeSet): number {
  return totalWeight(rangeCombos(range, [])) / 1326;
}
