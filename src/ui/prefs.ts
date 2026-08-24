/**
 * 界面偏好的持久化。
 *
 * 与「对局状态刷新即丢」那条规则不冲突：那条针对的是牌局本身（③-C 已把它
 * 落进 IndexedDB），而一个每次刷新都要重按一遍的显示开关是纯粹的烦扰。
 * 静音键（`poker-trainer.muted`）是同一类东西，实现留在 sound.ts 里——它
 * 在那边还要给模块内的播放路径读，搬过来会绕一圈。
 */

const EQUITY_KEY = 'poker-trainer.showEquity';

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
