# 德州扑克训练器 — 计划 ①：core 地基

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成 `src/core/` 全部纯逻辑：可复现随机源、牌型评估、边池计算、完整德扑状态机、蒙特卡洛胜率。完成后命令行能自动跑完一万手完整牌局且筹码守恒不变量从不破。

**Architecture:** 全部为纯函数与不可变状态转移，零 UI 依赖、零全局随机源。游戏引擎是一个 `(state, action) -> state` 的 reducer，每次转移后断言筹码守恒。牌型评估写两份实现（快速版 + 穷举参考版）互相对拍，这是正确性的主要保障手段。

**Tech Stack:** TypeScript 5（strict）、Vitest、fast-check、Node 24、npm 11

**上游文档:** `docs/superpowers/specs/2026-08-06-texas-holdem-trainer-design.md`（§4、§5、§6、§11）

## Global Constraints

- 语言 TypeScript，`tsconfig.json` 必须开启 `"strict": true`
- `src/core/` 内**禁止**出现 `import React`、`document`、`window` 等 UI/DOM 引用
- `src/core/` 内**禁止**直接调用 `Math.random()`；所有随机性由参数传入的 `Rng` 实例提供
- 筹码单位统一为 BB（大盲）。小盲 0.5、大盲 1.0。起始筹码 100
- 金额一律用 number 存储，比较时用 `Math.abs(a-b) < 1e-9` 而非 `===`
- 座位号 `seat` 为 0..5 的整数，`seat 0` 固定为 hero
- 每个任务结束必须提交，提交信息用中文，末尾附 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- 本计划不引入 React、Vite、IndexedDB —— 那些属于计划 ②③

---

### Task 1: 项目脚手架与测试环境

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/core/smoke.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: 可运行的 `npm test` / `npm run typecheck` 命令

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "poker-trainer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "fast-check": "^3.23.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

`noUncheckedIndexedAccess` 特意关闭：牌桌代码大量使用数组下标，开启后会产生几百处无意义的空值断言。

- [ ] **Step 3: 创建 vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: 安装依赖**

Run: `npm install`
Expected: 成功创建 `node_modules/` 与 `package-lock.json`，无 ERR

- [ ] **Step 5: 写冒烟测试**

创建 `src/core/smoke.test.ts`：

```ts
import { describe, it, expect } from 'vitest';

describe('测试环境', () => {
  it('能运行', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: 运行测试确认环境可用**

Run: `npm test`
Expected: PASS，输出含 `1 passed`

- [ ] **Step 7: 确认类型检查可用**

Run: `npm run typecheck`
Expected: 无输出、退出码 0

- [ ] **Step 8: 提交**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/core/smoke.test.ts
git commit -m "chore: 搭建 TypeScript + Vitest 测试环境

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 可复现随机源

**Files:**
- Create: `src/core/rng.ts`
- Test: `src/core/rng.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `interface Rng { nextU32(): number; nextFloat(): number; nextInt(n: number): number }`
  - `createRng(seed: string): Rng`
  - `shuffle<T>(arr: readonly T[], rng: Rng): T[]`

- [ ] **Step 1: 写失败的测试**

创建 `src/core/rng.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { createRng, shuffle } from './rng';

describe('createRng', () => {
  it('相同 seed 产生相同序列', () => {
    const a = createRng('hand-1');
    const b = createRng('hand-1');
    const seqA = Array.from({ length: 20 }, () => a.nextU32());
    const seqB = Array.from({ length: 20 }, () => b.nextU32());
    expect(seqA).toEqual(seqB);
  });

  it('不同 seed 产生不同序列', () => {
    const a = createRng('hand-1');
    const b = createRng('hand-2');
    const seqA = Array.from({ length: 20 }, () => a.nextU32());
    const seqB = Array.from({ length: 20 }, () => b.nextU32());
    expect(seqA).not.toEqual(seqB);
  });

  it('nextInt 落在 [0, n) 内', () => {
    const rng = createRng('range-test');
    for (let i = 0; i < 10000; i++) {
      const v = rng.nextInt(52);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(52);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('nextFloat 落在 [0, 1) 内', () => {
    const rng = createRng('float-test');
    for (let i = 0; i < 10000; i++) {
      const v = rng.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt 分布大致均匀', () => {
    const rng = createRng('uniform-test');
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 100000; i++) buckets[rng.nextInt(10)]++;
    // 每桶期望 10000，允许 ±5%
    for (const c of buckets) {
      expect(c).toBeGreaterThan(9500);
      expect(c).toBeLessThan(10500);
    }
  });
});

describe('shuffle', () => {
  it('是一个排列，不丢不重', () => {
    const src = Array.from({ length: 52 }, (_, i) => i);
    const out = shuffle(src, createRng('shuffle-1'));
    expect(out).toHaveLength(52);
    expect([...out].sort((a, b) => a - b)).toEqual(src);
  });

  it('不修改原数组', () => {
    const src = [1, 2, 3, 4, 5];
    const copy = [...src];
    shuffle(src, createRng('shuffle-2'));
    expect(src).toEqual(copy);
  });

  it('相同 seed 洗出相同结果', () => {
    const src = Array.from({ length: 52 }, (_, i) => i);
    const a = shuffle(src, createRng('same'));
    const b = shuffle(src, createRng('same'));
    expect(a).toEqual(b);
  });

  it('实际打乱了顺序', () => {
    const src = Array.from({ length: 52 }, (_, i) => i);
    const out = shuffle(src, createRng('actually-shuffles'));
    expect(out).not.toEqual(src);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/rng.test.ts`
Expected: FAIL，报错 `Failed to resolve import "./rng"`

- [ ] **Step 3: 实现 rng.ts**

创建 `src/core/rng.ts`：

```ts
/** 可复现的伪随机数发生器。core 层禁止使用 Math.random()，一律走这里。 */
export interface Rng {
  /** 下一个 32 位无符号整数 */
  nextU32(): number;
  /** [0, 1) 区间的浮点数 */
  nextFloat(): number;
  /** [0, n) 区间的整数 */
  nextInt(n: number): number;
}

/** FNV-1a：把字符串 seed 压成一个 32 位整数 */
function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32：状态小、速度快、统计质量足够本项目使用 */
export function createRng(seed: string): Rng {
  let state = hashSeed(seed);

  const nextU32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };

  const nextFloat = (): number => nextU32() / 4294967296;

  return {
    nextU32,
    nextFloat,
    nextInt: (n: number) => Math.floor(nextFloat() * n),
  };
}

/** Fisher-Yates 洗牌。返回新数组，不修改入参。 */
export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/rng.test.ts`
Expected: PASS，9 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/core/rng.ts src/core/rng.test.ts
git commit -m "feat(core): 可复现随机源与洗牌

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 牌的表示

**Files:**
- Create: `src/core/cards.ts`
- Test: `src/core/cards.test.ts`

**Interfaces:**
- Consumes: `createRng`, `shuffle`（Task 2）
- Produces:
  - `type Suit = 's' | 'h' | 'd' | 'c'`
  - `type Rank = 2|3|4|5|6|7|8|9|10|11|12|13|14`
  - `interface Card { rank: Rank; suit: Suit }`
  - `makeDeck(): Card[]`
  - `shuffledDeck(rng: Rng): Card[]`
  - `cardToString(c: Card): string` — 如 `"As"` `"Th"`
  - `parseCard(s: string): Card`
  - `parseCards(s: string): Card[]` — 如 `"As Kd 7h"`
  - `sameCard(a: Card, b: Card): boolean`

- [ ] **Step 1: 写失败的测试**

创建 `src/core/cards.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  makeDeck, shuffledDeck, cardToString, parseCard, parseCards, sameCard,
} from './cards';
import { createRng } from './rng';

describe('makeDeck', () => {
  it('生成 52 张牌', () => {
    expect(makeDeck()).toHaveLength(52);
  });

  it('52 张互不重复', () => {
    const names = makeDeck().map(cardToString);
    expect(new Set(names).size).toBe(52);
  });

  it('每种花色 13 张', () => {
    const deck = makeDeck();
    for (const suit of ['s', 'h', 'd', 'c'] as const) {
      expect(deck.filter(c => c.suit === suit)).toHaveLength(13);
    }
  });
});

describe('parseCard / cardToString', () => {
  it('全部 52 张往返一致', () => {
    for (const c of makeDeck()) {
      expect(parseCard(cardToString(c))).toEqual(c);
    }
  });

  it('解析具体牌面', () => {
    expect(parseCard('As')).toEqual({ rank: 14, suit: 's' });
    expect(parseCard('Th')).toEqual({ rank: 10, suit: 'h' });
    expect(parseCard('2c')).toEqual({ rank: 2, suit: 'c' });
  });

  it('非法输入抛错', () => {
    expect(() => parseCard('Xs')).toThrow();
    expect(() => parseCard('Az')).toThrow();
    expect(() => parseCard('A')).toThrow();
  });
});

describe('parseCards', () => {
  it('解析空格分隔的多张牌', () => {
    expect(parseCards('As Kd 7h')).toEqual([
      { rank: 14, suit: 's' },
      { rank: 13, suit: 'd' },
      { rank: 7, suit: 'h' },
    ]);
  });

  it('空串返回空数组', () => {
    expect(parseCards('')).toEqual([]);
  });
});

describe('shuffledDeck', () => {
  it('仍是完整 52 张', () => {
    const d = shuffledDeck(createRng('deck-1'));
    expect(new Set(d.map(cardToString)).size).toBe(52);
  });

  it('相同 seed 结果相同', () => {
    const a = shuffledDeck(createRng('deck-x')).map(cardToString);
    const b = shuffledDeck(createRng('deck-x')).map(cardToString);
    expect(a).toEqual(b);
  });
});

describe('sameCard', () => {
  it('比较点数与花色', () => {
    expect(sameCard(parseCard('As'), parseCard('As'))).toBe(true);
    expect(sameCard(parseCard('As'), parseCard('Ah'))).toBe(false);
    expect(sameCard(parseCard('As'), parseCard('Ks'))).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/cards.test.ts`
Expected: FAIL，报错 `Failed to resolve import "./cards"`

- [ ] **Step 3: 实现 cards.ts**

创建 `src/core/cards.ts`：

```ts
import type { Rng } from './rng';
import { shuffle } from './rng';

export type Suit = 's' | 'h' | 'd' | 'c';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  rank: Rank;
  suit: Suit;
}

export const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'];
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** 下标 0 对应点数 2，下标 12 对应 A */
const RANK_CHARS = '23456789TJQKA';

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function shuffledDeck(rng: Rng): Card[] {
  return shuffle(makeDeck(), rng);
}

export function cardToString(c: Card): string {
  return RANK_CHARS[c.rank - 2] + c.suit;
}

export function parseCard(s: string): Card {
  if (s.length !== 2) throw new Error(`非法牌面: "${s}"`);
  const rankIdx = RANK_CHARS.indexOf(s[0].toUpperCase());
  if (rankIdx < 0) throw new Error(`非法点数: "${s}"`);
  const suit = s[1].toLowerCase() as Suit;
  if (!SUITS.includes(suit)) throw new Error(`非法花色: "${s}"`);
  return { rank: (rankIdx + 2) as Rank, suit };
}

export function parseCards(s: string): Card[] {
  const trimmed = s.trim();
  if (trimmed === '') return [];
  return trimmed.split(/\s+/).map(parseCard);
}

export function sameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/cards.test.ts`
Expected: PASS，13 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/core/cards.ts src/core/cards.test.ts
git commit -m "feat(core): 牌的表示、牌堆与解析

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 牌型分值编码与穷举参考实现

本任务产出的是**参考实现**——慢但显然正确，只用于测试对拍。Task 5 的快速实现必须与它逐位一致。

**Files:**
- Create: `src/core/handScore.ts`
- Create: `src/core/handEvalSlow.ts`
- Test: `src/core/handEvalSlow.test.ts`

