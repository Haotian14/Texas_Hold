import { describe, it, expect, vi } from 'vitest';
import { parseCards } from './cards';
import type { Card } from './cards';
import { createRng } from './rng';
import { parseRange } from './rangeNotation';
import { fullRange, rangeCombos } from './rangeSet';
import type { RangeSet } from './rangeSet';
import type { Situation } from './situation';
import { estimateEv } from './evEstimate';
import { equityVsRanges, InfeasibleSamplingError } from './equity';
import { rankRange, topFraction } from './rangeStrength';
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

  it('恰好一个候选被标为推荐，且它是「可推荐」候选里 EV 最高的那个', () => {
    const r = estimateEv(sit({ toCall: 5 }), OPTS);
    expect(r.candidates.filter(c => c.isRecommended)).toHaveLength(1);
    // 比较的基准是 notRecommendable === undefined 的那些候选，不是全部候选：
    // 深筹码全下（ALLIN_MAX_SPR）照常算 EV、也照常参与用户动作的匹配，但不参与
    // 推荐的选取，所以它的 EV 完全可能高于推荐动作——那正是这条规则要表达的。
    const eligible = r.candidates.filter(c => c.notRecommendable === undefined);
    const best = Math.max(...eligible.map(c => c.ev));
    expect(r.recommended.ev).toBe(best);
    expect(r.recommended.isRecommended).toBe(true);
    expect(r.recommended.notRecommendable).toBeUndefined();
  });

  it('深筹码时全下只算 EV、不参与推荐；浅筹码时照常参与', () => {
    // pot 10、stack 95 => SPR 9.5 > ALLIN_MAX_SPR，全下被标记
    const deep = estimateEv(sit({ toCall: 0, pot: 10, heroStack: 95 }), OPTS);
    expect(deep.candidates.find(c => c.label === 'all-in')!.notRecommendable).toBe('deep-stack-allin');
    expect(deep.recommended.label).not.toBe('all-in');

    // pot 10、stack 15 => SPR 1.5 <= ALLIN_MAX_SPR，全下是一个正常尺度
    const shallow = estimateEv(sit({ toCall: 0, pot: 10, heroStack: 15 }), OPTS);
    expect(shallow.candidates.find(c => c.label === 'all-in')!.notRecommendable).toBeUndefined();
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

describe('estimateEv 采样无解时只放宽真正冲突的对手，不连累健康范围', () => {
  // 镜像 evEstimate.ts 里的同名私有常量/算法，仅用于在测试里独立构造出
  // "全部对手都被替换成宽范围" 这个参照基线，从而验证选择性放宽确实
  // 只换了那一个退化对手，而不是像旧实现那样把所有对手都换掉。
  // 若生产代码改了这个常量或放宽算法，这里也要跟着改，这是刻意的耦合——
  // 这个测试的意义就在于验证"放宽算法到底放宽了几个人"，脱离算法细节
  // 就测不出这一点。
  const MIRROR_MIN_COMBOS_PER_OPPONENT = 8;
  function widenedReference(
    board: Card[],
    dead: Card[],
    opponentCount: number,
    strengthIterations: number,
    rng: ReturnType<typeof createRng>,
  ): RangeSet {
    const wideRanked = rankRange(fullRange(), board, dead, strengthIterations, rng);
    const needed = MIRROR_MIN_COMBOS_PER_OPPONENT * Math.max(1, opponentCount);
    let fraction = Math.min(1, needed / Math.max(1, wideRanked.length));
    for (let i = 0; i < 12; i++) {
      const r = topFraction(wideRanked, fraction);
      if (rangeCombos(r, dead).length >= needed || fraction >= 1) return r;
      fraction = Math.min(1, fraction * 1.6);
    }
    return topFraction(wideRanked, 1);
  }

  // 五个对手，其中一个（座位 3）被 4-bet 线收窄到只剩 AA，且 hero 自己持
  // AhAd、公共牌又见一张 Ac —— 牌桌四张 A 里三张已经不在牌堆，这个对手的
  // AA 范围剔除死牌后一个组合都凑不出来，equityVsRanges 对它必定抛
  // InfeasibleSamplingError。另外四个对手是正常的 ~40% 范围，彼此、以及
  // 和座位 3 的宽范围替身之间都有大把互不冲突的组合可摸。
  const heroCards = parseCards('Ah Ad') as [Card, Card];
  const board = parseCards('Ac 7d 2h');
  const dead = [...heroCards, ...board];
  const healthy = parseRange('22+, A2s+, K9s+, QTs+, JTs, ATo+');
  const opponents = [1, 2, 3, 4, 5].map(seat => ({
    seat, position: 'BB' as const, stack: 100,
    range: seat === 3 ? parseRange('AA') : healthy,
    personaId: 'tag', canFold: true,
  }));
  const sit: Situation = {
    heroSeat: 0, heroPosition: 'BTN', heroCards, board,
    street: 'flop', pot: 10, toCall: 0, heroStack: 100,
    heroStreetContribution: 0, opponents, heroIsPreflopAggressor: false,
  };

  it('健康的四个对手范围原样保留：估算成功，且只标记放宽了一个对手', () => {
    const r = estimateEv(sit, { iterations: 3000, strengthIterations: 120, rng: createRng('f2-selective') });

    expect(Number.isFinite(r.heroEquity)).toBe(true);
    // hero 持超对 AA，面对四个正常范围外加一个（正确地）只被单独替换的
    // 对手，胜率应当明显占优。用 0.6 做门槛——实测约 0.90 ~ 0.92（多个
    // 种子），留了远超观测抖动的余量。
    expect(r.heroEquity).toBeGreaterThan(0.6);
    expect(r.degraded).toBe('widened-ranges');
    expect(r.degradedOpponentCount).toBe(1);
  });

  it('对照组：把全部五个对手都换成同一份宽范围（旧实现的行为）在这个局面下连采样都做不到', () => {
    // 这是选择性放宽存在的理由，不只是"数字不一样"：宽范围本身只放宽到
    // MIN_COMBOS_PER_OPPONENT × 对手数（这里是 8×5=40 个组合）刚好够用的
    // 程度，五个对手全都从这个刚好够用的范围里摸两张互不冲突的牌，
    // 拒绝采样在实测里 100% 失败——旧实现会让这条 InfeasibleSamplingError
    // 直接逃出 estimateEv，而不是返回一个"只是不准"的数字。
    const widenedRef = widenedReference(board, dead, 5, 120, createRng('f2-ref'));
    expect(() =>
      equityVsRanges(
        heroCards, board,
        [widenedRef, widenedRef, widenedRef, widenedRef, widenedRef],
        3000, createRng('f2-allwidened'),
      ),
    ).toThrow(InfeasibleSamplingError);
  });
});

describe('estimateEv degraded 标记', () => {
  it('普通局面（不触发任何放宽）时 degraded 为 null，degradedOpponentCount 为 0', () => {
    const r = estimateEv(sit({ toCall: 5 }), OPTS);
    expect(r.degraded).toBeNull();
    expect(r.degradedOpponentCount).toBe(0);
  });

  it('多个对手塌缩到同一类别触发放宽时 degraded 标记为 widened-ranges', () => {
    const collapsed = parseRange('AA');
    const r = estimateEv(sit({
      street: 'preflop', board: [], pot: 1.5, toCall: 1, heroStack: 100,
      opponents: [1, 2, 3].map(seat => ({
        seat, position: 'BB' as const, stack: 100,
        range: collapsed, personaId: 'tag', canFold: true,
      })),
    }), OPTS);
    expect(r.degraded).toBe('widened-ranges');
    expect(r.degradedOpponentCount).toBeGreaterThan(0);
  });
});

describe('estimateEv 候选 EV 的标准误', () => {
  it('弃牌的标准误恒为 0，其余候选为正', () => {
    const r = estimateEv(sit({ toCall: 5 }), OPTS);
    const fold = r.candidates.find(c => c.actionType === 'fold')!;
    expect(fold.evStdErr).toBe(0);   // EV 恒为 0，不含任何采样量
    for (const c of r.candidates) {
      if (c.actionType === 'fold') continue;
      expect(c.evStdErr!).toBeGreaterThan(0);
    }
  });

  it('标准误随迭代数按 1/√n 收缩', () => {
    const base = { strengthIterations: 100, rng: createRng('se-test') };
    const lo = estimateEv(sit({ toCall: 5 }), { ...base, iterations: 500, rng: createRng('se-test') });
    const hi = estimateEv(sit({ toCall: 5 }), { ...base, iterations: 4500, rng: createRng('se-test') });
    const seOf = (r: typeof lo) => r.candidates.find(c => c.actionType === 'call')!.evStdErr!;
    // 迭代数 ×9 => 标准误应当约 ÷3。胜率本身也会随采样略变，留 25% 余量。
    expect(seOf(lo) / seOf(hi)).toBeGreaterThan(3 * 0.75);
    expect(seOf(lo) / seOf(hi)).toBeLessThan(3 * 1.25);
  });

  it('下注候选的标准误 = 不确定分支的赔付规模 × 胜率标准误', () => {
    // EV = Fe×底池 + (1−Fe)×(W'×calledPot − b)。前一项是确定的（对手弃牌，
    // 没有胜率可言），噪声全部来自「被跟注」那一支，系数是 (1−Fe)×calledPot。
    //
    // 这条测试顺便钉住一个反直觉的事实：噪声带跟的不是尺度大小。尺度变大时
    // calledPot 涨、Fe 也涨，两者反向——实测这个局面里全下的标准误（0.11）
    // 反而**小于** 1/3 池（0.15），因为全下的弃牌率高到「被跟注」很少发生。
    const pot = 10;
    const r = estimateEv(sit({ toCall: 0, pot, heroStack: 200 }), OPTS);
    for (const c of r.candidates) {
      if (c.foldEquity === undefined) continue;   // 只有下注/加注候选有这两个量
      const b = c.investment;
      const calledPot = pot + 2 * b;              // toCall = 0，对手跟注额就是 b
      const w = c.equityWhenCalled!;
      const seW = Math.sqrt((w * (1 - w)) / OPTS.iterations);
      expect(c.evStdErr!).toBeCloseTo((1 - c.foldEquity) * calledPot * seW, 3);
    }
  });

  it('推荐动作与最高 EV 的差不超过一个合成标准误', () => {
    // 噪声内并列时取投入最小的那个（RECOMMEND_TIE_SIGMAS），所以推荐动作
    // 未必是 EV 最高的那个——但它与最高分的差必须在噪声之内，否则就是选错了。
    for (const over of [{ toCall: 5 }, { toCall: 0, pot: 12, heroStack: 100 }, { toCall: 0, pot: 40, heroStack: 60 }]) {
      const r = estimateEv(sit(over), OPTS);
      const eligible = r.candidates.filter(c => c.notRecommendable === undefined);
      const top = eligible.reduce((a, b) => (b.ev > a.ev ? b : a));
      const band = Math.hypot(top.evStdErr ?? 0, r.recommended.evStdErr ?? 0);
      expect(top.ev - r.recommended.ev).toBeLessThanOrEqual(band + 1e-9);
      // 并列时取的是投入更小的那个，绝不会反过来取更大的
      if (r.recommended !== top) expect(r.recommended.investment).toBeLessThan(top.investment);
    }
  });
});

describe('estimateEv 弃牌率对上教科书常数', () => {
  it('平均范围、翻牌圈下的弃牌率贴近教科书的 MDF', () => {
    // 单个对手、无需跟注时，投入 b 到底池 pot，教科书的 MDF = pot/(pot+b)，
    // 对应弃牌率 Fe = b/(pot+b)：满池 => 1/2，半池 => 1/3，1/3 池 => 1/4。
    //
    // **这三个数现在是结果，不再是假设。** 旧实现把 MDF 直接当成对手的行为写死，
    // Fe 因此恒等于这三个常数——对手范围是 {AA} 也一样弃 33%，这正是被修掉的缺陷
    // （见 evEstimate.ts makeBetCandidate 里 continueFractions 处的长注释）。
    // 现在弃牌率由「这个价格下对手范围里有多少牌跟得起」算出来，
    // BETTOR_RANGE_STRENGTH 就是照着「平均范围要能复现这三个常数」标定的。
    //
    // 因此这里的断言从「逐位相等」放宽成「落在教科书值几个百分点内」：范围强弱
    // 与牌面都会让真实弃牌率偏离 MDF，那是模型该有的行为，不是误差。容差 0.08
    // 足以容纳这种偏离，又远小于旧模型在极端范围上的偏差量级（{AA} 面对全下，
    // 旧模型 0.905、新模型 0）。
    // 单块牌面会因为「这块面击中宽范围的比例」上下浮动若干个百分点，标定是对着
    // 一批随机牌面做的，所以这里也取多块牌面的平均，容差 0.08。
    const boards = ['Qh 7d 2c', 'Ts 9h 4d', 'Ah Kd 8s'];
    const feOf = (label: string) =>
      boards
        .map(b => estimateEv(sit({
          pot: 30, toCall: 0, heroStack: 200, street: 'flop', board: parseCards(b),
          heroCards: parseCards('5c 5d') as [Card, Card],
        }), OPTS).candidates.find(c => c.label === label)!.foldEquity!)
        .reduce((a, x) => a + x, 0) / boards.length;

    expect(Math.abs(feOf('bet pot') - 0.5)).toBeLessThan(0.08);
    expect(Math.abs(feOf('bet 1/2') - 1 / 3)).toBeLessThan(0.08);
    expect(Math.abs(feOf('bet 1/3') - 0.25)).toBeLessThan(0.08);
  });

  it('翻前的弃牌率高于 MDF —— 刻度不同，且翻前弃牌本来就不由即时赔率决定', () => {
    // 翻前用的是 BETTOR_RANGE_STRENGTH.preflop（0.72），不是翻后那个 0.65，
    // 理由见那个常量上的注释：翻前的牌力刻度被压扁（全范围 p10=0.377、
    // p50=0.492、p75=0.573），且翻前弃牌靠的是翻后可玩性而不是即时赔率。
    // 照 MDF 标定翻前会把对手建模得比任何真实牌桌都松——实测那样做时 AI
    // 自对弈 60 手里只有 8 手在翻前结束（对手面对开池几乎从不弃牌）。
    //
    // 这条测试钉住方向：翻前的弃牌率应当**高于**教科书 MDF，而不是贴着它。
    const r = estimateEv(sit({ pot: 30, toCall: 0, heroStack: 200 }), OPTS);
    const half = r.candidates.find(c => c.label === 'bet 1/2')!.foldEquity!;
    const pot = r.candidates.find(c => c.label === 'bet pot')!.foldEquity!;
    expect(half).toBeGreaterThan(1 / 3);
    expect(pot).toBeGreaterThan(0.5);
    // 但也不能高到「谁都不跟」：满池加注仍有相当一部分范围跟得起。
    expect(pot).toBeLessThan(0.85);
  });

  it('弃牌率随对手范围强弱变化：{AA} 一手不弃，宽范围会弃', () => {
    // 这条是新模型的核心性质，旧模型下不可能成立（Fe 与对手范围无关）。
    const nutted = estimateEv(sit({
      pot: 30, toCall: 0, heroStack: 200,
      opponents: [{ seat: 1, position: 'BB' as const, stack: 200, range: new Map([['AA', 1]]) as RangeSet, personaId: 'nit', canFold: true }],
    }), OPTS);
    expect(nutted.candidates.find(c => c.label === 'bet pot')!.foldEquity).toBe(0);
    expect(nutted.candidates.find(c => c.label === 'all-in')!.foldEquity).toBe(0);

    const wide = estimateEv(sit({ pot: 30, toCall: 0, heroStack: 200 }), OPTS);
    expect(wide.candidates.find(c => c.label === 'bet pot')!.foldEquity!).toBeGreaterThan(0.2);
  });
});

describe('estimateEv hero 自己的底牌 + 公共牌就能把对手范围挤空', () => {
  it('单个对手、hero 持 AhAd、公共牌含 Ac 时，对手范围 AA 只剩一个组合的死亡角——不应该崩溃', () => {
    // dead = [Ah, Ad, Ac, 7d, 2h]：牌桌上四张 A 里三张已经被 hero 的底牌和
    // 公共牌占掉，只剩 As。对手范围 AA 需要两张 A，剔除死牌后一个组合都凑不出来。
    // 这不是 narrowByAction 收窄多个对手范围导致互相冲突的那种「多人塌缩」——
    // 单个对手、hero 自己的底牌和公共牌就把这个类别挤空了，equityVsRanges 内部
    // 对空 combos 抛的必须是 InfeasibleSamplingError（estimateEv 会捕获并宽范围
    // 重试），而不是逃出 estimateEv 的裸 Error。
    const r = estimateEv(sit({
      street: 'flop',
      board: parseCards('Ac 7d 2h'),
      heroCards: parseCards('Ah Ad') as [Card, Card],
      pot: 10,
      toCall: 0,
      heroStack: 100,
      opponents: [{ seat: 1, position: 'BB', stack: 100, range: parseRange('AA'), personaId: 'tag', canFold: true }],
    }), OPTS);

    expect(Number.isFinite(r.heroEquity)).toBe(true);
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      expect(Number.isFinite(c.ev)).toBe(true);
    }
  });
});
