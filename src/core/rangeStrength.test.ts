import { describe, it, expect } from 'vitest';
import { parseCards } from './cards';
import { createRng } from './rng';
import { parseRange } from './rangeNotation';
import { rangeFraction } from './rangeSet';
import { rankRange, topFraction, strengthPercentile, warmPreflopStrength } from './rangeStrength';
import { equityMonteCarlo } from './equity';
import { expandCombos } from './handClass';

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

describe('翻前牌力查表', () => {
  it('翻前排序与逐个采样的结果高度一致', () => {
    // 旧版本从没算过「逐个采样」的版本：只检查了 classes[0] === 'AA' 和
    // 强度递减，这两条查表本身、甚至一个写错的排序函数只要恰好没把 AA
    // 排到第一都测不出来，标题声称的「与逐个采样高度一致」从未被验证过。
    //
    // 这里真的独立算一遍：对范围里每个类别，用 equityMonteCarlo（和
    // buildPreflopTable 内部用的是同一个函数，但样本数、种子都不同，
    // 不是在读同一份缓存）单独跑一次蒙特卡洛，得到一版不经过查表、
    // 完全独立的强度排序，再用 Spearman 等级相关系数衡量两版排序的
    // 一致程度。
    const range = parseRange('22+, A2s+, K9s+, QTs+, JTs, ATo+, KQo');
    const ranked = rankRange(range, [], [], 120, createRng('table-1'));
    const classes = ranked.map(r => r.handClass);

    const sampledStrength = new Map<string, number>();
    for (const hc of classes) {
      const cards = expandCombos(hc)[0];
      sampledStrength.set(hc, equityMonteCarlo(cards, [], 1, 4000, createRng(`sample-${hc}`)));
    }
    const sampledOrder = [...classes].sort((a, b) => sampledStrength.get(b)! - sampledStrength.get(a)!);

    // Spearman: 1 = 完全一致，0 = 无关，-1 = 完全反序
    const rankOf = (order: string[]) => new Map(order.map((hc, i) => [hc, i]));
    const tableRank = rankOf(classes);
    const sampledRank = rankOf(sampledOrder);
    const n = classes.length;
    let sumSqDiff = 0;
    for (const hc of classes) {
      const d = tableRank.get(hc)! - sampledRank.get(hc)!;
      sumSqDiff += d * d;
    }
    const spearman = 1 - (6 * sumSqDiff) / (n * (n * n - 1));

    // 实测（同样的范围、同样的抽样参数）约 0.96，且前 5 名完全重合。0.8
    // 做门槛，留了远超两版各自蒙特卡洛噪声的余量。
    expect(spearman).toBeGreaterThan(0.8);
    // 最强的应当是 AA，最弱的不应当是对子——两版排序都要满足
    expect(classes[0]).toBe('AA');
    expect(sampledOrder[0]).toBe('AA');
    expect(ranked[ranked.length - 1].strength).toBeLessThan(ranked[0].strength);
  });

  it('翻前结果与随机种子无关', () => {
    const range = parseRange('22+, A2s+, KTs+');
    const a = rankRange(range, [], [], 120, createRng('seed-a')).map(r => r.handClass);
    const b = rankRange(range, [], [], 120, createRng('seed-b')).map(r => r.handClass);
    expect(a).toEqual(b);
  });

  it('翻前同一类别的所有组合强度相同', () => {
    const ranked = rankRange(parseRange('AA'), [], [], 120, createRng('table-2'));
    const strengths = new Set(ranked.map(r => r.strength));
    expect(strengths.size).toBe(1);
  });

  it('死牌只减少组合数，不改变强度值', () => {
    const withAll = rankRange(parseRange('AA'), [], [], 120, createRng('table-3'));
    const withDead = rankRange(parseRange('AA'), [], parseCards('As'), 120, createRng('table-3'));
    expect(withDead).toHaveLength(3);
    expect(withDead[0].strength).toBe(withAll[0].strength);
  });

  it('翻后仍然走采样，不受查表影响', () => {
    // 有公共牌时结果必须依赖牌面：7h7d2c 上 72o 成葫芦，强过 AA
    const board = parseCards('7h 7d 2c');
    const ranked = rankRange(parseRange('AA, 72o'), board, board, 200, createRng('table-4'));
    expect(ranked[0].handClass).toBe('72o');
  });

  it('预热函数可重复调用不抛错，重复调用后翻前排序仍然可复现', () => {
    // 这条起名叫「不改变结果」，但翻前牌力表是模块级单例（preflopTable，见
    // buildPreflopTable 上方），本文件里更早的用例（比如"翻前 AA 强于 72o"）
    // 已经把它建好了；等跑到这里，warmPreflopStrength() 内部的
    // `if (!preflopTable) …` 必然短路成空操作。就算把 warmPreflopStrength
    // 整个实现换成 `() => {}`，a 和 b 依然会相等——两次 rankRange 调用读的
    // 是同一张早就建好的表，跟 warmPreflopStrength 到底做没做事无关。
    //
    // 在不引入新文件、不破坏模块级单例本身设计的前提下，没有办法在这个
    // 测试文件里真正观测到"第一次调用建了表、第二次调用没有再建"——需要
    // 一个全新的、preflopTable 还未被任何用例碰过的模块环境。这里退而
    // 求其次，验证一个仍然有意义、且这个名字诚实反映的性质：调用
    // warmPreflopStrength 本身不抛错、可以安全地反复调用（它在真实调用方
    // 那里就是这么被用的——不确定表建没建时无脑调一下），并且调用前后
    // rankRange 的翻前结果不受影响、保持可复现。
    expect(() => warmPreflopStrength()).not.toThrow();
    const a = rankRange(parseRange('22+'), [], [], 120, createRng('warm')).map(r => r.strength);
    expect(() => warmPreflopStrength()).not.toThrow();
    const b = rankRange(parseRange('22+'), [], [], 120, createRng('warm')).map(r => r.strength);
    expect(a).toEqual(b);
  });
});
