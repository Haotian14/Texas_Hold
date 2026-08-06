import { describe, it, expect } from 'vitest';
import { parseCards } from './cards';
import { evaluate7 } from './handEval';
import { describeHand } from './handScore';

const describe7 = (s: string) => describeHand(evaluate7(parseCards(s)));

describe('describeHand', () => {
  it('高牌', () => {
    expect(describe7('2h 5d 9s Jc Kd 3c 7h')).toBe('高牌');
  });

  it('一对', () => {
    expect(describe7('2h 2d 5s 9c Jd 3h 7c')).toBe('一对');
  });

  it('两对', () => {
    expect(describe7('2h 2d 5s 5c 9d 3h 7c')).toBe('两对');
  });

  it('三条', () => {
    expect(describe7('2h 2d 2s 5c 9d 3h 7c')).toBe('三条');
  });

  it('顺子', () => {
    expect(describe7('3h 4d 5s 6c 7d 9h 2c')).toBe('顺子');
  });

  it('同花', () => {
    expect(describe7('2h 5h 9h Jh Kh 3c 7d')).toBe('同花');
  });

  it('葫芦', () => {
    expect(describe7('2h 2d 2s 5c 5d 9h 3c')).toBe('葫芦');
  });

  it('四条', () => {
    expect(describe7('2h 2d 2s 2c 5d 9h 3c')).toBe('四条');
  });

  it('同花顺', () => {
    expect(describe7('3h 4h 5h 6h 7h 9d 2c')).toBe('同花顺');
  });
});
