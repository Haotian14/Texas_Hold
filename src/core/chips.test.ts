import { describe, it, expect } from 'vitest';
import { chipsGreater, isZeroChips, round2 } from './chips';

describe('chipsGreater', () => {
  it('明显更大时返回 true', () => {
    expect(chipsGreater(2, 1)).toBe(true);
  });

  it('明显更小或相等时返回 false', () => {
    expect(chipsGreater(1, 2)).toBe(false);
    expect(chipsGreater(1, 1)).toBe(false);
  });

  // 这是这个函数存在的唯一理由：把 chipsGreater 换回裸的 `a > b`，
  // 上面两条用例照样通过——必须靠下面这两条钉住浮点容差本身的行为，
  // 否则回退成裸比较也是全绿。
  it('差值低于 1e-9 时不算"更大"（浮点尾数容差）', () => {
    expect(chipsGreater(1 + 1e-10, 1)).toBe(false);
    expect(chipsGreater(0.1 + 0.2, 0.3)).toBe(false); // 经典浮点尾数案例
  });

  it('差值高于 1e-9 时才算"更大"', () => {
    expect(chipsGreater(1 + 1e-8, 1)).toBe(true);
    expect(chipsGreater(1.01, 1)).toBe(true);
  });

  it('a 略小于 b（负向浮点尾数）时不算"更大"', () => {
    expect(chipsGreater(1 - 1e-10, 1)).toBe(false);
  });
});

describe('isZeroChips', () => {
  it('恰好为 0 时为真', () => {
    expect(isZeroChips(0)).toBe(true);
  });

  it('浮点尾数量级（< 1e-9）时仍视为 0', () => {
    expect(isZeroChips(1e-10)).toBe(true);
    expect(isZeroChips(-1e-10)).toBe(true);
  });

  it('明显非零时为假', () => {
    expect(isZeroChips(0.01)).toBe(false);
  });
});

describe('round2', () => {
  it('规整到 2 位小数', () => {
    expect(round2(1.006)).toBe(1.01);
    expect(round2(2.0049999)).toBe(2);
  });

  it('消除浮点累加误差', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});
