import { describe, it, expect, vi } from 'vitest';
import { parseCards } from './cards';
import type { Card } from './cards';
import { createRng } from './rng';
import { parseRange } from './rangeNotation';
import { fullRange } from './rangeSet';
import type { Situation } from './situation';
import { estimateEv } from './evEstimate';
import * as rangeStrengthModule from './rangeStrength';

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

describe('estimateEv 隐含赔率守卫', () => {
  it('单挑面对全下时没有隐含赔率可言', () => {
    const r = estimateEv(sit({
      street: 'flop',
      board: parseCards('9h 6d 3c'),
      heroCards: parseCards('5s 5d') as [Card, Card],
      pot: 40, toCall: 20, heroStack: 100,
      opponents: [{ seat: 1, position: 'BB', stack: 0, range: fullRange(),
                    personaId: 'tag', canFold: false }],
    }), OPTS);
    expect(r.candidates.find(c => c.actionType === 'call')!.impliedOdds).toBeUndefined();
  });
});

describe('estimateEv 继续范围的物理下限', () => {
  it('多人局面对全下时不会因继续范围过窄而无法估算', () => {
    // 翻前底池 1.5，全下投入 100 => mdf ≈ 1.5%，切出来只剩一个类别。
    // 五个对手不可能同时握着同一批组合 —— 继续范围必须放宽到物理可行。
    const r = estimateEv(sit({
      street: 'preflop',
      board: [],
      pot: 1.5,
      toCall: 1,
      heroStack: 100,
      opponents: [1, 2, 3, 4, 5].map(seat => ({
        seat, position: 'BB' as const, stack: 100,
        range: parseRange('22+, A2s+, KTs+, ATo+'), personaId: 'tag', canFold: true,
      })),
    }), OPTS);
    const allin = r.candidates.find(c => c.label === 'all-in')!;
    expect(Number.isFinite(allin.ev)).toBe(true);
    expect(allin.equityWhenCalled).toBeDefined();
  });

  it('多个对手的原始范围塌缩到同一类别时仍能估算', () => {
    // narrowByAction 在翻前全下时会把范围收到约 0.7%，只剩一个类别。
    // 三个对手同时只剩 AA —— 牌桌上只有四张 A，采样必须仍然有解。
    const collapsed = parseRange('AA');
    const r = estimateEv(sit({
      street: 'preflop', board: [], pot: 1.5, toCall: 1, heroStack: 100,
      opponents: [1, 2, 3].map(seat => ({
        seat, position: 'BB' as const, stack: 100,
        range: collapsed, personaId: 'tag', canFold: true,
      })),
    }), OPTS);
    expect(Number.isFinite(r.heroEquity)).toBe(true);
    expect(r.candidates.every(c => Number.isFinite(c.ev))).toBe(true);
  });

  it('全下对手的范围塌缩到同一类别时，下注候选的重试也要连带宽放全下对手的范围', () => {
    // 三个对手都已经全下（canFold: false），narrowByAction 把他们的范围
    // 都收窄到 AA —— 牌桌只剩四张 A（hero 还占了一张），foldableOpponents
    // 为空，continueRanges 是 []，rangesForCalled 变成三份相同的 AA，
    // 采样物理无解。makeBetCandidate 的重试如果只宽放 continueRanges
    // （空数组，宽放了个寂寞），allInOpponents 的窄范围原样传回去，
    // 重试会跟第一次抛一样的 InfeasibleSamplingError，逃出 estimateEv。
    const collapsed = parseRange('AA');
    const r = estimateEv(sit({
      street: 'preflop', board: [], pot: 1.5, toCall: 1, heroStack: 100,
      opponents: [1, 2, 3].map(seat => ({
        seat, position: 'BB' as const, stack: 0,
        range: collapsed, personaId: 'tag', canFold: false,
      })),
    }), OPTS);
    expect(Number.isFinite(r.heroEquity)).toBe(true);
    expect(r.candidates.every(c => Number.isFinite(c.ev))).toBe(true);
  });

  it('物理可满足的窄范围原样保留，不会被替换成泛化范围', () => {
    // 三个对手每人 QQ+, AKs（22 combos）—— 低于旧版 8×3=24 的阈值，
    // 但三人完全可以互不冲突地各自摸到 QQ+/AKs 里的组合（QQ+ 共 18 个
    // 组合、AKs 4 个组合，远够 3 个对手各摸 2 张不冲突的牌）。旧的
    // widenIfPhysicallyInfeasible 只看单个对手的组合数是否够 8×3=24，
    // 22 < 24 会无条件把这个真实范围换成「牌力前 24」的泛化范围
    // （AA,KK,QQ,JJ）。新版只在采样真的失败时才兜底，因此这里应当
    // 采到 hero 对阵 {QQ+, AKs} 本身的胜率，而不是对阵 {AA,KK,QQ,JJ}。
    //
    // 用 hero 持 JJ 直接测量两者的差异（iterations=8000，独立脚本测量，
    // 7 个不同种子，flop 未涉及、纯翻前）：
    //   eq vs {QQ+, AKs}×3      落在 0.153 ~ 0.161
    //   eq vs {AA,KK,QQ,JJ}×3   落在 0.111 ~ 0.121
    // 差距稳定在 0.037 ~ 0.049（JJ 对阵 QQ+/AKs 时 AKs 只是接近race，
    // 对阵纯 AA/KK/QQ/JJ 时全是压制它的对子，因此更窄的「泛化」范围反而
    // 让 hero 的胜率更低）。用 0.02 做门槛，比观测到的最小差距 0.037
    // 留了接近一倍的余量。
    const narrow = parseRange('QQ+, AKs');
    const heroCards = parseCards('Jh Jd') as [Card, Card];

    const narrowResult = estimateEv(sit({
      street: 'preflop', board: [], pot: 1.5, toCall: 1, heroStack: 100,
      heroCards,
      opponents: [1, 2, 3].map(seat => ({
        seat, position: 'BB' as const, stack: 100, range: narrow, personaId: 'tag', canFold: true,
      })),
    }), { iterations: 8000, strengthIterations: 100, rng: createRng('feasible-narrow') });

    const wideGeneric = parseRange('AA,KK,QQ,JJ');
    const wideResult = estimateEv(sit({
      street: 'preflop', board: [], pot: 1.5, toCall: 1, heroStack: 100,
      heroCards,
      opponents: [1, 2, 3].map(seat => ({
        seat, position: 'BB' as const, stack: 100, range: wideGeneric, personaId: 'tag', canFold: true,
      })),
    }), { iterations: 8000, strengthIterations: 100, rng: createRng('feasible-wide') });

    expect(Number.isFinite(narrowResult.heroEquity)).toBe(true);
    expect(narrowResult.heroEquity).toBeGreaterThan(wideResult.heroEquity + 0.02);
  });
});

