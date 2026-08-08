import type { ActionType, GameState, Street } from '../core/types';
import type { ActionInput, LegalAction } from '../core/gameEngine';
import { legalActions } from '../core/gameEngine';
import { situationFromGameState } from '../core/situation';
import type { EvCandidate, EvResult } from '../core/evEstimate';
import { estimateEv } from '../core/evEstimate';
import type { Rng } from '../core/rng';
import { chipsGreater, round2 } from '../core/chips';
import type { RangeSet } from '../core/rangeSet';
import type { Persona } from './personas';
import { getPersona, GTO_PERSONA } from './personas';

export interface DecideOptions {
  /** 座位号 -> 该座位的手牌范围 */
  ranges: Map<number, RangeSet>;
  /** 座位号 -> persona id */
  personaIds: Map<number, string>;
  rng: Rng;
  /** 主胜率估算的迭代数。默认 500 —— AI 有时间预算，比复盘时低 */
  iterations?: number;
  /** 范围牌力排序的迭代数。默认 40 */
  strengthIterations?: number;
}

export interface Decision {
  action: ActionInput;
  persona: Persona;
  ev: EvResult;
  chosen: EvCandidate;
  /** 该候选经性格扰动后的偏好分 */
  score: number;
}

/**
 * personaScore 里判断"这是一个进攻候选"要用的集合，只含 'bet'/'raise'，
 * 不含 'allin'。
 *
 * 这是刻意的，不是漏写：estimateEv（core/evEstimate.ts）只在一种情况下
 * 把候选的 actionType 定成 'allin'——sit.toCall > 0 且 heroStack <= toCall
 * 的「不足额跟注」分支（筹码不够跟平，全下只是把手上仅剩的筹码跟出去，
 * 见 evEstimate.ts 里 'call all-in' 那个候选）。这是一次被迫的跟注，不是
 * 主动选择的进攻动作；玩家没有「跟注」和「加注」之外的第三个选项。真正
 * 主动选择的全下（筹码够、自愿把 all-in 当一个下注尺度）在 estimateEv 里
 * 类型是 'raise' 或 'bet'（取决于 toCall 是否 > 0，见 makeBetCandidate），
 * 从来不是 'allin'——那些候选已经在 AGGRESSIVE 里了。
 *
 * 如果把 'allin' 也算进「进攻」，会让这唯一会出现 'allin' 类型的强制跟注
 * 场景凭空获得 (persona.aggression - 1) * pot * AGGRESSION_WEIGHT 的加成
 * （疯子加分、岩石因为 aggression < 1 反而被扣分——一个被迫的动作不应该
 * 因为性格是「岩石」就被打压），还会让它有资格被 bluffFreq 抽中、当成
 * 「诈唬候选」参与进攻候选间的比较——一个只能跟注不能诈唬的动作没有
 * 「诈唬」这个概念。
 *
 * 注意这与下面 BET_LIKE 的用途完全不同：BET_LIKE 解决的是 candidate 类型
 * 和 legal 类型字符串不一致时"能不能匹配到同一个引擎动作"，在那里 'allin'
 * 属于同一族是对的（一个引擎层面真正的全下，不管是主动的还是被迫的，
 * 都应该能被对应的候选匹配上）；这里 AGGRESSIVE 解决的是"这个候选算不算
 * 性格意义上的进攻"，是两个不同的问题，不应该共用同一个集合。
 */
const AGGRESSIVE = new Set(['bet', 'raise']);

/** 下注类候选与合法动作之间可以互相匹配的类型族，见下方 matchesLegal。 */
const BET_LIKE = new Set<ActionType>(['bet', 'raise', 'allin']);

/**
 * candidate 的类型是否可以对应到 legal 的类型。
 *
 * estimateEv（core/evEstimate.ts）按 toCall 是否 > 0 把下注/加注候选定成
 * 'bet' 或 'raise'；legalActions（core/gameEngine.ts）按 currentBet 是否
 * > 0 定同一件事，两条规则大多数时候重合，但在大盲被平跟到选项（toCall
 * === 0、currentBet === 1）以及筹码只够跟注不够最小加注（legal 只剩
 * allin、没有 raise/bet）这两种局面下会分歧。这里把 bet/raise/allin
 * 当同一族，只要 candidate 是这三者之一，就允许匹配到 legal 里这三者之一——
 * 具体是不是这个投入额，交给调用处按 investment 是否落在 legal 区间内过滤，
 * 这里只负责放宽「类型字符串必须完全相等」这个不该存在的约束。
 * fold/check/call 不受影响：它们在两条命名规则下从不分歧。
 */
function matchesLegal(candidateType: ActionType, legalType: ActionType): boolean {
  if (candidateType === legalType) return true;
  return BET_LIKE.has(candidateType) && BET_LIKE.has(legalType);
}

/**
 * 性格扰动的系数。手调，没有外部锚点 —— 作用是让性格差异在牌桌上看得出来，
 * 又不至于压过 EV 本身。调大会让 AI 更像它的标签、更不像在算牌。
 */
const AGGRESSION_WEIGHT = 0.08;
const CBET_WEIGHT = 0.10;

/**
 * AI 的一次决策。
 *
 * AI 不自己判断局面：它构造 Situation 交给 core/evEstimate 算出各动作的 EV，
 * 再按性格在这组 EV 上加一个偏好分来选。这样 AI 的世界观与复盘引擎完全一致，
 * 不会出现「复盘说该弃牌、AI 在同样局面从不弃」的割裂。
 */
