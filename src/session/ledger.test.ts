import { describe, it, expect } from 'vitest';
import { STARTING_STACK } from '../core/types';
import { createLedger, addBuyIn, recordHandPlayed, heroNet } from './ledger';

describe('SessionLedger', () => {
  it('开局账本记一次 STARTING_STACK 的买入', () => {
    const l = createLedger();
    expect(l.buyIns).toEqual([{ handIndex: 0, amount: STARTING_STACK }]);
    expect(l.totalBuyIn).toBe(STARTING_STACK);
    expect(l.handsPlayed).toBe(0);
  });

  it('开局时净盈亏为 0', () => {
    expect(heroNet(createLedger(), STARTING_STACK)).toBe(0);
  });

  it('输掉一半筹码，净盈亏是负的一半', () => {
    expect(heroNet(createLedger(), 50)).toBe(-50);
  });

  it('补码不算盈利：补码前后净盈亏不变', () => {
    const l0 = createLedger();
    const stackBeforeRebuy = 0.3;
    const netBefore = heroNet(l0, stackBeforeRebuy);

    // 补到 100BB，实际添进桌上的是 100 - 0.3 = 99.7
    const added = 100 - stackBeforeRebuy;
    const l1 = addBuyIn(l0, 7, added);
    const netAfter = heroNet(l1, 100);

    expect(netBefore).toBe(-99.7);
    expect(netAfter).toBe(netBefore);
  });

  it('补到 200BB 同样不改变净盈亏', () => {
    const l0 = createLedger();
    const stackBeforeRebuy = 0;
    const l1 = addBuyIn(l0, 3, 200 - stackBeforeRebuy);
    expect(heroNet(l0, stackBeforeRebuy)).toBe(-100);
    expect(heroNet(l1, 200)).toBe(-100);
  });

  it('多次补码后 totalBuyIn 与 buyIns 一致', () => {
    let l = createLedger();
    l = addBuyIn(l, 5, 100);
    l = addBuyIn(l, 12, 200);
    expect(l.buyIns).toHaveLength(3);
    expect(l.totalBuyIn).toBe(STARTING_STACK + 100 + 200);
    expect(l.totalBuyIn).toBe(l.buyIns.reduce((a, b) => a + b.amount, 0));
  });

  it('recordHandPlayed 只加手数，不动买入', () => {
    const l0 = createLedger();
    const l1 = recordHandPlayed(recordHandPlayed(l0));
    expect(l1.handsPlayed).toBe(2);
    expect(l1.totalBuyIn).toBe(l0.totalBuyIn);
  });

  it('所有转换都不改动入参（不可变）', () => {
    const l0 = createLedger();
    addBuyIn(l0, 1, 100);
    recordHandPlayed(l0);
    expect(l0.buyIns).toHaveLength(1);
    expect(l0.handsPlayed).toBe(0);
  });

  it('拒绝非正的买入额', () => {
    expect(() => addBuyIn(createLedger(), 1, 0)).toThrow();
    expect(() => addBuyIn(createLedger(), 1, -5)).toThrow();
  });
});
