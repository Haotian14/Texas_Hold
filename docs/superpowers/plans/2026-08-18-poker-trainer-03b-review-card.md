# ③-B 复盘卡片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一手牌结束后，用户能打开一张复盘卡片，逐个决策点看到「这一步错了吗、亏了多少 BB、属于哪类错误、为什么」。

**Architecture:** 三段。(1) `src/review` 补四个数据出口 —— `estimateEv` 早就算好的候选列表与两个胜率，`analyzeHand` 此前没往外传，EV 条形图画不出来。(2) `src/ui/reviewModel.ts` 一个零 React 零 DOM 的纯函数模块，承载本期几乎全部可测逻辑（评级、时间线分组、条形图归一化）。(3) 五个薄组件 + App 接线。判定逻辑一条不改。

**Tech Stack:** TypeScript + React 19 + Vite + Vitest。无新增依赖 —— 条形图用 CSS 宽度百分比手画，不引图表库。

**规格：** `docs/superpowers/specs/2026-08-18-poker-trainer-03b-review-card-design.md`
**基线：** `review-card` 分支 @ `404b33e`（自 master `51e515f`），**45 文件 / 631 通过 / 3 跳过**，typecheck + build 绿

**预期测试数逐任务：** 631 → T1 633 → T2 637 → T3 643 → T4–T7 不变。终态 **46 文件 / 643 通过 / 3 跳过**。
任何一步跑出的数字与这里对不上，**停下来报告实际数字**，不要通过删测试或放宽断言把数字凑回来。

---

## Global Constraints

每个任务都必须遵守。以下是本仓库的既有硬约束，逐条从规格与既有守卫抄来：

- **不得修改 `src/core/` `src/ai/` `src/session/` 的任何文件。** `src/review/` 只允许 Task 1 规定的加法改动（新增字段与填充），一条判定规则都不改（`judge.ts` / `taxonomy.ts` / `explain.ts` / `preflopNode.ts` / `situationFromRecord.ts` 全部只读）。若认为某处必须碰，停下来报告（NEEDS_CONTEXT / BLOCKED），不要动手。
- **`src/ui` 不得从 `core/gameEngine`、`ai/decide`、`ai/selfPlayAi` 取值**（`import type` 不限）。这条由 `src/session/architecture.test.ts:136` 的守卫强制，不得放宽守卫。从 `src/review/*`、`src/core/chips`、`src/core/types`（类型）导入不在禁止清单内，允许。
- **金额比较一律用 `src/core/chips.ts` 的 `isZeroChips` / `chipsGreater` / `round2`，禁止裸 `===` 和裸 `>` 做金额比较。** 测试代码同样适用。
- **内部量纲一律 BB，实额换算只允许存在于 `src/ui/format.ts`。** 例外照旧：EV 损失与复盘数字保持 BB 显示（见 `format.ts:8-12` 的注释），复盘卡片里的 evLoss / EV / 底池 / 待跟注**一律显示 BB**，不要调用 `chips()` 换成实额。
- **不得改动 `package.json` / `package-lock.json` / `node_modules`。** npm registry 必须保持 `https://registry.npmmirror.com/`。本期不新增任何依赖 —— 特别是不许为了画图表装 recharts / chart.js 之类。
- **`.bottom` 必须保持非 `position: fixed`**（③-A 的历史回归项，Task 6 会碰 CSS）。
- 提交信息用中文，结尾必须带一行，一字不差：
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **绝不允许调参数、放宽断言直到测试变绿。** 测试与实现打架时停下来报双方实际值。
- 每个任务提交前用 `git status --short` 确认提交的文件只属于本任务。
- 验证命令用 Windows 上的 `npx.cmd` / `npm.cmd`。
- 触碰 `.ts`/`.tsx` 的任务收尾前必须跑 `npm.cmd run typecheck`，且必须跑一次全量 `npm.cmd test` 确认数字与本任务的预期一致。

### 本期最要紧的一条性质

**`degraded === true` 的决策点，界面上不得出现任何 EV 数字、候选条形图、推荐动作或 mistakeTag。**

原因写在 `src/review/types.ts` 的字段注释里：这些数字是用被替换过的对手范围算出来的。②-B-2 的一轮审查就是因为 `actualEv` / `recommended` 漏了 degraded 检查才被抓出来。本期新增的 `candidates` / `heroEquity` / `actualLabel` 三个字段是同一类风险的新增面，必须在 Task 1 就用测试钉死。

唯一的例外是 `requiredEquity`：它是 `toCall / (pot + toCall)` 的纯底池几何（见 `src/core/evEstimate.ts:207`），与对手范围无关，degraded 时依然是一句诚实的话，保持有效。

---

