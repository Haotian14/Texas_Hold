import { describe, it, expect } from 'vitest';
import { startHand, totalChips } from './gameEngine';
import { SMALL_BLIND, BIG_BLIND, STARTING_STACK, SEAT_COUNT } from './types';
import { cardToString } from './cards';

describe('startHand', () => {
  it('创建 6 个座位', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 0 });
    expect(s.seats).toHaveLength(SEAT_COUNT);
  });

  it('每人发两张底牌，全场无重复牌', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 0 });
    const all = s.seats.flatMap(x => x.holeCards).map(cardToString);
    expect(all).toHaveLength(12);
    expect(new Set(all).size).toBe(12);
  });

  it('剩余牌堆为 52 - 12 = 40 张', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 0 });
    expect(s.deck).toHaveLength(40);
  });

  it('按钮位座位的 position 为 BTN', () => {
    for (let btn = 0; btn < SEAT_COUNT; btn++) {
      const s = startHand({ seed: 'h1', buttonSeat: btn });
      expect(s.seats[btn].position).toBe('BTN');
    }
  });

  it('按钮位左手第一位是 SB，第二位是 BB', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 2 });
    expect(s.seats[3].position).toBe('SB');
    expect(s.seats[4].position).toBe('BB');
  });

  it('SB 与 BB 已扣除盲注', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 0 });
    const sb = s.seats.find(x => x.position === 'SB')!;
    const bb = s.seats.find(x => x.position === 'BB')!;
    expect(sb.stack).toBe(STARTING_STACK - SMALL_BLIND);
    expect(sb.streetContribution).toBe(SMALL_BLIND);
    expect(bb.stack).toBe(STARTING_STACK - BIG_BLIND);
    expect(bb.streetContribution).toBe(BIG_BLIND);
  });

  it('翻前由 UTG 首先行动', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 0 });
    expect(s.seats[s.toAct!].position).toBe('UTG');
  });

  it('初始 currentBet 为 BB，最小加注增量为 BB', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 0 });
    expect(s.currentBet).toBe(BIG_BLIND);
    expect(s.lastRaiseSize).toBe(BIG_BLIND);
  });

  it('SB 与 BB 尚未行动过（保留后续行动权）', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 0 });
    expect(s.seats.every(x => !x.hasActedSinceLastFullRaise)).toBe(true);
  });

  it('相同 seed 与按钮位产生完全相同的开局', () => {
    const a = startHand({ seed: 'same', buttonSeat: 3 });
    const b = startHand({ seed: 'same', buttonSeat: 3 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('开局筹码总量为 6 × 100', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 0 });
    expect(totalChips(s)).toBe(SEAT_COUNT * STARTING_STACK);
  });

  it('按钮位靠后时位置映射仍然正确（验证环绕）', () => {
    // buttonSeat=4 时座位 0/1/2/3 的偏移量在未加 seatCount 前都是负数，
    // 这条用例专门盯 (seat - buttonSeat + seatCount) % seatCount 的环绕修正
    const s = startHand({ seed: 'wrap', buttonSeat: 4 });
    expect(s.seats.map(x => x.position)).toEqual([
      'BB', 'UTG', 'HJ', 'CO', 'BTN', 'SB',
    ]);
  });

  it('不传 startingStacks 时每个座位仍固定为 STARTING_STACK', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 0 });
    expect(s.seats.every(x => x.startingStack === STARTING_STACK)).toBe(true);
  });

  it('传入 startingStacks 时各座位使用对应的起始筹码', () => {
    const stacks = [10, 20, 30, 40, 50, 60];
    const s = startHand({ seed: 'h1', buttonSeat: 0, startingStacks: stacks });
    for (const seat of s.seats) {
      expect(seat.startingStack).toBe(stacks[seat.seat]);
    }
    // SB/BB 扣盲注之前 stack 就等于各自的 startingStack
    const sb = s.seats.find(x => x.position === 'SB')!;
    expect(sb.stack).toBe(stacks[sb.seat] - SMALL_BLIND);
  });

  it('startingStacks 长度不等于 SEAT_COUNT 时抛错', () => {
    expect(() =>
      startHand({ seed: 'h1', buttonSeat: 0, startingStacks: [1, 2, 3] }),
    ).toThrow();
  });
});
