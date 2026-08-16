import { describe, it, expect } from 'vitest';
import { SMALL_BLIND, BIG_BLIND, STARTING_STACK } from '../core/types';
import { CHIPS_PER_BB, chips, chipDenominations, MAX_CHIPS_DRAWN, CHIP_DENOMINATIONS, cardText, rankText, suitText } from './format';

describe('BB → 实额', () => {
  it('盲注显示为 20 / 40', () => {
    expect(chips(SMALL_BLIND)).toBe('20');
    expect(chips(BIG_BLIND)).toBe('40');
  });

  it('标准买入显示为 4,000', () => {
    expect(chips(STARTING_STACK)).toBe('4,000');
  });

  it('200BB 显示为 8,000', () => {
    expect(chips(200)).toBe('8,000');
  });

  it('换算比例是 40', () => {
    expect(CHIPS_PER_BB).toBe(40);
  });

  it('负数带符号', () => {
    expect(chips(-12.5)).toBe('-500');
  });

  it('非整数实额取整到个位', () => {
    expect(chips(0.3)).toBe('12');
    expect(chips(1.51)).toBe('60');
  });

  it('零显示为 0', () => {
    expect(chips(0)).toBe('0');
  });

  it('四舍五入后为零的小额负数不带负号', () => {
    expect(chips(-0.01)).toBe('0');
    expect(chips(-0.005)).toBe('0');
  });

  it('四舍五入后仍非零的小额负数保留负号', () => {
    expect(chips(-0.02)).toBe('-1');
  });
});

describe('筹码面额拆分', () => {
  it('小盲 0.5BB = 20 筹码，一枚 20', () => {
    expect(chipDenominations(0.5)).toEqual([20]);
  });

  it('大盲 1BB = 40 筹码，两枚 20', () => {
    expect(chipDenominations(1)).toEqual([20, 20]);
  });

  it('2BB = 80 筹码，四枚 20', () => {
    expect(chipDenominations(2)).toEqual([20, 20, 20, 20]);
  });

  it('起始筹码 100BB = 4,000，四枚 1000', () => {
    expect(chipDenominations(100)).toEqual([1000, 1000, 1000, 1000]);
  });

  it('贪心从大到小：38.25BB = 1,530 拆成 1000+500+20，余 10 不表示', () => {
    expect(chipDenominations(38.25)).toEqual([1000, 500, 20]);
  });

  it('超过上限时截断到 MAX_CHIPS_DRAWN 枚', () => {
    // 120BB = 4,800 筹码：1000*4 + 500 已经 5 枚，余 300 不再表示
    const out = chipDenominations(120);
    expect(out).toEqual([1000, 1000, 1000, 1000, 500]);
    expect(out).toHaveLength(MAX_CHIPS_DRAWN);
  });

  it('零金额不画筹码', () => {
    expect(chipDenominations(0)).toEqual([]);
  });

  it('取整后不足一枚最小面额时不画筹码', () => {
    // 0.01BB = 0.4 筹码，取整为 0
    expect(chipDenominations(0.01)).toEqual([]);
  });

  it('负数按绝对值处理，返回值不带符号', () => {
    expect(chipDenominations(-1)).toEqual([20, 20]);
  });

  it('面额表是从大到小的，拆分依赖这个顺序', () => {
    const sorted = [...CHIP_DENOMINATIONS].sort((a, b) => b - a);
    expect([...CHIP_DENOMINATIONS]).toEqual(sorted);
  });
});

describe('牌面文字拆成点数与花色', () => {
  const AS = { rank: 14, suit: 's' } as const;
  const TD = { rank: 10, suit: 'd' } as const;
  const SEVEN_C = { rank: 7, suit: 'c' } as const;

  it('点数：A / 10 / 数字', () => {
    expect(rankText(AS)).toBe('A');
    expect(rankText(TD)).toBe('10');
    expect(rankText(SEVEN_C)).toBe('7');
  });

  it('花色符号', () => {
    expect(suitText(AS)).toBe('♠');
    expect(suitText(TD)).toBe('♦');
    expect(suitText(SEVEN_C)).toBe('♣');
  });

  it('cardText 仍是两者相接，没有回归', () => {
    expect(cardText(AS)).toBe('A♠');
    expect(cardText(TD)).toBe('10♦');
  });
});
