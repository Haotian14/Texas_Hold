/**
 * 界面偏好的持久化。
 *
 * 与「对局状态刷新即丢」那条规则不冲突：那条针对的是牌局本身（③-C 已把它
 * 落进 IndexedDB），而一个每次刷新都要重按一遍的显示开关是纯粹的烦扰。
 * 静音键（`poker-trainer.muted`）是同一类东西，实现留在 sound.ts 里——它
 * 在那边还要给模块内的播放路径读，搬过来会绕一圈。
 *
 * 所有开关默认关（AI 模式默认「原型池」，即现状）。默认值就是这个应用一直
 * 以来的行为——设置页是给想改的人用的，不是给所有人换一套默认值的。
 */

const EQUITY_KEY = 'poker-trainer.showEquity';
const FAST_KEY = 'poker-trainer.fastMode';
const VIBRATE_KEY = 'poker-trainer.vibrate';
const AUTO_REVIEW_KEY = 'poker-trainer.autoReview';
const AI_MODE_KEY = 'poker-trainer.aiMode';

// try/catch 不只是隐私模式的兜底：测试跑在 environment: 'node' 下，那里
// 没有 localStorage，是它吞掉 ReferenceError，本模块才能在 node 下被 import。
function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function write(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    // 存不下就算了，本次会话内仍然生效
  }
}

/** 牌桌上是否显示胜率读数。默认关：它是个训练辅助，不该是默认打开的拐杖 */
export function showEquityPref(): boolean {
  return read(EQUITY_KEY);
}

export function setShowEquityPref(v: boolean): void {
  write(EQUITY_KEY, v);
}

/** 极速模式：AI 不再模拟思考延迟，立刻行动。默认关 */
export function fastModePref(): boolean {
  return read(FAST_KEY);
}

export function setFastModePref(v: boolean): void {
  write(FAST_KEY, v);
}

/**
 * 轮到自己行动时震动一下。默认关。
 *
 * iOS Safari 不实现 Vibration API（至今如此），那里这个开关打开也不会有
 * 反应——设置页因此只在 `navigator.vibrate` 存在时才显示这一项，不给用户
 * 一个按了没用的开关。
 */
export function vibratePref(): boolean {
  return read(VIBRATE_KEY);
}

export function setVibratePref(v: boolean): void {
  write(VIBRATE_KEY, v);
}

/** 结算后自动跳到复盘页。默认关：多数时候用户想的是接着打下一手 */
export function autoReviewPref(): boolean {
  return read(AUTO_REVIEW_KEY);
}

export function setAutoReviewPref(v: boolean): void {
  write(AUTO_REVIEW_KEY, v);
}

/**
 * AI 对手的取样方式。
 *
 * - `personas`：每手从六个性格原型里随机分配（默认，也是一直以来的行为）
 * - `gto`：所有对手都用中性原型，用来练「对手没有明显漏洞」的场面
 *
 * 不是布尔量：spec §10.6 把它写成两个模式，而模式是会长出第三个的
 * （比如「全跟注站」这种针对性练习），布尔量到那时要改所有调用点。
 */
export type AiMode = 'personas' | 'gto';

export function aiModePref(): AiMode {
  try {
    return localStorage.getItem(AI_MODE_KEY) === 'gto' ? 'gto' : 'personas';
  } catch {
    return 'personas';
  }
}

export function setAiModePref(v: AiMode): void {
  try {
    localStorage.setItem(AI_MODE_KEY, v);
  } catch {
    // 同上：存不下不影响本次会话
  }
}
