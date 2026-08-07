import type { Card } from './cards';
import type { Rng } from './rng';
import type { ActionType, Position, Street } from './types';
import { chipsGreater } from './chips';
import type { RangeSet } from './rangeSet';
import { fullRange } from './rangeSet';
import { rankRange, topFraction } from './rangeStrength';
import { rfiKey, hasNode, rangeForAction } from './ranges';

/** 该位置的默认起手范围。无 RFI 表的位置（大盲）回落到全范围。 */
export function initialRange(pos: Position): RangeSet {
  const key = rfiKey(pos);
  if (hasNode(key)) {
    const r = rangeForAction(key, 'raise');
    if (r) return r;
  }
  return fullRange();
}

export interface NarrowContext {
  street: Street;
  board: Card[];
  /** 已知不可能在对手手里的牌：hero 底牌 + 公共牌 */
  dead: readonly Card[];
  /** 该动作发生前的底池 */
  potBefore: number;
  /** 该动作的下注/加注额；非下注动作可传 0 */
  betSize: number;
  /** 牌力排序的迭代数 */
  strengthIterations: number;
  rng: Rng;
}

/** 保留最强的 keep 比例 */
function keepTop(range: RangeSet, keep: number, ctx: NarrowContext): RangeSet {
  if (range.size === 0) return range;
  const ranked = rankRange(range, ctx.board, ctx.dead, ctx.strengthIterations, ctx.rng);
  return topFraction(ranked, Math.max(0, Math.min(1, keep)));
}

/** 剔除最强的 drop 比例，保留其余 */
function dropTop(range: RangeSet, drop: number, ctx: NarrowContext): RangeSet {
  if (range.size === 0) return range;
  const ranked = rankRange(range, ctx.board, ctx.dead, ctx.strengthIterations, ctx.rng);
  const keepFrom = Math.max(0, Math.min(1, drop));
  const strong = topFraction(ranked, keepFrom);
  const out = new Map<string, number>();
  for (const [hc, w] of range) {
    if (!strong.has(hc)) out.set(hc, w);
  }
  return out;
}

/**
 * 按对手的一个动作收窄其范围。
 *
 * 下注/加注保留强的那一端，过牌剔除强的那一端，跟注居中。
 * 尺度越大收得越紧 —— 用 MDF（底池 / (底池 + 下注额)）作为保留比例的基准，
 * 它正是理论上面对该尺度必须防守的比例。
 */
export function narrowByAction(
  range: RangeSet,
  actionType: ActionType,
  ctx: NarrowContext,
): RangeSet {
  if (actionType === 'fold') return new Map();
  if (range.size === 0) return range;

  const mdf = chipsGreater(ctx.potBefore, 0)
    ? ctx.potBefore / (ctx.potBefore + Math.max(0, ctx.betSize))
    : 1;

  switch (actionType) {
    case 'check':
      // 强牌通常会下注，过牌剔除最强的两成
      return dropTop(range, 0.2, ctx);

    case 'call':
      // 保留 MDF 比例的最强部分（能继续的牌），
      // 最强的牌通常会加注而不是跟注，故再剔除顶端一成
      return dropTop(keepTop(range, mdf, ctx), 0.1, ctx);

    case 'bet':
      // 下注：保留强的一端，尺度越大越紧
      return keepTop(range, Math.min(0.8, mdf), ctx);

    case 'raise':
      // 加注比下注强，收得更紧
      return keepTop(range, Math.min(0.5, mdf * 0.6), ctx);

    case 'allin':
      // 全下：只保留最强的一小部分
      return keepTop(range, 0.25, ctx);

    default:
      return range;
  }
}
