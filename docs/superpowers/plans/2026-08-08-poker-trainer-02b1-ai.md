# 德州扑克训练器 — 计划 ②-B-1：AI 对手

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 对手能在牌桌上自己打牌。完成后命令行能跑一场六人局，每个座位由一个有性格的 AI 驱动，动作全部合法，单次决策在时间预算内。

**Architecture:** AI 不自己判断局面，而是构造 `Situation` 喂给 ②-A 的 `estimateEv`，拿到各动作的 EV 之后再按性格参数扰动阈值来选。这样 AI 的行为和复盘引擎的判定标准共用同一条估值路径 —— 不会出现「复盘说这里该弃牌、可 AI 在同样局面从不弃」的割裂。前两个任务是终审留下的前置修复：补齐范围表缺口、把翻前强度表预计算掉，否则 AI 的决策时间撑不住。

**Tech Stack:** TypeScript（strict）、Vitest、Node 24 —— 与前两期相同，不新增依赖

**上游文档:** `docs/superpowers/specs/2026-08-06-texas-holdem-trainer-design.md`（§7.1、§7.2）

## 前两期已产出的接口（本计划的地基）

```ts
// src/core/types.ts
export type Position = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
export const SMALL_BLIND = 0.5, BIG_BLIND = 1, STARTING_STACK = 100, SEAT_COUNT = 6, HERO_SEAT = 0;
export interface GameState { seats; board; deck; street; toAct; currentBet; lastRaiseSize;
                             actions; handOver; results; pots; seed; buttonSeat }
export interface Action { seat; street; type; amount; potBefore; toCall; stackBefore }

// src/core/gameEngine.ts
export interface LegalAction { type: ActionType; min: number; max: number }  // min/max 是「本次投入额」
export interface ActionInput { type: ActionType; amount?: number }
export function startHand(opts: { seed: string; buttonSeat: number; startingStacks?: number[] }): GameState;
export function legalActions(state: GameState): LegalAction[];
export function applyAction(state: GameState, input: ActionInput): GameState;
export function settleHand(state: GameState): GameState;
export function currentPot(state: GameState): number;
export function totalChips(state: GameState): number;

// src/core/chips.ts
export function isZeroChips(v: number): boolean;
export function chipsGreater(a: number, b: number): boolean;
export function round2(v: number): number;

// src/core/rng.ts
export interface Rng { nextU32(): number; nextFloat(): number; nextInt(n: number): number }
export function createRng(seed: string): Rng;

// src/core/handClass.ts
export type HandClass = string;
export function classifyHand(a: Card, b: Card): HandClass;
export function allHandClasses(): HandClass[];

// src/core/rangeSet.ts
export type RangeSet = ReadonlyMap<HandClass, number>;
export function fullRange(): RangeSet;
export function rangeFraction(range: RangeSet): number;
export function rangeCombos(range: RangeSet, dead: readonly Card[]): WeightedCombo[];

// src/core/rangeNotation.ts
export function parseRange(notation: string): Map<HandClass, number>;

// src/core/rangeStrength.ts
export interface RankedCombo extends WeightedCombo { strength: number }
export function rankRange(range: RangeSet, board: Card[], dead: readonly Card[],
                          iterations: number, rng: Rng): RankedCombo[];
export function topFraction(ranked: readonly RankedCombo[], fraction: number): RangeSet;
export function strengthPercentile(ranked: readonly RankedCombo[], hc: HandClass): number;

// src/core/ranges/index.ts
export type PreflopAction = 'raise' | 'call' | '3bet' | '4bet' | 'fold';
export function rfiKey(pos: Position): string;
export function vsOpenKey(pos: Position, opener: Position): string;
export function vs3betKey(pos: Position, threeBettor: Position): string;
export function hasNode(key: string): boolean;
export function actionFreqs(key: string, hc: HandClass): Record<string, number> | undefined;
export function rangeForAction(key: string, action: PreflopAction): RangeSet | undefined;

// src/core/situation.ts
export interface SituationOpponent { seat: number; position: Position; stack: number;
                                     range: RangeSet; personaId: string; canFold: boolean }
export interface Situation { heroSeat; heroPosition; heroCards; board; street; pot; toCall;
                             heroStack; heroStreetContribution; opponents; heroIsPreflopAggressor }
export interface SituationOptions { ranges: Map<number, RangeSet>; personaIds: Map<number, string> }
export function situationFromGameState(state: GameState, opts: SituationOptions): Situation;

// src/core/evEstimate.ts
export interface EvCandidate { label: string; actionType: ActionType; investment: number;
                               ev: number; isRecommended: boolean;
                               foldEquity?: number; equityWhenCalled?: number; impliedOdds?: number }
export interface EvResult { candidates: EvCandidate[]; heroEquity: number;
                            requiredEquity: number | null; recommended: EvCandidate; iterations: number }
export interface EvOptions { iterations?: number; strengthIterations?: number;
                             rng?: Rng; impliedOdds?: boolean }
export function estimateEv(sit: Situation, opts?: EvOptions): EvResult;

// src/core/opponentRange.ts
export function initialRange(pos: Position): RangeSet;
export interface NarrowContext { street; board; dead; potBefore; betSize; strengthIterations; rng }
export function narrowByAction(range: RangeSet, actionType: ActionType, ctx: NarrowContext): RangeSet;
```

**一个已知的接口缺口，本计划自己绕开**：`estimateEv` 产出的候选下注尺度里，有些在引擎看来是非法的 —— 翻前最小加注额是 2BB，而 `bet 1/3` 只有 1.5BB。`Situation` 不携带最小加注额，所以 `estimateEv` 无法自己过滤。AI 手上有 `GameState`，因此 `decide` 直接拿 `legalActions(state)` 过滤候选。复盘引擎没有 `GameState`，那个问题留给计划 ②-B-2。

## Global Constraints

- 语言 TypeScript，`tsconfig.json` 已开启 `"strict": true`
- **禁止** `import React`、`document`、`window`
- **禁止**直接调用 `Math.random()`；随机性一律由参数传入的 `Rng` 提供
- 金额比较用 `chips.ts` 的 `isZeroChips` / `chipsGreater`，**不要**用 `===` 或裸 `>`；概率与频率不是金额，用普通比较即可
- 手牌分值与 EV 排序用普通比较；EV 取最大值时用 `>`，**不得**引入容差（否则并列无法确定）
- 筹码单位为 BB。小盲 0.5、大盲 1.0、起始筹码 100
- 每个任务结束必须提交，提交信息用中文，末尾附 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- 本计划**不引入** React、Vite、IndexedDB，也不写复盘引擎（那是 ②-B-2）
- Task 1 与 Task 2 修改既有文件，其余任务只新增文件

