import { afterEach, describe, it, expect, vi } from 'vitest';
import { totalChips } from '../core/gameEngine';
import { SEAT_COUNT, STARTING_STACK } from '../core/types';
import { cardToString } from '../core/cards';
import { warmPreflopStrength } from '../core/rangeStrength';
import { playAiHand } from './selfPlayAi';
import * as equityModule from '../core/equity';
import * as opponentRangeModule from '../core/opponentRange';
import { rangeFraction } from '../core/rangeSet';
import type { RangeSet } from '../core/rangeSet';

// 项目的 tsconfig 只声明了 ES2022 lib，不含 DOM/Node，因此没有 console 的
// 环境类型。测试实际跑在 vitest 的 node 环境里，console 运行时确实存在，
// 只是缺类型——用一个局部 ambient 声明补上，不改动 tsconfig 或 src/core。
declare const console: { log: (...args: unknown[]) => void };

/**
 * Vitest 3 has a 60s worker RPC deadline. These synchronous, CPU-bound
 * self-play tests can exceed that deadline as a file while preventing the
 * worker from servicing queued RPC responses. Yield one macrotask between
 * tests so the worker can flush those responses without changing any hand,
 * iteration, assertion, or timeout in the workload itself.
 */
afterEach(async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
});

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
    // 旧断言只要求 streets.size > 1，只能挡住「全部手牌都在同一条街结束」这种
    // 彻底退化；比如 59 手都翻前结束、1 手拖到河牌，size 是 2 照样通过，测不出
    // 「翻前收得太快」或「几乎从不翻前结束」这类真实的比例失衡。改成分别统计
    // 翻前结束与翻后（flop/turn/river 任一）结束的手数，各自要求一个最小值。
    //
    // 实测（60 手，种子 ai-var-0..59）：{"preflop":29,"river":21,"turn":3,"flop":7}，
    // 即翻前 29 手、翻后合计 31 手。门槛取 10，相对两边的实测值都留了两倍以上
    // 的余量，既不会因为实现细节的小改动就变脆，也确实排除了「几乎不翻前结束」
    // 或「几乎不打到翻后」这两种真实的失衡。
    warmPreflopStrength();
    let preflopEnds = 0;
    let postflopEnds = 0;
    for (let i = 0; i < 60; i++) {
      const { state } = playAiHand(`ai-var-${i}`, i % SEAT_COUNT, { iterations: 150, strengthIterations: 15 });
      if (state.street === 'preflop') preflopEnds++;
      else postflopEnds++;
    }
    // eslint-disable-next-line no-console
    console.log(`\n=== street distribution over 60 hands ===\npreflop=${preflopEnds} postflop(flop/turn/river)=${postflopEnds}\n`);
    expect(preflopEnds).toBeGreaterThanOrEqual(10);
    expect(postflopEnds).toBeGreaterThanOrEqual(10);
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

/**
 * 额外交付物（不在 brief 里）：统计各性格原型在 200 手真实自对弈里的实际
 * 表现——翻前面对下注时的弃牌率、翻前主动投入率、进攻动作占比。
 *
 * 这些数据完全从 playAiHand 已经返回的 HandRecord 里推导（record.seats[].personaId
 * 关联座位，record.actions[].street/type/toCall 提供每个决策的上下文），不需要
 * 改动 decide.ts / selfPlayAi.ts 或扩展 AiHandResult。
 *
 * 只报告，不断言好坏——具体数字由人工判断性格参数是否需要重新调校。
 */
describe('性格行为统计（仅报告，不断言）', () => {
  it('汇总 200 手里每种性格的翻前行为', () => {
    warmPreflopStrength();

    interface PersonaStat {
      handsDealt: number;
      vpipHands: number;
      foldToBetOpportunities: number;
      foldToBetFolds: number;
      totalActions: number;
      aggressiveActions: number;
    }
    const AGGRESSIVE = new Set(['bet', 'raise', 'allin']);
    const VOLUNTARY = new Set(['call', 'bet', 'raise', 'allin']);

    const stats = new Map<string, PersonaStat>();
    const statFor = (id: string): PersonaStat => {
      let s = stats.get(id);
      if (!s) {
        s = {
          handsDealt: 0,
          vpipHands: 0,
          foldToBetOpportunities: 0,
          foldToBetFolds: 0,
          totalActions: 0,
          aggressiveActions: 0,
        };
        stats.set(id, s);
      }
      return s;
    };

    for (let i = 0; i < 200; i++) {
      const seed = `ai-stats-${i}`;
      const { record } = playAiHand(seed, i % SEAT_COUNT, { iterations: 200, strengthIterations: 20 });

      const seatPersona = new Map<number, string>();
      for (const s of record.seats) {
        seatPersona.set(s.seat, s.personaId);
        statFor(s.personaId).handsDealt++;
      }

      const vpipSeenThisHand = new Set<number>();
      for (const a of record.actions) {
        const pid = seatPersona.get(a.seat)!;
        const st = statFor(pid);
        st.totalActions++;
        if (AGGRESSIVE.has(a.type)) st.aggressiveActions++;

        if (a.street === 'preflop') {
          if (a.toCall > 0) {
            st.foldToBetOpportunities++;
            if (a.type === 'fold') st.foldToBetFolds++;
          }
          if (VOLUNTARY.has(a.type) && !vpipSeenThisHand.has(a.seat)) {
            vpipSeenThisHand.add(a.seat);
            st.vpipHands++;
          }
        }
      }
    }

    const header = 'persona\thandsDealt\tvpip(hands)\tfoldPreflopFacingBet(decisions)\taggressiveActions(all actions)';
    const rows = [...stats.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, s]) =>
        `${id}\t${s.handsDealt}\t${s.vpipHands}/${s.handsDealt}\t${s.foldToBetFolds}/${s.foldToBetOpportunities}\t${s.aggressiveActions}/${s.totalActions}`,
      );
    // eslint-disable-next-line no-console
    console.log(`\n=== persona behaviour stats over 200 hands ===\n${header}\n${rows.join('\n')}\n`);

    expect(stats.size).toBeGreaterThan(0);
  }, 300_000);
});

