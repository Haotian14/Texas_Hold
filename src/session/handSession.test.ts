import { describe, it, expect } from 'vitest';
import { HERO_SEAT, SEAT_COUNT, STARTING_STACK } from '../core/types';
import { totalChips, legalActions } from '../core/gameEngine';
import { replayHandRecord } from '../core/handRecord';
import { createLedger } from './ledger';
import {
  beginHand,
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

/** 推进到下一动作会结束手牌，返回可重复执行该动作的闭包。 */
function terminalTransition(
  s0: HandSessionState,
  cfg: SessionConfig,
): () => HandSessionState {
  let s = s0;
  let guard = 0;
  while (true) {
    if (++guard > 200) throw new Error('未找到终局动作');
    if (s.phase === 'aiToAct') {
      const before = s;
      const next = stepAi(before, cfg);
      if (next.phase === 'handOver') return () => stepAi(before, cfg);
      s = next;
      continue;
    }
    if (s.phase === 'handOver') throw new Error('未找到终局动作');

    const legal = legalActions(s.game);
    const pick = legal.find(a => a.type === 'check')
      ?? legal.find(a => a.type === 'call')
      ?? legal.find(a => a.type === 'fold');
    if (!pick) throw new Error('hero 没有可用于推进的动作');
    const before = s;
    const input = { type: pick.type };
    const next = applyHero(before, input, cfg);
    if (next.phase === 'handOver') return () => applyHero(before, input, cfg);
    s = next;
  }
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
    expect(s.phase).toBe('aiToAct');
    while (s.phase === 'aiToAct') {
      if (++guard > 200) throw new Error('疑似死锁');
      s = stepAi(s, CFG);
      expect(totalChips(s.game)).toBeCloseTo(total, 6);
    }
    expect(guard).toBeGreaterThan(0);
  });

  it('stepAi 是幂等的：对同一个状态调两次，结果逐位相同', () => {
    // 开局时按钮位为 0，hero 坐 0 号位（BTN），翻前第一个行动的必是 AI
    const s = startSession(CFG);
    expect(s.phase).toBe('aiToAct');

    const a = stepAi(s, CFG);
    const b = stepAi(s, CFG);
    expect(a).toEqual(b);
  });

  it('终局转换在递增时钟下仍对完整状态幂等', () => {
    let clock = 7000;
    const cfg: SessionConfig = {
      seed: 'terminal-idempotence',
      iterations: 100,
      strengthIterations: 7,
      now: () => ++clock,
    };
    const started = startSession(cfg);
    expect(clock).toBe(7001);
    const finish = terminalTransition(started, cfg);

    const a = finish();
    const b = finish();
    expect(a.phase).toBe('handOver');
    expect(a).toEqual(b);
    expect(a.record!.timestamp).toBe(7001);
    expect(clock).toBe(7001);
  });

  it('applyHero 省略 cfg 保留开手时的 seed、strengthIterations 与时间戳', () => {
    let clock = 4100;
    const cfg: SessionConfig = {
      seed: 'hero-config-snapshot',
      iterations: 100,
      strengthIterations: 3,
      now: () => ++clock,
    };
    const state = runToHeroOrEnd(startSession(cfg), cfg);
    expect(state.phase).toBe('awaitingHero');

    const omitted = applyHero(state, { type: 'fold' });
    const explicit = applyHero(state, { type: 'fold' }, cfg);
    expect(omitted).toEqual(explicit);
    const omittedOver = runHandPassively(omitted, cfg);
    const explicitOver = runHandPassively(explicit, cfg);
    expect(omittedOver).toEqual(explicitOver);
    expect(omittedOver.record!.timestamp).toBe(4101);
    expect(state.seed).toBe('hero-config-snapshot');
    expect(state.strengthIterations).toBe(3);
    expect(state.handTimestamp).toBe(4101);
    expect(clock).toBe(4101);
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
    expect(s.phase).toBe('aiToAct');
    s = stepAi(s, CFG);
    expect(s.lastAction).not.toBeNull();
    const last = s.game.actions[s.game.actions.length - 1];
    expect(s.lastAction!.seat).toBe(last.seat);
    expect(s.lastAction!.type).toBe(last.type);
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

  it('开手筹码恰好达到 150BB 时算深筹码', () => {
    const stacks = [DEEP_STACK_BB, ...new Array<number>(SEAT_COUNT - 1).fill(STARTING_STACK)];
    const s = beginHand(CFG, 0, stacks, createLedger(), stacks.reduce((a, b) => a + b, 0));
    expect(isDeepStackHand(s)).toBe(true);
  });
});
