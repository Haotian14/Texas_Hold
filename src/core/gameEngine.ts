import type { Card } from './cards';
import { shuffledDeck } from './cards';
import { createRng } from './rng';
import type { GameState, Position, SeatState } from './types';
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
  if (s.stack === 0) s.allIn = true;
}

/** 筹码守恒不变量的度量：所有人手上的筹码 + 所有已投入的筹码 */
export function totalChips(state: GameState): number {
  return state.seats.reduce((sum, s) => sum + s.stack + s.totalContribution, 0);
}
