import type { HandView, DecisionView } from '../review/view';
import type { Severity, MistakeTag } from '../review/taxonomy';
import { severityOf } from '../review/taxonomy';
import { chipsGreater } from '../core/chips';
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
export function handGrade(a: HandView): GradeInfo {
  if (a.decisions.length === 0 || a.decisions.every(d => d.degraded)) {
    return { grade: 'unknown', text: '本手没有可判定的决策点' };
  }
  const s = severityOf(a.worstEvLoss);
  if (s === 'ok') return { grade: 'clean', text: '这手没问题' };
  return { grade: s, text: MISTAKE_TEXT[s] };
}

export interface TimelineRow {
  decision: DecisionView;
  /** 该决策点在 HandView.decisions 里的下标，作为展开状态的 key */
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
export function timelineOf(a: HandView): StreetGroup[] {
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
export function barsOf(d: DecisionView): BarChart {
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
      // c.ev 是 BB 金额，走 chips.ts 而不是裸 <（见 Global Constraints）。
      // 效果上还多一层保护：EV 为 -1e-13 这类浮点尾数的候选会被归到正侧，
      // 于是 leftPct 取 zeroPct、宽度约等于 0，不会在基线左边留一根看不见
      // 却把 outline 画歪的条。
      const negative = chipsGreater(0, c.ev);
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

/**
 * MistakeTag 的中文标签（文案抄自设计文档 §8.7 的分类表）。
 *
 * tag 是给引擎自己看的枚举名（`preflop_cold_call_too_wide`），不是给用户
 * 看的话。此前 ReviewDecision 直接把它渲染进一张全中文的卡片里，中间夹一串
 * 下划线英文——和本分支早先把 Seat.tsx 的 ACTION_TEXT 提到 format.ts 所修
 * 的是同一个毛病，只是漏在了这一处。
 *
 * 用 Record<MistakeTag, string> 而不是普通对象：taxonomy.ts 的
 * PREFLOP_TAGS / POSTFLOP_TAGS 加成员时这里会编译失败，而不是在界面上
 * 静默显示 undefined。同 MISTAKE_TEXT / STREET_LABEL。
 */
export const TAG_TEXT: Record<MistakeTag, string> = {
  preflop_cold_call_too_wide: '冷跟太宽',
  preflop_missed_3bet: '该 3bet 没 3bet',
  preflop_over_aggressive: '翻前过度激进',
  preflop_sb_limp: '小盲跛入',
  preflop_open_too_wide: '开池范围太宽',
  preflop_fold_too_tight: '弃得太紧',
  missed_cbet: '该 c-bet 没 c-bet',
  missed_value_bet: '错过价值下注',
  chasing_bad_odds: '赔率不足追听牌',
  call_too_light_vs_raise: '面对加注跟太松',
  should_have_folded: '该弃牌没弃',
  bet_size_too_small: '下注尺度过小',
  bet_size_too_large: '下注尺度过大',
  ineffective_bluff: '无效诈唬',
  over_bluffing: '诈唬过多',
};
