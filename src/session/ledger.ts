import { STARTING_STACK } from '../core/types';
import { round2 } from '../core/chips';

export interface BuyIn {
  /** 这次买入发生在第几手之前；开局那次为 0 */
  handIndex: number;
  /**
   * 实际添进桌上的钱，单位 BB。
   *
   * 注意是「目标筹码额 − 补码前的筹码」，不是目标额本身。剩 0.3BB 时
   * 补到 100BB，这里记 99.7 而不是 100 —— 否则 heroNet 的恒等式会差 0.3。
   */
  amount: number;
}

export interface SessionLedger {
  /** 每一次买入，含开局那次，按时间顺序 */
  buyIns: readonly BuyIn[];
  /** 累计买入额，BB */
  totalBuyIn: number;
  /** 已打完的手数 */
  handsPlayed: number;
}

export function createLedger(): SessionLedger {
  return {
    buyIns: [{ handIndex: 0, amount: STARTING_STACK }],
    totalBuyIn: STARTING_STACK,
    handsPlayed: 0,
  };
}

export function addBuyIn(l: SessionLedger, handIndex: number, amount: number): SessionLedger {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`买入额必须为正，实际为 ${amount}`);
  }
  return {
    buyIns: [...l.buyIns, { handIndex, amount: round2(amount) }],
    totalBuyIn: round2(l.totalBuyIn + amount),
    handsPlayed: l.handsPlayed,
  };
}

export function recordHandPlayed(l: SessionLedger): SessionLedger {
  return { ...l, handsPlayed: l.handsPlayed + 1 };
}

/**
 * hero 的净盈亏 = 当前筹码 − 累计买入。
 *
 * **不能**用累加每手 netBB 的方式算。补码是往桌上添钱不是盈利，
 * 不记买入的话补一次 100BB 就会被当成赢了 100BB。
 */
export function heroNet(l: SessionLedger, currentStack: number): number {
  return round2(currentStack - l.totalBuyIn);
}
