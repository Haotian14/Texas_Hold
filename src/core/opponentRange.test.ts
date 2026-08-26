import { describe, it, expect } from 'vitest';
import type { Card } from './cards';
import { parseCards } from './cards';
import { createRng } from './rng';
import { rangeFraction } from './rangeSet';
import { parseRange } from './rangeNotation';
import { initialRange, narrowByAction } from './opponentRange';
import { rfiKey, vsOpenKey, rangeForAction } from './ranges';
import { equityVsRanges } from './equity';
import type { NarrowContext } from './opponentRange';

const ctx = (over: Partial<NarrowContext> = {}): NarrowContext => ({
  street: 'flop',
  board: parseCards('7h 4d 2c'),
  dead: parseCards('7h 4d 2c'),
  potBefore: 10,
  betSize: 5,
  strengthIterations: 80,
  rng: createRng('narrow'),
  ...over,
});

describe('initialRange', () => {
  it('各位置都能拿到范围', () => {
    for (const pos of ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const) {
      expect(initialRange(pos).size).toBeGreaterThan(0);
    }
  });

  it('位置越靠后范围越宽', () => {
    expect(rangeFraction(initialRange('UTG'))).toBeLessThan(rangeFraction(initialRange('CO')));
    expect(rangeFraction(initialRange('CO'))).toBeLessThan(rangeFraction(initialRange('BTN')));
  });

  it('大盲无 RFI 表，回落到全范围', () => {
    expect(initialRange('BB').size).toBe(169);
  });
});

describe('narrowByAction 弃牌', () => {
  it('弃牌得到空范围', () => {
    expect(narrowByAction(initialRange('BTN'), 'fold', ctx()).size).toBe(0);
  });
});

describe('narrowByAction 收窄方向', () => {
  it('下注后范围变窄', () => {
    const before = initialRange('BTN');
    const after = narrowByAction(before, 'bet', ctx());
    expect(rangeFraction(after)).toBeLessThan(rangeFraction(before));
  });

  it('加注比下注收得更窄', () => {
    const before = initialRange('BTN');
    const bet = narrowByAction(before, 'bet', ctx());
    const raise = narrowByAction(before, 'raise', ctx());
    expect(rangeFraction(raise)).toBeLessThan(rangeFraction(bet));
  });

  it('全下收得最窄', () => {
    const before = initialRange('BTN');
    const allin = narrowByAction(before, 'allin', ctx());
    const raise = narrowByAction(before, 'raise', ctx());
    expect(rangeFraction(allin)).toBeLessThanOrEqual(rangeFraction(raise));
  });

  it('大尺度下全下仍然比加注更窄', () => {
    const before = initialRange('BTN');
    // betSize 是底池的两倍，mdf ≈ 0.333，加注保留 0.2、全下保留 0.167
    const big = ctx({ potBefore: 10, betSize: 20 });
    const raise = narrowByAction(before, 'raise', big);
    const allin = narrowByAction(before, 'allin', big);
    expect(rangeFraction(allin)).toBeLessThan(rangeFraction(raise));
  });

  it('下注尺度越大范围越窄', () => {
    const before = initialRange('BTN');
    const small = narrowByAction(before, 'bet', ctx({ betSize: 3 }));
    const big = narrowByAction(before, 'bet', ctx({ betSize: 20 }));
    expect(rangeFraction(big)).toBeLessThan(rangeFraction(small));
  });

  it('跟注后范围也变窄，但不如加注窄', () => {
    const before = initialRange('BTN');
    const call = narrowByAction(before, 'call', ctx());
    const raise = narrowByAction(before, 'raise', ctx());
    expect(rangeFraction(call)).toBeLessThan(rangeFraction(before));
    expect(rangeFraction(call)).toBeGreaterThan(rangeFraction(raise));
  });

  it('过牌剔除最强的部分', () => {
    const before = initialRange('BTN');
    const after = narrowByAction(before, 'check', ctx());
    expect(rangeFraction(after)).toBeLessThan(rangeFraction(before));
  });

  it('过牌剔除的比例接近声称的两成，而不是整类删除后的三成', () => {
    const before = initialRange('BTN');
    const after = narrowByAction(before, 'check', ctx({ board: [], dead: [], street: 'preflop' }));
    const ratio = rangeFraction(after) / rangeFraction(before);
    // 名义保留八成；整类删除会掉到 0.68 左右
    expect(ratio).toBeGreaterThan(0.74);
    expect(ratio).toBeLessThan(0.86);
  });

  it('只含单一类别的范围过牌后不会被清空', () => {
    const single = parseRange('AA');
    const after = narrowByAction(single, 'check', ctx({ board: [], dead: [], street: 'preflop' }));
    expect(after.size).toBe(1);
    expect(after.get('AA')!).toBeGreaterThan(0.7);
    expect(after.get('AA')!).toBeLessThan(0.9);
  });
});

describe('narrowByAction 保留的是正确的那一端', () => {
  it('下注后保留的是强牌：范围内最强手牌仍在', () => {
    const before = initialRange('CO');
    const after = narrowByAction(before, 'bet', ctx({ board: [], dead: [], street: 'preflop' }));
    expect(after.has('AA')).toBe(true);
  });

  it('过牌后剔除的是强牌：AA 不再出现', () => {
    const before = initialRange('CO');
    const after = narrowByAction(before, 'check', ctx({ board: [], dead: [], street: 'preflop' }));
    expect(after.has('AA')).toBe(false);
  });
});

