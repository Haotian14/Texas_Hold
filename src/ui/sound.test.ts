import { describe, it, expect } from 'vitest';
import { soundFor } from './sound';

describe('动作 → 音效映射', () => {
  it('弃牌 / 过牌 / 全下各有专属音效，与金额和底池无关', () => {
    expect(soundFor('fold', 0, 140)).toBe('fold');
    expect(soundFor('check', 0, 140)).toBe('check');
    expect(soundFor('allin', 100, 140)).toBe('allin');
    expect(soundFor('allin', 1, 4000)).toBe('allin');
  });

  it('下注 / 加注 / 跟注按相对底池分轻重', () => {
    // 底池 140（3.5BB），半池 1.75BB
    expect(soundFor('bet', 1, 3.5)).toBe('chip-light');
    expect(soundFor('raise', 3, 3.5)).toBe('chip-heavy');
    expect(soundFor('call', 1, 3.5)).toBe('chip-light');
    expect(soundFor('call', 3, 3.5)).toBe('chip-heavy');
  });

  it('恰好等于半池算重注', () => {
    expect(soundFor('bet', 1.75, 3.5)).toBe('chip-heavy');
  });

  it('同样的绝对金额，在小池是重注、在大池是零头', () => {
    // 2BB 在 3.5BB 池里超过半池；在 100BB 池里远不足半池
    expect(soundFor('bet', 2, 3.5)).toBe('chip-heavy');
    expect(soundFor('bet', 2, 100)).toBe('chip-light');
  });

  it('底池为 0 时任何正额都算重注（真实牌局不可达，仅锁定行为）', () => {
    expect(soundFor('bet', 1, 0)).toBe('chip-heavy');
  });
});
