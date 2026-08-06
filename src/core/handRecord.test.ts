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

  it('交换两个座位不同的动作后重放会抛错，而不是悄悄给出一个看似合理但错误的终局', () => {
    const { record } = playRandomHand('replay-tamper', 1);

    // 找一对座位不同的动作，交换它们在数组里的位置，模拟「记录被重排」
    let i = -1;
    let j = -1;
    outer: for (let a = 0; a < record.actions.length; a++) {
      for (let b = a + 1; b < record.actions.length; b++) {
        if (record.actions[a].seat !== record.actions[b].seat) {
          i = a;
          j = b;
          break outer;
        }
      }
    }
    // 一手随机自对弈几乎必然涉及多个座位；这条断言保证测试本身没有退化成
    // 「什么都没测」（例如意外抽到全场只有一个座位行动的怪局）
    expect(i).toBeGreaterThanOrEqual(0);

    const actions = [...record.actions];
    [actions[i], actions[j]] = [actions[j], actions[i]];
    const tampered = { ...record, actions };

    expect(() => replayHandRecord(tampered)).toThrow();
  });
});
