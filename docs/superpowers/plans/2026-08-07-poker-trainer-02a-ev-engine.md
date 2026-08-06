# 德州扑克训练器 — 计划 ②-A：估值引擎

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成「给定一个局面快照，算出每个候选动作的期望值」的能力。完成后命令行能对任意局面输出各动作 EV、推荐动作、以及跟注所需胜率。

**Architecture:** 新增一层建立在计划①引擎之上的估值模块。核心是 `Situation` —— 一个与来源无关的局面快照，对局中的 AI 和事后的复盘引擎都构造它、都走同一条估算路径，所以两者的判断标准天然一致。翻前用内置 GTO 范围表，翻后用蒙特卡洛胜率 + 底池赔率公式。

**Tech Stack:** TypeScript（strict）、Vitest、fast-check、Node 24 —— 与计划①相同，不新增依赖

**上游文档:** `docs/superpowers/specs/2026-08-06-texas-holdem-trainer-design.md`（§4.3、§6.5、§8.2、§8.3、§8.4、§8.5）

## 计划①已产出的接口（本计划的地基，不得修改）

```ts
// src/core/cards.ts
export type Suit = 's' | 'h' | 'd' | 'c';
export type Rank = 2|3|4|5|6|7|8|9|10|11|12|13|14;   // 14 = A
export interface Card { rank: Rank; suit: Suit }
export const SUITS: readonly Suit[];
export const RANKS: readonly Rank[];
export function makeDeck(): Card[];
export function cardToString(c: Card): string;
export function parseCard(s: string): Card;
export function parseCards(s: string): Card[];
export function sameCard(a: Card, b: Card): boolean;

// src/core/rng.ts
export interface Rng { nextU32(): number; nextFloat(): number; nextInt(n: number): number }
export function createRng(seed: string): Rng;
export function shuffle<T>(arr: readonly T[], rng: Rng): T[];

// src/core/chips.ts  （叶子模块，零依赖）
export function isZeroChips(v: number): boolean;              // Math.abs(v) < 1e-9
export function chipsGreater(a: number, b: number): boolean;  // a - b > 1e-9
export function round2(v: number): number;

// src/core/handEval.ts
export function evaluate7(cards: Card[]): number;   // 7 张 -> 可比较的整数分值，越大越强

// src/core/equity.ts
export function equityMonteCarlo(hero: [Card, Card], board: Card[], opponentCount: number,
                                 iterations: number, rng: Rng): number;
export function equityExactVsOne(hero: [Card, Card], board: Card[]): number;  // board.length < 3 时抛错

// src/core/types.ts
export type Position = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
export const SMALL_BLIND = 0.5, BIG_BLIND = 1, STARTING_STACK = 100, SEAT_COUNT = 6, HERO_SEAT = 0;
export const POSITION_ORDER: readonly Position[];   // ['BTN','SB','BB','UTG','HJ','CO']
export interface Action { seat, street, type, amount, potBefore, toCall, stackBefore }
export interface SeatState { seat, position, stack, holeCards, folded, allIn,
                             streetContribution, totalContribution, hasActedSinceLastFullRaise, startingStack }
export interface GameState { seed, buttonSeat, seats, board, deck, street, toAct,
                             currentBet, lastRaiseSize, actions, handOver, results, pots }
export interface HandRecord { id, schemaVersion, timestamp, seed, heroSeat, buttonSeat,
                              seats, board, actions, results, pots }

// src/core/gameEngine.ts
export interface LegalAction { type: ActionType; min: number; max: number }  // min/max 是「本次投入额」
export function startHand(opts: StartHandOptions): GameState;
export function legalActions(state: GameState): LegalAction[];
export function applyAction(state: GameState, input: ActionInput): GameState;
export function currentPot(state: GameState): number;
export function totalChips(state: GameState): number;

// src/core/pots.ts
export interface Pot { amount: number; eligible: number[] }
```

**注意一期遗留的一个事实**：盲注由 `startHand` 直接扣除，**不出现在 `actions` 里**。任何靠累加 `Action.amount` 重建投入的代码对小盲和大盲都会算错。

## Global Constraints

- 语言 TypeScript，`tsconfig.json` 已开启 `"strict": true`
- 本计划新增的所有文件都在 `src/core/` 下，同样**禁止** `import React`、`document`、`window`
- **禁止**直接调用 `Math.random()`；随机性一律由参数传入的 `Rng` 提供
- 金额比较用 `chips.ts` 的 `isZeroChips` / `chipsGreater`，**不要**用 `===` 或裸 `>`；概率与频率不是金额，用普通比较即可
- 手牌分值（`evaluate7` 的返回值）是整数，比较用 `===` / `>`，**不得**引入容差——平局必须精确判定
- 筹码单位为 BB。小盲 0.5、大盲 1.0、起始筹码 100
- 每个任务结束必须提交，提交信息用中文，末尾附 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- 本计划**不引入** React、Vite、IndexedDB，也不写 AI 决策和复盘引擎（那是计划②-B）
- 新增模块不得修改计划①的任何既有文件，唯一例外是 Task 5 向 `equity.ts` **追加**一个新导出

---

### Task 1: 起手牌分类与组合展开

169 种起手牌类别是范围表的索引单位。本任务建立类别与具体两张牌之间的双向映射。

**Files:**
- Create: `src/core/handClass.ts`
- Test: `src/core/handClass.test.ts`

**Interfaces:**
- Consumes: `Card`, `Rank`, `Suit`, `SUITS`, `RANKS`, `parseCards`, `cardToString`, `sameCard`（`./cards`）
- Produces:
  - `type HandClass = string` — `'AA'` / `'AKs'` / `'AKo'`
  - `RANK_CHARS = '23456789TJQKA'`
  - `classifyHand(a: Card, b: Card): HandClass`
  - `allHandClasses(): HandClass[]` — 169 个，顺序稳定
  - `comboCount(hc: HandClass): number` — 对子 6、同花 4、非同花 12
  - `expandCombos(hc: HandClass): Array<[Card, Card]>`
  - `parseHandClass(hc: HandClass): { hiIdx: number; loIdx: number; kind: 'pair' | 's' | 'o' }` — idx 为 0..12，0 是 2、12 是 A

- [ ] **Step 1: 写失败的测试**

创建 `src/core/handClass.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseCards, cardToString } from './cards';
import type { Card } from './cards';
import {
  classifyHand, allHandClasses, comboCount, expandCombos, parseHandClass, RANK_CHARS,
} from './handClass';

const c = (s: string) => parseCards(s) as [Card, Card];

describe('classifyHand', () => {
  it('对子只用两个点数字符', () => {
    expect(classifyHand(...c('As Ad'))).toBe('AA');
    expect(classifyHand(...c('2h 2c'))).toBe('22');
  });

  it('同花标 s，非同花标 o', () => {
    expect(classifyHand(...c('As Ks'))).toBe('AKs');
    expect(classifyHand(...c('As Kd'))).toBe('AKo');
  });

  it('大牌永远在前，与传入顺序无关', () => {
    expect(classifyHand(...c('Kd As'))).toBe('AKo');
    expect(classifyHand(...c('2s 7s'))).toBe('72s');
  });

  it('T 用字母表示', () => {
    expect(classifyHand(...c('Ts 9s'))).toBe('T9s');
  });
});

describe('allHandClasses', () => {
  it('恰好 169 种', () => {
    expect(allHandClasses()).toHaveLength(169);
  });

  it('无重复', () => {
    const all = allHandClasses();
    expect(new Set(all).size).toBe(169);
  });

  it('13 个对子、78 个同花、78 个非同花', () => {
    const all = allHandClasses();
    expect(all.filter(h => h.length === 2)).toHaveLength(13);
    expect(all.filter(h => h.endsWith('s'))).toHaveLength(78);
    expect(all.filter(h => h.endsWith('o'))).toHaveLength(78);
  });

  it('覆盖整副牌的所有两张组合', () => {
    // 169 个类别的组合数之和必须等于 C(52,2) = 1326
    const total = allHandClasses().reduce((s, h) => s + comboCount(h), 0);
    expect(total).toBe(1326);
  });
});

describe('comboCount', () => {
  it('对子 6 种、同花 4 种、非同花 12 种', () => {
    expect(comboCount('AA')).toBe(6);
    expect(comboCount('AKs')).toBe(4);
    expect(comboCount('AKo')).toBe(12);
  });
});

describe('expandCombos', () => {
  it('组合数与 comboCount 一致', () => {
    for (const hc of ['AA', 'AKs', 'AKo', '72o', 'T9s']) {
      expect(expandCombos(hc)).toHaveLength(comboCount(hc));
    }
  });

  it('展开出的每一组都能分类回原类别', () => {
    for (const hc of allHandClasses()) {
      for (const [a, b] of expandCombos(hc)) {
        expect(classifyHand(a, b)).toBe(hc);
      }
    }
  });

  it('同一组合内两张牌不重复', () => {
    for (const hc of ['AA', 'AKs', 'AKo']) {
      for (const [a, b] of expandCombos(hc)) {
        expect(cardToString(a)).not.toBe(cardToString(b));
      }
    }
  });

  it('全部 169 类展开后恰好覆盖 1326 个互不相同的组合', () => {
    const seen = new Set<string>();
    for (const hc of allHandClasses()) {
      for (const [a, b] of expandCombos(hc)) {
        // 用排序后的字符串做键，保证同一对牌只算一次
        seen.add([cardToString(a), cardToString(b)].sort().join(''));
      }
    }
    expect(seen.size).toBe(1326);
  });

  it('同花组合两张花色相同，非同花组合两张花色不同', () => {
    for (const [a, b] of expandCombos('AKs')) expect(a.suit).toBe(b.suit);
    for (const [a, b] of expandCombos('AKo')) expect(a.suit).not.toBe(b.suit);
  });
});

describe('parseHandClass', () => {
  it('解出点数下标与类型', () => {
    expect(parseHandClass('AA')).toEqual({ hiIdx: 12, loIdx: 12, kind: 'pair' });
    expect(parseHandClass('AKs')).toEqual({ hiIdx: 12, loIdx: 11, kind: 's' });
    expect(parseHandClass('72o')).toEqual({ hiIdx: 5, loIdx: 0, kind: 'o' });
  });

  it('非法类别抛错', () => {
    expect(() => parseHandClass('XX')).toThrow();
    expect(() => parseHandClass('AKx')).toThrow();
    expect(() => parseHandClass('AAs')).toThrow();   // 对子不能带花色标记
    expect(() => parseHandClass('KAs')).toThrow();   // 小牌在前
  });
});

describe('RANK_CHARS', () => {
  it('下标 0 是 2、下标 12 是 A', () => {
    expect(RANK_CHARS[0]).toBe('2');
    expect(RANK_CHARS[12]).toBe('A');
    expect(RANK_CHARS).toHaveLength(13);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/handClass.test.ts`
Expected: FAIL，报错找不到模块 `./handClass`

- [ ] **Step 3: 实现 handClass.ts**

创建 `src/core/handClass.ts`：

```ts
import type { Card, Rank, Suit } from './cards';
import { SUITS } from './cards';

/** 169 种起手牌类别之一：'AA' / 'AKs' / 'AKo' */
export type HandClass = string;

/** 下标 0 对应点数 2，下标 12 对应 A */
export const RANK_CHARS = '23456789TJQKA';

/** 点数下标（0..12）转成 Rank（2..14） */
function idxToRank(idx: number): Rank {
  return (idx + 2) as Rank;
}

/** 把两张具体的牌归类到 169 种起手牌之一 */
export function classifyHand(a: Card, b: Card): HandClass {
  const hi = a.rank >= b.rank ? a : b;
  const lo = a.rank >= b.rank ? b : a;
  const h = RANK_CHARS[hi.rank - 2];
  const l = RANK_CHARS[lo.rank - 2];
  if (hi.rank === lo.rank) return h + l;
  return h + l + (a.suit === b.suit ? 's' : 'o');
}

export interface ParsedHandClass {
  /** 大牌的点数下标 0..12 */
  hiIdx: number;
  /** 小牌的点数下标 0..12 */
  loIdx: number;
  kind: 'pair' | 's' | 'o';
}

export function parseHandClass(hc: HandClass): ParsedHandClass {
  const hiIdx = RANK_CHARS.indexOf(hc[0]);
  const loIdx = RANK_CHARS.indexOf(hc[1]);
  if (hiIdx < 0 || loIdx < 0) throw new Error(`非法手牌类别: "${hc}"`);

  if (hiIdx === loIdx) {
    if (hc.length !== 2) throw new Error(`对子不应带花色标记: "${hc}"`);
    return { hiIdx, loIdx, kind: 'pair' };
  }

  if (hc.length !== 3) throw new Error(`非对子必须带 s 或 o: "${hc}"`);
  if (hiIdx < loIdx) throw new Error(`大牌必须在前: "${hc}"`);
  const suffix = hc[2];
  if (suffix !== 's' && suffix !== 'o') throw new Error(`非法花色标记: "${hc}"`);
  return { hiIdx, loIdx, kind: suffix };
}

/** 169 种起手牌，顺序稳定：从大到小遍历大牌，再遍历小牌，同花在前 */
export function allHandClasses(): HandClass[] {
  const out: HandClass[] = [];
  for (let hi = 12; hi >= 0; hi--) {
    for (let lo = hi; lo >= 0; lo--) {
      const h = RANK_CHARS[hi];
      const l = RANK_CHARS[lo];
      if (hi === lo) {
        out.push(h + l);
      } else {
        out.push(h + l + 's');
        out.push(h + l + 'o');
      }
    }
  }
  return out;
}

/** 该类别包含多少种具体的两张牌组合 */
export function comboCount(hc: HandClass): number {
  const { kind } = parseHandClass(hc);
  if (kind === 'pair') return 6;
  if (kind === 's') return 4;
  return 12;
}

/** 展开成具体的两张牌组合 */
export function expandCombos(hc: HandClass): Array<[Card, Card]> {
  const { hiIdx, loIdx, kind } = parseHandClass(hc);
  const hiRank = idxToRank(hiIdx);
  const loRank = idxToRank(loIdx);
  const out: Array<[Card, Card]> = [];

  if (kind === 'pair') {
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = i + 1; j < SUITS.length; j++) {
        out.push([
          { rank: hiRank, suit: SUITS[i] as Suit },
          { rank: loRank, suit: SUITS[j] as Suit },
        ]);
      }
    }
    return out;
  }

  if (kind === 's') {
    for (const suit of SUITS) {
      out.push([{ rank: hiRank, suit }, { rank: loRank, suit }]);
    }
    return out;
  }

  for (const hiSuit of SUITS) {
    for (const loSuit of SUITS) {
      if (hiSuit === loSuit) continue;
      out.push([{ rank: hiRank, suit: hiSuit }, { rank: loRank, suit: loSuit }]);
    }
  }
  return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/handClass.test.ts`
