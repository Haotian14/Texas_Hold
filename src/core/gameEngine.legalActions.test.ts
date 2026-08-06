import { describe, it, expect } from 'vitest';
import { startHand, legalActions } from './gameEngine';
import { BIG_BLIND } from './types';

const types = (s: ReturnType<typeof startHand>) =>
  legalActions(s).map(a => a.type).sort();

describe('legalActions 翻前', () => {
  it('UTG 面对大盲可以 fold / call / raise / allin', () => {
    const s = startHand({ seed: 'la-1', buttonSeat: 0 });
    expect(types(s)).toEqual(['allin', 'call', 'fold', 'raise']);
  });

  it('面对下注时不能 check', () => {
    const s = startHand({ seed: 'la-2', buttonSeat: 0 });
    expect(types(s)).not.toContain('check');
  });

  it('call 的金额等于待跟注额', () => {
    const s = startHand({ seed: 'la-3', buttonSeat: 0 });
    const call = legalActions(s).find(a => a.type === 'call')!;
    expect(call.min).toBe(BIG_BLIND);
    expect(call.max).toBe(BIG_BLIND);
  });

  it('最小加注额 = 跟注额 + 上次加注增量', () => {
    const s = startHand({ seed: 'la-4', buttonSeat: 0 });
    const raise = legalActions(s).find(a => a.type === 'raise')!;
    // 面对 1BB，最小加注到 2BB，本次投入 2BB
    expect(raise.min).toBe(BIG_BLIND * 2);
  });

  it('最大加注额等于自己的全部筹码', () => {
    const s = startHand({ seed: 'la-5', buttonSeat: 0 });
    const seat = s.seats[s.toAct!];
    const raise = legalActions(s).find(a => a.type === 'raise')!;
    expect(raise.max).toBe(seat.stack);
  });

  it('allin 金额等于剩余筹码', () => {
    const s = startHand({ seed: 'la-6', buttonSeat: 0 });
    const seat = s.seats[s.toAct!];
    const allin = legalActions(s).find(a => a.type === 'allin')!;
    expect(allin.min).toBe(seat.stack);
    expect(allin.max).toBe(seat.stack);
  });

  it('大盲面对全员平跟时保留加注权（bet/raise 判别的唯一区分场景）', () => {
    const s = startHand({ seed: 'la-bb', buttonSeat: 0 });
    const bb = s.seats.find(x => x.position === 'BB')!;
    // 全员平跟到大盲：currentBet 仍是 1，但大盲已投入 1，所以 toCall 为 0。
    // 若用 toCall > 0 判别 bet/raise，这里会错误地给出 bet。
    const limped = { ...s, toAct: bb.seat };
    const acts = legalActions(limped);
    expect(acts.map(a => a.type).sort()).toEqual(['allin', 'check', 'raise']);
    // min 是"本次投入额"：加注到 2BB 只需再投 1BB，因为盲注已投过 1BB
    expect(acts.find(a => a.type === 'raise')!.min).toBe(BIG_BLIND);
  });
});

describe('legalActions 无人下注时', () => {
  it('可以 check / bet / allin，不能 fold 或 call', () => {
    const s = startHand({ seed: 'la-7', buttonSeat: 0 });
    // 手动构造「翻牌圈无人下注」的局面
    const flop = {
      ...s,
      street: 'flop' as const,
      currentBet: 0,
      lastRaiseSize: BIG_BLIND,
      toAct: 1,
      seats: s.seats.map(x => ({ ...x, streetContribution: 0, hasActedSinceLastFullRaise: false })),
    };
    expect(types(flop)).toEqual(['allin', 'bet', 'check']);
  });

  it('最小下注额为一个大盲', () => {
    const s = startHand({ seed: 'la-8', buttonSeat: 0 });
    const flop = {
      ...s,
      street: 'flop' as const,
      currentBet: 0,
      lastRaiseSize: BIG_BLIND,
      toAct: 1,
      seats: s.seats.map(x => ({ ...x, streetContribution: 0, hasActedSinceLastFullRaise: false })),
    };
    const bet = legalActions(flop).find(a => a.type === 'bet')!;
    expect(bet.min).toBe(BIG_BLIND);
  });
});