describe('narrowByAction 边界', () => {
  it('空范围收窄后仍为空', () => {
    expect(narrowByAction(new Map(), 'bet', ctx()).size).toBe(0);
  });

  it('结果永远是原范围的子集', () => {
    const before = initialRange('BTN');
    for (const act of ['check', 'call', 'bet', 'raise', 'allin'] as const) {
      const after = narrowByAction(before, act, ctx());
      for (const hc of after.keys()) {
        expect(before.has(hc)).toBe(true);
      }
    }
  });

  it('相同输入结果可复现', () => {
    const before = initialRange('BTN');
    const a = narrowByAction(before, 'bet', ctx({ rng: createRng('same') }));
    const b = narrowByAction(before, 'bet', ctx({ rng: createRng('same') }));
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });
});

describe('narrowByAction 翻前查表收窄', () => {
  const pfCtx = (over: Partial<NarrowContext> = {}): NarrowContext => ({
    street: 'preflop',
    board: [],
    dead: [],
    potBefore: 1.5,
    betSize: 3,
    strengthIterations: 20,
    rng: createRng('narrow-preflop'),
    ...over,
  });

  it('开池（rfi 节点）不收窄：RFI 范围本身就是这次加注的范围', () => {
    for (const pos of ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const) {
      const base = initialRange(pos);
      const node = { key: rfiKey(pos), kind: 'rfi' as const, opener: null };
      const after = narrowByAction(base, 'raise', pfCtx({ preflopNode: node }));
      expect(rangeFraction(after)).toBeCloseTo(rangeFraction(base), 10);
    }
  });

  it('面对开池 3bet：收成该节点表里的 3bet 范围', () => {
    const bb = initialRange('BB');   // 大盲无 RFI 表，是全范围
    const node = { key: vsOpenKey('BB', 'BTN'), kind: 'vs-open' as const, opener: 'BTN' as const };
    const after = narrowByAction(bb, 'raise', pfCtx({ preflopNode: node }));
    const table = rangeForAction(node.key, '3bet')!;
    // 全范围 ∩ 表 = 表本身
    expect(rangeFraction(after)).toBeCloseTo(rangeFraction(table), 10);
    // 落在一个真实 3bet 范围该有的宽度里（约一成），而不是机械式按尺度
    // 切出来的某个与 3bet 无关的比例
    expect(rangeFraction(after)).toBeGreaterThan(0.05);
    expect(rangeFraction(after)).toBeLessThan(0.15);
  });

  it('查表结果始终是行动者当前范围的子集，性格不会被表抹掉', () => {
    // 只剩最强一小撮的「岩石式」范围，面对开池 3bet
    const tight = parseRange('QQ+, AKs');
    const node = { key: vsOpenKey('BB', 'BTN'), kind: 'vs-open' as const, opener: 'BTN' as const };
    const after = narrowByAction(tight, 'raise', pfCtx({ preflopNode: node }));
    for (const [hc, w] of after) {
      expect(tight.get(hc) ?? 0).toBeGreaterThanOrEqual(w - 1e-9);
    }
  });

  it('交集为空时回落机械式，绝不产出空范围', () => {
    // 只打 72o 的范围与任何 3bet 表都不相交
    const weird = parseRange('72o');
    const node = { key: vsOpenKey('BB', 'BTN'), kind: 'vs-open' as const, opener: 'BTN' as const };
    const after = narrowByAction(weird, 'raise', pfCtx({ preflopNode: node }));
    expect(after.size).toBeGreaterThan(0);
  });

  it('不传节点时翻前仍走机械式（BB 位、4bet 以上没有表）', () => {
    const base = initialRange('CO');
    const withoutNode = narrowByAction(base, 'raise', pfCtx());
    expect(rangeFraction(withoutNode)).toBeLessThan(rangeFraction(base));
  });
});

describe('narrowByAction 保留比例的地板', () => {
  it('极端尺度下进攻动作也不会把范围收到地板以下', () => {
    const before = initialRange('BTN');
    // 十倍底池：mdf ≈ 0.09，没有地板时加注会收到 5% 以下
    const huge = ctx({ potBefore: 10, betSize: 100 });
    const raise = narrowByAction(before, 'raise', huge);
    const allin = narrowByAction(before, 'allin', huge);
    expect(rangeFraction(raise) / rangeFraction(before)).toBeGreaterThan(0.3);
    expect(rangeFraction(allin) / rangeFraction(before)).toBeGreaterThan(0.18);
    // 地板之下仍要保住「全下不宽于加注」
    expect(rangeFraction(allin)).toBeLessThanOrEqual(rangeFraction(raise));
  });
});

describe('AKo 单挑面对开池的胜率（收窄口径的回归钉子）', () => {
  const AKo: [Card, Card] = parseCards('Ah Kd') as [Card, Card];

  it('面对任一位置的 3bb 开池，AKo 单挑胜率都不低于 55%', () => {
    for (const pos of ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const) {
      const base = initialRange(pos);
      const after = narrowByAction(base, 'raise', {
        street: 'preflop',
        board: [],
        dead: [...AKo],
        potBefore: 1.5,
        betSize: 3,
        strengthIterations: 20,
        rng: createRng('narrow-akq'),
        preflopNode: { key: rfiKey(pos), kind: 'rfi', opener: null },
      });
      const equity = equityVsRanges(AKo, [], [after], 3000, createRng(`ak-${pos}`));
      // 旧实现（把开池当最强信号）在 UTG/HJ/CO 三个位置分别是 39% / 41% / 44%
      expect(equity).toBeGreaterThan(0.55);
    }
  });
});
