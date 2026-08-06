import { describe, it, expect } from 'vitest';
import { parseCards } from './cards';
import { evaluate5Slow, evaluate7Slow } from './handEvalSlow';
import { HandCategory, categoryOf } from './handScore';

const cat5 = (s: string) => categoryOf(evaluate5Slow(parseCards(s)));
const score5 = (s: string) => evaluate5Slow(parseCards(s));

describe('evaluate5Slow 牌型识别', () => {
  it('同花顺', () => {
    expect(cat5('9s 8s 7s 6s 5s')).toBe(HandCategory.StraightFlush);
  });

  it('皇家同花顺也是同花顺', () => {
    expect(cat5('As Ks Qs Js Ts')).toBe(HandCategory.StraightFlush);
  });

  it('轮子同花顺 A2345', () => {
    expect(cat5('As 2s 3s 4s 5s')).toBe(HandCategory.StraightFlush);
  });

  it('四条', () => {
    expect(cat5('9s 9h 9d 9c 5s')).toBe(HandCategory.Quads);
  });

  it('葫芦', () => {
    expect(cat5('9s 9h 9d 5c 5s')).toBe(HandCategory.FullHouse);
  });

  it('同花', () => {
    expect(cat5('As Js 9s 6s 3s')).toBe(HandCategory.Flush);
  });

  it('顺子', () => {
    expect(cat5('9s 8h 7d 6c 5s')).toBe(HandCategory.Straight);
  });

  it('轮子顺 A2345', () => {
    expect(cat5('As 2h 3d 4c 5s')).toBe(HandCategory.Straight);
  });

  it('三条', () => {
    expect(cat5('9s 9h 9d 6c 3s')).toBe(HandCategory.Trips);
  });

  it('两对', () => {
    expect(cat5('9s 9h 6d 6c 3s')).toBe(HandCategory.TwoPair);
  });

  it('一对', () => {
    expect(cat5('9s 9h 8d 6c 3s')).toBe(HandCategory.OnePair);
  });

  it('高牌', () => {
    expect(cat5('As Jh 9d 6c 3s')).toBe(HandCategory.HighCard);
  });

  it('QJT98 不算轮子，是正常顺子', () => {
    expect(cat5('Qs Jh Td 9c 8s')).toBe(HandCategory.Straight);
  });

  it('KA234 不是顺子', () => {
    expect(cat5('Ks Ah 2d 3c 4s')).toBe(HandCategory.HighCard);
  });
});

describe('evaluate5Slow 同牌型内比大小', () => {
  it('大顺子胜小顺子', () => {
    expect(score5('9s 8h 7d 6c 5s')).toBeGreaterThan(score5('8s 7h 6d 5c 4s'));
  });

  it('轮子是最小的顺子', () => {
    expect(score5('6s 5h 4d 3c 2s')).toBeGreaterThan(score5('As 2h 3d 4c 5s'));
  });

  it('四条比踢脚', () => {
    expect(score5('9s 9h 9d 9c As')).toBeGreaterThan(score5('9s 9h 9d 9c Ks'));
  });

  it('葫芦先比三条部分', () => {
    expect(score5('9s 9h 9d 2c 2s')).toBeGreaterThan(score5('8s 8h 8d As Ah'));
  });

  it('两对先比大对，再比小对，最后比踢脚', () => {
    expect(score5('9s 9h 6d 6c As')).toBeGreaterThan(score5('9s 9h 5d 5c As'));
    expect(score5('9s 9h 6d 6c As')).toBeGreaterThan(score5('9s 9h 6d 6c Ks'));
  });

  it('一对相同则逐个比踢脚', () => {
    expect(score5('9s 9h Ad 6c 3s')).toBeGreaterThan(score5('9s 9h Kd 6c 3s'));
    expect(score5('9s 9h Ad 7c 3s')).toBeGreaterThan(score5('9s 9h Ad 6c 3s'));
  });

  it('完全相同的牌型分值相等', () => {
    expect(score5('9s 9h 6d 6c As')).toBe(score5('9d 9c 6s 6h Ah'));
  });
});

describe('牌型强弱顺序', () => {
  it('从同花顺到高牌严格递减', () => {
    const hands = [
      '9s 8s 7s 6s 5s',  // 同花顺
      '9s 9h 9d 9c 5s',  // 四条
      '9s 9h 9d 5c 5s',  // 葫芦
      'As Js 9s 6s 3s',  // 同花
      '9s 8h 7d 6c 5s',  // 顺子
      '9s 9h 9d 6c 3s',  // 三条
      '9s 9h 6d 6c 3s',  // 两对
      '9s 9h 8d 6c 3s',  // 一对
      'As Jh 9d 6c 3s',  // 高牌
    ];
    const scores = hands.map(score5);
    for (let i = 0; i + 1 < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i + 1]);
    }
  });
});

describe('evaluate7Slow', () => {
  it('从 7 张里选出最好的 5 张', () => {
    // 7 张里含同花顺
    const s7 = evaluate7Slow(parseCards('9s 8s 7s 6s 5s 2h 3d'));
    expect(categoryOf(s7)).toBe(HandCategory.StraightFlush);
  });

  it('与手工选出的最佳 5 张一致', () => {
    const s7 = evaluate7Slow(parseCards('As Ah Kd Kc Qs 2h 3d'));
    const s5 = evaluate5Slow(parseCards('As Ah Kd Kc Qs'));
    expect(s7).toBe(s5);
  });

  it('7 张中同花优先于三条', () => {
    // 5 张方片构成同花，同时 A 有三条；同花更大
    const s7 = evaluate7Slow(parseCards('Ad Ah As Kd Qd Jd 9d'));
    expect(categoryOf(s7)).toBe(HandCategory.Flush);
  });
});
