import type { Rng } from './rng';
import { shuffle } from './rng';

export type Suit = 's' | 'h' | 'd' | 'c';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  rank: Rank;
  suit: Suit;
}

export const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'];
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** 下标 0 对应点数 2，下标 12 对应 A */
const RANK_CHARS = '23456789TJQKA';

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function shuffledDeck(rng: Rng): Card[] {
  return shuffle(makeDeck(), rng);
}

export function cardToString(c: Card): string {
  return RANK_CHARS[c.rank - 2] + c.suit;
}

export function parseCard(s: string): Card {
  if (s.length !== 2) throw new Error(`非法牌面: "${s}"`);
  const rankIdx = RANK_CHARS.indexOf(s[0].toUpperCase());
  if (rankIdx < 0) throw new Error(`非法点数: "${s}"`);
  const suit = s[1].toLowerCase() as Suit;
  if (!SUITS.includes(suit)) throw new Error(`非法花色: "${s}"`);
  return { rank: (rankIdx + 2) as Rank, suit };
}

export function parseCards(s: string): Card[] {
  const trimmed = s.trim();
  if (trimmed === '') return [];
  return trimmed.split(/\s+/).map(parseCard);
}

export function sameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}
