# ③-A 牌桌与对局会话 — 设计文档

日期：2026-08-11
状态：已确认
上级文档：`docs/superpowers/specs/2026-08-06-texas-holdem-trainer-design.md`

## 1. 本子项目的位置

**三期的终点是一个可以部署上线的网站**——零后端的静态站点，打开网址就能玩、能复盘、能看漏洞报表，可添加到主屏并离线运行。

为此三期拆成四块，逐块 spec → 计划 → 执行：

| 子项目 | 内容 | 完成时能做什么 |
|---|---|---|
| **③-A（本文档）** | Vite+React 脚手架 · 纯 TS 对局会话层 · 牌桌 UI · 动作条 | 在浏览器里能打完一手牌 |
| ③-B | 复盘卡片（街道时间线 · EV 条形图 · 解释文案 · 不认同通道） | 每手结束看到自己错在哪 |
| ③-C | IndexedDB 存储 · 历史页 · 导出导入 · schema 迁移 | 关掉网页数据还在 |
| ③-D | stats 聚合 · 漏洞报表 · 设置页 · PWA · **构建与上线部署** | 长期漏洞暴露、可离线、有公开网址 |

拆分依据是依赖方向：③-A 是地基，B/C/D 各自只依赖 ③-A 与已有的 `core` / `ai` / `review`，彼此之间不依赖。上线动作集中在 ③-D，因为在此之前没有值得部署的完整产品。

**这对 ③-A 的约束：** 任何实现都不得引入服务端、构建期外部请求或运行时 API 调用。上级文档 §3 的「零后端，所有数据存在设备本地」是硬约束，只有守住它，③-D 才能把产物直接扔到静态托管上。

## 2. 目标与非目标

### 做

- 纯 TypeScript 的对局会话层，把 `core` 的引擎与 `ai` 的决策编排成一个**可在 hero 回合挂起**的对局循环
- **20/40 实额显示**：界面以真实筹码额呈现（盲注 20/40，标准后手 4000），内部量纲不变（§3.5）
- **筹码延续与买入账本**：筹码跨手延续，破产后手动选择补 4000 或 8000，每次买入留痕（§4.5）
- 一个脚本化玩家自对弈的硬验收关卡（对标前三期的做法）
- 动作条模型（合法动作 → 按钮启用态与加注滑块上下界）作为纯函数
- Vite + React 脚手架与上级文档 §10.2 规定的完整牌桌界面
- 手牌结束的极简结算条 +「下一手」

### 不做（属于 ③-B/C/D）

- 任何持久化。刷新页面即从零开始，这是 ③-A 的已知状态，不是缺陷
- 复盘卡片、历史页、漏洞报表、设置页
- PWA、Service Worker、部署
- 震动反馈、发牌与筹码动画

### 明确的验证方式

在开发机的浏览器里通过 `localhost` 验证。③-A **不含**局域网访问配置、构建产物部署或真机调试环节——那些与 PWA 一起放在 ③-D。界面仍按竖屏移动端优先设计（§7），在桌面浏览器窗口中同样可用。

尽管 ③-A 不做部署，`npm run build` 必须从第一天起就能产出可用的静态产物（§8）。构建在 ③-A 就保持绿色，③-D 才不会在上线前撞上一堆积压的构建问题。

## 3. 架构决策

### 3.1 会话层是纯 TS，React 只是壳

```
   core/ ai/  ──►  session/  ──►  ui/
   （已完成）      纯 TS 编排      React 渲染
                   零 React        零对局逻辑
```

`session/` 不得 import 任何 React、DOM 或计时器 API。`ui/` 不得包含任何「谁该行动、这个动作合法吗、AI 选什么」的判断。

理由：前三期 534 个测试的说服力全部建立在「纯逻辑、可在 node 里完整驱动」之上。若把对局循环写进 React hook，验收关卡就必须跑在 jsdom + testing-library 里，等于把这份信心整体降级。