---

### Task 1: 补齐翻前范围表的五个缺口

终审指出范围表覆盖 10 个「面对开池」节点，缺 5 个常见的单次加注底池。缺失时 `initialRange` 回落到全范围，而一个全范围对手带来的误差远大于表里略微不准的条目。

**Files:**
- Modify: `src/core/ranges/data.ts`（只加节点，不动既有节点）
- Test: `src/core/ranges/ranges.test.ts`（追加，不改既有断言）

**Interfaces:**
- Consumes: `PREFLOP_NODES`（`./data`）；`vsOpenKey`, `hasNode`, `rangeForAction`（`./index`）；`rangeFraction`（`../rangeSet`）
- Produces: 五个新节点键 —— `HJ_vs_UTG_open`、`CO_vs_UTG_open`、`CO_vs_HJ_open`、`SB_vs_UTG_open`、`SB_vs_HJ_open`

- [ ] **Step 1: 追加五个节点**

在 `src/core/ranges/data.ts` 的 `PREFLOP_NODES` 里，紧接在既有的 `BTN_vs_CO_open` 之后加入：

```ts
  // ── 面对单一开池：中间位置防守（补齐终审指出的缺口）
  HJ_vs_UTG_open: {
    '3bet': 'QQ+, AKs, A5s, AKo',
    call: 'JJ-77, AQs-AJs, KQs, QJs, JTs, T9s, AQo',
  },
  CO_vs_UTG_open: {
    '3bet': 'QQ+, AKs, A5s-A4s, AKo',
    call: 'JJ-66, AQs-ATs, KQs-KJs, QJs, JTs, T9s, 98s, AQo',
  },
  CO_vs_HJ_open: {
    '3bet': 'JJ+, AQs+, A5s-A4s, AKo',
    call: 'TT-55, AJs-A9s, KQs-KTs, QTs+, J9s+, T9s, 98s, 87s, AQo-AJo, KQo',
  },
  SB_vs_UTG_open: {
    '3bet': 'QQ+, AKs, A5s, AKo',
    call: 'JJ-99, AQs, KQs, QJs, JTs',
  },
  SB_vs_HJ_open: {
    '3bet': 'JJ+, AQs+, A5s-A4s, AKo',
    call: 'TT-88, AJs-ATs, KQs, QJs, JTs, T9s',
  },
```

**不要改动任何既有节点。** 小盲的跟注范围明显窄于同位置的大盲，这是位置劣势的结果，不是笔误。

- [ ] **Step 2: 写失败的测试**

在 `src/core/ranges/ranges.test.ts` 末尾追加：

```ts
describe('面对开池节点的覆盖', () => {
  const allVsOpen: Array<[Position, Position]> = [
    ['BB', 'UTG'], ['BB', 'HJ'], ['BB', 'CO'], ['BB', 'BTN'], ['BB', 'SB'],
    ['BTN', 'UTG'], ['BTN', 'HJ'], ['BTN', 'CO'],
    ['SB', 'UTG'], ['SB', 'HJ'], ['SB', 'CO'], ['SB', 'BTN'],
    ['HJ', 'UTG'], ['CO', 'UTG'], ['CO', 'HJ'],
  ];

  it('十五个单次加注底池节点全部存在', () => {
    for (const [pos, opener] of allVsOpen) {
      const key = vsOpenKey(pos, opener);
      if (!hasNode(key)) throw new Error(`缺少节点 ${key}`);
    }
  });

  it('新增节点的频率之和仍然为 1', () => {
    for (const key of ['HJ_vs_UTG_open', 'CO_vs_UTG_open', 'CO_vs_HJ_open',
                       'SB_vs_UTG_open', 'SB_vs_HJ_open']) {
      for (const hc of allHandClasses()) {
        const f = actionFreqs(key, hc)!;
        const sum = Object.values(f).reduce((a, b) => a + b, 0);
        expect(Math.abs(sum - 1)).toBeLessThan(0.001);
      }
    }
  });

  it('面对越靠前的开池，防守越紧', () => {
    // CO 面对 UTG 开池应当比面对 HJ 开池防守得更紧
    const total = (key: string) =>
      rangeFraction(rangeForAction(key, 'call')!) + rangeFraction(rangeForAction(key, '3bet')!);
    expect(total('CO_vs_UTG_open')).toBeLessThan(total('CO_vs_HJ_open'));
  });

  it('小盲面对同一开池比大盲防守得紧（位置劣势）', () => {
    const total = (key: string) =>
      rangeFraction(rangeForAction(key, 'call')!) + rangeFraction(rangeForAction(key, '3bet')!);
    expect(total('SB_vs_UTG_open')).toBeLessThan(total('BB_vs_UTG_open'));
  });
});
```

顶部 import 补上 `Position`（来自 `../types`）与 `allHandClasses`（来自 `../handClass`），若尚未导入。

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run src/core/ranges/ranges.test.ts`
Expected: FAIL —— 「十五个单次加注底池节点全部存在」报缺少节点

（若先写了 Step 1 再跑，此条会直接通过。那也可以，但要在报告里说明你实际的执行顺序，不要谎称看到了红灯。）

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/ranges/ranges.test.ts`
Expected: PASS

若「面对越靠前的开池，防守越紧」或「小盲比大盲紧」失败，说明新写的记法宽窄不对。**调整 `data.ts` 的记法，不要放宽测试** —— 这两条是扑克常识的编码，是这批手写数据仅有的外部校验。

- [ ] **Step 5: 跑全套并提交**

Run: `npm test` 与 `npm run typecheck`

