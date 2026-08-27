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
 * 采样器：把一份组合表的权重前缀和预先算好，之后每次采样二分定位。
 *
 * 存在的理由是**热点**：equity.ts 的蒙特卡洛内层循环对每个对手、每轮迭代都要
 * 采一次样，冲突时还要重采（最多 100 次）。原实现每次采样都从头累减权重，
 * 单次采样是 O(组合数)——范围越宽越慢，而弃牌率改成价格模型之后继续范围
 * 普遍变宽（拿得动的牌不会因为尺度大就被切掉），实测单次 AI 决策从 105ms
 * 涨到 138ms，正是被这条 O(n) 扫描吃掉的。前缀和 + 二分把它降到 O(log n)。
 *
 * 前缀和只在组合表建好时算一次，与迭代次数无关，所以这个结构必须由调用方
 * 在循环外准备好、循环内反复使用——这也是把它做成显式类型而不是让
 * sampleCombo 自己临时算的原因：临时算等于把 O(n) 换个地方再付一遍。
 */
export interface ComboSampler {
  readonly combos: readonly WeightedCombo[];
  /** 权重前缀和：cumulative[i] = combos[0..i] 的权重之和，末项即总权重 */
  readonly cumulative: Float64Array;
}

/** 给一份组合表算好前缀和。O(n)，调用方应当在蒙特卡洛循环外调用一次。 */
export function prepareSampler(combos: readonly WeightedCombo[]): ComboSampler {
  const cumulative = new Float64Array(combos.length);
  let sum = 0;
  for (let i = 0; i < combos.length; i++) {
    sum += combos[i].weight;
    cumulative[i] = sum;
  }
  return { combos, cumulative };
}

/**
 * 按权重采样一个组合。每次采样只消耗一个 rng.nextFloat()，与旧的线性实现
 * 一致——随机流的消耗量不变，同 seed 的可复现性因此不受这次优化影响。
 *
 * rangeCombos 已经把权重 ≤ 0 的类别整类跳过（见上面），所以前缀和严格递增、
 * 不存在零宽区间，二分落点唯一。
 */
export function sampleCombo(sampler: ComboSampler, rng: Rng): [Card, Card] {
  const { combos, cumulative } = sampler;
  if (combos.length === 0) throw new Error('无法从空范围中采样');
  const target = rng.nextFloat() * cumulative[cumulative.length - 1];
  // 二分找第一个前缀和大于 target 的位置。与旧实现（逐个累减、减到 ≤0 为止）
  // 只在「前缀和恰好等于 target」这个概率为零的边界上可能选到相邻的另一个。
  let lo = 0;
  let hi = combos.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] > target) hi = mid;
    else lo = mid + 1;
  }
  return combos[lo].cards;
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
