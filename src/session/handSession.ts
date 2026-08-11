import type { ActionInput } from '../core/gameEngine';
import { startHand, applyAction, settleHand } from '../core/gameEngine';
import type { ActionType, GameState, HandRecord } from '../core/types';
import { HERO_SEAT, SEAT_COUNT, STARTING_STACK } from '../core/types';
import { toHandRecord } from '../core/handRecord';
import { createRng } from '../core/rng';
import type { RangeSet } from '../core/rangeSet';
import { narrowByAction } from '../core/opponentRange';
import { assignPersonas, getPersona, GTO_PERSONA } from '../ai/personas';
import { personaInitialRange } from '../ai/personaRange';
import { decide } from '../ai/decide';
import type { SessionLedger } from './ledger';
import { createLedger, recordHandPlayed } from './ledger';

/** 超过此深度（BB）即认为复盘精度下降 */
export const DEEP_STACK_BB = 150;

export type SessionPhase = 'aiToAct' | 'awaitingHero' | 'handOver';

export interface SessionConfig {
  /** 整个会话的基础 seed，各手牌由它与 handIndex 派生 */
  seed: string;
  /** 主胜率估算迭代数，透传给 decide */
  iterations?: number;
  /** 范围牌力排序迭代数，透传给 decide 与 narrowByAction */
  strengthIterations?: number;
  /**
   * 时钟。默认返回 0，使同 seed 的 HandRecord 逐位可复现。
   * 界面层传 Date.now —— 真实时间戳是 ③-C 的历史页需要的。
   */
  now?: () => number;
}

export interface HandSessionState {
  /** 牌局引擎状态，唯一权威 */
  game: GameState;
  /** 座位号 -> 该座位当前的手牌范围，逐街收窄 */
  ranges: ReadonlyMap<number, RangeSet>;
  /** 座位号 -> persona id，hero 座位为 'hero' */
  personaIds: ReadonlyMap<number, string>;
  phase: SessionPhase;
  /** 本手是第几手（从 0 起），参与 rng 派生与按钮位轮转 */
  handIndex: number;
  /** 本手已推进的步数，参与 rng 派生 */
  stepIndex: number;
  /** 最近一个动作，供动作气泡渲染 */
  lastAction: { seat: number; type: ActionType; amount: number } | null;
  /** 仅 phase==='handOver' 时非空 */
  record: HandRecord | null;
  /** 各座位在下一手开局时的筹码（BB），跨手延续 */
  stacks: readonly number[];
  /** hero 的买入账本 */
  ledger: SessionLedger;
  /**
   * 桌上所有座位（含 AI）的累计买入额。
   *
   * ledger 只记 hero，但跨手筹码守恒的断言需要知道 AI 补了多少钱进来，
   * 否则「这一手的总筹码比上一手多」就没法区分是补码还是漏算。
   */
  totalTableBuyIn: number;
}

function phaseOf(game: GameState): SessionPhase {
  if (game.handOver) return 'handOver';
  return game.toAct === HERO_SEAT ? 'awaitingHero' : 'aiToAct';
}

/**
 * 开一手新牌。内部函数，被 startSession 与 nextHand（Task 5）共用。
 *
 * 每个座位的初始范围与 playAiHand 的构造方式一致：从该位置的开池范围起手，
 * 按该座位性格的 rangeWidthMul 收紧或放宽。hero 没有性格，按 GTO 原型处理，
 * 与 decide.ts 把 'hero' 映射到 GTO_PERSONA 的规则一致。
 */
export function beginHand(
  cfg: SessionConfig,
  handIndex: number,
  stacks: readonly number[],
  ledger: SessionLedger,
  totalTableBuyIn: number,
): HandSessionState {
  const game = startHand({
    seed: `${cfg.seed}-h${handIndex}`,
    buttonSeat: handIndex % SEAT_COUNT,
    startingStacks: [...stacks],
  });

  const personaIds = assignPersonas(
    game.seats.map(s => s.seat),
    createRng(`${cfg.seed}-persona-${handIndex}`),
    HERO_SEAT,
  );

  const ranges = new Map<number, RangeSet>();
  for (const s of game.seats) {
    const personaId = personaIds.get(s.seat) ?? GTO_PERSONA.id;
    const persona = personaId === 'hero' ? GTO_PERSONA : getPersona(personaId);
    ranges.set(
      s.seat,
      personaInitialRange(
        s.position,
        persona,
        createRng(`${cfg.seed}-range-${handIndex}-${s.seat}`),
        cfg.strengthIterations,
      ),
    );
  }

  return {
    game,
    ranges,
    personaIds,
    phase: phaseOf(game),
    handIndex,
    stepIndex: 0,
    lastAction: null,
    record: null,
    stacks,
    ledger,
    totalTableBuyIn,
  };
}

