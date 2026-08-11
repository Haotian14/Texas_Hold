import { describe, it, expect } from 'vitest';
import { HERO_SEAT, SEAT_COUNT, STARTING_STACK } from '../core/types';
import { totalChips, legalActions } from '../core/gameEngine';
import { replayHandRecord } from '../core/handRecord';
import {
  startSession,
  stepAi,
  applyHero,
  isDeepStackHand,
  DEEP_STACK_BB,
} from './handSession';
import type { HandSessionState, SessionConfig } from './handSession';

const CFG: SessionConfig = { seed: 'hs-test', iterations: 100, strengthIterations: 10 };

/** 推进到 hero 回合或手牌结束 */
function runToHeroOrEnd(s0: HandSessionState, cfg: SessionConfig): HandSessionState {
  let s = s0;
  let guard = 0;
  while (s.phase === 'aiToAct') {
    if (++guard > 200) throw new Error('疑似死锁');
    s = stepAi(s, cfg);
  }
  return s;
}

/** hero 一律选最保守的合法动作，把一手打到结束 */
function runHandPassively(s0: HandSessionState, cfg: SessionConfig): HandSessionState {
  let s = runToHeroOrEnd(s0, cfg);
  let guard = 0;
  while (s.phase !== 'handOver') {
    if (++guard > 200) throw new Error('疑似死锁');
    const legal = legalActions(s.game);
    const pick = legal.find(a => a.type === 'check') ?? legal.find(a => a.type === 'fold')!;
    s = applyHero(s, { type: pick.type });
    s = runToHeroOrEnd(s, cfg);
  }
  return s;
}

describe('handSession 单手', () => {
  it('开局六个座位各带 STARTING_STACK，按钮位为 0', () => {
    const s = startSession(CFG);
    expect(s.handIndex).toBe(0);
    expect(s.game.buttonSeat).toBe(0);
    expect(s.game.seats).toHaveLength(SEAT_COUNT);
    for (const seat of s.game.seats) {
      expect(seat.startingStack).toBe(STARTING_STACK);
    }
    expect(s.ledger.totalBuyIn).toBe(STARTING_STACK);
  });

  it('phase 与引擎状态一致', () => {
    const s = startSession(CFG);
    expect(s.phase).toBe(s.game.toAct === HERO_SEAT ? 'awaitingHero' : 'aiToAct');
  });

  it('每个动作后筹码守恒', () => {
    const s0 = startSession(CFG);
    const total = totalChips(s0.game);
    let s = s0;
    let guard = 0;
    while (s.phase === 'aiToAct') {
      if (++guard > 200) throw new Error('疑似死锁');
      s = stepAi(s, CFG);
      expect(totalChips(s.game)).toBeCloseTo(total, 6);
    }
  });

  it('stepAi 是幂等的：对同一个状态调两次，结果逐位相同', () => {
    // 开局时按钮位为 0，hero 坐 0 号位（BTN），翻前第一个行动的必是 AI
    const s = startSession(CFG);
    expect(s.phase).toBe('aiToAct');

    const a = stepAi(s, CFG);
    const b = stepAi(s, CFG);
    expect(JSON.stringify(a.game)).toBe(JSON.stringify(b.game));
    expect(a.stepIndex).toBe(b.stepIndex);
  });

  it('applyHero 是幂等的', () => {
    const s = runToHeroOrEnd(startSession(CFG), CFG);
    expect(s.phase).toBe('awaitingHero');
    const a = applyHero(s, { type: 'fold' });
    const b = applyHero(s, { type: 'fold' });
    expect(JSON.stringify(a.game)).toBe(JSON.stringify(b.game));
  });

  it('非法阶段调用会抛错，而不是静默返回原状态', () => {
    const s = runToHeroOrEnd(startSession(CFG), CFG);
    expect(s.phase).toBe('awaitingHero');
    expect(() => stepAi(s, CFG)).toThrow();

    const over = runHandPassively(startSession(CFG), CFG);
    expect(over.phase).toBe('handOver');
    expect(() => applyHero(over, { type: 'fold' })).toThrow();
  });

  it('手牌结束时产出可被 replayHandRecord 复现的 HandRecord', () => {
    const s = runHandPassively(startSession(CFG), CFG);
    expect(s.record).not.toBeNull();

    const replayed = replayHandRecord(s.record!);
    expect(replayed.board).toEqual(s.game.board);
    expect(replayed.seats.map(x => x.stack)).toEqual(s.game.seats.map(x => x.stack));
  });

  it('手牌结束时更新 stacks 与 handsPlayed', () => {
    const s = runHandPassively(startSession(CFG), CFG);
    expect(s.ledger.handsPlayed).toBe(1);
    expect(s.stacks).toEqual(s.game.seats.map(x => x.stack));
  });

  it('lastAction 反映最近一个动作', () => {
    let s = startSession(CFG);
    expect(s.lastAction).toBeNull();
    if (s.phase === 'aiToAct') {
      s = stepAi(s, CFG);
      expect(s.lastAction).not.toBeNull();
      const last = s.game.actions[s.game.actions.length - 1];
      expect(s.lastAction!.seat).toBe(last.seat);
      expect(s.lastAction!.type).toBe(last.type);
    }
  });

  it('同 seed 打两遍，牌局逐位相同', () => {
    const a = runHandPassively(startSession(CFG), CFG);
    const b = runHandPassively(startSession(CFG), CFG);
    expect(JSON.stringify(a.record)).toBe(JSON.stringify(b.record));
  });

  it('默认时钟是确定性的，不引入 Date.now', () => {
    const s = runHandPassively(startSession(CFG), CFG);
    expect(s.record!.timestamp).toBe(0);
  });

  it('注入的时钟会被用上', () => {
    const cfg: SessionConfig = { ...CFG, now: () => 12345 };
    const s = runHandPassively(startSession(cfg), cfg);
    expect(s.record!.timestamp).toBe(12345);
  });

  it('全员 100BB 的手牌不算深筹码', () => {
    expect(isDeepStackHand(startSession(CFG))).toBe(false);
    expect(DEEP_STACK_BB).toBe(150);
  });
});
