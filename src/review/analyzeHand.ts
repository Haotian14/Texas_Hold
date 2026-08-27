import type { HandRecord } from '../core/types';
import { estimateEv } from '../core/evEstimate';
import { createRng } from '../core/rng';
import type { HandAnalysis, DecisionAnalysis } from './types';
import { REVIEW_SCHEMA_VERSION } from './types';
import type { MistakeTag } from './taxonomy';
import { severityOf, EV_NOISE_SIGMAS } from './taxonomy';
import { heroDecisionPoints } from './situationFromRecord';
import { preflopNodeFor } from '../core/preflopNode';
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
    const degraded = ev.degraded !== null;
    // degraded 时对手范围被替换过，actualCand.ev 不可信——即使 matchCandidate
    // 匹配上了候选，也必须强制为 null，不能让这个数字流到 UI（见 types.ts
    // 上 actualEv/recommended 的注释，这是本次修复要堵上的两个漏洞之一）。
    const actualEv = degraded ? null : actualCand ? actualCand.ev : null;

    // preflopNodeFor 只调用一次,判失误短路和 tagFor 的"是否在开池"判断
    // 共用同一个节点值 —— 两处若各自算一次,不仅重复计算,还留下"万一两处算出
    // 不一致的节点"这种本不该存在的隐患。
    const node = p.situation.street === 'preflop' ? preflopNodeFor(p.state) : null;

    // ── 三条短路,顺序有意义
    // 1) 估算降级:对手范围被替换过,这个数字不能拿去告诉用户亏了多少(②-B-1 的硬约束)
    // 2) 翻前频率达标:均衡策略是混合的,低频但合法的选择不算失误(spec §8.2)
    // 3) 匹配不到候选:算不出损失就不报损失,宁可少算
    const preflopOk =
      p.situation.street === 'preflop' &&
      judgePreflopFrequency(node, p.situation, p.actual);

    const skip = degraded || preflopOk || actualEv === null;

    // 噪声闸门（taxonomy.ts 的 EV_NOISE_SIGMAS）：推荐与实际都是蒙特卡洛估计，
    // 差值小于合成噪声带时，「推荐动作更好」这句话本身就不成立，按 0 处理。
    // 带宽由这个决策点自己的两个标准误算出来，不是一个固定常数——底池越大、
    // 尺度越大，同样的采样次数下越不确定，闸门自动放宽。
    const noiseBand = EV_NOISE_SIGMAS * Math.hypot(
      ev.recommended.evStdErr ?? 0,
      actualCand?.evStdErr ?? 0,
    );
    const rawLoss = skip ? 0 : Math.max(0, round4(ev.recommended.ev - actualEv));
    const evLoss = rawLoss > noiseBand ? rawLoss : 0;
    const severity = severityOf(evLoss);
    const tag: MistakeTag | null =
      skip || severity === 'ok' ? null : tagFor(p.situation, p.actual, actualCand, ev, node);

    decisions.push({
      actionIndex: p.actionIndex,
      street: p.situation.street,
      situation: p.situation,
      actual: p.actual,
      actualEv,
      // degraded 时同样强制为 null——ev.recommended 里的 .ev/.investment/
      // .foldEquity/.equityWhenCalled 全部用替换过的对手范围算出来，字面
      // 名字又恰好是「推荐」，最容易被 UI 不加检查地直接渲染（见 types.ts
      // 上 recommended 字段的注释）。explain() 下面单独接收 ev.recommended
      // 本身（未经这层 null 化），因为它已经在最前面用 input.degraded 短路，
      // 从不会在降级时读到 recommended.label 之外的任何数字。
      recommended: degraded ? null : ev.recommended,
      // 以下四个字段是 ③-B 复盘卡片的数据出口。全部原样取自本次已经
      // 算好的 ev / actualCand，不新增任何计算 —— 多调一次 estimateEv
      // 会改变随机流，破坏「同一记录分析两次结果逐位相同」那条测试。
      // degraded 的置空规则与 actualEv / recommended 一致，唯一例外是
      // requiredEquity（纯底池几何，与对手范围无关，见 types.ts 注释）。
      candidates: degraded ? [] : ev.candidates,
      heroEquity: degraded ? null : ev.heroEquity,
      requiredEquity: ev.requiredEquity,
      actualLabel: degraded ? null : (actualCand ? actualCand.label : null),
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