### 3.2 会话层是 `playAiHand` 的可中断版本

`src/ai/selfPlayAi.ts` 的 `playAiHand` 已经是完整的编排：起手、按位置与性格给每个座位一个初始范围、循环调用 `decide` 与 `applyAction`、每个动作后用 `narrowByAction` 收窄该座位范围、结束时 `settleHand` + `toHandRecord`。

会话层要的是同一个循环，只是在 `state.toAct === HERO_SEAT` 时挂起，等外部喂进一个动作再继续。

**挂起期间必须保住 `ranges` Map。** 每个座位逐街收窄的范围就是 AI 世界观的连续性；若在 hero 思考期间丢失或重建，AI 会前后矛盾——翻牌圈按「已被收窄到很窄」打，转牌圈又退回全范围。

### 3.3 不在状态里存 `Rng`，每步用派生 seed 现造

`createRng` 返回的 `Rng`（`src/core/rng.ts`）持有内部可变状态。把它放进 React 状态会有一个具体的破坏路径：StrictMode 下 effect 双调用会让同一步的 `stepAi` 跑两次，rng 多前进一轮，同 seed 不再复现——而可复现性是本项目从第一天起的硬约束（`src/core/` 禁用 `Math.random()` 就是为了它）。

因此会话状态里存的是一个单调递增的 `stepIndex`，每一步现造 rng：

```ts
const rng = createRng(`${cfg.seed}-h${handIndex}-s${stepIndex}`);
```

由此 `stepAi` 与 `applyHero` 都是**幂等纯函数**：同一个输入状态调用多少次都得到逐位相同的输出。StrictMode 双调用、React 18 并发渲染下的重复执行都无害。

**代价（必须写进 README）：** 会话层与 `playAiHand` 使用不同的随机流，同一个 `seed` 在两者下产生的牌局**不会**相同。两条路径各自保证内部可复现，互不对表。`playAiHand` 是 ②-B-1 的验收测试，会话层是产品路径，职责本就不同。

### 3.4 时间只存在于 React 层

会话层没有 `setTimeout`、没有 `async`、没有「AI 正在思考」的概念——它只有「`phase === 'aiToAct'`，调用方可以推进一步」。300–600ms 的思考延迟由 `ui/` 的一个 effect 施加。极速模式就是把该延迟置 0，不改会话层一行代码。

### 3.5 实额显示是纯呈现层，内部量纲不变

需求是「小盲 20、大盲 40、后手 4000」。在 BB 量纲上这与现有设计**完全一致**：20/40 就是 0.5/1 BB，4000 ÷ 40 = 100BB，与 `src/core/types.ts` 里的 `SMALL_BLIND = 0.5` / `BIG_BLIND = 1` / `STARTING_STACK = 100` 逐项对应。

因此这不是引擎改动，是显示单位。`core` / `ai` / `review` 的 534 个测试、范围表的标定、EV 的量纲全部按 BB 建立，**一律不动**。只在 `ui/` 加一个格式化函数：

```ts
// src/ui/format.ts
export const CHIPS_PER_BB = 40;
export function chips(bb: number): string;   // 100 -> "4,000"
```

规则：

- **界面上一律显示实额**（筹码、底池、下注额、跟注额、快捷尺度按钮）
- **会话层与所有接口一律用 BB**，实额永远不进入 `session/`、`core/`、`ai/`、`review/`
- **例外：EV 损失与复盘数字保持 BB**。「你这一步亏了 2.3BB」比「亏了 92」更有意义——BB 是扑克里比较损失的通用量纲，且跨盲注级别可比。③-B 的复盘卡片沿用此规则。

把换算钉死在最外层的一个函数里，是为了让「实额」这个概念无法渗进有测试保护的逻辑层。若日后要改盲注级别，只动 `CHIPS_PER_BB` 一个常量。

## 4. 会话层规格 `src/session/`

### 4.1 状态

