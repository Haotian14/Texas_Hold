import { describe, it, expect } from 'vitest';
import { startSession, stepAi, applyHero, nextHand } from '../session/handSession';
import type { HandSessionState, SessionConfig } from '../session/handSession';
import { opponentsRevealed } from './tableModel';

// 迭代数压低：这些断言与 AI 打得多好无关，只与「谁弃了牌、手牌结没结束」有关。
const CFG: SessionConfig = { seed: 'reveal-2026-08-30', iterations: 200, strengthIterations: 20 };

function runAi(s: HandSessionState): HandSessionState {
  while (s.phase === 'aiToAct') s = stepAi(s, CFG);
  return s;
}

/** hero 有得行动的第一个局面 */
function heroTurn(): HandSessionState {
  let s = runAi(startSession(CFG));
  for (let i = 0; i < 30 && s.phase !== 'awaitingHero'; i++) {
    s = runAi(s.phase === 'handOver' ? nextHand(s, CFG) : s);
  }
  if (s.phase !== 'awaitingHero') throw new Error('30 手里 hero 一次行动机会都没有，用例前提不成立');
  return s;
}

/**
 * 找一手「hero 弃了牌，但这手还在继续打」的局面。
 *
 * 本功能存在的理由正是这段观战时间——弃牌到结算之间 AI 还在打。找不到
 * 这样一手，下面那条断言就是空的，所以找不到就直接失败，不静默放过。
 */
function heroFoldedMidHand(): HandSessionState {
  let s = runAi(startSession(CFG));
  for (let i = 0; i < 30; i++) {
    s = runAi(s);
    if (s.phase === 'awaitingHero') {
      const folded = applyHero(s, { type: 'fold' }, CFG);
      if (folded.phase === 'aiToAct') return folded;
      s = folded;
    }
    if (s.phase === 'handOver') s = nextHand(s, CFG);
  }
  throw new Error('30 手里找不到「hero 弃牌后牌局继续」的局面，用例前提不成立');
}

/** 把一个真实局面按结算态改写。results 是唯一被改的事实 */
function settledAs(s: HandSessionState, showdown: boolean): HandSessionState {
  return {
    ...s,
    phase: 'handOver',
    record: { results: [{ seat: 0, netBB: 1, showdown }] },
  } as unknown as HandSessionState;
}

describe('牌桌上何时亮出对手底牌', () => {
  it('hero 还在牌里、手牌没结束时，一张都不亮', () => {
    const s = heroTurn();
    expect(s.game.seats[0].folded).toBe(false);
    expect(opponentsRevealed(s)).toBe(false);
  });

  it('hero 一弃牌就亮，不必等到结算', () => {
    const s = heroFoldedMidHand();
    expect(s.game.seats[0].folded).toBe(true);
    // 这才是重点：手牌还没结束，AI 还在打，而牌已经看得见了
    expect(s.phase).toBe('aiToAct');
    expect(opponentsRevealed(s)).toBe(true);
  });

  it('弃牌后一路亮到结算，不会在结算那一刻缩回去', () => {
    const s = runAi(heroFoldedMidHand());
    expect(s.phase).toBe('handOver');
    // 这手没走到摊牌也照样亮——你早就看见了，没有再藏起来的道理
    expect(opponentsRevealed(settledAs(s, false))).toBe(true);
  });

  it('摊牌结算照旧亮（原有行为不回归）', () => {
    expect(opponentsRevealed(settledAs(heroTurn(), true))).toBe(true);
  });

  it('hero 没弃牌、赢在别人全弃时不亮——没摊牌就是没摊牌', () => {
    expect(opponentsRevealed(settledAs(heroTurn(), false))).toBe(false);
  });
});
