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
    opponents: [{ seat: 1, position: 'BB', stack: 100, range: fullRange(), personaId: 'tag', canFold: true }],
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

  it('口袋对在非河牌圈获得隐含赔率加成', () => {
    const r = estimateEv(sit({
      street: 'flop',
      board: parseCards('7h 4d 2c'),
      heroCards: parseCards('5s 5d') as [Card, Card],
      pot: 20, toCall: 10, heroStack: 100,
    }), OPTS);
    const call = r.candidates.find(c => c.actionType === 'call')!;
    expect(call.impliedOdds).toBeGreaterThan(0);
    expect(call.ev).toBeCloseTo(r.heroEquity * (20 + 10) - 10 + call.impliedOdds!, 4);
  });

  it('非口袋对不获得隐含赔率加成，哪怕胜率很低', () => {
    const r = estimateEv(sit({
      street: 'flop',
      board: parseCards('7h 4d 2c'),
      heroCards: parseCards('Kh 9s') as [Card, Card],
      pot: 20, toCall: 10, heroStack: 100,
    }), OPTS);
    const call = r.candidates.find(c => c.actionType === 'call')!;
    expect(call.impliedOdds ?? 0).toBe(0);
    expect(call.ev).toBeCloseTo(r.heroEquity * (20 + 10) - 10, 4);
  });

  it('河牌圈口袋对也不获得加成', () => {
    const r = estimateEv(sit({
      street: 'river',
      board: parseCards('7h 4d 2c Ks 8h'),
      heroCards: parseCards('5s 5d') as [Card, Card],
      pot: 20, toCall: 10, heroStack: 100,
    }), OPTS);
    expect(r.candidates.find(c => c.actionType === 'call')!.impliedOdds ?? 0).toBe(0);
  });

  it('加注的底池不把对手已投入的部分重复计算', () => {
    // 底池 15 已含对手未被跟的 5。半池加注投入 12.5，对手再补 7.5，最终底池 35。
    // 旧公式用 pot + 2b = 40，凭空多出一个 toCall。
    const r = estimateEv(sit({
      street: 'flop', board: parseCards('7h 4d 2c'),
      pot: 15, toCall: 5, heroStack: 100,
    }), OPTS);
    const raise = r.candidates.find(c => c.label === 'bet 1/2')!;
    const fe = raise.foldEquity!;
    const wp = raise.equityWhenCalled!;
    // 精度用 2 位而非 3 位：raise.ev 内部用未取整的 fe/wp 算出再取整到 4 位小数，
    // 这里重算时只能用 candidate 上取整到 4 位小数的 fe/wp，乘以 15~35 的底池规模后
    // 累积误差可达 ~7e-4，用共享 rng（OPTS.rng 在整个文件里状态递进）时具体数值还
    // 会随测试顺序变化，3 位精度在某些排列下会被这点取整误差单独触发失败——不是公式错。
    expect(raise.ev).toBeCloseTo(fe * 15 + (1 - fe) * (wp * 35 - 12.5), 2);
  });

  it('筹码不足以跟平时给出不足额跟注，且没有弃牌率', () => {
    const r = estimateEv(sit({
      street: 'flop', board: parseCards('7h 4d 2c'),
      pot: 100, toCall: 100, heroStack: 20,
    }), OPTS);
    const allin = r.candidates.find(c => c.actionType === 'allin')!;
    expect(allin.label).toBe('call all-in');
    expect(allin.foldEquity).toBeUndefined();
    expect(allin.investment).toBe(20);
    // 争夺的底池：对手多出的 80 退还，双方各 20，加上此前的底池 0 => 40
    expect(allin.ev).toBeCloseTo(r.heroEquity * 40 - 20, 3);
    expect(r.candidates.filter(c => c.actionType === 'allin')).toHaveLength(1);
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
      opponents: [{ seat: 1, position: 'BB', stack: 200, range: parseRange('AA, KK, AKs, AKo, AQs'), personaId: 'tag', canFold: true }],
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
      opponents: [{ seat: 1, position: 'BB', stack: 200, range: parseRange('22+, A2s+, K9s+'), personaId: 'tag', canFold: true }],
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
      opponents: [{ seat: 1, position: 'BB', stack: 100, range: fullRange(), personaId: 'tag', canFold: true }],
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
      opponents: [{ seat: 1, position: 'BB', stack: 100, range: fullRange(), personaId: 'tag', canFold: true }],
    }), OPTS);
    const three = estimateEv(sit({
      pot: 10, toCall: 0,
      opponents: [1, 2, 3].map(seat => ({
        seat, position: 'BB' as const, stack: 100, range: fullRange(), personaId: 'tag', canFold: true,
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
      opponents: [{ seat: 1, position: 'BB', stack: 200, range: parseRange('22+, A2s+, K9s+, QTs+'), personaId: 'tag', canFold: true }],
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
      opponents: [{ seat: 1, position: 'BB', stack: 100, range: fullRange(), personaId: 'tag', canFold: true }],
    }), OPTS);
    const three = estimateEv(sit({
      opponents: [1, 2, 3].map(seat => ({
        seat, position: 'BB' as const, stack: 100, range: fullRange(), personaId: 'tag', canFold: true,
      })),
    }), OPTS);
    expect(three.heroEquity).toBeLessThan(one.heroEquity);
  });

  it('无对手时抛错', () => {
    expect(() => estimateEv(sit({ opponents: [] }), OPTS)).toThrow();
  });
});