**Interfaces:**
- Consumes: `Card`, `Rank`, `parseCards`（Task 3）
- Produces:
  - `enum HandCategory`（0=高牌 … 8=同花顺）
  - `pack(category: number, tiebreak: number[]): number` — 生成可直接比大小的整数分值
  - `categoryOf(score: number): HandCategory`
  - `describeHand(score: number): string`
  - `evaluate5Slow(cards: Card[]): number`
  - `evaluate7Slow(cards: Card[]): number`

- [ ] **Step 1: 创建分值编码模块**

创建 `src/core/handScore.ts`。这个模块被快慢两份实现共用，保证两者编码格式完全一致：

```ts
export enum HandCategory {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

const CATEGORY_NAMES: Record<HandCategory, string> = {
  [HandCategory.HighCard]: '高牌',
  [HandCategory.OnePair]: '一对',
  [HandCategory.TwoPair]: '两对',
  [HandCategory.Trips]: '三条',
  [HandCategory.Straight]: '顺子',
  [HandCategory.Flush]: '同花',
  [HandCategory.FullHouse]: '葫芦',
  [HandCategory.Quads]: '四条',
  [HandCategory.StraightFlush]: '同花顺',
};

/**
 * 把牌型与决胜点数打包成一个可直接比大小的整数。
 * 编码：category 占最高位，其后 5 个 4-bit 槽位存决胜点数（不足补 0）。
 * 点数最大为 14 < 16，因此每个槽位 4 bit 足够。
 */
export function pack(category: number, tiebreak: number[]): number {
  let v = category;
  for (let i = 0; i < 5; i++) {
    v = v * 16 + (tiebreak[i] ?? 0);
  }
  return v;
}

export function categoryOf(score: number): HandCategory {
  return Math.floor(score / 16 ** 5) as HandCategory;
}

export function describeHand(score: number): string {
  return CATEGORY_NAMES[categoryOf(score)];
}
```

- [ ] **Step 2: 写失败的测试**

创建 `src/core/handEvalSlow.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseCards } from './cards';
import { evaluate5Slow, evaluate7Slow } from './handEvalSlow';
import { HandCategory, categoryOf } from './handScore';

const cat5 = (s: string) => categoryOf(evaluate5Slow(parseCards(s)));
const score5 = (s: string) => evaluate5Slow(parseCards(s));

describe('evaluate5Slow 牌型识别', () => {
  it('同花顺', () => {
    expect(cat5('9s 8s 7s 6s 5s')).toBe(HandCategory.StraightFlush);
  });

  it('皇家同花顺也是同花顺', () => {
    expect(cat5('As Ks Qs Js Ts')).toBe(HandCategory.StraightFlush);
  });

  it('轮子同花顺 A2345', () => {
    expect(cat5('As 2s 3s 4s 5s')).toBe(HandCategory.StraightFlush);
  });

  it('四条', () => {
    expect(cat5('9s 9h 9d 9c 5s')).toBe(HandCategory.Quads);
  });

  it('葫芦', () => {
    expect(cat5('9s 9h 9d 5c 5s')).toBe(HandCategory.FullHouse);
  });

  it('同花', () => {
    expect(cat5('As Js 9s 6s 3s')).toBe(HandCategory.Flush);
  });

  it('顺子', () => {
    expect(cat5('9s 8h 7d 6c 5s')).toBe(HandCategory.Straight);
  });

  it('轮子顺 A2345', () => {
    expect(cat5('As 2h 3d 4c 5s')).toBe(HandCategory.Straight);
  });

  it('三条', () => {
    expect(cat5('9s 9h 9d 6c 3s')).toBe(HandCategory.Trips);
  });

  it('两对', () => {
    expect(cat5('9s 9h 6d 6c 3s')).toBe(HandCategory.TwoPair);
  });

  it('一对', () => {
    expect(cat5('9s 9h 8d 6c 3s')).toBe(HandCategory.OnePair);
  });

  it('高牌', () => {
    expect(cat5('As Jh 9d 6c 3s')).toBe(HandCategory.HighCard);
  });

  it('QJT98 不算轮子，是正常顺子', () => {
    expect(cat5('Qs Jh Td 9c 8s')).toBe(HandCategory.Straight);
  });

  it('KA234 不是顺子', () => {
    expect(cat5('Ks Ah 2d 3c 4s')).toBe(HandCategory.HighCard);
  });
});

describe('evaluate5Slow 同牌型内比大小', () => {
  it('大顺子胜小顺子', () => {
    expect(score5('9s 8h 7d 6c 5s')).toBeGreaterThan(score5('8s 7h 6d 5c 4s'));
  });

  it('轮子是最小的顺子', () => {
    expect(score5('6s 5h 4d 3c 2s')).toBeGreaterThan(score5('As 2h 3d 4c 5s'));
  });

  it('四条比踢脚', () => {
    expect(score5('9s 9h 9d 9c As')).toBeGreaterThan(score5('9s 9h 9d 9c Ks'));
  });

  it('葫芦先比三条部分', () => {
    expect(score5('9s 9h 9d 2c 2s')).toBeGreaterThan(score5('8s 8h 8d As Ah'));
  });

  it('两对先比大对，再比小对，最后比踢脚', () => {
    expect(score5('9s 9h 6d 6c As')).toBeGreaterThan(score5('9s 9h 5d 5c As'));
    expect(score5('9s 9h 6d 6c As')).toBeGreaterThan(score5('9s 9h 6d 6c Ks'));
  });

  it('一对相同则逐个比踢脚', () => {
    expect(score5('9s 9h Ad 6c 3s')).toBeGreaterThan(score5('9s 9h Kd 6c 3s'));
    expect(score5('9s 9h Ad 7c 3s')).toBeGreaterThan(score5('9s 9h Ad 6c 3s'));
  });

  it('完全相同的牌型分值相等', () => {
    expect(score5('9s 9h 6d 6c As')).toBe(score5('9d 9c 6s 6h Ah'));
  });
});

describe('牌型强弱顺序', () => {
  it('从同花顺到高牌严格递减', () => {
    const hands = [
      '9s 8s 7s 6s 5s',  // 同花顺
      '9s 9h 9d 9c 5s',  // 四条
      '9s 9h 9d 5c 5s',  // 葫芦
      'As Js 9s 6s 3s',  // 同花
      '9s 8h 7d 6c 5s',  // 顺子
      '9s 9h 9d 6c 3s',  // 三条
      '9s 9h 6d 6c 3s',  // 两对
      '9s 9h 8d 6c 3s',  // 一对
      'As Jh 9d 6c 3s',  // 高牌
    ];
    const scores = hands.map(score5);
    for (let i = 0; i + 1 < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i + 1]);
    }
  });
});

describe('evaluate7Slow', () => {
  it('从 7 张里选出最好的 5 张', () => {
    // 7 张里含同花顺
    const s7 = evaluate7Slow(parseCards('9s 8s 7s 6s 5s 2h 3d'));
    expect(categoryOf(s7)).toBe(HandCategory.StraightFlush);
  });

  it('与手工选出的最佳 5 张一致', () => {
    const s7 = evaluate7Slow(parseCards('As Ah Kd Kc Qs 2h 3d'));
    const s5 = evaluate5Slow(parseCards('As Ah Kd Kc Qs'));
    expect(s7).toBe(s5);
  });

  it('7 张中同花优先于三条', () => {
    // 5 张方片构成同花，同时 A 有三条；同花更大
    const s7 = evaluate7Slow(parseCards('Ad Ah As Kd Qd Jd 9d'));
    expect(categoryOf(s7)).toBe(HandCategory.Flush);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run src/core/handEvalSlow.test.ts`
Expected: FAIL，报错 `Failed to resolve import "./handEvalSlow"`

- [ ] **Step 4: 实现 handEvalSlow.ts**

创建 `src/core/handEvalSlow.ts`：

```ts
import type { Card } from './cards';
import { HandCategory, pack } from './handScore';

/**
 * 穷举参考实现：慢但显然正确，仅用于测试对拍，生产代码不要调用。
 */

/** 求顺子最高牌，返回 0 表示不是顺子。ranksDesc 必须已按降序排好。 */
function straightHigh(ranksDesc: number[]): number {
  const uniq = [...new Set(ranksDesc)];
  if (uniq.length !== 5) return 0;
  if (uniq[0] - uniq[4] === 4) return uniq[0];
  // 轮子 A-5-4-3-2：A 当作 1 用，顺子最高牌记为 5
  if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) return 5;
  return 0;
}

export function evaluate5Slow(cards: Card[]): number {
  if (cards.length !== 5) throw new Error(`evaluate5Slow 需要 5 张牌，收到 ${cards.length}`);

  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const isFlush = cards.every(c => c.suit === cards[0].suit);

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);

  // 先按出现次数降序，次数相同再按点数降序
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map(g => g[1]).join('');
  const ordered = groups.map(g => g[0]);

  const sHigh = straightHigh(ranks);

  if (isFlush && sHigh) return pack(HandCategory.StraightFlush, [sHigh]);
  if (shape === '41') return pack(HandCategory.Quads, ordered);
  if (shape === '32') return pack(HandCategory.FullHouse, ordered);
  if (isFlush) return pack(HandCategory.Flush, ordered);
  if (sHigh) return pack(HandCategory.Straight, [sHigh]);
  if (shape === '311') return pack(HandCategory.Trips, ordered);
  if (shape === '221') return pack(HandCategory.TwoPair, ordered);
  if (shape === '2111') return pack(HandCategory.OnePair, ordered);
  return pack(HandCategory.HighCard, ordered);
}

/** 穷举 C(7,5) = 21 种组合，取最强的一组 */
export function evaluate7Slow(cards: Card[]): number {
  if (cards.length !== 7) throw new Error(`evaluate7Slow 需要 7 张牌，收到 ${cards.length}`);

  let best = 0;
  // a、b 是被排除的两张牌的下标
  for (let a = 0; a < 7; a++) {
    for (let b = a + 1; b < 7; b++) {
      const five: Card[] = [];
      for (let i = 0; i < 7; i++) {
        if (i !== a && i !== b) five.push(cards[i]);
      }
      const score = evaluate5Slow(five);
      if (score > best) best = score;
    }
  }
  return best;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/core/handEvalSlow.test.ts`
Expected: PASS，全部测试绿

- [ ] **Step 6: 提交**

```bash
git add src/core/handScore.ts src/core/handEvalSlow.ts src/core/handEvalSlow.test.ts
git commit -m "feat(core): 牌型分值编码与穷举参考实现

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 快速牌型评估与对拍测试

蒙特卡洛胜率每次决策要评估上万手牌，穷举版太慢。本任务写位运算快速版，并用 10 万组随机牌与参考实现对拍。

**Files:**
- Create: `src/core/handEval.ts`
- Test: `src/core/handEval.test.ts`

**Interfaces:**
- Consumes: `Card`（Task 3）、`pack`/`HandCategory`（Task 4）、`evaluate7Slow`（Task 4，仅测试用）
- Produces: `evaluate7(cards: Card[]): number` — 与 `evaluate7Slow` 结果完全一致

- [ ] **Step 1: 写失败的测试**

创建 `src/core/handEval.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { makeDeck, parseCards, cardToString } from './cards';
import type { Card } from './cards';
import { createRng, shuffle } from './rng';
import { evaluate7 } from './handEval';
import { evaluate7Slow } from './handEvalSlow';
import { HandCategory, categoryOf } from './handScore';

describe('evaluate7 与参考实现对拍', () => {
  it('10 万组随机 7 张牌结果完全一致', () => {
    const rng = createRng('showdown-crosscheck');
    const deck = makeDeck();
    for (let i = 0; i < 100_000; i++) {
      const hand: Card[] = shuffle(deck, rng).slice(0, 7);
      const fast = evaluate7(hand);
      const slow = evaluate7Slow(hand);
      if (fast !== slow) {
        throw new Error(
          `不一致：${hand.map(cardToString).join(' ')} fast=${fast} slow=${slow}`,
        );
      }
    }
    expect(true).toBe(true);
  }, 120_000);
});

