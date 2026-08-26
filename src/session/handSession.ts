import type { ActionInput } from '../core/gameEngine';
import { startHand, applyAction, settleHand } from '../core/gameEngine';
import type { ActionType, GameState, HandRecord } from '../core/types';
import { BIG_BLIND, HERO_SEAT, SEAT_COUNT, STARTING_STACK } from '../core/types';
import { toHandRecord } from '../core/handRecord';
import { createRng } from '../core/rng';
import { chipsGreater, isZeroChips, round2 } from '../core/chips';
import type { RangeSet } from '../core/rangeSet';
import { narrowByAction } from '../core/opponentRange';
import { preflopNodeFor } from '../core/preflopNode';
import { assignPersonas, getPersona, GTO_PERSONA } from '../ai/personas';
import { personaInitialRange } from '../ai/personaRange';
import { decide } from '../ai/decide';
import type { SessionLedger } from './ledger';
import { addBuyIn, createLedger, recordHandPlayed } from './ledger';

/** 达到此深度（BB）即认为复盘精度下降 */
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
  /** 本手牌的基础 seed，供省略 cfg 的 hero 动作继续派生确定性随机流 */
  seed: string;
  /** 开手时固定的范围牌力迭代数 */
  strengthIterations: number | undefined;
  /** 开手时求值一次的纯数值时间戳 */
  handTimestamp: number;
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
 *
 * 注意：本函数不是幂等的——它调用 cfg.now() 取一次性的 handTimestamp，
 * 重复调用两次会得到时间戳不同的两个状态。stepAi / applyHero 那种「重复
 * 调用得到逐位相同结果」的幂等性质不覆盖这里，也不覆盖下面调用它的 nextHand。
 */
export function beginHand(
  cfg: SessionConfig,
  handIndex: number,
  stacks: readonly number[],
  ledger: SessionLedger,
  totalTableBuyIn: number,
): HandSessionState {
  const handTimestamp = (cfg.now ?? (() => 0))();
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
    seed: cfg.seed,
    strengthIterations: cfg.strengthIterations,
    handTimestamp,
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
      // 翻前查表收窄要用**行动者**的节点：before.toAct 正是即将行动的这个人，
      // 所以 preflopNodeFor(before) 拿到的是他自己的节点。翻后恒为 null。
      preflopNode: preflopNodeFor(before),
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
    timestamp: s.handTimestamp,
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
 * cfg 可省略：省略时用 s.seed / s.strengthIterations —— 开手时（beginHand）
 * 存进状态快照的那份配置，不是从 game.seed 反解回去。这样界面层每次点击
 * 不必把配置传进来，也不会因为反解基础 seed 有歧义而出错（比如 seed 本身
 * 含分隔符时反解会二义）。验收关卡显式传 cfg，因为它要控制迭代数。
 */
export function applyHero(
  s: HandSessionState,
  input: ActionInput,
  cfg?: SessionConfig,
): HandSessionState {
  if (s.phase !== 'awaitingHero') {
    throw new Error(`applyHero 只能在 awaitingHero 阶段调用，当前为 ${s.phase}`);
  }
  const effective: SessionConfig = cfg ?? {
    seed: s.seed,
    strengthIterations: s.strengthIterations,
  };
  return advance(s, effective, input);
}

/** 本手开局时是否有任一座位达到深筹码阈值 */
export function isDeepStackHand(s: HandSessionState): boolean {
  return s.game.seats.some(seat => !chipsGreater(DEEP_STACK_BB, seat.startingStack));
}

/** Target stack amounts in BB for rebuys; they are targets, not added amounts. */
export const REBUY_OPTIONS = [100, 200] as const;

function needsRebuy(stack: number): boolean {
  return chipsGreater(BIG_BLIND, stack);
}

export function heroNeedsRebuy(s: HandSessionState): boolean {
  return needsRebuy(s.stacks[HERO_SEAT]);
}

/**
 * Rebuy the hero to a target stack. The ledger records only the chips actually
 * added, preserving the identity of current stack minus cumulative buy-ins.
 */
export function rebuyHero(s: HandSessionState, targetStack: number): HandSessionState {
  if (s.phase !== 'handOver') {
    throw new Error(`rebuyHero can only run after handOver; current phase is ${s.phase}`);
  }
  if (!REBUY_OPTIONS.some(o => isZeroChips(o - targetStack))) {
    throw new Error(`rebuy target must be one of ${REBUY_OPTIONS.join(' / ')}; got ${targetStack}`);
  }
  if (!heroNeedsRebuy(s)) {
    throw new Error('hero has sufficient chips and does not need a rebuy');
  }

  const added = round2(targetStack - s.stacks[HERO_SEAT]);
  const stacks = [...s.stacks];
  stacks[HERO_SEAT] = targetStack;

  return {
    ...s,
    stacks,
    ledger: addBuyIn(s.ledger, s.handIndex + 1, added),
    totalTableBuyIn: round2(s.totalTableBuyIn + added),
  };
}

/**
 * Starts the next completed-hand transition. Underfunded AI seats rebuy to a
 * deterministic target; an underfunded hero must be handled explicitly by UI.
 *
 * Not idempotent: this delegates to beginHand, which reads cfg.now() once.
 * Calling it twice yields two states with different handTimestamp values.
 */
export function nextHand(s: HandSessionState, cfg: SessionConfig): HandSessionState {
  if (s.phase !== 'handOver') {
    throw new Error(`nextHand can only run after handOver; current phase is ${s.phase}`);
  }
  if (heroNeedsRebuy(s)) {
    throw new Error('hero needs a rebuy before starting the next hand');
  }

  const handIndex = s.handIndex + 1;
  const stacks = [...s.stacks];
  let totalTableBuyIn = s.totalTableBuyIn;

  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    if (seat === HERO_SEAT || !needsRebuy(stacks[seat])) continue;
    const rng = createRng(`${cfg.seed}-rebuy-${handIndex}-${seat}`);
    const target = REBUY_OPTIONS[rng.nextInt(REBUY_OPTIONS.length)];
    totalTableBuyIn = round2(totalTableBuyIn + (target - stacks[seat]));
    stacks[seat] = target;
  }

  return beginHand(cfg, handIndex, stacks, s.ledger, totalTableBuyIn);
}
