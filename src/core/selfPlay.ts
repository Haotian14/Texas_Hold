import { applyAction, legalActions, round2, settleHand, startHand, totalChips } from './gameEngine';
import { toHandRecord } from './handRecord';
import { createRng } from './rng';
import type { GameState, HandRecord } from './types';
import { HERO_SEAT } from './types';

/**
 * 用随机合法动作打完一手牌。仅用于测试引擎健壮性，不是 AI。
 *
 * startingStacks 可选：不传时每个座位固定 STARTING_STACK（产品默认行为，
 * spec §2）；传入时按座位号提供各自的起始筹码，仅用于测试触达边池分层
 * 逻辑（真实牌局筹码总是固定深度重置，不会变化）。
 */
export function playRandomHand(
  seed: string,
  buttonSeat: number,
  startingStacks?: number[],
): { state: GameState; record: HandRecord } {
  const rng = createRng(`${seed}-actions`);
  let state = startHand({ seed, buttonSeat, startingStacks });
  const expectedChips = state.seats.reduce((sum, s) => sum + s.startingStack, 0);

  // 上限防死锁：正常一手牌远不到这么多动作
  let guard = 0;
  let actionIndex = 0;
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

    // 每个动作之后都校验筹码守恒，而不是只在手牌结束时校验一次：一个铸币
    // 动作紧跟一个销币动作会互相抵消，让「只在终局校验一次」的检查看不出
    // 任何问题（Task 9 未取整的 invest 铸出 0.01BB 正是这类缺陷）。
    const total = totalChips(state);
    if (Math.abs(total - expectedChips) > 1e-9) {
      throw new Error(
        `seed=${seed} 动作 #${actionIndex}（${pick.type}）之后筹码不守恒：${total} != ${expectedChips}`,
      );
    }
    actionIndex++;
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
