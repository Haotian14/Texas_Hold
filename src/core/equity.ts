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
