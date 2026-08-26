import { describe, it, expect } from 'vitest';
import { BIG_BLIND, HERO_SEAT, SEAT_COUNT, STARTING_STACK } from '../core/types';
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
  nextHand,
  heroNeedsRebuy,
  rebuyHero,
  REBUY_OPTIONS,
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

function sessionWithHeroStack(stack: number): HandSessionState {
  const stacks = [stack, 100, 100, 100, 100, 100];
  const s = beginHand(CFG, 3, stacks, createLedger(), 600);
  return { ...s, phase: 'handOver', record: null, stacks };
}

describe('handSession across hands', () => {
  it('exposes target rebuy options of 100 / 200 BB', () => {
    expect(REBUY_OPTIONS).toEqual([100, 200]);
  });

  it('nextHand advances the button and hand index', () => {
    const s = runHandPassively(startSession(CFG), CFG);
    const n = nextHand(s, CFG);
    expect(n.handIndex).toBe(1);
    expect(n.game.buttonSeat).toBe(1);
    expect(n.phase).not.toBe('handOver');
    expect(n.record).toBeNull();
  });

  it('rotates the hero through all six positions', () => {
    let s = runHandPassively(startSession(CFG), CFG);
    const positions: string[] = [s.game.seats[HERO_SEAT].position];
    for (let i = 0; i < SEAT_COUNT - 1; i++) {
      s = runHandPassively(nextHand(s, CFG), CFG);
      positions.push(s.game.seats[HERO_SEAT].position);
    }
    expect(new Set(positions).size).toBe(SEAT_COUNT);
  });

  it('carries final stacks to the next hand starting stacks', () => {
    const s = runHandPassively(startSession(CFG), CFG);
    const n = nextHand(s, CFG);
    expect(n.game.seats.map(x => x.startingStack)).toEqual(s.stacks);
  });

  it('needs a hero rebuy only below one big blind', () => {
    expect(heroNeedsRebuy(sessionWithHeroStack(0))).toBe(true);
    expect(heroNeedsRebuy(sessionWithHeroStack(BIG_BLIND / 2))).toBe(true);
    expect(heroNeedsRebuy(sessionWithHeroStack(BIG_BLIND))).toBe(false);
    expect(heroNeedsRebuy(sessionWithHeroStack(15))).toBe(false);
  });

  it('rejects a next hand until an underfunded hero rebuys', () => {
    expect(() => nextHand(sessionWithHeroStack(0), CFG)).toThrow(/rebuy/);
  });

  it('rejects rebuy while a hand is still in progress', () => {
    const s = beginHand(CFG, 3, [0, 100, 100, 100, 100, 100], createLedger(), 500);
    expect(s.phase).not.toBe('handOver');
    expect(() => rebuyHero(s, 100)).toThrow(/handOver/);
  });

  it('records actual added chips when the hero rebuys to a target stack', () => {
    const s = sessionWithHeroStack(0.3);
    const r = rebuyHero(s, 100);
    expect(r.stacks[HERO_SEAT]).toBe(100);
    const last = r.ledger.buyIns[r.ledger.buyIns.length - 1];
    expect(last.amount).toBeCloseTo(99.7, 6);
    expect(last.handIndex).toBe(s.handIndex + 1);
  });

  it('does not change hero net profit and loss on rebuy', () => {
    const s = sessionWithHeroStack(0.3);
    const before = s.stacks[HERO_SEAT] - s.ledger.totalBuyIn;
    const r = rebuyHero(s, 200);
    const after = r.stacks[HERO_SEAT] - r.ledger.totalBuyIn;
    expect(after).toBeCloseTo(before, 6);
  });

  it('rejects targets outside the rebuy options', () => {
    const s = sessionWithHeroStack(0);
    expect(() => rebuyHero(s, 150)).toThrow();
    expect(() => rebuyHero(s, 0)).toThrow();
  });

  it('rejects rebuy when the hero has sufficient chips', () => {
    expect(() => rebuyHero(sessionWithHeroStack(50), 100)).toThrow();
  });

  it('automatically rebuys a bankrupt AI to an allowed target', () => {
    const stacks = [100, 0, 100, 100, 100, 100];
    const s: HandSessionState = {
      ...beginHand(CFG, 2, stacks, createLedger(), 500),
      phase: 'handOver',
      stacks,
    };
    const n = nextHand(s, CFG);
    expect(REBUY_OPTIONS).toContain(n.game.seats[1].startingStack);
    expect(n.totalTableBuyIn).toBeGreaterThan(s.totalTableBuyIn);
  });

  it('derives reproducible AI rebuy targets from seed and hand index', () => {
    const stacks = [100, 0, 100, 100, 100, 100];
    const make = (): HandSessionState => ({
      ...beginHand(CFG, 2, stacks, createLedger(), 500),
      phase: 'handOver',
      stacks,
    });
    expect(nextHand(make(), CFG).game.seats[1].startingStack).toBe(
      nextHand(make(), CFG).game.seats[1].startingStack,
    );
  });

  it('recognizes a hand as deep-stacked when any seat reaches 150 BB', () => {
    const stacks = [DEEP_STACK_BB, 100, 100, 100, 100, 100];
    const s = beginHand(CFG, 0, stacks, createLedger(), 650);
    expect(isDeepStackHand(s)).toBe(true);
  });
});

describe('AI 模式（设置页的「全 GTO」）', () => {
  it('cfg.aiMode 为 gto 时，桌上每个对手都是中性原型', () => {
    const s = startSession({ ...CFG, aiMode: 'gto' });
    for (const seat of s.game.seats) {
      expect(s.personaIds.get(seat.seat)).toBe(seat.seat === HERO_SEAT ? 'hero' : 'gto');
    }
  });

  it('缺省仍是原型池：同一个 seed 下两种模式分到的对手不同', () => {
    const pool = startSession(CFG);
    const gto = startSession({ ...CFG, aiMode: 'gto' });
    const ids = (x: typeof pool) =>
      x.game.seats.filter(s => s.seat !== HERO_SEAT).map(s => x.personaIds.get(s.seat));
    // 原型池随机分配理论上可能碰巧全中性，那样这条断言会误报——但 CFG 的
    // seed 是固定的，这里断言的是这个确定序列的实际结果，不是概率事件。
    expect(ids(pool)).not.toEqual(ids(gto));
  });

  it('切模式是下一手生效：nextHand 之后才换，本手打到一半不换对手', () => {
    let s = startSession(CFG);
    const before = new Map(s.personaIds);
    // 用带 gto 的 cfg 继续推进当前这一手——personaIds 不该被动过
    s = runToHeroOrEnd(s, { ...CFG, aiMode: 'gto' });
    expect([...s.personaIds]).toEqual([...before]);
  });
});
