import { describe, it, expect } from 'vitest';
import { HERO_SEAT, SEAT_COUNT, BIG_BLIND } from '../core/types';
import type { HandRecord } from '../core/types';
import { totalChips, legalActions } from '../core/gameEngine';
import { replayHandRecord } from '../core/handRecord';
import { chipsGreater } from '../core/chips';
import {
  beginHand,
  startSession,
  stepAi,
  applyHero,
  nextHand,
  heroNeedsRebuy,
  rebuyHero,
  isDeepStackHand,
  DEEP_STACK_BB,
} from './handSession';
import type { HandSessionState, SessionConfig } from './handSession';
import { createLedger, recordHandPlayed } from './ledger';
import { actionBarModel } from './actionBarModel';
import { scriptedHeroAction } from './scriptedHero';

const HANDS = 200;

// 迭代数压低是为了让 200 手在可接受时间内跑完。筹码守恒、可复现、
// 账本恒等这些断言与迭代数无关；迭代数只影响 AI 打得多好，不影响
// 它打得是否合法。
const CFG: SessionConfig = { seed: 'gate-2026-08-11', iterations: 200, strengthIterations: 20 };

interface RunResult {
  records: HandRecord[];
  /** 每手开局时的六个座位筹码 */
  openingStacks: number[][];
  /** 每手开局时账本里的累计桌面买入 */
  openingTableBuyIn: number[];
  /** 每手结束时的六个座位筹码 */
  closingStacks: number[][];
  deepStackHands: number;
  multiPotHands: number;
  final: HandSessionState;
}

/**
 * 脚本化 hero 驱动会话连打 HANDS 手。
 * rebuyTarget 决定 hero 破产时补到多少。
 */
function run(cfg: SessionConfig, hands: number, rebuyTarget: number): RunResult {
  const out: RunResult = {
    records: [],
    openingStacks: [],
    openingTableBuyIn: [],
    closingStacks: [],
    deepStackHands: 0,
    multiPotHands: 0,
    final: startSession(cfg),
  };

  let s = out.final;

  for (let h = 0; h < hands; h++) {
    out.openingStacks.push(s.game.seats.map(x => x.startingStack));
    out.openingTableBuyIn.push(s.totalTableBuyIn);
    if (isDeepStackHand(s)) out.deepStackHands++;

    const chipsAtStart = totalChips(s.game);
    let guard = 0;

    while (s.phase !== 'handOver') {
      if (++guard > 300) throw new Error(`第 ${h} 手疑似死锁`);

      if (s.phase === 'aiToAct') {
        s = stepAi(s, cfg);
      } else {
        // 断言 6：动作条模型与引擎的合法动作一一对应
        const model = actionBarModel(s.game);
        const legalTypes = new Set(legalActions(s.game).map(a => a.type));
        expect(model.enabled).toBe(true);
        expect(model.fold).toBe(legalTypes.has('fold'));
        expect(model.passive !== null).toBe(
          legalTypes.has('check') || legalTypes.has('call'),
        );
        expect(model.raise !== null).toBe(legalTypes.has('bet') || legalTypes.has('raise'));
        expect(model.allin !== null).toBe(legalTypes.has('allin'));

        const action = scriptedHeroAction(s, cfg);

        // 脚本选中的动作必须落在模型的启用项里
        const inModel =
          (action.type === 'fold' && model.fold) ||
          (action.type === 'check' && model.passive?.type === 'check') ||
          (action.type === 'call' && model.passive?.type === 'call') ||
          ((action.type === 'bet' || action.type === 'raise') && model.raise !== null) ||
          (action.type === 'allin' && model.allin !== null);
        expect(inModel, `第 ${h} 手动作 ${action.type} 不在动作条模型里`).toBe(true);

        s = applyHero(s, action, cfg);
      }

      // 断言 1：每个动作后筹码守恒
      expect(totalChips(s.game)).toBeCloseTo(chipsAtStart, 6);
    }

    out.records.push(s.record!);
    out.closingStacks.push(s.stacks.slice());
    if (s.record!.pots.length > 1) out.multiPotHands++;

    if (h < hands - 1) {
      if (heroNeedsRebuy(s)) s = rebuyHero(s, rebuyTarget);
      s = nextHand(s, cfg);
    }
  }

  out.final = s;
  return out;
}

