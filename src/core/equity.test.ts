import { describe, it, expect } from 'vitest';
import { parseCards } from './cards';
import type { Card } from './cards';
import { createRng } from './rng';
import { equityMonteCarlo, equityExactVsOne } from './equity';

const hole = (s: string) => parseCards(s) as [Card, Card];

describe('equityExactVsOne', () => {
  it('河牌圈坚果同花对随机手接近必胜', () => {
    // 公共牌四张黑桃 + 一张杂牌，hero 持黑桃 A K 成同花
    const eq = equityExactVsOne(hole('As Ks'), parseCards('Qs Js 9s 4h 2d'));
    expect(eq).toBeGreaterThan(0.97);
  });

  it('公共牌本身是皇家同花顺时双方必然平分', () => {
    const eq = equityExactVsOne(hole('2h 3d'), parseCards('As Ks Qs Js Ts'));
    expect(eq).toBeCloseTo(0.5, 2);
  });

  it('胜率落在 [0,1] 内', () => {
    const eq = equityExactVsOne(hole('7c 2d'), parseCards('As Ks Qh 4h 9d'));
    expect(eq).toBeGreaterThanOrEqual(0);
    expect(eq).toBeLessThanOrEqual(1);
  });
});

describe('equityMonteCarlo 已知值', () => {
  const rng = () => createRng('equity-known');

  it('AA vs 单个随机手翻前约 85%', () => {
    const eq = equityMonteCarlo(hole('As Ad'), [], 1, 40000, rng());
    expect(eq).toBeGreaterThan(0.83);
    expect(eq).toBeLessThan(0.87);
  });

  it('72o vs 单个随机手翻前约 35%', () => {
    const eq = equityMonteCarlo(hole('7c 2d'), [], 1, 40000, rng());
    expect(eq).toBeGreaterThan(0.32);
    expect(eq).toBeLessThan(0.38);
  });

  it('AA vs 5 个随机手翻前约 49%', () => {
    const eq = equityMonteCarlo(hole('As Ad'), [], 5, 40000, rng());
    expect(eq).toBeGreaterThan(0.45);
    expect(eq).toBeLessThan(0.53);
  });

  it('对手越多胜率越低', () => {
    const one = equityMonteCarlo(hole('As Ad'), [], 1, 20000, rng());
    const five = equityMonteCarlo(hole('As Ad'), [], 5, 20000, rng());
    expect(one).toBeGreaterThan(five);
  });
});

describe('equityMonteCarlo 与精确解对拍', () => {
  it('河牌圈误差小于 1.5 个百分点', () => {
    const cases: Array<[string, string]> = [
      ['As Ks', 'Qs Js 9s 4h 2d'],
      ['7c 2d', 'As Ks Qh 4h 9d'],
      ['9h 9d', '9c 4s 2h Kd 7c'],
      ['Ah Kd', 'Ac Kh 5s 2d 9c'],
      ['5c 4c', '3h 2s 6d Ac Kd'],
    ];
    for (const [h, b] of cases) {
      const exact = equityExactVsOne(hole(h), parseCards(b));
      const mc = equityMonteCarlo(hole(h), parseCards(b), 1, 20000, createRng(`mc-${h}`));
      expect(Math.abs(mc - exact)).toBeLessThan(0.015);
    }
  });

  it('转牌圈误差小于 1.5 个百分点', () => {
    const exact = equityExactVsOne(hole('As Ks'), parseCards('Qs Js 9s 4h'));
    const mc = equityMonteCarlo(hole('As Ks'), parseCards('Qs Js 9s 4h'), 1, 20000, createRng('mc-turn'));
    expect(Math.abs(mc - exact)).toBeLessThan(0.015);
  });
});

describe('equityMonteCarlo 可复现', () => {
  it('相同 seed 得到相同结果', () => {
    const a = equityMonteCarlo(hole('As Ad'), [], 2, 5000, createRng('repro'));
    const b = equityMonteCarlo(hole('As Ad'), [], 2, 5000, createRng('repro'));
    expect(a).toBe(b);
  });
});
