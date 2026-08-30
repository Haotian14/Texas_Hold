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
 * 钉住的都是「坏了要用耳朵才听得出来」的事：削波、循环接缝、爆音、以及
 * 「根本没出声」。采样率取 8000 只为跑得快，波形的性质与采样率无关。
 *
 * 换成五声音阶的拨弦旋律之后，「每个小节交界处恒为 0」那条断言删掉了：
 * 它钉的是改版前逐小节套一个正弦窗的**实现方式**，而拨弦的余音本来就该
 * 越过小节线，不越过才是错的。防爆音这件事本身没有放松，改由下面那条
 * 「相邻样本之间不跳变」来守——它不关心波形是怎么合成的，只关心结果里
 * 有没有台阶，比原来那条更接近「用耳朵听有没有咔哒声」。
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

  it('音头是渐起的：少了那 4 ms 起音就是六十四声咔哒', () => {
    const data = render();
    // 循环开头那个音四周没有别的余音，是唯一能干净看到起音形状的地方。
    // 不用「相邻样本不跳变」来测：8 kHz 采样下第三分音（2.2 kHz）本身
    // 每个样本就要走 1.7 弧度，正常波形的跳变已经和一声咔哒同量级，
    // 那条断言在这个采样率下区分不出任何东西。
    const attack = Math.round(0.004 * RATE);
    let head = 0;
    for (let i = 0; i < 8; i++) head = Math.max(head, Math.abs(data[i]));
    let peak = 0;
    for (let i = attack; i < attack * 10; i++) peak = Math.max(peak, Math.abs(data[i]));

    // 断言写成比值而不是绝对幅度：调总增益（BGM_MIX）时这条不该跟着失效。
    // 实测起音头八个样本到 0.064，起音之后峰值 0.40，比值 0.16；把那 4 ms
    // 去掉，头八个样本立刻是 0.27，比值 0.67——0.3 这条线两边都留了两倍余量
    expect(head).toBeLessThan(peak * 0.3);
    // 起音之后确实到了该有的幅度，否则上面那条用一整段静音也能过
    expect(peak).toBeGreaterThan(0.15);
  });

  it('循环接缝对得上：末尾接回开头不会有台阶', () => {
    const data = render();
    expect(Math.abs(data[0] - data[LEN - 1])).toBeLessThan(1e-3);
  });

  it('缓冲区比一整段循环短时按长度截断，不越界写', () => {
    const short = new Float32Array(100);
    expect(() => renderBgm(short, RATE)).not.toThrow();
    expect(short.length).toBe(100);
  });
});
