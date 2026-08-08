import type { GameState, Street } from '../core/types';
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

const AGGRESSIVE = new Set(['bet', 'raise', 'allin']);

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
  const usable = ev.candidates
    .map(c => ({ candidate: c, legal: legal.find(a => a.type === c.actionType) }))
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

/** 在 EV 之上叠加性格偏好。不改 EV 本身 —— 客观估值对所有性格是同一个。 */
function personaScore(
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

/** 把候选映射成引擎接受的动作，金额夹到合法区间 */
function toActionInput(c: EvCandidate, legal: LegalAction): ActionInput {
  if (c.actionType === 'fold' || c.actionType === 'check') {
    return { type: c.actionType };
  }
  if (c.actionType === 'call' || c.actionType === 'allin') {
    return { type: c.actionType };
  }
  const amount = round2(Math.min(Math.max(c.investment, legal.min), legal.max));
  return { type: c.actionType, amount };
}