describe('evaluate7 牌型识别', () => {
  const cat = (s: string) => categoryOf(evaluate7(parseCards(s)));

  it('同花顺', () => {
    expect(cat('9s 8s 7s 6s 5s 2h 3d')).toBe(HandCategory.StraightFlush);
  });

  it('轮子同花顺', () => {
    expect(cat('As 2s 3s 4s 5s Kh Qd')).toBe(HandCategory.StraightFlush);
  });

  it('四条带踢脚', () => {
    expect(cat('9s 9h 9d 9c As 3h 2d')).toBe(HandCategory.Quads);
  });

  it('四条 + 三条时仍是四条', () => {
    expect(cat('9s 9h 9d 9c As Ah Ad')).toBe(HandCategory.Quads);
  });

  it('两组三条构成葫芦', () => {
    expect(cat('9s 9h 9d As Ah Ad 2c')).toBe(HandCategory.FullHouse);
  });

  it('三条 + 对子构成葫芦', () => {
    expect(cat('9s 9h 9d As Ah 5d 2c')).toBe(HandCategory.FullHouse);
  });

  it('7 张里的同花取最大 5 张', () => {
    const a = evaluate7(parseCards('As Ks Qs Js 9s 2h 3d'));
    const b = evaluate7(parseCards('As Ks Qs Js 8s 2h 3d'));
    expect(a).toBeGreaterThan(b);
  });

  it('三对时只算两对，取最大两对', () => {
    const s = evaluate7(parseCards('As Ah Ks Kh 2s 2h 9d'));
    expect(categoryOf(s)).toBe(HandCategory.TwoPair);
    // 踢脚应为 9 而非 2
    expect(s).toBe(evaluate7(parseCards('Ad Ac Kd Kc 9s 4h 3d')));
  });

  it('同时构成顺子与三条时取顺子', () => {
    // 9 有三条，同时 5-6-7-8-9 构成顺子；顺子更大
    expect(cat('9s 9h 9d 8c 7h 6d 5s')).toBe(HandCategory.Straight);
  });

  it('跨花色的 5 张不构成同花', () => {
    expect(cat('As Ks Qs Js Th 9h 8h')).toBe(HandCategory.Straight);
  });
});

describe('evaluate7 已知强弱关系', () => {
  it('同一公共牌下 AA 胜 KK', () => {
    const board = '7h 2d 9c 4s 3h';
    const aa = evaluate7(parseCards(`As Ad ${board}`));
    const kk = evaluate7(parseCards(`Ks Kd ${board}`));
    expect(aa).toBeGreaterThan(kk);
  });

  it('平局时分值相等', () => {
    // 公共牌就是最好的 5 张，两手底牌都用不上
    const board = 'As Ks Qs Js Ts';
    const p1 = evaluate7(parseCards(`2h 3d ${board}`));
    const p2 = evaluate7(parseCards(`4h 5d ${board}`));
    expect(p1).toBe(p2);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/handEval.test.ts`
Expected: FAIL，报错 `Failed to resolve import "./handEval"`

- [ ] **Step 3: 实现 handEval.ts**

创建 `src/core/handEval.ts`：

```ts
import type { Card, Suit } from './cards';
import { HandCategory, pack } from './handScore';

const SUIT_INDEX: Record<Suit, number> = { s: 0, h: 1, d: 2, c: 3 };

/**
 * 从点数位掩码求顺子最高牌，0 表示无顺子。
 * A 额外映射到 bit 1，用于识别轮子 A-5-4-3-2。
 */
function straightHighFromMask(mask: number): number {
  const m = mask | (((mask >> 14) & 1) << 1);
  for (let high = 14; high >= 5; high--) {
    const need =
      (1 << high) |
      (1 << (high - 1)) |
      (1 << (high - 2)) |
      (1 << (high - 3)) |
      (1 << (high - 4));
    if ((m & need) === need) return high;
  }
  return 0;
}

/** 从掩码里取最大的 n 个点数，降序 */
function topN(mask: number, n: number): number[] {
  const out: number[] = [];
  for (let r = 14; r >= 2 && out.length < n; r--) {
    if (mask & (1 << r)) out.push(r);
  }
  return out;
}

/** 排除指定点数后取最大的 n 个 */
function topNExcept(mask: number, exclude: number[], n: number): number[] {
  let m = mask;
  for (const r of exclude) m &= ~(1 << r);
  return topN(m, n);
}

/**
 * 7 张牌的最佳牌型分值。与 evaluate7Slow 结果逐位一致，但快得多。
 */
export function evaluate7(cards: Card[]): number {
  if (cards.length !== 7) throw new Error(`evaluate7 需要 7 张牌，收到 ${cards.length}`);

  const rankCount = new Int8Array(15);
  const suitCount = new Int8Array(4);
  const suitMask = new Int32Array(4);
  let rankMask = 0;

  for (let i = 0; i < 7; i++) {
    const c = cards[i];
    rankCount[c.rank]++;
    const si = SUIT_INDEX[c.suit];
    suitCount[si]++;
    suitMask[si] |= 1 << c.rank;
    rankMask |= 1 << c.rank;
  }

  // 7 张牌最多只可能有一种花色达到 5 张
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) {
    if (suitCount[s] >= 5) {
      flushSuit = s;
      break;
    }
  }

  if (flushSuit >= 0) {
    const sfHigh = straightHighFromMask(suitMask[flushSuit]);
    if (sfHigh) return pack(HandCategory.StraightFlush, [sfHigh]);
  }

  let quad = 0;
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let r = 14; r >= 2; r--) {
    const n = rankCount[r];
    if (n === 4) quad = r;
    else if (n === 3) trips.push(r);
    else if (n === 2) pairs.push(r);
  }

  if (quad) {
    const kicker = topNExcept(rankMask, [quad], 1);
    return pack(HandCategory.Quads, [quad, kicker[0]]);
  }
  // 7 张最多两组三条（3+3+1）
  if (trips.length >= 2) return pack(HandCategory.FullHouse, [trips[0], trips[1]]);
  if (trips.length === 1 && pairs.length >= 1) {
    return pack(HandCategory.FullHouse, [trips[0], pairs[0]]);
  }
  if (flushSuit >= 0) return pack(HandCategory.Flush, topN(suitMask[flushSuit], 5));

  const sHigh = straightHighFromMask(rankMask);
  if (sHigh) return pack(HandCategory.Straight, [sHigh]);

  if (trips.length === 1) {
    return pack(HandCategory.Trips, [trips[0], ...topNExcept(rankMask, [trips[0]], 2)]);
  }
  if (pairs.length >= 2) {
    return pack(HandCategory.TwoPair, [
      pairs[0],
      pairs[1],
      topNExcept(rankMask, [pairs[0], pairs[1]], 1)[0],
    ]);
  }
  if (pairs.length === 1) {
    return pack(HandCategory.OnePair, [pairs[0], ...topNExcept(rankMask, [pairs[0]], 3)]);
  }
  return pack(HandCategory.HighCard, topN(rankMask, 5));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/handEval.test.ts`
Expected: PASS。对拍测试耗时约 20–60 秒属正常。

若对拍报出不一致，把错误信息里的 7 张牌单独喂给两个实现调试——错误信息已包含牌面，可直接复现。

- [ ] **Step 5: 提交**

```bash
git add src/core/handEval.ts src/core/handEval.test.ts
git commit -m "feat(core): 位运算快速牌型评估，与参考实现 10 万组对拍通过

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 边池计算

**Files:**
- Create: `src/core/pots.ts`
- Test: `src/core/pots.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `interface Pot { amount: number; eligible: number[] }`
  - `buildPots(contributions: Map<number, number>, folded: ReadonlySet<number>): Pot[]`

`contributions` 是「座位号 → 本手总投入」，包含已弃牌玩家的投入（死钱）。`eligible` 只含未弃牌且投入达到该层的座位，升序排列。

- [ ] **Step 1: 写失败的测试**

创建 `src/core/pots.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildPots } from './pots';

const contrib = (o: Record<number, number>) =>
  new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));

describe('buildPots', () => {
  it('所有人投入相同时只有一个主池', () => {
    const pots = buildPots(contrib({ 0: 10, 1: 10, 2: 10 }), new Set());
    expect(pots).toEqual([{ amount: 30, eligible: [0, 1, 2] }]);
  });

  it('短筹码 all-in 产生边池', () => {
    // 座位0 投 10，座位1、2 各投 50
    const pots = buildPots(contrib({ 0: 10, 1: 50, 2: 50 }), new Set());
    expect(pots).toEqual([
      { amount: 30, eligible: [0, 1, 2] },  // 主池 10×3
      { amount: 80, eligible: [1, 2] },     // 边池 40×2
    ]);
  });

  it('三人不同筹码全下产生两个边池', () => {
    const pots = buildPots(contrib({ 0: 10, 1: 25, 2: 60 }), new Set());
    expect(pots).toEqual([
      { amount: 30, eligible: [0, 1, 2] },  // 10×3
      { amount: 30, eligible: [1, 2] },     // 15×2
      { amount: 35, eligible: [2] },        // 35×1
    ]);
  });

  it('弃牌玩家的投入算作死钱，但不参与争夺', () => {
    // 座位2 投了 10 后弃牌。两层的有资格者都是 [0,1]，因此合并成一个池：
    // 10×3 = 30（含座位2 的死钱）加上 40×2 = 80，共 110
    const pots = buildPots(contrib({ 0: 50, 1: 50, 2: 10 }), new Set([2]));
    expect(pots).toEqual([{ amount: 110, eligible: [0, 1] }]);
  });

  it('资格相同的相邻层会合并成一个池', () => {
    // 座位1、2 都弃牌后，三层的有资格者都只剩 [0]，全部合并
    const pots = buildPots(contrib({ 0: 60, 1: 25, 2: 10 }), new Set([1, 2]));
    expect(pots).toEqual([{ amount: 95, eligible: [0] }]);
  });

  it('资格不同的层不会被合并', () => {
    // 无人弃牌：第一层 [0,1,2]，第二层只有 [1,2]，资格不同，保持两个池
    const pots = buildPots(contrib({ 0: 10, 1: 50, 2: 50 }), new Set());
    expect(pots).toHaveLength(2);
    expect(pots[0].eligible).toEqual([0, 1, 2]);
    expect(pots[1].eligible).toEqual([1, 2]);
  });

  it('投入为 0 的座位不产生池层', () => {
    const pots = buildPots(contrib({ 0: 0, 1: 10, 2: 10 }), new Set([0]));
    expect(pots).toEqual([{ amount: 20, eligible: [1, 2] }]);
  });

  it('单人未弃牌时全部归其所有', () => {
    const pots = buildPots(contrib({ 0: 10, 1: 30 }), new Set([0]));
    const total = pots.reduce((s, p) => s + p.amount, 0);
    expect(total).toBe(40);
    expect(pots.every(p => p.eligible.length === 1 && p.eligible[0] === 1)).toBe(true);
  });
});

describe('buildPots 不变量（属性测试）', () => {
  it('所有池金额之和恒等于总投入', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 200 }), { minLength: 2, maxLength: 6 }),
        fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 5 }),
        (amounts, foldList) => {
          const map = new Map(amounts.map((v, i) => [i, v]));
          const folded = new Set(foldList.filter(s => s < amounts.length));
          // 至少留一人未弃牌
          if (folded.size >= amounts.length) return true;

          const pots = buildPots(map, folded);
          const totalIn = amounts.reduce((a, b) => a + b, 0);
          const totalPots = pots.reduce((s, p) => s + p.amount, 0);
          expect(totalPots).toBe(totalIn);
          // 每个池都必须有人有资格赢
          expect(pots.every(p => p.eligible.length > 0)).toBe(true);
          return true;
        },
      ),
      { numRuns: 2000 },
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/pots.test.ts`
Expected: FAIL，报错 `Failed to resolve import "./pots"`

- [ ] **Step 3: 实现 pots.ts**

创建 `src/core/pots.ts`：

```ts
export interface Pot {
  /** 该池的筹码总额 */
  amount: number;
  /** 有资格争夺该池的座位号，升序 */
  eligible: number[];
}

