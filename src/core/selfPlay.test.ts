import { describe, it, expect } from 'vitest';
import { playRandomHand } from './selfPlay';
import { totalChips } from './gameEngine';
import { SEAT_COUNT, STARTING_STACK } from './types';
import { cardToString } from './cards';

const CHIPS = SEAT_COUNT * STARTING_STACK;

describe('一万手随机自对弈', () => {
  it('筹码守恒、无死锁、结果自洽', () => {
    for (let i = 0; i < 10_000; i++) {
      const seed = `selfplay-${i}`;
      const buttonSeat = i % SEAT_COUNT;

      const { state, record } = playRandomHand(seed, buttonSeat);

      // 本手必须正常结束
      expect(state.handOver).toBe(true);
      expect(state.results).not.toBeNull();

      // 筹码守恒
      if (Math.abs(totalChips(state) - CHIPS) > 1e-9) {
        throw new Error(`seed=${seed} 筹码不守恒：${totalChips(state)} != ${CHIPS}`);
      }

      // 净盈亏之和为 0
      const sum = state.results!.reduce((a, r) => a + r.netBB, 0);
      if (Math.abs(sum) > 1e-9) {
        throw new Error(`seed=${seed} 净盈亏之和 ${sum} != 0`);
      }

      // 公共牌张数与结束街道一致
      const expectedBoard =
        state.street === 'preflop' ? 0 :
        state.street === 'flop' ? 3 :
        state.street === 'turn' ? 4 : 5;
      if (state.board.length !== expectedBoard) {
        throw new Error(
          `seed=${seed} 街道 ${state.street} 但公共牌 ${state.board.length} 张`,
        );
      }

      // 全场牌面无重复
      const all = [...record.seats.flatMap(s => s.holeCards), ...record.board].map(cardToString);
      if (new Set(all).size !== all.length) {
        throw new Error(`seed=${seed} 出现重复牌：${all.join(' ')}`);
      }

      // 无人筹码为负
      if (state.seats.some(s => s.stack < 0)) {
        throw new Error(`seed=${seed} 出现负筹码`);
      }
    }
  }, 300_000);
});

describe('playRandomHand 可复现', () => {
  it('相同 seed 与按钮位产生完全相同的牌局', () => {
    const a = playRandomHand('repro-1', 2);
    const b = playRandomHand('repro-1', 2);
    expect(JSON.stringify(a.record)).toBe(JSON.stringify(b.record));
  });
});

describe('多种结束方式都会出现', () => {
  it('一万手中翻前结束与打到河牌的都有', () => {
    const streets = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const { state } = playRandomHand(`variety-${i}`, i % SEAT_COUNT);
      streets.add(state.street);
    }
    expect(streets.has('preflop')).toBe(true);
    expect(streets.has('river')).toBe(true);
  });
});