describe('estimateEv 全下对手', () => {
  it('单挑面对全下时不再抛错，且弃牌率为零', () => {
    const r = estimateEv(sit({
      street: 'flop',
      board: parseCards('7h 4d 2c'),
      pot: 100,
      toCall: 40,
      heroStack: 100,
      opponents: [{ seat: 1, position: 'BB', stack: 0, range: fullRange(),
                    personaId: 'tag', canFold: false }],
    }), OPTS);
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      if (c.foldEquity !== undefined) expect(c.foldEquity).toBe(0);
    }
  });

  it('全下的对手计入胜率', () => {
    // 同一局面下，把对手从「能弃牌」改成「已全下」不应改变 heroEquity ——
    // 胜率算的是要打败谁，与对方还能不能做决策无关
    const base = {
      street: 'flop' as const,
      board: parseCards('7h 4d 2c'),
      pot: 100, toCall: 40, heroStack: 100,
    };
    const live = estimateEv(sit({ ...base,
      opponents: [{ seat: 1, position: 'BB' as const, stack: 100, range: fullRange(),
                    personaId: 'tag', canFold: true }],
    }), { ...OPTS, rng: createRng('eq-same') });
    const shoved = estimateEv(sit({ ...base,
      opponents: [{ seat: 1, position: 'BB' as const, stack: 0, range: fullRange(),
                    personaId: 'tag', canFold: false }],
    }), { ...OPTS, rng: createRng('eq-same') });
    expect(shoved.heroEquity).toBeCloseTo(live.heroEquity, 6);
  });

  it('多人局中全下的对手不计入弃牌率的指数', () => {
    const twoLive = estimateEv(sit({
      street: 'flop', board: parseCards('7h 4d 2c'), pot: 30, toCall: 0, heroStack: 100,
      opponents: [1, 2].map(seat => ({ seat, position: 'BB' as const, stack: 100,
        range: fullRange(), personaId: 'tag', canFold: true })),
    }), OPTS);
    const oneLiveOneShoved = estimateEv(sit({
      street: 'flop', board: parseCards('7h 4d 2c'), pot: 30, toCall: 0, heroStack: 100,
      opponents: [
        { seat: 1, position: 'BB' as const, stack: 100, range: fullRange(), personaId: 'tag', canFold: true },
        { seat: 2, position: 'BB' as const, stack: 0, range: fullRange(), personaId: 'tag', canFold: false },
      ],
    }), OPTS);
    const feTwo = twoLive.candidates.find(c => c.label === 'bet pot')!.foldEquity!;
    const feOne = oneLiveOneShoved.candidates.find(c => c.label === 'bet pot')!.foldEquity!;
    // 两个能弃牌的对手 => (1-mdf)^2；一个能弃牌 => (1-mdf)^1，后者更大
    expect(feOne).toBeGreaterThan(feTwo);
  });

  it('多人局中无关的全下对手不应抹掉隐含赔率加成', () => {
    const r = estimateEv(sit({
      street: 'flop',
      board: parseCards('9h 4d 2c'),
      heroCards: parseCards('5s 5d') as [Card, Card],
      pot: 20, toCall: 10, heroStack: 100,
      opponents: [
        { seat: 1, position: 'BB', stack: 100, range: fullRange(), personaId: 'tag', canFold: true },
        { seat: 2, position: 'CO', stack: 0, range: fullRange(), personaId: 'tag', canFold: false },
      ],
    }), OPTS);
    expect(r.candidates.find(c => c.actionType === 'call')!.impliedOdds!).toBeGreaterThan(0);
  });
});

describe('estimateEv 弃牌率对上教科书常数', () => {
  it('弃牌率对上教科书的 MDF 常数', () => {
    // 单个对手、无需跟注时，投入 b 到底池 pot：
    // MDF = pot/(pot+b)，弃牌率 Fe = 1 - MDF = b/(pot+b)
    // 满池下注 => Fe = 1/2；半池下注 => Fe = 1/3
    // 注意精度：EvCandidate.foldEquity 在生产代码里经 round4() 保留 4 位小数
    // （见 evEstimate.ts 底部 "EV 保留 4 位小数，避免测试因浮点尾数抖动"）。
    // 0.5 与 0.25 在二进制下可精确表示，round4 后仍与公式原始值重合，6 位精度
    // 也能通过；1/3 = 0.333333... 不能精确表示，round4 会截到 0.3333，与未截断
    // 的 1/3 相差 ~3.3e-5，6 位精度（阈值 5e-7）测不过——这是舍入截断，不是公式
    // 分歧，故把精度改成 4 位以匹配 round4 的实际粒度，而不是放松要验证的常数本身。
    const r = estimateEv(sit({ pot: 30, toCall: 0, heroStack: 200 }), OPTS);
    expect(r.candidates.find(c => c.label === 'bet pot')!.foldEquity!).toBeCloseTo(0.5, 4);
    expect(r.candidates.find(c => c.label === 'bet 1/2')!.foldEquity!).toBeCloseTo(1 / 3, 4);
    expect(r.candidates.find(c => c.label === 'bet 1/3')!.foldEquity!).toBeCloseTo(0.25, 4);
  });
});
