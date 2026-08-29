import { describe, it, expect } from 'vitest';
import { soundFor, renderBgm } from './sound';

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

/**
 * 背景音乐只测那段合成出来的波形——起停逻辑要 AudioContext，而这个文件
 * 跑在 environment: 'node' 下（见 sound.ts 顶部关于 try/catch 的注释）。
 * 钉住的三件事都是「坏了要用耳朵才听得出来」的：削波、循环接缝、以及
 * 「根本没出声」。采样率取 8000 只为跑得快，波形的性质与采样率无关。
 */
describe('背景音乐的循环波形', () => {
  const RATE = 8000;
  const LEN = RATE * 16; // 4 小节 × 4 秒

  function render(): Float32Array {
    const data = new Float32Array(LEN);
    renderBgm(data, RATE);
    return data;
  }

  it('不削波：整段的峰值留在 ±1 以内', () => {
    let peak = 0;
    for (const v of render()) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(1);
  });

  it('确实有声音，不是一整段静音', () => {
    const data = render();
    let sum = 0;
    for (const v of data) sum += v * v;
    expect(Math.sqrt(sum / data.length)).toBeGreaterThan(0.01);
  });

  it('首尾都收在 0：loop 接回开头时没有咔哒声', () => {
    const data = render();
    expect(Math.abs(data[0])).toBeLessThan(1e-6);
    expect(Math.abs(data[LEN - 1])).toBeLessThan(1e-3);
  });

  it('每个小节的交界处也收在 0（换和弦不会爆音）', () => {
    const data = render();
    for (let bar = 1; bar < 4; bar++) {
      expect(Math.abs(data[bar * 4 * RATE])).toBeLessThan(1e-6);
    }
  });

  it('缓冲区比一整段循环短时按长度截断，不越界写', () => {
    const short = new Float32Array(100);
    expect(() => renderBgm(short, RATE)).not.toThrow();
    expect(short.length).toBe(100);
  });
});
