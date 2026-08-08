import { describe, it, expect } from 'vitest';
import { createRng } from '../core/rng';
import { initialRange } from '../core/opponentRange';
import { rangeFraction } from '../core/rangeSet';
import { allHandClasses } from '../core/handClass';
import type { Position } from '../core/types';
import { PERSONAS, GTO_PERSONA, getPersona } from './personas';
import { personaInitialRange } from './personaRange';

const POS: Position = 'UTG';

/** range a 里每个类别的权重都 <= range b 对应类别的权重（含 0） */
function weightsLessOrEqual(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  for (const hc of allHandClasses()) {
    const wa = a.get(hc) ?? 0;
    const wb = b.get(hc) ?? 0;
    if (wa > wb + 1e-9) return false;
  }
  return true;
}

describe('personaInitialRange', () => {
  it('gto 原型返回未经改动的基准范围', () => {
    const base = initialRange(POS);
    const r = personaInitialRange(POS, GTO_PERSONA, createRng('seed-gto'));
    expect(r).toEqual(base);
  });

  it('rock 的范围是 gto 的真子集，且按 rangeFraction 更窄', () => {
    const base = initialRange(POS);
    const rock = personaInitialRange(POS, getPersona('rock'), createRng('seed-rock'));

    expect(weightsLessOrEqual(rock, base)).toBe(true);
    // 真子集：至少有一个类别的权重严格更小
    const strictlySmaller = allHandClasses().some(hc => (rock.get(hc) ?? 0) < (base.get(hc) ?? 0) - 1e-9);
    expect(strictlySmaller).toBe(true);

    expect(rangeFraction(rock)).toBeLessThan(rangeFraction(base));
  });

  it('maniac 的范围是 gto 的真超集（基准范围的每个类别都保留），且按 rangeFraction 更宽', () => {
    const base = initialRange(POS);
    const maniac = personaInitialRange(POS, getPersona('maniac'), createRng('seed-maniac'));

    expect(weightsLessOrEqual(base, maniac)).toBe(true);
    // 真超集：至少新增了一个 base 里没有的类别（或某个类别权重变大）
    const strictlyLarger = allHandClasses().some(hc => (maniac.get(hc) ?? 0) > (base.get(hc) ?? 0) + 1e-9);
    expect(strictlyLarger).toBe(true);

    expect(rangeFraction(maniac)).toBeGreaterThan(rangeFraction(base));
  });

  it('相同 seed 得到完全相同的范围（可复现）', () => {
    const a = personaInitialRange(POS, getPersona('lag'), createRng('same-seed'));
    const b = personaInitialRange(POS, getPersona('lag'), createRng('same-seed'));
    expect(a).toEqual(b);
  });

  it('六个原型在同一位置至少产生四种不同的 rangeFraction', () => {
    const fractions = new Set(
      PERSONAS.map(p => rangeFraction(personaInitialRange(POS, p, createRng(`frac-${p.id}`)))),
    );
    expect(fractions.size).toBeGreaterThanOrEqual(4);
  });
});
