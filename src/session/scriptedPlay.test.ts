import { describe, it, expect } from 'vitest';
import { HERO_SEAT, SEAT_COUNT, BIG_BLIND } from '../core/types';
import type { HandRecord } from '../core/types';
import { totalChips, legalActions } from '../core/gameEngine';
import { replayHandRecord } from '../core/handRecord';
import { chipsGreater, isZeroChips, round2 } from '../core/chips';
import {
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
  /** 断言 6（动作条模型对照）实际执行过的 hero 行动次数 */
  heroActionCount: number;
  /** 断言 6 补充（raise 金额 min/max/presets dry run）实际执行过的次数 */
  raiseAmountChecks: number;
  final: HandSessionState;
}

function sameChips(actual: number, expected: number): boolean {
  return isZeroChips(round2(actual - expected));
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
    heroActionCount: 0,
    raiseAmountChecks: 0,
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
        out.heroActionCount++;
        const model = actionBarModel(s.game);
        const legalTypes = new Set(legalActions(s.game).map(a => a.type));
        expect(model.enabled).toBe(true);
        expect(model.fold).toBe(legalTypes.has('fold'));
        expect(model.passive !== null).toBe(
          legalTypes.has('check') || legalTypes.has('call'),
        );
        expect(model.raise !== null).toBe(legalTypes.has('bet') || legalTypes.has('raise'));
        expect(model.allin !== null).toBe(legalTypes.has('allin'));

        // 断言 6 补充：UI 真正提交的是 model.raise 里的金额（min/max/预设档），
        // 不是动作类型。这里把这些金额真的走一遍 applyHero，而不只是确认
        // 「raise 类型可用」。用 s（当前状态，此时还未被脚本的真实动作推进）
        // 起一次性 dry run：applyHero/advance 都是纯函数，不会修改传入的
        // state，也不会影响下面 s = applyHero(s, action, cfg) 的主轨迹。
        if (model.raise) {
          const { type: raiseType, min, max, presets } = model.raise;
          const amounts = [min, max, ...presets.map(p => p.amount)];
          for (const amount of amounts) {
            expect(
              () => applyHero(s, { type: raiseType, amount }, cfg),
              `第 ${h} 手 ${raiseType} 金额 ${amount}（min=${min}, max=${max}）应能被 applyHero 接受`,
            ).not.toThrow();
          }
          const maxResult = applyHero(s, { type: raiseType, amount: max }, cfg);
          expect(
            maxResult.game.seats[HERO_SEAT].allIn,
            `第 ${h} 手拉满 raise.max=${max} 后 hero 座位应标记为 allIn`,
          ).toBe(true);
          out.raiseAmountChecks++;
        }

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
      expect(
        sameChips(totalChips(s.game), chipsAtStart),
        `第 ${h} 手筹码不守恒：当前 ${totalChips(s.game)}，开局 ${chipsAtStart}`,
      ).toBe(true);
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
 * Drive a production-reachable session until the first underfunded hero
 * hand ends. All transitions use the real API in its required order:
 * startSession -> action(s) -> handOver -> rebuyHero (without nextHand).
 */
function finishHandWithNonZeroHeroResidual(): HandSessionState {
  let s = startSession(CFG);

  for (let h = 0; h < 500; h++) {
    const chipsAtStart = totalChips(s.game);
    let guard = 0;

    while (s.phase !== 'handOver') {
      if (++guard > 300) throw new Error('non-zero-residual scenario deadlocked');
      if (s.phase === 'aiToAct') {
        s = stepAi(s, CFG);
      } else {
        const legal = legalActions(s.game);
        const raise = legal.find(x => x.type === 'raise' || x.type === 'bet');
        const amount = raise ? round2(raise.max - 0.3) : 0;
        const action = raise
          && (chipsGreater(amount, raise.min) || sameChips(amount, raise.min))
          ? { type: raise.type, amount }
          : (() => {
            const passive = legal.find(x => x.type === 'check') ?? legal.find(x => x.type === 'fold');
            return passive ? { type: passive.type } : undefined;
          })();
        if (!action) throw new Error('hero has no legal passive action');
        s = applyHero(s, action, CFG);
      }
      expect(
        sameChips(totalChips(s.game), chipsAtStart),
        `第 ${h} 手筹码不守恒：当前 ${totalChips(s.game)}，开局 ${chipsAtStart}`,
      ).toBe(true);
    }

    if (heroNeedsRebuy(s)) return s;
    s = nextHand(s, CFG);
  }

  throw new Error('no underfunded hero hand reached');
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
      // 长度守卫：若 replay 返回的座位数不对，下面按下标逐一比较会漏检
      // （更少座位意味着更少甚至零次比较却仍然「通过」）。
      expect(replayed.seats, `第 ${i} 手 replay 座位数不对`).toHaveLength(SEAT_COUNT);
      r.closingStacks[i].forEach((expectedStack, seatIndex) => {
        const actualStack = replayed.seats[seatIndex]?.stack;
        expect(
          typeof actualStack === 'number' && sameChips(actualStack, expectedStack),
          `第 ${i} 手 seat ${seatIndex} 终局筹码不一致：期望 ${expectedStack}，实际 ${actualStack}`,
        ).toBe(true);
      });
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

  it('6. 动作条模型对照（断言 6）在 200 手里确实执行过', () => {
    expect(
      r.heroActionCount,
      '200 手里 hero 一次都没有轮到行动 —— 断言 6 是空转的',
    ).toBeGreaterThan(0);
    expect(
      r.raiseAmountChecks,
      '200 手里 model.raise 一次都没有为真 —— raise 金额 dry run 是空转的',
    ).toBeGreaterThan(0);
  });

  it('7. 跨手筹码守恒：本手开局总额 = 上手收局总额 + 期间买入', () => {
    for (let h = 1; h < HANDS; h++) {
      const opening = r.openingStacks[h].reduce((a, b) => a + b, 0);
      const closing = r.closingStacks[h - 1].reduce((a, b) => a + b, 0);
      const bought = r.openingTableBuyIn[h] - r.openingTableBuyIn[h - 1];
      expect(sameChips(opening, closing + bought), `第 ${h} 手开局总筹码对不上`).toBe(true);
    }
  });

  it('8a. 账本恒等式：当前筹码 − 累计买入 = 每手 netBB 之和', () => {
    const sumNet = r.records.reduce(
      (a, rec) => a + rec.results.find(x => x.seat === HERO_SEAT)!.netBB,
      0,
    );
    const byLedger = r.final.stacks[HERO_SEAT] - r.final.ledger.totalBuyIn;
    expect(
      sameChips(byLedger, sumNet),
      `账本净值 ${byLedger} 与逐手 netBB 之和 ${sumNet} 不一致`,
    ).toBe(true);
  });

  it('8b. 账本恒等式：非零余码补码不改变补码前后的净值', () => {
    const beforeRebuy = finishHandWithNonZeroHeroResidual();
    expect(heroNeedsRebuy(beforeRebuy)).toBe(true);
    expect(isZeroChips(beforeRebuy.stacks[HERO_SEAT])).toBe(false);

    const beforeNet = beforeRebuy.stacks[HERO_SEAT] - beforeRebuy.ledger.totalBuyIn;
    const afterRebuy = rebuyHero(beforeRebuy, 100);
    const afterNet = afterRebuy.stacks[HERO_SEAT] - afterRebuy.ledger.totalBuyIn;

    expect(
      sameChips(afterNet, beforeNet),
      `补码前净值 ${beforeNet}，补码后净值 ${afterNet}，二者应相等`,
    ).toBe(true);
  });

  it('9. 补码只在该补时发生，且拒绝非法额度', () => {
    // heroNeedsRebuy ⟺ 筹码 < 一个大盲
    for (let h = 0; h < HANDS; h++) {
      const heroClosing = r.closingStacks[h][HERO_SEAT];
      const needed = chipsGreater(BIG_BLIND, heroClosing);
      const nextOpening = h + 1 < HANDS ? r.openingStacks[h + 1][HERO_SEAT] : null;
      if (nextOpening !== null && needed) {
        expect(sameChips(nextOpening, 100), `第 ${h} 手后 hero 应已补码`).toBe(true);
      }
      if (nextOpening !== null && !needed) {
        expect(sameChips(nextOpening, heroClosing), `第 ${h} 手后 hero 不该补码`).toBe(true);
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
      expect(chipsGreater(potSum, 0)).toBe(true);
      expect(chipsGreater(potSum, startSum)).toBe(false);
      // 一手牌是零和的：所有人的净盈亏加起来必须是 0
      expect(isZeroChips(round2(netSum)), `第 ${rec.id} 手净盈亏之和不为零`).toBe(true);
      // 每个池的资格集非空且互不越界
      for (const p of rec.pots) {
        expect(p.eligible.length).toBeGreaterThan(0);
        expect(chipsGreater(p.amount, 0), `第 ${rec.id} 手池金额 ${p.amount} 应为正`).toBe(true);
      }
    }
  });

  it('11. 深筹码标记与开局筹码一致', () => {
    // record 一致性：两份视图（openingStacks vs record.seats）都来自同一次
    // beginHand 输出，理应逐手一致——这条验的是「记录复制正确」。
    r.openingStacks.forEach((stacks, h) => {
      const deep = stacks.some(x => !chipsGreater(DEEP_STACK_BB, x));
      const rec = r.records[h];
      const recDeep = rec.seats.some(x => !chipsGreater(DEEP_STACK_BB, x.startingStack));
      expect(recDeep, `第 ${h} 手深筹码判定不一致`).toBe(deep);
    });

    // 用独立重算的计数对上 out.deepStackHands（它在 run() 里累加自真实的
    // isDeepStackHand 调用，此前唯一消费者是 console.log，没有任何断言检查
    // 过）。重算谓词和 isDeepStackHand 内部逻辑同形，跑在同一份 openingStacks
    // 快照上，能抓常量返回、阈值错、> vs >=、every vs some、座位集错这些
    // 具体实现缺陷；但两边是同一处逻辑分别抄出来的两份代码，抓不到「测试
    // 自己的谓词与生产错得一样」这种双方共享的系统性错误。
    const recomputedDeepStackHands = r.openingStacks.filter(stacks =>
      stacks.some(x => !chipsGreater(DEEP_STACK_BB, x)),
    ).length;
    expect(
      recomputedDeepStackHands,
      `重算的深筹码手数 ${recomputedDeepStackHands} 与 isDeepStackHand 累加的 ${r.deepStackHands} 不一致`,
    ).toBe(r.deepStackHands);
    expect(
      r.deepStackHands,
      '200 手里一次深筹码都没有出现 —— 停下来查 isDeepStackHand，不要换 seed',
    ).toBeGreaterThan(0);
  });

  // 显式超时，不吃 vitest 默认的 5 秒：这条跑 40 手 200BB 深筹码自对弈，
  // 筹码越深每手要过的决策点越多，是本文件里最重的一条。它的耗时正好压在
  // 5 秒线上，**同一份代码在同一台机器上会因为并行负载不同而忽红忽绿**——
  // 实测单独跑通过、与其余 63 个测试文件并行时超时。断言本身（筹码守恒）
  // 从来没有失败过，红的只是时间。
  //
  // 30 秒对着的是"这条要是真死循环了要多久发现"，不是"它该跑多快"；性能
  // 回归由 selfPlayAi.test.ts 的决策耗时用例负责盯，不靠这里的超时兜底。
  // 同一个理由已经写在上面第 3 条（同 seed 跑两遍）上，那条一直有显式超时。
  it('补 200BB 的变体也守恒（40 手）', () => {
    const deep = run({ ...CFG, seed: 'gate-deep' }, 40, 200);
    const sumNet = deep.records.reduce(
      (a, rec) => a + rec.results.find(x => x.seat === HERO_SEAT)!.netBB,
      0,
    );
    expect(sameChips(deep.final.stacks[HERO_SEAT] - deep.final.ledger.totalBuyIn, sumNet)).toBe(true);
  }, 30_000);
});
