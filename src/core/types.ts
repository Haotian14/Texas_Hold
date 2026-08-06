import type { Card } from './cards';
import type { Pot } from './pots';

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

/**
 * 一次行动记录。
 *
 * 注意：小盲/大盲注是 startHand 内部直接调用 postBlind 扣除的，从不经过
 * applyAction，因此从不出现在 actions 数组里（startHand 返回的
 * GameState.actions 恒为 []）。对 actions 里的 amount 求和只能得到「盲注
 * 之外」的投入，不等于各座位的 totalContribution（小盲会少 0.5，大盲会少
 * 1）。曾经有测试试图用求和 amount 反推 totalContribution 来驱动 buildPots，
 * 在每一手牌里都算错了；需要总投入或分池结果时，分别读
 * SeatState.totalContribution（行动过程中）或 GameState.pots /
 * HandRecord.pots（结算之后），不要重新推导。
 */
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
  /**
   * 本手开局时该座位的起始筹码。开局后固定不变（stack 会随行动增减，
   * 这个字段不会），供 toHandRecord 如实记录「实际起始筹码」这一事实，
   * 而不是重新读取调用方传入的 startHand 选项。
   */
  startingStack: number;
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
  /** 见 Action 类型上的注释：盲注不出现在这里，不能靠求和 amount 反推投入 */
  actions: Action[];
  handOver: boolean;
  results: HandResult[] | null;
  /**
   * 结算得到的主池/边池。startHand 时为 []（尚未结算）；settleHand 用它
   * 内部已经算好的 buildPots 结果填充，作为「本手到底分了几个池、各池
   * 资格集是谁」这一事实的唯一权威来源，供 HandRecord.pots 和消费方直接
   * 读取，不必也不应该重新从 actions 反推。
   */
  pots: Pot[];
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
  /** 见 Action 类型上的注释：盲注不出现在这里，不能靠求和 amount 反推投入 */
  actions: Action[];
  results: HandResult[];
  /** 结算得到的主池/边池，如实照抄自 GameState.pots，见其上的注释 */
  pots: Pot[];
}

/** v2：新增 pots 字段（结算后的主池/边池），记录 schema 修改成本在
 * 落库之前基本为零，之后会越来越贵，所以这里直接把版本号带上 */
export const HAND_RECORD_SCHEMA_VERSION = 2;
