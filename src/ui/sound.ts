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
// readMuted 里的 try/catch 不只是隐私模式的兜底：sound.test.ts 跑在
// environment: 'node' 下，那里没有 localStorage，是这个 try/catch 吞掉了
// ReferenceError，本模块才能在 node 下被 import（soundFor 才能被测到）。
// 将来若在模块作用域加 new AudioContext() 之类的副作用，这条路会直接断掉。
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
  // 静音是总闸，背景音乐跟着走：用户按下静音要的是「安静」，
  // 不是「音效没了但音乐还在响」。见文件末尾的 syncBgm。
  syncBgm();
}

/**
 * 在第一次用户手势里调用。浏览器在用户手势前不允许播放音频，
 * 所以 AudioContext 惰性创建，并在同一个事件处理里 resume()。
 * 这是标准做法，不是 workaround。
 */
export function unlockAudio(): void {
  if (ctx) {
    void ctx.resume();
    // 已有 ctx 也要同步一次：iOS 会在切回前台时把 ctx 挂起，
    // 那之后音乐是停着的，resume 之后要把它接回来
    syncBgm();
    return;
  }
  ctx = new AudioContext();
  void ctx.resume();
  void preload();
  // 背景音乐从第一次用户手势开始——和音效受同一条自动播放策略约束
  syncBgm();
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

/* ────────────────────────── 背景音乐 ────────────────────────── */

const BGM_KEY = 'poker-trainer.bgm';

/**
 * 背景音乐是否开着。**默认开**——这是唯一一个默认开的偏好。
 *
 * 与 prefs.ts 里「所有开关默认关」不冲突：那条说的是「默认值即一直以来的
 * 行为」，而背景音乐这件事本身就是新加的，加了却默认不响等于没加。它跟静音
 * 键一样留在本模块（而不是搬去 prefs.ts）：播放路径要读它，搬过去还得绕回来。
 *
 * 存的是 '0'/'1'，但判定用 !== '0' 而不是 === '1'——键不存在（第一次打开、
 * 或用户清过站点数据）时要落在「开」这一侧。
 */
let bgmOn = readBgmOn();

function readBgmOn(): boolean {
  try {
    return localStorage.getItem(BGM_KEY) !== '0';
  } catch {
    return true;
  }
}

export function isBgmOn(): boolean {
  return bgmOn;
}

export function setBgmOn(v: boolean): void {
  bgmOn = v;
  try {
    localStorage.setItem(BGM_KEY, v ? '1' : '0');
  } catch {
    // 同 setMuted：存不下就算了，本次会话内仍然生效
  }
  syncBgm();
}

/**
 * 一拍与一个八分音符的秒数。120 BPM —— 斗地主那类牌桌音乐的常见速度，
 * 快到有推进感，又不至于让人心跳跟着加速。
 */
const BGM_BEAT_SECONDS = 0.5;
const BGM_STEP_SECONDS = BGM_BEAT_SECONDS / 2;

/** 一小节八个八分音符（4/4），整段八小节 —— 循环 16 秒 */
const BGM_BAR_STEPS = 8;
const BGM_BARS = 8;
export const BGM_LOOP_SECONDS = BGM_BARS * BGM_BAR_STEPS * BGM_STEP_SECONDS;

/**
 * 旋律（MIDI 音高，0 = 休止），八小节 × 八个八分音符。
 *
 * 全部音高取自 **D 宫五声音阶**（D E F♯ A B，即宫商角徵羽），一个偏音都
 * 不用——中式牌桌音乐那股味道主要就来自这件事：没有 fa 和 si，旋律怎么跳
 * 都不会拐到西洋大调的解决感上去。
 *
 * 这段是原创，不是任何一款商业斗地主游戏 BGM 的转写——那些是有版权的。
 *
 * 与改版前那套 Am7–Fmaj7–Dm7–E7 的和弦垫是两种东西：那一版刻意不给旋律
 * 线（注释原话是「背景音乐不该有让人跟着哼的旋律线，那会抢掉注意力」），
 * 这一版反过来，旋律是主角。这是 2026-08-31 用户要求换成斗地主风格时定的，
 * 抢注意力这个代价是知情的选择，不是漏掉了那条考虑。
 */
const BGM_MELODY: readonly (readonly number[])[] = [
  [69, 69, 74, 76, 74, 71, 69, 0],
  [66, 69, 71, 69, 66, 64, 62, 0],
  [71, 74, 76, 74, 71, 66, 69, 71],
  [69, 66, 64, 66, 62, 0, 0, 0],
  [74, 76, 78, 76, 74, 71, 69, 71],
  [74, 71, 69, 66, 69, 71, 74, 0],
  [76, 74, 71, 69, 71, 69, 66, 64],
  // 末小节留两个八分的空白：循环接回开头前要有地方让余音落干净
  [74, 0, 69, 0, 66, 62, 0, 0],
];

/**
 * 低音，每小节两个（落在第一、第三拍），根音 + 五音来回蹦。
 *
 * 「蹦」是这类音乐的骨架：牌桌音乐靠低音的一来一回撑住节奏感，不靠鼓。
 * 走向是 D–D–G–D–Bm–G–A–D，配着上面那条旋律。
 */
const BGM_BASS: readonly (readonly [number, number])[] = [
  [38, 45],
  [38, 45],
  [43, 50],
  [38, 45],
  [47, 54],
  [43, 50],
  [45, 52],
  [38, 45],
];

/**
 * 循环缓冲区的采样率，故意远低于 AudioContext 的 48 kHz。
 *
 * 旋律最高到 F♯5（约 740 Hz），加上第三分音约 2.2 kHz，8 kHz 的奈奎斯特
 * 频率绰绰有余；而 16 kHz 让这段 16 秒的循环从 3 MB 降到 1 MB、合成耗时
 * 降到三分之一——它是在**用户第一次点击的那个事件里**算出来的，慢了会卡住
 * 那一下。采样率与 AudioContext 不一致由浏览器重采样，这是 Web Audio 的
 * 既定行为。
 */
const BGM_SAMPLE_RATE = 16000;

/** 背景音乐的音量。压得比任何一个音效都低——它是垫底的，不是来抢戏的 */
const BGM_GAIN = 0.1;
const BGM_FADE_IN = 1.5;
const BGM_FADE_OUT = 0.4;

/**
 * 拨弦包络的参数。
 *
 * 起音 4 ms 是**必须**的，不是修饰：直接从满音量起步会在每个音头上留一声
 * 咔哒，六十四个音就是六十四声。衰减用指数，高次分音衰减得更快——真实的
 * 弹拨乐器就是这样，泛音先掉、基频后掉，少了这一条听上去就是电子琴。
 */
const BGM_ATTACK = 0.004;
const BGM_MELODY_DECAY = 0.26;
const BGM_BASS_DECAY = 0.55;
/** 一个音渲染多久。到这里指数包络已经衰减到听不见，再算下去是白算 */
const BGM_NOTE_TAIL = 1.4;
/** 循环末尾的收尾淡出，保证首尾都是 0、接缝处不爆音 */
const BGM_SEAM_FADE = 0.4;
/**
 * 整段的总增益。
 *
 * 这个数是**量出来的**：六十四个音的余音互相叠加，峰值出在哪一拍推不出来。
 * 取 0.42 时峰值约 0.61、RMS 约 0.137，与改版前那套和弦垫（0.73 / 0.148）
 * 基本持平——换曲子不该顺带把音量也换了，何况拨弦的瞬态本来就比长音垫抓耳，
 * 响度持平已经意味着听感更靠前。不许削波这条有测试守着。
 */
const BGM_MIX = 0.42;

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/**
 * 把整段循环合成进 `data`。导出是为了能在没有 Web Audio 的 node 环境下测。
 *
 * 与改版前逐小节写死一个正弦窗不同，这里是**逐音符叠加**：每个音有自己的
 * 起音与衰减，尾巴自然越过小节线（拨弦本来就该这样）。因此「小节交界处
 * 恒为 0」这条旧性质不再成立，也不该成立；防爆音改由两件事保证——每个音
 * 头的 4 ms 起音，以及整段末尾的淡出，后者同时让 loop 接回开头时首尾都是 0。
 *
 * 与合成音效那边一样，这里的数学与牌局的随机无关，不受 architecture.test.ts
 * 那条「core/ai/review/session 禁用 Math.random」的约束（本函数根本没用到）。
 */
export function renderBgm(data: Float32Array, sampleRate: number): void {
  const total = Math.floor(sampleRate * BGM_LOOP_SECONDS);
  data.fill(0);

  const addNote = (startSec: number, midi: number, gain: number, decay: number): void => {
    const f = midiToFreq(midi);
    const from = Math.round(startSec * sampleRate);
    const tail = Math.floor(BGM_NOTE_TAIL * sampleRate);
    for (let k = 0; k < tail; k++) {
      const at = from + k;
      // 不越过缓冲区，也不绕回开头：尾巴被循环截掉正是末小节留白的用处
      if (at >= data.length || at >= total) return;
      const t = k / sampleRate;
      const env = t < BGM_ATTACK ? t / BGM_ATTACK : Math.exp(-(t - BGM_ATTACK) / decay);
      // 基频 + 二、三次分音，后两者衰减更快
      const s =
        Math.sin(2 * Math.PI * f * t) +
        0.5 * Math.exp(-t / (decay * 0.5)) * Math.sin(4 * Math.PI * f * t) +
        0.25 * Math.exp(-t / (decay * 0.35)) * Math.sin(6 * Math.PI * f * t);
      data[at] += (gain * env * s) / 1.75;
    }
  };

  for (let bar = 0; bar < BGM_BARS; bar++) {
    const barAt = bar * BGM_BAR_STEPS * BGM_STEP_SECONDS;
    BGM_MELODY[bar].forEach((midi, step) => {
      if (midi === 0) return;
      addNote(barAt + step * BGM_STEP_SECONDS, midi, BGM_MIX, BGM_MELODY_DECAY);
    });
    const [root, fifth] = BGM_BASS[bar];
    // 低音压低一档：它是骨架，不是旋律，冒出来就变成两条旋律在打架
    addNote(barAt, root, BGM_MIX * 0.75, BGM_BASS_DECAY);
    addNote(barAt + 2 * BGM_BEAT_SECONDS, fifth, BGM_MIX * 0.6, BGM_BASS_DECAY);
  }

  // 收尾淡出。只动缓冲区里真实存在的那一段——调用方给的可能比一整段循环短
  const fadeLen = Math.floor(BGM_SEAM_FADE * sampleRate);
  const fadeFrom = total - fadeLen;
  for (let i = Math.max(fadeFrom, 0); i < Math.min(total, data.length); i++) {
    data[i] *= (total - 1 - i) / fadeLen;
  }
}

let bgmBuffer: AudioBuffer | null = null;
let bgmSource: AudioBufferSourceNode | null = null;
let bgmGain: GainNode | null = null;

function startBgm(): void {
  const c = ctx;
  // 已经在放就什么都不做：syncBgm 会被反复调用（解锁、切静音、切开关），
  // 不守这一下就会叠出好几层同样的音乐
  if (!c || bgmSource) return;
  if (!bgmBuffer) {
    const len = Math.floor(BGM_SAMPLE_RATE * BGM_LOOP_SECONDS);
    bgmBuffer = c.createBuffer(1, len, BGM_SAMPLE_RATE);
    renderBgm(bgmBuffer.getChannelData(0), BGM_SAMPLE_RATE);
  }
  const src = c.createBufferSource();
  src.buffer = bgmBuffer;
  src.loop = true;
  const gain = c.createGain();
  const t = c.currentTime;
  // 淡入一秒半，不要一开口就是满音量。指数曲线不能从 0 起算，所以从一个
  // 听不见的小值开始——与音效那边收到 0.0001 是同一个限制的两面
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(BGM_GAIN, t + BGM_FADE_IN);
  src.connect(gain);
  gain.connect(c.destination);
  src.start();
  bgmSource = src;
  bgmGain = gain;
}

function stopBgm(): void {
  const c = ctx;
  const src = bgmSource;
  const gain = bgmGain;
  // 先摘引用再淡出：淡出期间这段音乐已经不算"在放"，此时若用户又把开关
  // 打开，startBgm 应该起一段新的，而不是被上面那个守卫挡掉
  bgmSource = null;
  bgmGain = null;
  if (!c || !src || !gain) return;
  const t = c.currentTime;
  gain.gain.cancelScheduledValues(t);
  // 淡入还没走完就被关掉时，从**当前**音量接着往下收，否则会跳一下
  gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + BGM_FADE_OUT);
  src.stop(t + BGM_FADE_OUT);
}

/**
 * 让音乐跟上当前的两个开关。静音是总闸：静音键一关，音乐跟着停，
 * 用户不必为了让整个应用安静下来去按两个开关。
 *
 * 音频未解锁（ctx 为 null）时是无操作——第一次用户手势里的 unlockAudio()
 * 会再调一次，音乐从那时开始。
 */
function syncBgm(): void {
  if (!ctx) return;
  if (!muted && bgmOn) startBgm();
  else stopBgm();
}
