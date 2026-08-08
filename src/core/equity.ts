import type { Card } from './cards';
import { makeDeck, sameCard } from './cards';
import { evaluate7 } from './handEval';
import type { Rng } from './rng';
import type { RangeSet, WeightedCombo } from './rangeSet';
import { rangeCombos, totalWeight, sampleCombo } from './rangeSet';

/** 采样无解：几个对手的范围在物理上不可能同时成立（比如都只剩 AA，而牌桌只有四张 A）。 */
export class InfeasibleSamplingError extends Error {}

/** 从整副牌里剔除已知牌 */
function remainingDeck(known: Card[]): Card[] {
  return makeDeck().filter(c => !known.some(k => sameCard(k, c)));
}

/**
 * 蒙特卡洛胜率。对手手牌按随机手处理。
 * 平局按 1/并列人数 计入，因此返回的是「期望份额」而非纯胜率。
 */
export function equityMonteCarlo(
  hero: [Card, Card],
  board: Card[],
  opponentCount: number,
  iterations: number,
  rng: Rng,
): number {
  const known = [...hero, ...board];
  const pool = remainingDeck(known);
  const boardNeeded = 5 - board.length;
  const drawCount = boardNeeded + opponentCount * 2;

  if (drawCount > pool.length) {
    throw new Error(`牌不够：需要抽 ${drawCount} 张，牌堆只剩 ${pool.length} 张`);
  }

  let total = 0;
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
    const heroScore = evaluate7([hero[0], hero[1], ...fullBoard]);

    let ties = 1;
    let beaten = false;
    for (let o = 0; o < opponentCount; o++) {
      const base = boardNeeded + o * 2;
      const oppScore = evaluate7([drawn[base], drawn[base + 1], ...fullBoard]);
      if (oppScore > heroScore) {
        beaten = true;
        break;
      }
      if (oppScore === heroScore) ties++;
    }

    if (!beaten) total += 1 / ties;
  }

  return total / iterations;
}

/**
 * 单对手精确胜率：穷举对手所有可能的两张底牌与所有可能的剩余公共牌。
 * 只在剩余未知牌较少时使用（转牌 / 河牌），翻前调用会极慢。
 */
export function equityExactVsOne(hero: [Card, Card], board: Card[]): number {
  // 空/翻前公共牌（board.length < 3）会先枚举 C(50,5) = 2,118,760 种
  // 剩余公共牌组合，再对每种组合穷举约 990 手对手牌，调用会先吃光内存
  // 再卡死。翻牌圈起（board.length >= 3，最多穷举 C(45,2) 种转+河组合）
  // 计算量可控；翻前请改用 equityMonteCarlo。
  if (board.length < 3) {
    throw new Error(
      `equityExactVsOne 只支持翻牌圈及以后调用（board.length >= 3），实际为 ${board.length}；翻前请用 equityMonteCarlo`,
    );
  }

  const known = [...hero, ...board];
  const pool = remainingDeck(known);
  const boardNeeded = 5 - board.length;

  let total = 0;
  let count = 0;

  const runouts: Card[][] = [];
  collectCombos(pool, boardNeeded, 0, [], runouts);

  for (const runout of runouts) {
    const fullBoard = board.concat(runout);
    const heroScore = evaluate7([hero[0], hero[1], ...fullBoard]);
    const oppPool = pool.filter(c => !runout.some(r => sameCard(r, c)));

    for (let i = 0; i < oppPool.length; i++) {
      for (let j = i + 1; j < oppPool.length; j++) {
        const oppScore = evaluate7([oppPool[i], oppPool[j], ...fullBoard]);
        if (heroScore > oppScore) total += 1;
        else if (heroScore === oppScore) total += 0.5;
        count++;
      }
    }
  }

  return count === 0 ? 0 : total / count;
}

/** 收集 pool 中所有 k 元组合 */
function collectCombos(
  pool: Card[],
  k: number,
  start: number,
  acc: Card[],
  out: Card[][],
): void {
  if (acc.length === k) {
    out.push([...acc]);
    return;
  }
  for (let i = start; i < pool.length; i++) {
    acc.push(pool[i]);
    collectCombos(pool, k, i + 1, acc, out);
    acc.pop();
  }
}

/**
 * 对手按各自范围采样的蒙特卡洛胜率。
 * 平局按 1/并列人数 计入，与 equityMonteCarlo 语义一致。
 * 注意：多个对手时，各对手手牌是按顺序依次采样并做冲突剔除的，
 * 后采样的对手其归一化分母依赖于前面对手实际抽到了哪些牌，
 * 因此"前一个对手恰好挡住后一个对手范围里某些组合"的牌面组合
 * 会被轻微地过度加权——单一对手时这一效应严格为零，宽范围下也可忽略，
 * 但这不是精确的多人范围对范围求解。
 */
