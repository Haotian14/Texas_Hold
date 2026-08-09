import type { HandRecord } from '../core/types';
import { estimateEv } from '../core/evEstimate';
import { createRng } from '../core/rng';
import type { HandAnalysis, DecisionAnalysis } from './types';
import { REVIEW_SCHEMA_VERSION } from './types';
import type { MistakeTag } from './taxonomy';
import { severityOf } from './taxonomy';
import { heroDecisionPoints } from './situationFromRecord';
import { preflopNodeFor } from './preflopNode';
import { matchCandidate, judgePreflopFrequency, tagFor } from './judge';
import { explain } from './explain';

export interface AnalyzeOptions {
  /** 主胜率估算的迭代数。默认 1500 —— 复盘不受手机实时预算约束，可以比 AI 算得准 */
  iterations?: number;
  /** 范围牌力排序的迭代数。默认 40 */
  strengthIterations?: number;
}

/**
 * 复盘一手牌:对 hero 的每个决策点给出「错在哪、亏了多少、属于哪类」。
 *
 * 与 AI 走同一条估算路径(core/evEstimate),所以不会出现
 * 「复盘说该弃牌、AI 在同样局面从不弃」这种割裂。
 *
 * 迭代数默认比 AI 高:AI 有 100ms 的手机预算,复盘没有,
 * 可以用更多采样换更小的噪声。
 */
export function analyzeHand(record: HandRecord, opts: AnalyzeOptions = {}): HandAnalysis {
  const iterations = opts.iterations ?? 1500;
  const strengthIterations = opts.strengthIterations ?? 40;

  const points = heroDecisionPoints(record, { strengthIterations });
  const decisions: DecisionAnalysis[] = [];

  for (const p of points) {
    // 每个决策点用自己的 rng,且种子只与记录 id 和动作下标有关 ——
    // 这样某个决策点的采样次数变化不会影响后面决策点的结果,
    // 单点调试时也能独立复现。
    const rng = createRng(`${record.id}-analyze-${p.actionIndex}`);
    const ev = estimateEv(p.situation, { iterations, strengthIterations, rng });

    const actualCand = matchCandidate(ev, p.actual);
    const actualEv = actualCand ? actualCand.ev : null;
    const degraded = ev.degraded !== null;

    // ── 三条短路,顺序有意义
    // 1) 估算降级:对手范围被替换过,这个数字不能拿去告诉用户亏了多少(②-B-1 的硬约束)
    // 2) 翻前频率达标:均衡策略是混合的,低频但合法的选择不算失误(spec §8.2)
    // 3) 匹配不到候选:算不出损失就不报损失,宁可少算
    const preflopOk =
      p.situation.street === 'preflop' &&
      judgePreflopFrequency(preflopNodeFor(p.state), p.situation, p.actual);

    const skip = degraded || preflopOk || actualEv === null;

    const evLoss = skip ? 0 : Math.max(0, round4(ev.recommended.ev - actualEv));
    const severity = severityOf(evLoss);
    const tag: MistakeTag | null =
      skip || severity === 'ok' ? null : tagFor(p.situation, p.actual, actualCand, ev);

    decisions.push({
      actionIndex: p.actionIndex,
      street: p.situation.street,
      situation: p.situation,
      actual: p.actual,
      actualEv,
      recommended: ev.recommended,
      evLoss,
      severity,
      tag,
      explanation: explain({
        tag,
        severity,
        situation: p.situation,
        actual: p.actual,
        actualEv,
        recommended: ev.recommended,
        evLoss,
        degraded,
        heroEquity: ev.heroEquity,
        requiredEquity: ev.requiredEquity,
      }),
      degraded,
    });
  }

  const tags = [...new Set(decisions.map(d => d.tag).filter((t): t is MistakeTag => t !== null))];

  return {
    recordId: record.id,
    heroSeat: record.heroSeat,
    schemaVersion: REVIEW_SCHEMA_VERSION,
    decisions,
    totalEvLoss: round4(decisions.reduce((a, d) => a + d.evLoss, 0)),
    worstEvLoss: decisions.length === 0 ? 0 : Math.max(...decisions.map(d => d.evLoss)),
    tags,
  };
}

/** 与 evEstimate 的取整位数一致,避免浮点尾数让测试抖动 */
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
