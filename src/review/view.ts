import type { Action, Street } from '../core/types';
import type { EvCandidate } from '../core/evEstimate';
import type { Severity, MistakeTag } from './taxonomy';
import type { HandAnalysis, DecisionAnalysis } from './types';

/**
 * 复盘的**视图类型**，同时也是落库用的 DTO。
 *
 * 为什么不直接用 `HandAnalysis`：
 *
 * 1. **它序列化不了。** 每个决策点挂着完整的 `Situation`，里面
 *    `opponents[].range` 是 `ReadonlyMap`——`JSON.stringify` 会把它静默变成
 *    `{}`，不报错，取回时范围为空。另外 `recommended` 与 `candidates` 里的
 *    某一项是**同一个对象引用**，序列化会把它拆成两份，`===` 判等失效。
 *
 * 2. **范围不该落库，因为它没用。** 界面上没有一处渲染对手范围（复盘卡片
 *    只用到 pot / toCall）；而规格 §9 说的「规则升级后批量重跑分析」，输入是
 *    `HandRecord`（座位、personaId、seed、动作序列都在），不是存下来的
 *    `Situation`——范围本来就是从 record 重新推出来的。
 *
 * 3. **体积。** 规格估「单手 1–2 KB」。带上范围的话，5 个对手 × 169 项的
 *    范围表，单个决策点就 10 KB 上下，10000 手 400 MB，移动端配额直接爆。
 *    砍掉范围后回到约 2 KB，与规格一致。
 *
 * 关键的一点：它**同时是 UI 的输入类型**。复盘卡片吃 `HandView`，于是
 * 「刚算出来的」和「从库里取出来的」走同一条渲染路径。若改成取回后再把
 * `HandView` 复原成 `HandAnalysis`，就必须给 `opponents[].range` 编一个假值
 * ——那正是本项目一直在防的那类缺陷：拿一个结构上合法、语义上是谎的值喂
 * 给下游。这个类型让那件事在编译期就做不到。
 */

/** 与 HandRecord 的 schemaVersion 分开：视图的字段集会随界面演进 */
export const HAND_VIEW_SCHEMA_VERSION = 1;

export interface DecisionView {
  /** 该动作在 HandRecord.actions 里的下标 */
  actionIndex: number;
  street: Street;
  actual: Action;
  /** 决策当时的底池，单位 BB（从 Situation 里摘出来的两个数） */
  pot: number;
  /** hero 当时需要再投入多少才能跟上 */
  toCall: number;
  /** hero 对当时对手范围的胜率。degraded 时为 null */
  heroEquity: number | null;
  /**
   * 跟注所需最低胜率。无需跟注时为 null。
   *
   * degraded 时**依然有效**——它是 toCall / (pot + toCall) 的纯底池几何，
   * 与对手范围是否被替换过无关。见 review/types.ts 上同名字段的注释。
   */
  requiredEquity: number | null;
  /** 该决策点的全部候选与各自 EV。degraded 时为空数组 */
  candidates: EvCandidate[];
  /** 用户实际动作匹配到的候选 label；匹配不上或 degraded 时为 null */
  actualLabel: string | null;
  /**
   * 推荐候选的 label。degraded 时为 null。
   *
   * 存 label 而不是候选对象：`candidates[i].isRecommended` 本来就在，多存一个
   * 对象引用既是冗余，又是「序列化后 === 失效」那个缺陷的来源。
   */
  recommendedLabel: string | null;
  /** max(0, EV(推荐) − EV(实际))。degraded 时恒为 0 */
  evLoss: number;
  severity: Severity;
  tag: MistakeTag | null;
  explanation: string;
  /** 估算是否降级。为 true 时上面几个范围派生的字段已被强制置空 */
  degraded: boolean;
}

export interface HandView {
  schemaVersion: number;
  recordId: string;
  heroSeat: number;
  decisions: DecisionView[];
  /** 所有决策点 evLoss 之和 */
  totalEvLoss: number;
  /** 单个决策点的最大 evLoss，供历史列表排序（spec §9 的索引字段） */
  worstEvLoss: number;
  /** 本手出现过的所有 tag，去重 */
  tags: MistakeTag[];
}

