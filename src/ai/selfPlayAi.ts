import { startHand, applyAction, settleHand } from '../core/gameEngine';
import type { GameState, HandRecord } from '../core/types';
import { SEAT_COUNT, HERO_SEAT } from '../core/types';
import { toHandRecord } from '../core/handRecord';
import { createRng } from '../core/rng';
import type { RangeSet } from '../core/rangeSet';
import { initialRange, narrowByAction } from '../core/opponentRange';
import { assignPersonas } from './personas';
import { decide } from './decide';

export interface AiHandResult {
  state: GameState;
  record: HandRecord;
  /** 本手牌一共做了多少次 AI 决策 */
  decisions: number;
  /** 单次决策的最长耗时（毫秒） */
  maxDecisionMs: number;
}

export interface PlayAiHandOptions {
  iterations?: number;
  strengthIterations?: number;
}

/**
 * 六个 AI 互相打完一手牌。
 *
 * 每个座位的范围从其位置的开池范围起手，随该座位的每个动作逐街收窄 ——
 * 这条链路和复盘引擎将来重建对手范围时走的是同一条。
 */
export function playAiHand(
  seed: string,
  buttonSeat: number,
  opts: PlayAiHandOptions = {},
): AiHandResult {
  const rng = createRng(`${seed}-ai`);
  let state = startHand({ seed, buttonSeat });

  const personaIds = assignPersonas(
    state.seats.map(s => s.seat),
    createRng(`${seed}-persona`),
    HERO_SEAT,
  );

  const ranges = new Map<number, RangeSet>();
  for (const s of state.seats) ranges.set(s.seat, initialRange(s.position));

  let decisions = 0;
  let maxDecisionMs = 0;
  let guard = 0;

  while (!state.handOver) {
    if (++guard > 500) throw new Error(`seed=${seed} 疑似死锁：动作数超过 500`);

    const acting = state.toAct!;
    const before = state;

    const t0 = Date.now();
    const d = decide(state, {
      ranges,
      personaIds,
      rng,
      iterations: opts.iterations,
      strengthIterations: opts.strengthIterations,
    });
    maxDecisionMs = Math.max(maxDecisionMs, Date.now() - t0);
    decisions++;

    state = applyAction(state, d.action);

    // 按该座位刚做的动作收窄它的范围
    const prev = ranges.get(acting)!;
    ranges.set(acting, narrowByAction(prev, d.action.type, {
      street: before.street,
      board: before.board,
      dead: before.board,
      potBefore: before.seats.reduce((a, x) => a + x.totalContribution, 0),
      betSize: d.action.amount ?? 0,
      strengthIterations: opts.strengthIterations ?? 20,
      rng,
    }));
  }

  state = settleHand(state);

  const record = toHandRecord(state, {
    id: `${seed}-${buttonSeat}`,
    heroSeat: HERO_SEAT,
    personaIds: Object.fromEntries(personaIds),
    timestamp: 0,
  });

  return { state, record, decisions, maxDecisionMs };
}