export function equityVsRanges(
  hero: [Card, Card],
  board: Card[],
  opponentRanges: readonly RangeSet[],
  iterations: number,
  rng: Rng,
): number {
  // iterations <= 0 是调用方的配置错误（比如 EvOptions.iterations 传成 0 或负数），
  // 不是「牌面凑不出解」——两者不该混为一谈。不加这道 guard，下面的循环一次都不
  // 会跑，counted 恒为 0，会被底部的 `counted === 0` 分支当成 InfeasibleSamplingError
  // 抛出；estimateEv 只捕获 InfeasibleSamplingError 并静默宽范围重试，一个纯粹的
  // 参数错误就这样被当成物理无解吞掉，重试出一个看似正常、实则毫无意义的数字。
  // 用不同的错误类型把两者分开：调用方传错参数应该让调用直接失败，而不是被
  // 兜底路径悄悄抹平。
  if (iterations <= 0) {
    throw new Error(`equityVsRanges 的 iterations 必须为正数，收到 ${iterations}`);
  }

  if (opponentRanges.length === 0) throw new Error('至少需要一个对手范围');

  const known = [...hero, ...board];
  const boardNeeded = 5 - board.length;

  // 各对手的可用组合在整轮中固定，先展开一次
  const combosPerOpp: WeightedCombo[][] = [];
  const totalsPerOpp: number[] = [];
  for (let i = 0; i < opponentRanges.length; i++) {
    const combos = rangeCombos(opponentRanges[i], known);
    if (combos.length === 0) {
      // 语义上这就是「采样无解」的一种：范围与已知死牌不能同时成立——
      // 不只是多个对手范围互相冲突会导致这种情况，hero 自己的底牌加公共牌
      // 单独就能把一个已经收窄到很小的类别（比如 AA）挤空。必须抛
      // InfeasibleSamplingError，而不是裸 Error —— evEstimate.ts 的两处
      // 调用点都只捕获 InfeasibleSamplingError 并宽范围重试，其余错误一律
      // 原样重新抛出；裸 Error 会直接逃出 estimateEv。
      throw new InfeasibleSamplingError(`第 ${i} 个对手的范围在剔除死牌后为空`);
    }
    combosPerOpp.push(combos);
    totalsPerOpp.push(totalWeight(combos));
  }

  const pool = remainingDeck(known);
  if (boardNeeded > pool.length - opponentRanges.length * 2) {
    throw new Error(`牌不够：需要补 ${boardNeeded} 张公共牌，牌堆只剩 ${pool.length} 张`);
  }

  let total = 0;
  let counted = 0;
  const oppCards: Array<[Card, Card]> = new Array(opponentRanges.length);

  for (let iter = 0; iter < iterations; iter++) {
    // 先为每个对手采样（只需避开 hero 底牌、已知公共牌与其他对手），
    // 再从剩下的牌堆里抽公共牌 —— 顺序很重要：如果先抽公共牌再采样对手，
    // 公共牌会是从「对手那两张牌仍在牌堆里」的全量牌堆抽出的，导致对手范围
    // 集中的点数（比如 KK 范围里的 K）在公共牌里出现的频率系统性偏高。
    const used: Card[] = [...known];
    let ok = true;
    for (let o = 0; o < opponentRanges.length; o++) {
      let picked: [Card, Card] | null = null;
      for (let attempt = 0; attempt < 100; attempt++) {
        const cand = sampleCombo(combosPerOpp[o], totalsPerOpp[o], rng);
        const clash = used.some(u => sameCard(u, cand[0]) || sameCard(u, cand[1]));
        if (!clash) { picked = cand; break; }
      }
      if (!picked) { ok = false; break; }
      oppCards[o] = picked;
      used.push(picked[0], picked[1]);
    }
    if (!ok) continue;   // 本轮作废，不计入分母

    // 从牌堆里剔除已被对手用掉的牌，再抽公共牌
    const oppUsed = used.slice(known.length);
    const iterPool = pool.filter(c => !oppUsed.some(u => sameCard(u, c)));
    if (boardNeeded > iterPool.length) { continue; }   // 极端情况：牌不够，本轮作废

    const runout: Card[] = new Array(boardNeeded);
    for (let i = 0; i < boardNeeded; i++) {
      const j = i + rng.nextInt(iterPool.length - i);
      const tmp = iterPool[i];
      iterPool[i] = iterPool[j];
      iterPool[j] = tmp;
      runout[i] = iterPool[i];
    }

    const fullBoard = board.concat(runout);
    const heroScore = evaluate7([hero[0], hero[1], ...fullBoard]);

    let ties = 1;
    let beaten = false;
    for (let o = 0; o < opponentRanges.length; o++) {
      const s = evaluate7([oppCards[o][0], oppCards[o][1], ...fullBoard]);
      if (s > heroScore) { beaten = true; break; }
      if (s === heroScore) ties++;
    }

    if (!beaten) total += 1 / ties;
    counted++;
  }

  if (counted === 0) throw new InfeasibleSamplingError('所有采样轮次都因牌面冲突作废，无法估算胜率');
  return total / counted;
}
