import { describe, it, expect } from 'vitest';
import { parseCards } from './cards';
import { createRng } from './rng';
import { parseRange } from './rangeNotation';
import { rangeFraction } from './rangeSet';
import { rankRange, topFraction, strengthPercentile } from './rangeStrength';

describe('rankRange', () => {
  it('按强度降序排列', () => {
    const ranked = rankRange(parseRange('AA, 72o'), [], [], 200, createRng('rank-1'));
    for (let i = 0; i + 1 < ranked.length; i++) {
      expect(ranked[i].strength).toBeGreaterThanOrEqual(ranked[i + 1].strength);
    }
  });

  it('翻前 AA 强于 72o', () => {
    const ranked = rankRange(parseRange('AA, 72o'), [], [], 400, createRng('rank-2'));
    const aa = ranked.filter(r => r.handClass === 'AA')[0];
    const junk = ranked.filter(r => r.handClass === '72o')[0];
    expect(aa.strength).toBeGreaterThan(junk.strength);
    expect(aa.strength).toBeGreaterThan(0.8);
    expect(junk.strength).toBeLessThan(0.45);
  });

  it('公共牌改变强度排序', () => {
    // 公共牌 7 7 2：72o 成葫芦，AA 只是两对
    const board = parseCards('7h 7d 2c');
    const ranked = rankRange(parseRange('AA, 72o'), board, board, 400, createRng('rank-3'));
    const aa = ranked.filter(r => r.handClass === 'AA')[0];
    const boat = ranked.filter(r => r.handClass === '72o')[0];
    expect(boat.strength).toBeGreaterThan(aa.strength);
  });

  it('剔除死牌', () => {
    const ranked = rankRange(parseRange('AA'), [], parseCards('As'), 100, createRng('rank-4'));
    expect(ranked).toHaveLength(3);   // 剩三张 A 的 C(3,2)
  });

  it('保留原有权重', () => {
    const ranked = rankRange(parseRange('AA:0.5'), [], [], 100, createRng('rank-5'));
    for (const r of ranked) expect(r.weight).toBe(0.5);
  });

  it('空范围得到空数组', () => {
    expect(rankRange(new Map(), [], [], 100, createRng('rank-6'))).toEqual([]);
  });

  it('相同 seed 下排序完全可复现，且中段顺序稳定', () => {
    const r = () => rankRange(parseRange('22+, A2s+, K9s+, QTs+, JTs, ATo+'),
                              parseCards('7h 4d 2c'), parseCards('7h 4d 2c'),
                              120, createRng('stable'));
    const a = r();
    const b = r();
    expect(a.map(x => x.handClass)).toEqual(b.map(x => x.handClass));
  });

  it('两个牌力明显不同的手牌顺序不会被噪声颠倒', () => {
    // 公共牌 7h 4d 2c 上，AA 是超对，A7o 是顶对，77 是暗三条。
    // 三者真实牌力差距远大于共享采样后的残余噪声，顺序必须稳定。
    const ranked = rankRange(parseRange('AA, A7o, 77'),
                             parseCards('7h 4d 2c'), parseCards('7h 4d 2c'),
                             120, createRng('order'));
    const posOf = (hc: string) =>
      ranked.findIndex(x => x.handClass === hc);
    expect(posOf('77')).toBeLessThan(posOf('AA'));
    expect(posOf('AA')).toBeLessThan(posOf('A7o'));
  });
});

describe('topFraction', () => {
  const ranked = () => rankRange(parseRange('22+, A2s+, K9s+, ATo+'), [], [], 150, createRng('top'));

  it('取全部时范围宽度不变', () => {
    const r = ranked();
    const all = topFraction(r, 1);
    expect(rangeFraction(all)).toBeCloseTo(rangeFraction(parseRange('22+, A2s+, K9s+, ATo+')), 6);
  });

  it('取一半时加权组合数约为一半', () => {
    const r = ranked();
    const half = topFraction(r, 0.5);
    const full = topFraction(r, 1);
    const ratio = rangeFraction(half) / rangeFraction(full);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  it('取 0 得到空范围', () => {
    expect(topFraction(ranked(), 0).size).toBe(0);
  });

  it('保留的是最强的部分：AA 在前 10% 里，72o 不在', () => {
    const r = rankRange(parseRange('22+, A2s+, 72o'), [], [], 200, createRng('top-2'));
    const strong = topFraction(r, 0.1);
    expect(strong.has('AA')).toBe(true);
    expect(strong.has('72o')).toBe(false);
  });

  it('比例超出 [0,1] 抛错', () => {
    expect(() => topFraction(ranked(), 1.5)).toThrow();
    expect(() => topFraction(ranked(), -0.1)).toThrow();
  });
});

describe('strengthPercentile', () => {
  it('最强的类别分位接近 1，最弱的接近 0', () => {
    const r = rankRange(parseRange('AA, KK, QQ, 72o'), [], [], 300, createRng('pct'));
    expect(strengthPercentile(r, 'AA')).toBeGreaterThan(0.7);
    expect(strengthPercentile(r, '72o')).toBeLessThan(0.3);
  });

  it('不在范围内的类别返回 0', () => {
    const r = rankRange(parseRange('AA'), [], [], 100, createRng('pct-2'));
    expect(strengthPercentile(r, '72o')).toBe(0);
  });
});
