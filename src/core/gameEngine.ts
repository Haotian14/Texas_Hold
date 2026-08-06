import type { Card } from './cards';
import { shuffledDeck } from './cards';
import { createRng } from './rng';
import type {
  Action,
  ActionType,
  GameState,
  HandResult,
  Position,
  SeatState,
  Street,
} from './types';
import {
  BIG_BLIND,
  POSITION_ORDER,
  SEAT_COUNT,
  SMALL_BLIND,
  STARTING_STACK,
} from './types';
import { buildPots } from './pots';
import { evaluate7 } from './handEval';
import { isZeroChips, chipsGreater, round2 } from './chips';

export { isZeroChips, chipsGreater, round2 } from './chips';

export interface StartHandOptions {
  seed: string;
  buttonSeat: number;
}

export function startHand(opts: StartHandOptions): GameState {
  const rng = createRng(opts.seed);
  const deck = shuffledDeck(rng);

  const seats: SeatState[] = [];
  for (let i = 0; i < SEAT_COUNT; i++) {
    const seat = i;
    // 从按钮位起顺时针数第 offset 个座位，对应 POSITION_ORDER[offset]
    const offset = (seat - opts.buttonSeat + SEAT_COUNT) % SEAT_COUNT;
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
    deck: deck.slice(SEAT_COUNT * 2),
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

  // 没有加注权的玩家面对短 all-in 时只能跟注或弃牌：
  // 全下比跟注多投的部分本质上就是加注，同样不能给。
  // 但筹码不足以跟注时，全下是"不足额跟注"，必须保留。
  const callForLessOnly = !canRaise && toCall > 0 && chipsGreater(seat.stack, toCall);
  if (!isZeroChips(seat.stack) && !callForLessOnly) {
    out.push({ type: 'allin', min: seat.stack, max: seat.stack });
  }

  return out;
}

export function currentPot(state: GameState): number {
  return round2(state.seats.reduce((sum, s) => sum + s.totalContribution, 0));
}

export interface ActionInput {
  type: ActionType;
  /** raise/bet 时为「本次投入额」；其余类型忽略 */
  amount?: number;
}

export function applyAction(state: GameState, input: ActionInput): GameState {
  if (state.handOver || state.toAct === null) {
    throw new Error('本手已结束，无法继续行动');
  }

  const legal = legalActions(state);
  const match = legal.find(a => a.type === input.type);
  if (!match) {
    throw new Error(
      `非法动作 ${input.type}，当前可选：${legal.map(a => a.type).join('/')}`,
    );
  }

  // 决定本次实际投入额
  let invest: number;
  if (input.type === 'fold' || input.type === 'check') {
    invest = 0;
  } else if (input.type === 'call' || input.type === 'allin') {
    invest = match.min;
  } else {
    const want = input.amount ?? match.min;
    if (want < match.min - 1e-9 || want > match.max + 1e-9) {
      throw new Error(`${input.type} 金额 ${want} 超出合法区间 [${match.min}, ${match.max}]`);
    }
    invest = round2(want);
  }

  const seats = state.seats.map(s => ({ ...s }));
  const seat = seats[state.toAct];
  const potBefore = currentPot(state);
  const toCall = round2(state.currentBet - seat.streetContribution);
  const stackBefore = seat.stack;

  const action: Action = {
    seat: seat.seat,
    street: state.street,
    type: input.type,
    amount: invest,
    potBefore,
    toCall,
    stackBefore,
  };

  if (input.type === 'fold') {
    seat.folded = true;
  } else {
    seat.stack = round2(seat.stack - invest);
    seat.streetContribution = round2(seat.streetContribution + invest);
    seat.totalContribution = round2(seat.totalContribution + invest);
    if (!chipsGreater(seat.stack, 0)) {
      seat.stack = 0;
      seat.allIn = true;
    }
  }

  let currentBet = state.currentBet;
  let lastRaiseSize = state.lastRaiseSize;

  // 投入使本街最高额上升 => 构成加注
  if (chipsGreater(seat.streetContribution, currentBet)) {
    const increment = round2(seat.streetContribution - currentBet);
    currentBet = seat.streetContribution;
    if (!chipsGreater(lastRaiseSize, increment)) {
      // 完整加注：重开下注轮，其他人重获加注权
      lastRaiseSize = increment;
      for (const s of seats) {
        if (s.seat !== seat.seat) s.hasActedSinceLastFullRaise = false;
      }
    }
    // 增量不足最小加注额（只可能是 all-in）：不重开下注轮，
    // 不更新 lastRaiseSize，也不清空其他人的标志
  }

  seat.hasActedSinceLastFullRaise = true;

  const next: GameState = {
    ...state,
    seats,
    currentBet,
    lastRaiseSize,
    actions: [...state.actions, action],
  };

  return advance(next);
}

/** 推进到下一个该行动的人；若本街结束则开新街或结束本手 */
function advance(state: GameState): GameState {
  const live = state.seats.filter(s => !s.folded);

  // 只剩一人 => 本手结束
  if (live.length <= 1) {
    return { ...state, toAct: null, handOver: true };
  }

  const nextSeat = findNextToAct(state, state.toAct!);
  if (nextSeat !== null) {
    return { ...state, toAct: nextSeat };
  }

  // 本街结束
  if (state.street === 'river') {
    return { ...state, toAct: null, handOver: true };
  }
  return openNextStreet(state);
}

/** 从 from 之后顺时针找下一个需要行动的座位，找不到返回 null（本街结束） */
function findNextToAct(state: GameState, from: number): number | null {
  const n = state.seats.length;
  for (let i = 1; i <= n; i++) {
    const seat = state.seats[(from + i) % n];
    if (needsToAct(state, seat)) return seat.seat;
  }
  return null;
}

/** 该座位本街是否仍需行动 */
function needsToAct(state: GameState, seat: SeatState): boolean {
  if (seat.folded || seat.allIn) return false;
  // 尚未在本轮行动过 => 需要行动
  if (!seat.hasActedSinceLastFullRaise) return true;
  // 已行动但投入不足当前最高额（短 all-in 抬高了金额）=> 需要补齐或弃牌
  return round2(state.currentBet - seat.streetContribution) > 0;
}

const STREET_ORDER: Street[] = ['preflop', 'flop', 'turn', 'river'];

function openNextStreet(state: GameState): GameState {
  const idx = STREET_ORDER.indexOf(state.street);
  const nextStreet = STREET_ORDER[idx + 1];
  const drawCount = nextStreet === 'flop' ? 3 : 1;

  const board = [...state.board, ...state.deck.slice(0, drawCount)];
  const deck = state.deck.slice(drawCount);

  const seats = state.seats.map(s => ({
    ...s,
    streetContribution: 0,
    hasActedSinceLastFullRaise: false,
  }));

  const base: GameState = {
    ...state,
    seats,
    board,
    deck,
    street: nextStreet,
    currentBet: 0,
    lastRaiseSize: BIG_BLIND,
    toAct: null,
  };

  // 若可行动者不足 2 人，直接跳到下一街（all-in 摊牌跑马）
  const canAct = seats.filter(s => !s.folded && !s.allIn);
  if (canAct.length < 2) {
    if (nextStreet === 'river') {
      return { ...base, handOver: true };
    }
    return openNextStreet(base);
  }

  // 翻后从按钮位左手第一位（SB 方向）起首先行动
  const first = findNextToAct(base, state.buttonSeat);
  return { ...base, toAct: first };
}

/**
 * 结算本手：按主池/边池逐池比牌，把筹码派回各家 stack，并填充 results。
 * 必须在 handOver 为 true 时调用。
 */
export function settleHand(state: GameState): GameState {
  if (!state.handOver) throw new Error('本手尚未结束，不能结算');
  if (state.results) return state;

  const seats = state.seats.map(s => ({ ...s }));
  const contributions = new Map(seats.map(s => [s.seat, s.totalContribution]));
  const folded = new Set(seats.filter(s => s.folded).map(s => s.seat));
  const pots = buildPots(contributions, folded);

  const live = seats.filter(s => !s.folded);
  const isShowdown = live.length > 1;

  // 摊牌时预先算好每个未弃牌座位的牌力
  const scores = new Map<number, number>();
  if (isShowdown) {
    for (const s of live) {
      scores.set(s.seat, evaluate7([...s.holeCards, ...state.board]));
    }
  }

  const won = new Map<number, number>(seats.map(s => [s.seat, 0]));

  for (const pot of pots) {
    const contenders = pot.eligible;
    let winners: number[];
    if (contenders.length === 1) {
      winners = contenders;
    } else {
      let best = -1;
      winners = [];
      for (const seat of contenders) {
        const sc = scores.get(seat) ?? -1;
        if (sc > best) {
          best = sc;
          winners = [seat];
        } else if (sc === best) {
          winners.push(seat);
        }
      }
    }
    // 平分，余数按座位号升序分配，保证总额不丢失
    // 在整数分位上做除法，避免 (amount / n) * 100 的浮点误差把可整除的
    // 底池算成除不尽（例如 2.30 两分本应各得 1.15，浮点算法会得到 1.14）。
    const cents = Math.round(pot.amount * 100);
    const share = Math.floor(cents / winners.length) / 100;
    let distributed = 0;
    for (const seat of winners) {
      won.set(seat, round2(won.get(seat)! + share));
      distributed = round2(distributed + share);
    }
    const remainder = round2(pot.amount - distributed);
    if (chipsGreater(remainder, 0)) {
      const first = winners[0];
      won.set(first, round2(won.get(first)! + remainder));
    }
  }

  const results: HandResult[] = seats.map(s => ({
    seat: s.seat,
    netBB: round2(won.get(s.seat)! - s.totalContribution),
    showdown: isShowdown && !s.folded,
  }));

  // 结算后把筹码派回 stack，并清空 totalContribution：这笔钱已经不再
  // "押在池子里"，totalChips() 把 stack+totalContribution 算作一个人的
  // 全部身家，若不清零会把已派彩的筹码重复计入，破坏守恒不变量。
  for (const s of seats) {
    s.stack = round2(s.stack + won.get(s.seat)!);
    s.totalContribution = 0;
    s.streetContribution = 0;
  }

  return { ...state, seats, toAct: null, results };
}

export { toHandRecord } from './handRecord';
export type { ToHandRecordOptions } from './handRecord';
