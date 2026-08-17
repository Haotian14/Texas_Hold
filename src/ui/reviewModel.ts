import type { HandAnalysis } from '../review/types';
import type { Severity } from '../review/taxonomy';
import { severityOf } from '../review/taxonomy';

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