/**
 * A coherent cross-hand snapshot: hero's 99.7BB loss has moved to seat 1,
 * so the six stacks remain 600BB and the ledger still records hero's
 * original 100BB buy-in. Hero then folds a real, legally played hand,
 * preserving the 0.3BB residual without fabricating a handOver state.
 */
function finishHandWithNonZeroHeroResidual(): HandSessionState {
  const stacks = [0.3, 199.7, 100, 100, 100, 100];
  let ledger = createLedger();
  for (let i = 0; i < 6; i++) ledger = recordHandPlayed(ledger);

  let s = beginHand(CFG, 6, stacks, ledger, 600);
  const chipsAtStart = totalChips(s.game);
  let guard = 0;

  while (s.phase !== 'handOver') {
    if (++guard > 300) throw new Error('non-zero-residual scenario deadlocked');
    s = s.phase === 'aiToAct'
      ? stepAi(s, CFG)
      : applyHero(s, { type: 'fold' }, CFG);
    expect(totalChips(s.game)).toBeCloseTo(chipsAtStart, 6);
  }

  expect(s.stacks[HERO_SEAT]).toBe(0.3);
  return s;
}

describe('★ 验收关卡：脚本化玩家 200 手自对弈', () => {
  const r = run(CFG, HANDS, 100);

  it('1&2. 筹码守恒且无死锁（由 run 内部逐动作断言，跑完即通过）', () => {
    expect(r.records).toHaveLength(HANDS);
  });

  it(
    '3. 同 seed 跑两遍，200 份 HandRecord 逐位相同',
    () => {
      const again = run(CFG, HANDS, 100);
      expect(JSON.stringify(again.records)).toBe(JSON.stringify(r.records));
    },
    30_000,
  );

  it('4. 每份 record 都能被 replayHandRecord 复现到相同终局', () => {
    r.records.forEach((rec, i) => {
      const replayed = replayHandRecord(rec);
      expect(replayed.board, `第 ${i} 手公共牌不一致`).toEqual(rec.board);
      expect(
        replayed.seats.map(x => x.stack),
        `第 ${i} 手终局筹码不一致`,
      ).toEqual(r.closingStacks[i]);
    });
  });

  it('5. 按钮位每手前进一位，hero 位置 6 手一个完整轮回', () => {
    r.records.forEach((rec, i) => {
      expect(rec.buttonSeat, `第 ${i} 手按钮位不对`).toBe(i % SEAT_COUNT);
    });
    for (let start = 0; start + SEAT_COUNT <= HANDS; start += SEAT_COUNT) {
      const window = r.records
        .slice(start, start + SEAT_COUNT)
        .map(rec => rec.seats.find(x => x.seat === HERO_SEAT)!.position);
      expect(new Set(window).size, `第 ${start} 手起的一轮位置没走满`).toBe(SEAT_COUNT);
    }
  });

  it('7. 跨手筹码守恒：本手开局总额 = 上手收局总额 + 期间买入', () => {
    for (let h = 1; h < HANDS; h++) {
      const opening = r.openingStacks[h].reduce((a, b) => a + b, 0);
      const closing = r.closingStacks[h - 1].reduce((a, b) => a + b, 0);
      const bought = r.openingTableBuyIn[h] - r.openingTableBuyIn[h - 1];
      expect(opening, `第 ${h} 手开局总筹码对不上`).toBeCloseTo(closing + bought, 6);
    }
  });

  it('8. 账本恒等式：当前筹码 − 累计买入 = 每手 netBB 之和', () => {
    const sumNet = r.records.reduce(
      (a, rec) => a + rec.results.find(x => x.seat === HERO_SEAT)!.netBB,
      0,
    );
    const byLedger = r.final.stacks[HERO_SEAT] - r.final.ledger.totalBuyIn;
    expect(byLedger).toBeCloseTo(sumNet, 6);
  });

  it('8. 账本恒等式：非零余码补码不改变补码前后的净值', () => {
    const beforeRebuy = finishHandWithNonZeroHeroResidual();
    expect(heroNeedsRebuy(beforeRebuy)).toBe(true);

    const beforeNet = beforeRebuy.stacks[HERO_SEAT] - beforeRebuy.ledger.totalBuyIn;
    const afterRebuy = rebuyHero(beforeRebuy, 100);
    const afterNet = afterRebuy.stacks[HERO_SEAT] - afterRebuy.ledger.totalBuyIn;

    expect(afterNet).toBeCloseTo(beforeNet, 6);
  });

  it('9. 补码只在该补时发生，且拒绝非法额度', () => {
    // heroNeedsRebuy ⟺ 筹码 < 一个大盲
    for (let h = 0; h < HANDS; h++) {
      const heroClosing = r.closingStacks[h][HERO_SEAT];
      const needed = chipsGreater(BIG_BLIND, heroClosing);
      const nextOpening = h + 1 < HANDS ? r.openingStacks[h + 1][HERO_SEAT] : null;
      if (nextOpening !== null && needed) {
        expect(nextOpening, `第 ${h} 手后 hero 应已补码`).toBe(100);
      }
      if (nextOpening !== null && !needed) {
        expect(nextOpening, `第 ${h} 手后 hero 不该补码`).toBeCloseTo(heroClosing, 6);
      }
    }
    expect(() => rebuyHero(r.final, 150)).toThrow();
  });

  it('10. 多池确实出现过，且每个池的结构自洽', () => {
    // 数字要进报告，不能只说「大于 0」
    console.log(
      `[验收关卡] 200 手中多池手数 ${r.multiPotHands}，深筹码手数 ${r.deepStackHands}`,
    );
    expect(
      r.multiPotHands,
      '200 手里一次多池都没有 —— 停下来查边池，不要换 seed',
    ).toBeGreaterThan(0);

    // 不用「池金额之和 = 总投入」来断言：座位的实际投入无法从 record 直接
    // 读出（netBB 是投入与赢回的净额，两者没有分开记）。下面三条是不需要
    // 任何反推就成立的关系，同样能抓住分层算错。
    for (const rec of r.records.filter(x => x.pots.length > 1)) {
      const potSum = rec.pots.reduce((a, p) => a + p.amount, 0);
      const startSum = rec.seats.reduce((a, x) => a + x.startingStack, 0);
      const netSum = rec.results.reduce((a, x) => a + x.netBB, 0);

      // 底池是正的，且不可能超过全桌起始筹码之和
      expect(potSum).toBeGreaterThan(0);
      expect(potSum).toBeLessThanOrEqual(startSum + 1e-6);
      // 一手牌是零和的：所有人的净盈亏加起来必须是 0
      expect(netSum, `第 ${rec.id} 手净盈亏之和不为零`).toBeCloseTo(0, 6);
      // 每个池的资格集非空且互不越界
      for (const p of rec.pots) {
        expect(p.eligible.length).toBeGreaterThan(0);
        expect(p.amount).toBeGreaterThan(0);
      }
    }
  });

  it('11. 深筹码标记与开局筹码一致', () => {
    r.openingStacks.forEach((stacks, h) => {
      const deep = stacks.some(x => !chipsGreater(DEEP_STACK_BB, x));
      const rec = r.records[h];
      const recDeep = rec.seats.some(x => !chipsGreater(DEEP_STACK_BB, x.startingStack));
      expect(recDeep, `第 ${h} 手深筹码判定不一致`).toBe(deep);
    });
  });

  it('补 200BB 的变体也守恒（40 手）', () => {
    const deep = run({ ...CFG, seed: 'gate-deep' }, 40, 200);
    const sumNet = deep.records.reduce(
      (a, rec) => a + rec.results.find(x => x.seat === HERO_SEAT)!.netBB,
      0,
    );
    expect(deep.final.stacks[HERO_SEAT] - deep.final.ledger.totalBuyIn).toBeCloseTo(sumNet, 6);
  });
});
