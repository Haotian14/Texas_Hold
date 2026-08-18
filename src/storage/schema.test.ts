import { describe, it, expect } from 'vitest';
import {
  DB_NAME,
  DB_VERSION,
  HANDS_STORE,
  STATS_STORE,
  STORES,
  storedHandOf,
  heroPositionOf,
} from './schema';
import { startHand, applyAction, settleHand, legalActions } from '../core/gameEngine';
import { toHandRecord } from '../core/handRecord';
import { HERO_SEAT } from '../core/types';
import type { HandRecord } from '../core/types';
import { analyzeHand } from '../review/analyzeHand';
import { viewOf } from '../review/view';

function makeRecord(seed: string): HandRecord {
  let s = startHand({ seed, buttonSeat: 3 });
  let n = 0;
  while (!s.handOver && n++ < 40) {
    if (s.toAct === HERO_SEAT) {
      s = applyAction(s, s.street === 'preflop' ? { type: 'raise', amount: 3 } : { type: 'check' });
    } else if (s.street === 'preflop' && s.toAct === 2) {
      s = applyAction(s, { type: 'call' });
    } else {
      const canFold = legalActions(s).some(a => a.type === 'fold');
      s = applyAction(s, canFold ? { type: 'fold' } : { type: 'check' });
    }
  }
  return toHandRecord(settleHand(s), {
    id: seed,
    heroSeat: HERO_SEAT,
    personaIds: {},
    timestamp: 1700000000000,
  });
}

const OPTS = { iterations: 200, strengthIterations: 15 };

describe('schema 定义', () => {
  it('库名与版本就是规格 §9 写的那个', () => {
    expect(DB_NAME).toBe('poker-trainer');
    expect(DB_VERSION).toBe(1);
  });

  it('两个 store，主键与规格一致', () => {
    expect(STORES.map(s => s.name)).toEqual([HANDS_STORE, STATS_STORE]);
    const hands = STORES.find(s => s.name === HANDS_STORE)!;
    expect(hands.keyPath).toBe('id');
  });

  it('hands 上的四个索引一个不少，mistakeTags 是 multiEntry', () => {
    const hands = STORES.find(s => s.name === HANDS_STORE)!;
    expect(hands.indexes.map(i => i.name).sort()).toEqual(
      ['heroPosition', 'mistakeTags', 'timestamp', 'worstEvLoss'].sort(),
    );
    expect(hands.indexes.find(i => i.name === 'mistakeTags')!.multiEntry).toBe(true);
  });

  it('每个索引的 keyPath 都指向顶层字段，不带点号', () => {
    // 点号路径（record.timestamp / view.worstEvLoss）会让 view 为 null 的那些手
    // 在索引里整个消失——见 schema.ts 上的注释。这条测试守的就是那件事。
    let checked = 0;
    for (const store of STORES) {
      for (const idx of store.indexes) {
        expect(idx.keyPath, `${store.name}.${idx.name}`).not.toContain('.');
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('索引名与它索引的字段同名 —— 两者漂移会让查询静默取不到东西', () => {
    for (const store of STORES) {
      for (const idx of store.indexes) {
        expect(idx.keyPath, idx.name).toBe(idx.name);
      }
    }
  });
});

describe('storedHandOf', () => {
  it('索引字段全部从 record / view 里抽出来，取值对得上', () => {
    const rec = makeRecord('st-1');
    const view = viewOf(analyzeHand(rec, OPTS));
    const stored = storedHandOf(rec, view);

    expect(stored.id).toBe(rec.id);
    expect(stored.timestamp).toBe(rec.timestamp);
    expect(stored.worstEvLoss).toBe(view.worstEvLoss);
    expect(stored.heroPosition).toBe(heroPositionOf(rec));
    expect(stored.mistakeTags).toEqual(view.tags);
    expect(stored.disputed).toBe(false);
    expect(stored.record).toBe(rec);
    expect(stored.view).toBe(view);
  });

  it('分析失败（view 为 null）的那一手仍然入库，索引字段退化为空值', () => {
    const rec = makeRecord('st-2');
    const stored = storedHandOf(rec, null);

    expect(stored.view).toBeNull();
    // record 完整，规则修好后能重跑 —— 因为分析失败就不存，等于把最值得看的
    // 那一手永久丢掉
    expect(stored.record).toBe(rec);
    expect(stored.worstEvLoss).toBe(0);
    expect(stored.mistakeTags).toEqual([]);
    expect(stored.timestamp).toBe(rec.timestamp);
  });

  it('disputed 默认 false，可显式传入', () => {
    const rec = makeRecord('st-3');
    expect(storedHandOf(rec, null).disputed).toBe(false);
    expect(storedHandOf(rec, null, { disputed: true }).disputed).toBe(true);
  });

  it('mistakeTags 是副本，改它不会回头改动 view.tags', () => {
    const rec = makeRecord('st-4');
    const view = viewOf(analyzeHand(rec, OPTS));
    const stored = storedHandOf(rec, view);
    stored.mistakeTags.push('preflop_sb_limp');
    expect(view.tags).not.toContain('preflop_sb_limp');
  });

  it('整个落库值 JSON 往返无损', () => {
    const rec = makeRecord('st-5');
    const stored = storedHandOf(rec, viewOf(analyzeHand(rec, OPTS)));
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
  });
});

describe('heroPositionOf', () => {
  it('取的是 hero 那一行的位置，不是第一行', () => {
    const rec = makeRecord('hp-1');
    const heroSeatRow = rec.seats.find(s => s.seat === rec.heroSeat)!;
    expect(heroPositionOf(rec)).toBe(heroSeatRow.position);
  });

  it('record 里没有 hero 座位时抛错，而不是返回 undefined', () => {
    const rec = makeRecord('hp-2');
    const broken = { ...rec, seats: rec.seats.filter(s => s.seat !== rec.heroSeat) };
    expect(() => heroPositionOf(broken)).toThrow(/hero 座位/);
  });
});