describe('legalActions 筹码不足时', () => {
  it('筹码少于跟注额时只能 fold 或 allin，没有 call', () => {
    const s = startHand({ seed: 'la-9', buttonSeat: 0 });
    const short = {
      ...s,
      currentBet: 50,
      seats: s.seats.map(x => (x.seat === s.toAct ? { ...x, stack: 20 } : x)),
    };
    expect(types(short)).toEqual(['allin', 'fold']);
  });

  it('筹码不足以完成最小加注时没有 raise，只有 allin', () => {
    const s = startHand({ seed: 'la-10', buttonSeat: 0 });
    // 面对 1BB，最小加注需投入 2BB；给他 1.5BB
    const short = {
      ...s,
      seats: s.seats.map(x => (x.seat === s.toAct ? { ...x, stack: 1.5 } : x)),
    };
    const t = types(short);
    expect(t).toContain('allin');
    expect(t).toContain('call');
    expect(t).not.toContain('raise');
  });
});

describe('legalActions 加注权', () => {
  it('已在本轮完整加注后行动过的人不能再加注，只能 fold/call', () => {
    const s = startHand({ seed: 'la-11', buttonSeat: 0 });
    const seat = s.toAct!;
    const afterShortAllin = {
      ...s,
      currentBet: 3,
      seats: s.seats.map(x =>
        x.seat === seat
          ? { ...x, hasActedSinceLastFullRaise: true, streetContribution: 2 }
          : x,
      ),
    };
    const t = types(afterShortAllin);
    expect(t).toContain('call');
    expect(t).toContain('fold');
    expect(t).not.toContain('raise');
  });

  it('无加注权且筹码充足时不提供 allin（全下即加注）', () => {
    const s = startHand({ seed: 'la-15', buttonSeat: 0 });
    const seat = s.toAct!;
    // 已在本轮完整加注后行动过，且面对一个短 all-in 抬高的金额
    const afterShortAllin = {
      ...s,
      currentBet: 3,
      seats: s.seats.map(x =>
        x.seat === seat
          ? { ...x, hasActedSinceLastFullRaise: true, streetContribution: 2 }
          : x,
      ),
    };
    expect(legalActions(afterShortAllin).map(a => a.type).sort()).toEqual(['call', 'fold']);
  });

  it('无加注权但筹码不足以跟注时仍可 allin（不足额跟注）', () => {
    const s = startHand({ seed: 'la-16', buttonSeat: 0 });
    const seat = s.toAct!;
    const shortStack = {
      ...s,
      currentBet: 50,
      seats: s.seats.map(x =>
        x.seat === seat
          ? { ...x, hasActedSinceLastFullRaise: true, streetContribution: 2, stack: 10 }
          : x,
      ),
    };
    expect(legalActions(shortStack).map(a => a.type).sort()).toEqual(['allin', 'fold']);
  });
});

describe('legalActions 边界', () => {
  it('本手已结束时返回空数组', () => {
    const s = startHand({ seed: 'la-12', buttonSeat: 0 });
    expect(legalActions({ ...s, handOver: true, toAct: null })).toEqual([]);
  });

  it('toAct 为 null 时返回空数组', () => {
    const s = startHand({ seed: 'la-13', buttonSeat: 0 });
    expect(legalActions({ ...s, toAct: null })).toEqual([]);
  });

  it('已弃牌或已全下的座位没有任何合法动作', () => {
    const s = startHand({ seed: 'la-14', buttonSeat: 0 });
    const seat = s.toAct!;
    const folded = {
      ...s,
      seats: s.seats.map(x => (x.seat === seat ? { ...x, folded: true } : x)),
    };
    expect(legalActions(folded)).toEqual([]);
    const allIn = {
      ...s,
      seats: s.seats.map(x => (x.seat === seat ? { ...x, allIn: true } : x)),
    };
    expect(legalActions(allIn)).toEqual([]);
  });
});
