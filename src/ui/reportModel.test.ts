import { describe, it, expect } from 'vitest';
import { kpisOf, curveOf, trendOf, leakBarsOf, streetBarsOf, positionRowsOf, MAX_POINTS } from './reportModel';
import { aggregate } from '../storage/summary';

// 空值从 aggregate([]) 借，不手搓 WindowStats 字面量：手搓的那份在
// taxonomy 加分类时不会跟着变，而 aggregate 的骨架会。
const empty = aggregate([]);

describe('kpisOf', () => {
  it('零手时三个卡都出，值为 0，不出 NaN', () => {
    const k = kpisOf(empty);
    expect(k.map(x => x.key)).toEqual(['hands', 'bb100', 'leak']);
    expect(k.every(x => !x.value.includes('NaN'))).toBe(true);
  });

  it('EV 损失卡恒为负号且恒红——它是「漏了多少」不是「输了多少」', () => {
    const s = { ...empty, hands: 100, netBB: 420, byStreet: { preflop: 0, flop: 10, turn: 20, river: 0 } };
    const leak = kpisOf(s).find(k => k.key === 'leak')!;
    expect(leak.value.startsWith('−')).toBe(true);
    expect(leak.tone).toBe('negative');
  });

  it('赢着钱也可能在漏：BB/100 为正与 EV 损失为负并存', () => {
    const s = { ...empty, hands: 100, netBB: 420, byStreet: { preflop: 0, flop: 30, turn: 0, river: 0 } };
    const [, winrate, leak] = kpisOf(s);
    expect(winrate.tone).toBe('positive');
    expect(leak.tone).toBe('negative');
  });
});

describe('curveOf', () => {
  it('累计而不是逐手：[10,-4,7] → [10,6,13]', () => {
    expect(curveOf([10, -4, 7]).map(p => p.cum)).toEqual([10, 6, 13]);
  });

  it('空数组给空曲线', () => {
    expect(curveOf([])).toEqual([]);
  });

  it('不超过 MAX_POINTS 时一个点都不丢', () => {
    const series = Array.from({ length: MAX_POINTS }, () => 1);
    expect(curveOf(series)).toHaveLength(MAX_POINTS);
  });

  it('超过 MAX_POINTS 时等距抽样，首尾必须保留', () => {
    const series = Array.from({ length: 10000 }, () => 1);
    const out = curveOf(series);
    expect(out).toHaveLength(MAX_POINTS);
    expect(out[0]!.i).toBe(1);
    expect(out[out.length - 1]!.i).toBe(10000);
    expect(out[out.length - 1]!.cum).toBe(10000);
  });

  it('抽样取累计值本身，不做平均——平均会把回撤削平', () => {
    // 前 5000 手每手 +1，后 5000 手每手 −1：末点必须回到 0
    const series = [...Array.from({ length: 5000 }, () => 1), ...Array.from({ length: 5000 }, () => -1)];
    const out = curveOf(series);
    expect(out[out.length - 1]!.cum).toBe(0);
    expect(Math.max(...out.map(p => p.cum))).toBeGreaterThan(4900);
  });
});

describe('trendOf', () => {
  it('两段都满 100 手时给出两个数', () => {
    const t = trendOf(Array.from({ length: 200 }, (_, i) => (i < 100 ? -1 : 2)));
    expect(t.previous).toBe(-100);
    expect(t.current).toBe(200);
  });

  it('不足 200 手时 previous 为 null，文案是样本不足', () => {
    const t = trendOf(Array.from({ length: 150 }, () => 1));
    expect(t.previous).toBeNull();
    expect(t.text).toContain('样本不足');
  });
});

describe('leakBarsOf', () => {
  it('按累计 evLoss 倒序，榜首 100%', () => {
    const s = { ...empty, byTag: { ...empty.byTag, 'loose-call': { count: 2, evLoss: 10 }, 'loose-open': { count: 9, evLoss: 4 } } };
    const bars = leakBarsOf(s);
    expect(bars.map(b => b.tag)).toEqual(['loose-call', 'loose-open']);
    expect(bars[0]!.pct).toBe(100);
    expect(bars[1]!.pct).toBe(40);
  });

  it('次数为 0 的分类不上榜', () => {
    expect(leakBarsOf(empty)).toEqual([]);
  });

  it('标签是中文，来自 TAG_TEXT', () => {
    const s = { ...empty, byTag: { ...empty.byTag, 'loose-call': { count: 1, evLoss: 1 } } };
    expect(leakBarsOf(s)[0]!.label).not.toBe('loose-call');
  });
});

describe('streetBarsOf', () => {
  it('四段恒在，占比之和为 100', () => {
    const s = { ...empty, byStreet: { preflop: 1, flop: 1, turn: 2, river: 0 } };
    const bars = streetBarsOf(s);
    expect(bars.map(b => b.street)).toEqual(['preflop', 'flop', 'turn', 'river']);
    expect(bars.reduce((a, b) => a + b.pct, 0)).toBe(100);
    expect(bars[2]!.pct).toBe(50);
  });

  it('全零时四段全 0 宽，不除零', () => {
    expect(streetBarsOf(empty).every(b => b.pct === 0)).toBe(true);
  });
});

describe('positionRowsOf', () => {
  it('六个位置恒在，顺序固定 UTG→BB', () => {
    expect(positionRowsOf(empty).map(r => r.position)).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
  });

  it('没打过的位置 bb100 为 null（界面显示破折号），不是 0', () => {
    expect(positionRowsOf(empty).every(r => r.bb100 === null)).toBe(true);
  });
});