```ts
export type SessionPhase = 'aiToAct' | 'awaitingHero' | 'handOver';

export interface HandSessionState {
  /** 牌局引擎状态，唯一权威 */
  game: GameState;
  /** 座位号 -> 该座位当前的手牌范围，逐街收窄 */
  ranges: ReadonlyMap<number, RangeSet>;
  /** 座位号 -> persona id，hero 座位为 'hero' */
  personaIds: ReadonlyMap<number, string>;
  phase: SessionPhase;
  /** 本手牌的基础 seed */
  seed: string;
  /** 本手是第几手（从 0 起），参与 rng 派生与按钮位轮转 */
  handIndex: number;
  /** 本手已推进的步数，参与 rng 派生 */
  stepIndex: number;
  /** 最近一个动作，供动作气泡渲染；本手尚无动作时为 null */
  lastAction: { seat: number; type: ActionType; amount: number } | null;
  /** 仅 phase==='handOver' 时非空 */
  record: HandRecord | null;
  /** 每个座位在下一手开局时的筹码（BB），跨手延续。见 §4.4 */
  stacks: readonly number[];
  /** 买入账本，hero 的净盈亏由它算出。见 §4.5 */
  ledger: SessionLedger;
}
```

`phase` 是派生量而非独立事实——它由 `game.handOver` 与 `game.toAct` 唯一决定，抽出来只是为了让 UI 与 reducer 不必重复推导。会话层内部用一个私有函数计算它，避免出现 `phase` 与 `game` 不一致的状态。

### 4.2 接口

```ts
export interface SessionConfig {
  /** 整个会话的基础 seed，各手牌由它与 handIndex 派生 */
  seed: string;
  /** 主胜率估算迭代数，透传给 decide；默认沿用 decide 的默认值 */
  iterations?: number;
  /** 范围牌力排序迭代数，透传给 decide 与 narrowByAction */
  strengthIterations?: number;
}

/**
 * 开始第一手。六个座位各带 STARTING_STACK（100BB）入座，
 * 账本记入 hero 的开局买入 { handIndex: 0, amount: 100 }。
 */
export function startSession(cfg: SessionConfig): HandSessionState;

/** 推进一个 AI 动作。仅当 phase==='aiToAct'，否则抛错 */
export function stepAi(s: HandSessionState, cfg: SessionConfig): HandSessionState;

/** 施加 hero 的动作。仅当 phase==='awaitingHero'，否则抛错 */
export function applyHero(s: HandSessionState, input: ActionInput): HandSessionState;

/**
 * 进入下一手：按钮位前进一位，各座位带上一手结束时的筹码入座（§4.4）。
 * 若 hero 筹码不足一个大盲，抛错——调用方必须先 rebuy。
 */
export function nextHand(s: HandSessionState, cfg: SessionConfig): HandSessionState;

/** hero 是否已无法参与下一手（筹码不足一个大盲），即需要补码 */
export function heroNeedsRebuy(s: HandSessionState): boolean;

/** hero 补码。amount 只接受 REBUY_OPTIONS 中的值，否则抛错 */
export function rebuyHero(s: HandSessionState, amount: number): HandSessionState;

/** 可选的补码额度，单位 BB。对应实额 4000 / 8000 */
export const REBUY_OPTIONS: readonly number[] = [100, 200];
```

非法调用抛错而不是静默返回原状态：静默会让 UI 的 bug 表现为「界面卡住」，抛错会让它表现为一个带堆栈的报错。前者要靠人肉排查，后者一眼就能定位。`nextHand` 在 hero 需要补码时抛错，是同一条原则的应用——它逼 UI 显式处理补码分支，而不是让一手筹码为 0 的牌悄悄发出去。

### 4.3 每步的行为

`stepAi` 一步做四件事，顺序与 `playAiHand` 完全一致（这是刻意的——两条路径的 AI 行为必须相同）：

