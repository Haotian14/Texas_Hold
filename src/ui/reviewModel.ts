import type { HandAnalysis, DecisionAnalysis } from '../review/types';
import type { Severity } from '../review/taxonomy';
import { severityOf } from '../review/taxonomy';
import type { Street, HandRecord } from '../core/types';

export type Grade = 'unknown' | 'clean' | 'minor' | 'notable' | 'severe';

export interface GradeInfo {
  grade: Grade;
  /** 面向用户的一句话 */
  text: string;
}

/**
 * 三档失误的文案。用 Record<Exclude<Severity, 'ok'>, string> 而不是普通对象：
 * taxonomy.ts 将来给 Severity 加档时，这里会编译失败，而不是在界面上静默
 * 显示 undefined。同一个编译期穷尽手法在 src/ui/sound.ts 的 soundFor 里已经用过。
 */
const MISTAKE_TEXT: Record<Exclude<Severity, 'ok'>, string> = {
  minor: '有小偏差',
  notable: '有明显失误',
  severe: '有重大失误',
};

/**
 * 本手整体评级。
 *
 * 按 worstEvLoss（单点最大损失）定档，不是按 totalEvLoss ——
 * 与规格 §9 历史页的排序字段一致：一个 3 BB 的大错比十个 0.3 BB 的
 * 小偏差更该标红，累加会把后者顶到前者之上。
 *
 * 阈值不在这里重写，直接调 severityOf()。taxonomy.ts 顶部写明
 * 「调整判定松紧时只应该改这个文件」，UI 复制一份阈值就等于把它作废。
 *
 * unknown 单列一档是必要的：不能让「算不出来」和「没打错」显示成
 * 同一个颜色，那是用沉默冒充结论。
 */
export function handGrade(a: HandAnalysis): GradeInfo {
  if (a.decisions.length === 0 || a.decisions.every(d => d.degraded)) {
    return { grade: 'unknown', text: '本手没有可判定的决策点' };
  }
  const s = severityOf(a.worstEvLoss);
  if (s === 'ok') return { grade: 'clean', text: '这手没问题' };
  return { grade: s, text: MISTAKE_TEXT[s] };
}

export interface TimelineRow {
  decision: DecisionAnalysis;
  /** 该决策点在 HandAnalysis.decisions 里的下标，作为展开状态的 key */
  index: number;
}

export interface StreetGroup {
  street: Street;
  label: string;
  rows: TimelineRow[];
}

/** 街序固定，不随决策点出现顺序变化 */
const STREET_ORDER: readonly Street[] = ['preflop', 'flop', 'turn', 'river'];

/** 与 MISTAKE_TEXT 同理：Street 加成员时这里编译失败，而不是显示 undefined */
const STREET_LABEL: Record<Street, string> = {
  preflop: '翻前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
};

/**
 * 时间线：按街分组，只保留有 hero 决策点的街。
 *
 * TimelineRow.index 是决策点在 a.decisions 里的原下标，不是排序后的名次 ——
 * 展开状态用它做 key，用名次会在组内重排后展开错的那一行。
 */
export function timelineOf(a: HandAnalysis): StreetGroup[] {
  const groups: StreetGroup[] = [];
  for (const street of STREET_ORDER) {
    const rows: TimelineRow[] = [];
    a.decisions.forEach((decision, index) => {
      if (decision.street === street) rows.push({ decision, index });
    });
    if (rows.length === 0) continue;
    rows.sort((x, y) => x.decision.actionIndex - y.decision.actionIndex);
    groups.push({ street, label: STREET_LABEL[street], rows });
  }
  return groups;
}

export interface Bar {
  label: string;
  /** 单位 BB */
  ev: number;
  /** 条形宽度，占轴长的百分比 */
  widthPct: number;
  /** 条形左端在轴上的位置，百分比 */
  leftPct: number;
  isRecommended: boolean;
  /** 用户实际选的那一条 */
  isActual: boolean;
}

export interface BarChart {
  bars: Bar[];
  /** 零点在轴上的位置，百分比。基线画在这里 */
  zeroPct: number;
}

/**
 * 某决策点的 EV 条形图。
 *
 * 轴取 [min(0, ...evs), max(0, ...evs)] —— 两端都把 0 括进来，
 * 保证零点基线永远在轴内、EV 恰为 0 的 fold 那根永远画得出来。
 * 负 EV 的条向左伸，右端正好贴住基线。
 *
 * degraded 的决策点 candidates 是空数组（见 review/types.ts），
 * 自然得到一张空图，调用方不必额外判断。
 */
export function barsOf(d: DecisionAnalysis): BarChart {
  if (d.candidates.length === 0) return { bars: [], zeroPct: 0 };

  const evs = d.candidates.map(c => c.ev);
  const lo = Math.min(0, ...evs);
  const hi = Math.max(0, ...evs);
  const span = hi - lo;
  // 所有候选 EV 全为 0：轴长为 0，不做除法，所有条宽记 0
  if (span === 0) {
    return {
      zeroPct: 0,
      bars: d.candidates.map(c => ({
        label: c.label,
        ev: c.ev,
        widthPct: 0,
        leftPct: 0,
        isRecommended: c.isRecommended,
        isActual: c.label === d.actualLabel,
      })),
    };
  }

  const zeroPct = ((0 - lo) / span) * 100;
  return {
    zeroPct,
    bars: d.candidates.map(c => {
      const negative = c.ev < 0;
      return {
        label: c.label,
        ev: c.ev,
        widthPct: (Math.abs(c.ev) / span) * 100,
        leftPct: negative ? ((c.ev - lo) / span) * 100 : zeroPct,
        isRecommended: c.isRecommended,
        isActual: c.label === d.actualLabel,
      };
    }),
  };
}

/**
 * 本手弃过牌的座位号，供对手底牌灰显。
 *
 * HandResult 只有 seat / netBB / showdown，没有 folded 字段，
 * 「谁弃了牌」这件事的权威来源是动作序列本身。
 */
export function foldedSeatsOf(record: HandRecord): number[] {
  return [...new Set(record.actions.filter(a => a.type === 'fold').map(a => a.seat))];
}
