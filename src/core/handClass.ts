import type { Card, Rank, Suit } from './cards';
import { SUITS } from './cards';

/** 169 种起手牌类别之一：'AA' / 'AKs' / 'AKo' */
export type HandClass = string;

/** 下标 0 对应点数 2，下标 12 对应 A */
export const RANK_CHARS = '23456789TJQKA';

/** 点数下标（0..12）转成 Rank（2..14） */
function idxToRank(idx: number): Rank {
  return (idx + 2) as Rank;
}

/** 把两张具体的牌归类到 169 种起手牌之一 */
export function classifyHand(a: Card, b: Card): HandClass {
  const hi = a.rank >= b.rank ? a : b;
  const lo = a.rank >= b.rank ? b : a;
  const h = RANK_CHARS[hi.rank - 2];
  const l = RANK_CHARS[lo.rank - 2];
  if (hi.rank === lo.rank) return h + l;
  return h + l + (a.suit === b.suit ? 's' : 'o');
}

export interface ParsedHandClass {
  /** 大牌的点数下标 0..12 */
  hiIdx: number;
  /** 小牌的点数下标 0..12 */
  loIdx: number;
  kind: 'pair' | 's' | 'o';
}

export function parseHandClass(hc: HandClass): ParsedHandClass {
  const hiIdx = RANK_CHARS.indexOf(hc[0]);
  const loIdx = RANK_CHARS.indexOf(hc[1]);
  if (hiIdx < 0 || loIdx < 0) throw new Error(`非法手牌类别: "${hc}"`);

  if (hiIdx === loIdx) {
    if (hc.length !== 2) throw new Error(`对子不应带花色标记: "${hc}"`);
    return { hiIdx, loIdx, kind: 'pair' };
  }

  if (hc.length !== 3) throw new Error(`非对子必须带 s 或 o: "${hc}"`);
  if (hiIdx < loIdx) throw new Error(`大牌必须在前: "${hc}"`);
  const suffix = hc[2];
  if (suffix !== 's' && suffix !== 'o') throw new Error(`非法花色标记: "${hc}"`);
  return { hiIdx, loIdx, kind: suffix };
}

/** 169 种起手牌，顺序稳定：从大到小遍历大牌，再遍历小牌，同花在前 */
export function allHandClasses(): HandClass[] {
  const out: HandClass[] = [];
  for (let hi = 12; hi >= 0; hi--) {
    for (let lo = hi; lo >= 0; lo--) {
      const h = RANK_CHARS[hi];
      const l = RANK_CHARS[lo];
      if (hi === lo) {
        out.push(h + l);
      } else {
        out.push(h + l + 's');
        out.push(h + l + 'o');
      }
    }
  }
  return out;
}

/** 该类别包含多少种具体的两张牌组合 */
export function comboCount(hc: HandClass): number {
  const { kind } = parseHandClass(hc);
  if (kind === 'pair') return 6;
  if (kind === 's') return 4;
  return 12;
}

/** 展开成具体的两张牌组合 */
export function expandCombos(hc: HandClass): Array<[Card, Card]> {
  const { hiIdx, loIdx, kind } = parseHandClass(hc);
  const hiRank = idxToRank(hiIdx);
  const loRank = idxToRank(loIdx);
  const out: Array<[Card, Card]> = [];

  if (kind === 'pair') {
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = i + 1; j < SUITS.length; j++) {
        out.push([
          { rank: hiRank, suit: SUITS[i] as Suit },
          { rank: loRank, suit: SUITS[j] as Suit },
        ]);
      }
    }
    return out;
  }

  if (kind === 's') {
    for (const suit of SUITS) {
      out.push([{ rank: hiRank, suit }, { rank: loRank, suit }]);
    }
    return out;
  }

  for (const hiSuit of SUITS) {
    for (const loSuit of SUITS) {
      if (hiSuit === loSuit) continue;
      out.push([{ rank: hiRank, suit: hiSuit }, { rank: loRank, suit: loSuit }]);
    }
  }
  return out;
}