1. `decide(game, { ranges, personaIds, rng, ... })` 得到一个动作
2. `applyAction(game, d.action)` 推进引擎
3. 用**引擎实际记下的投入额**（`state.actions[last].amount`，不是 `d.action.amount`）调用 `narrowByAction` 收窄该座位范围
4. 若 `game.handOver`，`settleHand` 并 `toHandRecord`

第 3 点是 ②-B-1 修复过的一个真缺陷：`d.action.amount` 对 `call`/`allin` 恒为 `undefined`，`?? 0` 会把按尺度收窄整个关掉。会话层不得重新引入这个 bug——`selfPlayAi.ts` 里那段注释解释了原因，实现时照抄取值方式。

`applyHero` 做同样的第 2、3、4 步（hero 的动作同样要收窄 hero 座位的范围，因为将来 ③-B 的复盘需要一致的链路），但跳过第 1 步。

### 4.4 手牌轮转与筹码延续

**按钮位**：`buttonSeat = handIndex % SEAT_COUNT`。hero 固定坐 `HERO_SEAT`（0），因此 hero 的位置逐手轮转，6 手一个完整轮回，与上级文档 §2「用户位置每手轮转」一致。

**筹码跨手延续。** 每手用上一手结束时的筹码入座——`nextHand` 把 `stacks` 传给 `startHand({ startingStacks })`。这偏离了上级文档 §2 的「固定 100BB 等额起始筹码」，是本子项目对上级文档的一处**显式修订**，理由是需求要真实现金局的买入体验。带来两个连带后果，都必须处理而不是隐瞒：

1. **边池分层第一次走上产品路径。** 等额筹码时 `buildPots` 永远合并成单池（README 已记载此边界），筹码延续后它会真正分层。该代码由变额筹码的自对弈覆盖过（3000 手中 2703 手产生多池），但产品路径头一回踩上去——§6 的验收关卡必须显式断言多池情形出现过且分配正确。
2. **深度会漂离范围表的标定点。** 见 §4.6。

**AI 破产自动补码。** 任一 AI 座位在开新手时筹码不足一个大盲，自动补到 `REBUY_OPTIONS` 中随机一档（100BB 或 200BB），由 `createRng(`${seed}-rebuy-${handIndex}-${seat}`)` 决定，保持可复现。AI 不需要人来点。

**hero 破产需手动选择。** `nextHand` 在 `heroNeedsRebuy(s)` 为真时抛错，UI 必须先弹出补码选择（4000 / 8000）并调用 `rebuyHero`。

**「不足一个大盲」而非「筹码为 0」** 是破产判定的口径：剩 0.5BB 的座位连大盲都下不满，让它入座只会产生一手立刻全下的退化牌局。剩 15BB 这类短码则继续打，不弹补码框——短码打法本身就是值得练的场景。

### 4.5 买入账本

```ts
export interface BuyIn {
  /** 第几手之前发生的买入；开局那次为 0 */
  handIndex: number;
  /** 买入额，BB */
  amount: number;
}

export interface SessionLedger {
  /** hero 的每一次买入，含开局那次，按时间顺序 */
  buyIns: readonly BuyIn[];
  /** hero 累计买入额，BB */
  totalBuyIn: number;
  /** 已打完的手数 */
  handsPlayed: number;
}
```

**hero 的净盈亏必须按 `当前筹码 − totalBuyIn` 计算，不能靠累加每手的 `netBB`。** 这是账本存在的全部理由：补码是往桌上添钱，不是盈利；若不记买入，补一次 4000 就会被当成赢了 4000。这条要写成一个专门的测试。

`handsPlayed` 与净盈亏是顶栏「手数 / 累计盈亏」的数据源，界面上按 §3.5 以实额显示。账本本身不持久化，刷新归零——③-C 会把它落进 IndexedDB，届时买入记录会成为跨会话盈亏统计的基础，所以数据结构现在就按可持久化的形状定（纯数据、无函数、可 JSON 序列化）。

