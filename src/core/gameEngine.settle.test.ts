import { describe, it, expect } from 'vitest';
import { startHand, applyAction, settleHand, totalChips, round2 } from './gameEngine';
import { toHandRecord } from './handRecord';
import { SEAT_COUNT, STARTING_STACK, HAND_RECORD_SCHEMA_VERSION } from './types';
import type { GameState } from './types';
import { parseCards } from './cards';
import type { Card } from './cards';

const CHIPS = SEAT_COUNT * STARTING_STACK;

function play(s: GameState, steps: { type: any; amount?: number }[]): GameState {
  let cur = s;
  for (const step of steps) {
    if (cur.handOver) break;
    cur = applyAction(cur, step);
  }
  return cur;
}

/** 打到本手结束 */
function playOut(seed: string, steps: { type: any; amount?: number }[]): GameState {
  let s = startHand({ seed, buttonSeat: 0 });
  s = play(s, steps);
  return settleHand(s);
}

describe('settleHand 筹码守恒', () => {
  it('全部弃牌给 BB 时筹码总量不变', () => {
    const s = playOut('st-1', [
      { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' },
    ]);
    expect(totalChips(s)).toBe(CHIPS);
  });

  it('打到摊牌时筹码总量不变', () => {
    const s = playOut('st-2', [
      { type: 'call' }, { type: 'call' }, { type: 'call' }, { type: 'call' },
      { type: 'call' }, { type: 'check' },
      { type: 'check' }, { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' }, { type: 'check' },
    ]);
    expect(s.handOver).toBe(true);
    expect(totalChips(s)).toBe(CHIPS);
  });
});

describe('settleHand 结果', () => {
  it('全部弃牌时 BB 赢下盲注', () => {
    const s = playOut('st-3', [
      { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' },
    ]);
    const bbSeat = s.seats.find(x => x.position === 'BB')!.seat;
    const bbResult = s.results!.find(r => r.seat === bbSeat)!;
    expect(bbResult.netBB).toBe(0.5);      // 赢下 SB 的 0.5
    expect(bbResult.showdown).toBe(false);
  });

  it('净盈亏之和为 0', () => {
    const s = playOut('st-4', [
      { type: 'raise', amount: 3 }, { type: 'call' },
      { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' },
      { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' },
    ]);
    const sum = s.results!.reduce((a, r) => a + r.netBB, 0);
    expect(Math.abs(sum)).toBeLessThan(1e-9);
  });

  it('每个座位都有一条结果', () => {
    const s = playOut('st-5', [
      { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' },
    ]);
    expect(s.results).toHaveLength(SEAT_COUNT);
  });

  it('净盈亏 = 结算后筹码 - 起始筹码', () => {
    const s = playOut('st-6', [
      { type: 'raise', amount: 3 }, { type: 'call' },
      { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' },
      { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' },
    ]);
    for (const r of s.results!) {
      expect(r.netBB).toBeCloseTo(s.seats[r.seat].stack - STARTING_STACK, 9);
    }
  });
});

describe('toHandRecord', () => {
  it('产出自包含的完整记录', () => {
    const s = playOut('st-7', [
      { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' },
    ]);
    const rec = toHandRecord(s, {
      id: 'hand-1',
      heroSeat: 0,
      personaIds: { 1: 'tag', 2: 'lag', 3: 'station', 4: 'rock', 5: 'maniac' },
      timestamp: 1700000000000,
    });

    expect(rec.id).toBe('hand-1');
    expect(rec.schemaVersion).toBe(HAND_RECORD_SCHEMA_VERSION);
    expect(rec.seed).toBe('st-7');
    expect(rec.heroSeat).toBe(0);
    expect(rec.seats).toHaveLength(SEAT_COUNT);
    expect(rec.seats[0].personaId).toBe('hero');
    expect(rec.seats[1].personaId).toBe('tag');
    expect(rec.seats.every(x => x.holeCards.length === 2)).toBe(true);
    expect(rec.actions.length).toBeGreaterThan(0);
    expect(rec.results).toHaveLength(SEAT_COUNT);
  });

  it('记录可 JSON 往返', () => {
    const s = playOut('st-8', [
      { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' },
    ]);
    const rec = toHandRecord(s, {
      id: 'hand-2', heroSeat: 0, personaIds: {}, timestamp: 1,
    });
    expect(JSON.parse(JSON.stringify(rec))).toEqual(rec);
  });

  it('本手未结束时抛错', () => {
    const s = startHand({ seed: 'st-9', buttonSeat: 0 });
    expect(() =>
      toHandRecord(s, { id: 'x', heroSeat: 0, personaIds: {}, timestamp: 1 }),
    ).toThrow();
  });

  it('startingStack 如实反映各座位实际起始筹码，而不是写死的常量', () => {
    const stacks = [20, 40, 60, 80, 100, 150];
    const s0 = startHand({ seed: 'st-varied', buttonSeat: 0, startingStacks: stacks });
    const settled = settleHand(play(s0, [
      { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' },
    ]));
    const rec = toHandRecord(settled, { id: 'hand-varied', heroSeat: 0, personaIds: {}, timestamp: 1 });
    expect(rec.seats.map(x => x.startingStack)).toEqual(stacks);
  });
});

describe('分池平分', () => {
  /**
   * 合成一个必然平分的摊牌局面：公共牌本身就是皇家同花顺，
   * 所有人的底牌都用不上，牌力完全相同。
   * 底牌显式指定为红桃/方块小对子，避免与公共牌的黑桃重复。
   */
  function tieState(playerCount: number, perPlayerContribution: number) {
    const base = startHand({ seed: 'split-tie', buttonSeat: 0 });
    const holes = ['2h 2d', '3h 3d', '4h 4d', '5h 5d', '6h 6d', '7h 7d'];
    const seats = base.seats.map((s, i) => ({
      ...s,
      holeCards: parseCards(holes[i]) as [Card, Card],
      folded: i >= playerCount,
      stack: i < playerCount ? round2(STARTING_STACK - perPlayerContribution) : STARTING_STACK,
      streetContribution: 0,
      totalContribution: i < playerCount ? perPlayerContribution : 0,
    }));
    return {
      ...base,
      seats,
      board: parseCards('As Ks Qs Js Ts'),
      street: 'river' as const,
      toAct: null,
      handOver: true,
    };
  }

  /**
   * 与 tieState 相同的摊牌局面，但额外加入一位「跟注后弃牌」的玩家：
   * 他的筹码留在池里（死钱），却没有资格分池。这样底池金额不再是
   * 「每位赢家投入 × 赢家数」，因此赢家数无法整除底池金额是真实存在的，
   * 而不是浮点误差伪造出来的。
   */
  function tieStateWithDeadMoney(
    winnerCount: number,
    perWinnerContribution: number,
    deadMoneyContribution: number,
  ) {
    const base = startHand({ seed: 'split-tie-dead-money', buttonSeat: 0 });
    const holes = ['2h 2d', '3h 3d', '4h 4d', '5h 5d', '6h 6d', '7h 7d'];
    const seats = base.seats.map((s, i) => {
      if (i < winnerCount) {
        return {
          ...s,
          holeCards: parseCards(holes[i]) as [Card, Card],
          folded: false,
          stack: round2(STARTING_STACK - perWinnerContribution),
          streetContribution: 0,
          totalContribution: perWinnerContribution,
        };
      }
      if (i === winnerCount) {
        return {
          ...s,
          holeCards: parseCards(holes[i]) as [Card, Card],
          folded: true,
          stack: round2(STARTING_STACK - deadMoneyContribution),
          streetContribution: 0,
          totalContribution: deadMoneyContribution,
        };
      }
      return {
        ...s,
        holeCards: parseCards(holes[i]) as [Card, Card],
        folded: true,
        stack: STARTING_STACK,
        streetContribution: 0,
        totalContribution: 0,
      };
    });
    return {
      ...base,
      seats,
      board: parseCards('As Ks Qs Js Ts'),
      street: 'river' as const,
      toAct: null,
      handOver: true,
    };
  }

  it('能整除的底池五人平分，每人金额相同', () => {
    // 五人各投 4.6，底池 23.00，五等分应为 4.60
    const settled = settleHand(tieState(5, 4.6));
    const payouts = settled.results!
      .filter(r => r.seat < 5)
      .map(r => round2(r.netBB + 4.6));
    expect(payouts).toEqual([4.6, 4.6, 4.6, 4.6, 4.6]);
    expect(totalChips(settled)).toBe(SEAT_COUNT * STARTING_STACK);
  });

  it('能整除的底池两人平分，每人金额相同', () => {
    // 两人各投 1.15，底池 2.30，两等分应为 1.15
    const settled = settleHand(tieState(2, 1.15));
    const payouts = settled.results!
      .filter(r => r.seat < 2)
      .map(r => round2(r.netBB + 1.15));
    expect(payouts).toEqual([1.15, 1.15]);
    expect(totalChips(settled)).toBe(SEAT_COUNT * STARTING_STACK);
  });

  it('不能整除的底池仍然守恒，零头归座位号最小的赢家', () => {
    // 3 位摊牌玩家各投 0.05，另一位玩家跟注 0.05 后弃牌：
    // 死钱留在池中但无权参与分池，底池 = 4*0.05 = 0.20，
    // 三人平分时 0.20/3 除不尽（floor(20/3)=6 分，余 2 分）。
    // 这笔余数会全部计入座位号最小的赢家，但不影响：
    //  1) 三位赢家拿到的总额之和仍等于底池；
    //  2) 全局筹码守恒不变量。
    const settled = settleHand(tieStateWithDeadMoney(3, 0.05, 0.05));
    const potTotal = round2(3 * 0.05 + 0.05);
    const payoutSum = settled.results!
      .filter(r => r.seat < 3)
      .reduce((sum, r) => round2(sum + r.netBB + 0.05), 0);
    expect(payoutSum).toBe(potTotal);
    expect(totalChips(settled)).toBe(SEAT_COUNT * STARTING_STACK);

    // 零头具体去了哪：座位 0（三位赢家里号最小的）比另外两位多拿 0.02，
    // 净赚 0.03；座位 1、2 只拿到平分的 0.06，净赚 0.01。
    const netBySeat = new Map(settled.results!.map(r => [r.seat, r.netBB]));
    expect(netBySeat.get(0)).toBeCloseTo(0.03, 9);
    expect(netBySeat.get(1)).toBeCloseTo(0.01, 9);
    expect(netBySeat.get(2)).toBeCloseTo(0.01, 9);
  });
});