export function decide(state: GameState, opts: DecideOptions): Decision {
  if (state.handOver || state.toAct === null) {
    throw new Error('本手已结束或无人待行动，无法决策');
  }

  const legal = legalActions(state);
  if (legal.length === 0) throw new Error(`座位 ${state.toAct} 没有合法动作`);

  const personaId = opts.personaIds.get(state.toAct) ?? GTO_PERSONA.id;
  const persona = personaId === 'hero' ? GTO_PERSONA : getPersona(personaId);

  const sit = situationFromGameState(state, {
    ranges: opts.ranges,
    personaIds: opts.personaIds,
  });

  const ev = estimateEv(sit, {
    iterations: opts.iterations ?? 500,
    strengthIterations: opts.strengthIterations ?? 40,
    rng: opts.rng,
  });

  // 只保留引擎认可的候选。estimateEv 不知道最小加注额，
  // 会给出翻前 1.5BB 这类非法尺度。
  // `!chipsGreater(legal.min, investment)` 等价于「investment >= min - 1e-9」——
  // 用项目统一的筹码比较容差，而不是裸写 epsilon。
  //
  // 类型匹配不能用裸的 `===`：estimateEv 给下注/加注候选定类型的规则是
  // 「toCall > 0 就是 raise，否则是 bet」（见 evEstimate.ts makeBetCandidate），
  // 而 legalActions 给同一个动作定类型的规则是「currentBet > 0 就是 raise，
  // 否则是 bet」（见 gameEngine.ts）。两条规则在几乎所有局面下重合，唯独在
  // 大盲被平跟到选项时分歧：toCall === 0 但 currentBet === 1，estimateEv 说
  // 'bet'、引擎说 'raise'。若还要求全下的候选去匹配一个已经不存在 raise/bet
  // 选项、只剩 allin 的合法列表（比如筹码只够跟注却不够最小加注），同样的
  // 裸判等会把它筛掉，AI 只能干等着弃牌/跟注。用 matchesLegal 把
  // bet/raise/allin 当同一族处理，具体投入额是否合法仍然交给下面的
  // investment >= legal.min 过滤，不会让一个 1/3 池的小下注错配到全下上。
  const usable = ev.candidates
    .map(c => ({ candidate: c, legal: legal.find(a => matchesLegal(c.actionType, a.type)) }))
    .filter((x): x is { candidate: EvCandidate; legal: LegalAction } => x.legal !== undefined)
    .filter(x => !chipsGreater(x.legal.min, x.candidate.investment));

  if (usable.length === 0) {
    // 兜底：弃牌或过牌总有一个是合法的
    const fallback = legal.find(a => a.type === 'check') ?? legal.find(a => a.type === 'fold') ?? legal[0];
    const chosen = ev.candidates.find(c => c.actionType === fallback.type) ?? ev.candidates[0];
    return {
      action: { type: fallback.type },
      persona,
      ev,
      chosen,
      score: chosen.ev,
    };
  }

  const scored = usable.map(x => ({
    ...x,
    score: personaScore(x.candidate, sit.pot, sit.toCall, sit.street, sit.heroIsPreflopAggressor, persona),
  }));

  let best = scored[0];
  for (const s of scored) if (s.score > best.score) best = s;

  // 诈唬：以 bluffFreq 的概率改选进攻候选里偏好分最高的那个
  if (opts.rng.nextFloat() < persona.bluffFreq) {
    const aggressive = scored.filter(s => AGGRESSIVE.has(s.candidate.actionType));
    if (aggressive.length > 0) {
      let top = aggressive[0];
      for (const a of aggressive) if (a.score > top.score) top = a;
      best = top;
    }
  }

  return {
    action: toActionInput(best.candidate, best.legal),
    persona,
    ev,
    chosen: best.candidate,
    score: best.score,
  };
}

/**
 * 在 EV 之上叠加性格偏好。不改 EV 本身 —— 客观估值对所有性格是同一个。
 * 导出供测试直接调用：decide() 要挑出一个「所选动作恰好是进攻动作」的
 * 真实牌局才能测到这个函数的行为，靠随机种子跑到这种局面并不保证每次
 * 都命中；直接传合成的 candidate/persona 进来，断言就不会因为跑到别的
 * 分支而悄悄退化成不执行。
 */
export function personaScore(
  c: EvCandidate,
  pot: number,
  toCall: number,
  street: Street,
  isPreflopAggressor: boolean,
  p: Persona,
): number {
  let score = c.ev;

  if (AGGRESSIVE.has(c.actionType)) {
    score += (p.aggression - 1) * pot * AGGRESSION_WEIGHT;
  }
  if (c.actionType === 'call') {
    // callThresholdMul < 1 表示跟得松：等价于把跟注的门槛下调
    score += (1 - p.callThresholdMul) * toCall;
  }
  if (street === 'flop' && isPreflopAggressor && c.actionType === 'bet') {
    score += (p.cbetFreq - 0.5) * pot * CBET_WEIGHT;
  }

  return score;
}

/**
 * 把候选映射成引擎接受的动作，金额夹到合法区间。
 *
 * 类型必须用 legal.type（引擎认可的类型），不能用 c.actionType（EV 引擎
 * 自己的命名）—— matchesLegal 已经允许两者不完全相同（bet/raise/allin
 * 互相匹配），如果这里还返回 c.actionType，applyAction 内部按 input.type
 * 严格查找 legalActions() 列表会找不到，照样抛「非法动作」。
 */
function toActionInput(c: EvCandidate, legal: LegalAction): ActionInput {
  if (legal.type === 'fold' || legal.type === 'check') {
    return { type: legal.type };
  }
  if (legal.type === 'call' || legal.type === 'allin') {
    return { type: legal.type };
  }
  const amount = round2(Math.min(Math.max(c.investment, legal.min), legal.max));
  return { type: legal.type, amount };
}
