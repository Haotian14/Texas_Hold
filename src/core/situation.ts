import type { Card } from './cards';
import { cardToString } from './cards';
import type { GameState, Position, Street } from './types';
import { currentPot } from './gameEngine';
import { round2, chipsGreater } from './chips';
import type { RangeSet } from './rangeSet';
import { fullRange } from './rangeSet';

export interface SituationOpponent {
  seat: number;
  position: Position;
  /** 该对手手上还剩多少筹码 */
  stack: number;
  /** 该对手可能持有的手牌分布 */
  range: RangeSet;
  personaId: string;
}

/**
 * 与来源无关的局面快照。
 *
 * 对局中的 AI 从运行中的 GameState 构造它；复盘引擎从 HandRecord 重放构造它。
 * 两者因此走同一条 EV 估算路径，判断标准天然一致。
 */
export interface Situation {
  heroSeat: number;
  heroPosition: Position;
  heroCards: [Card, Card];
  board: Card[];
  street: Street;
  /** 当前底池总额（含所有人本手已投入的筹码） */
  pot: number;
  /** hero 需要再投入多少才能跟上 */
  toCall: number;
  heroStack: number;
  /** hero 本街已投入 */
  heroStreetContribution: number;
  /** 仍未弃牌且未全下的对手。已全下的对手不在此列，但其筹码已计入 pot。 */
  opponents: SituationOpponent[];
  /** hero 是否是翻前最后一个加注的人 */
  heroIsPreflopAggressor: boolean;
}

export interface SituationOptions {
  /** 座位号 -> 该座位的手牌范围。缺失时回落到全范围。 */
  ranges: Map<number, RangeSet>;
  /** 座位号 -> persona id。缺失时为 'unknown'。 */
  personaIds: Map<number, string>;
}

/** 找出翻前最后一个做出加注动作的座位；无人加注返回 null */
function preflopAggressor(state: GameState): number | null {
  let seat: number | null = null;
  for (const a of state.actions) {
    if (a.street !== 'preflop') break;
    if (chipsGreater(a.amount, a.toCall)) seat = a.seat;
  }
  return seat;
}

/** 从正在进行的对局构造快照。state.toAct 必须非空。 */
export function situationFromGameState(
  state: GameState,
  opts: SituationOptions,
): Situation {
  if (state.handOver || state.toAct === null) {
    throw new Error('本手已结束或无人待行动，无法构造 Situation');
  }

  const heroSeat = state.toAct;
  const hero = state.seats[heroSeat];

  const opponents: SituationOpponent[] = [];
  for (const s of state.seats) {
    if (s.seat === heroSeat) continue;
    if (s.folded || s.allIn) continue;
    opponents.push({
      seat: s.seat,
      position: s.position,
      stack: s.stack,
      range: opts.ranges.get(s.seat) ?? fullRange(),
      personaId: opts.personaIds.get(s.seat) ?? 'unknown',
    });
  }

  return {
    heroSeat,
    heroPosition: hero.position,
    heroCards: [hero.holeCards[0], hero.holeCards[1]],
    board: [...state.board],
    street: state.street,
    pot: currentPot(state),
    toCall: round2(state.currentBet - hero.streetContribution),
    heroStack: hero.stack,
    heroStreetContribution: hero.streetContribution,
    opponents,
    heroIsPreflopAggressor: preflopAggressor(state) === heroSeat,
  };
}

/** 单行可读摘要，仅用于测试与调试 */
export function describeSituation(s: Situation): string {
  const board = s.board.map(cardToString).join(' ') || '-';
  const hero = s.heroCards.map(cardToString).join('');
  return `[${s.street}] ${s.heroPosition} ${hero} | 公共牌 ${board} | 底池 ${s.pot} | 待跟 ${s.toCall} | 筹码 ${s.heroStack} | 对手 ${s.opponents.length}`;
}
