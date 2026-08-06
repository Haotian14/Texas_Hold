import { describe, it, expect } from 'vitest';
import {
  makeDeck, shuffledDeck, cardToString, parseCard, parseCards, sameCard,
} from './cards';
import { createRng } from './rng';

describe('makeDeck', () => {
  it('生成 52 张牌', () => {
    expect(makeDeck()).toHaveLength(52);
  });

  it('52 张互不重复', () => {
    const names = makeDeck().map(cardToString);
    expect(new Set(names).size).toBe(52);
  });

  it('每种花色 13 张', () => {
    const deck = makeDeck();
    for (const suit of ['s', 'h', 'd', 'c'] as const) {
      expect(deck.filter(c => c.suit === suit)).toHaveLength(13);
    }
  });
});

describe('parseCard / cardToString', () => {
  it('全部 52 张往返一致', () => {
    for (const c of makeDeck()) {
      expect(parseCard(cardToString(c))).toEqual(c);
    }
  });

  it('解析具体牌面', () => {
    expect(parseCard('As')).toEqual({ rank: 14, suit: 's' });
    expect(parseCard('Th')).toEqual({ rank: 10, suit: 'h' });
    expect(parseCard('2c')).toEqual({ rank: 2, suit: 'c' });
  });

  it('非法输入抛错', () => {
    expect(() => parseCard('Xs')).toThrow();
    expect(() => parseCard('Az')).toThrow();
    expect(() => parseCard('A')).toThrow();
  });
});

describe('parseCards', () => {
  it('解析空格分隔的多张牌', () => {
    expect(parseCards('As Kd 7h')).toEqual([
      { rank: 14, suit: 's' },
      { rank: 13, suit: 'd' },
      { rank: 7, suit: 'h' },
    ]);
  });

  it('空串返回空数组', () => {
    expect(parseCards('')).toEqual([]);
  });
});

describe('shuffledDeck', () => {
  it('仍是完整 52 张', () => {
    const d = shuffledDeck(createRng('deck-1'));
    expect(new Set(d.map(cardToString)).size).toBe(52);
  });

  it('相同 seed 结果相同', () => {
    const a = shuffledDeck(createRng('deck-x')).map(cardToString);
    const b = shuffledDeck(createRng('deck-x')).map(cardToString);
    expect(a).toEqual(b);
  });
});

describe('sameCard', () => {
  it('比较点数与花色', () => {
    expect(sameCard(parseCard('As'), parseCard('As'))).toBe(true);
    expect(sameCard(parseCard('As'), parseCard('Ah'))).toBe(false);
    expect(sameCard(parseCard('As'), parseCard('Ks'))).toBe(false);
  });
});
