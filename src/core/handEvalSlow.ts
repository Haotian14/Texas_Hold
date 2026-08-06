import type { Card } from './cards';
import { HandCategory, pack } from './handScore';

/**
 * 穷举参考实现：慢但显然正确，仅用于测试对拍，生产代码不要调用。
 */

/** 求顺子最高牌，返回 0 表示不是顺子。ranksDesc 必须已按降序排好。 */
function straightHigh(ranksDesc: number[]): number {
  const uniq = [...new Set(ranksDesc)];
  if (uniq.length !== 5) return 0;
  if (uniq[0] - uniq[4] === 4) return uniq[0];
  // 轮子 A-5-4-3-2：A 当作 1 用，顺子最高牌记为 5
  if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) return 5;
  return 0;
}

export function evaluate5Slow(cards: Card[]): number {
  if (cards.length !== 5) throw new Error(`evaluate5Slow 需要 5 张牌，收到 ${cards.length}`);

  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const isFlush = cards.every(c => c.suit === cards[0].suit);

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);

  // 先按出现次数降序，次数相同再按点数降序
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map(g => g[1]).join('');
  const ordered = groups.map(g => g[0]);

  const sHigh = straightHigh(ranks);

  if (isFlush && sHigh) return pack(HandCategory.StraightFlush, [sHigh]);
  if (shape === '41') return pack(HandCategory.Quads, ordered);
  if (shape === '32') return pack(HandCategory.FullHouse, ordered);
  if (isFlush) return pack(HandCategory.Flush, ordered);
  if (sHigh) return pack(HandCategory.Straight, [sHigh]);
  if (shape === '311') return pack(HandCategory.Trips, ordered);
  if (shape === '221') return pack(HandCategory.TwoPair, ordered);
  if (shape === '2111') return pack(HandCategory.OnePair, ordered);
  return pack(HandCategory.HighCard, ordered);
}

/** 穷举 C(7,5) = 21 种组合，取最强的一组 */
export function evaluate7Slow(cards: Card[]): number {
  if (cards.length !== 7) throw new Error(`evaluate7Slow 需要 7 张牌，收到 ${cards.length}`);

  let best = 0;
  // a、b 是被排除的两张牌的下标
  for (let a = 0; a < 7; a++) {
    for (let b = a + 1; b < 7; b++) {
      const five: Card[] = [];
      for (let i = 0; i < 7; i++) {
        if (i !== a && i !== b) five.push(cards[i]);
      }
      const score = evaluate5Slow(five);
      if (score > best) best = score;
    }
  }
  return best;
}
