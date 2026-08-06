import { describe, it, expect } from 'vitest';
import { playRandomHand } from './selfPlay';
import { replayHandRecord } from './handRecord';
import { SEAT_COUNT } from './types';

describe('replayHandRecord', () => {
  it('用 HandRecord 重放出与原局完全一致的终局', () => {
    const { record } = playRandomHand('replay-check', 3);
    const replayed = replayHandRecord(record);

    expect(replayed.board).toEqual(record.board);
    expect(replayed.results).toEqual(record.results);
    expect(replayed.actions).toEqual(record.actions);
  });

  it('多组 seed / buttonSeat（含随机筹码深度）都能精确重放', () => {
    for (let i = 0; i < 100; i++) {
      const seed = `replay-${i}`;
      const buttonSeat = i % SEAT_COUNT;
      // 用 seed 派生一组可复现的随机筹码深度，覆盖 startingStacks 路径
      const stacks = Array.from({ length: SEAT_COUNT }, (_, s) => 20 + ((i * 7 + s * 13) % 130));

      const { record } = playRandomHand(seed, buttonSeat, stacks);
      const replayed = replayHandRecord(record);

      expect(replayed.board).toEqual(record.board);
      expect(replayed.results).toEqual(record.results);
      expect(replayed.actions).toEqual(record.actions);
    }
  });

  it('重放出的终局确实 handOver 且已结算', () => {
    const { record } = playRandomHand('replay-settled', 0);
    const replayed = replayHandRecord(record);
    expect(replayed.handOver).toBe(true);
    expect(replayed.results).not.toBeNull();
  });
});
