import { describe, it, expect } from 'vitest';
import { parseCards } from './cards';
import type { Card } from './cards';
import { createRng } from './rng';
import { parseRange } from './rangeNotation';
import { fullRange } from './rangeSet';
import type { Situation } from './situation';
import { estimateEv } from './evEstimate';

function sit(over: Partial<Situation>): Situation {
  return {
    heroSeat: 0,
    heroPosition: 'BTN',
    heroCards: parseCards('As Ks') as [Card, Card],
    board: [],
    street: 'preflop',
    pot: 10,
    toCall: 0,
    heroStack: 100,
    heroStreetContribution: 0,
    opponents: [{ seat: 1, position: 'BB', stack: 100, range: fullRange(), personaId: 'tag' }],
    heroIsPreflopAggressor: false,
    ...over,
  };
}

const OPTS = { iterations: 2000, strengthIterations: 100, rng: createRng('ev-test') };

describe('estimateEv 基本结构', () => {
  it('候选里总是包含弃牌或过牌', () => {
    const r = estimateEv(sit({ toCall: 5 }), OPTS);
    expect(r.candidates.some(c => c.actionType === 'fold')).toBe(true);
  });

  it('无需跟注时给出过牌而非弃牌', () => {
    const r = estimateEv(sit({ toCall: 0 }), OPTS);
    expect(r.candidates.some(c => c.actionType === 'check')).toBe(true);
    expect(r.candidates.some(c => c.actionType === 'fold')).toBe(false);
  });

  it('弃牌 EV 恒为 0', () => {
    const r = estimateEv(sit({ toCall: 5 }), OPTS);
    expect(r.candidates.find(c => c.actionType === 'fold')!.ev).toBe(0);
  });

  it('恰好一个候选被标为推荐，且它的 EV 最高', () => {
    const r = estimateEv(sit({ toCall: 5 }), OPTS);
    expect(r.candidates.filter(c => c.isRecommended)).toHaveLength(1);
    const best = Math.max(...r.candidates.map(c => c.ev));
    expect(r.recommended.ev).toBe(best);
    expect(r.recommended.isRecommended).toBe(true);
  });

  it('下注尺度覆盖 1/3、1/2、2/3、满池、all-in', () => {
    const r = estimateEv(sit({ toCall: 0, pot: 12, heroStack: 100 }), OPTS);
    const labels = r.candidates.map(c => c.label);
    expect(labels).toContain('bet 1/3');
    expect(labels).toContain('bet 1/2');
    expect(labels).toContain('bet 2/3');
    expect(labels).toContain('bet pot');
    expect(labels).toContain('all-in');
  });

  it('筹码不足以下满池时该尺度不出现', () => {
    const r = estimateEv(sit({ toCall: 0, pot: 100, heroStack: 20 }), OPTS);
    expect(r.candidates.map(c => c.label)).not.toContain('bet pot');
    expect(r.candidates.map(c => c.label)).toContain('all-in');
  });
});

describe('estimateEv 跟注公式', () => {
  it('requiredEquity = 跟注额 / (底池 + 跟注额)', () => {
    const r = estimateEv(sit({ pot: 100, toCall: 50 }), OPTS);
    expect(r.requiredEquity).toBeCloseTo(50 / 150, 9);
  });

  it('无需跟注时 requiredEquity 为 null', () => {
    expect(estimateEv(sit({ toCall: 0 }), OPTS).requiredEquity).toBeNull();
  });

  it('跟注 EV 符合公式 W×(底池+跟注额) − 跟注额', () => {
    const r = estimateEv(sit({ pot: 100, toCall: 50 }), OPTS);
    const call = r.candidates.find(c => c.actionType === 'call')!;
    const expected = r.heroEquity * (100 + 50) - 50;
    expect(call.ev).toBeCloseTo(expected, 6);
  });
});

describe('estimateEv 胜率驱动决策', () => {
  it('胜率远低于所需赔率时推荐弃牌', () => {
    // 河牌圈 hero 只有高牌 J 高，面对满池下注，对手范围很强
    const r = estimateEv(sit({
      street: 'river',
      board: parseCards('As Kd 9h 4c 2s'),
      heroCards: parseCards('Jh Th') as [Card, Card],
      pot: 100,
      toCall: 100,
      opponents: [{ seat: 1, position: 'BB', stack: 200, range: parseRange('AA, KK, AKs, AKo, AQs'), personaId: 'tag' }],
    }), OPTS);
    expect(r.recommended.actionType).toBe('fold');
  });

  it('拿到坚果时不推荐弃牌', () => {
    const r = estimateEv(sit({
      street: 'river',
      board: parseCards('Qs Js 9s 4h 2d'),
      heroCards: parseCards('As Ks') as [Card, Card],
      pot: 100,
      toCall: 30,
      opponents: [{ seat: 1, position: 'BB', stack: 200, range: parseRange('22+, A2s+, K9s+'), personaId: 'tag' }],
    }), OPTS);
    expect(r.recommended.actionType).not.toBe('fold');
    expect(r.heroEquity).toBeGreaterThan(0.85);
  });
});