### 4.6 深筹码的复盘精度标记

翻前范围表与 EV 引擎按 100BB 深度标定。筹码延续后，hero 或对手可能打到 150BB、300BB，此时复盘仍会用 100BB 的逻辑算出一个看起来很权威的数字。

处理办法是**明说而不是限制**：

```ts
/** 超过此深度（BB）即认为复盘精度下降 */
export const DEEP_STACK_BB = 150;

/** 本手是否有任一座位在开局时超过 DEEP_STACK_BB */
export function isDeepStackHand(s: HandSessionState): boolean;
```

筹码不设上限，赢多少留多少。但只要开局有任一座位超过 150BB，该手就带上深筹码标记；③-B 的复盘卡片据此显示「深筹码，复盘精度下降」。

这与项目一贯的做法一致：`EvResult.degraded` 时复盘拒绝报数字、金标准场景如实跳过 3 个而非改预期。**宁可明说不准，不可默默报一个错数字。** ③-A 只负责产出这个标记，消费它是 ③-B 的事。

### 4.7 对手性格

每手用 `assignPersonas(seats, createRng(`${seed}-persona-${handIndex}`), HERO_SEAT)` 重新分配。每手重掷让用户面对多样的对手组合，而不是固定五个人打一整晚。

`stacks` 与 `personaIds` 因此是解耦的：座位上的筹码延续，但那个座位背后的性格每手会变。这在扑克语义上略显奇怪（等于每手换人但把筹码留下），是为对手多样性做的取舍，记在 §10。

**统计的更新时机**：`handsPlayed` 与各座位的 `stacks` 在手牌**进入 `handOver` 的那一步**（`stepAi` 或 `applyHero` 产出 `record` 时）更新，而不是等 `nextHand`。理由：结算条一出现，顶栏就该已经把这手算进去了；押后到「下一手」会让用户看到一个滞后一手的数字。

## 5. 动作条模型 `src/session/actionBarModel.ts`

上级文档 §11.5 对 UI 层只要求测两件事：按钮的启用/禁用状态、加注滑块的上下界合法性。把这两件事抽成纯函数，它们就能在 node 里测，React 组件退化为纯渲染，无需引入 jsdom 或 testing-library。

```ts
export interface RaiseModel {
  /** 最小投入额（引擎给的最小加注） */
  min: number;
  /** 最大投入额（等于 hero 剩余筹码） */
  max: number;
  /** 快捷尺度按钮，超出 [min,max] 的档位不出现在数组里 */
  presets: { label: string; amount: number }[];
}

export interface ActionBarModel {
  /** 不该出现动作条时为 false（非 hero 回合、手牌已结束） */
  enabled: boolean;
  fold: boolean;
  /** 'check' | 'call'，以及 call 需要投入多少 */
  passive: { type: 'check' } | { type: 'call'; amount: number } | null;
  /** 主动加码；无加注权或筹码不足时为 null */
  raise: ({ type: 'bet' | 'raise' } & RaiseModel) | null;
  /** 全下；不可用时为 null。UI 对它做二次确认 */
  allin: { amount: number } | null;
}

export function actionBarModel(state: GameState): ActionBarModel;
```

**唯一数据源是 `legalActions(state)`。** 模型函数不得自行推导合法性——`gameEngine.legalActions` 已经处理了最小加注、加注权（`hasActedSinceLastFullRaise`）、不足额跟注、以及「没有加注权的人面对短 all-in 只能跟或弃」这些边角。重新实现一遍就是给自己制造一个会与引擎分歧的第二权威。

`presets` 只含 1/3 池、1/2 池、2/3 池、1 池四档；all-in 是 `ActionBarModel` 上的独立字段，因为它需要二次确认而其他档位不需要，混在同一个数组里会让 UI 不得不按 label 特判。

「池」指**跟注后的底池**（`currentPot + toCall`），这是德扑通用口径；按此算出的投入额再夹到 `[min, max]`，夹不进去的档位直接不出现在数组里，而不是显示一个点了会报错的按钮。