```bash
git add src/core/ranges/
git commit -m "feat(core): 补齐五个面对开池的翻前节点

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 翻前牌力表预计算

`rankRange` 每次调用都要对范围里每个组合做蒙特卡洛。翻前没有公共牌，每个起手牌类别的牌力是**固定值** —— 同一张表可以被所有手牌、所有对手、整个进程复用。终审实测六人桌翻前一次估值约 250ms，而 AI 的预算是 100ms；这一项是最大的杠杆。

**Files:**
- Modify: `src/core/rangeStrength.ts`（新增私有查表逻辑与一个导出的预热函数）
- Test: `src/core/rangeStrength.test.ts`（追加，不改既有断言）

**Interfaces:**
- Consumes: 本文件既有的 `rankRange` 实现
- Produces: `warmPreflopStrength(): void` —— 可选的预热入口，不调用也不影响正确性

**关键前提**：翻前牌力只依赖手牌类别，与死牌无关。死牌影响的是「哪些具体组合还存在」，那由 `rangeCombos` 负责，与每个类别的强度值无关。

- [ ] **Step 1: 写失败的测试**

在 `src/core/rangeStrength.test.ts` 末尾追加：

```ts
describe('翻前牌力查表', () => {
  it('翻前排序与逐个采样的结果高度一致', () => {
    // 查表版与采样版对同一范围应给出几乎相同的顺序
    const range = parseRange('22+, A2s+, K9s+, QTs+, JTs, ATo+, KQo');
    const ranked = rankRange(range, [], [], 120, createRng('table-1'));
    const classes = ranked.map(r => r.handClass);
    // 最强的应当是 AA，最弱的不应当是对子
    expect(classes[0]).toBe('AA');
    expect(ranked[ranked.length - 1].strength).toBeLessThan(ranked[0].strength);
  });

  it('翻前结果与随机种子无关', () => {
    const range = parseRange('22+, A2s+, KTs+');
    const a = rankRange(range, [], [], 120, createRng('seed-a')).map(r => r.handClass);
    const b = rankRange(range, [], [], 120, createRng('seed-b')).map(r => r.handClass);
    expect(a).toEqual(b);
  });

  it('翻前同一类别的所有组合强度相同', () => {
    const ranked = rankRange(parseRange('AA'), [], [], 120, createRng('table-2'));
    const strengths = new Set(ranked.map(r => r.strength));
    expect(strengths.size).toBe(1);
  });

  it('死牌只减少组合数，不改变强度值', () => {
    const withAll = rankRange(parseRange('AA'), [], [], 120, createRng('table-3'));
    const withDead = rankRange(parseRange('AA'), [], parseCards('As'), 120, createRng('table-3'));
    expect(withDead).toHaveLength(3);
    expect(withDead[0].strength).toBe(withAll[0].strength);
  });

  it('翻后仍然走采样，不受查表影响', () => {
    // 有公共牌时结果必须依赖牌面：7h7d2c 上 72o 成葫芦，强过 AA
    const board = parseCards('7h 7d 2c');
    const ranked = rankRange(parseRange('AA, 72o'), board, board, 200, createRng('table-4'));
    expect(ranked[0].handClass).toBe('72o');
  });

  it('预热函数可重复调用且不改变结果', () => {
    warmPreflopStrength();
    const a = rankRange(parseRange('22+'), [], [], 120, createRng('warm')).map(r => r.strength);
    warmPreflopStrength();
    const b = rankRange(parseRange('22+'), [], [], 120, createRng('warm')).map(r => r.strength);
    expect(a).toEqual(b);
  });
});
```

顶部 import 补上 `warmPreflopStrength`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/rangeStrength.test.ts`
Expected: FAIL —— `warmPreflopStrength` 未导出

- [ ] **Step 3: 实现查表**

在 `src/core/rangeStrength.ts` 里，`rankRange` 之前加入：

```ts
/** 翻前牌力表：类别 -> 对一个随机手的胜率。整个进程只算一次。 */
let preflopTable: Map<HandClass, number> | null = null;

/** 计算翻前牌力表用的固定种子与样本数。固定是刻意的 —— 表必须与调用方的种子无关。 */
const PREFLOP_TABLE_SEED = 'preflop-strength-table';
const PREFLOP_TABLE_SAMPLES = 1500;

function buildPreflopTable(): Map<HandClass, number> {
  const rng = createRng(PREFLOP_TABLE_SEED);
  const table = new Map<HandClass, number>();
  // 每个类别取其第一个具体组合来估强度 —— 同一类别的组合在翻前是同构的
  for (const hc of allHandClasses()) {
    const cards = expandCombos(hc)[0];
    table.set(hc, equityMonteCarlo(cards, [], 1, PREFLOP_TABLE_SAMPLES, rng));
  }
  return table;
}

/**
 * 预热翻前牌力表。可选 —— 不调用的话第一次翻前排序会自动建表。
 * 想把建表开销挪到启动阶段而不是第一次决策时，就调用它。
 */
export function warmPreflopStrength(): void {
  if (!preflopTable) preflopTable = buildPreflopTable();
}
```

顶部 import 补上 `createRng`（来自 `./rng`）、`allHandClasses` 与 `expandCombos`（来自 `./handClass`）、`equityMonteCarlo`（来自 `./equity`）。

然后在 `rankRange` 函数体最前面（`const combos = rangeCombos(range, dead);` 之后）插入翻前分支：

```ts
  // 翻前没有公共牌，每个类别的牌力是固定值，查表即可 —— 这是 AI 决策预算里最大的一项。
  // 注意查表结果与传入的 rng 无关，这是刻意的：同一手牌无论谁来问、用什么种子，
  // 翻前的强弱顺序都应当一致。
  if (board.length === 0) {
    if (!preflopTable) preflopTable = buildPreflopTable();
    const out: RankedCombo[] = combos.map(c => ({
      ...c,
      strength: preflopTable!.get(c.handClass) ?? 0,
    }));
    out.sort((a, b) => b.strength - a.strength);
    return out;
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/rangeStrength.test.ts`
Expected: PASS，既有断言一条不变

- [ ] **Step 5: 测量收益**

写一个临时脚本或测试文件，测量 `rankRange(fullRange(), [], [], 120, rng)` 在改动前后的耗时，报告两个数字。跑完删掉临时文件。

若加速不明显，如实说明，不要把数字往上凑。

- [ ] **Step 6: 跑全套并提交**

Run: `npm test` 与 `npm run typecheck`

```bash
git add src/core/rangeStrength.ts src/core/rangeStrength.test.ts
git commit -m "perf(core): 翻前牌力改为查表，整个进程只算一次

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 性格原型

**Files:**
- Create: `src/ai/personas.ts`
- Test: `src/ai/personas.test.ts`

**Interfaces:**
- Consumes: `Rng`（`../core/rng`）
- Produces:
  - `interface Persona { id; name; rangeWidthMul; aggression; bluffFreq; callThresholdMul; cbetFreq }`
  - `PERSONAS: readonly Persona[]` —— 六个预置原型
  - `getPersona(id: string): Persona` —— 未知 id 抛错
  - `GTO_PERSONA: Persona` —— 全部倍率为中性的那一个，用于「全 GTO 模式」
  - `assignPersonas(seats: readonly number[], rng: Rng, heroSeat: number): Map<number, string>` —— 随机分配，hero 座位固定为 `'hero'`

各字段的含义（spec §7.1）：

| 字段 | 含义 | 中性值 |
|---|---|---|
| `rangeWidthMul` | 相对 GTO 范围的宽窄倍率，>1 更宽 | 1 |
| `aggression` | 主动下注/加注倾向，>1 更爱进攻 | 1 |
| `bluffFreq` | 在 EV 不占优时仍然选进攻动作的概率 | 0 |
| `callThresholdMul` | 跟注所需 EV 的倍率，<1 跟得更松 | 1 |
| `cbetFreq` | 作为翻前加注者在翻牌圈持续下注的倾向 | 0.5 |

- [ ] **Step 1: 写失败的测试**

创建 `src/ai/personas.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { createRng } from '../core/rng';
import { PERSONAS, GTO_PERSONA, getPersona, assignPersonas } from './personas';