export function startSession(cfg: SessionConfig): HandSessionState {
  const stacks = new Array<number>(SEAT_COUNT).fill(STARTING_STACK);
  // 开局时桌上每个座位都买入了 STARTING_STACK
  return beginHand(cfg, 0, stacks, createLedger(), STARTING_STACK * SEAT_COUNT);
}

/**
 * 施加一个动作并推进会话。stepAi 与 applyHero 的公共部分。
 *
 * `betSize` 取的是 applyAction 记下的实际投入额，**不是**入参的 amount：
 * decide 对 call/allin 故意不带 amount（引擎自己算），用入参会让 betSize
 * 恒为 0，等于对这两种动作完全关闭按尺度收窄。这是 ②-B-1 修过的真缺陷，
 * 见 src/ai/selfPlayAi.ts 里同一处的注释。
 */
function advance(
  s: HandSessionState,
  cfg: SessionConfig,
  input: ActionInput,
): HandSessionState {
  const acting = s.game.toAct!;
  const before = s.game;
  const next = applyAction(before, input);
  const applied = next.actions[next.actions.length - 1];

  const ranges = new Map(s.ranges);
  ranges.set(
    acting,
    narrowByAction(ranges.get(acting)!, input.type, {
      street: before.street,
      board: before.board,
      dead: before.board,
      potBefore: before.seats.reduce((a, x) => a + x.totalContribution, 0),
      betSize: applied.amount,
      strengthIterations: cfg.strengthIterations ?? 20,
      rng: createRng(`${cfg.seed}-h${s.handIndex}-narrow${s.stepIndex}`),
    }),
  );

  const lastAction = { seat: applied.seat, type: applied.type, amount: applied.amount };

  if (!next.handOver) {
    return {
      ...s,
      game: next,
      ranges,
      phase: phaseOf(next),
      stepIndex: s.stepIndex + 1,
      lastAction,
    };
  }

  const settled = settleHand(next);
  const record = toHandRecord(settled, {
    id: `${cfg.seed}-h${s.handIndex}`,
    heroSeat: HERO_SEAT,
    personaIds: Object.fromEntries(s.personaIds),
    timestamp: (cfg.now ?? (() => 0))(),
  });

  return {
    ...s,
    game: settled,
    ranges,
    phase: 'handOver',
    stepIndex: s.stepIndex + 1,
    lastAction,
    record,
    stacks: settled.seats.map(x => x.stack),
    ledger: recordHandPlayed(s.ledger),
  };
}

/**
 * 推进一个 AI 动作。
 *
 * rng 每步现造而不是存在状态里：Rng 有内部可变状态，存进 React 状态后
 * StrictMode 的 effect 双调用会让它多走一步，同 seed 不再复现。派生 seed
 * 让本函数成为幂等纯函数，重复调用得到逐位相同的结果。
 */
export function stepAi(s: HandSessionState, cfg: SessionConfig): HandSessionState {
  if (s.phase !== 'aiToAct') {
    throw new Error(`stepAi 只能在 aiToAct 阶段调用，当前为 ${s.phase}`);
  }

  const d = decide(s.game, {
    ranges: new Map(s.ranges),
    personaIds: new Map(s.personaIds),
    rng: createRng(`${cfg.seed}-h${s.handIndex}-s${s.stepIndex}`),
    iterations: cfg.iterations,
    strengthIterations: cfg.strengthIterations,
  });

  return advance(s, cfg, d.action);
}

/**
 * 施加 hero 的动作。hero 座位的范围同样收窄，使复盘走的是同一条链路。
 *
 * cfg 可省略：省略时从 game.seed 还原基础 seed，这样界面层每次点击不必
 * 把配置传进来。验收关卡显式传 cfg，因为它要控制迭代数。
 */
export function applyHero(
  s: HandSessionState,
  input: ActionInput,
  cfg?: SessionConfig,
): HandSessionState {
  if (s.phase !== 'awaitingHero') {
    throw new Error(`applyHero 只能在 awaitingHero 阶段调用，当前为 ${s.phase}`);
  }
  // cfg 只用于取 seed 与 strengthIterations；未传时从 game.seed 还原基础 seed
  const effective: SessionConfig = cfg ?? { seed: baseSeedOf(s) };
  return advance(s, effective, input);
}

/** 从本手的引擎 seed（`${base}-h${n}`）还原基础 seed */
function baseSeedOf(s: HandSessionState): string {
  const suffix = `-h${s.handIndex}`;
  return s.game.seed.endsWith(suffix)
    ? s.game.seed.slice(0, -suffix.length)
    : s.game.seed;
}

/** 本手开局时是否有任一座位达到深筹码阈值 */
export function isDeepStackHand(s: HandSessionState): boolean {
  return s.game.seats.some(seat => seat.startingStack >= DEEP_STACK_BB);
}