## 6. 验收关卡 `src/session/scriptedPlay.test.ts`

一个脚本化 hero 代替真人驱动会话，连打 200 手。脚本化 hero 用 `decide` 以 GTO 原型代打——不是"总是跟注"这类退化脚本，因为退化脚本走不到加注与全下路径，而那正是动作合法性最容易出错的地方。补码时脚本按固定策略选 `REBUY_OPTIONS[0]`（另设一条 200 手的用例专门选 `REBUY_OPTIONS[1]`，覆盖 200BB 深度）。

断言：

1. 每个动作后 `totalChips(game)` 守恒（对标 core 的核心不变量）
2. 无死锁：单手动作数不超过守卫上限
3. 同 `seed` + 同脚本跑两遍 → 200 份 `HandRecord` **逐位相同**（`stepAi` 与 `applyHero` 的幂等性由此获得覆盖：测试中对同一状态重复调用一次并断言结果相同）
4. 每份 record 经 `replayHandRecord` 复现到相同终局
5. 按钮位每手前进一位，hero 位置 6 手一个完整轮回
6. 每次 hero 回合，`actionBarModel` 给出的动作集合与 `legalActions` 一一对应，且脚本选中的动作一定在模型的启用项里

筹码延续带来的新断言（这几条是本次改动的核心，不是补充）：

7. **跨手筹码守恒**：每手开局的 `Σstacks` 等于上一手结束时的 `Σstacks` 加上本手之前发生的所有买入额。这是 `totalChips` 不变量在会话尺度上的推广——单手守恒不能保证跨手不漏钱
8. **账本恒等式**：任意时刻 `hero 当前筹码 − ledger.totalBuyIn` 等于把每手 `record.results` 里 hero 的 `netBB` 全部累加的结果。两条独立路径必须给出同一个净盈亏，否则账本是错的
9. **补码只在该补时发生**：`heroNeedsRebuy` 为真 ⟺ hero 筹码 < `BIG_BLIND`；`rebuyHero` 传入 `REBUY_OPTIONS` 以外的值必须抛错
10. **多池确实出现过**：200 手中至少有一手的 `record.pots.length > 1`，且该手所有 `pots` 的金额之和等于总投入。**这条如果为零就要停下来报数字，不许调 seed 直到出现**——若变额筹码下多池仍然不可达，那说明我们对边池的理解有问题，这个事实比一条绿测试重要
11. **深筹码标记正确**：`isDeepStackHand` 为真 ⟺ 该手开局存在座位 ≥ `DEEP_STACK_BB`

第 6 条是把动作条模型接进验收关卡的关键——否则模型只有孤立单测，覆盖不到真实牌局中出现的组合（例如「翻前大盲面对全员平跟」这种 `toCall === 0` 但 `currentBet > 0` 的局面，`legalActions` 在此给的是 `raise` 而非 `bet`）。

**已知的关卡边界：** 这 200 手证明会话层不破坏引擎不变量、账本自洽、且完全可复现；它**不**证明界面正确。渲染层的正确性靠 §9 的手工验证清单。

## 7. 界面规格 `src/ui/`

竖屏移动端优先，桌面浏览器窗口中同样可用。按上级文档 §10.2：

**布局（自上而下）**

- 顶栏：手数 · 会话累计盈亏 · 累计买入（设置入口留占位，③-D 接通）。所有金额按 §3.5 显示实额
- 上半部：弧形排布 5 个 AI 座位。每个座位显示位置标签、筹码、本街投入、以及最近动作的气泡
- 中部：底池数额 + 公共牌（居中，尺寸最大）
- 下部：hero 底牌（比公共牌大一号）+ 位置 + 筹码
- 底部固定动作条：弃牌 / 过牌·跟注 / 下注·加注，位于拇指可达区

**交互**