describe('PERSONAS', () => {
  it('预置六个原型', () => {
    expect(PERSONAS).toHaveLength(6);
  });

  it('id 互不重复', () => {
    expect(new Set(PERSONAS.map(p => p.id)).size).toBe(PERSONAS.length);
  });

  it('每个原型的参数都在合理区间内', () => {
    for (const p of PERSONAS) {
      expect(p.rangeWidthMul).toBeGreaterThan(0.2);
      expect(p.rangeWidthMul).toBeLessThan(3);
      expect(p.aggression).toBeGreaterThan(0.2);
      expect(p.aggression).toBeLessThan(3);
      expect(p.bluffFreq).toBeGreaterThanOrEqual(0);
      expect(p.bluffFreq).toBeLessThanOrEqual(1);
      expect(p.callThresholdMul).toBeGreaterThan(0.2);
      expect(p.callThresholdMul).toBeLessThan(3);
      expect(p.cbetFreq).toBeGreaterThanOrEqual(0);
      expect(p.cbetFreq).toBeLessThanOrEqual(1);
    }
  });

  it('原型之间在性格上确实拉开了差距', () => {
    // 跟注站应当比岩石跟得松得多
    const station = getPersona('station');
    const rock = getPersona('rock');
    expect(station.callThresholdMul).toBeLessThan(rock.callThresholdMul);
    // 疯子应当比岩石激进得多、诈唬得多
    const maniac = getPersona('maniac');
    expect(maniac.aggression).toBeGreaterThan(rock.aggression);
    expect(maniac.bluffFreq).toBeGreaterThan(rock.bluffFreq);
    // 松凶范围比紧凶宽
    expect(getPersona('lag').rangeWidthMul).toBeGreaterThan(getPersona('tag').rangeWidthMul);
  });
});

describe('GTO_PERSONA', () => {
  it('所有倍率都是中性的', () => {
    expect(GTO_PERSONA.rangeWidthMul).toBe(1);
    expect(GTO_PERSONA.aggression).toBe(1);
    expect(GTO_PERSONA.callThresholdMul).toBe(1);
    expect(GTO_PERSONA.bluffFreq).toBe(0);
  });
});

describe('getPersona', () => {
  it('按 id 取到对应原型', () => {
    expect(getPersona('tag').id).toBe('tag');
  });

  it('未知 id 抛错，且错误信息里带上那个 id', () => {
    expect(() => getPersona('nope')).toThrow(/nope/);
  });

  it('能取到 GTO 原型', () => {
    expect(getPersona(GTO_PERSONA.id)).toBe(GTO_PERSONA);
  });
});

