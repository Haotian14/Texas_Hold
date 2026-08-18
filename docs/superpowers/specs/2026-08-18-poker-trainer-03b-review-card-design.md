# ③-B 复盘卡片 — 设计文档

日期：2026-08-18
上游规格：`docs/superpowers/specs/2026-08-06-texas-holdem-trainer-design.md` §10.3
基线：master @ `51e515f`，45 文件 / 631 通过 / 3 跳过，typecheck + build 绿

## 1. 目标

一手牌结束后，用户能逐个决策点看到四件事：**这一步错了吗、亏了多少 BB、属于哪类错误、为什么**。

这是整个项目最初的目的。②-B-2 的复盘引擎已经能回答这四个问题（`analyzeHand()` 返回 `HandAnalysis`），③-A 已经能完整打一局并在 `phase==='handOver'` 时产出 `HandRecord`。本期只做**把已有结论渲染出来**这一段，不新增任何判定逻辑。

## 2. 范围

### 本期做

1. 结算区增加「复盘」按钮，按钮带本手最高 severity 的色点。它是独立组件、渲染在 `.bottom` 里 SummaryBar 之上，而**不是**塞进 `SummaryBar` —— 因为 hero 破产那一手底部显示的是 `RebuyPrompt` 而非 `SummaryBar`，而那恰恰是最该复盘的一手。做成独立组件，两种结算形态下按钮都在，同时 ③-A 已验收过的 `SummaryBar` 布局一行不动
2. 复盘卡片（覆盖牌桌的 sheet）：顶部本手净盈亏 + 整体评级
3. 街道时间线：按 preflop / flop / turn / river 分组，每个 hero 决策点一行，带 severity 色标与动作摘要
4. 点开某决策点展开：底池、待跟注、hero 胜率、所需胜率、各候选动作 EV 条形图、推荐动作、mistakeTag、解释文案
5. 底部对手底牌，标注「仅复盘可见」，已弃牌的座位灰显并标注
6. 主按钮「下一手」

### 本期明确不做

- **「我不认同这个判定」按钮**。`disputed: true` 的唯一用途是在历史页把这些手牌筛出来改进规则，而历史页与持久化都在 ③-C。本期做它，点了没有任何地方能看到结果，是个假按钮。等 ③-C 有了 IndexedDB 再一并接上。
- 历史页、漏洞报表、设置页（③-C / ③-D）
- 复盘卡片自动弹出开关（spec §10.6，属 ③-D 设置页）
- 任何判定逻辑的调整。本期一条 `judge.ts` / `taxonomy.ts` / `explain.ts` 的规则都不改。

### 打开方式：为什么是手动而不是自动弹出

上游 §10.3 写的是「手牌结束后从底部滑出的 sheet」，暗示自动。本期改为**手动打开**，理由是控制它的设置开关（§10.6「复盘卡片自动弹出开关」）在 ③-D —— 本期若强制每手弹出，用户没有任何地方能关掉它，而验收清单里有「连打 10 手不重不漏」这种需要快速连打的场景。

代价是「复盘」这件事需要用户主动点。用**按钮上的 severity 色点**补偿：本手有失误时按钮带色点，颜色就是最高 severity 档。这样「这手有没有打错」的信息仍然是前置的、不需要点开就能看到，只有「错在哪」需要主动展开。

## 3. 数据缺口与 review 层改动

### 3.1 现状

`DecisionAnalysis`（`src/review/types.ts`）目前只导出 `recommended: EvCandidate | null` —— 单个最优候选。而：

- **EV 条形图**需要**全部**候选的 EV，不是最优的那一个
- §10.3 点名的「用户胜率」「所需胜率」在 `DecisionAnalysis` 里根本没有字段

这三样数据 `estimateEv()` 全都算好了，就在 `EvResult` 的 `candidates` / `heroEquity` / `requiredEquity` 里，`analyzeHand()` 只是没往外传。

### 3.2 改动

`DecisionAnalysis` 新增三个字段，`analyzeHand()` 从同一次 `estimateEv` 调用的结果里原样填入（不新增任何计算、不改变随机流）：

```ts
/** 该决策点的全部候选动作与各自 EV，供 UI 画条形图。degraded 时为空数组 */
candidates: EvCandidate[];
/** hero 对当前对手范围的胜率。degraded 时为 null */
heroEquity: number | null;
/**
 * 用户实际动作匹配到的候选的 label，匹配不上或 degraded 时为 null。
 *
 * 条形图要把「你选的那一条」高亮出来，而 UI 手上只有 actual: Action，
 * 靠 actionType + investment 去比对等于把 judge.ts 的 matchCandidate
 * 在界面层重写一遍——两份匹配规则迟早漂移。这里由 analyzeHand 把它
 * 已经匹配到的那个候选的 label 原样传出来。
 */
actualLabel: string | null;
/**
 * 跟注所需最低胜率。无需跟注（toCall = 0）时为 null。
 *
 * 与上面两个字段不同，**degraded 时它依然有效**：它是
 * toCall / (pot + toCall) 的纯底池几何，只取决于 Situation 里的金额，
 * 与对手范围是否被替换过完全无关。degraded 的决策点上，
 * 「跟这注需要多少胜率」仍是一句诚实的话，只是「你有多少胜率」不能说。
 */
requiredEquity: number | null;
```

