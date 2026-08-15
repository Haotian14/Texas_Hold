import type { ActionType } from '../core/types';
import { chipsGreater } from '../core/chips';

export type SoundName =
  | 'chip-light'
  | 'chip-heavy'
  | 'deal-card'
  | 'board-flip'
  | 'fold'
  | 'check'
  | 'pot-win'
  | 'allin';

/**
 * 动作 → 音效。amount 与 pot 都是 BB。
 *
 * 轻重按**相对底池**分界而不是绝对金额：同样 2BB，在 3.5BB 的池里是
 * 大注，在 100BB 的池里是零头，绝对金额分不出这个差别。
 *
 * 穷尽 switch，不返回 null——六个动作类型每个都有音效。将来 ActionType
 * 若新增成员，这里会编译失败，比静默少播一个音效要好。「不播声音」的
 * 场景（如开局那一刻没有动作）由调用方守卫，不由本函数表达。
 */
export function soundFor(type: ActionType, amount: number, pot: number): SoundName {
  switch (type) {
    case 'fold':
      return 'fold';
    case 'check':
      return 'check';
    case 'allin':
      return 'allin';
    case 'bet':
    case 'raise':
    case 'call': {
      const halfPot = pot / 2;
      // chipsGreater(halfPot, amount) 为真即 amount < halfPot（轻）；
      // 相等归入重注。禁止裸 >= ，见 Global Constraints。
      return chipsGreater(halfPot, amount) ? 'chip-light' : 'chip-heavy';
    }
  }
}

const MUTE_KEY = 'poker-trainer.muted';

let ctx: AudioContext | null = null;
let muted = readMuted();
const buffers = new Map<SoundName, AudioBuffer>();

function readMuted(): boolean {
  // 隐私模式下 localStorage 可能抛错。抛了就退化成「本次会话内有效」，
  // 不让一个静音开关把整个界面搞崩。
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(v: boolean): void {
  muted = v;
  try {
    localStorage.setItem(MUTE_KEY, v ? '1' : '0');
  } catch {
    // 同上：存不下就算了，本次会话内仍然生效
  }
}

/**
 * 在第一次用户手势里调用。浏览器在用户手势前不允许播放音频，
 * 所以 AudioContext 惰性创建，并在同一个事件处理里 resume()。
 * 这是标准做法，不是 workaround。
 */
export function unlockAudio(): void {
  if (ctx) {
    void ctx.resume();
    return;
  }
  ctx = new AudioContext();
  void ctx.resume();
  void preload();
}

/**
 * 有真实录音的四个。它们是筹码撞击声——多体金属碰撞，合成器做出来一听就假，
 * 所以这四个用 CC0 录音（来源见 public/sounds/CREDITS.md）。
 */
const SAMPLED_SOUNDS = ['chip-light', 'chip-heavy', 'pot-win', 'allin'] as const;
type SampledName = (typeof SAMPLED_SOUNDS)[number];

function isSampled(name: SoundName): name is SampledName {
  return (SAMPLED_SOUNDS as readonly string[]).includes(name);
}

async function preload(): Promise<void> {
  const c = ctx;
  if (!c) return;
  await Promise.all(
    SAMPLED_SOUNDS.map(async name => {
      try {
        const res = await fetch(`sounds/${name}.mp3`);
        const buf = await c.decodeAudioData(await res.arrayBuffer());
        buffers.set(name, buf);
      } catch {
        // 单个音效加载失败不该让其他三个跟着不响，也不该刷控制台
      }
    }),
  );
}

/**
 * 合成音效的参数。这四个在 CC0 库里找不到合适素材，改用滤波噪声 + 包络实时合成——
 * 它们都是**短噪声瞬态**（发牌的滑擦、翻牌的脆响、搓牌、敲桌），正是合成最擅长的。
 *
 * 参数是按各自质感调出来的，不要随手改：
 * - freq/Q 决定音色的「亮」与「窄」，deal 偏闷、flip 偏脆
 * - decay 决定尾巴长短，check 是一记短促的敲击
 */
const SYNTH_PARAMS: Record<
  Exclude<SoundName, SampledName>,
  { type: BiquadFilterType; freq: number; q: number; peak: number; decay: number }
> = {
  'deal-card': { type: 'bandpass', freq: 1800, q: 0.9, peak: 0.22, decay: 0.11 },
  'board-flip': { type: 'highpass', freq: 3200, q: 0.7, peak: 0.26, decay: 0.07 },
  fold: { type: 'bandpass', freq: 1200, q: 0.8, peak: 0.18, decay: 0.14 },
  check: { type: 'lowpass', freq: 700, q: 3.5, peak: 0.34, decay: 0.09 },
};

/**
 * 白噪声 + 滤波 + 指数衰减包络。
 *
 * 这里用 Math.random() 生成噪声：本项目禁止 Math.random() 的是 core / ai /
 * review / session 四层（由 architecture.test.ts 的守卫强制），因为**牌局**的
 * 随机必须来自字符串 seed 才能复现。音频噪声与牌局状态无关，不在该约束内。
 */
function playSynth(name: Exclude<SoundName, SampledName>): void {
  const c = ctx;
  if (!c) return;
  const p = SYNTH_PARAMS[name];
  const len = Math.max(1, Math.floor(c.sampleRate * p.decay));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = p.type;
  filter.frequency.value = p.freq;
  filter.Q.value = p.q;
  const gain = c.createGain();
  const t = c.currentTime;
  gain.gain.setValueAtTime(p.peak, t);
  // 指数衰减不能收到 0（会抛错），收到一个足够小的值即可
  gain.gain.exponentialRampToValueAtTime(0.0001, t + p.decay);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(c.destination);
  src.start();
  src.stop(t + p.decay);
}

/** 播放。未解锁或已静音时是无操作；录音尚未加载完成时该次播放跳过 */
export function playSound(name: SoundName): void {
  if (muted || !ctx) return;
  if (!isSampled(name)) {
    playSynth(name);
    return;
  }
  const buf = buffers.get(name);
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
}