describe('assignPersonas', () => {
  it('每个座位都分到一个原型', () => {
    const m = assignPersonas([0, 1, 2, 3, 4, 5], createRng('assign-1'), 0);
    expect(m.size).toBe(6);
  });

  it('hero 座位固定为 hero', () => {
    const m = assignPersonas([0, 1, 2, 3, 4, 5], createRng('assign-2'), 0);
    expect(m.get(0)).toBe('hero');
  });

  it('其余座位分到的都是真实原型 id', () => {
    const m = assignPersonas([0, 1, 2, 3, 4, 5], createRng('assign-3'), 0);
    const ids = new Set(PERSONAS.map(p => p.id));
    for (const [seat, id] of m) {
      if (seat === 0) continue;
      expect(ids.has(id)).toBe(true);
    }
  });

  it('相同 seed 分配结果相同', () => {
    const a = assignPersonas([0, 1, 2, 3, 4, 5], createRng('same'), 0);
    const b = assignPersonas([0, 1, 2, 3, 4, 5], createRng('same'), 0);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('不同 seed 通常分出不同的组合', () => {
    const a = assignPersonas([0, 1, 2, 3, 4, 5], createRng('x'), 0);
    const b = assignPersonas([0, 1, 2, 3, 4, 5], createRng('y'), 0);
    expect([...a.entries()]).not.toEqual([...b.entries()]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/ai/personas.test.ts`
Expected: FAIL，找不到模块 `./personas`

- [ ] **Step 3: 实现 personas.ts**

创建 `src/ai/personas.ts`：

```ts
import type { Rng } from '../core/rng';

/**
 * AI 对手的性格参数。
 *
 * 这些倍率不改变局面的客观估值 —— EV 由 core/evEstimate 统一算出，
 * 性格只影响「拿到这组 EV 之后怎么选」。这样 AI 的世界观和复盘引擎的
 * 判定标准始终是同一个，差别只在偏好。
 */
export interface Persona {
  id: string;
  name: string;
  /** 相对 GTO 范围的宽窄倍率，>1 更宽 */
  rangeWidthMul: number;
  /** 主动下注/加注倾向，>1 更爱进攻 */
  aggression: number;
  /** 在 EV 不占优时仍然选进攻动作的概率 */
  bluffFreq: number;
  /** 跟注所需 EV 的倍率，<1 跟得更松 */
  callThresholdMul: number;
  /** 作为翻前加注者在翻牌圈持续下注的倾向 */
  cbetFreq: number;
}

/** 全部中性的原型，用于设置里的「全 GTO 模式」 */
export const GTO_PERSONA: Persona = {
  id: 'gto',
  name: '平衡',
  rangeWidthMul: 1,
  aggression: 1,
  bluffFreq: 0,
  callThresholdMul: 1,
  cbetFreq: 0.55,
};

export const PERSONAS: readonly Persona[] = [
  GTO_PERSONA,
  { id: 'tag',     name: '紧凶',   rangeWidthMul: 0.85, aggression: 1.25, bluffFreq: 0.12, callThresholdMul: 1.15, cbetFreq: 0.70 },
  { id: 'lag',     name: '松凶',   rangeWidthMul: 1.45, aggression: 1.40, bluffFreq: 0.28, callThresholdMul: 0.95, cbetFreq: 0.75 },
  { id: 'station', name: '跟注站', rangeWidthMul: 1.60, aggression: 0.55, bluffFreq: 0.03, callThresholdMul: 0.55, cbetFreq: 0.30 },
  { id: 'rock',    name: '岩石',   rangeWidthMul: 0.55, aggression: 0.80, bluffFreq: 0.02, callThresholdMul: 1.45, cbetFreq: 0.50 },
  { id: 'maniac',  name: '疯子',   rangeWidthMul: 1.90, aggression: 1.85, bluffFreq: 0.45, callThresholdMul: 0.75, cbetFreq: 0.85 },
];

export function getPersona(id: string): Persona {
  const p = PERSONAS.find(x => x.id === id);
  if (!p) throw new Error(`未知的性格原型: "${id}"`);
  return p;
}

/**
 * 给每个座位分配一个性格原型。hero 的座位固定为 'hero'，
 * 因为 hero 由人操作，没有 AI 性格。
 *
 * 座位与原型的绑定在一手牌内保持不变 —— 调用方每手牌调用一次即可。
 */
export function assignPersonas(
  seats: readonly number[],
  rng: Rng,
  heroSeat: number,
): Map<number, string> {
  const out = new Map<number, string>();
  for (const seat of seats) {
    if (seat === heroSeat) {
      out.set(seat, 'hero');
      continue;
    }
    out.set(seat, PERSONAS[rng.nextInt(PERSONAS.length)].id);
  }
  return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/ai/personas.test.ts`
Expected: PASS

- [ ] **Step 5: 跑全套并提交**

```bash
git add src/ai/personas.ts src/ai/personas.test.ts
git commit -m "feat(ai): 六个性格原型与座位分配

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: AI 决策

本计划的核心。AI 不自己判断局面 —— 它构造 `Situation`、调用 `estimateEv` 拿到各动作 EV，再按性格扰动后选一个**合法**动作。

**Files:**
- Create: `src/ai/decide.ts`
- Test: `src/ai/decide.test.ts`

**Interfaces:**
- Consumes: `GameState`, `ActionType`（`../core/types`）；`LegalAction`, `ActionInput`, `legalActions`（`../core/gameEngine`）；`Situation`, `SituationOptions`, `situationFromGameState`（`../core/situation`）；`EvCandidate`, `EvResult`, `estimateEv`（`../core/evEstimate`）；`Rng`（`../core/rng`）；`chipsGreater`, `round2`（`../core/chips`）；`Persona`, `getPersona`, `GTO_PERSONA`（`./personas`）；`RangeSet`（`../core/rangeSet`）
- Produces:
  - `interface DecideOptions { ranges: Map<number, RangeSet>; personaIds: Map<number, string>; rng: Rng; iterations?: number; strengthIterations?: number }`
  - `interface Decision { action: ActionInput; persona: Persona; ev: EvResult; chosen: EvCandidate; score: number }`
  - `decide(state: GameState, opts: DecideOptions): Decision`

**三条必须守住的规则**：

1. **返回的动作必须合法。** `estimateEv` 的候选尺度里有些引擎不接受（翻前最小加注 2BB，而 `bet 1/3` 只有 1.5BB）。先用 `legalActions(state)` 过滤，再在剩下的里选。
2. **候选被过滤空时必须有兜底。** 至少 `fold`（或无需跟注时的 `check`）总是合法的。
3. **动作金额必须落在合法区间内。** 候选的 `investment` 要夹到对应 `LegalAction` 的 `[min, max]`。

**性格如何扰动**（在 EV 之上加一个偏好分，不改 EV 本身）：

```
score(候选) = ev
            + 进攻动作 ? (aggression − 1) × pot × 0.08 : 0
            + 跟注动作 ? (1 − callThresholdMul) × toCall : 0
            + 翻牌圈且自己是翻前加注者且为下注动作 ? (cbetFreq − 0.5) × pot × 0.10 : 0
```

再叠一次诈唬：以 `bluffFreq` 的概率，若存在进攻候选，直接选其中 `score` 最高的那个，无视是否为全局最优。

系数 `0.08` / `0.10` 是手调的，作用是让性格差异可见但不至于压过 EV 本身。它们没有外部锚点，这一点要在代码注释里写明。

- [ ] **Step 1: 写失败的测试**

创建 `src/ai/decide.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { startHand, applyAction, legalActions } from '../core/gameEngine';
import type { GameState, Street } from '../core/types';
import { SEAT_COUNT } from '../core/types';
import { createRng } from '../core/rng';
import { fullRange } from '../core/rangeSet';
import type { RangeSet } from '../core/rangeSet';
import { initialRange } from '../core/opponentRange';
import { PERSONAS } from './personas';
import { decide } from './decide';

function opts(personaId: string, seed = 'decide') {
  const ranges = new Map<number, RangeSet>();
  const personaIds = new Map<number, string>();
  for (let i = 0; i < SEAT_COUNT; i++) {
    ranges.set(i, fullRange());
    personaIds.set(i, personaId);
  }
  return { ranges, personaIds, rng: createRng(seed), iterations: 300, strengthIterations: 30 };
}

describe('decide 返回合法动作', () => {
  it('翻前首个决策点给出的动作在 legalActions 里', () => {
    const s = startHand({ seed: 'dec-1', buttonSeat: 0 });
    const d = decide(s, opts('tag'));
    const legal = legalActions(s);
    expect(legal.some(a => a.type === d.action.type)).toBe(true);
  });

  it('加注金额落在合法区间内', () => {
    const s = startHand({ seed: 'dec-2', buttonSeat: 0 });
    for (const p of PERSONAS) {
      const d = decide(s, opts(p.id, `amt-${p.id}`));
      const match = legalActions(s).find(a => a.type === d.action.type)!;
      if (d.action.amount !== undefined) {
        expect(d.action.amount).toBeGreaterThanOrEqual(match.min - 1e-9);
        expect(d.action.amount).toBeLessThanOrEqual(match.max + 1e-9);
      }
    }
  });

  it('返回的动作能被引擎接受', () => {
    const s = startHand({ seed: 'dec-3', buttonSeat: 0 });
    const d = decide(s, opts('lag'));
    expect(() => applyAction(s, d.action)).not.toThrow();
  });

  it('本手已结束时抛错', () => {
    let s = startHand({ seed: 'dec-4', buttonSeat: 0 });
    for (let i = 0; i < 5 && !s.handOver; i++) s = applyAction(s, { type: 'fold' });
    expect(() => decide(s, opts('tag'))).toThrow();
  });
});

describe('decide 反映性格差异', () => {
  it('跟注站比岩石更少弃牌', () => {
    let stationFolds = 0;
    let rockFolds = 0;
    for (let i = 0; i < 40; i++) {
      let s = startHand({ seed: `fold-${i}`, buttonSeat: i % SEAT_COUNT });
      // 先加注一手，制造一个需要跟注的局面
      s = applyAction(s, { type: 'raise', amount: 3 });
      if (s.handOver) continue;
      if (decide(s, opts('station', `st-${i}`)).action.type === 'fold') stationFolds++;
      if (decide(s, opts('rock', `rk-${i}`)).action.type === 'fold') rockFolds++;
    }
    expect(stationFolds).toBeLessThan(rockFolds);
  });

  it('疯子比岩石更常选进攻动作', () => {
    const aggressive = new Set(['bet', 'raise', 'allin']);
    let maniacAgg = 0;
    let rockAgg = 0;
    for (let i = 0; i < 40; i++) {
      const s = startHand({ seed: `agg-${i}`, buttonSeat: i % SEAT_COUNT });
      if (aggressive.has(decide(s, opts('maniac', `mn-${i}`)).action.type)) maniacAgg++;
      if (aggressive.has(decide(s, opts('rock', `rk2-${i}`)).action.type)) rockAgg++;
    }
    expect(maniacAgg).toBeGreaterThan(rockAgg);
  });

  it('GTO 原型不叠加任何偏好，评分等于 EV 本身', () => {
    // GTO 的 aggression / callThresholdMul 都是 1，bluffFreq 为 0，
    // 所以 personaScore 的三项加成全为 0，score 必须与所选候选的 ev 相等。
    // 注意不能断言「选的就是 ev.recommended」—— 推荐候选可能因非法尺度被过滤掉。
    const s = startHand({ seed: 'dec-gto', buttonSeat: 0 });
    const d = decide(s, { ...opts('gto'), rng: createRng('no-bluff') });
    expect(d.score).toBeCloseTo(d.chosen.ev, 9);
  });

  it('有性格的原型确实叠加了偏好', () => {
    // 疯子的 aggression 远大于 1，只要它选的是进攻动作，score 就必然高于 ev
    const s = startHand({ seed: 'dec-maniac', buttonSeat: 0 });
    const d = decide(s, opts('maniac', 'bias'));
    const aggressive = new Set(['bet', 'raise', 'allin']);
    if (aggressive.has(d.chosen.actionType)) {
      expect(d.score).toBeGreaterThan(d.chosen.ev);
    }
  });
});

describe('decide 可复现', () => {
  it('相同 seed 决策相同', () => {
    const s = startHand({ seed: 'dec-repro', buttonSeat: 0 });
    const a = decide(s, opts('lag', 'same-seed'));
    const b = decide(s, opts('lag', 'same-seed'));
    expect(a.action).toEqual(b.action);
    expect(a.score).toBe(b.score);
  });
});

describe('decide 返回诊断信息', () => {
  it('带上用到的性格、完整的 EV 结果与被选中的候选', () => {
    const s = startHand({ seed: 'dec-diag', buttonSeat: 0 });
    const d = decide(s, opts('tag'));
    expect(d.persona.id).toBe('tag');
    expect(d.ev.candidates.length).toBeGreaterThan(0);
    expect(d.ev.candidates).toContain(d.chosen);
    expect(Number.isFinite(d.score)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/ai/decide.test.ts`
Expected: FAIL，找不到模块 `./decide`

- [ ] **Step 3: 实现 decide.ts**

创建 `src/ai/decide.ts`：

```ts
import type { GameState, Street } from '../core/types';
import type { ActionInput, LegalAction } from '../core/gameEngine';
import { legalActions } from '../core/gameEngine';
import { situationFromGameState } from '../core/situation';
import type { EvCandidate, EvResult } from '../core/evEstimate';
import { estimateEv } from '../core/evEstimate';
import type { Rng } from '../core/rng';
import { chipsGreater, round2 } from '../core/chips';
import type { RangeSet } from '../core/rangeSet';
import type { Persona } from './personas';
import { getPersona, GTO_PERSONA } from './personas';

export interface DecideOptions {
  /** 座位号 -> 该座位的手牌范围 */
  ranges: Map<number, RangeSet>;
  /** 座位号 -> persona id */
  personaIds: Map<number, string>;
  rng: Rng;
  /** 主胜率估算的迭代数。默认 500 —— AI 有时间预算，比复盘时低 */
  iterations?: number;
  /** 范围牌力排序的迭代数。默认 40 */
  strengthIterations?: number;
}

export interface Decision {
  action: ActionInput;
  persona: Persona;
  ev: EvResult;
  chosen: EvCandidate;
  /** 该候选经性格扰动后的偏好分 */
  score: number;
}

const AGGRESSIVE = new Set(['bet', 'raise', 'allin']);

/**
 * 性格扰动的系数。手调，没有外部锚点 —— 作用是让性格差异在牌桌上看得出来，
 * 又不至于压过 EV 本身。调大会让 AI 更像它的标签、更不像在算牌。
 */
const AGGRESSION_WEIGHT = 0.08;
const CBET_WEIGHT = 0.10;

/**
 * AI 的一次决策。
 *
 * AI 不自己判断局面：它构造 Situation 交给 core/evEstimate 算出各动作的 EV，
 * 再按性格在这组 EV 上加一个偏好分来选。这样 AI 的世界观与复盘引擎完全一致，
 * 不会出现「复盘说该弃牌、AI 在同样局面从不弃」的割裂。
 */
export function decide(state: GameState, opts: DecideOptions): Decision {
  if (state.handOver || state.toAct === null) {
    throw new Error('本手已结束或无人待行动，无法决策');
  }

  const legal = legalActions(state);
  if (legal.length === 0) throw new Error(`座位 ${state.toAct} 没有合法动作`);

  const personaId = opts.personaIds.get(state.toAct) ?? GTO_PERSONA.id;
  const persona = personaId === 'hero' ? GTO_PERSONA : getPersona(personaId);

  const sit = situationFromGameState(state, {
    ranges: opts.ranges,
    personaIds: opts.personaIds,
  });

  const ev = estimateEv(sit, {
    iterations: opts.iterations ?? 500,
    strengthIterations: opts.strengthIterations ?? 40,
    rng: opts.rng,
  });

  // 只保留引擎认可的候选。estimateEv 不知道最小加注额，
  // 会给出翻前 1.5BB 这类非法尺度。
  const usable = ev.candidates
    .map(c => ({ candidate: c, legal: legal.find(a => a.type === c.actionType) }))
    .filter((x): x is { candidate: EvCandidate; legal: LegalAction } => x.legal !== undefined)
    .filter(x => x.candidate.investment >= x.legal.min - 1e-9);

  if (usable.length === 0) {
    // 兜底：弃牌或过牌总有一个是合法的
    const fallback = legal.find(a => a.type === 'check') ?? legal.find(a => a.type === 'fold') ?? legal[0];
    const chosen = ev.candidates.find(c => c.actionType === fallback.type) ?? ev.candidates[0];
    return {
      action: { type: fallback.type },
      persona,
      ev,
      chosen,
      score: chosen.ev,
    };
  }

  const scored = usable.map(x => ({
    ...x,
    score: personaScore(x.candidate, sit.pot, sit.toCall, sit.street, sit.heroIsPreflopAggressor, persona),
  }));

  let best = scored[0];
  for (const s of scored) if (s.score > best.score) best = s;

  // 诈唬：以 bluffFreq 的概率改选进攻候选里偏好分最高的那个
  if (opts.rng.nextFloat() < persona.bluffFreq) {
    const aggressive = scored.filter(s => AGGRESSIVE.has(s.candidate.actionType));
    if (aggressive.length > 0) {
      let top = aggressive[0];
      for (const a of aggressive) if (a.score > top.score) top = a;
      best = top;
    }
  }

  return {
    action: toActionInput(best.candidate, best.legal),
    persona,
    ev,
    chosen: best.candidate,
    score: best.score,
  };
}

/** 在 EV 之上叠加性格偏好。不改 EV 本身 —— 客观估值对所有性格是同一个。 */
function personaScore(
  c: EvCandidate,
  pot: number,
  toCall: number,
  street: Street,
  isPreflopAggressor: boolean,
  p: Persona,
): number {
  let score = c.ev;

  if (AGGRESSIVE.has(c.actionType)) {
    score += (p.aggression - 1) * pot * AGGRESSION_WEIGHT;
  }
  if (c.actionType === 'call') {
    // callThresholdMul < 1 表示跟得松：等价于把跟注的门槛下调
    score += (1 - p.callThresholdMul) * toCall;
  }
  if (street === 'flop' && isPreflopAggressor && c.actionType === 'bet') {
    score += (p.cbetFreq - 0.5) * pot * CBET_WEIGHT;
  }

  return score;
}

/** 把候选映射成引擎接受的动作，金额夹到合法区间 */
function toActionInput(c: EvCandidate, legal: LegalAction): ActionInput {
  if (c.actionType === 'fold' || c.actionType === 'check') {
    return { type: c.actionType };
  }
  if (c.actionType === 'call' || c.actionType === 'allin') {
    return { type: c.actionType };
  }
  const amount = round2(Math.min(Math.max(c.investment, legal.min), legal.max));
  return { type: c.actionType, amount };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/ai/decide.test.ts`
Expected: PASS

若「跟注站比岩石更少弃牌」或「疯子比岩石更常进攻」失败，说明扰动系数太小、被 EV 压住了。**调大 `AGGRESSION_WEIGHT` 或性格参数本身，不要放宽测试** —— 这两条是「性格真的起作用了」仅有的证据。

- [ ] **Step 5: 跑全套并提交**

Run: `npm test` 与 `npm run typecheck`

```bash
git add src/ai/decide.ts src/ai/decide.test.ts
git commit -m "feat(ai): 基于 EV 的性格化决策

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: AI 自对弈与时间预算

验收关卡。让六个 AI 互相打，验证牌局能正常结束、筹码守恒、动作全部合法，并测量单次决策耗时。

**Files:**
- Create: `src/ai/selfPlayAi.ts`
- Test: `src/ai/selfPlayAi.test.ts`

**Interfaces:**
- Consumes: `startHand`, `applyAction`, `settleHand`, `totalChips`（`../core/gameEngine`）；`toHandRecord`（`../core/handRecord`）；`initialRange`, `narrowByAction`（`../core/opponentRange`）；`assignPersonas`（`./personas`）；`decide`（`./decide`）；`warmPreflopStrength`（`../core/rangeStrength`）
- Produces:
  - `interface AiHandResult { state: GameState; record: HandRecord; decisions: number; maxDecisionMs: number }`
  - `playAiHand(seed: string, buttonSeat: number, opts?: { iterations?: number; strengthIterations?: number }): AiHandResult`

每个对手的范围从其位置的开池范围起手，随其动作逐街收窄 —— 这条链路和复盘引擎将来要走的是同一条。

- [ ] **Step 1: 写失败的测试**

创建 `src/ai/selfPlayAi.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { totalChips } from '../core/gameEngine';
import { SEAT_COUNT, STARTING_STACK } from '../core/types';
import { cardToString } from '../core/cards';
import { warmPreflopStrength } from '../core/rangeStrength';
import { playAiHand } from './selfPlayAi';

const CHIPS = SEAT_COUNT * STARTING_STACK;

describe('AI 自对弈', () => {
  it('两百手都能正常结束且筹码守恒', () => {
    warmPreflopStrength();
    for (let i = 0; i < 200; i++) {
      const seed = `ai-${i}`;
      const { state } = playAiHand(seed, i % SEAT_COUNT, { iterations: 200, strengthIterations: 20 });

      if (!state.handOver) throw new Error(`seed=${seed} 本手未结束`);
      if (Math.abs(totalChips(state) - CHIPS) > 1e-9) {
        throw new Error(`seed=${seed} 筹码不守恒: ${totalChips(state)}`);
      }
      const sum = state.results!.reduce((a, r) => a + r.netBB, 0);
      if (Math.abs(sum) > 1e-9) throw new Error(`seed=${seed} 净盈亏之和 ${sum} != 0`);
      if (state.seats.some(x => x.stack < 0)) throw new Error(`seed=${seed} 出现负筹码`);
    }
  }, 300_000);

  it('产出的手牌记录里没有重复牌', () => {
    warmPreflopStrength();
    for (let i = 0; i < 30; i++) {
      const { record } = playAiHand(`ai-cards-${i}`, i % SEAT_COUNT, { iterations: 150, strengthIterations: 15 });
      const all = [...record.seats.flatMap(s => s.holeCards), ...record.board].map(cardToString);
      expect(new Set(all).size).toBe(all.length);
    }
  }, 120_000);

  it('相同 seed 打出完全相同的牌局', () => {
    const a = playAiHand('ai-repro', 2, { iterations: 150, strengthIterations: 15 });
    const b = playAiHand('ai-repro', 2, { iterations: 150, strengthIterations: 15 });
    expect(JSON.stringify(a.record)).toBe(JSON.stringify(b.record));
  }, 60_000);

  it('多种结束方式都会出现', () => {
    warmPreflopStrength();
    const streets = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const { state } = playAiHand(`ai-var-${i}`, i % SEAT_COUNT, { iterations: 150, strengthIterations: 15 });
      streets.add(state.street);
    }
    // AI 不像随机智能体那样满桌全下，应当既有翻前结束的也有打到后面的
    expect(streets.size).toBeGreaterThan(1);
  }, 180_000);
});

describe('决策时间预算', () => {
  it('单次决策耗时报告出来供人工核对', () => {
    warmPreflopStrength();
    let worst = 0;
    for (let i = 0; i < 20; i++) {
      const { maxDecisionMs } = playAiHand(`ai-time-${i}`, i % SEAT_COUNT,
                                            { iterations: 500, strengthIterations: 40 });
      worst = Math.max(worst, maxDecisionMs);
    }
    // 只断言没有失控；具体数字由实现者在报告里给出，供人工判断是否满足手机预算
    expect(worst).toBeLessThan(3000);
  }, 300_000);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/ai/selfPlayAi.test.ts`
Expected: FAIL，找不到模块 `./selfPlayAi`

- [ ] **Step 3: 实现 selfPlayAi.ts**

创建 `src/ai/selfPlayAi.ts`：

```ts
import { startHand, applyAction, settleHand } from '../core/gameEngine';
import type { GameState, HandRecord } from '../core/types';
import { SEAT_COUNT, HERO_SEAT } from '../core/types';
import { toHandRecord } from '../core/handRecord';
import { createRng } from '../core/rng';
import type { RangeSet } from '../core/rangeSet';
import { initialRange, narrowByAction } from '../core/opponentRange';
import { assignPersonas } from './personas';
import { decide } from './decide';

export interface AiHandResult {
  state: GameState;
  record: HandRecord;
  /** 本手牌一共做了多少次 AI 决策 */
  decisions: number;
  /** 单次决策的最长耗时（毫秒） */
  maxDecisionMs: number;
}

export interface PlayAiHandOptions {
  iterations?: number;
  strengthIterations?: number;
}

/**
 * 六个 AI 互相打完一手牌。
 *
 * 每个座位的范围从其位置的开池范围起手，随该座位的每个动作逐街收窄 ——
 * 这条链路和复盘引擎将来重建对手范围时走的是同一条。
 */
export function playAiHand(
  seed: string,
  buttonSeat: number,
  opts: PlayAiHandOptions = {},
): AiHandResult {
  const rng = createRng(`${seed}-ai`);
  let state = startHand({ seed, buttonSeat });

  const personaIds = assignPersonas(
    state.seats.map(s => s.seat),
    createRng(`${seed}-persona`),
    HERO_SEAT,
  );

  const ranges = new Map<number, RangeSet>();
  for (const s of state.seats) ranges.set(s.seat, initialRange(s.position));

  let decisions = 0;
  let maxDecisionMs = 0;
  let guard = 0;

  while (!state.handOver) {
    if (++guard > 500) throw new Error(`seed=${seed} 疑似死锁：动作数超过 500`);

    const acting = state.toAct!;
    const before = state;

    const t0 = Date.now();
    const d = decide(state, {
      ranges,
      personaIds,
      rng,
      iterations: opts.iterations,
      strengthIterations: opts.strengthIterations,
    });
    maxDecisionMs = Math.max(maxDecisionMs, Date.now() - t0);
    decisions++;

    state = applyAction(state, d.action);

    // 按该座位刚做的动作收窄它的范围
    const prev = ranges.get(acting)!;
    ranges.set(acting, narrowByAction(prev, d.action.type, {
      street: before.street,
      board: before.board,
      dead: before.board,
      potBefore: before.seats.reduce((a, x) => a + x.totalContribution, 0),
      betSize: d.action.amount ?? 0,
      strengthIterations: opts.strengthIterations ?? 20,
      rng,
    }));
  }

  state = settleHand(state);

  const record = toHandRecord(state, {
    id: `${seed}-${buttonSeat}`,
    heroSeat: HERO_SEAT,
    personaIds: Object.fromEntries(personaIds),
    timestamp: 0,
  });

  return { state, record, decisions, maxDecisionMs };
}
```

**核对两处签名再动手**：`toHandRecord` 的 `personaIds` 参数是 `Record<number, string>` 还是 `Map`？`HandRecord` 是从 `../core/types` 还是别处导出的？照实际签名写，不要照抄上面的猜测。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/ai/selfPlayAi.test.ts`
Expected: PASS。两百手那条耗时较长，数分钟属正常。

若报错，错误信息里都带 `seed=`。用该 seed 单独调用 `playAiHand` 即可精确复现。**不要通过放宽断言来修绿** —— 筹码守恒失败一定意味着有真 bug。

- [ ] **Step 5: 报告决策耗时**

在报告里给出：单次决策的最长耗时、平均耗时，以及翻前与翻后分别的典型值。这是判断能否满足手机 100ms 预算的唯一依据，如实给出，不要挑最好看的数字。

- [ ] **Step 6: 跑全套并提交**

Run: `npm test` 与 `npm run typecheck`

```bash
git add src/ai/selfPlayAi.ts src/ai/selfPlayAi.test.ts
git commit -m "test(ai): 六个 AI 自对弈，筹码守恒与决策耗时

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 完成标准

- [ ] `npm test` 全绿，`npm run typecheck` 退出码 0
- [ ] 翻前范围表覆盖全部 15 个单次加注底池节点，且防守宽度符合位置常识
- [ ] 翻前牌力查表后，`rankRange` 在无公共牌时与随机种子无关
- [ ] 六个性格原型在跟注松紧与进攻倾向上确实拉开差距
- [ ] `decide` 返回的动作恒为引擎接受的合法动作
- [ ] 两百手 AI 自对弈筹码守恒、无死锁、无重复牌
- [ ] 报告中给出单次决策耗时的实测值

## 交付物清单

```
src/core/ranges/data.ts        （追加五个节点）
src/core/rangeStrength.ts      （追加翻前查表）
src/ai/personas.ts
src/ai/decide.ts
src/ai/selfPlayAi.ts
+ 对应的 *.test.ts
```

## 下一步

计划 ②-B-2（复盘引擎）在本计划完成后编写，将基于本计划实际产出的接口：
`Persona`、`decide`、`playAiHand`，以及 AI 打出的真实 `HandRecord`。

内容包括：从 `HandRecord` 重建 `Situation`（spec §4.3 的另一半，目前只有从活对局构造的那一半）、
错误分类 `MistakeTag` 与严重度阈值、翻前/翻后判定规则、`analyzeHand` 入口，
以及约 40 个答案无争议的金标准场景作为回归网。
