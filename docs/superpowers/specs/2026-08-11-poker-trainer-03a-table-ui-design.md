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

/** 开始第一手。buttonSeat 由 handIndex 决定，见 §4.4 */
export function startSession(cfg: SessionConfig): HandSessionState;

/** 推进一个 AI 动作。仅当 phase==='aiToAct'，否则抛错 */
export function stepAi(s: HandSessionState, cfg: SessionConfig): HandSessionState;

/** 施加 hero 的动作。仅当 phase==='awaitingHero'，否则抛错 */
export function applyHero(s: HandSessionState, input: ActionInput): HandSessionState;

/** 进入下一手：按钮位前进一位，六个座位全部重置为 100BB */
export function nextHand(s: HandSessionState, cfg: SessionConfig): HandSessionState;
```

非法调用抛错而不是静默返回原状态：静默会让 UI 的 bug 表现为「界面卡住」，抛错会让它表现为一个带堆栈的报错。前者要靠人肉排查，后者一眼就能定位。

### 4.3 每步的行为

`stepAi` 一步做四件事，顺序与 `playAiHand` 完全一致（这是刻意的——两条路径的 AI 行为必须相同）：

1. `decide(game, { ranges, personaIds, rng, ... })` 得到一个动作
2. `applyAction(game, d.action)` 推进引擎
3. 用**引擎实际记下的投入额**（`state.actions[last].amount`，不是 `d.action.amount`）调用 `narrowByAction` 收窄该座位范围
4. 若 `game.handOver`，`settleHand` 并 `toHandRecord`

第 3 点是 ②-B-1 修复过的一个真缺陷：`d.action.amount` 对 `call`/`allin` 恒为 `undefined`，`?? 0` 会把按尺度收窄整个关掉。会话层不得重新引入这个 bug——`selfPlayAi.ts` 里那段注释解释了原因，实现时照抄取值方式。

`applyHero` 做同样的第 2、3、4 步（hero 的动作同样要收窄 hero 座位的范围，因为将来 ③-B 的复盘需要一致的链路），但跳过第 1 步。

### 4.4 手牌轮转与筹码重置

- **按钮位**：`buttonSeat = handIndex % SEAT_COUNT`。hero 固定坐 `HERO_SEAT`（0），因此 hero 的位置逐手轮转，6 手一个完整轮回，与上级文档 §2「用户位置每手轮转」一致。
- **筹码**：每手调用 `startHand` 时不传 `startingStacks`，即六个座位全部回到 `STARTING_STACK`（100BB）。盈亏只累积在会话统计里，不带到下一手。

这条规则的理由写进 spec 以免日后被"改成真实现金局"：翻前范围表与 EV 引擎都是按 100BB 深度标定的，变额筹码会让复盘数字静默漂移；而上级文档 §2 已经把「固定 100BB 等额起始筹码」列为本期范围。

- **性格**：每手用 `assignPersonas(seats, createRng(`${seed}-persona-${handIndex}`), HERO_SEAT)` 重新分配。每手重掷让用户面对多样的对手组合，而不是固定五个人打一整晚。

### 4.5 会话累计统计（内存，不持久化）

```ts
export interface SessionTotals {
  handsPlayed: number;
  netBB: number;      // hero 累计净盈亏
}
```

在手牌**进入 `handOver` 的那一步**（`stepAi` 或 `applyHero` 产出 `record` 时）从 `record.results` 里 hero 的 `netBB` 累加，而不是等 `nextHand`。理由：结算条一出现，顶栏就该已经把这手算进去了；押后到「下一手」会让用户看到一个滞后一手的累计数字。

这是顶栏「手数 / 累计盈亏」的数据源。刷新页面归零——③-C 会把它换成 IndexedDB 里的真实统计。

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

一个脚本化 hero 代替真人驱动会话，连打 200 手。脚本化 hero 用 `decide` 以 GTO 原型代打——不是"总是跟注"这类退化脚本，因为退化脚本走不到加注与全下路径，而那正是动作合法性最容易出错的地方。

断言：

1. 每个动作后 `totalChips(game)` 守恒（对标 core 的核心不变量）
2. 无死锁：单手动作数不超过守卫上限
3. 同 `seed` + 同脚本跑两遍 → 200 份 `HandRecord` **逐位相同**（`stepAi` 与 `applyHero` 的幂等性由此获得覆盖：测试中对同一状态重复调用一次并断言结果相同）
4. 每份 record 经 `replayHandRecord` 复现到相同终局
5. 按钮位每手前进一位，hero 位置 6 手一个完整轮回
6. 每手开局六个座位的 `startingStack` 都是 `STARTING_STACK`
7. 每次 hero 回合，`actionBarModel` 给出的动作集合与 `legalActions` 一一对应，且脚本选中的动作一定在模型的启用项里

第 7 条是把动作条模型接进验收关卡的关键——否则模型只有孤立单测，覆盖不到真实牌局中出现的组合（例如「翻前大盲面对全员平跟」这种 `toCall === 0` 但 `currentBet > 0` 的局面，`legalActions` 在此给的是 `raise` 而非 `bet`）。

**已知的关卡边界：** 这 200 手证明会话层不破坏引擎不变量、且完全可复现；它**不**证明界面正确。渲染层的正确性靠 §9 的手工验证清单。

## 7. 界面规格 `src/ui/`

竖屏移动端优先，桌面浏览器窗口中同样可用。按上级文档 §10.2：

**布局（自上而下）**

- 顶栏：手数 · 会话累计盈亏（设置入口留占位，③-D 接通）
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

**状态管理**：`useReducer` 持有 `HandSessionState` 与 `SessionTotals`，通过 Context 下发。一个 effect 在 `phase === 'aiToAct'` 时起定时器，到点 dispatch `stepAi`；effect 的 cleanup 清除定时器。

## 8. 目录与依赖

```
src/session/              纯 TS，编排 core+ai，零 React
  handSession.ts          会话状态与四个转换函数
  actionBarModel.ts       合法动作 → 按钮与滑块模型
  scriptedHero.ts         测试用脚本化玩家
  *.test.ts

src/ui/                   React
  main.tsx                入口
  App.tsx                 reducer + Context + AI 定时器 effect
  components/             Table / Seat / Board / Pot / HeroHand /
                          ActionBar / RaiseControl / SummaryBar / TopBar
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

## 10. 已知局限

1. **无持久化。** 刷新即丢，这是 ③-A 的定义范围，③-C 解决。
2. **会话层与 `playAiHand` 随机流不同。** 同 seed 不产生相同牌局，见 §3.3。
3. **渲染层无自动化测试。** 只有 `actionBarModel` 这一层纯逻辑被测到，组件树靠 §9 人工验证。这是刻意的取舍（避免引入 jsdom 与脆弱的组件测试），代价是渲染回归只能靠人发现。
4. **AI 决策同步执行，阻塞主线程。** 单次约 25ms、最差 33ms（②-B-1 实测，6-max 翻前），在 300ms 的思考延迟里不可感知。若 ③-B 之后出现更重的估算，需要考虑 Web Worker——③-A 不做。
5. **每手重掷性格。** 用户无法建立"这个位置上那个人很松"的读牌记忆。这是为了对手多样性做的取舍，若日后觉得别扭可在 ③-D 的设置里加一个「固定对手」开关。