## File Structure

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/review/types.ts` | 修改：`DecisionAnalysis` 加四个字段 | T1 |
| `src/review/analyzeHand.ts` | 修改：填充这四个字段 | T1 |
| `src/review/analyzeHand.test.ts` | 修改：非降级时四个字段的断言 | T1 |
| `src/review/analyzeHand.degraded.test.ts` | 修改：降级时的置空断言 | T1 |
| `src/ui/reviewModel.ts` | 新建：纯数据变形，零 React 零 DOM | T2, T3 |
| `src/ui/reviewModel.test.ts` | 新建：本期几乎全部单测 | T2, T3 |
| `src/ui/components/EvBars.tsx` | 新建：EV 条形图 | T4 |
| `src/ui/components/OpponentCards.tsx` | 新建：对手底牌 | T4 |
| `src/ui/components/ReviewDecision.tsx` | 新建：单个决策点展开详情 | T5 |
| `src/ui/components/ReviewTimeline.tsx` | 新建：街道分组 + 决策行 | T5 |
| `src/ui/components/ReviewSheet.tsx` | 新建：卡片壳 | T5 |
| `src/ui/components/ReviewTrigger.tsx` | 新建：结算区的「复盘」按钮 | T6 |
| `src/ui/App.tsx` | 修改：分析时机、缓存、卡片开关 | T6 |
| `src/ui/styles/app.css` | 修改：severity 令牌与卡片样式 | T4, T5, T6 |
| `README.md` | 修改：状态表与已知边界 | T7 |

---

# Task 1: review 层补出 EV 条形图的数据出口

`feat(review): DecisionAnalysis 导出候选列表、两个胜率与实际动作标签`

**Files:**
- Modify: `src/review/types.ts:6-40`（`DecisionAnalysis` 接口）
- Modify: `src/review/analyzeHand.ts:70-99`（`decisions.push({...})`）
- Test: `src/review/analyzeHand.test.ts`（追加一条 `it`，放进现有 `describe('analyzeHand')` 内）
- Test: `src/review/analyzeHand.degraded.test.ts`（追加一条 `it`，放进现有 `describe` 内）

**Interfaces:**
- Consumes: `EvResult`（`src/core/evEstimate.ts:31`）的 `candidates` / `heroEquity` / `requiredEquity`；`matchCandidate`（`src/review/judge.ts`）返回的 `actualCand`。这些在 `analyzeHand` 里都已经是现成的局部变量，**不要新增任何计算、不要多调一次 `estimateEv`**（多调一次会改变随机流，破坏「同一记录分析两次结果逐位相同」那条既有测试）。
- Produces: `DecisionAnalysis` 上四个新字段 —— `candidates: EvCandidate[]`、`heroEquity: number | null`、`requiredEquity: number | null`、`actualLabel: string | null`。Task 2/3 的 `reviewModel.ts` 全靠它们。

## 背景

`DecisionAnalysis` 目前只导出 `recommended: EvCandidate | null`，是单个最优候选。EV 条形图要画的是**全部**候选，规格 §10.3 点名的「用户胜率 / 所需胜率」在这个接口上也根本没有字段。这三样 `estimateEv()` 全都算好了，就在 `EvResult` 里，`analyzeHand()` 只是没往外传。

第四个字段 `actualLabel` 是给条形图高亮「你选的那一条」用的。UI 手上只有 `actual: Action`，靠 `actionType + investment` 自己去比对，等于把 `judge.ts` 的 `matchCandidate` 在界面层重写一遍 —— 两份匹配规则迟早漂移。`analyzeHand` 里 `actualCand` 已经是匹配结果，把它的 `label` 原样传出来即可。

- [ ] **Step 1: 写失败的测试（非降级路径）**

在 `src/review/analyzeHand.test.ts` 顶部的 import 区加一行（`chipsGreater` 用来做金额比较，禁止裸 `>`）：

```ts
import { chipsGreater } from '../core/chips';
```

然后在 `describe('analyzeHand')` 内部、`it('severity 与 evLoss 一致', ...)` 之后追加：

```ts
  it('导出候选列表、两个胜率与实际动作标签（EV 条形图的数据源）', () => {
    const a = analyzeHand(makeRecord('an-bars-1'), OPTS);
    expect(a.decisions.length).toBeGreaterThan(0);
    let checked = 0;
    for (const d of a.decisions) {
      // degraded 的决策点由 analyzeHand.degraded.test.ts 单独覆盖
      if (d.degraded) continue;
      checked++;

      // 候选列表非空，且恰有一条被标记为推荐 —— 这条推荐必须就是
      // recommended 字段本身，不是另算的一个，否则条形图高亮的那根
      // 和文案里说的「建议 X」会是两回事
      expect(d.candidates.length).toBeGreaterThan(0);
      const flagged = d.candidates.filter(c => c.isRecommended);
      expect(flagged).toHaveLength(1);
      expect(flagged[0].label).toBe(d.recommended!.label);

      // hero 胜率是概率，必在 [0,1]
      expect(d.heroEquity).not.toBeNull();
      expect(d.heroEquity!).toBeGreaterThanOrEqual(0);
      expect(d.heroEquity!).toBeLessThanOrEqual(1);

      // 所需胜率：面对下注时是 (0,1) 的真数，无需跟注时为 null
      if (chipsGreater(d.situation.toCall, 0)) {
        expect(d.requiredEquity).not.toBeNull();
        expect(d.requiredEquity!).toBeGreaterThan(0);
        expect(d.requiredEquity!).toBeLessThan(1);
      } else {
        expect(d.requiredEquity).toBeNull();
      }

      // actualLabel 要么为 null（匹配不到候选），要么必须真的是候选之一 ——
      // 条形图靠它高亮，指向一个不存在的标签等于什么都不高亮
      if (d.actualLabel !== null) {
        expect(d.candidates.map(c => c.label)).toContain(d.actualLabel);
      }
    }
    // 守住空转：上面整段若因为全部 degraded 而一条都没检查，这里会红。
    // 没有这条断言，`if (d.degraded) continue` 会让整个测试变成永远绿的空壳
    expect(checked).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: 跑它，确认失败**

Run: `npx.cmd vitest run src/review/analyzeHand.test.ts -t "EV 条形图的数据源"`
Expected: FAIL。报错应指向 `d.candidates` 为 `undefined`（`Cannot read properties of undefined (reading 'length')` 或 `expected undefined to be greater than 0`）。

若报的是别的错（比如 `makeRecord is not defined`），说明测试放错了位置，先修位置再继续。

- [ ] **Step 3: 写失败的测试（降级路径）**

在 `src/review/analyzeHand.degraded.test.ts` 的 `describe(...)` 内部末尾追加：

```ts
  // 新增的 candidates / heroEquity / actualLabel 三个字段是与 actualEv /
  // recommended 完全同类的风险面：它们都是用被替换过的对手范围算出来的，
  // 而字段名字面上都像是「可以直接渲染」的东西。requiredEquity 是唯一的
  // 例外并且是有意的 —— 它是 toCall/(pot+toCall) 的纯底池几何
  // （见 core/evEstimate.ts:207），与对手范围无关，降级时依然诚实。
  it('estimateEv 报告 degraded 时，candidates 清空、heroEquity 与 actualLabel 置 null，但 requiredEquity 保持有效', () => {
    const rec = makeRecord('an-degraded-1');
    const a = analyzeHand(rec, { iterations: 200, strengthIterations: 15 });
    expect(a.decisions.length).toBeGreaterThan(0);
    let sawToCall = 0;
    for (const d of a.decisions) {
      expect(d.degraded).toBe(true);
      expect(d.candidates).toEqual([]);
      expect(d.heroEquity).toBeNull();
      expect(d.actualLabel).toBeNull();
      if (chipsGreater(d.situation.toCall, 0)) {
        sawToCall++;
        expect(d.requiredEquity).not.toBeNull();
      }
    }
    // 至少有一个面对下注的决策点，否则 requiredEquity 那条断言没被执行过
    expect(sawToCall).toBeGreaterThan(0);
  });
```

同时在该文件顶部 import 区加：

```ts
import { chipsGreater } from '../core/chips';
```

- [ ] **Step 4: 跑它，确认失败**

Run: `npx.cmd vitest run src/review/analyzeHand.degraded.test.ts -t "requiredEquity 保持有效"`
Expected: FAIL，报 `expected undefined to deeply equal []`。

**若 `sawToCall` 那条断言红了**（即这份记录里没有任何面对下注的 hero 决策点），不要删断言、不要改成 `toBeGreaterThanOrEqual(0)` —— 停下来报告，并附上 `a.decisions.map(d => d.situation.toCall)` 的实际值。

- [ ] **Step 5: 改 `src/review/types.ts`**

在 `DecisionAnalysis` 接口里，紧跟现有 `recommended` 字段之后插入：

```ts
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
```

`EvCandidate` 类型已经在该文件第 3 行 import 了（`import type { EvCandidate } from '../core/evEstimate';`），不需要新增 import。

- [ ] **Step 6: 改 `src/review/analyzeHand.ts`**

在 `decisions.push({ ... })` 里，紧跟现有 `recommended: degraded ? null : ev.recommended,` 之后插入四行：

```ts
      // 以下四个字段是 ③-B 复盘卡片的数据出口。全部原样取自本次已经
      // 算好的 ev / actualCand，不新增任何计算 —— 多调一次 estimateEv
      // 会改变随机流，破坏「同一记录分析两次结果逐位相同」那条测试。
      // degraded 的置空规则与 actualEv / recommended 一致，唯一例外是
      // requiredEquity（纯底池几何，与对手范围无关，见 types.ts 注释）。
      candidates: degraded ? [] : ev.candidates,
      heroEquity: degraded ? null : ev.heroEquity,
      requiredEquity: ev.requiredEquity,
      actualLabel: degraded ? null : (actualCand ? actualCand.label : null),
```

- [ ] **Step 7: 跑两个测试文件，确认变绿**

Run: `npx.cmd vitest run src/review/analyzeHand.test.ts src/review/analyzeHand.degraded.test.ts`
Expected: PASS，两个文件合计 **11 passed**（原 9 条 = 7 + 2，加新增 2 条）。

- [ ] **Step 8: 变异验证 —— 证明降级守卫不是摆设**

把 `analyzeHand.ts` 里刚写的一行临时改成：

```ts
      candidates: ev.candidates,
```

Run: `npx.cmd vitest run src/review/analyzeHand.degraded.test.ts`
Expected: **FAIL**，报 `candidates` 不等于 `[]`。

这一步的改动**尚未提交**，所以 `git checkout` 会把 Step 6 的正确实现一起丢掉。正确的还原方式是手工改回来：

1. 把那一行改回 `candidates: degraded ? [] : ev.candidates,`
2. Run: `npx.cmd vitest run src/review/analyzeHand.degraded.test.ts` → 必须重新变绿
3. Run: `git diff src/review/analyzeHand.ts` → 逐字确认现在的 diff 只剩 Step 6 的四行新增，没有变异残留

把这次变异验证的真实红色输出摘录进任务报告 —— 没有它，「守卫有效」只是一句声明。

- [ ] **Step 9: 全量测试 + typecheck**

Run: `npm.cmd test`
Expected: **45 文件 / 633 通过 / 3 跳过**，exit 0。

Run: `npm.cmd run typecheck`
Expected: 无输出，exit 0。

数字不是 633 就停下来报告实际值。

- [ ] **Step 10: 提交**

```bash
git add src/review/types.ts src/review/analyzeHand.ts src/review/analyzeHand.test.ts src/review/analyzeHand.degraded.test.ts
git status --short
git commit -F - <<'EOF'
feat(review): DecisionAnalysis 导出候选列表、两个胜率与实际动作标签

EV 条形图要画全部候选，而这个接口此前只导出 recommended 一个；
规格点名的「用户胜率 / 所需胜率」在接口上根本没有字段。三样
estimateEv 都已算好，只是没往外传。

第四个字段 actualLabel 让条形图能高亮「你选的那一条」，而不必
在界面层重写 judge.ts 的 matchCandidate。

degraded 时 candidates 清空、heroEquity 与 actualLabel 置 null，
与 actualEv / recommended 同批。requiredEquity 是有意的例外——
它是 toCall/(pot+toCall) 的纯底池几何，与对手范围无关。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

# Task 2: reviewModel — 整体评级

`feat(ui): 复盘卡片的整体评级模型`

**Files:**
- Create: `src/ui/reviewModel.ts`
- Test: `src/ui/reviewModel.test.ts`

**Interfaces:**
- Consumes: Task 1 产出的 `DecisionAnalysis`；`HandAnalysis`（`src/review/types.ts`）；`severityOf` 与 `Severity`（`src/review/taxonomy.ts`）。
- Produces: `export type Grade`、`export interface GradeInfo`、`export function handGrade(a: HandAnalysis): GradeInfo`。Task 5 的 `ReviewSheet.tsx` 与 Task 6 的 `ReviewTrigger.tsx` 都要用。

## 为什么评级按 worstEvLoss 而不是 totalEvLoss

上游规格 §10.3 只写了「整体评级」，没定义算法。本计划定死：按 `worstEvLoss` 落进哪个 severity 档。理由是与规格 §9 历史页的排序字段保持一致 —— 一个 3 BB 的大错比十个 0.3 BB 的小偏差更该标红，而 `totalEvLoss` 会把后者累加到前者之上。

阈值不在 UI 里重写，直接调 `severityOf()`：`taxonomy.ts` 顶部的注释明确说了「调整判定松紧时只应该改这个文件」，UI 复制一份阈值就等于把这句话作废。

`unknown` 必须单列一档：不能让「算不出来」和「没打错」显示成同一个绿色 —— 那是用沉默冒充结论。

- [ ] **Step 1: 写失败的测试**

创建 `src/ui/reviewModel.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import type { HandAnalysis, DecisionAnalysis } from '../review/types';
import { handGrade } from './reviewModel';

/**
 * 造一个 DecisionAnalysis。这里刻意不跑真实的 analyzeHand ——
 * 本模块是纯数据变形，用合成输入才能精确控制每一档边界；
 * 真实分析路径由 src/review/analyzeHand.test.ts 覆盖。
 */
function decision(over: Partial<DecisionAnalysis> = {}): DecisionAnalysis {
  return {
    actionIndex: 0,
    street: 'preflop',
    // situation 在本任务的断言里用不到，给一个最小可用的壳
    situation: {
      heroSeat: 0,
      heroPosition: 'BTN',
      heroCards: [{ rank: 14, suit: 's' }, { rank: 13, suit: 's' }],
      board: [],
      street: 'preflop',
      pot: 1.5,
      toCall: 1,
      heroStack: 99,
      heroStreetContribution: 0,
      opponents: [],
      heroIsPreflopAggressor: false,
    },
    actual: {
      seat: 0,
      street: 'preflop',
      type: 'call',
      amount: 1,
      potBefore: 1.5,
      toCall: 1,
      stackBefore: 100,
    },
    actualEv: 0,
    recommended: null,
    evLoss: 0,
    severity: 'ok',
    tag: null,
    explanation: '',
    degraded: false,
    candidates: [],
    heroEquity: 0.5,
    requiredEquity: 0.4,
    actualLabel: null,
    ...over,
  } as DecisionAnalysis;
}

function analysis(decisions: DecisionAnalysis[]): HandAnalysis {
  return {
    recordId: 'r1',
    heroSeat: 0,
    schemaVersion: 1,
    decisions,
    totalEvLoss: decisions.reduce((s, d) => s + d.evLoss, 0),
    worstEvLoss: decisions.length === 0 ? 0 : Math.max(...decisions.map(d => d.evLoss)),
    tags: [],
  };
}

describe('handGrade', () => {
  it('没有决策点时是 unknown，而不是「没问题」', () => {
    const g = handGrade(analysis([]));
    expect(g.grade).toBe('unknown');
    expect(g.text).toBe('本手没有可判定的决策点');
  });

  it('全部决策点降级时也是 unknown —— 算不出来不等于打得对', () => {
    const g = handGrade(analysis([
      decision({ degraded: true }),
      decision({ actionIndex: 1, degraded: true }),
    ]));
    expect(g.grade).toBe('unknown');
  });

  it('有一个可判定的决策点且都没亏时是 clean', () => {
    const g = handGrade(analysis([
      decision({ degraded: true }),
      decision({ actionIndex: 1, evLoss: 0.1 }),
    ]));
    expect(g.grade).toBe('clean');
    expect(g.text).toBe('这手没问题');
  });

  it('按最大单点损失定档，不是按累加', () => {
    // 五个 0.5 BB 的小偏差累加是 2.5（若按 totalEvLoss 会判成 notable），
    // 但单点最大只有 0.5，仍是 minor
    const five = [0, 1, 2, 3, 4].map(i => decision({ actionIndex: i, evLoss: 0.5 }));
    expect(handGrade(analysis(five)).grade).toBe('minor');

    // 单点 1.0 恰好踩在 notable 的下界（taxonomy 的区间左闭右开）
    expect(handGrade(analysis([decision({ evLoss: 1 })])).grade).toBe('notable');
    // 单点 3.0 恰好踩在 severe 的下界
    expect(handGrade(analysis([decision({ evLoss: 3 })])).grade).toBe('severe');
  });
});
```

- [ ] **Step 2: 跑它，确认失败**

Run: `npx.cmd vitest run src/ui/reviewModel.test.ts`
Expected: FAIL，报 `Failed to resolve import "./reviewModel"`。

- [ ] **Step 3: 写实现**

创建 `src/ui/reviewModel.ts`：

```ts
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
```

- [ ] **Step 4: 跑它，确认通过**

Run: `npx.cmd vitest run src/ui/reviewModel.test.ts`
Expected: PASS，**4 passed**。

- [ ] **Step 5: 全量测试 + typecheck**

Run: `npm.cmd test`
Expected: **46 文件 / 637 通过 / 3 跳过**，exit 0。

Run: `npm.cmd run typecheck`
Expected: 无输出，exit 0。

- [ ] **Step 6: 提交**

```bash
git add src/ui/reviewModel.ts src/ui/reviewModel.test.ts
git status --short
git commit -F - <<'EOF'
feat(ui): 复盘卡片的整体评级模型

按 worstEvLoss 定档而不是 totalEvLoss——与历史页排序字段一致，
一个 3BB 大错比十个 0.3BB 小偏差更该标红。

阈值直接调 taxonomy 的 severityOf，不在 UI 里复制一份，否则
「调松紧只改 taxonomy.ts」这句话就作废了。

unknown 单列一档：算不出来不能和没打错显示成同一个颜色。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

# Task 3: reviewModel — 时间线分组、条形图归一化、弃牌座位

`feat(ui): 复盘卡片的时间线与条形图模型`

**Files:**
- Modify: `src/ui/reviewModel.ts`（追加，不改 Task 2 已有的导出）
- Modify: `src/ui/reviewModel.test.ts`（追加 describe 块）

**Interfaces:**
- Consumes: Task 1 的 `DecisionAnalysis.candidates` / `actualLabel`；`HandRecord`（`src/core/types.ts`，仅类型）。
- Produces:
  - `export interface TimelineRow { decision: DecisionAnalysis; index: number }`
  - `export interface StreetGroup { street: Street; label: string; rows: TimelineRow[] }`
  - `export function timelineOf(a: HandAnalysis): StreetGroup[]`
  - `export interface Bar { label: string; ev: number; widthPct: number; leftPct: number; isRecommended: boolean; isActual: boolean }`
  - `export interface BarChart { bars: Bar[]; zeroPct: number }`
  - `export function barsOf(d: DecisionAnalysis): BarChart`
  - `export function foldedSeatsOf(record: HandRecord): number[]`

  Task 4 的 `EvBars.tsx` 用 `BarChart`，`OpponentCards.tsx` 用 `foldedSeatsOf`；Task 5 的 `ReviewTimeline.tsx` 用 `StreetGroup`。

## 条形图的坐标约定

候选 EV 可以为负（`fold` 恒为 0，跟注可能为负）。轴取 `[min(0, ...evs), max(0, ...evs)]` —— 两端都把 0 括进来，保证零点基线永远在轴内、`fold` 那根永远画得出来。

- `zeroPct`：零点在轴上的位置，`(0 - lo) / span * 100`
- 正 EV 的条：从 `zeroPct` 向右伸，`widthPct = ev / span * 100`
- 负 EV 的条：左端在 `(ev - lo) / span * 100`，宽 `-ev / span * 100`，右端正好落在零点

`span === 0`（所有候选 EV 全为 0）时不做除法：所有条宽记 0，`zeroPct` 记 0。

- [ ] **Step 1: 写失败的测试**

在 `src/ui/reviewModel.test.ts` 顶部 import 区改为：

```ts
import type { HandAnalysis, DecisionAnalysis } from '../review/types';
import type { HandRecord } from '../core/types';
import type { EvCandidate } from '../core/evEstimate';
import { handGrade, timelineOf, barsOf, foldedSeatsOf } from './reviewModel';
```

在文件末尾追加：

```ts
function candidate(over: Partial<EvCandidate> = {}): EvCandidate {
  return {
    label: 'fold',
    actionType: 'fold',
    investment: 0,
    ev: 0,
    isRecommended: false,
    ...over,
  };
}

describe('timelineOf', () => {
  it('按街分组，只保留有决策点的街，街序固定为翻前→翻牌→转牌→河牌', () => {
    // 刻意乱序传入，验证输出不是照抄输入顺序
    const groups = timelineOf(analysis([
      decision({ actionIndex: 3, street: 'river' }),
      decision({ actionIndex: 0, street: 'preflop' }),
      decision({ actionIndex: 2, street: 'flop' }),
    ]));
    expect(groups.map(g => g.street)).toEqual(['preflop', 'flop', 'river']);
    expect(groups.map(g => g.label)).toEqual(['翻前', '翻牌', '河牌']);
  });

  it('组内按 actionIndex 升序，index 指回 decisions 里的原下标', () => {
    // decisions 数组里的顺序是 2、0、1，actionIndex 是 7、5、6
    const groups = timelineOf(analysis([
      decision({ actionIndex: 7, street: 'flop' }),
      decision({ actionIndex: 5, street: 'flop' }),
      decision({ actionIndex: 6, street: 'flop' }),
    ]));
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map(r => r.decision.actionIndex)).toEqual([5, 6, 7]);
    // index 必须是「在 a.decisions 里的下标」，不是排序后的名次 ——
    // 展开状态用它做 key，错了会展开错的那一行
    expect(groups[0].rows.map(r => r.index)).toEqual([1, 2, 0]);
  });
});

describe('barsOf', () => {
  it('全为非负 EV 时零点在最左，条从零点向右伸', () => {
    const chart = barsOf(decision({
      candidates: [
        candidate({ label: 'fold', ev: 0 }),
        candidate({ label: 'call', ev: 2, actionType: 'call', investment: 1 }),
        candidate({ label: 'bet 1/2', ev: 4, actionType: 'bet', investment: 3, isRecommended: true }),
      ],
      actualLabel: 'call',
    }));
    expect(chart.zeroPct).toBe(0);
    expect(chart.bars.map(b => b.leftPct)).toEqual([0, 0, 0]);
    expect(chart.bars.map(b => b.widthPct)).toEqual([0, 50, 100]);
    expect(chart.bars.map(b => b.isRecommended)).toEqual([false, false, true]);
    expect(chart.bars.map(b => b.isActual)).toEqual([false, true, false]);
  });

  it('出现负 EV 时零点内移，负条向左伸且右端落在零点', () => {
    const chart = barsOf(decision({
      candidates: [
        candidate({ label: 'fold', ev: 0 }),
        candidate({ label: 'call', ev: -2, actionType: 'call', investment: 2 }),
        candidate({ label: 'bet 1/2', ev: 2, actionType: 'bet', investment: 3, isRecommended: true }),
      ],
      actualLabel: 'fold',
    }));
    // 轴是 [-2, 2]，零点在正中
    expect(chart.zeroPct).toBe(50);
    const call = chart.bars.find(b => b.label === 'call')!;
    expect(call.leftPct).toBe(0);
    expect(call.widthPct).toBe(50);
    // 左端 + 宽度 = 零点，负条的右端必须正好贴住基线
    expect(call.leftPct + call.widthPct).toBe(chart.zeroPct);
  });

  it('候选全为零 EV 时不做除零', () => {
    const chart = barsOf(decision({
      candidates: [candidate({ label: 'fold', ev: 0 }), candidate({ label: 'check', ev: 0, actionType: 'check' })],
      actualLabel: 'check',
    }));
    expect(chart.zeroPct).toBe(0);
    for (const b of chart.bars) {
      expect(Number.isFinite(b.widthPct)).toBe(true);
      expect(b.widthPct).toBe(0);
    }
  });

  it('降级的决策点没有候选，返回空图', () => {
    const chart = barsOf(decision({ degraded: true, candidates: [], actualLabel: null }));
    expect(chart.bars).toEqual([]);
    expect(chart.zeroPct).toBe(0);
  });
});

describe('foldedSeatsOf', () => {
  it('列出弃过牌的座位，去重且不含未弃牌的人', () => {
    const rec = {
      actions: [
        { seat: 1, street: 'preflop', type: 'fold', amount: 0, toCall: 1, potBefore: 1.5 },
        { seat: 2, street: 'preflop', type: 'call', amount: 1, toCall: 1, potBefore: 1.5 },
        { seat: 4, street: 'flop', type: 'fold', amount: 0, toCall: 2, potBefore: 4 },
      ],
    } as unknown as HandRecord;
    expect(foldedSeatsOf(rec).sort((x, y) => x - y)).toEqual([1, 4]);
  });
});
```

- [ ] **Step 2: 跑它，确认失败**

Run: `npx.cmd vitest run src/ui/reviewModel.test.ts`
Expected: FAIL，报 `timelineOf is not a function`（或 import 解析失败）。Task 2 的 4 条应仍然通过。

- [ ] **Step 3: 写实现**

在 `src/ui/reviewModel.ts` 顶部把 import 区改为：

```ts
import type { HandAnalysis, DecisionAnalysis } from '../review/types';
import type { Severity } from '../review/taxonomy';
import { severityOf } from '../review/taxonomy';
import type { Street, HandRecord } from '../core/types';
```

在文件末尾追加：

```ts
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
```

> 注意：`c.ev < 0` 与 `span === 0` 都是**纯数值比较**，不是金额比较 —— EV 是期望值不是筹码额，`chips.ts` 的容差语义（`isZeroChips` 判的是「筹码意义上等于零」）在这里不适用，`barsOf` 只是把数字映射成像素百分比。这与 Global Constraints 里「金额比较用 chips.ts」不冲突，但值得在审查时确认一遍。

- [ ] **Step 4: 跑它，确认通过**

Run: `npx.cmd vitest run src/ui/reviewModel.test.ts`
Expected: PASS，**10 passed**（Task 2 的 4 条 + 本任务 6 条）。

- [ ] **Step 5: 全量测试 + typecheck**

Run: `npm.cmd test`
Expected: **46 文件 / 643 通过 / 3 跳过**，exit 0。

Run: `npm.cmd run typecheck`
Expected: 无输出，exit 0。

- [ ] **Step 6: 提交**

```bash
git add src/ui/reviewModel.ts src/ui/reviewModel.test.ts
git status --short
git commit -F - <<'EOF'
feat(ui): 复盘卡片的时间线与条形图模型

时间线的 index 指回 decisions 原下标而不是排序名次——展开状态
用它做 key，用名次会在组内重排后展开错的那一行。

条形图的轴两端都把 0 括进来，零点基线永远在轴内、EV 恰为 0 的
fold 永远画得出来；负条向左伸、右端贴住基线；轴长为 0 时不做除法。

弃牌座位从动作序列取——HandResult 没有 folded 字段，动作序列
才是「谁弃了牌」的权威来源。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

# Task 4: 叶子组件 —— EV 条形图与对手底牌

`feat(ui): 复盘卡片的条形图与对手底牌组件`

**Files:**
- Create: `src/ui/components/EvBars.tsx`
- Create: `src/ui/components/OpponentCards.tsx`
- Modify: `src/ui/styles/app.css`（在文件末尾追加「③-B 复盘卡片」一节，并在 `:root` 令牌区追加四个 severity 令牌）

**Interfaces:**
- Consumes: Task 3 的 `BarChart`、`foldedSeatsOf`；既有的 `CardView`（`src/ui/components/Card.tsx`）。
- Produces: `export function EvBars({ chart }: { chart: BarChart })`、`export function OpponentCards({ record }: { record: HandRecord })`。Task 5 使用。

## 无组件测试的说明

本项目**没有装 testing-library，没有组件渲染测试的基础设施**，本期也不引入（会动 package.json，违反 Global Constraints）。所以这两个组件必须保持极薄：所有计算已经在 Task 3 的 `reviewModel.ts` 里测过，组件只把结果摆到 DOM 上。**组件里不得出现任何算术**（百分比、排序、分组一律来自模型）。

- [ ] **Step 1: 写 `EvBars.tsx`**

```tsx
import type { BarChart } from '../reviewModel';

/**
 * EV 条形图。纯 CSS 宽度百分比手画，不引图表库。
 *
 * 组件里没有任何算术 —— 位置与宽度全部由 reviewModel.barsOf 算好并测过。
 * 数字单位是 BB，不换算实额（见 format.ts 顶部关于复盘数字保持 BB 的注释）。
 */
export function EvBars({ chart }: { chart: BarChart }) {
  if (chart.bars.length === 0) return null;
  return (
    <div className="ev-bars">
      {/* 零点基线：负 EV 的条向左伸、右端贴住它 */}
      <div className="ev-zero" style={{ left: `${chart.zeroPct}%` }} aria-hidden="true" />
      {chart.bars.map(b => (
        <div className="ev-row" key={b.label}>
          <span className="ev-label">{b.label}</span>
          <span className="ev-track">
            <span
              className={
                'ev-fill' +
                (b.isRecommended ? ' ev-rec' : '') +
                (b.isActual ? ' ev-actual' : '')
              }
              style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }}
            />
          </span>
          <span className="ev-value">
            {b.ev.toFixed(2)} BB
            {b.isActual ? <span className="ev-mark">你选的</span> : null}
            {b.isRecommended ? <span className="ev-mark ev-mark-rec">推荐</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 写 `OpponentCards.tsx`**

```tsx
import type { HandRecord } from '../../core/types';
import { foldedSeatsOf } from '../reviewModel';
import { CardView } from './Card';

/**
 * 对手底牌。对局中永远看不到，只有复盘才给 —— 标注写死在这里。
 *
 * 弃牌的座位灰显并标注：牌本身仍然显示（复盘要看的正是「他拿这手牌
 * 为什么弃」），只是视觉上退后一层。
 */
export function OpponentCards({ record }: { record: HandRecord }) {
  const folded = new Set(foldedSeatsOf(record));
  const others = record.seats.filter(s => s.seat !== record.heroSeat);
  return (
    <div className="opp-cards">
      <div className="opp-cards-title">对手底牌（仅复盘可见）</div>
      {others.map(s => (
        <div className={folded.has(s.seat) ? 'opp-row opp-folded' : 'opp-row'} key={s.seat}>
          <span className="opp-pos">{s.position}</span>
          <span className="opp-hand">
            <CardView card={s.holeCards[0]} size="sm" />
            <CardView card={s.holeCards[1]} size="sm" />
          </span>
          {folded.has(s.seat) ? <span className="opp-note">已弃牌</span> : null}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 加 CSS 令牌**

在 `src/ui/styles/app.css` 的 `:root` 块里，`--positive: #7fd18a;` 那一行之后追加：

```css
  /* ③-B 复盘：四档严重度 + 一档「算不出来」。
     ok 刻意是中性色而不是绿色勾——「没问题」不需要庆祝；
     degraded 用灰，必须与 ok 明确区分，否则「算不出来」会被读成「没打错」。
     颜色不是唯一编码，每一档同时带文字标签（见 reviewModel 的 GradeInfo.text）。 */
  --sev-ok: #7d938c;
  --sev-minor: #d8b445;
  --sev-notable: #d98a3f;
  --sev-severe: #c4553f;
  --sev-unknown: #4a545c;
```

- [ ] **Step 4: 加组件样式**

在 `src/ui/styles/app.css` 文件末尾追加：

```css
/* ───────── ③-B 复盘卡片：EV 条形图 ───────── */

.ev-bars {
  position: relative;
  margin: 8px 0;
}

/* 零点基线。父容器 .ev-bars 是 relative，这条竖线按百分比定位在轴上，
   与 .ev-track 的左右边界对齐——所以 .ev-track 必须占满 .ev-row 里
   标签与数值之外的全部宽度，见下面 grid 的 1fr。 */
.ev-zero {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--line);
}

.ev-row {
  display: grid;
  grid-template-columns: 68px 1fr 104px;
  align-items: center;
  gap: 8px;
  height: 22px;
}

.ev-label {
  font-size: 12px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ev-track {
  position: relative;
  height: 10px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.04);
}

.ev-fill {
  position: absolute;
  top: 0;
  height: 10px;
  border-radius: 2px;
  background: var(--sev-unknown);
}

.ev-fill.ev-rec {
  background: var(--positive);
}

/* 用户选的那一条用描边而不是换底色：它可能同时是推荐动作，
   两种标记必须能叠加显示 */
.ev-fill.ev-actual {
  outline: 1px solid var(--gold);
  outline-offset: 1px;
}

.ev-value {
  font-size: 11px;
  color: var(--text-dim);
  text-align: right;
  white-space: nowrap;
}

.ev-mark {
  margin-left: 4px;
  padding: 0 3px;
  border-radius: 2px;
  font-size: 10px;
  color: var(--gold);
  border: 1px solid var(--gold);
}

.ev-mark-rec {
  color: var(--positive);
  border-color: var(--positive);
}

/* ───────── ③-B 复盘卡片：对手底牌 ───────── */

.opp-cards {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.opp-cards-title {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 6px;
}

.opp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}

.opp-pos {
  font-size: 11px;
  color: var(--text-dim);
  width: 36px;
}

.opp-hand {
  display: flex;
  gap: 3px;
}

.opp-folded {
  opacity: 0.45;
}

.opp-note {
  font-size: 11px;
  color: var(--text-dim);
}
```

- [ ] **Step 5: typecheck**

Run: `npm.cmd run typecheck`
Expected: 无输出，exit 0。

这两个组件目前还没有任何地方 import，typecheck 是本步唯一的验证手段 —— 它能抓住 props 类型错、CardView 用法错、`BarChart` 字段名拼错。

- [ ] **Step 6: 全量测试**

Run: `npm.cmd test`
Expected: **46 文件 / 643 通过 / 3 跳过**，exit 0 —— 与 Task 3 完全一致。

本任务不新增测试。**若数字变了，停下来报告** —— 新增两个 `.tsx` 文件不应该影响任何既有测试，唯一会被触动的是 `src/session/architecture.test.ts` 里扫描 `src/ui` 的那两条守卫（它们会把新文件纳入扫描），数字变化意味着新文件违反了分层约束。

- [ ] **Step 7: 提交**

```bash
git add src/ui/components/EvBars.tsx src/ui/components/OpponentCards.tsx src/ui/styles/app.css
git status --short
git commit -F - <<'EOF'
feat(ui): 复盘卡片的条形图与对手底牌组件

条形图纯 CSS 宽度百分比手画，不引图表库；组件里没有任何算术，
位置与宽度全部来自 reviewModel.barsOf（已单测）。项目没有组件
渲染测试基础设施，组件只能靠薄来保证正确。

「你选的」用描边而不是换底色——它可能同时就是推荐动作，两种
标记必须叠得起来。

新增五个 severity 令牌。ok 是中性色不是绿勾，degraded 用灰且
必须与 ok 区分，否则「算不出来」会被读成「没打错」。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

# Task 5: 决策详情、时间线与卡片壳

`feat(ui): 复盘卡片的时间线与决策详情`

**Files:**
- Create: `src/ui/components/ReviewDecision.tsx`
- Create: `src/ui/components/ReviewTimeline.tsx`
- Create: `src/ui/components/ReviewSheet.tsx`
- Modify: `src/ui/styles/app.css`（末尾追加）

**Interfaces:**
- Consumes: Task 2 的 `handGrade` / `GradeInfo`；Task 3 的 `timelineOf` / `StreetGroup` / `barsOf`；Task 4 的 `EvBars` / `OpponentCards`。
- Produces: `export function ReviewSheet({ analysis, record, onNext, onClose }: {...})`。Task 6 的 `App.tsx` 使用。

## degraded 分支是本任务的核心

`ReviewDecision` 必须先判 `d.degraded`，且在该分支里**一个 EV 数字、一根条形图、一个推荐动作、一个 tag 都不能渲染**。只允许显示底池、待跟注、所需胜率（纯底池几何）与那句「无法判定」。

写这个分支时不要靠「反正 degraded 时那些字段是 null，渲染出来也是空」—— 那是把正确性寄托在上游的置空上。显式的 `if` 分支才是防线。

- [ ] **Step 1: 写 `ReviewDecision.tsx`**

```tsx
import type { DecisionAnalysis } from '../../review/types';
import { chipsGreater } from '../../core/chips';
import { barsOf } from '../reviewModel';
import { EvBars } from './EvBars';

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** 一行「名称 值」 */
function Stat({ name, value }: { name: string; value: string }) {
  return (
    <div className="rv-stat">
      <span className="rv-stat-name">{name}</span>
      <span className="rv-stat-value">{value}</span>
    </div>
  );
}

/**
 * 单个决策点展开后的详情。
 *
 * degraded 分支是显式的 if，而不是靠「反正那些字段是 null，渲染出来是空」——
 * 把正确性寄托在上游置空上，等于让 review/types.ts 的注释成为唯一的防线。
 * 降级时只允许出现底池、待跟注、所需胜率（纯底池几何，与对手范围无关）。
 */
export function ReviewDecision({ d }: { d: DecisionAnalysis }) {
  const s = d.situation;
  return (
    <div className="rv-detail">
      <div className="rv-stats">
        <Stat name="底池" value={`${s.pot.toFixed(1)} BB`} />
        <Stat name="待跟注" value={`${s.toCall.toFixed(1)} BB`} />
        {d.requiredEquity !== null ? (
          <Stat name="所需胜率" value={pct(d.requiredEquity)} />
        ) : null}
        {!d.degraded && d.heroEquity !== null ? (
          <Stat name="你的胜率" value={pct(d.heroEquity)} />
        ) : null}
      </div>

      {d.degraded ? (
        <p className="rv-text rv-degraded">{d.explanation}</p>
      ) : (
        <>
          <EvBars chart={barsOf(d)} />
          {d.recommended !== null ? (
            <div className="rv-rec">
              推荐：{d.recommended.label}
              {/* evLoss 是 BB 金额，用 chipsGreater 而不是裸 >（见 Global Constraints） */}
              {chipsGreater(d.evLoss, 0) ? `　损失 ${d.evLoss.toFixed(2)} BB` : ''}
            </div>
          ) : null}
          {d.tag !== null ? <div className="rv-tag">{d.tag}</div> : null}
          <p className="rv-text">{d.explanation}</p>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 写 `ReviewTimeline.tsx`**

```tsx
import { useState } from 'react';
import { chipsGreater } from '../../core/chips';
import type { StreetGroup } from '../reviewModel';
import { ReviewDecision } from './ReviewDecision';

/** severity → CSS 类名后缀。degraded 单独一档，不复用 ok */
function dotClass(degraded: boolean, severity: string): string {
  return `rv-dot rv-dot-${degraded ? 'unknown' : severity}`;
}

/** severity → 文字标签。颜色不是唯一编码 */
function dotText(degraded: boolean, severity: string): string {
  if (degraded) return '无法判定';
  if (severity === 'minor') return '小偏差';
  if (severity === 'notable') return '明显失误';
  if (severity === 'severe') return '重大失误';
  return '没问题';
}

/**
 * 街道时间线。展开状态用 TimelineRow.index（决策点在 decisions 里的
 * 原下标）做 key，不是行的名次 —— 见 reviewModel.timelineOf 的注释。
 */
export function ReviewTimeline({ groups }: { groups: StreetGroup[] }) {
  const [open, setOpen] = useState<number | null>(null);

  if (groups.length === 0) {
    return <p className="rv-empty">本手没有可判定的决策点。</p>;
  }

  return (
    <div className="rv-timeline">
      {groups.map(g => (
        <section className="rv-street" key={g.street}>
          <h3 className="rv-street-name">{g.label}</h3>
          {g.rows.map(({ decision: d, index }) => (
            <div className="rv-item" key={index}>
              <button
                className="rv-row"
                aria-expanded={open === index}
                onClick={() => setOpen(open === index ? null : index)}
              >
                <span className={dotClass(d.degraded, d.severity)} aria-hidden="true" />
                <span className="rv-act">
                  {d.actual.type}
                  {chipsGreater(d.actual.amount, 0) ? ` ${d.actual.amount.toFixed(1)} BB` : ''}
                </span>
                <span className="rv-sev">{dotText(d.degraded, d.severity)}</span>
              </button>
              {open === index ? <ReviewDecision d={d} /> : null}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 写 `ReviewSheet.tsx`**

```tsx
import type { HandRecord } from '../../core/types';
import type { HandAnalysis } from '../../review/types';
import { handGrade, timelineOf } from '../reviewModel';
import { ReviewTimeline } from './ReviewTimeline';
import { OpponentCards } from './OpponentCards';
import { chipsGreater } from '../../core/chips';
import { chips } from '../format';

/**
 * 复盘卡片。覆盖牌桌，用户主动打开。
 *
 * 顶部净盈亏用实额（那是「这手赢了多少钱」，与牌桌上的筹码同一量纲），
 * 卡片内部所有 EV / 底池 / 损失一律 BB —— 见 format.ts 顶部的注释：
 * 「你这一步亏了 2.3BB」比「亏了 92」有意义得多，且跨盲注级别可比。
 */
export function ReviewSheet({
  analysis,
  record,
  netBB,
  onNext,
  onClose,
}: {
  analysis: HandAnalysis;
  record: HandRecord;
  /** 本手 hero 净盈亏，BB */
  netBB: number;
  onNext: () => void;
  onClose: () => void;
}) {
  const grade = handGrade(analysis);
  // 与 SummaryBar.tsx 同款判据：金额比较走 chips.ts，不用裸 <
  const isNeg = chipsGreater(0, netBB);

  return (
    <div className="rv-sheet" role="dialog" aria-label="本手复盘">
      <header className="rv-head">
        <div className="rv-head-left">
          <span className={isNeg ? 'neg' : 'pos'}>
            本手 {isNeg ? '' : '+'}
            {chips(netBB)}
          </span>
          <span className={`rv-grade rv-grade-${grade.grade}`}>{grade.text}</span>
        </div>
        <button className="rv-close" onClick={onClose} aria-label="关闭复盘">
          ✕
        </button>
      </header>

      <div className="rv-body">
        <ReviewTimeline groups={timelineOf(analysis)} />
        <OpponentCards record={record} />
      </div>

      <footer className="rv-foot">
        <button className="btn btn-primary" onClick={onNext}>
          下一手
        </button>
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: 加 CSS**

在 `src/ui/styles/app.css` 末尾追加：

```css
/* ───────── ③-B 复盘卡片：壳与时间线 ───────── */

/* 覆盖式卡片。用 absolute 而不是 fixed：桌面端 .app 是限宽 1040×760 的
   居中容器（见 ③-A 的 Task 3），卡片必须贴着它而不是贴着视口。
   .app 已有 position: relative 时这条才成立——若没有，需要一并补上。 */
.rv-sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  top: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border-top: 1px solid var(--line);
}

.rv-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px calc(10px);
  border-bottom: 1px solid var(--line);
}

.rv-head-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.rv-grade {
  font-size: 13px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--sev-ok);
  color: var(--sev-ok);
}

.rv-grade-clean { border-color: var(--sev-ok); color: var(--sev-ok); }
.rv-grade-minor { border-color: var(--sev-minor); color: var(--sev-minor); }
.rv-grade-notable { border-color: var(--sev-notable); color: var(--sev-notable); }
.rv-grade-severe { border-color: var(--sev-severe); color: var(--sev-severe); }
.rv-grade-unknown { border-color: var(--sev-unknown); color: var(--sev-unknown); }

.rv-close {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
}

.rv-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
}

.rv-foot {
  padding: 10px 12px calc(10px + var(--safe-bottom));
  border-top: 1px solid var(--line);
}

.rv-foot .btn {
  width: 100%;
}

.rv-empty {
  color: var(--text-dim);
  font-size: 13px;
}

.rv-street-name {
  font-size: 12px;
  color: var(--text-dim);
  margin: 10px 0 4px;
  font-weight: 400;
}

.rv-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}

.rv-item + .rv-item {
  margin-top: 4px;
}

.rv-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  background: var(--sev-ok);
}

.rv-dot-minor { background: var(--sev-minor); }
.rv-dot-notable { background: var(--sev-notable); }
.rv-dot-severe { background: var(--sev-severe); }
.rv-dot-unknown { background: var(--sev-unknown); }

.rv-act {
  flex: 1;
}

.rv-sev {
  font-size: 11px;
  color: var(--text-dim);
}

.rv-detail {
  padding: 8px 10px 10px;
  border: 1px solid var(--line);
  border-top: none;
  border-radius: 0 0 4px 4px;
  background: rgba(255, 255, 255, 0.02);
}

.rv-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-bottom: 8px;
}

.rv-stat-name {
  font-size: 11px;
  color: var(--text-dim);
  margin-right: 4px;
}

.rv-stat-value {
  font-size: 12px;
}

.rv-rec {
  font-size: 12px;
  color: var(--positive);
  margin-top: 4px;
}

.rv-tag {
  display: inline-block;
  margin-top: 4px;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--line);
  font-size: 11px;
  color: var(--text-dim);
}

.rv-text {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text);
  margin: 6px 0 0;
}

.rv-degraded {
  color: var(--text-dim);
}
```

- [ ] **Step 5: 确认 `.app` 是定位祖先**

`.rv-sheet` 用 `position: absolute` 贴住 `.app`，这要求 `.app` 自身有 `position: relative`。

Run: `npx.cmd rg -n "^\.app\b" -A 12 src/ui/styles/app.css`

若 `.app` 规则里没有 `position`，在其中加一行 `position: relative;`（不要动它已有的限宽/限高属性 —— 那是 ③-A 浏览器验收定下来的 1040×760）。若已有 `position: relative`，不要重复添加。

**不要改 `.bottom`。** 它必须保持非 `position: fixed`（③-A 的历史回归项）。

- [ ] **Step 6: typecheck**

Run: `npm.cmd run typecheck`
Expected: 无输出，exit 0。

- [ ] **Step 7: 全量测试**

Run: `npm.cmd test`
Expected: **46 文件 / 643 通过 / 3 跳过**，exit 0，与 Task 4 一致。

- [ ] **Step 8: 提交**

```bash
git add src/ui/components/ReviewDecision.tsx src/ui/components/ReviewTimeline.tsx src/ui/components/ReviewSheet.tsx src/ui/styles/app.css
git status --short
git commit -F - <<'EOF'
feat(ui): 复盘卡片的时间线与决策详情

degraded 用显式 if 分支隔离，而不是靠「那些字段反正是 null，
渲染出来是空」——把正确性寄托在上游置空上，等于让 types.ts 的
注释成为唯一防线。降级时只显示底池、待跟注、所需胜率，后者是
纯底池几何，与对手范围无关。

展开状态用决策点在 decisions 里的原下标做 key，不是行名次。

卡片用 absolute 贴 .app 而不是 fixed 贴视口——桌面端 .app 是
限宽 1040×760 的居中容器。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

# Task 6: App 接线 —— 分析时机、缓存、卡片开关

`feat(ui): 手牌结束后可打开复盘卡片`

**Files:**
- Create: `src/ui/components/ReviewTrigger.tsx`
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/styles/app.css`（末尾追加触发按钮样式）

**Interfaces:**
- Consumes: Task 2 的 `handGrade`；Task 5 的 `ReviewSheet`；`analyzeHand`（`src/review/analyzeHand.ts`）。
- Produces: 无下游任务依赖。

## 三条必须做对的事

**1. 不能串手。** 分析结果必须与 `record.id` 绑定存放。只要屏幕上的 `record.id` 与存下来的不一致，就当作「还没算好」，绝不能把上一手的分析显示在这一手上。这是人工验收清单第 10 条。

**2. 不能卡住结算动画。** `analyzeHand` 每手约 25–200 ms，而手牌结束那一帧正在放 ③-A 的赢池脉冲。用 `setTimeout(…, 0)` 让出这一帧再算。

**3. 按钮常驻但先禁用。** 分析没回来时按钮可见且 `disabled`，不带色点；分析到达后启用、色点出现。**不要**用「先不渲染、算完再冒出来」—— 那会让结算区在结算后跳一下。

## 为什么触发按钮是独立组件而不是塞进 SummaryBar

hero 破产那一手，底部显示的是 `RebuyPrompt` 而不是 `SummaryBar`（见 `App.tsx` 的 `BottomSlot`），而那恰恰是最该复盘的一手。做成独立组件、在两个 handOver 分支里都渲染，同时 ③-A 已验收过的 `SummaryBar` 布局一行不动。

- [ ] **Step 1: 写 `ReviewTrigger.tsx`**

```tsx
import type { Grade } from '../reviewModel';

/**
 * 结算区的「复盘」按钮。
 *
 * grade 为 null 表示分析还没算完 —— 按钮可见但禁用，不带色点。
 * 按钮常驻是有意的：若改成「算完才渲染」，结算区会在结算后跳一下。
 *
 * 色点让「这手有没有打错」不点开就能看到；文字标签同时给出，
 * 颜色不是唯一编码。
 */
export function ReviewTrigger({ grade, onOpen }: { grade: Grade | null; onOpen: () => void }) {
  return (
    <button
      className="rv-trigger"
      onClick={onOpen}
      disabled={grade === null}
      aria-label="打开本手复盘"
    >
      <span className={`rv-dot rv-dot-${grade ?? 'unknown'}`} aria-hidden="true" />
      复盘
    </button>
  );
}
```

> `rv-dot-clean` 在 Task 4/5 的 CSS 里没有单独规则，会落到 `.rv-dot` 的默认底色 `--sev-ok`，这是对的 —— clean 就该是中性色。

- [ ] **Step 2: 改 `App.tsx` —— import 与状态**

在 import 区追加（放在既有 `./components/RebuyPrompt` 之后）：

```tsx
import { analyzeHand } from '../review/analyzeHand';
import type { HandAnalysis } from '../review/types';
import { handGrade } from './reviewModel';
import { ReviewSheet } from './components/ReviewSheet';
import { ReviewTrigger } from './components/ReviewTrigger';
```

在 `App()` 内部、`const [muted, setMutedState] = useState(isMuted);` 之后加：

```tsx
  // 复盘分析与它属于哪一手绑在一起。只要 recordId 与屏幕上这一手对不上，
  // 就当作「还没算好」—— 这是「连打十手不串手」那条验收的唯一防线。
  // analysis 为 null 表示这一手分析失败（见下面的 catch）。
  const [review, setReview] = useState<{ recordId: string; analysis: HandAnalysis | null } | null>(
    null,
  );
  const [sheetOpen, setSheetOpen] = useState(false);
```

- [ ] **Step 3: 改 `App.tsx` —— 分析 effect**

在既有的「hero 赢下底池」effect（`useEffect(() => { if (heroWon) playSound('pot-win'); }, [heroWon]);`）之后追加：

```tsx
  // 手牌结束后算复盘。analyzeHand 每手约 25–200ms，够快，不需要 Worker，
  // 但仍会占住主线程 —— 用 setTimeout 让出当前这一帧，先把 ③-A 的赢池
  // 脉冲放完再算。
  //
  // 依赖只放 record?.id：record 对象每手都是新引用，放它本身会多跑一遍；
  // 而 id 变了才真的是换了一手。
  const recordId = state.record?.id ?? null;
  useEffect(() => {
    const rec = state.record;
    if (rec === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      try {
        const analysis = analyzeHand(rec);
        if (!cancelled) setReview({ recordId: rec.id, analysis });
      } catch {
        // 复盘算不出来不该掀掉牌桌 —— 记成「这一手分析失败」，牌局继续。
        if (!cancelled) setReview({ recordId: rec.id, analysis: null });
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [recordId]);

  // 新一手开始就关掉卡片
  useEffect(() => {
    setSheetOpen(false);
  }, [state.handIndex]);
```

- [ ] **Step 4: 改 `App.tsx` —— 派生值与渲染**

在 `const onRebuy = useCallback(...)` 之后追加：

```tsx
  // 只认属于当前这一手的分析
  const currentReview = review !== null && review.recordId === recordId ? review : null;
  const currentAnalysis = currentReview?.analysis ?? null;
  const grade = currentAnalysis === null ? null : handGrade(currentAnalysis).grade;

  const onOpenSheet = useCallback(() => setSheetOpen(true), []);
  const onCloseSheet = useCallback(() => setSheetOpen(false), []);
  const onNextFromSheet = useCallback(() => {
    setSheetOpen(false);
    dispatch({ kind: 'nextHand' });
  }, []);
```

把 `App()` 的 `return (...)` 改成（只加一个 `grade` / `onOpenSheet` 透传和卡片本身，其余原样）：

```tsx
  return (
    <div className="app">
      <TopBar
        handsPlayed={state.ledger.handsPlayed}
        inProgress={state.phase !== 'handOver'}
        netBB={netBB}
        totalBuyIn={state.ledger.totalBuyIn}
        deepStack={isDeepStackHand(state)}
        muted={muted}
        onToggleMute={onToggleMute}
      />
      <Table
        game={state.game}
        lastAction={state.lastAction}
        revealed={revealed}
        heroWon={heroWon}
      />
      <HeroHand seat={hero} isButton={state.game.buttonSeat === HERO_SEAT} />
      <BottomSlot
        state={state}
        onHero={onHero}
        onNext={onNext}
        onRebuy={onRebuy}
        grade={grade}
        onOpenReview={onOpenSheet}
      />
      {sheetOpen && currentAnalysis !== null && state.record !== null ? (
        <ReviewSheet
          analysis={currentAnalysis}
          record={state.record}
          netBB={state.record.results.find(r => r.seat === HERO_SEAT)?.netBB ?? 0}
          onNext={onNextFromSheet}
          onClose={onCloseSheet}
        />
      ) : null}
    </div>
  );
```

- [ ] **Step 5: 改 `App.tsx` —— `BottomSlot`**

把 `BottomSlot` 的签名与 handOver 分支改为：

```tsx
/** 底部区域：动作条、结算条、补码选择三态互斥 */
function BottomSlot({
  state,
  onHero,
  onNext,
  onRebuy,
  grade,
  onOpenReview,
}: {
  state: HandSessionState;
  onHero: (input: ActionInput) => void;
  onNext: () => void;
  onRebuy: (targetStack: number) => void;
  grade: Grade | null;
  onOpenReview: () => void;
}) {
  if (state.phase === 'handOver') {
    // 复盘按钮在两个结算形态下都要在 —— hero 破产那一手底部显示的是
    // RebuyPrompt，而那恰恰是最该复盘的一手。
    const trigger = <ReviewTrigger grade={grade} onOpen={onOpenReview} />;

    if (heroNeedsRebuy(state)) {
      return (
        <div className="bottom">
          {trigger}
          <RebuyPrompt
            options={REBUY_OPTIONS}
            buyInCount={state.ledger.buyIns.length}
            totalBuyIn={state.ledger.totalBuyIn}
            onRebuy={onRebuy}
          />
        </div>
      );
    }
    const netBB = state.record?.results.find(r => r.seat === HERO_SEAT)?.netBB ?? 0;
    const showdown = state.record?.results.some(r => r.showdown) ?? false;
    return (
      <div className="bottom">
        {trigger}
        <SummaryBar netBB={netBB} showdown={showdown} onNext={onNext} />
      </div>
    );
  }

  const model = actionBarModel(state.game);
  return (
    <div className="bottom">
      <ActionBar model={model} onAction={onHero} />
    </div>
  );
}
```

`Grade` 类型要在 import 区加上：

```tsx
import type { Grade } from './reviewModel';
```

- [ ] **Step 6: 加 CSS**

在 `src/ui/styles/app.css` 末尾追加：

```css
.rv-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 auto 6px;
  padding: 4px 12px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.rv-trigger:disabled {
  opacity: 0.5;
  cursor: default;
}
```

- [ ] **Step 7: typecheck**

Run: `npm.cmd run typecheck`
Expected: 无输出，exit 0。

- [ ] **Step 8: 全量测试**

Run: `npm.cmd test`
Expected: **46 文件 / 643 通过 / 3 跳过**，exit 0。

特别留意 `src/session/architecture.test.ts` 的「src/ui/ 不从引擎与 AI 取值」那条 —— `App.tsx` 新增的 `import { analyzeHand } from '../review/analyzeHand'` 是值导入，但 `review/analyzeHand` **不在** banned 列表（`core/gameEngine`、`ai/decide`、`ai/selfPlayAi`）里，应当照常通过。**若这条红了，停下来报告，不要修改守卫。**

- [ ] **Step 9: 构建**

Run: `npm.cmd run build`
Expected: 成功，产物写入 `dist/`。

- [ ] **Step 10: 提交**

```bash
git add src/ui/App.tsx src/ui/components/ReviewTrigger.tsx src/ui/styles/app.css
git status --short
git commit -F - <<'EOF'
feat(ui): 手牌结束后可打开复盘卡片

分析结果与 record.id 绑定存放，id 对不上就当没算好——这是
「连打十手不串手」的唯一防线。

用 setTimeout 让出手牌结束那一帧再算，先把赢池脉冲放完；
analyzeHand 每手 25–200ms，够快，不需要 Worker。

按钮常驻但先禁用，分析到达后启用并出现色点。不用「算完才
渲染」，那会让结算区在结算后跳一下。

触发按钮做成独立组件而不是塞进 SummaryBar：hero 破产那一手
底部是 RebuyPrompt，而那恰恰最该复盘。

analyzeHand 抛错不掀牌桌，记成「这一手分析失败」，牌局继续。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

# Task 7: README

`docs: README 更新到复盘卡片完成状态`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 自己跑一遍数字**

Run: `npm.cmd test`
记下实际输出的文件数 / 通过数 / 跳过数与耗时。

**只写你自己跑出来的数字。** 若与本计划预测的 46 / 643 / 3 不符，以实跑为准并在任务报告里说明差异 —— 不要照抄计划里的预测数。

- [ ] **Step 2: 改状态表**

把 README「当前状态」表里 `③-B 复盘卡片` 那一行的状态从「未开始」改为「✅ 完成」，并把该行的内容列改为：`街道时间线 · EV 条形图 · 解释文案`（保持与实际做出来的东西一致；「我不认同」按钮没做，不要写进去）。

同时更新表格上方那句总结，把复盘卡片纳入已完成范围。

- [ ] **Step 3: 更新测试数字**

README 里两处提到测试数（「当前状态」段末与「快速开始」的 `npm test` 注释），改成 Step 1 实跑的数字。

- [ ] **Step 4: 补「已知边界」**

在 README 既有的「已知边界」一节追加三条：

```markdown
- **复盘结论只活在本次会话里。** 刷新即丢 —— 持久化与历史页是 ③-C。
- **「我不认同这个判定」没做。** 它的唯一用途是在历史页把有争议的手牌筛出来改进规则，而历史页在 ③-C；现在做只是个点了没有去处的按钮。
- **复盘卡片需要手动打开，不会自动弹。** 控制自动弹出的设置开关在 ③-D，本期若强制每手弹出，用户没有地方能关掉它。结算区按钮上的色点已经把「这手有没有打错」前置了。
```

- [ ] **Step 5: 更新目录结构**

README 的目录结构段里，`src/ui/` 一节补上本期新增的文件：

```
  reviewModel.ts          复盘卡片的纯数据变形（评级 · 时间线 · 条形图归一化）
  components/
    ReviewSheet.tsx       复盘卡片壳
    ReviewTimeline.tsx    街道时间线
    ReviewDecision.tsx    单个决策点详情
    EvBars.tsx            EV 条形图
    OpponentCards.tsx     对手底牌
    ReviewTrigger.tsx     结算区的复盘按钮
```

（按 README 既有的缩进与注释风格排版；若既有的 `src/ui/` 段没有逐个列组件，就按它的实际粒度写，不要单方面改变该段的详略。）

- [ ] **Step 6: 提交**

```bash
git add README.md
git status --short
git commit -F - <<'EOF'
docs: README 更新到复盘卡片完成状态

数字为本机实跑。新增三条已知边界：复盘只活在本次会话、
「我不认同」未做、卡片需手动打开——三条都指向 ③-C/③-D。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## 全部完成后

1. 整支代码审查（diff 范围 `404b33e..HEAD`）
2. 控制方浏览器验收，走规格 §8 的 12 条人工清单
3. `superpowers:finishing-a-development-branch`

**浏览器验收里必须真正做到的两件事**（不要只看截图说「看起来对」）：

- **连打 10 手，每手打开一次复盘**，确认时间线里的动作与刚打完那一手一致。串手是本期最容易出的缺陷，而它在单测里看不见。
- **找到一个 degraded 的决策点**（对手范围塌缩时触发，多对手局面更容易出现），确认那一行显示「无法判定」且展开后**没有任何 EV 数字、条形图、推荐动作或 tag**。若十手里一个都没遇到，如实记为「未验证」，不要写成通过 —— ③-A 那轮就是这么把「轻/重筹码声」如实标成未验证的，而它后来确实是个真缺陷。
