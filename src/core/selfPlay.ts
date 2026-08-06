import { applyAction, legalActions, round2, settleHand, startHand, toHandRecord } from './gameEngine';
import { createRng } from './rng';
import type { GameState, HandRecord } from './types';
import { HERO_SEAT } from './types';

/**
 * 用随机合法动作打完一手牌。仅用于测试引擎健壮性，不是 AI。
 */
export function playRandomHand(
  seed: string,
  buttonSeat: number,
): { state: GameState; record: HandRecord } {
  const rng = createRng(`${seed}-actions`);
  let state = startHand({ seed, buttonSeat });

  // 上限防死锁：正常一手牌远不到这么多动作
  let guard = 0;
  while (!state.handOver) {
    if (++guard > 500) {
      throw new Error(`seed=${seed} 疑似死锁：动作数超过 500`);
    }
    const legal = legalActions(state);
    if (legal.length === 0) {
      throw new Error(
        `seed=${seed} 死锁：街道 ${state.street}、toAct=${state.toAct} 却无合法动作`,
      );
    }
    const pick = legal[rng.nextInt(legal.length)];
    const amount =
      pick.max > pick.min
        ? round2(pick.min + rng.nextFloat() * (pick.max - pick.min))
        : pick.min;
    state = applyAction(state, { type: pick.type, amount });
  }

  state = settleHand(state);

  const record = toHandRecord(state, {
    id: `${seed}-${buttonSeat}`,
    heroSeat: HERO_SEAT,
    personaIds: {},
    timestamp: 0,
  });

  return { state, record };
}
