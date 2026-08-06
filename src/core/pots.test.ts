import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildPots } from './pots';

const contrib = (o: Record<number, number>) =>
  new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));

describe('buildPots', () => {
  it('所有人投入相同时只有一个主池', () => {
    const pots = buildPots(contrib({ 0: 10, 1: 10, 2: 10 }), new Set());
    expect(pots).toEqual([{ amount: 30, eligible: [0, 1, 2] }]);
  });

  it('短筹码 all-in 产生边池', () => {
    // 座位0 投 10，座位1、2 各投 50
    const pots = buildPots(contrib({ 0: 10, 1: 50, 2: 50 }), new Set());
    expect(pots).toEqual([
      { amount: 30, eligible: [0, 1, 2] },  // 主池 10×3
      { amount: 80, eligible: [1, 2] },     // 边池 40×2
    ]);
  });

  it('三人不同筹码全下产生两个边池', () => {
    const pots = buildPots(contrib({ 0: 10, 1: 25, 2: 60 }), new Set());
    expect(pots).toEqual([
      { amount: 30, eligible: [0, 1, 2] },  // 10×3
      { amount: 30, eligible: [1, 2] },     // 15×2
      { amount: 35, eligible: [2] },        // 35×1
    ]);
  });

  it('弃牌玩家的投入算作死钱，但不参与争夺', () => {
    // 座位2 投了 10 后弃牌。两层的有资格者都是 [0,1]，因此合并成一个池：
    // 10×3 = 30（含座位2 的死钱）加上 40×2 = 80，共 110
    const pots = buildPots(contrib({ 0: 50, 1: 50, 2: 10 }), new Set([2]));
    expect(pots).toEqual([{ amount: 110, eligible: [0, 1] }]);
  });

  it('资格相同的相邻层会合并成一个池', () => {
    // 座位1、2 都弃牌后，三层的有资格者都只剩 [0]，全部合并
    const pots = buildPots(contrib({ 0: 60, 1: 25, 2: 10 }), new Set([1, 2]));
    expect(pots).toEqual([{ amount: 95, eligible: [0] }]);
  });

  it('资格不同的层不会被合并', () => {
    // 无人弃牌：第一层 [0,1,2]，第二层只有 [1,2]，资格不同，保持两个池
    const pots = buildPots(contrib({ 0: 10, 1: 50, 2: 50 }), new Set());
    expect(pots).toHaveLength(2);
    expect(pots[0].eligible).toEqual([0, 1, 2]);
    expect(pots[1].eligible).toEqual([1, 2]);
  });

  it('投入为 0 的座位不产生池层', () => {
    const pots = buildPots(contrib({ 0: 0, 1: 10, 2: 10 }), new Set([0]));
    expect(pots).toEqual([{ amount: 20, eligible: [1, 2] }]);
  });

  it('单人未弃牌时全部归其所有', () => {
    const pots = buildPots(contrib({ 0: 10, 1: 30 }), new Set([0]));
    const total = pots.reduce((s, p) => s + p.amount, 0);
    expect(total).toBe(40);
    expect(pots.every(p => p.eligible.length === 1 && p.eligible[0] === 1)).toBe(true);
  });
});

describe('buildPots 不变量（属性测试）', () => {
  it('所有池金额之和恒等于总投入', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 200 }), { minLength: 2, maxLength: 6 }),
        fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 5 }),
        (amounts, foldList) => {
          const map = new Map(amounts.map((v, i) => [i, v]));
          const folded = new Set(foldList.filter(s => s < amounts.length));
          // 至少留一人未弃牌
          if (folded.size >= amounts.length) return true;

          const pots = buildPots(map, folded);
          const totalIn = amounts.reduce((a, b) => a + b, 0);
          const totalPots = pots.reduce((s, p) => s + p.amount, 0);
          expect(totalPots).toBe(totalIn);
          // 每个池都必须有人有资格赢
          expect(pots.every(p => p.eligible.length > 0)).toBe(true);
          return true;
        },
      ),
      { numRuns: 2000 },
    );
  });
});
