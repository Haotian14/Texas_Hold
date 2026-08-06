import type { Card } from './cards';

export type Position = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export const SMALL_BLIND = 0.5;
export const BIG_BLIND = 1;
export const STARTING_STACK = 100;
export const SEAT_COUNT = 6;
export const HERO_SEAT = 0;

/** 从按钮位起顺时针的位置顺序 */
export const POSITION_ORDER: readonly Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];

export interface Action {
  seat: number;
  street: Street;
  type: ActionType;
  /** 该动作本次投入的筹码，fold/check 为 0 */
  amount: number;
  potBefore: number;
  toCall: number;
  stackBefore: number;
}

export interface SeatState {
  seat: number;
  position: Position;
  stack: number;
  holeCards: [Card, Card];
  folded: boolean;
  allIn: boolean;
  /** 本街已投入 */
  streetContribution: number;
  /** 本手已投入 */
  totalContribution: number;
  /**
   * 自上一次「完整加注」以来是否已行动过。
   * 完整加注会把所有其他人的该标志清空，从而重开下注轮；
   * 不足最小加注额的 all-in 不清空，因此不重开下注轮。
   */
  hasActedSinceLastFullRaise: boolean;
}

export interface HandResult {
  seat: number;
  netBB: number;
  showdown: boolean;
}

export interface GameState {
  seed: string;
  buttonSeat: number;
  seats: SeatState[];
  board: Card[];
  /** 尚未发出的牌 */
  deck: Card[];
  street: Street;
  /** 当前该行动的座位号；null 表示本街已结束或本手已结束 */
  toAct: number | null;
  /** 本街最高投入额 */
  currentBet: number;
  /** 最近一次加注的增量，决定最小加注额 */
  lastRaiseSize: number;
  actions: Action[];
  handOver: boolean;
  results: HandResult[] | null;
}

export interface HandRecordSeat {
  seat: number;
  position: Position;
  personaId: string;
  startingStack: number;
  holeCards: [Card, Card];
}

export interface HandRecord {
  id: string;
  schemaVersion: number;
  timestamp: number;
  seed: string;
  heroSeat: number;
  buttonSeat: number;
  seats: HandRecordSeat[];
  board: Card[];
  actions: Action[];
  results: HandResult[];
}

export const HAND_RECORD_SCHEMA_VERSION = 1;
