import { describe, it, expect } from 'vitest';
import { playRandomHand } from './selfPlay';
import { totalChips } from './gameEngine';
import { createRng } from './rng';
import { SEAT_COUNT, STARTING_STACK } from './types';
import { cardToString } from './cards';

const CHIPS = SEAT_COUNT * STARTING_STACK;

/** 从 seed 派生一组可复现、跨度约 20~150BB 的起始筹码 */
function variedStartingStacks(seed: string): number[] {
  const rng = createRng(`${seed}-stacks`);
  return Array.from({ length: SEAT_COUNT }, () => Math.round(20 + rng.nextFloat() * 130));
}

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
      if (Math.abs(totalChips(state) - CHIPS) > 1e-9) {
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
  it('两千手中翻前结束与打到河牌的都有', () => {
    const streets = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const { state } = playRandomHand(`variety-${i}`, i % SEAT_COUNT);
      streets.add(state.street);
    }
    expect(streets.has('preflop')).toBe(true);
    expect(streets.has('river')).toBe(true);
  });
});

describe('可变筹码深度自对弈（触达边池分层代码）', () => {
  it('数千手中筹码守恒、无死锁、结果自洽，且确实出现资格集不同的多池手', () => {
    const HANDS = 3000;
    let multiPotHands = 0;
    let maxPots = 1;

    for (let i = 0; i < HANDS; i++) {
      const seed = `varied-${i}`;
      const buttonSeat = i % SEAT_COUNT;
      const startingStacks = variedStartingStacks(seed);
      const expectedChips = startingStacks.reduce((a, b) => a + b, 0);

      const { state, record } = playRandomHand(seed, buttonSeat, startingStacks);

      // 本手必须正常结束
      expect(state.handOver).toBe(true);
      expect(state.results).not.toBeNull();

      // 筹码守恒：总量必须等于本手实际传入的各座位起始筹码之和，
      // 而不是固定的 600（这正是不同筹码深度该有的守恒基准）
      if (Math.abs(totalChips(state) - expectedChips) > 1e-9) {
        throw new Error(`seed=${seed} 筹码不守恒：${totalChips(state)} != ${expectedChips}`);
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

      // HandRecord.startingStack 必须如实等于本手实际传入的起始筹码，
      // 不是写死的常量
      for (const seat of record.seats) {
        if (seat.startingStack !== startingStacks[seat.seat]) {
          throw new Error(
            `seed=${seed} 座位 ${seat.seat} 记录起始筹码 ${seat.startingStack} != 实际传入 ${startingStacks[seat.seat]}`,
          );
        }
      }

      // record.pots 是 settleHand 结算时算出的权威分池结果（GameState.pots /
      // HandRecord.pots），不是从 actions 反推的。pots.length >= 2 就意味着
      // 至少两个池的资格集不同（buildPots 会把资格集相同的相邻层合并），
      // 这就是分池分层代码被真正走到、而不是像固定 100BB 时那样永远合并
      // 成一个主池的证明。
      if (record.pots.length > maxPots) maxPots = record.pots.length;
      if (record.pots.length >= 2) multiPotHands++;
    }

    // 用真实筹码深度差异跑 3000 手，正确统计下约 90% 会产生多个池；
    // 定一个远高于 0 的门槛，回归到「固定筹码=结构上不可能多池」的行为
    // （见下面的对照用例）会让这里报 0，从而让测试失败。
    expect(multiPotHands).toBeGreaterThan(1000);
  }, 300_000);
});

describe('默认固定筹码自对弈（结构上不可能出现多个池）', () => {
  it('几百手默认 100BB 平筹局，每一手都只有一个池', () => {
    const HANDS = 300;
    for (let i = 0; i < HANDS; i++) {
      const seed = `fixed-stacks-pots-${i}`;
      const buttonSeat = i % SEAT_COUNT;
      const { record } = playRandomHand(seed, buttonSeat);
      if (record.pots.length !== 1) {
        throw new Error(
          `seed=${seed} 默认固定筹码局却产生了 ${record.pots.length} 个池，这不应该发生`,
        );
      }
    }
  }, 60_000);
});
