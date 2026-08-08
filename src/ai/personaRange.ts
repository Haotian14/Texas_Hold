import type { Position } from '../core/types';
import type { Rng } from '../core/rng';
import type { HandClass } from '../core/handClass';
import type { RangeSet } from '../core/rangeSet';
import { fullRange, rangeFraction, totalWeight } from '../core/rangeSet';
import { rankRange, topFraction } from '../core/rangeStrength';
import { initialRange } from '../core/opponentRange';
import type { Persona } from './personas';

/**
 * rangeWidthMul 判等的容差。它是相对基准范围的一个比例（“宽多少倍”），
 * 不是筹码金额，所以不用 core/chips.ts 的筹码容差——但取同一个量级（1e-9）
 * 是刻意的：六个原型的 rangeWidthMul 之间最小间隔是 0.05（0.55 到多个近邻），
 * 1e-9 比这个间隔小了八个数量级，不可能把两个不同原型误判为相等，只用来
 * 吸收「1 这个中性值被算出来而不是字面量写出来」时可能带的浮点尾数。
 */
const MUL_EPSILON = 1e-9;

/**
 * 给一个座位构造带性格的起手范围。
 *
 * 基准是 initialRange(pos)——该位置的 GTO 开池范围。rangeWidthMul 只改变
 * 「起手拿多宽的范围」，不改变范围内每手牌的相对强弱顺序：
 *
 * - mul === 1（GTO 原型）：原样返回基准范围，不做任何计算。
 * - mul < 1（收紧，如 rock 0.55）：按牌力给基准范围排序，只保留最强的
 *   mul 那一段——这是基准范围的真子集，语义上是「同一份开池范围，只是
 *   打得更紧，弱的那部分不开了」。
 * - mul > 1（放宽，如 maniac 1.90）：基准范围原封不动地保留，再从「不在
 *   基准范围里」的那些牌力类别中挑最强的补充进来，直到总占比达到
 *   rangeFraction(base) * mul（封顶 1）。
 *
 *   之所以不能简单地对 fullRange() 排序后切一刀（"纯牌力范围"），是因为
 *   基准范围本身不是按纯牌力选出来的——UTG 的开池范围里有 A5s 这种为了
 *   可玩性（阻断牌、成同花的潜力）才开的牌，纯按胜率排序会被 88 这类
 *   胜率更高但缺乏这些属性的对子挤掉。"先并入基准范围、再从剩余牌力里
 *   补充" 保住了基准范围的身份：放宽后的范围里，原本该位置就要开的牌
 *   一张都不会因为放宽而消失，只会往里加新的。
 *
 * 翻前没有公共牌，rankRange 在 board 为空时直接查表（见 core/rangeStrength.ts），
 * 不消耗 rng、且与调用者的种子无关——同一手牌无论谁来问，翻前的强弱顺序
 * 都一致。这里仍然要求调用方传 rng 是为了和项目「所有随机性都显式传入」
 * 的约定保持一致，也为未来这个函数按非空 board 调用留下接口空间。
 */
export function personaInitialRange(
  pos: Position,
  persona: Persona,
  rng: Rng,
  strengthIterations = 40,
): RangeSet {
  const base = initialRange(pos);
  const mul = persona.rangeWidthMul;

  if (Math.abs(mul - 1) < MUL_EPSILON) return base;
  if (mul < 1) return tighten(base, mul, strengthIterations, rng);
  return loosen(base, mul, strengthIterations, rng);
}

/** 保留基准范围里最强的 mul 那一份权重（mul 是 [0,1) 内的比例）。 */
function tighten(base: RangeSet, mul: number, strengthIterations: number, rng: Rng): RangeSet {
  if (base.size === 0) return base;
  const ranked = rankRange(base, [], [], strengthIterations, rng);
  return topFraction(ranked, Math.max(0, Math.min(1, mul)));
}

/**
 * 基准范围整体保留，再从「基准范围里没有的部分」按牌力从强到弱补充，
 * 直到总占比达到 rangeFraction(base) * mul（封顶 1）。
 */
function loosen(base: RangeSet, mul: number, strengthIterations: number, rng: Rng): RangeSet {
  const baseFraction = rangeFraction(base);
  const targetFraction = Math.min(1, baseFraction * mul);
  if (targetFraction <= baseFraction) return base;

  // 「不在基准范围里」按权重算，而不是按类别算：基准范围里权重不满 1 的
  // 类别（混合策略）也还留有余量，那部分余量同样算作「未开」，可以被
  // 放宽逻辑继续补满。
  const remaining = new Map<HandClass, number>();
  for (const [hc, w] of fullRange()) {
    const already = base.get(hc) ?? 0;
    const left = w - already;
    if (left > 1e-9) remaining.set(hc, left);
  }
  if (remaining.size === 0) return base;

  const rankedRemaining = rankRange(remaining, [], [], strengthIterations, rng);
  const remainingWeight = totalWeight(rankedRemaining);
  if (remainingWeight <= 0) return base;

  // 需要从「未开」的部分再补进多少权重（以 1326 组合为单位），
  // 换算成「未开部分」自身的比例，交给 topFraction 取最强的那一截。
  const neededWeight = (targetFraction - baseFraction) * 1326;
  const addFraction = Math.max(0, Math.min(1, neededWeight / remainingWeight));
  const added = topFraction(rankedRemaining, addFraction);

  const out = new Map<HandClass, number>(base);
  for (const [hc, w] of added) {
    out.set(hc, Math.min(1, (out.get(hc) ?? 0) + w));
  }
  return out;
}
