import type { GameState, HandRecord, Action } from '../core/types';
import { startHand, applyAction } from '../core/gameEngine';
import type { Situation } from '../core/situation';
import { situationFromGameState } from '../core/situation';
import type { RangeSet } from '../core/rangeSet';
import { initialRange, narrowByAction } from '../core/opponentRange';
import { createRng } from '../core/rng';

export interface HeroDecisionPoint {
  /** 该动作在 record.actions 里的下标 */
  actionIndex: number;
  /** 动作发生「之前」的局面快照 */
  situation: Situation;
  /** hero 当时实际做的动作 */
  actual: Action;
  /** 动作发生前的引擎状态，供判定时查合法动作等 */
  state: GameState;
}

export interface DecisionPointOptions {
  /** 范围收窄时的牌力排序迭代数。默认 20 */
  strengthIterations?: number;
}

/**
 * 把一份手牌记录部分重放到 hero 的每个决策点，产出当时的局面快照。
 *
 * 复盘只能看到记录，看不到运行中的对局 —— 这是 spec §4.3 里
 * situationFromGameState 的另一半。两者最终都交给同一个 estimateEv，
 * 所以 AI 的判断标准和复盘的判定标准天然一致。
 *
 * **本模块不读取任何座位的底牌。** 公共牌与 hero 底牌都由 startHand
 * 按 record.seed 重新发出，与记录里存的必然一致（replayHandRecord 已验证
 * 这一点）。对手底牌只在展示层用，拿它来评判用户当时的决策就是结果论
 * （spec §8.5）—— 用户下注时并不知道对手拿的什么。
 */
export function heroDecisionPoints(
  record: HandRecord,
  opts: DecisionPointOptions = {},
): HeroDecisionPoint[] {
  const strengthIterations = opts.strengthIterations ?? 20;
  const rng = createRng(`${record.seed}-review`);

  const startingStacks = [...record.seats]
    .sort((a, b) => a.seat - b.seat)
    .map(s => s.startingStack);

  let state = startHand({
    seed: record.seed,
    buttonSeat: record.buttonSeat,
    startingStacks,
  });

  // 每个座位的范围从其位置的开池范围起手，随其动作逐街收窄。
  // 这条链路与 ai/selfPlayAi.ts 完全相同 —— 复盘看到的对手模型
  // 和 AI 当时用的是同一套。
  const ranges = new Map<number, RangeSet>();
  for (const s of state.seats) ranges.set(s.seat, initialRange(s.position));

  // record.seats[].personaId 不是底牌数据 —— 展示层要用它（"你在跟一个
  // maniac 打"），这里如实带过去，而不是让每个对手都变成 'unknown'。
  const personaIds = new Map(record.seats.map(s => [s.seat, s.personaId]));

  const points: HeroDecisionPoint[] = [];

  record.actions.forEach((action, index) => {
    if (action.seat !== state.toAct) {
      throw new Error(
        `situationFromRecord：第 ${index} 个动作记录的座位是 ${action.seat}，` +
          `但重放到此处该行动的座位是 ${state.toAct}——记录可能被重排、增删或篡改`,
      );
    }

    if (action.seat === record.heroSeat) {
      points.push({
        actionIndex: index,
        situation: situationFromGameState(state, { ranges, personaIds }),
        actual: action,
        state,
      });
    }

    const before = state;
    state = applyAction(state, { type: action.type, amount: action.amount });

    // 用引擎实际记录的投入来收窄，而不是输入动作的 amount ——
    // call / allin 的输入不带 amount，取到的会是 0，导致 mdf = 1、
    // 尺寸相关的收窄整个失效（这个 bug 在 ②-B-1 的自对弈里出现过）。
    const applied = state.actions[state.actions.length - 1];
    const prev = ranges.get(action.seat)!;
    ranges.set(
      action.seat,
      narrowByAction(prev, action.type, {
        street: before.street,
        board: before.board,
        dead: before.board,
        potBefore: applied.potBefore,
        betSize: applied.amount,
        strengthIterations,
        rng,
      }),
    );
  });

  if (!state.handOver) {
    throw new Error('situationFromRecord：重放完 record.actions 后本手仍未结束，记录数据不完整');
  }

  return points;
}