Expected: PASS

- [ ] **Step 5: 跑全套确认无回归**

Run: `npm test` 与 `npm run typecheck`
Expected: 全绿、退出码 0

- [ ] **Step 6: 提交**

```bash
git add src/core/handClass.ts src/core/handClass.test.ts
git commit -m "feat(core): 起手牌 169 类分类与组合展开

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 范围记法解析

范围表若按 169 手牌逐条手写 JSON，每个节点两百多行、十几个节点就是数千条数据，人工录入必然出错。改用扑克圈通行的紧凑记法书写（`22+, A2s+, KTo+`），由本任务的解析器展开。每个节点因此只占一行，可读、可核对。

**Files:**
- Create: `src/core/rangeNotation.ts`
- Test: `src/core/rangeNotation.test.ts`

**Interfaces:**
- Consumes: `HandClass`, `RANK_CHARS`, `allHandClasses`, `parseHandClass`（`./handClass`）
- Produces:
  - `parseRange(notation: string): Map<HandClass, number>` — 类别 -> 权重（0..1）
  - `formatRange(range: ReadonlyMap<HandClass, number>): string` — 仅用于测试与调试的可读输出，按 `allHandClasses()` 顺序列出

支持的记法：

| 写法 | 含义 |
|---|---|
| `AKs` `AKo` `77` | 单个类别 |
| `77+` | 77 到 AA 的所有对子 |
| `A2s+` | A2s 到 AKs（大牌固定为 A，小牌递增） |
| `KTo+` | KTo、KJo、KQo |
| `99-66` / `66-99` | 66 到 99 的对子，顺序不限 |
| `A5s-A2s` | A2s 到 A5s，顺序不限 |
| `AJo:0.5` | 权重 0.5（默认 1.0） |
| 逗号分隔 | 多个 token，重复出现的类别取**较大**权重 |

- [ ] **Step 1: 写失败的测试**

创建 `src/core/rangeNotation.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseRange, formatRange } from './rangeNotation';
import { allHandClasses } from './handClass';

const keys = (s: string) => [...parseRange(s).keys()].sort();

describe('parseRange 单个类别', () => {
  it('解析对子、同花、非同花', () => {
    expect(keys('AA')).toEqual(['AA']);
    expect(keys('AKs')).toEqual(['AKs']);
    expect(keys('72o')).toEqual(['72o']);
  });

  it('默认权重为 1', () => {
    expect(parseRange('AA').get('AA')).toBe(1);
  });

  it('空串得到空范围', () => {
    expect(parseRange('').size).toBe(0);
    expect(parseRange('   ').size).toBe(0);
  });
});

describe('parseRange 加号', () => {
  it('对子加号向上展开到 AA', () => {
    expect(keys('QQ+')).toEqual(['AA', 'KK', 'QQ'].sort());
  });

  it('同花加号固定大牌、小牌递增到大牌下一位', () => {
    expect(keys('ATs+')).toEqual(['AJs', 'AKs', 'AQs', 'ATs'].sort());
  });

  it('非同花加号同理', () => {
    expect(keys('KTo+')).toEqual(['KJo', 'KQo', 'KTo'].sort());
  });

  it('A2s+ 展开为 12 个类别', () => {
    expect(parseRange('A2s+').size).toBe(12);
  });

  it('AKs+ 只有它自己', () => {
    expect(keys('AKs+')).toEqual(['AKs']);
  });
});

describe('parseRange 区间', () => {
  it('对子区间，顺序不限', () => {
    expect(keys('99-66')).toEqual(['66', '77', '88', '99'].sort());
    expect(keys('66-99')).toEqual(['66', '77', '88', '99'].sort());
  });

  it('同花区间，顺序不限', () => {
    expect(keys('A5s-A2s')).toEqual(['A2s', 'A3s', 'A4s', 'A5s'].sort());
    expect(keys('A2s-A5s')).toEqual(['A2s', 'A3s', 'A4s', 'A5s'].sort());
  });

  it('区间两端大牌不一致时抛错', () => {
    expect(() => parseRange('A5s-K2s')).toThrow();
  });

  it('区间两端类型不一致时抛错', () => {
    expect(() => parseRange('A5s-A2o')).toThrow();
    expect(() => parseRange('99-A2s')).toThrow();
  });
});

describe('parseRange 权重', () => {
  it('冒号后的数值作为权重', () => {
    expect(parseRange('AJo:0.5').get('AJo')).toBe(0.5);
  });

  it('权重作用于展开后的每个类别', () => {
    const r = parseRange('QQ+:0.25');
    expect(r.get('AA')).toBe(0.25);
    expect(r.get('QQ')).toBe(0.25);
  });

  it('权重超出 [0,1] 抛错', () => {
    expect(() => parseRange('AA:1.5')).toThrow();
    expect(() => parseRange('AA:-0.1')).toThrow();
  });

  it('非数值权重抛错', () => {
    expect(() => parseRange('AA:abc')).toThrow();
  });
});

describe('parseRange 多 token', () => {
  it('逗号分隔，允许多余空白', () => {
    expect(keys('AA,  KK ,QQ')).toEqual(['AA', 'KK', 'QQ'].sort());
  });

  it('重复出现的类别取较大权重', () => {
    expect(parseRange('AA:0.3, AA:0.8').get('AA')).toBe(0.8);
    expect(parseRange('AA:0.8, AA:0.3').get('AA')).toBe(0.8);
  });

  it('组合记法', () => {
    const r = parseRange('77+, A9s+, KTo+, QJs');
    expect(r.has('AA')).toBe(true);
    expect(r.has('77')).toBe(true);
    expect(r.has('66')).toBe(false);
    expect(r.has('A9s')).toBe(true);
    expect(r.has('A8s')).toBe(false);
    expect(r.has('KTo')).toBe(true);
    expect(r.has('QJs')).toBe(true);
  });
});

describe('parseRange 错误处理', () => {
  it('未知类别抛错', () => {
    expect(() => parseRange('XY')).toThrow();
    expect(() => parseRange('AKx')).toThrow();
  });

  it('小牌在前抛错', () => {
    expect(() => parseRange('KAs')).toThrow();
  });

  it('错误信息包含出问题的 token', () => {
    expect(() => parseRange('AA, ZZ, KK')).toThrow(/ZZ/);
  });
});

describe('formatRange', () => {
  it('按 allHandClasses 的顺序输出', () => {
    const s = formatRange(parseRange('KK, AA, QQ'));
    expect(s).toBe('AA, KK, QQ');
  });

  it('权重非 1 时带上权重', () => {
    expect(formatRange(parseRange('AA:0.5'))).toBe('AA:0.5');
  });

  it('空范围输出空串', () => {
    expect(formatRange(new Map())).toBe('');
  });

  it('往返：解析后格式化再解析，结果相同', () => {
    const src = '77+, A9s+, KTo+, QJs, AJo:0.5';
    const once = parseRange(src);
    const twice = parseRange(formatRange(once));
    expect([...twice.entries()].sort()).toEqual([...once.entries()].sort());
  });
});