- 动作条 `position: fixed`，不随内容滚动
- 加注：1/3、1/2、2/3、池、all-in 快捷键 + 滑块，上下界与档位全部来自 `actionBarModel`
- all-in 二次确认，其他动作不确认
- AI 思考延迟 300–600ms（由 `stepIndex` 派生的 rng 决定具体值，保持可复现）
- 四色牌：♠黑 ♥红 ♦蓝 ♣绿
- 遵守 `safe-area-inset`

**手牌结束**：底部换成极简结算条——本手净盈亏、摊牌时亮出的对手底牌、一个「下一手」按钮。③-B 用复盘卡片替换这个位置，「下一手」本来就是复盘卡片的主按钮，不会白写。

**破产补码**：`heroNeedsRebuy` 为真时，「下一手」换成一个补码选择——两个按钮「补 4000」「补 8000」，上方一行小字说明本次是第几次买入、累计买入多少。选中后调 `rebuyHero` 再 `nextHand`。**没有取消选项**：会话里没有「不补码」这个合法状态，给一个点了什么都不发生的按钮只会让人困惑。

**深筹码提示**：任一座位超过 150BB 时，顶栏显示一个不打断操作的小标记。③-A 只显示标记，「复盘精度下降」的完整说明在 ③-B 的复盘卡片上。

**状态管理**：`useReducer` 持有 `HandSessionState`（账本已在其中），通过 Context 下发。一个 effect 在 `phase === 'aiToAct'` 时起定时器，到点 dispatch `stepAi`；effect 的 cleanup 清除定时器。

## 8. 目录与依赖

```
src/session/              纯 TS，编排 core+ai，零 React
  handSession.ts          会话状态与状态转换函数
  ledger.ts               买入账本与净盈亏计算
  actionBarModel.ts       合法动作 → 按钮与滑块模型
  scriptedHero.ts         测试用脚本化玩家
  *.test.ts

src/ui/                   React
  main.tsx                入口
  App.tsx                 reducer + Context + AI 定时器 effect
  format.ts               BB → 实额（§3.5），唯一的换算点
  components/             Table / Seat / Board / Pot / HeroHand /
                          ActionBar / RaiseControl / SummaryBar /
                          RebuyPrompt / TopBar
  styles/

index.html
vite.config.ts
```

新依赖：`react`、`react-dom`、`vite`、`@vitejs/plugin-react`、`@types/react`、`@types/react-dom`。

**依赖安装的硬约束：** npm registry 必须保持 `https://registry.npmmirror.com/`。用 `npm install <pkg>` 增量添加，**不得**删除 `node_modules` 或 `package-lock.json` 后重装。任何使 lockfile 中出现 `registry.npmjs.org` 的改动都要停下来报告，不得自行合并。

`tsconfig.json` 需要加 `"jsx": "react-jsx"` 与 `"lib": [..., "DOM"]`；`vitest.config.ts` 的 `include` 已是 `src/**/*.test.ts`，覆盖 `src/session/`，无需改动。新增 `npm run dev` / `npm run build`。

`src/core/architecture.test.ts` 是现有的分层守卫，需扩充两条：

1. `src/session/` 不得 import `react` / `react-dom`，也不得出现 `setTimeout` / `document` / `window`
2. `src/ui/` 不得从 `src/core/gameEngine`、`src/ai/decide`、`src/ai/selfPlayAi` 取**值**——对局逻辑只能经由 `session/` 进入界面。**纯类型导入不受限制**（`import type { Card, Position } from '../core/types'` 是渲染必需的，且编译后不产生运行时依赖）。守卫按 `import type` 与 `import { ... } from` 区分，不是按模块路径一刀切。

## 9. 手工验证清单

会话层有自动关卡，渲染层没有。③-A 完成时在浏览器里逐条走一遍：

