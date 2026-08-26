import type { Card } from './cards';
import type { Rng } from './rng';
import type { ActionType, Position, Street } from './types';
import { chipsGreater } from './chips';
import type { HandClass } from './handClass';
import type { RangeSet } from './rangeSet';
import { fullRange } from './rangeSet';
import { rankRange, topFraction } from './rangeStrength';
import { rfiKey, hasNode, rangeForAction } from './ranges';
import type { PreflopAction } from './ranges';
import type { PreflopNode } from './preflopNode';

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
  /**
   * 仅翻前有意义：**行动者**此刻适用的范围表节点，由调用方传
   * `preflopNodeFor(动作发生前的 GameState)` 得到 —— 那个状态的 `toAct`
   * 正是即将行动的这个人，所以拿到的就是他自己的节点，不是 hero 的。
   *
   * 传了且表里有对应动作时，翻前走查表收窄（见 narrowPreflopByTable）；
   * 不传、或表里没有这个动作，回落到按尺度的机械式收窄。
   */
  preflopNode?: PreflopNode | null;
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
  const strong = topFraction(ranked, Math.max(0, Math.min(1, drop)));
  const out = new Map<HandClass, number>();
  for (const [hc, w] of range) {
    // topFraction 可能只切走某个类别的一部分权重，这里按比例扣减，
    // 而不是整类删除 —— 后者会让「剔除最强两成」实际剔掉三成以上，
    // 并把只含单一类别的范围直接清空。
    const removed = strong.get(hc) ?? 0;
    const remaining = w - removed;
    if (remaining > 0) out.set(hc, remaining);
  }
  return out;
}

/** 把比例夹进 [lo, hi]，并保证落在 [0, 1] 内 */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(0, Math.min(1, Math.max(lo, Math.min(hi, v))));
}

/**
 * 机械式收窄的保留比例地板。
 *
 * MDF 是**防守方**面对该尺度必须跟注的比例，不是「下注方只用手里最强的
 * 这一档下注」。旧实现直接把它当保留比例，等价于假设对手零诈唬：一个
 * 平衡的下注范围里总有诈唬成分，宽度远大于 MDF。地板就是这句话的下限
 * 形式 —— 无论尺度多大，进攻动作都不会把范围收到比这更窄。
 *
 * 三个动作的地板依次收紧（下注 > 加注 > 全下），乘数也依次收紧，这样
 * 「加注比下注窄、全下比加注窄、尺度越大越窄」这几条方向性性质在夹紧
 * 之后仍然成立。
 */
const KEEP_FLOOR = {
  bet:   { mul: 1,    lo: 0.55, hi: 0.85 },
  raise: { mul: 0.75, lo: 0.35, hi: 0.60 },
  allin: { mul: 0.60, lo: 0.22, hi: 0.45 },
  /** 跟注只压下限：跟注方本来就该按 MDF 防守，上限不需要额外收 */
  call:  { mul: 1,    lo: 0.60, hi: 1 },
} as const;

/**
 * 翻前按范围表收窄（设计文档 §8.5「GTO 模式用范围表收窄」）。
 *
 * 返回 null 表示这一步表里没有答案，调用方应回落到机械式收窄。
 *
 * 三条规则：
 *
 * - **开池（rfi）不收窄。** 该位置的 RFI 范围本身就是他这次加注的范围 ——
 *   他拿这些牌全都会开池，「他开池了」提供的增量信息接近于零。旧实现把
 *   开池当成最强信号（走 raise 分支、3bb 开池只保留最强的 20%），是
 *   AKo 单挑胜率只有 41% 的直接原因。
 * - **面对开池 / 面对 3bet，查该节点对应动作的范围。** 表里存的正是这些
 *   节点上 3bet / 4bet / 跟注各自该拿什么牌，比按尺度切一刀精确得多。
 * - **取交集而不是直接替换。** 逐类别取 min，结果始终是行动者当前范围的
 *   子集，性格因此不会被表抹掉：岩石的 3bet 范围 = 表的 3bet ∩ 他收紧过
 *   的开池范围。
 *
 * 已知近似：交集只会让范围**更窄**，所以比表更宽的性格（疯子、跟注站）
 * 3bet 时会被按 GTO 的 3bet 范围建模，宽度被低估。相比旧实现把范围压到
 * 2.3% 这已经好得多，但要按性格把表整体放宽，得先把 ai/personaRange.ts
 * 的 loosen/tighten 挪进 core，留作后续。
 */
