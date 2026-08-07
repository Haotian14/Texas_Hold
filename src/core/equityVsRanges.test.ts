import { describe, it, expect } from 'vitest';
import { parseCards } from './cards';
import type { Card } from './cards';
import { createRng } from './rng';
import { parseRange } from './rangeNotation';
import { fullRange } from './rangeSet';
import { equityVsRanges, equityMonteCarlo } from './equity';

const hole = (s: string) => parseCards(s) as [Card, Card];

describe('equityVsRanges 与随机手版本一致', () => {
  it('对手范围为全范围时，结果接近 equityMonteCarlo', () => {
    const a = equityVsRanges(hole('As Ad'), [], [fullRange()], 30000, createRng('cmp'));
    const b = equityMonteCarlo(hole('As Ad'), [], 1, 30000, createRng('cmp'));
    expect(Math.abs(a - b)).toBeLessThan(0.02);
  });

  it('两个全范围对手接近两个随机手对手', () => {
    const a = equityVsRanges(hole('As Ad'), [], [fullRange(), fullRange()], 20000, createRng('cmp2'));
    const b = equityMonteCarlo(hole('As Ad'), [], 2, 20000, createRng('cmp2'));
    expect(Math.abs(a - b)).toBeLessThan(0.03);
  });
});

describe('equityVsRanges 范围影响结果', () => {
  it('对手范围越强，hero 胜率越低', () => {
    const rng = () => createRng('narrow');
    const vsAll = equityVsRanges(hole('Ks Kd'), [], [fullRange()], 20000, rng());
    const vsStrong = equityVsRanges(hole('Ks Kd'), [], [parseRange('QQ+, AKs, AKo')], 20000, rng());
    expect(vsStrong).toBeLessThan(vsAll);
  });

  it('KK 对只含 AA 的范围胜率约 18%', () => {
    const eq = equityVsRanges(hole('Ks Kd'), [], [parseRange('AA')], 20000, createRng('kk-vs-aa'));
    expect(eq).toBeGreaterThan(0.15);
    expect(eq).toBeLessThan(0.21);
  });

  it('AA 对只含 KK 的范围胜率约 82%', () => {
    const eq = equityVsRanges(hole('As Ad'), [], [parseRange('KK')], 20000, createRng('aa-vs-kk'));
    expect(eq).toBeGreaterThan(0.79);
    expect(eq).toBeLessThan(0.85);
  });

  it('AKs 对只含 22 的范围约 50%', () => {
    // 同花 AK 对小对子基本是掷硬币，精确值约 49.9%
    const eq = equityVsRanges(hole('As Ks'), [], [parseRange('22')], 30000, createRng('aks-vs-22'));
    expect(eq).toBeGreaterThan(0.47);
    expect(eq).toBeLessThan(0.53);
  });

  it('AKo 对只含 22 的范围约 47%', () => {
    // 非同花 AK 少了同花的补强，明显低于同花版本
    const eq = equityVsRanges(hole('Ah Kd'), [], [parseRange('22')], 30000, createRng('ako-vs-22'));
    expect(eq).toBeGreaterThan(0.44);
    expect(eq).toBeLessThan(0.50);
  });

  it('对手范围里的牌不会出现在公共牌上（采样顺序回归）', () => {
    // 对手范围只有 KK：若先发公共牌再给对手采样，牌面会拿走 K，
    // 对手却仍持 KK，凭空多出四条。精确值约 81.3%。
    const eq = equityVsRanges(hole('As Ad'), [], [parseRange('KK')], 30000, createRng('order-guard'));
    expect(eq).toBeGreaterThan(0.78);
    expect(eq).toBeLessThan(0.85);
  });
});

describe('equityVsRanges 死牌处理', () => {
  it('对手范围里与 hero 底牌冲突的组合被排除', () => {
    // hero 拿两张 A，对手范围只有 AA —— 只剩一种组合（另外两张 A）
    const eq = equityVsRanges(hole('As Ad'), [], [parseRange('AA')], 5000, createRng('dead'));
    // 双方都是 AA，几乎必然平分（除非公共牌造出同花）
    expect(eq).toBeGreaterThan(0.4);
    expect(eq).toBeLessThan(0.6);
  });

  it('对手范围被死牌清空时抛错', () => {
    // 四张 A 都在 hero 手上和公共牌上，对手不可能有 AA
    expect(() =>
      equityVsRanges(hole('As Ad'), parseCards('Ah Ac 5d'), [parseRange('AA')], 100, createRng('x')),
    ).toThrow();
  });
});

describe('equityVsRanges 公共牌', () => {
  it('河牌圈拿到坚果时胜率接近 1', () => {
    // 公共牌四张黑桃，hero 持黑桃 AK 成坚果同花；对手范围是宽范围
    const eq = equityVsRanges(
      hole('As Ks'), parseCards('Qs Js 9s 4h 2d'), [parseRange('22+, A2s+, K9s+')], 5000, createRng('nuts'),
    );
    expect(eq).toBeGreaterThan(0.9);
  });

  it('公共牌本身是皇家同花顺时人人平分', () => {
    const eq = equityVsRanges(
      hole('2h 3d'), parseCards('As Ks Qs Js Ts'), [fullRange()], 3000, createRng('board-plays'),
    );
    expect(eq).toBeCloseTo(0.5, 1);
  });
});

describe('equityVsRanges 可复现', () => {
  it('相同 seed 结果完全相同', () => {
    const run = () => equityVsRanges(hole('As Kd'), [], [parseRange('22+')], 3000, createRng('repro'));
    expect(run()).toBe(run());
  });
});
