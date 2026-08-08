import type { Card } from './cards';
import { makeDeck, sameCard } from './cards';
import type { Rng } from './rng';
import { createRng } from './rng';
import type { HandClass } from './handClass';
import { allHandClasses, expandCombos } from './handClass';
import type { RangeSet, WeightedCombo } from './rangeSet';
import { rangeCombos, totalWeight } from './rangeSet';
import { evaluate7 } from './handEval';
import { equityMonteCarlo } from './equity';

export interface RankedCombo extends WeightedCombo {
  /** 该组合对一个随机手的胜率，0..1 */
  strength: number;
}

/** 一轮共享采样：一次公共牌补牌 + 一手对手底牌，对手分值预先算好。 */
interface Sample {
  fullBoard: Card[];
  oppCards: readonly [Card, Card];
  oppScore: number;
}

/** 翻前牌力表：类别 -> 对一个随机手的胜率。整个进程只算一次。 */
let preflopTable: Map<HandClass, number> | null = null;

/** 计算翻前牌力表用的固定种子与样本数。固定是刻意的 —— 表必须与调用方的种子无关。 */
const PREFLOP_TABLE_SEED = 'preflop-strength-table';
const PREFLOP_TABLE_SAMPLES = 1500;

function buildPreflopTable(): Map<HandClass, number> {
  const rng = createRng(PREFLOP_TABLE_SEED);
  const table = new Map<HandClass, number>();
  // 每个类别取其第一个具体组合来估强度 —— 同一类别的组合在翻前是同构的
  for (const hc of allHandClasses()) {
    const cards = expandCombos(hc)[0];
    table.set(hc, equityMonteCarlo(cards, [], 1, PREFLOP_TABLE_SAMPLES, rng));
  }
  return table;
}

/**
 * 预热翻前牌力表。可选 —— 不调用的话第一次翻前排序会自动建表。
 * 想把建表开销挪到启动阶段而不是第一次决策时，就调用它。
 */
export function warmPreflopStrength(): void {
  if (!preflopTable) preflopTable = buildPreflopTable();
}

/**
 * 给范围里的每个组合打上牌力分，按强度降序返回。
 *
 * 牌力定义为「对一个随机手的胜率」：它对翻前和每条街都有定义、单调、
 * 且不依赖于对手的对手是谁。牌型分值只在河牌圈才完整，翻牌圈无法比较
 * 听牌与小对子，因此不适合做排序键。
 *
 * 实现上用「公共随机数」：先抽出 iterations 组共享样本（补牌 + 一手对手
 * 底牌），对手分值只算一次；再让每个组合去对同一批样本评分，跳过与自己
 * 两张牌冲突的样本。跳过是精确的拒绝采样，所以每个组合的 strength 仍然
 * 是无偏估计。
 *
 * 这么做的理由是**性能**：对手分值从「算 combos 遍」降到「算 iterations 遍」，
 * 建牌堆从 combos 次降到 1 次。实测约 2.2 倍（翻前 91.5ms -> 41.3ms，
 * 翻牌 86.4ms -> 37.5ms）。
 *
 * 曾经以为它还能让排序更稳定 —— 共享误差在两两比较时抵消。**实测证伪**：
 * 用 topFraction(…, 0.5) 的键集在多个种子间的 Jaccard 一致度衡量，
 * 共享采样 0.805、逐个独立采样 0.823（再加 24 个种子复核为 0.796 vs 0.845，
 * 方向一致）。原因是消费方用的不是两两比较而是切点位置：独立采样时各组合
 * 噪声互相独立、聚合到集合层面会部分抵消；共享采样时一批不走运的样本会让
 * 所有组合一起偏移，切点整体移动。保留本实现是为了速度，不要再把
 * 「排序更稳」写进理由里。
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
  if (combos.length === 0) return [];

  // 翻前没有公共牌，查表即可 —— 这是 AI 决策预算里最大的一项。表是对着一整副
  // 牌算出来的，没有扣掉调用方那手牌里的死牌，所以丢掉了换牌效应：旧的抽样
  // 路径会从「牌堆减死牌」里抽对手底牌，剔除一张 A 会让 KK 对「随机手」的
  // 胜率略微升高，查表拿不到这个量。这是近似，不是恒等式——但换牌效应对每个
  // 类别都是同向的（common-mode），排序不受影响，量级也小于表本身的采样噪声
  // （PREFLOP_TABLE_SAMPLES 次蒙特卡洛自带的误差）。
  // 查表结果与传入的 rng 无关，这是刻意的：同一手牌无论谁来问、用什么种子，
  // 翻前的强弱顺序都应当一致。
  if (board.length === 0) {
    if (!preflopTable) preflopTable = buildPreflopTable();
    const out: RankedCombo[] = combos.map(c => ({
      ...c,
      strength: preflopTable!.get(c.handClass) ?? 0,
    }));
    out.sort((a, b) => b.strength - a.strength);
    return out;
  }

  const pool = makeDeck().filter(c => !dead.some(d => sameCard(d, c)));
  const boardNeeded = 5 - board.length;
  const drawCount = boardNeeded + 2; // 补牌 + 对手两张

  if (drawCount > pool.length) {
    throw new Error(`牌不够：需要抽 ${drawCount} 张，牌堆只剩 ${pool.length} 张`);
  }

  const samples: Sample[] = new Array(iterations);
  const drawn: Card[] = new Array(drawCount);

  for (let iter = 0; iter < iterations; iter++) {
    // 部分 Fisher-Yates：只打乱前 drawCount 张，避免每轮复制整副牌
    for (let i = 0; i < drawCount; i++) {
      const j = i + rng.nextInt(pool.length - i);
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
      drawn[i] = pool[i];
    }

    const fullBoard = board.concat(drawn.slice(0, boardNeeded));
    const oppCards: [Card, Card] = [drawn[boardNeeded], drawn[boardNeeded + 1]];
    const oppScore = evaluate7([oppCards[0], oppCards[1], ...fullBoard]);
    samples[iter] = { fullBoard, oppCards, oppScore };
  }

  const out: RankedCombo[] = combos.map(c => {
    let total = 0;
    let used = 0;
    for (const s of samples) {
      if (
        sameCard(c.cards[0], s.oppCards[0]) ||
        sameCard(c.cards[0], s.oppCards[1]) ||
        sameCard(c.cards[1], s.oppCards[0]) ||
        sameCard(c.cards[1], s.oppCards[1]) ||
        s.fullBoard.some(bc => sameCard(bc, c.cards[0]) || sameCard(bc, c.cards[1]))
      ) {
        continue; // 与该组合的两张牌冲突，本样本对它不可用
      }

      const heroScore = evaluate7([c.cards[0], c.cards[1], ...s.fullBoard]);
      if (heroScore > s.oppScore) total += 1;
      else if (heroScore === s.oppScore) total += 0.5;
      used++;
    }
    // 极端情况：该组合与每一份共享样本都冲突，没有可用估计，给 0 而不是除以零，
    // 但仍要出现在输出里，保持「range 里有多少组合，输出就有多少条」这个子集性质。
    return { ...c, strength: used === 0 ? 0 : total / used };
  });

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
