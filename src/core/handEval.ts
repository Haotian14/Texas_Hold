import type { Card, Suit } from './cards';
import { HandCategory, pack } from './handScore';

const SUIT_INDEX: Record<Suit, number> = { s: 0, h: 1, d: 2, c: 3 };

/**
 * 从点数位掩码求顺子最高牌，0 表示无顺子。
 * A 额外映射到 bit 1，用于识别轮子 A-5-4-3-2。
 */
function straightHighFromMask(mask: number): number {
  const m = mask | (((mask >> 14) & 1) << 1);
  for (let high = 14; high >= 5; high--) {
    const need =
      (1 << high) |
      (1 << (high - 1)) |
      (1 << (high - 2)) |
      (1 << (high - 3)) |
      (1 << (high - 4));
    if ((m & need) === need) return high;
  }
  return 0;
}

/** 从掩码里取最大的 n 个点数，降序 */
function topN(mask: number, n: number): number[] {
  const out: number[] = [];
  for (let r = 14; r >= 2 && out.length < n; r--) {
    if (mask & (1 << r)) out.push(r);
  }
  return out;
}

/** 排除指定点数后取最大的 n 个 */
function topNExcept(mask: number, exclude: number[], n: number): number[] {
  let m = mask;
  for (const r of exclude) m &= ~(1 << r);
  return topN(m, n);
}

/**
 * 7 张牌的最佳牌型分值。与 evaluate7Slow 结果逐位一致，但快得多。
 */
export function evaluate7(cards: Card[]): number {
  if (cards.length !== 7) throw new Error(`evaluate7 需要 7 张牌，收到 ${cards.length}`);

  const rankCount = new Int8Array(15);
  const suitCount = new Int8Array(4);
  const suitMask = new Int32Array(4);
  let rankMask = 0;

  for (let i = 0; i < 7; i++) {
    const c = cards[i];
    rankCount[c.rank]++;
    const si = SUIT_INDEX[c.suit];
    suitCount[si]++;
    suitMask[si] |= 1 << c.rank;
    rankMask |= 1 << c.rank;
  }

  // 7 张牌最多只可能有一种花色达到 5 张
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) {
    if (suitCount[s] >= 5) {
      flushSuit = s;
      break;
    }
  }

  if (flushSuit >= 0) {
    const sfHigh = straightHighFromMask(suitMask[flushSuit]);
    if (sfHigh) return pack(HandCategory.StraightFlush, [sfHigh]);
  }

  let quad = 0;
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let r = 14; r >= 2; r--) {
    const n = rankCount[r];
    if (n === 4) quad = r;
    else if (n === 3) trips.push(r);
    else if (n === 2) pairs.push(r);
  }

  if (quad) {
    const kicker = topNExcept(rankMask, [quad], 1);
    return pack(HandCategory.Quads, [quad, kicker[0]]);
  }
  // 7 张最多两组三条（3+3+1）
  if (trips.length >= 2) return pack(HandCategory.FullHouse, [trips[0], trips[1]]);
  if (trips.length === 1 && pairs.length >= 1) {
    return pack(HandCategory.FullHouse, [trips[0], pairs[0]]);
  }
  if (flushSuit >= 0) return pack(HandCategory.Flush, topN(suitMask[flushSuit], 5));

  const sHigh = straightHighFromMask(rankMask);
  if (sHigh) return pack(HandCategory.Straight, [sHigh]);

  if (trips.length === 1) {
    return pack(HandCategory.Trips, [trips[0], ...topNExcept(rankMask, [trips[0]], 2)]);
  }
  if (pairs.length >= 2) {
    return pack(HandCategory.TwoPair, [
      pairs[0],
      pairs[1],
      topNExcept(rankMask, [pairs[0], pairs[1]], 1)[0],
    ]);
  }
  if (pairs.length === 1) {
    return pack(HandCategory.OnePair, [pairs[0], ...topNExcept(rankMask, [pairs[0]], 3)]);
  }
  return pack(HandCategory.HighCard, topN(rankMask, 5));
}
