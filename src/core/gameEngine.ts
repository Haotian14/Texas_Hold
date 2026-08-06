import type { Card } from './cards';
import { shuffledDeck } from './cards';
import { createRng } from './rng';
import type { ActionType, GameState, Position, SeatState } from './types';
import {
  BIG_BLIND,
  POSITION_ORDER,
  SEAT_COUNT,
  SMALL_BLIND,
  STARTING_STACK,
} from './types';

export interface StartHandOptions {
  seed: string;
  buttonSeat: number;
  seatCount?: number;
}

export function startHand(opts: StartHandOptions): GameState {
  const seatCount = opts.seatCount ?? SEAT_COUNT;
  const rng = createRng(opts.seed);
  const deck = shuffledDeck(rng);

  const seats: SeatState[] = [];
  for (let i = 0; i < seatCount; i++) {
    const seat = i;
    // 从按钮位起顺时针数第 offset 个座位，对应 POSITION_ORDER[offset]
    const offset = (seat - opts.buttonSeat + seatCount) % seatCount;
    const position = POSITION_ORDER[offset] as Position;
    const holeCards: [Card, Card] = [deck[seat * 2], deck[seat * 2 + 1]];
    seats.push({
      seat,
      position,
      stack: STARTING_STACK,
      holeCards,
      folded: false,
      allIn: false,
      streetContribution: 0,
      totalContribution: 0,
      hasActedSinceLastFullRaise: false,
    });
  }

  // 扣盲注
  for (const s of seats) {
    if (s.position === 'SB') postBlind(s, SMALL_BLIND);
    if (s.position === 'BB') postBlind(s, BIG_BLIND);
  }

  const utg = seats.find(s => s.position === 'UTG');

  return {
    seed: opts.seed,
    buttonSeat: opts.buttonSeat,
    seats,
    board: [],
    deck: deck.slice(seatCount * 2),
    street: 'preflop',
    toAct: utg ? utg.seat : null,
    currentBet: BIG_BLIND,
    lastRaiseSize: BIG_BLIND,
    actions: [],
    handOver: false,
    results: null,
  };
}

function postBlind(s: SeatState, amount: number): void {
  const paid = Math.min(amount, s.stack);
  s.stack -= paid;
  s.streetContribution += paid;
  s.totalContribution += paid;
  if (isZeroChips(s.stack)) s.allIn = true;
}

/** 筹码金额的零值判定。浮点累加会产生 1e-16 量级的尾数，不能直接和 0 比。 */
export function isZeroChips(v: number): boolean {
  return Math.abs(v) < 1e-9;
}

/** 筹码金额的严格大于判定，容忍浮点尾数。a 恰好等于 b 时返回 false。 */
export function chipsGreater(a: number, b: number): boolean {
  return a - b > 1e-9;
}

/** 筹码守恒不变量的度量：所有人手上的筹码 + 所有已投入的筹码 */
export function totalChips(state: GameState): number {
  return state.seats.reduce((sum, s) => sum + s.stack + s.totalContribution, 0);
}

export interface LegalAction {
  type: ActionType;
  /** 本次投入的最小额 */
  min: number;
  /** 本次投入的最大额 */
  max: number;
}

export function legalActions(state: GameState): LegalAction[] {
  if (state.handOver || state.toAct === null) return [];

  const seat = state.seats[state.toAct];
  if (seat.folded || seat.allIn) return [];

  const toCall = round2(state.currentBet - seat.streetContribution);
  const out: LegalAction[] = [];

  if (toCall > 0) {
    out.push({ type: 'fold', min: 0, max: 0 });
    if (chipsGreater(seat.stack, toCall)) {
      out.push({ type: 'call', min: toCall, max: toCall });
    }
  } else {
    out.push({ type: 'check', min: 0, max: 0 });
  }

  // 有加注权才能主动加码：本轮完整加注后尚未行动过
  const canRaise = !seat.hasActedSinceLastFullRaise;
  if (canRaise) {
    // 最小加注到的绝对额，换算成本次需投入额
    const minRaiseTo = state.currentBet + state.lastRaiseSize;
    const minInvest = round2(minRaiseTo - seat.streetContribution);
    if (chipsGreater(seat.stack, minInvest)) {
      // 用 currentBet 而非 toCall 区分 bet/raise：
      // 翻前大盲面对全员平跟时 toCall 为 0，但场上已有下注（盲注），
      // 此时他的主动加码是 raise 而不是 bet。
      out.push({
        type: state.currentBet > 0 ? 'raise' : 'bet',
        min: minInvest,
        max: seat.stack,
      });
    }
  }

  if (!isZeroChips(seat.stack)) {
    out.push({ type: 'allin', min: seat.stack, max: seat.stack });
  }

  return out;
}

/** 金额规整到 2 位小数，消除浮点累积误差 */
export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
