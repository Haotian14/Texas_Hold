import type { GameState, HandRecord, HandRecordSeat } from './types';
import { HAND_RECORD_SCHEMA_VERSION } from './types';
import { applyAction, settleHand, startHand } from './gameEngine';

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
    // 实际起始筹码：从这个座位在 startHand 时就写死、此后从不修改的
    // startingStack 字段读取，而不是重新去读调用方传进来的选项，也不是
    // 硬编码常量。产品默认路径下每个座位都是 STARTING_STACK，这里读出来
    // 也确实是 STARTING_STACK；但一旦调用方传了 startingStacks（目前仅
    // 测试会这样做），各座位可以不同，此处必须如实记录，否则这个字段就
    // 从「事实」退化成了一句谎言。
    startingStack: s.startingStack,
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

/**
 * 从 HandRecord 完整重放一手牌：用记录里的 seed/buttonSeat/各座位
 * startingStack 重新开局，依次把 record.actions 原样喂给 applyAction，
 * 最后结算并返回终局 GameState。
 *
 * 这是下一阶段复盘引擎要做的事——用 HandRecord 重建每一个决策点——的
 * 最小验证：如果这个函数造不出跟原局完全一致的终局，说明 HandRecord
 * 这份契约本身是不完整的。
 *
 * amount 对 fold/check/call/allin 会被 applyAction 忽略（它们的实际投入
 * 只取决于 legalActions 算出的 min），照抄 record 里的 amount 传进去无害，
 * 也让调用方式和「回放」的直觉一致。
 */
export function replayHandRecord(record: HandRecord): GameState {
  const startingStacks = [...record.seats]
    .sort((a, b) => a.seat - b.seat)
    .map(s => s.startingStack);

  let state = startHand({
    seed: record.seed,
    buttonSeat: record.buttonSeat,
    startingStacks,
  });

  for (const action of record.actions) {
    state = applyAction(state, { type: action.type, amount: action.amount });
  }

  if (!state.handOver) {
    throw new Error('replayHandRecord：重放完 record.actions 后本手仍未结束，记录数据不完整');
  }

  return settleHand(state);
}
