import { describe, it, expect } from 'vitest';
import {
  buildTransfer,
  parseTransfer,
  transferFileName,
  TRANSFER_FORMAT,
  TRANSFER_VERSION,
} from './transfer';
import type { StoredHand } from './schema';

function hand(id: string, over: Partial<StoredHand> = {}): StoredHand {
  return {
    id,
    timestamp: 1700000000000,
    worstEvLoss: 1.5,
    heroPosition: 'BTN',
    mistakeTags: ['missed_cbet'],
    disputed: false,
    record: {
      id,
      schemaVersion: 2,
      timestamp: 1700000000000,
      seed: 's',
      heroSeat: 0,
      buttonSeat: 3,
      seats: [],
      board: [],
      actions: [],
      results: [],
      pots: [],
    } as never,
    view: {
      schemaVersion: 1,
      recordId: id,
      heroSeat: 0,
      decisions: [],
      totalEvLoss: 0,
      worstEvLoss: 1.5,
      tags: ['missed_cbet'],
    },
    ...over,
  };
}

describe('buildTransfer', () => {
  it('带格式标记、版本与时间戳', () => {
    const t = buildTransfer([hand('a')], 1700000000000);
    expect(t.format).toBe(TRANSFER_FORMAT);
    expect(t.version).toBe(TRANSFER_VERSION);
    expect(t.exportedAt).toBe(1700000000000);
    expect(t.hands).toHaveLength(1);
  });

  it('不导出统计 —— 它是派生值，一起写进去就多一份可能对不上的真相', () => {
    const t = buildTransfer([hand('a')], 0) as unknown as Record<string, unknown>;
    expect(t.stats).toBeUndefined();
    expect(Object.keys(t).sort()).toEqual(['exportedAt', 'format', 'hands', 'version']);
  });

  it('复制数组，不与入参共享引用', () => {
    const src = [hand('a')];
    const t = buildTransfer(src, 0);
    src.push(hand('b'));
    expect(t.hands).toHaveLength(1);
  });
});

describe('parseTransfer —— 往返', () => {
  it('导出再导入，手牌逐字段相同', () => {
    const hands = [hand('a'), hand('b', { disputed: true, view: null })];
    const text = JSON.stringify(buildTransfer(hands, 0));
    const r = parseTransfer(text);
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(0);
    expect(r.hands).toEqual(hands);
  });

  it('view 为 null（分析失败）的那一手能过', () => {
    const r = parseTransfer(JSON.stringify(buildTransfer([hand('a', { view: null })], 0)));
    expect(r.ok).toBe(true);
    expect(r.hands[0].view).toBeNull();
  });
});

describe('parseTransfer —— 整份拒绝', () => {
  it('不是 JSON', () => {
    const r = parseTransfer('这不是 json');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/JSON/);
    expect(r.hands).toEqual([]);
  });

  it('不是对象', () => {
    expect(parseTransfer('[1,2,3]').ok).toBe(false);
    expect(parseTransfer('"hi"').ok).toBe(false);
  });

  it('缺 format 标记 —— 挡住"把别的应用的文件导进来"', () => {
    const r = parseTransfer(JSON.stringify({ version: 1, hands: [] }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/format/);
  });

  it('版本比本应用高时拒绝，低时放行', () => {
    const high = parseTransfer(
      JSON.stringify({ format: TRANSFER_FORMAT, version: TRANSFER_VERSION + 1, hands: [] }),
    );
    expect(high.ok).toBe(false);
    expect(high.error).toMatch(/升级/);

    // 更低的版本要能进来 —— 将来在这里做逐版本升级
    const low = parseTransfer(
      JSON.stringify({ format: TRANSFER_FORMAT, version: 0, hands: [] }),
    );
    expect(low.ok).toBe(true);
  });

  it('没有 hands 数组', () => {
    const r = parseTransfer(JSON.stringify({ format: TRANSFER_FORMAT, version: 1 }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/手牌列表/);
  });
});

describe('parseTransfer —— 单条跳过', () => {
  function fileWith(items: unknown[]): string {
    return JSON.stringify({ format: TRANSFER_FORMAT, version: TRANSFER_VERSION, hands: items });
  }

  it('坏记录跳过，好记录照收，并如实回报跳过数', () => {
    // 为一条坏数据把另外九百多手一起挡在门外，是把最坏的结果强加给最需要
    // 这个功能的人；但静默丢数据比拒绝更糟，所以 skipped 必须回报。
    const r = parseTransfer(fileWith([hand('a'), { id: 'broken' }, hand('b'), null, 42]));
    expect(r.ok).toBe(true);
    expect(r.hands.map(h => h.id)).toEqual(['a', 'b']);
    expect(r.skipped).toBe(3);
  });

  it('缺 record 的跳过 —— 没有它就永远不能重跑分析', () => {
    const noRecord = { ...hand('a') } as Record<string, unknown>;
    delete noRecord.record;
    expect(parseTransfer(fileWith([noRecord])).skipped).toBe(1);
  });

  it('record 里缺 actions / results / seats 任一都跳过', () => {
    for (const key of ['actions', 'results', 'seats']) {
      const h = hand('a');
      const rec = { ...(h.record as unknown as Record<string, unknown>) };
      delete rec[key];
      const broken = { ...h, record: rec };
      expect(parseTransfer(fileWith([broken])).skipped, key).toBe(1);
    }
  });

  it('字段类型不对的跳过', () => {
    expect(parseTransfer(fileWith([{ ...hand('a'), timestamp: 'x' }])).skipped).toBe(1);
    expect(parseTransfer(fileWith([{ ...hand('a'), disputed: 'yes' }])).skipped).toBe(1);
    expect(parseTransfer(fileWith([{ ...hand('a'), mistakeTags: 'missed_cbet' }])).skipped).toBe(1);
    expect(parseTransfer(fileWith([{ ...hand('a'), id: '' }])).skipped).toBe(1);
    expect(parseTransfer(fileWith([{ ...hand('a'), worstEvLoss: NaN }])).skipped).toBe(1);
  });

  it('同一份文件里重复的 id 只留第一条', () => {
    const first = hand('dup', { worstEvLoss: 1 });
    const second = hand('dup', { worstEvLoss: 9 });
    const r = parseTransfer(fileWith([first, second]));
    expect(r.hands).toHaveLength(1);
    expect(r.hands[0].worstEvLoss).toBe(1);
    expect(r.skipped).toBe(1);
  });

  it('空文件是合法的：零手，不算错误', () => {
    const r = parseTransfer(fileWith([]));
    expect(r.ok).toBe(true);
    expect(r.hands).toEqual([]);
    expect(r.skipped).toBe(0);
  });
});

describe('transferFileName', () => {
  it('带年月日时分，便于区分多次备份', () => {
    const name = transferFileName(new Date(2026, 7, 19, 9, 5).getTime());
    expect(name).toBe('poker-trainer-20260819-0905.json');
  });
});
