import { describe, it, expect } from 'vitest';
import { parseCards } from './cards';
import { createRng } from './rng';
import { rangeFraction } from './rangeSet';
import { initialRange, narrowByAction } from './opponentRange';
import type { NarrowContext } from './opponentRange';

const ctx = (over: Partial<NarrowContext> = {}): NarrowContext => ({
  street: 'flop',
  board: parseCards('7h 4d 2c'),
  dead: parseCards('7h 4d 2c'),
  potBefore: 10,
  betSize: 5,
  strengthIterations: 80,
  rng: createRng('narrow'),
  ...over,
});

describe('initialRange', () => {
  it('各位置都能拿到范围', () => {
    for (const pos of ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const) {
      expect(initialRange(pos).size).toBeGreaterThan(0);
    }
  });

  it('位置越靠后范围越宽', () => {
    expect(rangeFraction(initialRange('UTG'))).toBeLessThan(rangeFraction(initialRange('CO')));
    expect(rangeFraction(initialRange('CO'))).toBeLessThan(rangeFraction(initialRange('BTN')));
  });

  it('大盲无 RFI 表，回落到全范围', () => {
    expect(initialRange('BB').size).toBe(169);
  });
});

describe('narrowByAction 弃牌', () => {
  it('弃牌得到空范围', () => {
    expect(narrowByAction(initialRange('BTN'), 'fold', ctx()).size).toBe(0);
  });
});

describe('narrowByAction 收窄方向', () => {
  it('下注后范围变窄', () => {
    const before = initialRange('BTN');
    const after = narrowByAction(before, 'bet', ctx());
    expect(rangeFraction(after)).toBeLessThan(rangeFraction(before));
  });

  it('加注比下注收得更窄', () => {
    const before = initialRange('BTN');
    const bet = narrowByAction(before, 'bet', ctx());
    const raise = narrowByAction(before, 'raise', ctx());
    expect(rangeFraction(raise)).toBeLessThan(rangeFraction(bet));
  });

  it('全下收得最窄', () => {
    const before = initialRange('BTN');
    const allin = narrowByAction(before, 'allin', ctx());
    const raise = narrowByAction(before, 'raise', ctx());
    expect(rangeFraction(allin)).toBeLessThanOrEqual(rangeFraction(raise));
  });

  it('下注尺度越大范围越窄', () => {
    const before = initialRange('BTN');
    const small = narrowByAction(before, 'bet', ctx({ betSize: 3 }));
    const big = narrowByAction(before, 'bet', ctx({ betSize: 20 }));
    expect(rangeFraction(big)).toBeLessThan(rangeFraction(small));
  });

  it('跟注后范围也变窄，但不如加注窄', () => {
    const before = initialRange('BTN');
    const call = narrowByAction(before, 'call', ctx());
    const raise = narrowByAction(before, 'raise', ctx());
    expect(rangeFraction(call)).toBeLessThan(rangeFraction(before));
    expect(rangeFraction(call)).toBeGreaterThan(rangeFraction(raise));
  });

  it('过牌剔除最强的部分', () => {
    const before = initialRange('BTN');
    const after = narrowByAction(before, 'check', ctx());
    expect(rangeFraction(after)).toBeLessThan(rangeFraction(before));
  });
});

describe('narrowByAction 保留的是正确的那一端', () => {
  it('下注后保留的是强牌：范围内最强手牌仍在', () => {
    const before = initialRange('CO');
    const after = narrowByAction(before, 'bet', ctx({ board: [], dead: [], street: 'preflop' }));
    expect(after.has('AA')).toBe(true);
  });

  it('过牌后剔除的是强牌：AA 不再出现', () => {
    const before = initialRange('CO');
    const after = narrowByAction(before, 'check', ctx({ board: [], dead: [], street: 'preflop' }));
    expect(after.has('AA')).toBe(false);
  });
});

describe('narrowByAction 边界', () => {
  it('空范围收窄后仍为空', () => {
    expect(narrowByAction(new Map(), 'bet', ctx()).size).toBe(0);
  });

  it('结果永远是原范围的子集', () => {
    const before = initialRange('BTN');
    for (const act of ['check', 'call', 'bet', 'raise', 'allin'] as const) {
      const after = narrowByAction(before, act, ctx());
      for (const hc of after.keys()) {
        expect(before.has(hc)).toBe(true);
      }
    }
  });

  it('相同输入结果可复现', () => {
    const before = initialRange('BTN');
    const a = narrowByAction(before, 'bet', ctx({ rng: createRng('same') }));
    const b = narrowByAction(before, 'bet', ctx({ rng: createRng('same') }));
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });
});