/**
 * 按 all-in 金额分层计算主池与边池。
 *
 * @param contributions 座位号 -> 本手总投入（含已弃牌者的死钱）
 * @param folded        已弃牌的座位号
 */
export function buildPots(
  contributions: Map<number, number>,
  folded: ReadonlySet<number>,
): Pot[] {
  const levels = [...new Set([...contributions.values()])]
    .filter(v => v > 0)
    .sort((a, b) => a - b);

  const raw: Pot[] = [];
  let prev = 0;

  for (const level of levels) {
    const layer = level - prev;
    let amount = 0;
    const eligible: number[] = [];

    for (const [seat, c] of contributions) {
      if (c >= level) {
        amount += layer;
        if (!folded.has(seat)) eligible.push(seat);
      }
    }

    if (amount > 0) {
      raw.push({ amount, eligible: eligible.sort((a, b) => a - b) });
    }
    prev = level;
  }

  // 资格集合相同的相邻层合并，避免产生一堆等价的小池
  const merged: Pot[] = [];
  for (const pot of raw) {
    const last = merged[merged.length - 1];
    if (last && sameEligible(last.eligible, pot.eligible)) {
      last.amount += pot.amount;
    } else {
      merged.push({ ...pot });
    }
  }

  // 全员弃牌的层（死钱无人争夺）归入下一个有资格者的池；
  // 若整体无人有资格，说明调用方状态有误
  return merged.filter(p => p.eligible.length > 0);
}

function sameEligible(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/pots.test.ts`
Expected: PASS

若「资格相同的相邻层会合并」这条测试与「弃牌玩家死钱」这条冲突（合并后池数变少），以合并后的形态为准，同步修正后者的期望值——合并是正确行为，两个 `eligible` 相同的池在结算上完全等价。

- [ ] **Step 5: 提交**

```bash
git add src/core/pots.ts src/core/pots.test.ts
git commit -m "feat(core): 主池与边池分层计算

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 对局类型定义与开局

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/gameEngine.ts`
- Test: `src/core/gameEngine.startHand.test.ts`

**Interfaces:**
- Consumes: `Card`（Task 3）、`shuffledDeck`（Task 3）、`Rng`（Task 2）
- Produces:
  - `type Position`, `type Street`, `type ActionType`, `interface Action`, `interface SeatState`, `interface GameState`, `interface HandRecord`
  - `SMALL_BLIND = 0.5`, `BIG_BLIND = 1`, `STARTING_STACK = 100`
  - `startHand(opts: { seed: string; buttonSeat: number; seatCount?: number }): GameState`
  - `totalChips(state: GameState): number`

- [ ] **Step 1: 创建类型定义**

创建 `src/core/types.ts`：

```ts
import type { Card } from './cards';

export type Position = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export const SMALL_BLIND = 0.5;
export const BIG_BLIND = 1;
export const STARTING_STACK = 100;
export const SEAT_COUNT = 6;
export const HERO_SEAT = 0;

/** 从按钮位起顺时针的位置顺序 */
export const POSITION_ORDER: readonly Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];

export interface Action {
  seat: number;
  street: Street;
  type: ActionType;
  /** 该动作本次投入的筹码，fold/check 为 0 */
  amount: number;
  potBefore: number;
  toCall: number;
  stackBefore: number;
}

export interface SeatState {
  seat: number;
  position: Position;
  stack: number;
  holeCards: [Card, Card];
  folded: boolean;
  allIn: boolean;
  /** 本街已投入 */
  streetContribution: number;
  /** 本手已投入 */
  totalContribution: number;
  /**
   * 自上一次「完整加注」以来是否已行动过。
   * 完整加注会把所有其他人的该标志清空，从而重开下注轮；
   * 不足最小加注额的 all-in 不清空，因此不重开下注轮。
   */
  hasActedSinceLastFullRaise: boolean;
}

export interface HandResult {
  seat: number;
  netBB: number;
  showdown: boolean;
}

export interface GameState {
  seed: string;
  buttonSeat: number;
  seats: SeatState[];
  board: Card[];
  /** 尚未发出的牌 */
  deck: Card[];
  street: Street;
  /** 当前该行动的座位号；null 表示本街已结束或本手已结束 */
  toAct: number | null;
  /** 本街最高投入额 */
  currentBet: number;
  /** 最近一次加注的增量，决定最小加注额 */
  lastRaiseSize: number;
  actions: Action[];
  handOver: boolean;
  results: HandResult[] | null;
}

export interface HandRecordSeat {
  seat: number;
  position: Position;
  personaId: string;
  startingStack: number;
  holeCards: [Card, Card];
}

export interface HandRecord {
  id: string;
  schemaVersion: number;
  timestamp: number;
  seed: string;
  heroSeat: number;
  buttonSeat: number;
  seats: HandRecordSeat[];
  board: Card[];
  actions: Action[];
  results: HandResult[];
}

export const HAND_RECORD_SCHEMA_VERSION = 1;
```

- [ ] **Step 2: 写失败的测试**

创建 `src/core/gameEngine.startHand.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { startHand, totalChips } from './gameEngine';
import { SMALL_BLIND, BIG_BLIND, STARTING_STACK, SEAT_COUNT } from './types';
import { cardToString } from './cards';

