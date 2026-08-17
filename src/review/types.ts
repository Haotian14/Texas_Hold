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
  /**
   * 用户实际动作的 EV。无法匹配到候选时为 null；degraded 为 true 时同样强制
   * 为 null —— 这个数字是用替换过的对手范围算出来的，不能拿去告诉用户
   * 「你这步的 EV 是多少」，见下面 recommended 与 degraded 字段的说明。
   */
  actualEv: number | null;
  /**
   * EV 引擎推荐的候选。degraded 为 true 时强制为 null，而不是原样返回一个
   * 带着不可信 .ev/.investment/.foldEquity/.equityWhenCalled 的 EvCandidate——
   * 这个字段名字面上就是「推荐」，UI 最容易不做检查就直接渲染
   * `recommended.label`/`recommended.ev`，那正是本字段在 degraded 时必须为
   * null 的原因（另见 evLoss/severity/tag 已经在 degraded 时被强制清零/置空，
   * 这里补齐 recommended 与 actualEv 两个此前被漏掉的字段）。
   */
  recommended: EvCandidate | null;
  /**
   * 该决策点的全部候选动作与各自 EV，供 UI 画条形图。
   * degraded 时为空数组 —— 每个候选的 EV 都建立在被替换过的对手范围上，
   * 与 actualEv / recommended 是同一类不可信数字。
   */
  candidates: EvCandidate[];
  /** hero 对当前对手范围的胜率。degraded 时为 null */
  heroEquity: number | null;
  /**
   * 跟注所需最低胜率。无需跟注（toCall = 0）时为 null。
   *
   * 与上面两个字段不同，**degraded 时它依然有效**：它是
   * toCall / (pot + toCall) 的纯底池几何（见 core/evEstimate.ts 里
   * requiredEquity 的算式），只取决于 Situation 里的金额，与对手范围
   * 是否被替换过完全无关。降级的决策点上「跟这注需要多少胜率」仍是
   * 一句诚实的话，只是「你有多少胜率」不能说。
   */
  requiredEquity: number | null;
  /**
   * 用户实际动作匹配到的候选的 label，匹配不上或 degraded 时为 null。
   *
   * 条形图要高亮「你选的那一条」，而 UI 手上只有 actual: Action。
   * 让 UI 靠 actionType + investment 自己比对，等于把 judge.ts 的
   * matchCandidate 在界面层重写一遍，两份匹配规则迟早漂移。
   */
  actualLabel: string | null;
  /** max(0, EV(推荐) − EV(实际))。degraded 时恒为 0 */
  evLoss: number;
  severity: Severity;
  tag: MistakeTag | null;
  explanation: string;
  /**
   * 估算是否降级（对手范围被替换过）。为 true 时 evLoss/severity/tag 已强制
   * 记为 0/ok/null，actualEv/recommended 也已强制记为 null —— 这五个字段在
   * degraded 为 true 时全部不可信，UI 应显示「本手此处无法判定」而不是任何
   * 数字、候选或标签。
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
