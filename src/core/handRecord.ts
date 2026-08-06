import type { GameState, HandRecord, HandRecordSeat } from './types';
import { HAND_RECORD_SCHEMA_VERSION, STARTING_STACK } from './types';
import { settleHand } from './gameEngine';

export interface ToHandRecordOptions {
  id: string;
  heroSeat: number;
  /** 座位号 -> persona id；hero 的座位无需提供 */
  personaIds: Record<number, string>;
  timestamp: number;
}

export function toHandRecord(state: GameState, opts: ToHandRecordOptions): HandRecord {
  if (!state.handOver) throw new Error('本手尚未结束，无法生成 HandRecord');
  const settled = state.results ? state : settleHand(state);

  const seats: HandRecordSeat[] = settled.seats.map(s => ({
    seat: s.seat,
    position: s.position,
    personaId: s.seat === opts.heroSeat ? 'hero' : (opts.personaIds[s.seat] ?? 'unknown'),
    // 每手牌都从固定筹码重置开始（spec §2），无需从结算结果反推
    startingStack: STARTING_STACK,
    holeCards: s.holeCards,
  }));

  return {
    id: opts.id,
    schemaVersion: HAND_RECORD_SCHEMA_VERSION,
    timestamp: opts.timestamp,
    seed: settled.seed,
    heroSeat: opts.heroSeat,
    buttonSeat: settled.buttonSeat,
    seats,
    board: settled.board,
    actions: settled.actions,
    results: settled.results!,
  };
}