### 3.3 degraded 契约

`types.ts` 现有约定：`degraded === true` 时 `actualEv` / `recommended` 强制为 null，`evLoss` / `severity` / `tag` 强制为 0 / `'ok'` / null，因为这些数字是用被替换过的对手范围算出来的。

新增字段按同一条线切分：

| 字段 | degraded 时 | 理由 |
|---|---|---|
| `candidates` | `[]` | 每个候选的 EV 都建立在被替换过的对手范围上 |
| `heroEquity` | `null` | 直接由对手范围算出 |
| `actualLabel` | `null` | 与 `actualEv` 同批：候选列表本身已被清空，指向其中一条的标签也就没有意义 |
| `requiredEquity` | **保持有效** | 纯底池几何，不碰对手范围 |

这条切分必须有测试守着 —— 它正是「UI 不做检查就直接渲染数字」这类缺陷的唯一防线。

## 4. UI 架构

### 4.1 分层

```
src/ui/reviewModel.ts        纯数据变形，零 React 零 DOM —— 本期几乎全部可测逻辑在这里
src/ui/components/
  ReviewSheet.tsx            卡片壳：顶部评级、滚动区、下一手
  ReviewTimeline.tsx         街道分组 + 决策行 + 展开/收起
  ReviewDecision.tsx         单个决策点展开后的详情
  EvBars.tsx                 EV 条形图
  OpponentCards.tsx          对手底牌
```

组件保持薄：所有判断、分组、归一化都在 `reviewModel.ts`，组件只把结果摆到 DOM 上。这样做的原因很实际 —— 本项目**没有装 testing-library，没有组件渲染测试的基础设施**，本期也不引入。逻辑放在纯函数里才测得到。

### 4.2 reviewModel.ts 的接口

```ts
export type Grade = 'unknown' | 'clean' | 'minor' | 'notable' | 'severe';

/** 本手整体评级 */
export function handGrade(a: HandAnalysis): Grade;

/** 时间线：按街分组，组内保持 actionIndex 升序 */
export function timelineOf(a: HandAnalysis): StreetGroup[];

/** 某决策点的 EV 条形图数据（含零点基线位置） */
export function barsOf(d: DecisionAnalysis): BarChart;

/** 本手弃过牌的座位号，供对手底牌灰显 */
export function foldedSeatsOf(record: HandRecord): number[];
```

**评级定义**（上游 §10.3 只写了「整体评级」，没定义算法，本设计定死）：

按 `worstEvLoss` 落进哪个 severity 档，而不是 `totalEvLoss`。理由是与 §9 历史页的排序字段保持一致 —— 一个 3 BB 的大错比十个 0.3 BB 的小偏差更该标红，而 `totalEvLoss` 会把后者累加到前者之上。

| 条件 | Grade | 文案 |
|---|---|---|
| 无 hero 决策点，或全部决策点 degraded | `unknown` | 本手没有可判定的决策点 |
| 最高 severity = `ok` | `clean` | 这手没问题 |
| `minor` | `minor` | 有小偏差 |
| `notable` | `notable` | 有明显失误 |
| `severe` | `severe` | 有重大失误 |

`unknown` 单列一档是必要的：不能让「算不出来」和「没打错」显示成同一个绿色，那是在用沉默冒充结论。

**条形图归一化**：候选 EV 可以为负（`fold` 恒为 0，跟注可能为负）。取轴 `[min(0, minEv), max(0, maxEv)]`，零点画基线，负条向左伸。`isRecommended` 与「用户实际选的那条」各自高亮，两者可能是同一条。所有候选 EV 全为 0 时（极端退化）所有条宽记为 0，不做除零。

### 4.3 计算时机

`analyzeHand()` 实测在默认 1500 迭代下每手约 25–200 ms（`src/review/analyzeHand.test.ts` 七条用例合计 433 ms）。够快，不需要 Web Worker。

但它仍然会占住主线程一两百毫秒，而手牌结束那一帧正好在放结算动画（③-A 的赢池脉冲）。因此：

