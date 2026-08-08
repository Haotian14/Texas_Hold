import { describe, it, expect } from 'vitest';
import { createRng } from '../core/rng';
import { PERSONAS, GTO_PERSONA, getPersona, assignPersonas } from './personas';

describe('PERSONAS', () => {
  it('预置六个原型', () => {
    expect(PERSONAS).toHaveLength(6);
  });

  it('id 互不重复', () => {
    expect(new Set(PERSONAS.map(p => p.id)).size).toBe(PERSONAS.length);
  });

  it('每个原型的参数都在合理区间内', () => {
    for (const p of PERSONAS) {
      expect(p.rangeWidthMul).toBeGreaterThan(0.2);
      expect(p.rangeWidthMul).toBeLessThan(3);
      expect(p.aggression).toBeGreaterThan(0.2);
      expect(p.aggression).toBeLessThan(3);
      expect(p.bluffFreq).toBeGreaterThanOrEqual(0);
      expect(p.bluffFreq).toBeLessThanOrEqual(1);
      expect(p.callThresholdMul).toBeGreaterThan(0.2);
      expect(p.callThresholdMul).toBeLessThan(3);
      expect(p.cbetFreq).toBeGreaterThanOrEqual(0);
      expect(p.cbetFreq).toBeLessThanOrEqual(1);
    }
  });

  it('原型之间在性格上确实拉开了差距', () => {
    // 跟注站应当比岩石跟得松得多
    const station = getPersona('station');
    const rock = getPersona('rock');
    expect(station.callThresholdMul).toBeLessThan(rock.callThresholdMul);
    // 疯子应当比岩石激进得多、诈唬得多
    const maniac = getPersona('maniac');
    expect(maniac.aggression).toBeGreaterThan(rock.aggression);
    expect(maniac.bluffFreq).toBeGreaterThan(rock.bluffFreq);
    // 松凶范围比紧凶宽
    expect(getPersona('lag').rangeWidthMul).toBeGreaterThan(getPersona('tag').rangeWidthMul);
  });
});

describe('GTO_PERSONA', () => {
  it('所有倍率都是中性的', () => {
    expect(GTO_PERSONA.rangeWidthMul).toBe(1);
    expect(GTO_PERSONA.aggression).toBe(1);
    expect(GTO_PERSONA.callThresholdMul).toBe(1);
    expect(GTO_PERSONA.bluffFreq).toBe(0);
    // cbetFreq 的中性值是 0.5，不是 1——decide.ts 的 personaScore 用
    // (cbetFreq - 0.5) 算加成，0.5 才会让这一项恒为 0。漏掉这条断言曾经
    // 让 cbetFreq: 0.55 混进来过：GTO 在翻牌圈会悄悄拿到一个不为零的
    // c-bet 加成，其它四项全部中性的这条测试却照样通过。
    expect(GTO_PERSONA.cbetFreq).toBe(0.5);
  });
});

describe('getPersona', () => {
  it('按 id 取到对应原型', () => {
    expect(getPersona('tag').id).toBe('tag');
  });

  it('未知 id 抛错，且错误信息里带上那个 id', () => {
    expect(() => getPersona('nope')).toThrow(/nope/);
  });

  it('能取到 GTO 原型', () => {
    expect(getPersona(GTO_PERSONA.id)).toBe(GTO_PERSONA);
  });
});

describe('assignPersonas', () => {
  it('每个座位都分到一个原型', () => {
    const m = assignPersonas([0, 1, 2, 3, 4, 5], createRng('assign-1'), 0);
    expect(m.size).toBe(6);
  });

  it('hero 座位固定为 hero', () => {
    const m = assignPersonas([0, 1, 2, 3, 4, 5], createRng('assign-2'), 0);
    expect(m.get(0)).toBe('hero');
  });

  it('其余座位分到的都是真实原型 id', () => {
    const m = assignPersonas([0, 1, 2, 3, 4, 5], createRng('assign-3'), 0);
    const ids = new Set(PERSONAS.map(p => p.id));
    for (const [seat, id] of m) {
      if (seat === 0) continue;
      expect(ids.has(id)).toBe(true);
    }
  });

  it('相同 seed 分配结果相同', () => {
    const a = assignPersonas([0, 1, 2, 3, 4, 5], createRng('same'), 0);
    const b = assignPersonas([0, 1, 2, 3, 4, 5], createRng('same'), 0);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('不同 seed 通常分出不同的组合', () => {
    const a = assignPersonas([0, 1, 2, 3, 4, 5], createRng('x'), 0);
    const b = assignPersonas([0, 1, 2, 3, 4, 5], createRng('y'), 0);
    expect([...a.entries()]).not.toEqual([...b.entries()]);
  });
});