describe('estimateEv 宽范围兜底只算一次', () => {
  it('同一次 estimateEv 调用里，无论触发多少次兜底，全范围排序只跑一次', () => {
    // 三个对手全部塌缩到同一个类别 'AA'——牌桌只有四张 A，物理无解，
    // heroEquity 与每一个下注尺度（1/3、1/2、2/3、pot、all-in 共 5 个候选）
    // 的 W' 都会各自触发一次「宽范围兜底」。若兜底每次都重新
    // rankRange(fullRange(), …)，这里就会看到 6 次全范围排序；
    // 若按 brief 要求惰性缓存，只应看到 1 次。
    //
    // 用 flop 局面（board.length > 0）而不是翻前，这样 rankRange 走的是
    // 真正跑蒙特卡洛的分支（翻前会查表，开销本来就很小，测不出这里要
    // 验证的「贵调用只跑一次」）。用 range.size === 169（fullRange 的类别数）
    // 识别哪些调用是「宽范围」调用，区别于对每个对手真实（窄）范围的排序。
    const spy = vi.spyOn(rangeStrengthModule, 'rankRange');
    const collapsed = parseRange('AA');

    const r = estimateEv(sit({
      street: 'flop', board: parseCards('7h 4d 2c'), pot: 10, toCall: 0, heroStack: 100,
      opponents: [1, 2, 3].map(seat => ({
        seat, position: 'BB' as const, stack: 100, range: collapsed, personaId: 'tag', canFold: true,
      })),
    }), { iterations: 400, strengthIterations: 40, rng: createRng('widen-once') });

    const fullRangeCalls = spy.mock.calls.filter(([range]) => range.size === 169);
    expect(fullRangeCalls.length).toBe(1);
    expect(Number.isFinite(r.heroEquity)).toBe(true);

    spy.mockRestore();
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
