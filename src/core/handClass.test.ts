import { describe, it, expect } from 'vitest';
import { parseCards, cardToString } from './cards';
import type { Card } from './cards';
import {
  classifyHand, allHandClasses, comboCount, expandCombos, parseHandClass, RANK_CHARS,
} from './handClass';

const c = (s: string) => parseCards(s) as [Card, Card];

describe('classifyHand', () => {
  it('对子只用两个点数字符', () => {
    expect(classifyHand(...c('As Ad'))).toBe('AA');
    expect(classifyHand(...c('2h 2c'))).toBe('22');
  });

  it('同花标 s，非同花标 o', () => {
    expect(classifyHand(...c('As Ks'))).toBe('AKs');
    expect(classifyHand(...c('As Kd'))).toBe('AKo');
  });

  it('大牌永远在前，与传入顺序无关', () => {
    expect(classifyHand(...c('Kd As'))).toBe('AKo');
    expect(classifyHand(...c('2s 7s'))).toBe('72s');
  });

  it('T 用字母表示', () => {
    expect(classifyHand(...c('Ts 9s'))).toBe('T9s');
  });
});

describe('allHandClasses', () => {
  it('恰好 169 种', () => {
    expect(allHandClasses()).toHaveLength(169);
  });

  it('无重复', () => {
    const all = allHandClasses();
    expect(new Set(all).size).toBe(169);
  });

  it('13 个对子、78 个同花、78 个非同花', () => {
    const all = allHandClasses();
    expect(all.filter(h => h.length === 2)).toHaveLength(13);
    expect(all.filter(h => h.endsWith('s'))).toHaveLength(78);
    expect(all.filter(h => h.endsWith('o'))).toHaveLength(78);
  });

  it('覆盖整副牌的所有两张组合', () => {
    // 169 个类别的组合数之和必须等于 C(52,2) = 1326
    const total = allHandClasses().reduce((s, h) => s + comboCount(h), 0);
    expect(total).toBe(1326);
  });
});

describe('comboCount', () => {
  it('对子 6 种、同花 4 种、非同花 12 种', () => {
    expect(comboCount('AA')).toBe(6);
    expect(comboCount('AKs')).toBe(4);
    expect(comboCount('AKo')).toBe(12);
  });
});

describe('expandCombos', () => {
  it('组合数与 comboCount 一致', () => {
    for (const hc of ['AA', 'AKs', 'AKo', '72o', 'T9s']) {
      expect(expandCombos(hc)).toHaveLength(comboCount(hc));
    }
  });

  it('展开出的每一组都能分类回原类别', () => {
    for (const hc of allHandClasses()) {
      for (const [a, b] of expandCombos(hc)) {
        expect(classifyHand(a, b)).toBe(hc);
      }
    }
  });

  it('同一组合内两张牌不重复', () => {
    for (const hc of ['AA', 'AKs', 'AKo']) {
      for (const [a, b] of expandCombos(hc)) {
        expect(cardToString(a)).not.toBe(cardToString(b));
      }
    }
  });

  it('全部 169 类展开后恰好覆盖 1326 个互不相同的组合', () => {
    const seen = new Set<string>();
    for (const hc of allHandClasses()) {
      for (const [a, b] of expandCombos(hc)) {
        // 用排序后的字符串做键，保证同一对牌只算一次
        seen.add([cardToString(a), cardToString(b)].sort().join(''));
      }
    }
    expect(seen.size).toBe(1326);
  });

  it('同花组合两张花色相同，非同花组合两张花色不同', () => {
    for (const [a, b] of expandCombos('AKs')) expect(a.suit).toBe(b.suit);
    for (const [a, b] of expandCombos('AKo')) expect(a.suit).not.toBe(b.suit);
  });
});

describe('parseHandClass', () => {
  it('解出点数下标与类型', () => {
    expect(parseHandClass('AA')).toEqual({ hiIdx: 12, loIdx: 12, kind: 'pair' });
    expect(parseHandClass('AKs')).toEqual({ hiIdx: 12, loIdx: 11, kind: 's' });
    expect(parseHandClass('72o')).toEqual({ hiIdx: 5, loIdx: 0, kind: 'o' });
  });

  it('非法类别抛错', () => {
    expect(() => parseHandClass('XX')).toThrow();
    expect(() => parseHandClass('AKx')).toThrow();
    expect(() => parseHandClass('AAs')).toThrow();   // 对子不能带花色标记
    expect(() => parseHandClass('KAs')).toThrow();   // 小牌在前
  });
});

describe('RANK_CHARS', () => {
  it('下标 0 是 2、下标 12 是 A', () => {
    expect(RANK_CHARS[0]).toBe('2');
    expect(RANK_CHARS[12]).toBe('A');
    expect(RANK_CHARS).toHaveLength(13);
  });
});