/**
 * 额外交付物（不在 brief 里）：证明「betSize 传引擎真实投入额」这个修复
 * 真的把自对弈推进到了这个分支存在的理由——preflop all-in 应该能把范围
 * 塌缩到 narrowByAction 的 InfeasibleSamplingError 兜底路径，而不是像
 * betSize 恒为 0 那样从未被触碰过。
 *
 * 用 vi.spyOn 包一层 pass-through（不替换实现，只旁观调用与返回/抛出），
 * 这与文件里 evEstimate.test.ts 对 rankRange 的做法是同一手法：
 *   - equityVsRanges：统计有多少次调用以 InfeasibleSamplingError 结束——
 *     这些正是 estimateEv 捕获后宽范围重试的那些。
 *   - narrowByAction：对每次返回的范围取 rangeFraction，记录整轮跑下来
 *     观测到的最窄值。
 *
 * 只报告，不断言具体数字——是否「宽范围兜底确实被触发了」以及触发的
 * 量级，需要人工判断，不是这个测试该替开发者下的结论。
 */
describe('narrowByAction 收窄是否真的触及塌缩分支（仅报告，不断言）', () => {
  it('200 手自对弈里 InfeasibleSamplingError 触发次数与观测到的最窄对手范围', () => {
    warmPreflopStrength();

    const equitySpy = vi.spyOn(equityModule, 'equityVsRanges');
    const narrowSpy = vi.spyOn(opponentRangeModule, 'narrowByAction');

    for (let i = 0; i < 200; i++) {
      const seed = `ai-narrow-${i}`;
      playAiHand(seed, i % SEAT_COUNT, { iterations: 200, strengthIterations: 20 });
    }

    let infeasibleCount = 0;
    for (const r of equitySpy.mock.results) {
      if (r.type === 'throw' && r.value instanceof equityModule.InfeasibleSamplingError) {
        infeasibleCount++;
      }
    }

    // fold 恒定收窄到空范围（narrowByAction 对 'fold' 直接 return new Map()，
    // 见 opponentRange.ts）——那不是这条 brief 关心的「塌缩」，只是弃牌者退出
    // 牌局的记账副作用。只在非 fold 的动作（call/bet/raise/allin/check）里找
    // 观测到的最窄范围，才是能反映 betSize 收窄力度的数字。
    let narrowestFraction = 1;
    let narrowestActionType = '(none)';
    let allinNarrowest = 1;
    for (let i = 0; i < narrowSpy.mock.calls.length; i++) {
      const r = narrowSpy.mock.results[i];
      if (r.type !== 'return') continue;
      const actionType = narrowSpy.mock.calls[i][1] as string;
      if (actionType === 'fold') continue;
      const frac = rangeFraction(r.value as RangeSet);
      if (frac < narrowestFraction) {
        narrowestFraction = frac;
        narrowestActionType = actionType;
      }
      if (actionType === 'allin' && frac < allinNarrowest) allinNarrowest = frac;
    }

    // 读完 .mock.calls / .mock.results 之后才能 restore ——
    // mockRestore() 不只是换回原始实现，还会顺带 mockReset()，
    // 把调用历史清空；先读数据再 restore，否则下面打印的调用数恒为 0。
    const equityCallCount = equitySpy.mock.calls.length;
    const narrowCallCount = narrowSpy.mock.calls.length;
    equitySpy.mockRestore();
    narrowSpy.mockRestore();

    // eslint-disable-next-line no-console
    console.log(
      `\n=== narrowing gate over 200 hands ===\n` +
      `equityVsRanges 调用总数: ${equityCallCount}\n` +
      `InfeasibleSamplingError 触发（宽范围兜底）次数: ${infeasibleCount}\n` +
      `narrowByAction 调用总数: ${narrowCallCount}\n` +
      `观测到的最窄对手范围占比（不含 fold）: ${(narrowestFraction * 100).toFixed(4)}%，来自动作类型 ${narrowestActionType}\n` +
      `观测到的最窄 all-in 后范围占比: ${(allinNarrowest * 100).toFixed(4)}%\n`,
    );

    expect(narrowCallCount).toBeGreaterThan(0);
  }, 300_000);
});
