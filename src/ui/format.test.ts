import { describe, it, expect } from 'vitest';
import { SMALL_BLIND, BIG_BLIND, STARTING_STACK } from '../core/types';
import { CHIPS_PER_BB, chips } from './format';

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
});
