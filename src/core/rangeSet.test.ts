import { describe, it, expect } from 'vitest';
import { parseCards, cardToString } from './cards';
import type { Card } from './cards';
import { createRng } from './rng';
import { classifyHand, comboCount } from './handClass';
import { parseRange } from './rangeNotation';
import {
  rangeCombos, totalWeight, sampleCombo, fullRange, rangeFraction,
} from './rangeSet';

describe('rangeCombos', () => {
  it('无死牌时组合数等于各类别组合数之和', () => {
    const r = parseRange('AA, AKs');
    expect(rangeCombos(r, [])).toHaveLength(comboCount('AA') + comboCount('AKs'));
  });

  it('剔除与死牌冲突的组合', () => {
    // A♠ 已在公共牌上，AA 只剩另外三张 A 的 C(3,2)=3 种
    const r = parseRange('AA');
    expect(rangeCombos(r, parseCards('As'))).toHaveLength(3);
  });

  it('死牌用光某个类别时该类别消失', () => {
    const r = parseRange('AA');
    // 四张 A 全部是死牌，AA 一种组合都不剩
    expect(rangeCombos(r, parseCards('As Ah Ad Ac'))).toHaveLength(0);
  });

  it('每个组合带上正确的权重与类别', () => {
    const r = parseRange('AA:0.5');
    for (const wc of rangeCombos(r, [])) {
      expect(wc.weight).toBe(0.5);
      expect(wc.handClass).toBe('AA');
      expect(classifyHand(...wc.cards)).toBe('AA');
    }
  });

  it('权重为 0 的类别不产生组合', () => {
    expect(rangeCombos(parseRange('AA:0'), [])).toHaveLength(0);
  });

  it('空范围得到空数组', () => {
    expect(rangeCombos(new Map(), [])).toEqual([]);
  });

  it('死牌只匹配组合中第二张牌时同样剔除', () => {
    // AKo 的 12 组里 A 恒在第一张、K 恒在第二张。
    // 用黑桃 K 作死牌，只能通过 cards[1] 匹配到 ——
    // 这条专门盯 sameCard(d, cards[0]) || sameCard(d, cards[1]) 的后半段。
    const r = parseRange('AKo');
    expect(rangeCombos(r, parseCards('Ks'))).toHaveLength(9);
  });

  it('死牌只匹配第一张牌时剔除', () => {
    const r = parseRange('AKo');
    expect(rangeCombos(r, parseCards('As'))).toHaveLength(9);
  });

  it('两张死牌分别匹配两个位置时累计剔除', () => {
    // A♠ 去掉 3 组（K 为 h/d/c），K♠ 去掉 3 组（A 为 h/d/c），
    // 两者无重叠，因为 A♠K♠ 是同花不属于 AKo
    const r = parseRange('AKo');
    expect(rangeCombos(r, parseCards('As Ks'))).toHaveLength(6);
  });
});

describe('totalWeight', () => {
  it('等于各组合权重之和', () => {
    const combos = rangeCombos(parseRange('AA:0.5'), []);
    expect(totalWeight(combos)).toBeCloseTo(6 * 0.5, 9);
  });

  it('空数组为 0', () => {
    expect(totalWeight([])).toBe(0);
  });
});

describe('sampleCombo', () => {
  it('采样结果一定来自范围内', () => {
    const combos = rangeCombos(parseRange('AA, KK'), []);
    const tw = totalWeight(combos);
    const rng = createRng('sample-1');
    for (let i = 0; i < 200; i++) {
      const [a, b] = sampleCombo(combos, tw, rng);
      expect(['AA', 'KK']).toContain(classifyHand(a, b));
    }
  });

  it('相同 seed 采样序列相同', () => {
    const combos = rangeCombos(parseRange('AA, KK, QQ'), []);
    const tw = totalWeight(combos);
    const take = (seed: string) => {
      const rng = createRng(seed);
      return Array.from({ length: 20 }, () => sampleCombo(combos, tw, rng).map(cardToString).join(''));
    };
    expect(take('same')).toEqual(take('same'));
  });

  it('权重影响采样比例', () => {
    // AA 权重 1、KK 权重 0.2，组合数都是 6，AA 应显著更常被采到
    const combos = rangeCombos(parseRange('AA, KK:0.2'), []);
    const tw = totalWeight(combos);
    const rng = createRng('weighted');
    let aa = 0;
    const N = 6000;
    for (let i = 0; i < N; i++) {
      if (classifyHand(...sampleCombo(combos, tw, rng)) === 'AA') aa++;
    }
    // 期望比例 6/(6+1.2) ≈ 0.833
    expect(aa / N).toBeGreaterThan(0.79);
    expect(aa / N).toBeLessThan(0.87);
  });

  it('空组合列表抛错', () => {
    expect(() => sampleCombo([], 0, createRng('x'))).toThrow();
  });
});

describe('fullRange', () => {
  it('169 类全在，权重都是 1', () => {
    const r = fullRange();
    expect(r.size).toBe(169);
    for (const w of r.values()) expect(w).toBe(1);
  });

  it('展开后是 1326 个组合', () => {
    expect(rangeCombos(fullRange(), [])).toHaveLength(1326);
  });
});

describe('rangeFraction', () => {
  it('全范围是 1', () => {
    expect(rangeFraction(fullRange())).toBeCloseTo(1, 9);
  });

  it('空范围是 0', () => {
    expect(rangeFraction(new Map())).toBe(0);
  });

  it('AA 单独约占 0.45%', () => {
    expect(rangeFraction(parseRange('AA'))).toBeCloseTo(6 / 1326, 9);
  });

  it('权重折算进比例', () => {
    expect(rangeFraction(parseRange('AA:0.5'))).toBeCloseTo(3 / 1326, 9);
  });

  it('常见开池范围落在合理区间', () => {
    // BTN 开池约 40-50%
    const btn = parseRange('22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, T9o, 98o');
    expect(rangeFraction(btn)).toBeGreaterThan(0.38);
    expect(rangeFraction(btn)).toBeLessThan(0.52);
  });
});
