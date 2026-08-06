import { describe, it, expect } from 'vitest';
import { startHand, applyAction, settleHand, toHandRecord, totalChips } from './gameEngine';
import { SEAT_COUNT, STARTING_STACK, HAND_RECORD_SCHEMA_VERSION } from './types';
import type { GameState } from './types';

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
});
