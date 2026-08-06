import { describe, it, expect } from 'vitest';
import { createRng, shuffle } from './rng';

describe('createRng', () => {
  it('相同 seed 产生相同序列', () => {
    const a = createRng('hand-1');
    const b = createRng('hand-1');
    const seqA = Array.from({ length: 20 }, () => a.nextU32());
    const seqB = Array.from({ length: 20 }, () => b.nextU32());
    expect(seqA).toEqual(seqB);
  });

  it('不同 seed 产生不同序列', () => {
    const a = createRng('hand-1');
    const b = createRng('hand-2');
    const seqA = Array.from({ length: 20 }, () => a.nextU32());
    const seqB = Array.from({ length: 20 }, () => b.nextU32());
    expect(seqA).not.toEqual(seqB);
  });

  it('nextInt 落在 [0, n) 内', () => {
    const rng = createRng('range-test');
    for (let i = 0; i < 10000; i++) {
      const v = rng.nextInt(52);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(52);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('nextFloat 落在 [0, 1) 内', () => {
    const rng = createRng('float-test');
    for (let i = 0; i < 10000; i++) {
      const v = rng.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt 分布大致均匀', () => {
    const rng = createRng('uniform-test');
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 100000; i++) buckets[rng.nextInt(10)]++;
    // 每桶期望 10000，允许 ±5%
    for (const c of buckets) {
      expect(c).toBeGreaterThan(9500);
      expect(c).toBeLessThan(10500);
    }
  });
});

describe('shuffle', () => {
  it('是一个排列，不丢不重', () => {
    const src = Array.from({ length: 52 }, (_, i) => i);
    const out = shuffle(src, createRng('shuffle-1'));
    expect(out).toHaveLength(52);
    expect([...out].sort((a, b) => a - b)).toEqual(src);
  });

  it('不修改原数组', () => {
    const src = [1, 2, 3, 4, 5];
    const copy = [...src];
    shuffle(src, createRng('shuffle-2'));
    expect(src).toEqual(copy);
  });

  it('相同 seed 洗出相同结果', () => {
    const src = Array.from({ length: 52 }, (_, i) => i);
    const a = shuffle(src, createRng('same'));
    const b = shuffle(src, createRng('same'));
    expect(a).toEqual(b);
  });

  it('实际打乱了顺序', () => {
    const src = Array.from({ length: 52 }, (_, i) => i);
    const out = shuffle(src, createRng('actually-shuffles'));
    expect(out).not.toEqual(src);
  });
});