describe('startHand', () => {
  it('创建 6 个座位', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 0 });
    expect(s.seats).toHaveLength(SEAT_COUNT);
  });

  it('每人发两张底牌，全场无重复牌', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 0 });
    const all = s.seats.flatMap(x => x.holeCards).map(cardToString);
    expect(all).toHaveLength(12);
    expect(new Set(all).size).toBe(12);
  });

  it('剩余牌堆为 52 - 12 = 40 张', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 0 });
    expect(s.deck).toHaveLength(40);
  });

  it('按钮位座位的 position 为 BTN', () => {
    for (let btn = 0; btn < SEAT_COUNT; btn++) {
      const s = startHand({ seed: 'h1', buttonSeat: btn });
      expect(s.seats[btn].position).toBe('BTN');
    }
  });

  it('按钮位左手第一位是 SB，第二位是 BB', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 2 });
    expect(s.seats[3].position).toBe('SB');
    expect(s.seats[4].position).toBe('BB');
  });

  it('SB 与 BB 已扣除盲注', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 0 });
    const sb = s.seats.find(x => x.position === 'SB')!;
    const bb = s.seats.find(x => x.position === 'BB')!;
    expect(sb.stack).toBe(STARTING_STACK - SMALL_BLIND);
    expect(sb.streetContribution).toBe(SMALL_BLIND);
    expect(bb.stack).toBe(STARTING_STACK - BIG_BLIND);
    expect(bb.streetContribution).toBe(BIG_BLIND);
  });

  it('翻前由 UTG 首先行动', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 0 });
    expect(s.seats[s.toAct!].position).toBe('UTG');
  });

  it('初始 currentBet 为 BB，最小加注增量为 BB', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 0 });
    expect(s.currentBet).toBe(BIG_BLIND);
    expect(s.lastRaiseSize).toBe(BIG_BLIND);
  });

  it('SB 与 BB 尚未行动过（保留后续行动权）', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 0 });
    expect(s.seats.every(x => !x.hasActedSinceLastFullRaise)).toBe(true);
  });

  it('相同 seed 与按钮位产生完全相同的开局', () => {
    const a = startHand({ seed: 'same', buttonSeat: 3 });
    const b = startHand({ seed: 'same', buttonSeat: 3 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('开局筹码总量为 6 × 100', () => {
    const s = startHand({ seed: 'h1', buttonSeat: 0 });
    expect(totalChips(s)).toBe(SEAT_COUNT * STARTING_STACK);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run src/core/gameEngine.startHand.test.ts`
Expected: FAIL，报错 `Failed to resolve import "./gameEngine"`

- [ ] **Step 4: 实现 startHand 与 totalChips**

创建 `src/core/gameEngine.ts`：

```ts
import type { Card } from './cards';
import { shuffledDeck } from './cards';
import { createRng } from './rng';
import type { GameState, Position, SeatState } from './types';
import {
  BIG_BLIND,
  POSITION_ORDER,
  SEAT_COUNT,
  SMALL_BLIND,
  STARTING_STACK,
} from './types';

export interface StartHandOptions {
  seed: string;
  buttonSeat: number;
  seatCount?: number;
}

export function startHand(opts: StartHandOptions): GameState {
  const seatCount = opts.seatCount ?? SEAT_COUNT;
  const rng = createRng(opts.seed);
  const deck = shuffledDeck(rng);

  const seats: SeatState[] = [];
  for (let i = 0; i < seatCount; i++) {
    const seat = i;
    // 从按钮位起顺时针数第 offset 个座位，对应 POSITION_ORDER[offset]
    const offset = (seat - opts.buttonSeat + seatCount) % seatCount;
    const position = POSITION_ORDER[offset] as Position;
    const holeCards: [Card, Card] = [deck[seat * 2], deck[seat * 2 + 1]];
    seats.push({
      seat,
      position,
      stack: STARTING_STACK,
      holeCards,
      folded: false,
      allIn: false,
      streetContribution: 0,
      totalContribution: 0,
      hasActedSinceLastFullRaise: false,
    });
  }

  // 扣盲注
  for (const s of seats) {
    if (s.position === 'SB') postBlind(s, SMALL_BLIND);
    if (s.position === 'BB') postBlind(s, BIG_BLIND);
  }

  const utg = seats.find(s => s.position === 'UTG');

  return {
    seed: opts.seed,
    buttonSeat: opts.buttonSeat,
    seats,
    board: [],
    deck: deck.slice(seatCount * 2),
    street: 'preflop',
    toAct: utg ? utg.seat : null,
    currentBet: BIG_BLIND,
    lastRaiseSize: BIG_BLIND,
    actions: [],
    handOver: false,
    results: null,
  };
}

function postBlind(s: SeatState, amount: number): void {
  const paid = Math.min(amount, s.stack);
  s.stack -= paid;
  s.streetContribution += paid;
  s.totalContribution += paid;
  if (s.stack === 0) s.allIn = true;
}

/** 筹码守恒不变量的度量：所有人手上的筹码 + 所有已投入的筹码 */
export function totalChips(state: GameState): number {
  return state.seats.reduce((sum, s) => sum + s.stack + s.totalContribution, 0);
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/core/gameEngine.startHand.test.ts`
Expected: PASS，11 个测试全绿

- [ ] **Step 6: 提交**

```bash
git add src/core/types.ts src/core/gameEngine.ts src/core/gameEngine.startHand.test.ts
git commit -m "feat(core): 对局类型定义与开局发牌扣盲

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: 合法动作枚举

**Files:**
- Modify: `src/core/gameEngine.ts`（追加 `legalActions`）
- Test: `src/core/gameEngine.legalActions.test.ts`

**Interfaces:**
- Consumes: `GameState`, `SeatState`（Task 7）
- Produces:
  - `interface LegalAction { type: ActionType; min: number; max: number }` — `min`/`max` 为「本次投入额」，`fold`/`check` 均为 0
  - `legalActions(state: GameState): LegalAction[]`

- [ ] **Step 1: 写失败的测试**

创建 `src/core/gameEngine.legalActions.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { startHand, legalActions } from './gameEngine';
import { BIG_BLIND } from './types';

const types = (s: ReturnType<typeof startHand>) =>
  legalActions(s).map(a => a.type).sort();

describe('legalActions 翻前', () => {
  it('UTG 面对大盲可以 fold / call / raise / allin', () => {
    const s = startHand({ seed: 'la-1', buttonSeat: 0 });
    expect(types(s)).toEqual(['allin', 'call', 'fold', 'raise']);
  });

  it('面对下注时不能 check', () => {
    const s = startHand({ seed: 'la-2', buttonSeat: 0 });
    expect(types(s)).not.toContain('check');
  });

  it('call 的金额等于待跟注额', () => {
    const s = startHand({ seed: 'la-3', buttonSeat: 0 });
    const call = legalActions(s).find(a => a.type === 'call')!;
    expect(call.min).toBe(BIG_BLIND);
    expect(call.max).toBe(BIG_BLIND);
  });

  it('最小加注额 = 跟注额 + 上次加注增量', () => {
    const s = startHand({ seed: 'la-4', buttonSeat: 0 });
    const raise = legalActions(s).find(a => a.type === 'raise')!;
    // 面对 1BB，最小加注到 2BB，本次投入 2BB
    expect(raise.min).toBe(BIG_BLIND * 2);
  });

  it('最大加注额等于自己的全部筹码', () => {
    const s = startHand({ seed: 'la-5', buttonSeat: 0 });
    const seat = s.seats[s.toAct!];
    const raise = legalActions(s).find(a => a.type === 'raise')!;
    expect(raise.max).toBe(seat.stack);
  });

  it('allin 金额等于剩余筹码', () => {
    const s = startHand({ seed: 'la-6', buttonSeat: 0 });
    const seat = s.seats[s.toAct!];
    const allin = legalActions(s).find(a => a.type === 'allin')!;
    expect(allin.min).toBe(seat.stack);
    expect(allin.max).toBe(seat.stack);
  });
});

describe('legalActions 无人下注时', () => {
  it('可以 check / bet / allin，不能 fold 或 call', () => {
    const s = startHand({ seed: 'la-7', buttonSeat: 0 });
    // 手动构造「翻牌圈无人下注」的局面
    const flop = {
      ...s,
      street: 'flop' as const,
      currentBet: 0,
      lastRaiseSize: BIG_BLIND,
      toAct: 1,
      seats: s.seats.map(x => ({ ...x, streetContribution: 0, hasActedSinceLastFullRaise: false })),
    };
    expect(types(flop)).toEqual(['allin', 'bet', 'check']);
  });

  it('最小下注额为一个大盲', () => {
    const s = startHand({ seed: 'la-8', buttonSeat: 0 });
    const flop = {
      ...s,
      street: 'flop' as const,
      currentBet: 0,
      lastRaiseSize: BIG_BLIND,
      toAct: 1,
      seats: s.seats.map(x => ({ ...x, streetContribution: 0, hasActedSinceLastFullRaise: false })),
    };
    const bet = legalActions(flop).find(a => a.type === 'bet')!;
    expect(bet.min).toBe(BIG_BLIND);
  });
});

describe('legalActions 筹码不足时', () => {
  it('筹码少于跟注额时只能 fold 或 allin，没有 call', () => {
    const s = startHand({ seed: 'la-9', buttonSeat: 0 });
    const short = {
      ...s,
      currentBet: 50,
      seats: s.seats.map(x => (x.seat === s.toAct ? { ...x, stack: 20 } : x)),
    };
    expect(types(short)).toEqual(['allin', 'fold']);
  });

  it('筹码不足以完成最小加注时没有 raise，只有 allin', () => {
    const s = startHand({ seed: 'la-10', buttonSeat: 0 });
    // 面对 1BB，最小加注需投入 2BB；给他 1.5BB
    const short = {
      ...s,
      seats: s.seats.map(x => (x.seat === s.toAct ? { ...x, stack: 1.5 } : x)),
    };
    const t = types(short);
    expect(t).toContain('allin');
    expect(t).toContain('call');
    expect(t).not.toContain('raise');
  });
});

describe('legalActions 加注权', () => {
  it('已在本轮完整加注后行动过的人不能再加注，只能 fold/call', () => {
    const s = startHand({ seed: 'la-11', buttonSeat: 0 });
    const seat = s.toAct!;
    const afterShortAllin = {
      ...s,
      currentBet: 3,
      seats: s.seats.map(x =>
        x.seat === seat
          ? { ...x, hasActedSinceLastFullRaise: true, streetContribution: 2 }
          : x,
      ),
    };
    const t = types(afterShortAllin);
    expect(t).toContain('call');
    expect(t).toContain('fold');
    expect(t).not.toContain('raise');
  });
});

describe('legalActions 边界', () => {
  it('本手已结束时返回空数组', () => {
    const s = startHand({ seed: 'la-12', buttonSeat: 0 });
    expect(legalActions({ ...s, handOver: true, toAct: null })).toEqual([]);
  });

  it('toAct 为 null 时返回空数组', () => {
    const s = startHand({ seed: 'la-13', buttonSeat: 0 });
    expect(legalActions({ ...s, toAct: null })).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/gameEngine.legalActions.test.ts`
Expected: FAIL，报错 `legalActions is not exported` 或 `is not a function`

- [ ] **Step 3: 实现 legalActions**

在 `src/core/gameEngine.ts` 末尾追加。同时在文件顶部的 `import type` 里补上 `ActionType`：

```ts
export interface LegalAction {
  type: ActionType;
  /** 本次投入的最小额 */
  min: number;
  /** 本次投入的最大额 */
  max: number;
}

export function legalActions(state: GameState): LegalAction[] {
  if (state.handOver || state.toAct === null) return [];

  const seat = state.seats[state.toAct];
  if (seat.folded || seat.allIn) return [];

  const toCall = round2(state.currentBet - seat.streetContribution);
  const out: LegalAction[] = [];

  if (toCall > 0) {
    out.push({ type: 'fold', min: 0, max: 0 });
    if (seat.stack > toCall) {
      out.push({ type: 'call', min: toCall, max: toCall });
    }
  } else {
    out.push({ type: 'check', min: 0, max: 0 });
  }

  // 有加注权才能主动加码：本轮完整加注后尚未行动过
  const canRaise = !seat.hasActedSinceLastFullRaise;
  if (canRaise) {
    // 最小加注到的绝对额，换算成本次需投入额
    const minRaiseTo = state.currentBet + state.lastRaiseSize;
    const minInvest = round2(minRaiseTo - seat.streetContribution);
    if (seat.stack > minInvest) {
      // 用 currentBet 而非 toCall 区分 bet/raise：
      // 翻前大盲面对全员平跟时 toCall 为 0，但场上已有下注（盲注），
      // 此时他的主动加码是 raise 而不是 bet。
      out.push({
        type: state.currentBet > 0 ? 'raise' : 'bet',
        min: minInvest,
        max: seat.stack,
      });
    }
  }

  if (seat.stack > 0) {
    out.push({ type: 'allin', min: seat.stack, max: seat.stack });
  }

  return out;
}

/** 金额规整到 2 位小数，消除浮点累积误差 */
export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
```

两处容易写错的地方：

1. **`bet` 与 `raise` 的区分看 `currentBet` 不看 `toCall`。** 翻牌圈无人下注时 `currentBet === 0`，主动投入叫 `bet`，此时 `minRaiseTo = 0 + lastRaiseSize = BIG_BLIND`，正好是最小下注额。而翻前全员平跟到大盲时，大盲的 `toCall` 也是 0，但 `currentBet === 1`（盲注就是一个下注），所以他的主动加码是 `raise` —— 这就是大盲的「最后加注权」。若这里误用 `toCall > 0` 判断，大盲的选项会变成 `bet`，Task 9 的 `aa-11` 测试会失败。

2. **`min`/`max` 表示的是「本次投入额」，不是「加注到的绝对额」。** 大盲加注到 2BB 时他本次只需再投 1BB，因为已经投过 1BB 的盲注。`applyAction` 收到的 `amount` 同样是本次投入额。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/gameEngine.legalActions.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/gameEngine.ts src/core/gameEngine.legalActions.test.ts
git commit -m "feat(core): 合法动作枚举，含最小加注与加注权判定

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: 应用动作与街推进

本任务是整个引擎最容易出错的部分。重点是下注轮结束条件与「短 all-in 不重开下注轮」规则。

**Files:**
- Modify: `src/core/gameEngine.ts`（追加 `applyAction`）
- Test: `src/core/gameEngine.applyAction.test.ts`

**Interfaces:**
- Consumes: `GameState`, `legalActions`, `round2`（Task 7、8）
- Produces:
  - `applyAction(state: GameState, input: { type: ActionType; amount?: number }): GameState` — 返回新状态，不修改入参
  - `currentPot(state: GameState): number`

- [ ] **Step 1: 写失败的测试**

创建 `src/core/gameEngine.applyAction.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { startHand, applyAction, totalChips, currentPot, legalActions } from './gameEngine';
import { BIG_BLIND, SEAT_COUNT, STARTING_STACK } from './types';
import type { GameState } from './types';

const CHIPS = SEAT_COUNT * STARTING_STACK;

/** 依次执行一串动作 */
function play(s: GameState, steps: { type: any; amount?: number }[]): GameState {
  let cur = s;
  for (const step of steps) cur = applyAction(cur, step);
  return cur;
}

describe('applyAction 基本行为', () => {
  it('不修改入参', () => {
    const s = startHand({ seed: 'aa-1', buttonSeat: 0 });
    const before = JSON.stringify(s);
    applyAction(s, { type: 'fold' });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('fold 后该座位标记为已弃牌', () => {
    const s = startHand({ seed: 'aa-2', buttonSeat: 0 });
    const seat = s.toAct!;
    const next = applyAction(s, { type: 'fold' });
    expect(next.seats[seat].folded).toBe(true);
  });

  it('call 从筹码里扣除并计入投入', () => {
    const s = startHand({ seed: 'aa-3', buttonSeat: 0 });
    const seat = s.toAct!;
    const next = applyAction(s, { type: 'call' });
    expect(next.seats[seat].stack).toBe(STARTING_STACK - BIG_BLIND);
    expect(next.seats[seat].streetContribution).toBe(BIG_BLIND);
    expect(next.seats[seat].totalContribution).toBe(BIG_BLIND);
  });

  it('每个动作都追加进 actions', () => {
    const s = startHand({ seed: 'aa-4', buttonSeat: 0 });
    const next = applyAction(s, { type: 'call' });
    expect(next.actions).toHaveLength(1);
    expect(next.actions[0].type).toBe('call');
    expect(next.actions[0].street).toBe('preflop');
  });

  it('非法动作抛错', () => {
    const s = startHand({ seed: 'aa-5', buttonSeat: 0 });
    expect(() => applyAction(s, { type: 'check' })).toThrow();
  });
});

describe('筹码守恒不变量', () => {
  it('每一步之后筹码总量都不变', () => {
    let s = startHand({ seed: 'aa-6', buttonSeat: 0 });
    expect(totalChips(s)).toBe(CHIPS);
    const steps = [
      { type: 'raise', amount: 3 },
      { type: 'call' },
      { type: 'fold' },
      { type: 'fold' },
      { type: 'fold' },
      { type: 'call' },
    ];
    for (const step of steps) {
      if (s.handOver) break;
      s = applyAction(s, step as any);
      expect(totalChips(s)).toBe(CHIPS);
    }
  });
});

describe('下注轮结束与街推进', () => {
  it('翻前全部跟注、BB 过牌后进入翻牌圈并发 3 张公共牌', () => {
    let s = startHand({ seed: 'aa-7', buttonSeat: 0 });
    // UTG HJ CO BTN 跟注，SB 补齐，BB 过牌
    s = play(s, [
      { type: 'call' }, { type: 'call' }, { type: 'call' }, { type: 'call' },
      { type: 'call' }, { type: 'check' },
    ]);
    expect(s.street).toBe('flop');
    expect(s.board).toHaveLength(3);
  });

  it('翻后从 SB 起首先行动', () => {
    let s = startHand({ seed: 'aa-8', buttonSeat: 0 });
    s = play(s, [
      { type: 'call' }, { type: 'call' }, { type: 'call' }, { type: 'call' },
      { type: 'call' }, { type: 'check' },
    ]);
    expect(s.seats[s.toAct!].position).toBe('SB');
  });

  it('翻牌圈全过牌进入转牌，公共牌变 4 张', () => {
    let s = startHand({ seed: 'aa-9', buttonSeat: 0 });
    s = play(s, [
      { type: 'call' }, { type: 'call' }, { type: 'call' }, { type: 'call' },
      { type: 'call' }, { type: 'check' },
      { type: 'check' }, { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' }, { type: 'check' },
    ]);
    expect(s.street).toBe('turn');
    expect(s.board).toHaveLength(4);
  });

  it('新街开始时本街投入清零、currentBet 归零', () => {
    let s = startHand({ seed: 'aa-10', buttonSeat: 0 });
    s = play(s, [
      { type: 'call' }, { type: 'call' }, { type: 'call' }, { type: 'call' },
      { type: 'call' }, { type: 'check' },
    ]);
    expect(s.currentBet).toBe(0);
    expect(s.seats.every(x => x.streetContribution === 0)).toBe(true);
  });

  it('BB 在无人加注时保留最后的加注选择权', () => {
    let s = startHand({ seed: 'aa-11', buttonSeat: 0 });
    s = play(s, [
      { type: 'call' }, { type: 'call' }, { type: 'call' }, { type: 'call' }, { type: 'call' },
    ]);
    // 轮到 BB，且仍可加注
    expect(s.seats[s.toAct!].position).toBe('BB');
    expect(legalActions(s).map(a => a.type)).toContain('raise');
    expect(s.street).toBe('preflop');
  });
});

describe('只剩一人时立即结束', () => {
  it('全部弃牌给 BB 则本手结束', () => {
    let s = startHand({ seed: 'aa-12', buttonSeat: 0 });
    s = play(s, [
      { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' },
    ]);
    expect(s.handOver).toBe(true);
    expect(totalChips(s)).toBe(CHIPS);
  });
});

describe('短 all-in 不重开下注轮', () => {
  it('不足最小加注额的 all-in 后，已行动者只能 fold/call 不能 raise', () => {
    let s = startHand({ seed: 'aa-13', buttonSeat: 0 });
    const utg = s.toAct!;
    // UTG 加注到 10
    s = applyAction(s, { type: 'raise', amount: 10 });
    // HJ 手上只有 14，all-in（增量 4 < 上次加注增量 9，属短 all-in）
    s = { ...s, seats: s.seats.map(x => (x.seat === s.toAct ? { ...x, stack: 14 } : x)) };
    s = applyAction(s, { type: 'allin' });
    // 后续玩家全部弃牌，轮回 UTG
    while (s.toAct !== utg && !s.handOver) {
      s = applyAction(s, { type: 'fold' });
    }
    expect(s.handOver).toBe(false);
    expect(s.toAct).toBe(utg);
    const t = legalActions(s).map(a => a.type);
    expect(t).toContain('call');
    expect(t).not.toContain('raise');
  });

  it('完整加注会重开下注轮，已行动者可再次加注', () => {
    let s = startHand({ seed: 'aa-14', buttonSeat: 0 });
    const utg = s.toAct!;
    s = applyAction(s, { type: 'raise', amount: 3 });   // 加注到 3
    s = applyAction(s, { type: 'raise', amount: 9 });   // 再加注到 9，增量 6 >= 2，完整加注
    while (s.toAct !== utg && !s.handOver) {
      s = applyAction(s, { type: 'fold' });
    }
    expect(s.toAct).toBe(utg);
    expect(legalActions(s).map(a => a.type)).toContain('raise');
  });
});

describe('currentPot', () => {
  it('等于所有人的本手总投入之和', () => {
    let s = startHand({ seed: 'aa-15', buttonSeat: 0 });
    expect(currentPot(s)).toBe(1.5);  // SB 0.5 + BB 1
    s = applyAction(s, { type: 'call' });
    expect(currentPot(s)).toBe(2.5);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/gameEngine.applyAction.test.ts`
Expected: FAIL，报错 `applyAction is not a function`

- [ ] **Step 3: 实现 applyAction 与街推进**

在 `src/core/gameEngine.ts` 末尾追加。顶部 import 补上 `Action`、`Street`、`HandResult`：

```ts
export function currentPot(state: GameState): number {
  return round2(state.seats.reduce((sum, s) => sum + s.totalContribution, 0));
}

export interface ActionInput {
  type: ActionType;
  /** raise/bet 时为「本次投入额」；其余类型忽略 */
  amount?: number;
}

export function applyAction(state: GameState, input: ActionInput): GameState {
  if (state.handOver || state.toAct === null) {
    throw new Error('本手已结束，无法继续行动');
  }

  const legal = legalActions(state);
  const match = legal.find(a => a.type === input.type);
  if (!match) {
    throw new Error(
      `非法动作 ${input.type}，当前可选：${legal.map(a => a.type).join('/')}`,
    );
  }

  // 决定本次实际投入额
  let invest: number;
  if (input.type === 'fold' || input.type === 'check') {
    invest = 0;
  } else if (input.type === 'call' || input.type === 'allin') {
    invest = match.min;
  } else {
    const want = input.amount ?? match.min;
    if (want < match.min || want > match.max) {
      throw new Error(`${input.type} 金额 ${want} 超出合法区间 [${match.min}, ${match.max}]`);
    }
    invest = want;
  }

  const seats = state.seats.map(s => ({ ...s }));
  const seat = seats[state.toAct];
  const potBefore = currentPot(state);
  const toCall = round2(state.currentBet - seat.streetContribution);
  const stackBefore = seat.stack;

  const action: Action = {
    seat: seat.seat,
    street: state.street,
    type: input.type,
    amount: invest,
    potBefore,
    toCall,
    stackBefore,
  };

  if (input.type === 'fold') {
    seat.folded = true;
  } else {
    seat.stack = round2(seat.stack - invest);
    seat.streetContribution = round2(seat.streetContribution + invest);
    seat.totalContribution = round2(seat.totalContribution + invest);
    if (seat.stack <= 0) {
      seat.stack = 0;
      seat.allIn = true;
    }
  }

  let currentBet = state.currentBet;
  let lastRaiseSize = state.lastRaiseSize;

  // 投入使本街最高额上升 => 构成加注
  if (seat.streetContribution > currentBet) {
    const increment = round2(seat.streetContribution - currentBet);
    currentBet = seat.streetContribution;
    if (increment >= lastRaiseSize) {
      // 完整加注：重开下注轮，其他人重获加注权
      lastRaiseSize = increment;
      for (const s of seats) {
        if (s.seat !== seat.seat) s.hasActedSinceLastFullRaise = false;
      }
    }
    // 增量不足最小加注额（只可能是 all-in）：不重开下注轮，
    // 不更新 lastRaiseSize，也不清空其他人的标志
  }

  seat.hasActedSinceLastFullRaise = true;

  const next: GameState = {
    ...state,
    seats,
    currentBet,
    lastRaiseSize,
    actions: [...state.actions, action],
  };

  return advance(next);
}

/** 推进到下一个该行动的人；若本街结束则开新街或结束本手 */
function advance(state: GameState): GameState {
  const live = state.seats.filter(s => !s.folded);

  // 只剩一人 => 本手结束
  if (live.length <= 1) {
    return { ...state, toAct: null, handOver: true };
  }

  const nextSeat = findNextToAct(state, state.toAct!);
  if (nextSeat !== null) {
    return { ...state, toAct: nextSeat };
  }

  // 本街结束
  if (state.street === 'river') {
    return { ...state, toAct: null, handOver: true };
  }
  return openNextStreet(state);
}

/** 从 from 之后顺时针找下一个需要行动的座位，找不到返回 null（本街结束） */
function findNextToAct(state: GameState, from: number): number | null {
  const n = state.seats.length;
  for (let i = 1; i <= n; i++) {
    const seat = state.seats[(from + i) % n];
    if (needsToAct(state, seat)) return seat.seat;
  }
  return null;
}

/** 该座位本街是否仍需行动 */
function needsToAct(state: GameState, seat: SeatState): boolean {
  if (seat.folded || seat.allIn) return false;
  // 尚未在本轮行动过 => 需要行动
  if (!seat.hasActedSinceLastFullRaise) return true;
  // 已行动但投入不足当前最高额（短 all-in 抬高了金额）=> 需要补齐或弃牌
  return round2(state.currentBet - seat.streetContribution) > 0;
}

const STREET_ORDER: Street[] = ['preflop', 'flop', 'turn', 'river'];

function openNextStreet(state: GameState): GameState {
  const idx = STREET_ORDER.indexOf(state.street);
  const nextStreet = STREET_ORDER[idx + 1];
  const drawCount = nextStreet === 'flop' ? 3 : 1;

  const board = [...state.board, ...state.deck.slice(0, drawCount)];
  const deck = state.deck.slice(drawCount);

  const seats = state.seats.map(s => ({
    ...s,
    streetContribution: 0,
    hasActedSinceLastFullRaise: false,
  }));

  const base: GameState = {
    ...state,
    seats,
    board,
    deck,
    street: nextStreet,
    currentBet: 0,
    lastRaiseSize: BIG_BLIND,
    toAct: null,
  };

  // 若可行动者不足 2 人，直接跳到下一街（all-in 摊牌跑马）
  const canAct = seats.filter(s => !s.folded && !s.allIn);
  if (canAct.length < 2) {
    if (nextStreet === 'river') {
      return { ...base, handOver: true };
    }
    return openNextStreet(base);
  }

  // 翻后从按钮位左手第一位（SB 方向）起首先行动
  const first = findNextToAct(base, state.buttonSeat);
  return { ...base, toAct: first };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/gameEngine.applyAction.test.ts`
Expected: PASS

- [ ] **Step 5: 跑全部测试确认没有回归**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add src/core/gameEngine.ts src/core/gameEngine.applyAction.test.ts
git commit -m "feat(core): 动作应用与街推进，含短 all-in 不重开下注轮规则

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: 摊牌结算与 HandRecord 产出

**Files:**
- Modify: `src/core/gameEngine.ts`（追加 `settleHand`、`toHandRecord`）
- Test: `src/core/gameEngine.settle.test.ts`

**Interfaces:**
- Consumes: `buildPots`（Task 6）、`evaluate7`（Task 5）、`GameState`/`HandResult`/`HandRecord`（Task 7）
- Produces:
  - `settleHand(state: GameState): GameState` — 填充 `results` 并把筹码派回各家 `stack`
  - `toHandRecord(state: GameState, opts: { id: string; heroSeat: number; personaIds: Record<number, string>; timestamp: number }): HandRecord`

- [ ] **Step 1: 写失败的测试**

创建 `src/core/gameEngine.settle.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { startHand, applyAction, settleHand, toHandRecord, totalChips } from './gameEngine';
import { SEAT_COUNT, STARTING_STACK, HAND_RECORD_SCHEMA_VERSION } from './types';
import type { GameState } from './types';

const CHIPS = SEAT_COUNT * STARTING_STACK;

function play(s: GameState, steps: { type: any; amount?: number }[]): GameState {
  let cur = s;
  for (const step of steps) {
    if (cur.handOver) break;
    cur = applyAction(cur, step);
  }
  return cur;
}

/** 打到本手结束 */
function playOut(seed: string, steps: { type: any; amount?: number }[]): GameState {
  let s = startHand({ seed, buttonSeat: 0 });
  s = play(s, steps);
  return settleHand(s);
}

describe('settleHand 筹码守恒', () => {
  it('全部弃牌给 BB 时筹码总量不变', () => {
    const s = playOut('st-1', [
      { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' },
    ]);
    expect(totalChips(s)).toBe(CHIPS);
  });

  it('打到摊牌时筹码总量不变', () => {
    const s = playOut('st-2', [
      { type: 'call' }, { type: 'call' }, { type: 'call' }, { type: 'call' },
      { type: 'call' }, { type: 'check' },
      { type: 'check' }, { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' }, { type: 'check' },
    ]);
    expect(s.handOver).toBe(true);
    expect(totalChips(s)).toBe(CHIPS);
  });
});

describe('settleHand 结果', () => {
  it('全部弃牌时 BB 赢下盲注', () => {
    const s = playOut('st-3', [
      { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' },
    ]);
    const bbSeat = s.seats.find(x => x.position === 'BB')!.seat;
    const bbResult = s.results!.find(r => r.seat === bbSeat)!;
    expect(bbResult.netBB).toBe(0.5);      // 赢下 SB 的 0.5
    expect(bbResult.showdown).toBe(false);
  });

  it('净盈亏之和为 0', () => {
    const s = playOut('st-4', [
      { type: 'raise', amount: 3 }, { type: 'call' },
      { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' },
      { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' },
    ]);
    const sum = s.results!.reduce((a, r) => a + r.netBB, 0);
    expect(Math.abs(sum)).toBeLessThan(1e-9);
  });

  it('每个座位都有一条结果', () => {
    const s = playOut('st-5', [
      { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' },
    ]);
    expect(s.results).toHaveLength(SEAT_COUNT);
  });

  it('净盈亏 = 结算后筹码 - 起始筹码', () => {
    const s = playOut('st-6', [
      { type: 'raise', amount: 3 }, { type: 'call' },
      { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' },
      { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' },
      { type: 'check' }, { type: 'check' },
    ]);
    for (const r of s.results!) {
      expect(r.netBB).toBeCloseTo(s.seats[r.seat].stack - STARTING_STACK, 9);
    }
  });
});

describe('toHandRecord', () => {
  it('产出自包含的完整记录', () => {
    const s = playOut('st-7', [
      { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' },
    ]);
    const rec = toHandRecord(s, {
      id: 'hand-1',
      heroSeat: 0,
      personaIds: { 1: 'tag', 2: 'lag', 3: 'station', 4: 'rock', 5: 'maniac' },
      timestamp: 1700000000000,
    });

    expect(rec.id).toBe('hand-1');
    expect(rec.schemaVersion).toBe(HAND_RECORD_SCHEMA_VERSION);
    expect(rec.seed).toBe('st-7');
    expect(rec.heroSeat).toBe(0);
    expect(rec.seats).toHaveLength(SEAT_COUNT);
    expect(rec.seats[0].personaId).toBe('hero');
    expect(rec.seats[1].personaId).toBe('tag');
    expect(rec.seats.every(x => x.holeCards.length === 2)).toBe(true);
    expect(rec.actions.length).toBeGreaterThan(0);
    expect(rec.results).toHaveLength(SEAT_COUNT);
  });

  it('记录可 JSON 往返', () => {
    const s = playOut('st-8', [
      { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' }, { type: 'fold' },
    ]);
    const rec = toHandRecord(s, {
      id: 'hand-2', heroSeat: 0, personaIds: {}, timestamp: 1,
    });
    expect(JSON.parse(JSON.stringify(rec))).toEqual(rec);
  });

  it('本手未结束时抛错', () => {
    const s = startHand({ seed: 'st-9', buttonSeat: 0 });
    expect(() =>
      toHandRecord(s, { id: 'x', heroSeat: 0, personaIds: {}, timestamp: 1 }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/gameEngine.settle.test.ts`
Expected: FAIL，报错 `settleHand is not a function`

- [ ] **Step 3: 实现 settleHand 与 toHandRecord**

在 `src/core/gameEngine.ts` 末尾追加。顶部补上 `import { buildPots } from './pots'`、`import { evaluate7 } from './handEval'`、以及 `HandRecord`/`HandRecordSeat`/`HAND_RECORD_SCHEMA_VERSION` 的 import：

```ts
/**
 * 结算本手：按主池/边池逐池比牌，把筹码派回各家 stack，并填充 results。
 * 必须在 handOver 为 true 时调用。
 */
export function settleHand(state: GameState): GameState {
  if (!state.handOver) throw new Error('本手尚未结束，不能结算');
  if (state.results) return state;

  const seats = state.seats.map(s => ({ ...s }));
  const contributions = new Map(seats.map(s => [s.seat, s.totalContribution]));
  const folded = new Set(seats.filter(s => s.folded).map(s => s.seat));
  const pots = buildPots(contributions, folded);

  const live = seats.filter(s => !s.folded);
  const isShowdown = live.length > 1;

  // 摊牌时预先算好每个未弃牌座位的牌力
  const scores = new Map<number, number>();
  if (isShowdown) {
    for (const s of live) {
      scores.set(s.seat, evaluate7([...s.holeCards, ...state.board]));
    }
  }

  const won = new Map<number, number>(seats.map(s => [s.seat, 0]));

  for (const pot of pots) {
    const contenders = pot.eligible;
    let winners: number[];
    if (contenders.length === 1) {
      winners = contenders;
    } else {
      let best = -1;
      winners = [];
      for (const seat of contenders) {
        const sc = scores.get(seat) ?? -1;
        if (sc > best) {
          best = sc;
          winners = [seat];
        } else if (sc === best) {
          winners.push(seat);
        }
      }
    }
    // 平分，余数按座位号升序分配，保证总额不丢失
    const share = Math.floor((pot.amount / winners.length) * 100) / 100;
    let distributed = 0;
    for (const seat of winners) {
      won.set(seat, round2(won.get(seat)! + share));
      distributed = round2(distributed + share);
    }
    const remainder = round2(pot.amount - distributed);
    if (remainder > 0) {
      const first = winners[0];
      won.set(first, round2(won.get(first)! + remainder));
    }
  }

  for (const s of seats) {
    s.stack = round2(s.stack + won.get(s.seat)!);
  }

  const results: HandResult[] = seats.map(s => ({
    seat: s.seat,
    netBB: round2(won.get(s.seat)! - s.totalContribution),
    showdown: isShowdown && !s.folded,
  }));

  return { ...state, seats, toAct: null, results };
}

export interface ToHandRecordOptions {
  id: string;
  heroSeat: number;
  /** 座位号 -> persona id；hero 的座位无需提供 */
  personaIds: Record<number, string>;
  timestamp: number;
}

export function toHandRecord(state: GameState, opts: ToHandRecordOptions): HandRecord {
  if (!state.handOver) throw new Error('本手尚未结束，无法生成 HandRecord');
  const settled = state.results ? state : settleHand(state);

  const seats: HandRecordSeat[] = settled.seats.map(s => ({
    seat: s.seat,
    position: s.position,
    personaId: s.seat === opts.heroSeat ? 'hero' : (opts.personaIds[s.seat] ?? 'unknown'),
    // 每手牌都从固定筹码重置开始（spec §2），无需从结算结果反推
    startingStack: STARTING_STACK,
    holeCards: s.holeCards,
  }));

  return {
    id: opts.id,
    schemaVersion: HAND_RECORD_SCHEMA_VERSION,
    timestamp: opts.timestamp,
    seed: settled.seed,
    heroSeat: opts.heroSeat,
    buttonSeat: settled.buttonSeat,
    seats,
    board: settled.board,
    actions: settled.actions,
    results: settled.results!,
  };
}
```

`settleHand` 里余数分配那段值得留意：平分时先按 2 位小数向下取整分给每个赢家，再把余下的零头补给座位号最小的赢家。这样做保证「派出去的总额恰好等于池子总额」，筹码守恒不变量才不会因为除不尽而失败。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/gameEngine.settle.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/gameEngine.ts src/core/gameEngine.settle.test.ts
git commit -m "feat(core): 摊牌结算与 HandRecord 产出

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: 蒙特卡洛胜率与精确穷举

**Files:**
- Create: `src/core/equity.ts`
- Test: `src/core/equity.test.ts`

**Interfaces:**
- Consumes: `Card`/`makeDeck`/`sameCard`（Task 3）、`evaluate7`（Task 5）、`Rng`（Task 2）
- Produces:
  - `equityMonteCarlo(hero: [Card,Card], board: Card[], opponentCount: number, iterations: number, rng: Rng): number`
  - `equityExactVsOne(hero: [Card,Card], board: Card[]): number`

两者都返回 0..1 的胜率，平局按 `1/并列人数` 计入。本任务只支持「对手为随机手牌」；对手范围版本在计划 ② 加入。

- [ ] **Step 1: 写失败的测试**

创建 `src/core/equity.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseCards } from './cards';
import type { Card } from './cards';
import { createRng } from './rng';
import { equityMonteCarlo, equityExactVsOne } from './equity';

const hole = (s: string) => parseCards(s) as [Card, Card];

describe('equityExactVsOne', () => {
  it('河牌圈坚果同花对随机手接近必胜', () => {
    // 公共牌四张黑桃 + 一张杂牌，hero 持黑桃 A K 成同花
    const eq = equityExactVsOne(hole('As Ks'), parseCards('Qs Js 9s 4h 2d'));
    expect(eq).toBeGreaterThan(0.97);
  });

  it('公共牌本身是皇家同花顺时双方必然平分', () => {
    const eq = equityExactVsOne(hole('2h 3d'), parseCards('As Ks Qs Js Ts'));
    expect(eq).toBeCloseTo(0.5, 2);
  });

  it('胜率落在 [0,1] 内', () => {
    const eq = equityExactVsOne(hole('7c 2d'), parseCards('As Ks Qh 4h 9d'));
    expect(eq).toBeGreaterThanOrEqual(0);
    expect(eq).toBeLessThanOrEqual(1);
  });
});

describe('equityMonteCarlo 已知值', () => {
  const rng = () => createRng('equity-known');

  it('AA vs 单个随机手翻前约 85%', () => {
    const eq = equityMonteCarlo(hole('As Ad'), [], 1, 40000, rng());
    expect(eq).toBeGreaterThan(0.83);
    expect(eq).toBeLessThan(0.87);
  });

  it('72o vs 单个随机手翻前约 35%', () => {
    const eq = equityMonteCarlo(hole('7c 2d'), [], 1, 40000, rng());
    expect(eq).toBeGreaterThan(0.32);
    expect(eq).toBeLessThan(0.38);
  });

  it('AA vs 5 个随机手翻前约 49%', () => {
    const eq = equityMonteCarlo(hole('As Ad'), [], 5, 40000, rng());
    expect(eq).toBeGreaterThan(0.45);
    expect(eq).toBeLessThan(0.53);
  });

  it('对手越多胜率越低', () => {
    const one = equityMonteCarlo(hole('As Ad'), [], 1, 20000, rng());
    const five = equityMonteCarlo(hole('As Ad'), [], 5, 20000, rng());
    expect(one).toBeGreaterThan(five);
  });
});

describe('equityMonteCarlo 与精确解对拍', () => {
  it('河牌圈误差小于 1.5 个百分点', () => {
    const cases: Array<[string, string]> = [
      ['As Ks', 'Qs Js 9s 4h 2d'],
      ['7c 2d', 'As Ks Qh 4h 9d'],
      ['9h 9d', '9c 4s 2h Kd 7c'],
      ['Ah Kd', 'Ac Kh 5s 2d 9c'],
      ['5c 4c', '3h 2s 6d Ac Kd'],
    ];
    for (const [h, b] of cases) {
      const exact = equityExactVsOne(hole(h), parseCards(b));
      const mc = equityMonteCarlo(hole(h), parseCards(b), 1, 20000, createRng(`mc-${h}`));
      expect(Math.abs(mc - exact)).toBeLessThan(0.015);
    }
  });

  it('转牌圈误差小于 1.5 个百分点', () => {
    const exact = equityExactVsOne(hole('As Ks'), parseCards('Qs Js 9s 4h'));
    const mc = equityMonteCarlo(hole('As Ks'), parseCards('Qs Js 9s 4h'), 1, 20000, createRng('mc-turn'));
    expect(Math.abs(mc - exact)).toBeLessThan(0.015);
  });
});

describe('equityMonteCarlo 可复现', () => {
  it('相同 seed 得到相同结果', () => {
    const a = equityMonteCarlo(hole('As Ad'), [], 2, 5000, createRng('repro'));
    const b = equityMonteCarlo(hole('As Ad'), [], 2, 5000, createRng('repro'));
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/equity.test.ts`
Expected: FAIL，报错 `Failed to resolve import "./equity"`

- [ ] **Step 3: 实现 equity.ts**

创建 `src/core/equity.ts`：

```ts
import type { Card } from './cards';
import { makeDeck, sameCard } from './cards';
import { evaluate7 } from './handEval';
import type { Rng } from './rng';

/** 从整副牌里剔除已知牌 */
function remainingDeck(known: Card[]): Card[] {
  return makeDeck().filter(c => !known.some(k => sameCard(k, c)));
}

/**
 * 蒙特卡洛胜率。对手手牌按随机手处理。
 * 平局按 1/并列人数 计入，因此返回的是「期望份额」而非纯胜率。
 */
export function equityMonteCarlo(
  hero: [Card, Card],
  board: Card[],
  opponentCount: number,
  iterations: number,
  rng: Rng,
): number {
  const known = [...hero, ...board];
  const pool = remainingDeck(known);
  const boardNeeded = 5 - board.length;
  const drawCount = boardNeeded + opponentCount * 2;

  if (drawCount > pool.length) {
    throw new Error(`牌不够：需要抽 ${drawCount} 张，牌堆只剩 ${pool.length} 张`);
  }

  let total = 0;
  const drawn: Card[] = new Array(drawCount);

  for (let iter = 0; iter < iterations; iter++) {
    // 部分 Fisher-Yates：只打乱前 drawCount 张，避免每轮复制整副牌
    for (let i = 0; i < drawCount; i++) {
      const j = i + rng.nextInt(pool.length - i);
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
      drawn[i] = pool[i];
    }

    const fullBoard = board.concat(drawn.slice(0, boardNeeded));
    const heroScore = evaluate7([hero[0], hero[1], ...fullBoard]);

    let ties = 1;
    let beaten = false;
    for (let o = 0; o < opponentCount; o++) {
      const base = boardNeeded + o * 2;
      const oppScore = evaluate7([drawn[base], drawn[base + 1], ...fullBoard]);
      if (oppScore > heroScore) {
        beaten = true;
        break;
      }
      if (oppScore === heroScore) ties++;
    }

    if (!beaten) total += 1 / ties;
  }

  return total / iterations;
}

/**
 * 单对手精确胜率：穷举对手所有可能的两张底牌与所有可能的剩余公共牌。
 * 只在剩余未知牌较少时使用（转牌 / 河牌），翻前调用会极慢。
 */
export function equityExactVsOne(hero: [Card, Card], board: Card[]): number {
  const known = [...hero, ...board];
  const pool = remainingDeck(known);
  const boardNeeded = 5 - board.length;

  let total = 0;
  let count = 0;

  const runouts: Card[][] = [];
  collectCombos(pool, boardNeeded, 0, [], runouts);

  for (const runout of runouts) {
    const fullBoard = board.concat(runout);
    const heroScore = evaluate7([hero[0], hero[1], ...fullBoard]);
    const oppPool = pool.filter(c => !runout.some(r => sameCard(r, c)));

    for (let i = 0; i < oppPool.length; i++) {
      for (let j = i + 1; j < oppPool.length; j++) {
        const oppScore = evaluate7([oppPool[i], oppPool[j], ...fullBoard]);
        if (heroScore > oppScore) total += 1;
        else if (heroScore === oppScore) total += 0.5;
        count++;
      }
    }
  }

  return count === 0 ? 0 : total / count;
}

/** 收集 pool 中所有 k 元组合 */
function collectCombos(
  pool: Card[],
  k: number,
  start: number,
  acc: Card[],
  out: Card[][],
): void {
  if (acc.length === k) {
    out.push([...acc]);
    return;
  }
  for (let i = start; i < pool.length; i++) {
    acc.push(pool[i]);
    collectCombos(pool, k, i + 1, acc, out);
    acc.pop();
  }
}
```

`equityMonteCarlo` 里的部分洗牌就地修改了 `pool`，这没问题——`pool` 是本函数内新建的临时数组，每轮迭代打乱前缀不影响正确性（整个数组始终是同一批牌的一个排列）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/core/equity.test.ts`
Expected: PASS。精确穷举的用例耗时较长（河牌圈约 990 组、转牌圈约 44×990 组），单个测试几秒内应完成。

- [ ] **Step 5: 提交**

```bash
git add src/core/equity.ts src/core/equity.test.ts
git commit -m "feat(core): 蒙特卡洛胜率与精确穷举，两者对拍误差 <1.5%

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: 一万手自对弈属性测试

这是整个计划的验收关卡。用随机合法动作驱动完整牌局，验证引擎在任意路径下都不崩、不死锁、筹码不丢。

**Files:**
- Create: `src/core/selfPlay.ts`
- Test: `src/core/selfPlay.test.ts`

**Interfaces:**
- Consumes: `startHand`/`legalActions`/`applyAction`/`settleHand`/`totalChips`/`toHandRecord`（Task 7–10）、`Rng`（Task 2）
- Produces:
  - `playRandomHand(seed: string, buttonSeat: number): { state: GameState; record: HandRecord }`

- [ ] **Step 1: 写失败的测试**

创建 `src/core/selfPlay.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { playRandomHand } from './selfPlay';
import { totalChips } from './gameEngine';
import { SEAT_COUNT, STARTING_STACK } from './types';
import { cardToString } from './cards';

const CHIPS = SEAT_COUNT * STARTING_STACK;

describe('一万手随机自对弈', () => {
  it('筹码守恒、无死锁、结果自洽', () => {
    for (let i = 0; i < 10_000; i++) {
      const seed = `selfplay-${i}`;
      const buttonSeat = i % SEAT_COUNT;

      const { state, record } = playRandomHand(seed, buttonSeat);

      // 本手必须正常结束
      expect(state.handOver).toBe(true);
      expect(state.results).not.toBeNull();

      // 筹码守恒
      if (totalChips(state) !== CHIPS) {
        throw new Error(`seed=${seed} 筹码不守恒：${totalChips(state)} != ${CHIPS}`);
      }

      // 净盈亏之和为 0
      const sum = state.results!.reduce((a, r) => a + r.netBB, 0);
      if (Math.abs(sum) > 1e-9) {
        throw new Error(`seed=${seed} 净盈亏之和 ${sum} != 0`);
      }

      // 公共牌张数与结束街道一致
      const expectedBoard =
        state.street === 'preflop' ? 0 :
        state.street === 'flop' ? 3 :
        state.street === 'turn' ? 4 : 5;
      if (state.board.length !== expectedBoard) {
        throw new Error(
          `seed=${seed} 街道 ${state.street} 但公共牌 ${state.board.length} 张`,
        );
      }

      // 全场牌面无重复
      const all = [...record.seats.flatMap(s => s.holeCards), ...record.board].map(cardToString);
      if (new Set(all).size !== all.length) {
        throw new Error(`seed=${seed} 出现重复牌：${all.join(' ')}`);
      }

      // 无人筹码为负
      if (state.seats.some(s => s.stack < 0)) {
        throw new Error(`seed=${seed} 出现负筹码`);
      }
    }
  }, 300_000);
});

describe('playRandomHand 可复现', () => {
  it('相同 seed 与按钮位产生完全相同的牌局', () => {
    const a = playRandomHand('repro-1', 2);
    const b = playRandomHand('repro-1', 2);
    expect(JSON.stringify(a.record)).toBe(JSON.stringify(b.record));
  });
});

describe('多种结束方式都会出现', () => {
  it('一万手中翻前结束与打到河牌的都有', () => {
    const streets = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const { state } = playRandomHand(`variety-${i}`, i % SEAT_COUNT);
      streets.add(state.street);
    }
    expect(streets.has('preflop')).toBe(true);
    expect(streets.has('river')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/core/selfPlay.test.ts`
Expected: FAIL，报错 `Failed to resolve import "./selfPlay"`

- [ ] **Step 3: 实现 selfPlay.ts**

创建 `src/core/selfPlay.ts`：

```ts
import { applyAction, legalActions, settleHand, startHand, toHandRecord } from './gameEngine';
import { createRng } from './rng';
import type { GameState, HandRecord } from './types';
import { HERO_SEAT } from './types';

/**
 * 用随机合法动作打完一手牌。仅用于测试引擎健壮性，不是 AI。
 */
export function playRandomHand(
  seed: string,
  buttonSeat: number,
): { state: GameState; record: HandRecord } {
  const rng = createRng(`${seed}-actions`);
  let state = startHand({ seed, buttonSeat });

  // 上限防死锁：正常一手牌远不到这么多动作
  let guard = 0;
  while (!state.handOver) {
    if (++guard > 500) {
      throw new Error(`seed=${seed} 疑似死锁：动作数超过 500`);
    }
    const legal = legalActions(state);
    if (legal.length === 0) {
      throw new Error(
        `seed=${seed} 死锁：街道 ${state.street}、toAct=${state.toAct} 却无合法动作`,
      );
    }
    const pick = legal[rng.nextInt(legal.length)];
    const amount =
      pick.max > pick.min
        ? Math.round((pick.min + rng.nextFloat() * (pick.max - pick.min)) * 100) / 100
        : pick.min;
    state = applyAction(state, { type: pick.type, amount });
  }

  state = settleHand(state);

  const record = toHandRecord(state, {
    id: `${seed}-${buttonSeat}`,
    heroSeat: HERO_SEAT,
    personaIds: {},
    timestamp: 0,
  });

  return { state, record };
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run src/core/selfPlay.test.ts`
Expected: PASS。耗时约 1–4 分钟。

若报错，错误信息里都带有 `seed=`。用该 seed 单独调用 `playRandomHand` 即可精确复现，逐步打印 `state` 定位问题。**不要**通过放宽断言来"修复"——不变量失败一定意味着引擎有真 bug。

- [ ] **Step 5: 跑全套测试**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 6: 类型检查**

Run: `npm run typecheck`
Expected: 无输出、退出码 0

- [ ] **Step 7: 提交**

```bash
git add src/core/selfPlay.ts src/core/selfPlay.test.ts
git commit -m "test(core): 一万手随机自对弈属性测试，筹码守恒不变量全绿

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 完成标准

计划 ① 完成时，以下全部成立：

- [ ] `npm test` 全绿
- [ ] `npm run typecheck` 退出码 0
- [ ] `src/core/` 内无 `import React`、`document`、`window`
- [ ] `src/core/` 内除 `rng.ts` 外无 `Math.random()`（`rng.ts` 内也不应有）
- [ ] 快慢两版牌型评估 10 万组对拍一致
- [ ] 一万手随机自对弈筹码守恒不变量从未失败
- [ ] 蒙特卡洛胜率与精确穷举误差 < 1.5 个百分点

## 交付物清单

```
package.json          tsconfig.json         vitest.config.ts
src/core/rng.ts       src/core/cards.ts     src/core/handScore.ts
src/core/handEval.ts  src/core/handEvalSlow.ts
src/core/pots.ts      src/core/types.ts     src/core/gameEngine.ts
src/core/equity.ts    src/core/selfPlay.ts
+ 对应的 *.test.ts
```

## 下一步

计划 ②（智能层）在本计划完成后编写，将基于本计划实际产出的接口：
`GameState`、`HandRecord`、`evaluate7`、`equityMonteCarlo`、`legalActions`。