1. 六个座位的位置标签与按钮位一致，且逐手轮转
2. 轮到 hero 时动作条出现，非 hero 回合时禁用
3. 弃牌后本手立即推进到结算，不卡住
4. 加注滑块拖到最小值与最大值都能提交，且提交后引擎不报错
5. 快捷尺度按钮算出的额度与底池显示自洽
6. all-in 二次确认可取消
7. 打到摊牌时对手底牌亮出，未摊牌时不亮
8. 连打 10 手，顶栏手数与累计盈亏随之变化且数值合理
9. 手机尺寸视口下动作条不被遮挡、不需要横向滚动
10. 所有金额显示为实额：盲注 20/40、开局筹码 4000。下注额**不**保证是 40 的整数倍——引擎内部按连续 BB 工作，加注滑块一格是 `SMALL_BLIND` = 0.5BB = 20 筹码，但滑块可以停在任意步进点上（如 3.825BB = 153 筹码），引擎照常接受并精确扣款
11. 故意打光筹码，补码选择出现；分别选 4000 与 8000，下一手的起始筹码正确
12. 补码之后顶栏的累计盈亏**没有**跳涨——补码不是盈利（§4.5 的账本恒等式在界面上的体现）
13. 赢到超过 6000（150BB）后，深筹码标记在**下一手开局时**出现（不是赢下那个底池的瞬间——本手要先结算，进入下一手 `beginHand` 时 `startingStack` 才会反映新筹码）。标记**不会**因为 hero 回落而消失——`isDeepStackHand`（`handSession.ts`）判定的是「本手开局时」全部座位（含 AI）里是否有任一座位 ≥ 150BB，只要还有其他座位开局达标，hero 自己缩水到远低于 150BB 时标记仍然显示（§4.6 就是这样定义的，不是 bug）

（以上第 10、13 条于 2026-08-15 复核订正：第 10 条原文断言下注额是 40 的整数倍，与引擎连续 BB 语义矛盾，已实测证伪；第 13 条原文断言标记会随 hero 回落消失，与 §4.6、与 `isDeepStackHand` 的实现均矛盾。两条都是规格描述有误，不是代码需要修的 bug。）

## 10. 已知局限

1. **无持久化。** 刷新即丢，这是 ③-A 的定义范围，③-C 解决。
2. **会话层与 `playAiHand` 随机流不同。** 同 seed 不产生相同牌局，见 §3.3。
3. **渲染层无自动化测试。** 只有 `actionBarModel` 这一层纯逻辑被测到，组件树靠 §9 人工验证。这是刻意的取舍（避免引入 jsdom 与脆弱的组件测试），代价是渲染回归只能靠人发现。
4. **AI 决策同步执行，阻塞主线程。** 单次约 25ms、最差 33ms（②-B-1 实测，6-max 翻前），在 300ms 的思考延迟里不可感知。若 ③-B 之后出现更重的估算，需要考虑 Web Worker——③-A 不做。
5. **每手重掷性格，但筹码延续。** 等于每手换人却把筹码留在座位上，扑克语义上略显奇怪。用户也因此无法建立「这个位置上那个人很松」的读牌记忆。这是为对手多样性做的取舍，若日后觉得别扭可在 ③-D 的设置里加一个「固定对手」开关。
6. **深筹码下复盘精度下降，只标记不修正。** 翻前范围表与 EV 引擎按 100BB 标定，筹码延续后深度会漂移。§4.6 的做法是超过 150BB 就打标记，而**不是**换用深筹码范围表——本代码库没有那份数据。标记是诚实的下限，不是解决方案。
7. **本子项目修订了上级文档 §2。** 上级设计文档写的是「固定 100BB 等额起始筹码」，③-A 改为筹码延续 + 手动补码。上级文档的对应条目需同步更新，否则两份文档会互相矛盾。
8. **边池分层首次进入产品路径。** README 现记载「边池分层在产品默认配置下不可达」，筹码延续后该记载失效，需一并更新。这段代码有变额筹码自对弈的覆盖，但缺少真实用户路径上的历史。