- 在 App 的 `handOver` effect 里触发，但用 `setTimeout(…, 0)` 让出这一帧，结算动画先跑完
- 结果按 `record.id` 缓存在 App state，同一手不重算
- 分析尚未回来时，「复盘」按钮**始终可见但处于 disabled**，不带色点；分析到达后按钮启用、色点出现。不采用「先不渲染、算完再冒出来」的做法 —— 那会让动作条在结算后跳一下

### 4.4 架构约束（沿用既有硬约束）

- `src/ui` 不得从 `core/gameEngine` / `ai/decide` / `ai/selfPlayAi` 取**值**（`import type` 不限）。`src/session/architecture.test.ts` 已有守卫，本期不放宽。
- `review/analyzeHand` 是纯函数、确定性、无副作用、不在上述禁止清单内，UI 直接调用，不再套一层 session 包装。
- 金额比较一律用 `core/chips.ts` 的 `isZeroChips` / `chipsGreater` / `round2`，禁裸 `===` 和裸 `>`。
- 内部量纲一律 BB，实额换算只允许存在于 `src/ui/format.ts`。
- 不碰 `src/core/` `src/ai/` `src/session/`。`src/review/` 只做 §3.2 的加法改动。

## 5. 视觉

沿用 ③-A 视觉改版建立的 CSS 令牌体系（`app.css` 顶部 13 个令牌），不新起色板。新增四个 severity 令牌：

| Severity | 语义 |
|---|---|
| `ok` | 中性/低调，不是绿色勾 —— 「没问题」不需要庆祝 |
| `minor` | 黄 |
| `notable` | 橙 |
| `severe` | 红 |

`degraded` 的决策点用灰色，与 `ok` 明确区分。

颜色不是唯一编码：每一档同时带文字标签（「没问题 / 小偏差 / 明显失误 / 重大失误 / 无法判定」），与 ③-A 四色牌那一轮定下的可达性原则一致。

卡片是覆盖式的，遵守 `safe-area-inset`；桌面端沿用 ③-A 的 1040×760 限宽容器，卡片不超出它。

## 6. 错误处理与边界

| 情况 | 行为 |
|---|---|
| hero 翻前直接被 blind walk / 没有任何决策点 | Grade = `unknown`，时间线为空，显示「本手没有可判定的决策点」 |
| 全部决策点 degraded | 同上 |
| 单个决策点 degraded | 该行标灰、标「无法判定」，**不显示任何 EV 数字、推荐动作、tag**；`requiredEquity` 仍可显示 |
| hero 弃牌后对手继续打 | 时间线只列 hero 的决策点（`heroDecisionPoints` 本就只产出这些） |
| 未摊牌 | 对手底牌照常显示，标注「仅复盘可见」 |
| `analyzeHand` 抛错 | 不让它掀掉牌桌：catch 住，按钮不带色点，点开显示「本手复盘失败」。牌局本身必须能继续 |

## 7. 测试策略

| 层 | 怎么测 |
|---|---|
| `src/review` 三个新字段 | 传递正确、degraded 时 `candidates=[]` / `heroEquity=null` / `requiredEquity` 保持 —— 各一条断言 |
| `src/ui/reviewModel.ts` | `handGrade` 五档各一条（含 `unknown` 的两种成因）、`timelineOf` 分组与组内顺序、`barsOf` 含负 EV / 全零 / 高亮标记 |
| 组件 | 本期无渲染测试（项目未装 testing-library，不本轮引入）。靠组件足够薄 + 控制方浏览器验收补位 |

基线数字必须保持：既有 631 条测试一条都不该改。新增测试只增不减。

## 8. 人工验收清单

1. 手牌结束后 SummaryBar 出现「复盘」按钮
2. 本手有失误时按钮带色点，颜色与卡片里最高 severity 一致
3. 本手无失误时按钮不带色点，点开显示「这手没问题」
4. 时间线按街分组，组内顺序与实际动作顺序一致
5. 点开决策点能看到底池、待跟注、胜率、所需胜率、条形图、推荐动作、tag、文案
6. 条形图里 fold 恒为 0 且零点基线可见；出现负 EV 时负条向左
7. degraded 的决策点不显示任何 EV 数字、推荐动作或 tag
8. 对手底牌显示且标「仅复盘可见」，弃牌者灰显
9. 「下一手」能关掉卡片并开始下一手
10. 连打 10 手，每手的复盘内容都对应当手（不串手、不缓存错）
11. 窄屏（390px）无横向溢出，卡片可滚动
12. 结算动画不被复盘计算卡住

## 9. 已知局限

- 复盘结论只在本次会话内存在，刷新即丢（持久化是 ③-C）
- 「我不认同这个判定」未做，用户对判定有异议时没有出口（③-C）
- 单步近似的固有局限照旧（上游 §12.1），卡片里不重复声明，留给 ③-D 的设置/关于页