function narrowPreflopByTable(
  range: RangeSet,
  actionType: ActionType,
  node: PreflopNode,
): RangeSet | null {
  // 开池：范围原样保留
  if (node.kind === 'rfi' && (actionType === 'raise' || actionType === 'bet')) return range;

  const action = tableActionFor(node, actionType);
  if (!action) return null;

  const tableRange = rangeForAction(node.key, action);
  if (!tableRange) return null;

  const out = new Map<HandClass, number>();
  for (const [hc, w] of range) {
    const t = tableRange.get(hc) ?? 0;
    const keep = Math.min(w, t);
    if (keep > 0) out.set(hc, keep);
  }
  // 交集为空：行动者的范围与表在这个节点上不相交（性格把范围收得比表还偏），
  // 表回答不了这一步，回落机械式 —— 绝不能产出空范围，那等于把他判成弃牌。
  if (out.size === 0) return null;
  return out;
}

/**
 * 把引擎的动作类型映射到范围表里的动作名。
 *
 * 与 review/judge.ts::preflopActionKey 同源，但**只用于收窄**，两处刻意
 * 不合并：那边回答「用户选的动作在表里叫什么」，含 fold（fold 在表里是
 * 补集，有频率可查）；这里回答「用这个动作的哪份范围去收窄」，fold 由
 * narrowByAction 在最前面短路成空范围，永远走不到这里。
 *
 * allin 不映射：开池全下、3bet 全下都不是表里那份「标准尺度的加注范围」，
 * 交给机械式按尺度处理更诚实。
 */
function tableActionFor(node: PreflopNode, actionType: ActionType): PreflopAction | null {
  if (actionType === 'call') return 'call';
  if (actionType === 'raise' || actionType === 'bet') {
    if (node.kind === 'vs-open') return '3bet';
    if (node.kind === 'vs-3bet') return '4bet';
  }
  return null;
}

/**
 * 按对手的一个动作收窄其范围。
 *
 * 翻前优先查范围表（ctx.preflopNode，见 narrowPreflopByTable）；查不到时
 * 与翻后一样走机械式：下注/加注保留强的那一端，过牌剔除强的那一端，跟注
 * 居中，尺度越大收得越紧。
 *
 * 机械式用 MDF（底池 / (底池 + 下注额)）作为保留比例的**基准**，但会被
 * KEEP_FLOOR 夹进一个区间 —— MDF 本身是防守方的跟注频率，直接拿它当
 * 下注方的范围宽度会把范围收得离谱地窄，见 KEEP_FLOOR 上的说明。
 */
export function narrowByAction(
  range: RangeSet,
  actionType: ActionType,
  ctx: NarrowContext,
): RangeSet {
  if (actionType === 'fold') return new Map();
  if (range.size === 0) return range;

  if (ctx.street === 'preflop' && ctx.preflopNode) {
    const byTable = narrowPreflopByTable(range, actionType, ctx.preflopNode);
    if (byTable) return byTable;
  }

  const mdf = chipsGreater(ctx.potBefore, 0)
    ? ctx.potBefore / (ctx.potBefore + Math.max(0, ctx.betSize))
    : 1;
  const keepBy = (k: typeof KEEP_FLOOR[keyof typeof KEEP_FLOOR]) => clamp(mdf * k.mul, k.lo, k.hi);

  switch (actionType) {
    case 'check':
      // 强牌通常会下注，过牌剔除最强的两成
      return dropTop(range, 0.2, ctx);

    case 'call':
      // 保留 MDF 比例的最强部分（能继续的牌），
      // 最强的牌通常会加注而不是跟注，故再剔除顶端一成
      return dropTop(keepTop(range, keepBy(KEEP_FLOOR.call), ctx), 0.1, ctx);

    case 'bet':
      // 下注：保留强的一端，尺度越大越紧
      return keepTop(range, keepBy(KEEP_FLOOR.bet), ctx);

    case 'raise':
      // 加注比下注强，收得更紧
      return keepTop(range, keepBy(KEEP_FLOOR.raise), ctx);

    case 'allin':
      // 全下：保留得最窄。乘数与地板都比加注更紧，这样任何尺度下
      // 「全下不宽于加注」都成立 —— 写死常数会让加注在超过约 1.4 倍底池
      // 的尺度下反而比全下更窄。
      return keepTop(range, keepBy(KEEP_FLOOR.allin), ctx);

    default:
      return range;
  }
}
