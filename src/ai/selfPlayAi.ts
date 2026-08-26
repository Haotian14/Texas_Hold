import { startHand, applyAction, settleHand } from '../core/gameEngine';
import type { GameState, HandRecord } from '../core/types';
import { HERO_SEAT } from '../core/types';
import { toHandRecord } from '../core/handRecord';
import { createRng } from '../core/rng';
import type { RangeSet } from '../core/rangeSet';
import { narrowByAction } from '../core/opponentRange';
import { preflopNodeFor } from '../core/preflopNode';
import { assignPersonas, getPersona, GTO_PERSONA } from './personas';
import { personaInitialRange } from './personaRange';
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
 * 每个座位的范围从其位置的开池范围起手，按该座位的性格用 rangeWidthMul
 * 收紧或放宽（personaInitialRange，见 ai/personaRange.ts）——rock 和
 * maniac 从翻前第一手牌起就该打不同宽度的范围，而不只是行动风格不同。
 * hero 座位没有 AI 性格（由人操作），起手范围按 GTO 原型（宽度中性）
 * 处理，与 decide.ts 把 'hero' 映射到 GTO_PERSONA 的规则一致。
 * 之后随该座位的每个动作逐街收窄 —— 这条链路和复盘引擎将来重建对手
 * 范围时走的是同一条。
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
  for (const s of state.seats) {
    const personaId = personaIds.get(s.seat) ?? GTO_PERSONA.id;
    const persona = personaId === 'hero' ? GTO_PERSONA : getPersona(personaId);
    ranges.set(s.seat, personaInitialRange(s.position, persona, rng, opts.strengthIterations));
  }

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

    // 按该座位刚做的动作收窄它的范围。betSize 必须是引擎实际记下的投入额，
    // 不能用 d.action.amount —— toActionInput（decide.ts）对 call/allin 故意
    // 不带 amount（引擎自己算），这两种类型上 d.action.amount 恒为
    // undefined，`?? 0` 会把 betSize 悄悄钉死在 0，使 mdf = potBefore/potBefore = 1，
    // 等于对 call/allin 完全关闭按尺度收窄。state.actions 是 applyAction 刚刚
    // 推入的这一条动作记录，其 .amount 字段对 fold/check 为 0，对
    // call/allin/bet/raise 都是引擎按 legalActions 算出的真实投入额
    // （见 gameEngine.ts applyAction 里 `invest = match.min`/`round2(want)`），
    // 语义与场景完全匹配。
    const prev = ranges.get(acting)!;
    const appliedAction = state.actions[state.actions.length - 1];
    ranges.set(acting, narrowByAction(prev, d.action.type, {
      street: before.street,
      board: before.board,
      dead: before.board,
      potBefore: before.seats.reduce((a, x) => a + x.totalContribution, 0),
      betSize: appliedAction.amount,
      strengthIterations: opts.strengthIterations ?? 20,
      rng,
      // 翻前查表收窄要用**行动者**的节点：before.toAct 正是即将行动的这个人，
      // 所以 preflopNodeFor(before) 拿到的是他自己的节点。翻后恒为 null。
      preflopNode: preflopNodeFor(before),
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