describe('parseRange 全集', () => {
  it('把 169 个类别逐个写出来能解析出全集', () => {
    const all = allHandClasses();
    expect(parseRange(all.join(', ')).size).toBe(169);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/rangeNotation.test.ts`
Expected: FAIL，找不到模块 `./rangeNotation`

- [ ] **Step 3: 实现 rangeNotation.ts**

创建 `src/core/rangeNotation.ts`：

```ts
import type { HandClass } from './handClass';
import { RANK_CHARS, allHandClasses, parseHandClass } from './handClass';

/** 由点数下标与类型拼回类别字符串 */
function makeClass(hiIdx: number, loIdx: number, kind: 'pair' | 's' | 'o'): HandClass {
  const h = RANK_CHARS[hiIdx];
  const l = RANK_CHARS[loIdx];
  return kind === 'pair' ? h + l : h + l + kind;
}

/** 展开 `XX+` 记法 */
function expandPlus(spec: string, token: string): HandClass[] {
  const base = spec.slice(0, -1);
  const { hiIdx, loIdx, kind } = parseHandClass(base);
  const out: HandClass[] = [];

  if (kind === 'pair') {
    // 对子向上展开到 AA
    for (let i = hiIdx; i <= 12; i++) out.push(makeClass(i, i, 'pair'));
    return out;
  }

  // 非对子：大牌固定，小牌从当前值递增到「大牌下一位」
  for (let lo = loIdx; lo < hiIdx; lo++) out.push(makeClass(hiIdx, lo, kind));
  if (out.length === 0) throw new Error(`记法无法展开: "${token}"`);
  return out;
}

/** 展开 `XX-YY` 记法 */
function expandDash(spec: string, token: string): HandClass[] {
  const parts = spec.split('-');
  if (parts.length !== 2) throw new Error(`区间记法格式错误: "${token}"`);
  const a = parseHandClass(parts[0]);
  const b = parseHandClass(parts[1]);

  if (a.kind !== b.kind) throw new Error(`区间两端类型不一致: "${token}"`);

  if (a.kind === 'pair') {
    const lo = Math.min(a.hiIdx, b.hiIdx);
    const hi = Math.max(a.hiIdx, b.hiIdx);
    const out: HandClass[] = [];
    for (let i = lo; i <= hi; i++) out.push(makeClass(i, i, 'pair'));
    return out;
  }

  if (a.hiIdx !== b.hiIdx) throw new Error(`区间两端大牌不一致: "${token}"`);
  const lo = Math.min(a.loIdx, b.loIdx);
  const hi = Math.max(a.loIdx, b.loIdx);
  const out: HandClass[] = [];
  for (let i = lo; i <= hi; i++) out.push(makeClass(a.hiIdx, i, a.kind));
  return out;
}

/**
 * 解析紧凑范围记法，返回「手牌类别 -> 权重」。
 * 同一类别多次出现时取较大的权重。
 */
export function parseRange(notation: string): Map<HandClass, number> {
  const out = new Map<HandClass, number>();
  const trimmed = notation.trim();
  if (trimmed === '') return out;

  for (const rawToken of trimmed.split(',')) {
    const token = rawToken.trim();
    if (token === '') continue;

    let spec = token;
    let weight = 1;

    const colon = token.indexOf(':');
    if (colon >= 0) {
      spec = token.slice(0, colon).trim();
      const weightStr = token.slice(colon + 1).trim();
      weight = Number(weightStr);
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
        throw new Error(`权重必须是 [0,1] 内的数值: "${token}"`);
      }
    }

    let classes: HandClass[];
    if (spec.endsWith('+')) {
      classes = expandPlus(spec, token);
    } else if (spec.includes('-')) {
      classes = expandDash(spec, token);
    } else {
      parseHandClass(spec);   // 校验，非法会抛错
      classes = [spec];
    }

    for (const hc of classes) {
      const prev = out.get(hc);
      if (prev === undefined || weight > prev) out.set(hc, weight);
    }
  }

  return out;
}

/** 按 allHandClasses 的固定顺序输出，权重为 1 时省略。仅用于测试与调试。 */
export function formatRange(range: ReadonlyMap<HandClass, number>): string {
  const parts: string[] = [];
  for (const hc of allHandClasses()) {
    const w = range.get(hc);
    if (w === undefined) continue;
    parts.push(w === 1 ? hc : `${hc}:${w}`);
  }
  return parts.join(', ');
}
```

注意 `parseHandClass` 抛出的错误信息里已经带上了非法的类别字符串，所以「错误信息包含出问题的 token」那条测试能通过。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/rangeNotation.test.ts`
Expected: PASS

- [ ] **Step 5: 跑全套**

Run: `npm test` 与 `npm run typecheck`

- [ ] **Step 6: 提交**

```bash
git add src/core/rangeNotation.ts src/core/rangeNotation.test.ts
git commit -m "feat(core): 紧凑范围记法解析（加号、区间、权重）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: RangeSet 与组合运算

范围表给出的是「类别 -> 频率」，但胜率计算需要具体的两张牌。本任务提供两者之间的转换，以及按权重采样。

**Files:**
- Create: `src/core/rangeSet.ts`
- Test: `src/core/rangeSet.test.ts`

**Interfaces:**
- Consumes: `Card`, `sameCard`, `cardToString`（`./cards`）；`Rng`（`./rng`）；`HandClass`, `classifyHand`, `expandCombos`, `allHandClasses`（`./handClass`）；`parseRange`（`./rangeNotation`）
- Produces:
  - `type RangeSet = ReadonlyMap<HandClass, number>`
  - `interface WeightedCombo { cards: [Card, Card]; weight: number; handClass: HandClass }`
  - `rangeCombos(range: RangeSet, dead: readonly Card[]): WeightedCombo[]` — 展开并剔除与死牌冲突的组合
  - `totalWeight(combos: readonly WeightedCombo[]): number`
  - `sampleCombo(combos: readonly WeightedCombo[], totalW: number, rng: Rng): [Card, Card]` — 按权重采样；`combos` 为空时抛错
  - `fullRange(): RangeSet` — 169 类全部权重 1
  - `rangeFraction(range: RangeSet): number` — 该范围占全部 1326 种组合的加权比例，0..1

**为什么 `rangeCombos` 要接收死牌**：hero 的底牌和公共牌已经从牌堆里出去了，对手不可能持有。忘记剔除会让胜率系统性偏低。

- [ ] **Step 1: 写失败的测试**

创建 `src/core/rangeSet.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseCards, cardToString } from './cards';
import type { Card } from './cards';
import { createRng } from './rng';
import { classifyHand, comboCount } from './handClass';
import { parseRange } from './rangeNotation';
import {
  rangeCombos, totalWeight, sampleCombo, fullRange, rangeFraction,
} from './rangeSet';

describe('rangeCombos', () => {
  it('无死牌时组合数等于各类别组合数之和', () => {
    const r = parseRange('AA, AKs');
    expect(rangeCombos(r, [])).toHaveLength(comboCount('AA') + comboCount('AKs'));
  });

  it('剔除与死牌冲突的组合', () => {
    // A♠ 已在公共牌上，AA 只剩另外三张 A 的 C(3,2)=3 种
    const r = parseRange('AA');
    expect(rangeCombos(r, parseCards('As'))).toHaveLength(3);
  });

  it('死牌用光某个类别时该类别消失', () => {
    const r = parseRange('AA');
    // 四张 A 全部是死牌，AA 一种组合都不剩
    expect(rangeCombos(r, parseCards('As Ah Ad Ac'))).toHaveLength(0);
  });

  it('每个组合带上正确的权重与类别', () => {
    const r = parseRange('AA:0.5');
    for (const wc of rangeCombos(r, [])) {
      expect(wc.weight).toBe(0.5);
      expect(wc.handClass).toBe('AA');
      expect(classifyHand(...wc.cards)).toBe('AA');
    }
  });

  it('权重为 0 的类别不产生组合', () => {
    expect(rangeCombos(parseRange('AA:0'), [])).toHaveLength(0);
  });

  it('空范围得到空数组', () => {
    expect(rangeCombos(new Map(), [])).toEqual([]);
  });
});

describe('totalWeight', () => {
  it('等于各组合权重之和', () => {
    const combos = rangeCombos(parseRange('AA:0.5'), []);
    expect(totalWeight(combos)).toBeCloseTo(6 * 0.5, 9);
  });

  it('空数组为 0', () => {
    expect(totalWeight([])).toBe(0);
  });
});

describe('sampleCombo', () => {
  it('采样结果一定来自范围内', () => {
    const combos = rangeCombos(parseRange('AA, KK'), []);
    const tw = totalWeight(combos);
    const rng = createRng('sample-1');
    for (let i = 0; i < 200; i++) {
      const [a, b] = sampleCombo(combos, tw, rng);
      expect(['AA', 'KK']).toContain(classifyHand(a, b));
    }
  });

  it('相同 seed 采样序列相同', () => {
    const combos = rangeCombos(parseRange('AA, KK, QQ'), []);
    const tw = totalWeight(combos);
    const take = (seed: string) => {
      const rng = createRng(seed);
      return Array.from({ length: 20 }, () => sampleCombo(combos, tw, rng).map(cardToString).join(''));
    };
    expect(take('same')).toEqual(take('same'));
  });

  it('权重影响采样比例', () => {
    // AA 权重 1、KK 权重 0.2，组合数都是 6，AA 应显著更常被采到
    const combos = rangeCombos(parseRange('AA, KK:0.2'), []);
    const tw = totalWeight(combos);
    const rng = createRng('weighted');
    let aa = 0;
    const N = 6000;
    for (let i = 0; i < N; i++) {
      if (classifyHand(...sampleCombo(combos, tw, rng)) === 'AA') aa++;
    }
    // 期望比例 6/(6+1.2) ≈ 0.833
    expect(aa / N).toBeGreaterThan(0.79);
    expect(aa / N).toBeLessThan(0.87);
  });

  it('空组合列表抛错', () => {
    expect(() => sampleCombo([], 0, createRng('x'))).toThrow();
  });
});

describe('fullRange', () => {
  it('169 类全在，权重都是 1', () => {
    const r = fullRange();
    expect(r.size).toBe(169);
    for (const w of r.values()) expect(w).toBe(1);
  });

  it('展开后是 1326 个组合', () => {
    expect(rangeCombos(fullRange(), [])).toHaveLength(1326);
  });
});

describe('rangeFraction', () => {
  it('全范围是 1', () => {
    expect(rangeFraction(fullRange())).toBeCloseTo(1, 9);
  });

  it('空范围是 0', () => {
    expect(rangeFraction(new Map())).toBe(0);
  });

  it('AA 单独约占 0.45%', () => {
    expect(rangeFraction(parseRange('AA'))).toBeCloseTo(6 / 1326, 9);
  });

  it('权重折算进比例', () => {
    expect(rangeFraction(parseRange('AA:0.5'))).toBeCloseTo(3 / 1326, 9);
  });

  it('常见开池范围落在合理区间', () => {
    // BTN 开池约 40-50%
    const btn = parseRange('22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, T9o, 98o');
    expect(rangeFraction(btn)).toBeGreaterThan(0.38);
    expect(rangeFraction(btn)).toBeLessThan(0.52);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/rangeSet.test.ts`
Expected: FAIL，找不到模块 `./rangeSet`

- [ ] **Step 3: 实现 rangeSet.ts**

创建 `src/core/rangeSet.ts`：

```ts
import type { Card } from './cards';
import { sameCard } from './cards';
import type { Rng } from './rng';
import type { HandClass } from './handClass';
import { allHandClasses, expandCombos } from './handClass';

/** 对手可能持有的手牌分布：类别 -> 权重（0..1）。未出现的类别视为 0。 */
export type RangeSet = ReadonlyMap<HandClass, number>;

export interface WeightedCombo {
  cards: [Card, Card];
  weight: number;
  handClass: HandClass;
}

/**
 * 把范围展开成具体的两张牌组合，剔除与死牌冲突的。
 *
 * dead 应包含 hero 的底牌与所有已知公共牌 —— 这些牌已不在牌堆里，
 * 对手不可能持有。漏掉会让胜率系统性偏低。
 */
export function rangeCombos(range: RangeSet, dead: readonly Card[]): WeightedCombo[] {
  const out: WeightedCombo[] = [];
  for (const [handClass, weight] of range) {
    if (weight <= 0) continue;
    for (const cards of expandCombos(handClass)) {
      if (dead.some(d => sameCard(d, cards[0]) || sameCard(d, cards[1]))) continue;
      out.push({ cards, weight, handClass });
    }
  }
  return out;
}

export function totalWeight(combos: readonly WeightedCombo[]): number {
  let sum = 0;
  for (const c of combos) sum += c.weight;
  return sum;
}

/**
 * 按权重采样一个组合。
 * totalW 由调用方传入，避免在蒙特卡洛内层循环里反复求和。
 */
export function sampleCombo(
  combos: readonly WeightedCombo[],
  totalW: number,
  rng: Rng,
): [Card, Card] {
  if (combos.length === 0) throw new Error('无法从空范围中采样');
  let target = rng.nextFloat() * totalW;
  for (const c of combos) {
    target -= c.weight;
    if (target <= 0) return c.cards;
  }
  // 浮点累加误差导致走到末尾时，返回最后一个
  return combos[combos.length - 1].cards;
}

/** 169 类全在、权重均为 1 的范围 */
export function fullRange(): RangeSet {
  const m = new Map<HandClass, number>();
  for (const hc of allHandClasses()) m.set(hc, 1);
  return m;
}

/** 该范围占全部 1326 种组合的加权比例 */
export function rangeFraction(range: RangeSet): number {
  return totalWeight(rangeCombos(range, [])) / 1326;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/rangeSet.test.ts`
Expected: PASS

- [ ] **Step 5: 跑全套**

Run: `npm test` 与 `npm run typecheck`

- [ ] **Step 6: 提交**

```bash
git add src/core/rangeSet.ts src/core/rangeSet.test.ts
git commit -m "feat(core): RangeSet 组合展开、死牌剔除与权重采样

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 翻前范围表数据与查询

**Files:**
- Create: `src/core/ranges/data.ts`
- Create: `src/core/ranges/index.ts`
- Test: `src/core/ranges/ranges.test.ts`

**Interfaces:**
- Consumes: `Position`（`../types`）；`HandClass`, `allHandClasses`（`../handClass`）；`parseRange`（`../rangeNotation`）；`RangeSet`, `rangeFraction`（`../rangeSet`）
- Produces（`ranges/index.ts`）:
  - `type PreflopAction = 'raise' | 'call' | '3bet' | '4bet' | 'fold'`
  - `rfiKey(pos: Position): string` — 如 `'CO_rfi'`
  - `vsOpenKey(pos: Position, opener: Position): string` — 如 `'BB_vs_BTN_open'`
  - `vs3betKey(pos: Position, threeBettor: Position): string` — 如 `'CO_vs_BTN_3bet'`
  - `hasNode(key: string): boolean`
  - `nodeActions(key: string): PreflopAction[]` — 该节点的非 fold 动作，节点不存在时返回 `[]`
  - `actionFreqs(key: string, hc: HandClass): Record<string, number> | undefined` — 各动作频率，含 fold；节点不存在返回 `undefined`
  - `rangeForAction(key: string, action: PreflopAction): RangeSet | undefined`

**数据组织方式**：每个节点只列出**非 fold** 的动作，fold 是补集。这样每个动作一行紧凑记法，且各动作频率之和恒等于 1（不可能写错）。同一节点内一手牌在多个动作里出现时，频率相加不得超过 1 —— 由一致性测试保证。

**覆盖范围与回落**：本任务覆盖 5 个 RFI 节点、13 个面对开池节点、4 个面对 3bet 节点。未覆盖的节点（4bet 之后、多人底池的复杂节点）`hasNode` 返回 `false`，由调用方回落到翻后同一套 EV 估算 —— 这是 spec §6.5 明确的设计。

- [ ] **Step 1: 创建范围数据**

创建 `src/core/ranges/data.ts`：

```ts
/**
 * 6-max 100BB 翻前范围表。
 *
 * 每个节点只列出非 fold 动作，fold 为补集，因此各动作频率之和恒为 1。
 * 数据为公开 GTO 近似范围的整理，初版以纯策略为主（频率 0 或 1），
 * 仅在公认的边界手牌上使用混合频率。
 *
 * 后续可整体替换为更精细的数据，查询接口与本文件的格式保持不变。
 */
export const PREFLOP_NODES: Record<string, Partial<Record<string, string>>> = {
  // ── 首次进池（RFI）。BB 无 RFI 节点：前面全弃牌时大盲直接获胜。
  UTG_rfi: {
    raise: '55+, A8s+, A5s-A4s, KTs+, QTs+, JTs, T9s, AJo+, KQo',
  },
  HJ_rfi: {
    raise: '44+, A7s+, A5s-A3s, K9s+, Q9s+, J9s+, T9s, 98s, ATo+, KJo+',
  },
  CO_rfi: {
    raise: '22+, A2s+, K7s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, 65s, A9o+, KTo+, QJo',
  },
  BTN_rfi: {
    raise: '22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, T9o, 98o',
  },
  SB_rfi: {
    raise: '22+, A2s+, K5s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, A2o+, K9o+, QTo+, JTo',
  },

  // ── 面对单一开池：大盲防守
  BB_vs_UTG_open: {
    '3bet': 'QQ+, AKs, A5s, AKo:0.5',
    call: '22-JJ, A2s-AQs, K8s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, AJo-ATo, KJo+, QJo',
  },
  BB_vs_HJ_open: {
    '3bet': 'JJ+, AQs+, A5s-A4s, AKo',
    call: '22-TT, A2s-AJs, K6s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, AJo-ATo, KTo+, QTo+, JTo',
  },
  BB_vs_CO_open: {
    '3bet': 'TT+, AJs+, A5s-A3s, KQs, AQo+',
    call: '22-99, A2s-ATs, K4s+, Q7s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, AJo-A8o, K9o+, Q9o+, J9o+, T9o',
  },
  BB_vs_BTN_open: {
    '3bet': '88+, ATs+, A5s-A2s, KJs+, AJo+, KQo',
    call: '22-77, A2s-A9s, K2s+, Q4s+, J6s+, T6s+, 95s+, 85s+, 74s+, 64s+, 53s+, ATo-A2o, K8o+, Q8o+, J8o+, T8o, 98o, 87o',
  },
  BB_vs_SB_open: {
    '3bet': '77+, A9s+, A5s-A2s, KTs+, QTs+, JTs, ATo+, KJo+',
    call: '22-66, A2s-A8s, K2s+, Q5s+, J6s+, T6s+, 95s+, 85s+, 74s+, 64s+, 53s+, A9o-A2o, K9o+, Q9o+, J9o+, T9o, 98o',
  },

  // ── 面对单一开池：按钮位防守
  BTN_vs_UTG_open: {
    '3bet': 'QQ+, AKs, A5s, AKo',
    call: '22-JJ, AJs-ATs, KTs+, QTs+, JTs, T9s, 98s, AQo',
  },
  BTN_vs_HJ_open: {
    '3bet': 'JJ+, AQs+, A5s-A4s, AKo',
    call: '22-TT, A9s-AJs, K9s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, AQo-AJo, KQo',
  },
  BTN_vs_CO_open: {
    '3bet': '99+, ATs+, A5s-A4s, KJs+, AQo+',
    call: '22-88, A2s-A9s, K9s+, QTs+, J9s+, T9s, 98s, 87s, 76s, AJo-ATo, KQo',
  },

  // ── 面对单一开池：小盲防守（位置劣势，3bet 更多、跟注更少）
  SB_vs_CO_open: {
    '3bet': 'TT+, ATs+, A5s-A3s, KJs+, AQo+',
    call: '77-99, A9s, KTs, QTs+, JTs, T9s',
  },
  SB_vs_BTN_open: {
    '3bet': '88+, A9s+, A5s-A2s, KTs+, QTs+, JTs, ATo+, KJo+',
    call: '22-77, A8s-A6s, K9s, Q9s, J9s, T9s, 98s',
  },

  // ── 面对 3bet（开池者视角）
  UTG_vs_BB_3bet: {
    '4bet': 'QQ+, AKs, A5s:0.5',
    call: 'JJ-99, AQs-AJs, KQs, AKo',
  },
  CO_vs_BTN_3bet: {
    '4bet': 'QQ+, AKs, A5s-A4s',
    call: 'JJ-88, AQs-ATs, KQs-KJs, QJs, JTs, T9s, AKo-AQo',
  },
  BTN_vs_BB_3bet: {
    '4bet': 'JJ+, AKs, A5s-A4s, AKo',
    call: 'TT-66, AQs-A9s, KQs-KTs, QJs-QTs, JTs, T9s, 98s, AQo-AJo, KQo',
  },
  BTN_vs_SB_3bet: {
    '4bet': 'JJ+, AKs, A5s-A4s, AKo',
    call: 'TT-77, AQs-ATs, KQs-KJs, QJs, JTs, T9s, AQo-AJo, KQo',
  },
};
```

- [ ] **Step 2: 写失败的测试**

创建 `src/core/ranges/ranges.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { allHandClasses } from '../handClass';
import { rangeFraction } from '../rangeSet';
import { PREFLOP_NODES } from './data';
import {
  rfiKey, vsOpenKey, vs3betKey, hasNode, nodeActions, actionFreqs, rangeForAction,
} from './index';

describe('节点键构造', () => {
  it('RFI 键', () => {
    expect(rfiKey('CO')).toBe('CO_rfi');
  });
  it('面对开池键', () => {
    expect(vsOpenKey('BB', 'BTN')).toBe('BB_vs_BTN_open');
  });
  it('面对 3bet 键', () => {
    expect(vs3betKey('CO', 'BTN')).toBe('CO_vs_BTN_3bet');
  });
});

describe('hasNode', () => {
  it('已覆盖的节点返回 true', () => {
    expect(hasNode(rfiKey('BTN'))).toBe(true);
    expect(hasNode(vsOpenKey('BB', 'BTN'))).toBe(true);
  });

  it('未覆盖的节点返回 false（调用方需回落到 EV 估算）', () => {
    expect(hasNode(vsOpenKey('HJ', 'UTG'))).toBe(false);
    expect(hasNode('BB_rfi')).toBe(false);
  });
});

describe('actionFreqs', () => {
  it('各动作频率之和恒为 1', () => {
    for (const key of Object.keys(PREFLOP_NODES)) {
      for (const hc of allHandClasses()) {
        const f = actionFreqs(key, hc)!;
        const sum = Object.values(f).reduce((a, b) => a + b, 0);
        expect(Math.abs(sum - 1)).toBeLessThan(0.001);
      }
    }
  });

  it('未列出的手牌全部落在 fold 上', () => {
    // 72o 不在任何开池范围里
    const f = actionFreqs(rfiKey('UTG'), '72o')!;
    expect(f.fold).toBe(1);
    expect(f.raise ?? 0).toBe(0);
  });

  it('AA 在所有 RFI 节点上都是 100% 加注', () => {
    for (const pos of ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const) {
      expect(actionFreqs(rfiKey(pos), 'AA')!.raise).toBe(1);
    }
  });

  it('混合频率如实反映', () => {
    const f = actionFreqs('UTG_vs_BB_3bet', 'A5s')!;
    expect(f['4bet']).toBe(0.5);
    expect(f.fold).toBeCloseTo(0.5, 9);
  });

  it('节点不存在时返回 undefined', () => {
    expect(actionFreqs('NOT_A_NODE', 'AA')).toBeUndefined();
  });
});

describe('数据一致性', () => {
  it('同一节点内任一手牌的非 fold 频率之和不超过 1', () => {
    for (const key of Object.keys(PREFLOP_NODES)) {
      for (const hc of allHandClasses()) {
        const f = actionFreqs(key, hc)!;
        const nonFold = Object.entries(f)
          .filter(([a]) => a !== 'fold')
          .reduce((s, [, v]) => s + v, 0);
        if (nonFold > 1.0001) {
          throw new Error(`节点 ${key} 的 ${hc} 非 fold 频率之和为 ${nonFold}`);
        }
      }
    }
  });

  it('每个节点的记法都能解析（无拼写错误）', () => {
    for (const key of Object.keys(PREFLOP_NODES)) {
      for (const action of nodeActions(key)) {
        expect(() => rangeForAction(key, action)).not.toThrow();
        expect(rangeForAction(key, action)!.size).toBeGreaterThan(0);
      }
    }
  });
});

describe('范围宽度落在扑克常识区间', () => {
  const width = (key: string, action: 'raise') => rangeFraction(rangeForAction(key, action)!);

  it('开池范围随位置递增：UTG < HJ < CO < BTN', () => {
    const utg = width(rfiKey('UTG'), 'raise');
    const hj = width(rfiKey('HJ'), 'raise');
    const co = width(rfiKey('CO'), 'raise');
    const btn = width(rfiKey('BTN'), 'raise');
    expect(utg).toBeLessThan(hj);
    expect(hj).toBeLessThan(co);
    expect(co).toBeLessThan(btn);
  });

  it('UTG 开池约 11-18%', () => {
    expect(width(rfiKey('UTG'), 'raise')).toBeGreaterThan(0.11);
    expect(width(rfiKey('UTG'), 'raise')).toBeLessThan(0.18);
  });

  it('BTN 开池约 38-52%', () => {
    expect(width(rfiKey('BTN'), 'raise')).toBeGreaterThan(0.38);
    expect(width(rfiKey('BTN'), 'raise')).toBeLessThan(0.52);
  });

  it('大盲面对 BTN 开池比面对 UTG 开池防守得宽', () => {
    const vsBtn = rangeFraction(rangeForAction(vsOpenKey('BB', 'BTN'), 'call')!);
    const vsUtg = rangeFraction(rangeForAction(vsOpenKey('BB', 'UTG'), 'call')!);
    expect(vsBtn).toBeGreaterThan(vsUtg);
  });

  it('3bet 范围明显窄于跟注范围', () => {
    const threeBet = rangeFraction(rangeForAction(vsOpenKey('BB', 'BTN'), '3bet')!);
    const call = rangeFraction(rangeForAction(vsOpenKey('BB', 'BTN'), 'call')!);
    expect(threeBet).toBeLessThan(call);
  });
});

describe('rangeForAction', () => {
  it('返回的范围里手牌权重等于其频率', () => {
    const r = rangeForAction('UTG_vs_BB_3bet', '4bet')!;
    expect(r.get('A5s')).toBe(0.5);
    expect(r.get('AA')).toBe(1);
  });

  it('节点或动作不存在时返回 undefined', () => {
    expect(rangeForAction('NOT_A_NODE', 'raise')).toBeUndefined();
    expect(rangeForAction(rfiKey('UTG'), '4bet')).toBeUndefined();
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run src/core/ranges/ranges.test.ts`
Expected: FAIL，找不到模块 `./index`

- [ ] **Step 4: 实现 ranges/index.ts**

创建 `src/core/ranges/index.ts`：

```ts
import type { Position } from '../types';
import type { HandClass } from '../handClass';
import { parseRange } from '../rangeNotation';
import type { RangeSet } from '../rangeSet';
import { PREFLOP_NODES } from './data';

export type PreflopAction = 'raise' | 'call' | '3bet' | '4bet' | 'fold';

export function rfiKey(pos: Position): string {
  return `${pos}_rfi`;
}

export function vsOpenKey(pos: Position, opener: Position): string {
  return `${pos}_vs_${opener}_open`;
}

export function vs3betKey(pos: Position, threeBettor: Position): string {
  return `${pos}_vs_${threeBettor}_3bet`;
}

/** 解析结果缓存：同一节点的记法只展开一次 */
const cache = new Map<string, Map<string, RangeSet>>();

function nodeRanges(key: string): Map<string, RangeSet> | undefined {
  const cached = cache.get(key);
  if (cached) return cached;

  const raw = PREFLOP_NODES[key];
  if (!raw) return undefined;

  const m = new Map<string, RangeSet>();
  for (const [action, notation] of Object.entries(raw)) {
    if (notation === undefined) continue;
    m.set(action, parseRange(notation));
  }
  cache.set(key, m);
  return m;
}

export function hasNode(key: string): boolean {
  return PREFLOP_NODES[key] !== undefined;
}

/** 该节点列出的非 fold 动作 */
export function nodeActions(key: string): PreflopAction[] {
  const m = nodeRanges(key);
  if (!m) return [];
  return [...m.keys()] as PreflopAction[];
}

/**
 * 某手牌在该节点上的各动作频率，含 fold。
 * fold 是补集：1 减去所有非 fold 动作的频率之和。
 */
export function actionFreqs(key: string, hc: HandClass): Record<string, number> | undefined {
  const m = nodeRanges(key);
  if (!m) return undefined;

  const out: Record<string, number> = {};
  let nonFold = 0;
  for (const [action, range] of m) {
    const w = range.get(hc) ?? 0;
    out[action] = w;
    nonFold += w;
  }
  out.fold = Math.max(0, 1 - nonFold);
  return out;
}

/** 该节点某个动作对应的范围（权重即频率） */
export function rangeForAction(key: string, action: PreflopAction): RangeSet | undefined {
  return nodeRanges(key)?.get(action);
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/core/ranges/ranges.test.ts`
Expected: PASS

若「范围宽度落在扑克常识区间」某条失败，说明 `data.ts` 里那条记法写宽了或写窄了。**调整 `data.ts` 的记法，不要放宽测试的区间** —— 那些区间是扑克常识的编码，是这份数据唯一的外部校验。

- [ ] **Step 6: 跑全套**

Run: `npm test` 与 `npm run typecheck`

- [ ] **Step 7: 提交**

```bash
git add src/core/ranges/
git commit -m "feat(core): 6-max 翻前范围表数据与查询，含一致性与常识区间测试

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 范围感知的蒙特卡洛胜率

计划①的 `equityMonteCarlo` 第三个参数是**对手数量**，对手手牌按随机手处理。复盘引擎必须按对手的实际范围采样 —— 面对一个 3bet 范围和面对一个随机手，胜率天差地别。本任务补上这个能力。

**Files:**
- Modify: `src/core/equity.ts`（**追加**新导出，不得修改既有的 `equityMonteCarlo` 与 `equityExactVsOne`）
- Test: `src/core/equityVsRanges.test.ts`

**Interfaces:**
- Consumes: `Card`, `makeDeck`, `sameCard`（`./cards`）；`evaluate7`（`./handEval`）；`Rng`（`./rng`）；`RangeSet`, `WeightedCombo`, `rangeCombos`, `totalWeight`, `sampleCombo`, `fullRange`（`./rangeSet`）
- Produces:
  - `equityVsRanges(hero: [Card, Card], board: Card[], opponentRanges: readonly RangeSet[], iterations: number, rng: Rng): number`

平局按 `1/并列人数` 计入，与既有函数语义一致。

**采样时的冲突处理**：每轮先抽公共牌补齐，再为每个对手从各自范围里采样；若采到的组合与已用牌冲突，重采（最多 100 次），仍冲突则跳过该轮并从总轮数中扣除。

- [ ] **Step 1: 写失败的测试**

创建 `src/core/equityVsRanges.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseCards } from './cards';
import type { Card } from './cards';
import { createRng } from './rng';
import { parseRange } from './rangeNotation';
import { fullRange } from './rangeSet';
import { equityVsRanges, equityMonteCarlo } from './equity';

const hole = (s: string) => parseCards(s) as [Card, Card];

describe('equityVsRanges 与随机手版本一致', () => {
  it('对手范围为全范围时，结果接近 equityMonteCarlo', () => {
    const a = equityVsRanges(hole('As Ad'), [], [fullRange()], 30000, createRng('cmp'));
    const b = equityMonteCarlo(hole('As Ad'), [], 1, 30000, createRng('cmp'));
    expect(Math.abs(a - b)).toBeLessThan(0.02);
  });

  it('两个全范围对手接近两个随机手对手', () => {
    const a = equityVsRanges(hole('As Ad'), [], [fullRange(), fullRange()], 20000, createRng('cmp2'));
    const b = equityMonteCarlo(hole('As Ad'), [], 2, 20000, createRng('cmp2'));
    expect(Math.abs(a - b)).toBeLessThan(0.03);
  });
});

describe('equityVsRanges 范围影响结果', () => {
  it('对手范围越强，hero 胜率越低', () => {
    const rng = () => createRng('narrow');
    const vsAll = equityVsRanges(hole('Ks Kd'), [], [fullRange()], 20000, rng());
    const vsStrong = equityVsRanges(hole('Ks Kd'), [], [parseRange('QQ+, AKs, AKo')], 20000, rng());
    expect(vsStrong).toBeLessThan(vsAll);
  });

  it('KK 对只含 AA 的范围胜率约 18%', () => {
    const eq = equityVsRanges(hole('Ks Kd'), [], [parseRange('AA')], 20000, createRng('kk-vs-aa'));
    expect(eq).toBeGreaterThan(0.15);
    expect(eq).toBeLessThan(0.21);
  });

  it('AA 对只含 KK 的范围胜率约 82%', () => {
    const eq = equityVsRanges(hole('As Ad'), [], [parseRange('KK')], 20000, createRng('aa-vs-kk'));
    expect(eq).toBeGreaterThan(0.79);
    expect(eq).toBeLessThan(0.85);
  });

  it('AKs 对只含 22 的范围约 46%（经典 coin flip）', () => {
    const eq = equityVsRanges(hole('As Ks'), [], [parseRange('22')], 30000, createRng('aks-vs-22'));
    expect(eq).toBeGreaterThan(0.43);
    expect(eq).toBeLessThan(0.50);
  });
});

describe('equityVsRanges 死牌处理', () => {
  it('对手范围里与 hero 底牌冲突的组合被排除', () => {
    // hero 拿两张 A，对手范围只有 AA —— 只剩一种组合（另外两张 A）
    const eq = equityVsRanges(hole('As Ad'), [], [parseRange('AA')], 5000, createRng('dead'));
    // 双方都是 AA，几乎必然平分（除非公共牌造出同花）
    expect(eq).toBeGreaterThan(0.4);
    expect(eq).toBeLessThan(0.6);
  });

  it('对手范围被死牌清空时抛错', () => {
    // 四张 A 都在 hero 手上和公共牌上，对手不可能有 AA
    expect(() =>
      equityVsRanges(hole('As Ad'), parseCards('Ah Ac 5d'), [parseRange('AA')], 100, createRng('x')),
    ).toThrow();
  });
});

describe('equityVsRanges 公共牌', () => {
  it('河牌圈拿到坚果时胜率接近 1', () => {
    // 公共牌四张黑桃，hero 持黑桃 AK 成坚果同花；对手范围是宽范围
    const eq = equityVsRanges(
      hole('As Ks'), parseCards('Qs Js 9s 4h 2d'), [parseRange('22+, A2s+, K9s+')], 5000, createRng('nuts'),
    );
    expect(eq).toBeGreaterThan(0.9);
  });

  it('公共牌本身是皇家同花顺时人人平分', () => {
    const eq = equityVsRanges(
      hole('2h 3d'), parseCards('As Ks Qs Js Ts'), [fullRange()], 3000, createRng('board-plays'),
    );
    expect(eq).toBeCloseTo(0.5, 1);
  });
});

describe('equityVsRanges 可复现', () => {
  it('相同 seed 结果完全相同', () => {
    const run = () => equityVsRanges(hole('As Kd'), [], [parseRange('22+')], 3000, createRng('repro'));
    expect(run()).toBe(run());
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/equityVsRanges.test.ts`
Expected: FAIL，`equityVsRanges` 未从 `./equity` 导出

- [ ] **Step 3: 向 equity.ts 追加实现**

在 `src/core/equity.ts` 末尾追加（顶部 import 补上 `RangeSet`, `WeightedCombo`, `rangeCombos`, `totalWeight`, `sampleCombo` 来自 `./rangeSet`）：

```ts
/**
 * 对手按各自范围采样的蒙特卡洛胜率。
 * 平局按 1/并列人数 计入，与 equityMonteCarlo 语义一致。
 */
export function equityVsRanges(
  hero: [Card, Card],
  board: Card[],
  opponentRanges: readonly RangeSet[],
  iterations: number,
  rng: Rng,
): number {
  if (opponentRanges.length === 0) throw new Error('至少需要一个对手范围');

  const known = [...hero, ...board];
  const boardNeeded = 5 - board.length;

  // 各对手的可用组合在整轮中固定，先展开一次
  const combosPerOpp: WeightedCombo[][] = [];
  const totalsPerOpp: number[] = [];
  for (let i = 0; i < opponentRanges.length; i++) {
    const combos = rangeCombos(opponentRanges[i], known);
    if (combos.length === 0) {
      throw new Error(`第 ${i} 个对手的范围在剔除死牌后为空`);
    }
    combosPerOpp.push(combos);
    totalsPerOpp.push(totalWeight(combos));
  }

  const pool = remainingDeck(known);
  if (boardNeeded > pool.length) {
    throw new Error(`牌不够：需要补 ${boardNeeded} 张公共牌，牌堆只剩 ${pool.length} 张`);
  }

  let total = 0;
  let counted = 0;
  const runout: Card[] = new Array(boardNeeded);
  const oppCards: Array<[Card, Card]> = new Array(opponentRanges.length);

  for (let iter = 0; iter < iterations; iter++) {
    // 抽公共牌：部分 Fisher-Yates
    for (let i = 0; i < boardNeeded; i++) {
      const j = i + rng.nextInt(pool.length - i);
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
      runout[i] = pool[i];
    }

    // 为每个对手采样，避开已用掉的牌
    const used: Card[] = [...known, ...runout.slice(0, boardNeeded)];
    let ok = true;
    for (let o = 0; o < opponentRanges.length; o++) {
      let picked: [Card, Card] | null = null;
      for (let attempt = 0; attempt < 100; attempt++) {
        const cand = sampleCombo(combosPerOpp[o], totalsPerOpp[o], rng);
        const clash = used.some(u => sameCard(u, cand[0]) || sameCard(u, cand[1]));
        if (!clash) { picked = cand; break; }
      }
      if (!picked) { ok = false; break; }
      oppCards[o] = picked;
      used.push(picked[0], picked[1]);
    }
    if (!ok) continue;   // 本轮作废，不计入分母

    const fullBoard = board.concat(runout.slice(0, boardNeeded));
    const heroScore = evaluate7([hero[0], hero[1], ...fullBoard]);

    let ties = 1;
    let beaten = false;
    for (let o = 0; o < opponentRanges.length; o++) {
      const s = evaluate7([oppCards[o][0], oppCards[o][1], ...fullBoard]);
      if (s > heroScore) { beaten = true; break; }
      if (s === heroScore) ties++;
    }

    if (!beaten) total += 1 / ties;
    counted++;
  }

  if (counted === 0) throw new Error('所有采样轮次都因牌面冲突作废，无法估算胜率');
  return total / counted;
}
```

`remainingDeck` 是 `equity.ts` 内已有的私有函数，直接复用。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/equityVsRanges.test.ts`
Expected: PASS。含 3 万次迭代的用例耗时数秒属正常。

- [ ] **Step 5: 跑全套确认既有 equity 测试无回归**

Run: `npm test` 与 `npm run typecheck`
Expected: 全绿。既有的 `equity.test.ts` 一条都不能变。

- [ ] **Step 6: 提交**

```bash
git add src/core/equity.ts src/core/equityVsRanges.test.ts
git commit -m "feat(core): 范围感知的蒙特卡洛胜率 equityVsRanges

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 范围牌力排序与子集切分

EV 公式里的弃牌率 `Fe` 和「对手跟注后的胜率」`W'`，都需要知道对手范围里**哪些手牌会继续**。本任务提供按牌力给范围排序、并切出「最强的前 X 比例」的能力。

**Files:**
- Create: `src/core/rangeStrength.ts`
- Test: `src/core/rangeStrength.test.ts`

**Interfaces:**
- Consumes: `Card`（`./cards`）；`Rng`（`./rng`）；`RangeSet`, `WeightedCombo`, `rangeCombos`, `totalWeight`（`./rangeSet`）；`equityMonteCarlo`（`./equity`）；`HandClass`（`./handClass`）
- Produces:
  - `interface RankedCombo extends WeightedCombo { strength: number }` — `strength` 是该组合对一个随机手的胜率，0..1
  - `rankRange(range: RangeSet, board: Card[], dead: readonly Card[], iterations: number, rng: Rng): RankedCombo[]` — 按 `strength` 降序
  - `topFraction(ranked: readonly RankedCombo[], fraction: number): RangeSet` — 取加权前 `fraction` 比例的组合，重组成 `RangeSet`
  - `strengthPercentile(ranked: readonly RankedCombo[], hc: HandClass): number` — 该类别在范围中的强度分位，0（最弱）到 1（最强）

**为什么用「对一个随机手的胜率」当牌力**：它对翻前和各条街都有定义、单调、且不需要知道对手的对手是谁。牌型分值只在河牌圈才完整，翻牌圈无法比较听牌与小对子。

**性能**：`rankRange` 对范围里每个组合跑一次小规模蒙特卡洛。一个 200 组合的范围、`iterations = 150`，约 6 万次 `evaluate7`，实测在 30ms 量级。调用方应缓存结果，不要在循环里反复调用。

- [ ] **Step 1: 写失败的测试**

创建 `src/core/rangeStrength.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseCards } from './cards';
import { createRng } from './rng';
import { parseRange } from './rangeNotation';
import { rangeFraction } from './rangeSet';
import { rankRange, topFraction, strengthPercentile } from './rangeStrength';

describe('rankRange', () => {
  it('按强度降序排列', () => {
    const ranked = rankRange(parseRange('AA, 72o'), [], [], 200, createRng('rank-1'));
    for (let i = 0; i + 1 < ranked.length; i++) {
      expect(ranked[i].strength).toBeGreaterThanOrEqual(ranked[i + 1].strength);
    }
  });

  it('翻前 AA 强于 72o', () => {
    const ranked = rankRange(parseRange('AA, 72o'), [], [], 400, createRng('rank-2'));
    const aa = ranked.filter(r => r.handClass === 'AA')[0];
    const junk = ranked.filter(r => r.handClass === '72o')[0];
    expect(aa.strength).toBeGreaterThan(junk.strength);
    expect(aa.strength).toBeGreaterThan(0.8);
    expect(junk.strength).toBeLessThan(0.45);
  });

  it('公共牌改变强度排序', () => {
    // 公共牌 7 7 2：72o 成葫芦，AA 只是两对
    const board = parseCards('7h 7d 2c');
    const ranked = rankRange(parseRange('AA, 72o'), board, board, 400, createRng('rank-3'));
    const aa = ranked.filter(r => r.handClass === 'AA')[0];
    const boat = ranked.filter(r => r.handClass === '72o')[0];
    expect(boat.strength).toBeGreaterThan(aa.strength);
  });

  it('剔除死牌', () => {
    const ranked = rankRange(parseRange('AA'), [], parseCards('As'), 100, createRng('rank-4'));
    expect(ranked).toHaveLength(3);   // 剩三张 A 的 C(3,2)
  });

  it('保留原有权重', () => {
    const ranked = rankRange(parseRange('AA:0.5'), [], [], 100, createRng('rank-5'));
    for (const r of ranked) expect(r.weight).toBe(0.5);
  });

  it('空范围得到空数组', () => {
    expect(rankRange(new Map(), [], [], 100, createRng('rank-6'))).toEqual([]);
  });
});

describe('topFraction', () => {
  const ranked = () => rankRange(parseRange('22+, A2s+, K9s+, ATo+'), [], [], 150, createRng('top'));

  it('取全部时范围宽度不变', () => {
    const r = ranked();
    const all = topFraction(r, 1);
    expect(rangeFraction(all)).toBeCloseTo(rangeFraction(parseRange('22+, A2s+, K9s+, ATo+')), 6);
  });

  it('取一半时加权组合数约为一半', () => {
    const r = ranked();
    const half = topFraction(r, 0.5);
    const full = topFraction(r, 1);
    const ratio = rangeFraction(half) / rangeFraction(full);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  it('取 0 得到空范围', () => {
    expect(topFraction(ranked(), 0).size).toBe(0);
  });

  it('保留的是最强的部分：AA 在前 10% 里，72o 不在', () => {
    const r = rankRange(parseRange('22+, A2s+, 72o'), [], [], 200, createRng('top-2'));
    const strong = topFraction(r, 0.1);
    expect(strong.has('AA')).toBe(true);
    expect(strong.has('72o')).toBe(false);
  });

  it('比例超出 [0,1] 抛错', () => {
    expect(() => topFraction(ranked(), 1.5)).toThrow();
    expect(() => topFraction(ranked(), -0.1)).toThrow();
  });
});

describe('strengthPercentile', () => {
  it('最强的类别分位接近 1，最弱的接近 0', () => {
    const r = rankRange(parseRange('AA, KK, QQ, 72o'), [], [], 300, createRng('pct'));
    expect(strengthPercentile(r, 'AA')).toBeGreaterThan(0.7);
    expect(strengthPercentile(r, '72o')).toBeLessThan(0.3);
  });

  it('不在范围内的类别返回 0', () => {
    const r = rankRange(parseRange('AA'), [], [], 100, createRng('pct-2'));
    expect(strengthPercentile(r, '72o')).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/rangeStrength.test.ts`
Expected: FAIL，找不到模块 `./rangeStrength`

- [ ] **Step 3: 实现 rangeStrength.ts**

创建 `src/core/rangeStrength.ts`：

```ts
import type { Card } from './cards';
import type { Rng } from './rng';
import type { HandClass } from './handClass';
import type { RangeSet, WeightedCombo } from './rangeSet';
import { rangeCombos, totalWeight } from './rangeSet';
import { equityMonteCarlo } from './equity';

export interface RankedCombo extends WeightedCombo {
  /** 该组合对一个随机手的胜率，0..1 */
  strength: number;
}

/**
 * 给范围里的每个组合打上牌力分，按强度降序返回。
 *
 * 牌力定义为「对一个随机手的胜率」：它对翻前和每条街都有定义、单调、
 * 且不依赖于对手的对手是谁。牌型分值只在河牌圈才完整，翻牌圈无法比较
 * 听牌与小对子，因此不适合做排序键。
 *
 * 开销与范围大小成正比，调用方应缓存结果。
 */
export function rankRange(
  range: RangeSet,
  board: Card[],
  dead: readonly Card[],
  iterations: number,
  rng: Rng,
): RankedCombo[] {
  const combos = rangeCombos(range, dead);
  const out: RankedCombo[] = combos.map(c => ({
    ...c,
    strength: equityMonteCarlo(c.cards, board, 1, iterations, rng),
  }));
  out.sort((a, b) => b.strength - a.strength);
  return out;
}

/**
 * 取加权前 fraction 比例的组合，重组成 RangeSet。
 * 同一类别的多个组合可能部分入选，此时该类别的权重按入选组合的比例折算。
 */
export function topFraction(ranked: readonly RankedCombo[], fraction: number): RangeSet {
  if (fraction < 0 || fraction > 1) {
    throw new Error(`比例必须在 [0,1] 内，收到 ${fraction}`);
  }

  const target = totalWeight(ranked) * fraction;
  const acc = new Map<HandClass, number>();
  let taken = 0;

  for (const c of ranked) {
    if (taken >= target) break;
    const room = target - taken;
    const use = Math.min(c.weight, room);
    acc.set(c.handClass, (acc.get(c.handClass) ?? 0) + use);
    taken += use;
  }

  // acc 里累计的是「组合权重之和」，换算回类别权重需除以该类别的组合数。
  // 直接按入选比例还原：类别权重 = 累计权重 / 该类别在 ranked 中的组合数
  const comboCountInRange = new Map<HandClass, number>();
  for (const c of ranked) {
    comboCountInRange.set(c.handClass, (comboCountInRange.get(c.handClass) ?? 0) + 1);
  }

  const out = new Map<HandClass, number>();
  for (const [hc, sum] of acc) {
    const n = comboCountInRange.get(hc) ?? 1;
    const w = sum / n;
    if (w > 0) out.set(hc, Math.min(1, w));
  }
  return out;
}

/** 该类别在范围中的强度分位：0 最弱、1 最强。不在范围内返回 0。 */
export function strengthPercentile(ranked: readonly RankedCombo[], hc: HandClass): number {
  if (ranked.length === 0) return 0;
  const idxs: number[] = [];
  for (let i = 0; i < ranked.length; i++) {
    if (ranked[i].handClass === hc) idxs.push(i);
  }
  if (idxs.length === 0) return 0;
  const avgIdx = idxs.reduce((a, b) => a + b, 0) / idxs.length;
  return 1 - avgIdx / Math.max(1, ranked.length - 1);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/rangeStrength.test.ts`
Expected: PASS

- [ ] **Step 5: 跑全套**

Run: `npm test` 与 `npm run typecheck`

- [ ] **Step 6: 提交**

```bash
git add src/core/rangeStrength.ts src/core/rangeStrength.test.ts
git commit -m "feat(core): 范围牌力排序与 top 比例子集切分

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Situation —— AI 与复盘引擎的共用局面快照

对局中的 AI 和事后的复盘引擎要回答同一个问题：「这个局面下各动作的期望是多少」。把这个问题的**输入**固定成一个与来源无关的快照，两者就走同一条估算路径，判断标准天然一致 —— 不会出现「复盘说这里该弃牌，可 AI 在同样局面下从来不弃」的割裂。

**Files:**
- Create: `src/core/situation.ts`
- Test: `src/core/situation.test.ts`

**Interfaces:**
- Consumes: `Card`（`./cards`）；`Street`, `Position`, `GameState`, `SeatState`（`./types`）；`currentPot`, `legalActions`（`./gameEngine`）；`round2`（`./chips`）；`RangeSet`（`./rangeSet`）；`fullRange`（`./rangeSet`）
- Produces:
  - `interface SituationOpponent { seat: number; position: Position; stack: number; range: RangeSet; personaId: string }`
  - `interface Situation { heroSeat, heroCards, board, street, pot, toCall, heroStack, heroStreetContribution, opponents, heroIsPreflopAggressor, heroPosition }`
  - `situationFromGameState(state: GameState, opts: { ranges: Map<number, RangeSet>; personaIds: Map<number, string> }): Situation` — 从**正在进行**的对局构造，`state.toAct` 必须非空
  - `describeSituation(s: Situation): string` — 单行可读摘要，仅用于测试与调试

`opponents` 只包含**仍未弃牌且未全下**的对手（他们的决策还会影响 EV）；已全下的对手不在其中，但他们的筹码已计入 `pot`。

- [ ] **Step 1: 写失败的测试**

创建 `src/core/situation.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { startHand, applyAction } from './gameEngine';
import { BIG_BLIND, SEAT_COUNT } from './types';
import type { GameState } from './types';
import { fullRange } from './rangeSet';
import { parseRange } from './rangeNotation';
import { situationFromGameState, describeSituation } from './situation';

function ranges(): Map<number, ReturnType<typeof fullRange>> {
  const m = new Map();
  for (let i = 0; i < SEAT_COUNT; i++) m.set(i, fullRange());
  return m;
}
function personas(): Map<number, string> {
  const m = new Map<number, string>();
  for (let i = 0; i < SEAT_COUNT; i++) m.set(i, i === 0 ? 'hero' : 'tag');
  return m;
}
const opts = () => ({ ranges: ranges(), personaIds: personas() });

describe('situationFromGameState 基本字段', () => {
  it('翻前开局：底池 1.5、UTG 面对 1BB', () => {
    const s = startHand({ seed: 'sit-1', buttonSeat: 0 });
    const sit = situationFromGameState(s, opts());
    expect(sit.street).toBe('preflop');
    expect(sit.pot).toBe(1.5);
    expect(sit.toCall).toBe(BIG_BLIND);
    expect(sit.heroSeat).toBe(s.toAct);
    expect(sit.heroPosition).toBe('UTG');
  });

  it('heroCards 取自当前行动座位', () => {
    const s = startHand({ seed: 'sit-2', buttonSeat: 0 });
    const sit = situationFromGameState(s, opts());
    expect(sit.heroCards).toEqual(s.seats[s.toAct!].holeCards);
  });

  it('heroStack 与 heroStreetContribution 取自该座位', () => {
    const s = startHand({ seed: 'sit-3', buttonSeat: 0 });
    const sit = situationFromGameState(s, opts());
    const seat = s.seats[s.toAct!];
    expect(sit.heroStack).toBe(seat.stack);
    expect(sit.heroStreetContribution).toBe(seat.streetContribution);
  });
});

describe('situationFromGameState 对手集合', () => {
  it('包含其余 5 家', () => {
    const s = startHand({ seed: 'sit-4', buttonSeat: 0 });
    expect(situationFromGameState(s, opts()).opponents).toHaveLength(5);
  });

  it('排除已弃牌的对手', () => {
    let s = startHand({ seed: 'sit-5', buttonSeat: 0 });
    s = applyAction(s, { type: 'fold' });     // UTG 弃牌
    const sit = situationFromGameState(s, opts());
    expect(sit.opponents).toHaveLength(4);
    expect(sit.opponents.some(o => o.seat === 3)).toBe(false);   // UTG 是座位 3
  });

  it('排除自己', () => {
    const s = startHand({ seed: 'sit-6', buttonSeat: 0 });
    const sit = situationFromGameState(s, opts());
    expect(sit.opponents.some(o => o.seat === sit.heroSeat)).toBe(false);
  });

  it('带上各自的范围与 persona', () => {
    const s = startHand({ seed: 'sit-7', buttonSeat: 0 });
    const custom = ranges();
    custom.set(4, parseRange('AA, KK'));
    const sit = situationFromGameState(s, { ranges: custom, personaIds: personas() });
    const opp = sit.opponents.find(o => o.seat === 4)!;
    expect(opp.range.size).toBe(2);
    expect(opp.personaId).toBe('tag');
  });

  it('缺少某座位的范围时回落到全范围', () => {
    const s = startHand({ seed: 'sit-8', buttonSeat: 0 });
    const sit = situationFromGameState(s, { ranges: new Map(), personaIds: new Map() });
    for (const o of sit.opponents) {
      expect(o.range.size).toBe(169);
      expect(o.personaId).toBe('unknown');
    }
  });
});

describe('situationFromGameState 翻前加注者标记', () => {
  it('无人加注时为 false', () => {
    const s = startHand({ seed: 'sit-9', buttonSeat: 0 });
    expect(situationFromGameState(s, opts()).heroIsPreflopAggressor).toBe(false);
  });

  it('翻牌圈能正确区分谁是翻前加注者', () => {
    // buttonSeat 0 时：BTN=0, SB=1, BB=2, UTG=3, HJ=4, CO=5
    // 翻前 UTG 加注、其余弃牌、大盲跟注；翻后由大盲先行动
    let s = startHand({ seed: 'sit-10', buttonSeat: 0 });
    expect(s.toAct).toBe(3);                       // UTG
    s = applyAction(s, { type: 'raise', amount: 3 });
    s = applyAction(s, { type: 'fold' });           // HJ
    s = applyAction(s, { type: 'fold' });           // CO
    s = applyAction(s, { type: 'fold' });           // BTN
    s = applyAction(s, { type: 'fold' });           // SB
    s = applyAction(s, { type: 'call' });           // BB 跟注，进入翻牌圈
    expect(s.street).toBe('flop');

    // 翻牌圈先由大盲行动，他不是翻前加注者
    expect(s.toAct).toBe(2);
    expect(situationFromGameState(s, opts()).heroIsPreflopAggressor).toBe(false);

    // 大盲过牌后轮到 UTG，他才是翻前加注者
    s = applyAction(s, { type: 'check' });
    expect(s.toAct).toBe(3);
    expect(situationFromGameState(s, opts()).heroIsPreflopAggressor).toBe(true);
  });
});

describe('situationFromGameState 前置条件', () => {
  it('本手已结束时抛错', () => {
    let s = startHand({ seed: 'sit-11', buttonSeat: 0 });
    for (let i = 0; i < 5 && !s.handOver; i++) s = applyAction(s, { type: 'fold' });
    expect(() => situationFromGameState(s, opts())).toThrow();
  });
});

describe('describeSituation', () => {
  it('输出单行摘要，包含街道与底池', () => {
    const s = startHand({ seed: 'sit-12', buttonSeat: 0 });
    const text = describeSituation(situationFromGameState(s, opts()));
    expect(text).toContain('preflop');
    expect(text).toContain('1.5');
    expect(text.split('\n')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/situation.test.ts`
Expected: FAIL，找不到模块 `./situation`

- [ ] **Step 3: 实现 situation.ts**

创建 `src/core/situation.ts`：

```ts
import type { Card } from './cards';
import { cardToString } from './cards';
import type { GameState, Position, Street } from './types';
import { currentPot } from './gameEngine';
import { round2 } from './chips';
import type { RangeSet } from './rangeSet';
import { fullRange } from './rangeSet';

export interface SituationOpponent {
  seat: number;
  position: Position;
  /** 该对手手上还剩多少筹码 */
  stack: number;
  /** 该对手可能持有的手牌分布 */
  range: RangeSet;
  personaId: string;
}

/**
 * 与来源无关的局面快照。
 *
 * 对局中的 AI 从运行中的 GameState 构造它；复盘引擎从 HandRecord 重放构造它。
 * 两者因此走同一条 EV 估算路径，判断标准天然一致。
 */
export interface Situation {
  heroSeat: number;
  heroPosition: Position;
  heroCards: [Card, Card];
  board: Card[];
  street: Street;
  /** 当前底池总额（含所有人本手已投入的筹码） */
  pot: number;
  /** hero 需要再投入多少才能跟上 */
  toCall: number;
  heroStack: number;
  /** hero 本街已投入 */
  heroStreetContribution: number;
  /** 仍未弃牌且未全下的对手。已全下的对手不在此列，但其筹码已计入 pot。 */
  opponents: SituationOpponent[];
  /** hero 是否是翻前最后一个加注的人 */
  heroIsPreflopAggressor: boolean;
}

export interface SituationOptions {
  /** 座位号 -> 该座位的手牌范围。缺失时回落到全范围。 */
  ranges: Map<number, RangeSet>;
  /** 座位号 -> persona id。缺失时为 'unknown'。 */
  personaIds: Map<number, string>;
}

/** 找出翻前最后一个做出加注动作的座位；无人加注返回 null */
function preflopAggressor(state: GameState): number | null {
  let seat: number | null = null;
  for (const a of state.actions) {
    if (a.street !== 'preflop') break;
    if (a.type === 'raise' || a.type === 'bet' || a.type === 'allin') seat = a.seat;
  }
  return seat;
}

/** 从正在进行的对局构造快照。state.toAct 必须非空。 */
export function situationFromGameState(
  state: GameState,
  opts: SituationOptions,
): Situation {
  if (state.handOver || state.toAct === null) {
    throw new Error('本手已结束或无人待行动，无法构造 Situation');
  }

  const heroSeat = state.toAct;
  const hero = state.seats[heroSeat];

  const opponents: SituationOpponent[] = [];
  for (const s of state.seats) {
    if (s.seat === heroSeat) continue;
    if (s.folded || s.allIn) continue;
    opponents.push({
      seat: s.seat,
      position: s.position,
      stack: s.stack,
      range: opts.ranges.get(s.seat) ?? fullRange(),
      personaId: opts.personaIds.get(s.seat) ?? 'unknown',
    });
  }

  return {
    heroSeat,
    heroPosition: hero.position,
    heroCards: hero.holeCards,
    board: [...state.board],
    street: state.street,
    pot: currentPot(state),
    toCall: round2(state.currentBet - hero.streetContribution),
    heroStack: hero.stack,
    heroStreetContribution: hero.streetContribution,
    opponents,
    heroIsPreflopAggressor: preflopAggressor(state) === heroSeat,
  };
}

/** 单行可读摘要，仅用于测试与调试 */
export function describeSituation(s: Situation): string {
  const board = s.board.map(cardToString).join(' ') || '-';
  const hero = s.heroCards.map(cardToString).join('');
  return `[${s.street}] ${s.heroPosition} ${hero} | 公共牌 ${board} | 底池 ${s.pot} | 待跟 ${s.toCall} | 筹码 ${s.heroStack} | 对手 ${s.opponents.length}`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/situation.test.ts`
Expected: PASS

- [ ] **Step 5: 跑全套**

Run: `npm test` 与 `npm run typecheck`

- [ ] **Step 6: 提交**

```bash
git add src/core/situation.ts src/core/situation.test.ts
git commit -m "feat(core): Situation 局面快照与从 GameState 构造

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: 候选动作 EV 估算

本计划的核心。实现 spec §8.3 的三条公式与 §8.4 的隐含赔率修正。

**Files:**
- Create: `src/core/evEstimate.ts`
- Test: `src/core/evEstimate.test.ts`

**Interfaces:**
- Consumes: `Card`（`./cards`）；`Rng`（`./rng`）；`round2`, `chipsGreater`, `isZeroChips`（`./chips`）；`Situation`（`./situation`）；`RangeSet`（`./rangeSet`）；`equityVsRanges`（`./equity`）；`rankRange`, `topFraction`（`./rangeStrength`）；`classifyHand`（`./handClass`）
- Produces:
  - `interface EvCandidate { label: string; actionType: ActionType; investment: number; ev: number; isRecommended: boolean }`
  - `interface EvResult { candidates: EvCandidate[]; heroEquity: number; requiredEquity: number | null; recommended: EvCandidate; iterations: number }`
  - `estimateEv(sit: Situation, opts?: EvOptions): EvResult`
  - `interface EvOptions { iterations?: number; strengthIterations?: number; rng?: Rng; impliedOdds?: boolean }`

**公式**（spec §8.3，以「此刻起」为基准，已投入的是沉没成本）：

```
EV(弃牌)   = 0
EV(跟注)   = W × (底池 + 跟注额) − 跟注额
EV(下注 B) = Fe × 底池 + (1 − Fe) × [ W' × (底池 + 2B) − B ]
```

- `W` = 对当前对手范围的胜率（`equityVsRanges`）
- `Fe` = 所有对手都弃牌的概率 = Π(1 − 各对手继续比例)
- 各对手继续比例 = **MDF** = 底池 / (底池 + B)，即面对该尺度时理论上必须防守的比例
- `W'` = 对手继续后的胜率，对手范围换成各自「按牌力排序后最强的 MDF 比例」子集

`W'` 必须单独算。若沿用 `W`，会系统性高估诈唬价值 —— 对手跟注时留下的是更强的那部分范围。

候选下注尺度固定为 1/3 池、1/2 池、2/3 池、满池、all-in（spec §8.3），不做连续尺度搜索。

- [ ] **Step 1: 写失败的测试**

创建 `src/core/evEstimate.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseCards } from './cards';
import type { Card } from './cards';
import { createRng } from './rng';
import { parseRange } from './rangeNotation';
import { fullRange } from './rangeSet';
import type { Situation } from './situation';
import { estimateEv } from './evEstimate';

function sit(over: Partial<Situation>): Situation {
  return {
    heroSeat: 0,
    heroPosition: 'BTN',
    heroCards: parseCards('As Ks') as [Card, Card],
    board: [],
    street: 'preflop',
    pot: 10,
    toCall: 0,
    heroStack: 100,
    heroStreetContribution: 0,
    opponents: [{ seat: 1, position: 'BB', stack: 100, range: fullRange(), personaId: 'tag' }],
    heroIsPreflopAggressor: false,
    ...over,
  };
}

const OPTS = { iterations: 2000, strengthIterations: 100, rng: createRng('ev-test') };

describe('estimateEv 基本结构', () => {
  it('候选里总是包含弃牌或过牌', () => {
    const r = estimateEv(sit({ toCall: 5 }), OPTS);
    expect(r.candidates.some(c => c.actionType === 'fold')).toBe(true);
  });

  it('无需跟注时给出过牌而非弃牌', () => {
    const r = estimateEv(sit({ toCall: 0 }), OPTS);
    expect(r.candidates.some(c => c.actionType === 'check')).toBe(true);
    expect(r.candidates.some(c => c.actionType === 'fold')).toBe(false);
  });

  it('弃牌 EV 恒为 0', () => {
    const r = estimateEv(sit({ toCall: 5 }), OPTS);
    expect(r.candidates.find(c => c.actionType === 'fold')!.ev).toBe(0);
  });

  it('恰好一个候选被标为推荐，且它的 EV 最高', () => {
    const r = estimateEv(sit({ toCall: 5 }), OPTS);
    expect(r.candidates.filter(c => c.isRecommended)).toHaveLength(1);
    const best = Math.max(...r.candidates.map(c => c.ev));
    expect(r.recommended.ev).toBe(best);
    expect(r.recommended.isRecommended).toBe(true);
  });

  it('下注尺度覆盖 1/3、1/2、2/3、满池、all-in', () => {
    const r = estimateEv(sit({ toCall: 0, pot: 12, heroStack: 100 }), OPTS);
    const labels = r.candidates.map(c => c.label);
    expect(labels).toContain('bet 1/3');
    expect(labels).toContain('bet 1/2');
    expect(labels).toContain('bet 2/3');
    expect(labels).toContain('bet pot');
    expect(labels).toContain('all-in');
  });

  it('筹码不足以下满池时该尺度不出现', () => {
    const r = estimateEv(sit({ toCall: 0, pot: 100, heroStack: 20 }), OPTS);
    expect(r.candidates.map(c => c.label)).not.toContain('bet pot');
    expect(r.candidates.map(c => c.label)).toContain('all-in');
  });
});

describe('estimateEv 跟注公式', () => {
  it('requiredEquity = 跟注额 / (底池 + 跟注额)', () => {
    const r = estimateEv(sit({ pot: 100, toCall: 50 }), OPTS);
    expect(r.requiredEquity).toBeCloseTo(50 / 150, 9);
  });

  it('无需跟注时 requiredEquity 为 null', () => {
    expect(estimateEv(sit({ toCall: 0 }), OPTS).requiredEquity).toBeNull();
  });

  it('跟注 EV 符合公式 W×(底池+跟注额) − 跟注额', () => {
    const r = estimateEv(sit({ pot: 100, toCall: 50 }), OPTS);
    const call = r.candidates.find(c => c.actionType === 'call')!;
    const expected = r.heroEquity * (100 + 50) - 50;
    expect(call.ev).toBeCloseTo(expected, 6);
  });
});

describe('estimateEv 胜率驱动决策', () => {
  it('胜率远低于所需赔率时推荐弃牌', () => {
    // 河牌圈 hero 只有高牌 J 高，面对满池下注，对手范围很强
    const r = estimateEv(sit({
      street: 'river',
      board: parseCards('As Kd 9h 4c 2s'),
      heroCards: parseCards('Jh Th') as [Card, Card],
      pot: 100,
      toCall: 100,
      opponents: [{ seat: 1, position: 'BB', stack: 200, range: parseRange('AA, KK, AKs, AKo, AQs'), personaId: 'tag' }],
    }), OPTS);
    expect(r.recommended.actionType).toBe('fold');
  });

  it('拿到坚果时不推荐弃牌', () => {
    const r = estimateEv(sit({
      street: 'river',
      board: parseCards('Qs Js 9s 4h 2d'),
      heroCards: parseCards('As Ks') as [Card, Card],
      pot: 100,
      toCall: 30,
      opponents: [{ seat: 1, position: 'BB', stack: 200, range: parseRange('22+, A2s+, K9s+'), personaId: 'tag' }],
    }), OPTS);
    expect(r.recommended.actionType).not.toBe('fold');
    expect(r.heroEquity).toBeGreaterThan(0.85);
  });
});

describe('estimateEv 弃牌率与跟注后胜率', () => {
  it('对手跟注后的胜率严格低于对全范围的胜率', () => {
    // 这是公式里 W' 必须单独算的原因：对手跟注时留下的是更强的那部分范围。
    // 若实现偷懒沿用 W，这条会失败。
    const r = estimateEv(sit({
      street: 'flop',
      board: parseCards('7h 4d 2c'),
      heroCards: parseCards('As Ks') as [Card, Card],
      pot: 10,
      toCall: 0,
      opponents: [{ seat: 1, position: 'BB', stack: 100, range: fullRange(), personaId: 'tag' }],
    }), OPTS);
    const bet = r.candidates.find(c => c.label === 'bet 2/3')!;
    expect(bet.equityWhenCalled).toBeDefined();
    expect(bet.equityWhenCalled!).toBeLessThan(r.heroEquity);
  });

  it('下注尺度越大，对手弃牌率越高', () => {
    // foldEquity = (1 - MDF)^对手数，是确定性算式，不含蒙特卡洛噪声
    const r = estimateEv(sit({ pot: 10, toCall: 0, heroStack: 100 }), OPTS);
    const small = r.candidates.find(c => c.label === 'bet 1/3')!;
    const mid = r.candidates.find(c => c.label === 'bet 2/3')!;
    const big = r.candidates.find(c => c.label === 'bet pot')!;
    expect(small.foldEquity!).toBeLessThan(mid.foldEquity!);
    expect(mid.foldEquity!).toBeLessThan(big.foldEquity!);
  });

  it('对手越多，全体弃牌的概率越低', () => {
    const one = estimateEv(sit({
      pot: 10, toCall: 0,
      opponents: [{ seat: 1, position: 'BB', stack: 100, range: fullRange(), personaId: 'tag' }],
    }), OPTS);
    const three = estimateEv(sit({
      pot: 10, toCall: 0,
      opponents: [1, 2, 3].map(seat => ({
        seat, position: 'BB' as const, stack: 100, range: fullRange(), personaId: 'tag',
      })),
    }), OPTS);
    const feOne = one.candidates.find(c => c.label === 'bet pot')!.foldEquity!;
    const feThree = three.candidates.find(c => c.label === 'bet pot')!.foldEquity!;
    expect(feThree).toBeLessThan(feOne);
  });

  it('拿到坚果时价值下注优于过牌', () => {
    const r = estimateEv(sit({
      street: 'river',
      board: parseCards('Qs Js 9s 4h 2d'),
      heroCards: parseCards('As Ks') as [Card, Card],
      pot: 100,
      toCall: 0,
      heroStack: 200,
      opponents: [{ seat: 1, position: 'BB', stack: 200, range: parseRange('22+, A2s+, K9s+, QTs+'), personaId: 'tag' }],
    }), OPTS);
    const check = r.candidates.find(c => c.actionType === 'check')!;
    const bet = r.candidates.find(c => c.label === 'bet 2/3')!;
    expect(bet.ev).toBeGreaterThan(check.ev);
    expect(r.recommended.actionType).not.toBe('check');
  });
});

describe('estimateEv 可复现', () => {
  it('相同 seed 得到完全相同的结果', () => {
    const run = () => estimateEv(sit({ toCall: 5 }), { ...OPTS, rng: createRng('same') });
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});

describe('estimateEv 多人底池', () => {
  it('对手越多，hero 胜率越低', () => {
    const one = estimateEv(sit({
      opponents: [{ seat: 1, position: 'BB', stack: 100, range: fullRange(), personaId: 'tag' }],
    }), OPTS);
    const three = estimateEv(sit({
      opponents: [1, 2, 3].map(seat => ({
        seat, position: 'BB' as const, stack: 100, range: fullRange(), personaId: 'tag',
      })),
    }), OPTS);
    expect(three.heroEquity).toBeLessThan(one.heroEquity);
  });

  it('无对手时抛错', () => {
    expect(() => estimateEv(sit({ opponents: [] }), OPTS)).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/evEstimate.test.ts`
Expected: FAIL，找不到模块 `./evEstimate`

- [ ] **Step 3: 实现 evEstimate.ts**

创建 `src/core/evEstimate.ts`：

```ts
import type { ActionType } from './types';
import type { Rng } from './rng';
import { createRng } from './rng';
import { round2, chipsGreater } from './chips';
import type { Situation } from './situation';
import type { RangeSet } from './rangeSet';
import { equityVsRanges } from './equity';
import { rankRange, topFraction } from './rangeStrength';

export interface EvCandidate {
  /** 面向人的标签：'fold' / 'call' / 'bet 1/2' / 'all-in' */
  label: string;
  actionType: ActionType;
  /** 本次需要投入的筹码 */
  investment: number;
  /** 以「此刻起」为基准的期望值，单位 BB */
  ev: number;
  isRecommended: boolean;
  /** 仅下注/加注候选有：所有对手都弃牌的概率 */
  foldEquity?: number;
  /** 仅下注/加注候选有：对手跟注后 hero 的胜率（W'） */
  equityWhenCalled?: number;
}

export interface EvResult {
  candidates: EvCandidate[];
  /** hero 对当前对手范围的胜率 */
  heroEquity: number;
  /** 跟注所需的最低胜率；无需跟注时为 null */
  requiredEquity: number | null;
  recommended: EvCandidate;
  iterations: number;
}

export interface EvOptions {
  /** 主胜率估算的蒙特卡洛迭代数 */
  iterations?: number;
  /** 范围牌力排序的迭代数（每个组合一次小规模模拟） */
  strengthIterations?: number;
  rng?: Rng;
  /** 是否加入隐含赔率修正，默认开启 */
  impliedOdds?: boolean;
}

/** 候选下注尺度，占底池的比例。spec §8.3 固定这五档，不做连续搜索。 */
const BET_SIZES: Array<{ label: string; fraction: number }> = [
  { label: 'bet 1/3', fraction: 1 / 3 },
  { label: 'bet 1/2', fraction: 1 / 2 },
  { label: 'bet 2/3', fraction: 2 / 3 },
  { label: 'bet pot', fraction: 1 },
];

/**
 * 估算局面下各候选动作的期望值。
 *
 * 以「此刻起」为基准：已经投进池子的筹码是沉没成本，不参与计算。
 * 这是单步近似，不展开未来街的博弈树 —— 它能可靠指出明显错误，
 * 但不应被当作 solver 的精确输出（见设计文档 §12）。
 */
export function estimateEv(sit: Situation, opts: EvOptions = {}): EvResult {
  if (sit.opponents.length === 0) {
    throw new Error('Situation 中没有对手，无法估算 EV');
  }

  const iterations = opts.iterations ?? 2000;
  const strengthIterations = opts.strengthIterations ?? 120;
  const rng = opts.rng ?? createRng('ev-default');
  const useImplied = opts.impliedOdds ?? true;

  const oppRanges: RangeSet[] = sit.opponents.map(o => o.range);
  const dead = [...sit.heroCards, ...sit.board];

  // W：对当前对手范围的胜率
  const heroEquity = equityVsRanges(sit.heroCards, sit.board, oppRanges, iterations, rng);

  // 各对手范围按牌力排好序，供后续切「继续范围」用。排序开销大，只做一次。
  const rankedPerOpp = sit.opponents.map(o =>
    rankRange(o.range, sit.board, dead, strengthIterations, rng),
  );

  const candidates: EvCandidate[] = [];

  // ── 弃牌 / 过牌
  if (chipsGreater(sit.toCall, 0)) {
    candidates.push({ label: 'fold', actionType: 'fold', investment: 0, ev: 0, isRecommended: false });
  } else {
    // 过牌：不投入、不弃权，期望等于「看到摊牌」的份额近似
    candidates.push({
      label: 'check',
      actionType: 'check',
      investment: 0,
      ev: round4(heroEquity * sit.pot),
      isRecommended: false,
    });
  }

  // ── 跟注
  if (chipsGreater(sit.toCall, 0) && chipsGreater(sit.heroStack, sit.toCall)) {
    let ev = heroEquity * (sit.pot + sit.toCall) - sit.toCall;
    if (useImplied) ev += impliedOddsBonus(sit, heroEquity);
    candidates.push({
      label: 'call',
      actionType: 'call',
      investment: sit.toCall,
      ev: round4(ev),
      isRecommended: false,
    });
  }

  // ── 下注 / 加注
  const maxInvest = sit.heroStack;
  for (const size of BET_SIZES) {
    const b = round2(sit.pot * size.fraction + sit.toCall);
    if (!chipsGreater(maxInvest, b)) continue;   // 筹码不足以打出这个尺度
    candidates.push(makeBetCandidate(sit, size.label, b, rankedPerOpp, iterations, rng));
  }

  // all-in 永远是一个候选
  candidates.push(makeBetCandidate(sit, 'all-in', maxInvest, rankedPerOpp, iterations, rng));

  // ── 选出推荐动作
  let best = candidates[0];
  for (const c of candidates) if (c.ev > best.ev) best = c;
  best.isRecommended = true;

  return {
    candidates,
    heroEquity,
    requiredEquity: chipsGreater(sit.toCall, 0) ? sit.toCall / (sit.pot + sit.toCall) : null,
    recommended: best,
    iterations,
  };
}

/**
 * EV(下注 B) = Fe × 底池 + (1 − Fe) × [ W' × (底池 + 2B) − B ]
 *
 * Fe   所有对手都弃牌的概率
 * W'   对手跟注后的胜率 —— 必须对「继续范围」单独算，
 *      沿用 W 会系统性高估诈唬价值
 */
function makeBetCandidate(
  sit: Situation,
  label: string,
  investment: number,
  rankedPerOpp: ReturnType<typeof rankRange>[],
  iterations: number,
  rng: Rng,
): EvCandidate {
  const b = investment;

  // 每个对手面对该尺度时理论上必须防守的比例（MDF）
  const mdf = Math.min(1, sit.pot / (sit.pot + b));
  const continueRanges: RangeSet[] = rankedPerOpp.map(r => topFraction(r, mdf));

  // 所有人都弃牌的概率：每个对手独立以 (1 - mdf) 的概率弃牌
  const foldEquity = Math.pow(1 - mdf, continueRanges.length);

  // W'：对手跟注后的胜率。必须对「继续范围」单独算 ——
  // 沿用 W 会系统性高估诈唬价值，因为对手跟注时留下的是更强的那部分范围。
  // 若任一继续范围被死牌清空，回落到原范围（此时该近似会偏保守）。
  const allUsable = continueRanges.every(r => r.size > 0);
  const rangesForCalled = allUsable ? continueRanges : sit.opponents.map(o => o.range);
  const wPrime = equityVsRanges(sit.heroCards, sit.board, rangesForCalled, iterations, rng);

  const ev = foldEquity * sit.pot + (1 - foldEquity) * (wPrime * (sit.pot + 2 * b) - b);

  return {
    label,
    actionType: chipsGreater(sit.toCall, 0) ? 'raise' : 'bet',
    investment: round2(b),
    ev: round4(ev),
    isRecommended: false,
    foldEquity: round4(foldEquity),
    equityWhenCalled: round4(wPrime),
  };
}

/**
 * 隐含赔率修正（spec §8.4）。
 *
 * 纯即时 EV 低估听牌与小口袋对：击中之后还能从对手后续街的下注里赚到钱。
 * 这是启发式近似，会在 UI 上标注。
 */
function impliedOddsBonus(sit: Situation, heroEquity: number): number {
  if (sit.street === 'river') return 0;          // 河牌之后没有未来街
  if (heroEquity > 0.5) return 0;                // 已经领先，不属于「博击中」

  const effectiveStack = Math.min(
    sit.heroStack,
    ...sit.opponents.map(o => o.stack),
  );
  if (!chipsGreater(effectiveStack, 0)) return 0;

  // 击中概率用「距离摊牌的胜率缺口」粗略代表
  const hitChance = Math.max(0, Math.min(0.35, heroEquity));
  // 击中后预期能从对手那里多赚的比例
  const realiseRate = 0.35;

  return effectiveStack * hitChance * realiseRate * 0.1;
}

/** EV 保留 4 位小数，避免测试因浮点尾数抖动 */
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/evEstimate.test.ts`
Expected: PASS。含多次蒙特卡洛的用例耗时数秒属正常。

若「胜率远低于所需赔率时推荐弃牌」这条失败，先打印 `r.heroEquity` 与 `r.requiredEquity` 核对：胜率应明显低于所需赔率。**不要通过放宽断言来修绿** —— 那条用例是整个估值引擎最基本的正确性检查。

- [ ] **Step 5: 跑全套**

Run: `npm test` 与 `npm run typecheck`

- [ ] **Step 6: 提交**

```bash
git add src/core/evEstimate.ts src/core/evEstimate.test.ts
git commit -m "feat(core): 候选动作 EV 估算，含弃牌率与跟注后胜率分离计算

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: 对手范围逐街收窄

对手每做一个动作都在暴露信息。本任务把「这个动作意味着他手里可能有什么」编码成范围的收窄。

**Files:**
- Create: `src/core/opponentRange.ts`
- Test: `src/core/opponentRange.test.ts`

**Interfaces:**
- Consumes: `Card`（`./cards`）；`Rng`（`./rng`）；`Position`, `Street`, `ActionType`（`./types`）；`RangeSet`, `fullRange`, `rangeFraction`（`./rangeSet`）；`rankRange`, `topFraction`（`./rangeStrength`）；`rfiKey`, `vsOpenKey`, `hasNode`, `rangeForAction`（`./ranges`）
- Produces:
  - `initialRange(pos: Position): RangeSet` — 该位置的默认起手范围（RFI 表，无表时回落到全范围）
  - `interface NarrowContext { street: Street; board: Card[]; dead: readonly Card[]; potBefore: number; betSize: number; strengthIterations: number; rng: Rng }`
  - `narrowByAction(range: RangeSet, actionType: ActionType, ctx: NarrowContext): RangeSet`

**收窄规则**（spec §8.5）：

| 动作 | 收窄 |
|---|---|
| `fold` | 空范围 |
| `check` | 剔除最强的一部分（强牌通常会下注），保留其余 |
| `call` | 保留 MDF 比例的最强部分，再剔除最顶端的一小部分（最强的牌通常会加注） |
| `bet` / `raise` | 保留最强的一部分，比例随下注尺度收紧 |
| `allin` | 保留最强的一小部分 |

翻前无公共牌时排序退化为起手牌强度，规则同样适用。

- [ ] **Step 1: 写失败的测试**

创建 `src/core/opponentRange.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseCards } from './cards';
import { createRng } from './rng';
import { rangeFraction } from './rangeSet';
import { initialRange, narrowByAction } from './opponentRange';
import type { NarrowContext } from './opponentRange';

const ctx = (over: Partial<NarrowContext> = {}): NarrowContext => ({
  street: 'flop',
  board: parseCards('7h 4d 2c'),
  dead: parseCards('7h 4d 2c'),
  potBefore: 10,
  betSize: 5,
  strengthIterations: 80,
  rng: createRng('narrow'),
  ...over,
});

describe('initialRange', () => {
  it('各位置都能拿到范围', () => {
    for (const pos of ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const) {
      expect(initialRange(pos).size).toBeGreaterThan(0);
    }
  });

  it('位置越靠后范围越宽', () => {
    expect(rangeFraction(initialRange('UTG'))).toBeLessThan(rangeFraction(initialRange('CO')));
    expect(rangeFraction(initialRange('CO'))).toBeLessThan(rangeFraction(initialRange('BTN')));
  });

  it('大盲无 RFI 表，回落到全范围', () => {
    expect(initialRange('BB').size).toBe(169);
  });
});

describe('narrowByAction 弃牌', () => {
  it('弃牌得到空范围', () => {
    expect(narrowByAction(initialRange('BTN'), 'fold', ctx()).size).toBe(0);
  });
});

describe('narrowByAction 收窄方向', () => {
  it('下注后范围变窄', () => {
    const before = initialRange('BTN');
    const after = narrowByAction(before, 'bet', ctx());
    expect(rangeFraction(after)).toBeLessThan(rangeFraction(before));
  });

  it('加注比下注收得更窄', () => {
    const before = initialRange('BTN');
    const bet = narrowByAction(before, 'bet', ctx());
    const raise = narrowByAction(before, 'raise', ctx());
    expect(rangeFraction(raise)).toBeLessThan(rangeFraction(bet));
  });

  it('全下收得最窄', () => {
    const before = initialRange('BTN');
    const allin = narrowByAction(before, 'allin', ctx());
    const raise = narrowByAction(before, 'raise', ctx());
    expect(rangeFraction(allin)).toBeLessThanOrEqual(rangeFraction(raise));
  });

  it('下注尺度越大范围越窄', () => {
    const before = initialRange('BTN');
    const small = narrowByAction(before, 'bet', ctx({ betSize: 3 }));
    const big = narrowByAction(before, 'bet', ctx({ betSize: 20 }));
    expect(rangeFraction(big)).toBeLessThan(rangeFraction(small));
  });

  it('跟注后范围也变窄，但不如加注窄', () => {
    const before = initialRange('BTN');
    const call = narrowByAction(before, 'call', ctx());
    const raise = narrowByAction(before, 'raise', ctx());
    expect(rangeFraction(call)).toBeLessThan(rangeFraction(before));
    expect(rangeFraction(call)).toBeGreaterThan(rangeFraction(raise));
  });

  it('过牌剔除最强的部分', () => {
    const before = initialRange('BTN');
    const after = narrowByAction(before, 'check', ctx());
    expect(rangeFraction(after)).toBeLessThan(rangeFraction(before));
  });
});

describe('narrowByAction 保留的是正确的那一端', () => {
  it('下注后保留的是强牌：范围内最强手牌仍在', () => {
    const before = initialRange('CO');
    const after = narrowByAction(before, 'bet', ctx({ board: [], dead: [], street: 'preflop' }));
    expect(after.has('AA')).toBe(true);
  });

  it('过牌后剔除的是强牌：AA 不再出现', () => {
    const before = initialRange('CO');
    const after = narrowByAction(before, 'check', ctx({ board: [], dead: [], street: 'preflop' }));
    expect(after.has('AA')).toBe(false);
  });
});

describe('narrowByAction 边界', () => {
  it('空范围收窄后仍为空', () => {
    expect(narrowByAction(new Map(), 'bet', ctx()).size).toBe(0);
  });

  it('结果永远是原范围的子集', () => {
    const before = initialRange('BTN');
    for (const act of ['check', 'call', 'bet', 'raise', 'allin'] as const) {
      const after = narrowByAction(before, act, ctx());
      for (const hc of after.keys()) {
        expect(before.has(hc)).toBe(true);
      }
    }
  });

  it('相同输入结果可复现', () => {
    const before = initialRange('BTN');
    const a = narrowByAction(before, 'bet', ctx({ rng: createRng('same') }));
    const b = narrowByAction(before, 'bet', ctx({ rng: createRng('same') }));
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/opponentRange.test.ts`
Expected: FAIL，找不到模块 `./opponentRange`

- [ ] **Step 3: 实现 opponentRange.ts**

创建 `src/core/opponentRange.ts`：

```ts
import type { Card } from './cards';
import type { Rng } from './rng';
import type { ActionType, Position, Street } from './types';
import { chipsGreater } from './chips';
import type { RangeSet } from './rangeSet';
import { fullRange } from './rangeSet';
import { rankRange, topFraction } from './rangeStrength';
import { rfiKey, hasNode, rangeForAction } from './ranges';

/** 该位置的默认起手范围。无 RFI 表的位置（大盲）回落到全范围。 */
export function initialRange(pos: Position): RangeSet {
  const key = rfiKey(pos);
  if (hasNode(key)) {
    const r = rangeForAction(key, 'raise');
    if (r) return r;
  }
  return fullRange();
}

export interface NarrowContext {
  street: Street;
  board: Card[];
  /** 已知不可能在对手手里的牌：hero 底牌 + 公共牌 */
  dead: readonly Card[];
  /** 该动作发生前的底池 */
  potBefore: number;
  /** 该动作的下注/加注额；非下注动作可传 0 */
  betSize: number;
  /** 牌力排序的迭代数 */
  strengthIterations: number;
  rng: Rng;
}

/** 保留最强的 keep 比例 */
function keepTop(range: RangeSet, keep: number, ctx: NarrowContext): RangeSet {
  if (range.size === 0) return range;
  const ranked = rankRange(range, ctx.board, ctx.dead, ctx.strengthIterations, ctx.rng);
  return topFraction(ranked, Math.max(0, Math.min(1, keep)));
}

/** 剔除最强的 drop 比例，保留其余 */
function dropTop(range: RangeSet, drop: number, ctx: NarrowContext): RangeSet {
  if (range.size === 0) return range;
  const ranked = rankRange(range, ctx.board, ctx.dead, ctx.strengthIterations, ctx.rng);
  const keepFrom = Math.max(0, Math.min(1, drop));
  const strong = topFraction(ranked, keepFrom);
  const out = new Map<string, number>();
  for (const [hc, w] of range) {
    if (!strong.has(hc)) out.set(hc, w);
  }
  return out;
}

/**
 * 按对手的一个动作收窄其范围。
 *
 * 下注/加注保留强的那一端，过牌剔除强的那一端，跟注居中。
 * 尺度越大收得越紧 —— 用 MDF（底池 / (底池 + 下注额)）作为保留比例的基准，
 * 它正是理论上面对该尺度必须防守的比例。
 */
export function narrowByAction(
  range: RangeSet,
  actionType: ActionType,
  ctx: NarrowContext,
): RangeSet {
  if (actionType === 'fold') return new Map();
  if (range.size === 0) return range;

  const mdf = chipsGreater(ctx.potBefore, 0)
    ? ctx.potBefore / (ctx.potBefore + Math.max(0, ctx.betSize))
    : 1;

  switch (actionType) {
    case 'check':
      // 强牌通常会下注，过牌剔除最强的两成
      return dropTop(range, 0.2, ctx);

    case 'call':
      // 保留 MDF 比例的最强部分（能继续的牌），
      // 最强的牌通常会加注而不是跟注，故再剔除顶端一成
      return dropTop(keepTop(range, mdf, ctx), 0.1, ctx);

    case 'bet':
      // 下注：保留强的一端，尺度越大越紧
      return keepTop(range, Math.min(0.8, mdf), ctx);

    case 'raise':
      // 加注比下注强，收得更紧
      return keepTop(range, Math.min(0.5, mdf * 0.6), ctx);

    case 'allin':
      // 全下：只保留最强的一小部分
      return keepTop(range, 0.25, ctx);

    default:
      return range;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/opponentRange.test.ts`
Expected: PASS

若「加注比下注收得更窄」失败，检查 `mdf` 的取值：`raise` 分支的 `mdf * 0.6` 必须严格小于 `bet` 分支的 `mdf`。**调整实现的系数，不要放宽测试** —— 这些方向性断言是范围建模唯一的正确性锚点。

- [ ] **Step 5: 跑全套**

Run: `npm test` 与 `npm run typecheck`

- [ ] **Step 6: 提交**

```bash
git add src/core/opponentRange.ts src/core/opponentRange.test.ts
git commit -m "feat(core): 对手范围逐街收窄

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 完成标准

计划 ②-A 完成时，以下全部成立：

- [ ] `npm test` 全绿，`npm run typecheck` 退出码 0
- [ ] 新增文件全在 `src/core/` 下，无 React/DOM 引用、无 `Math.random()`
- [ ] 计划①的既有文件除 `equity.ts` 追加一个导出外，全部未被修改；既有测试一条未变
- [ ] 169 类手牌展开后恰好覆盖 1326 个互不相同的组合
- [ ] 范围表每个节点各动作频率之和为 1（容差 0.001），且开池宽度符合位置递增的扑克常识
- [ ] `equityVsRanges` 在全范围对手下与 `equityMonteCarlo` 误差 < 2 个百分点，且 `KK vs AA ≈ 18%`、`AKs vs 22 ≈ 46%` 等已知值成立
- [ ] `estimateEv` 在「胜率远低于所需赔率」的局面下推荐弃牌，在坚果局面下不推荐弃牌

## 交付物清单

```
src/core/handClass.ts          src/core/rangeNotation.ts
src/core/rangeSet.ts           src/core/rangeStrength.ts
src/core/situation.ts          src/core/evEstimate.ts
src/core/opponentRange.ts
src/core/ranges/data.ts        src/core/ranges/index.ts
src/core/equity.ts             （追加 equityVsRanges）
+ 对应的 *.test.ts
```

## 下一步

计划 ②-B（AI 与复盘引擎）在本计划完成后编写，将基于本计划实际产出的接口：
`Situation`、`estimateEv`、`narrowByAction`、`initialRange`、`actionFreqs`。

内容包括：性格原型参数、AI 决策（从 `GameState` 构造 `Situation` 后按 persona 扰动阈值）、
错误分类 `MistakeTag`、复盘引擎 `analyzeHand(HandRecord) -> HandAnalysis`、
以及约 40 个答案无争议的金标准场景作为回归网。