describe('estimateEv 弃牌率与跟注后胜率', () => {
  it('对手跟注后的胜率严格低于对全范围的胜率', () => {
    // 这是公式里 W' 必须单独算的原因：对手跟注时留下的是更强的那部分范围。
    // 若实现偷懒沿用 W，这条会失败。
    const r = estimateEv(sit({
      street: 'flop',
      board: parseCards('7h 4d 2c'),
      heroCards: parseCards('As Ks') as [Card, Card],
      pot: 10,
      toCall: 0,
      opponents: [{ seat: 1, position: 'BB', stack: 100, range: fullRange(), personaId: 'tag' }],
    }), OPTS);
    const bet = r.candidates.find(c => c.label === 'bet 2/3')!;
    expect(bet.equityWhenCalled).toBeDefined();
    expect(bet.equityWhenCalled!).toBeLessThan(r.heroEquity);
  });

  it('下注尺度越大，对手弃牌率越高', () => {
    // foldEquity = (1 - MDF)^对手数，是确定性算式，不含蒙特卡洛噪声
    const r = estimateEv(sit({ pot: 10, toCall: 0, heroStack: 100 }), OPTS);
    const small = r.candidates.find(c => c.label === 'bet 1/3')!;
    const mid = r.candidates.find(c => c.label === 'bet 2/3')!;
    const big = r.candidates.find(c => c.label === 'bet pot')!;
    expect(small.foldEquity!).toBeLessThan(mid.foldEquity!);
    expect(mid.foldEquity!).toBeLessThan(big.foldEquity!);
  });

  it('对手越多，全体弃牌的概率越低', () => {
    const one = estimateEv(sit({
      pot: 10, toCall: 0,
      opponents: [{ seat: 1, position: 'BB', stack: 100, range: fullRange(), personaId: 'tag' }],
    }), OPTS);
    const three = estimateEv(sit({
      pot: 10, toCall: 0,
      opponents: [1, 2, 3].map(seat => ({
        seat, position: 'BB' as const, stack: 100, range: fullRange(), personaId: 'tag',
      })),
    }), OPTS);
    const feOne = one.candidates.find(c => c.label === 'bet pot')!.foldEquity!;
    const feThree = three.candidates.find(c => c.label === 'bet pot')!.foldEquity!;
    expect(feThree).toBeLessThan(feOne);
  });

  it('拿到坚果时价值下注优于过牌', () => {
    const r = estimateEv(sit({
      street: 'river',
      board: parseCards('Qs Js 9s 4h 2d'),
      heroCards: parseCards('As Ks') as [Card, Card],
      pot: 100,
      toCall: 0,
      heroStack: 200,
      opponents: [{ seat: 1, position: 'BB', stack: 200, range: parseRange('22+, A2s+, K9s+, QTs+'), personaId: 'tag' }],
    }), OPTS);
    const check = r.candidates.find(c => c.actionType === 'check')!;
    const bet = r.candidates.find(c => c.label === 'bet 2/3')!;
    expect(bet.ev).toBeGreaterThan(check.ev);
    expect(r.recommended.actionType).not.toBe('check');
  });
});

describe('estimateEv 可复现', () => {
  it('相同 seed 得到完全相同的结果', () => {
    const run = () => estimateEv(sit({ toCall: 5 }), { ...OPTS, rng: createRng('same') });
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});

describe('estimateEv 多人底池', () => {
  it('对手越多，hero 胜率越低', () => {
    const one = estimateEv(sit({
      opponents: [{ seat: 1, position: 'BB', stack: 100, range: fullRange(), personaId: 'tag' }],
    }), OPTS);
    const three = estimateEv(sit({
      opponents: [1, 2, 3].map(seat => ({
        seat, position: 'BB' as const, stack: 100, range: fullRange(), personaId: 'tag',
      })),
    }), OPTS);
    expect(three.heroEquity).toBeLessThan(one.heroEquity);
  });

  it('无对手时抛错', () => {
    expect(() => estimateEv(sit({ opponents: [] }), OPTS)).toThrow();
  });
});
