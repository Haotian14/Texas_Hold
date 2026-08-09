import type { Street, Action } from '../core/types';
import type { Situation } from '../core/situation';
import type { EvCandidate } from '../core/evEstimate';
import type { Severity, MistakeTag } from './taxonomy';

export interface DecisionAnalysis {
  /** 该动作在 HandRecord.actions 里的下标 */
  actionIndex: number;
  street: Street;
  /** 当时的局面，供 UI 复现牌面与底池 */
  situation: Situation;
  actual: Action;
  /** 用户实际动作的 EV。无法匹配到候选时为 null */
  actualEv: number | null;
  recommended: EvCandidate;
  /** max(0, EV(推荐) − EV(实际))。degraded 时恒为 0 */
  evLoss: number;
  severity: Severity;
  tag: MistakeTag | null;
  explanation: string;
  /**
   * 估算是否降级（对手范围被替换过）。为 true 时 evLoss 不可信，
   * 已强制记 0、severity 记 ok —— UI 应显示「本手此处无法判定」而不是数字。
   */
  degraded: boolean;
}

export interface HandAnalysis {
  recordId: string;
  heroSeat: number;
  schemaVersion: number;
  decisions: DecisionAnalysis[];
  /** 所有决策点 evLoss 之和 */
  totalEvLoss: number;
  /** 单个决策点的最大 evLoss，供历史列表排序（spec §9 的索引字段） */
  worstEvLoss: number;
  /** 本手出现过的所有 tag，去重。对应 §9 的 mistakeTags multiEntry 索引 */
  tags: MistakeTag[];
}

export const REVIEW_SCHEMA_VERSION = 1;
