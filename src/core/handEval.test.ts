import { describe, it, expect } from 'vitest';
import { makeDeck, parseCards, cardToString } from './cards';
import type { Card } from './cards';
import { createRng, shuffle } from './rng';
import { evaluate7 } from './handEval';
import { evaluate7Slow } from './handEvalSlow';
import { HandCategory, categoryOf } from './handScore';

describe('evaluate7 与参考实现对拍', () => {
  it('10 万组随机 7 张牌结果完全一致', () => {
    const rng = createRng('showdown-crosscheck');
    const deck = makeDeck();
    for (let i = 0; i < 100_000; i++) {
      const hand: Card[] = shuffle(deck, rng).slice(0, 7);
      const fast = evaluate7(hand);
      const slow = evaluate7Slow(hand);
      if (fast !== slow) {
        throw new Error(
          `不一致：${hand.map(cardToString).join(' ')} fast=${fast} slow=${slow}`,
        );
      }
    }
    expect(true).toBe(true);
  }, 120_000);
});

describe('evaluate7 牌型识别', () => {
  const cat = (s: string) => categoryOf(evaluate7(parseCards(s)));

  it('同花顺', () => {
    expect(cat('9s 8s 7s 6s 5s 2h 3d')).toBe(HandCategory.StraightFlush);
  });

  it('轮子同花顺', () => {
    expect(cat('As 2s 3s 4s 5s Kh Qd')).toBe(HandCategory.StraightFlush);
  });

  it('四条带踢脚', () => {
    expect(cat('9s 9h 9d 9c As 3h 2d')).toBe(HandCategory.Quads);
  });

  it('四条 + 三条时仍是四条', () => {
    expect(cat('9s 9h 9d 9c As Ah Ad')).toBe(HandCategory.Quads);
  });

  it('两组三条构成葫芦', () => {
    expect(cat('9s 9h 9d As Ah Ad 2c')).toBe(HandCategory.FullHouse);
  });

  it('三条 + 对子构成葫芦', () => {
    expect(cat('9s 9h 9d As Ah 5d 2c')).toBe(HandCategory.FullHouse);
  });

  it('7 张里的同花取最大 5 张', () => {
    const a = evaluate7(parseCards('As Ks Qs Js 9s 2h 3d'));
    const b = evaluate7(parseCards('As Ks Qs Js 8s 2h 3d'));
    expect(a).toBeGreaterThan(b);
  });

  it('三对时只算两对，取最大两对', () => {
    const s = evaluate7(parseCards('As Ah Ks Kh 2s 2h 9d'));
    expect(categoryOf(s)).toBe(HandCategory.TwoPair);
    // 踢脚应为 9 而非 2
    expect(s).toBe(evaluate7(parseCards('Ad Ac Kd Kc 9s 4h 3d')));
  });

  it('同时构成顺子与三条时取顺子', () => {
    // 9 有三条，同时 5-6-7-8-9 构成顺子；顺子更大
    expect(cat('9s 9h 9d 8c 7h 6d 5s')).toBe(HandCategory.Straight);
  });

  it('跨花色的 5 张不构成同花', () => {
    expect(cat('As Ks Qs Js Th 9h 8h')).toBe(HandCategory.Straight);
  });
});

describe('evaluate7 已知强弱关系', () => {
  it('同一公共牌下 AA 胜 KK', () => {
    const board = '7h 2d 9c 4s 3h';
    const aa = evaluate7(parseCards(`As Ad ${board}`));
    const kk = evaluate7(parseCards(`Ks Kd ${board}`));
    expect(aa).toBeGreaterThan(kk);
  });

  it('平局时分值相等', () => {
    // 公共牌就是最好的 5 张，两手底牌都用不上
    const board = 'As Ks Qs Js Ts';
    const p1 = evaluate7(parseCards(`2h 3d ${board}`));
    const p2 = evaluate7(parseCards(`4h 5d ${board}`));
    expect(p1).toBe(p2);
  });
});