/**
 * 把 -0 归一成 0。
 *
 * JSON 不保留负零：`JSON.stringify(-0)` 是 `"0"`。留着它，同一手牌在"刚打完"
 * 和"从库里取出来"两种情况下会渲染成两个样子——`(-0).toFixed(2)` 是
 * `"-0.00"`，而往返之后变成 `"0.00"`。EV 条形图里恰好有一堆算出来是 ±0 的
 * 候选（fold 恒为 0，全下在必弃牌局面下也常是 -0），所以这不是纸上谈兵。
 *
 * 在**写入侧**归一而不是在渲染侧特判：渲染侧要改的地方不止一处，而且下一个
 * 消费者（历史页、导出文件、③-D 的报表）还会各漏一遍。
 */
function norm(v: number): number {
  return v === 0 ? 0 : v;
}

function normOpt(v: number | undefined): number | undefined {
  return v === undefined ? undefined : norm(v);
}

/**
 * 候选逐个重建，不复用 HandAnalysis 里的对象。
 *
 * 直接 `candidates: d.candidates` 会让视图与分析共享同一批对象——这正是本类型
 * 要消灭的那种耦合（recommended 的共享引用是同一个毛病的另一面）。视图是要被
 * 存进库、被 JSON 化、被跨会话取回的，它不该有任何一个字段指回内存里的活对象。
 */
function candidateView(c: EvCandidate): EvCandidate {
  const out: EvCandidate = {
    label: c.label,
    actionType: c.actionType,
    investment: norm(c.investment),
    ev: norm(c.ev),
    isRecommended: c.isRecommended,
  };
  // 三个可选字段只在存在时带上：写成 `foldEquity: c.foldEquity` 会给不含它的
  // 候选凭空加一个 `undefined` 键，JSON.stringify 会把它整个丢掉，于是往返
  // 前后的对象键集不同——那条往返测试会失败，而且失败得莫名其妙。
  if (c.foldEquity !== undefined) out.foldEquity = normOpt(c.foldEquity);
  if (c.equityWhenCalled !== undefined) out.equityWhenCalled = normOpt(c.equityWhenCalled);
  if (c.impliedOdds !== undefined) out.impliedOdds = normOpt(c.impliedOdds);
  return out;
}

function actionView(a: Action): Action {
  return {
    ...a,
    amount: norm(a.amount),
    potBefore: norm(a.potBefore),
    toCall: norm(a.toCall),
    stackBefore: norm(a.stackBefore),
  };
}

function decisionView(d: DecisionAnalysis): DecisionView {
  return {
    actionIndex: d.actionIndex,
    street: d.street,
    actual: actionView(d.actual),
    pot: norm(d.situation.pot),
    toCall: norm(d.situation.toCall),
    heroEquity: d.heroEquity === null ? null : norm(d.heroEquity),
    requiredEquity: d.requiredEquity === null ? null : norm(d.requiredEquity),
    candidates: d.candidates.map(candidateView),
    actualLabel: d.actualLabel,
    // recommended 在 degraded 时已被 analyzeHand 强制置 null（见 review/types.ts），
    // 这里照搬，不额外判 degraded —— 多写一次判断就多一处会和上游漂移的地方。
    recommendedLabel: d.recommended === null ? null : d.recommended.label,
    evLoss: norm(d.evLoss),
    severity: d.severity,
    tag: d.tag,
    explanation: d.explanation,
    degraded: d.degraded,
  };
}

export function viewOf(a: HandAnalysis): HandView {
  return {
    schemaVersion: HAND_VIEW_SCHEMA_VERSION,
    recordId: a.recordId,
    heroSeat: a.heroSeat,
    decisions: a.decisions.map(decisionView),
    totalEvLoss: norm(a.totalEvLoss),
    worstEvLoss: norm(a.worstEvLoss),
    // 数组也复制一份，理由同 candidateView：视图不该有指回活对象的字段
    tags: [...a.tags],
  };
}
