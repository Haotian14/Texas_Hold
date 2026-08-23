import { describe, it, expect } from 'vitest';
import {
  kpisOf,
  curveOf,
  trendOf,
  leakBarsOf,
  streetBarsOf,
  positionRowsOf,
  numText,
  toneOf,
  forceNegText,
  MAX_POINTS,
  smoothPath,
} from './reportModel';
import { aggregate } from '../storage/summary';

// 空值从 aggregate([]) 借，不手搓 WindowStats 字面量：手搓的那份在
// taxonomy 加分类时不会跟着变，而 aggregate 的骨架会。
const empty = aggregate([]);

describe('numText', () => {
  it('正数带 ASCII +', () => {
    expect(numText(4.2)).toBe('+4.2');
  });

  it('负数带 U+2212 −，且不带 ASCII 连字符', () => {
    expect(numText(-6.8)).toBe('−6.8');
    expect(numText(-6.8)).not.toContain('-');
  });

  it('零不带号', () => {
    expect(numText(0)).toBe('0.0');
  });
});

describe('toneOf', () => {
  it('正数为 positive', () => {
    expect(toneOf(4.2)).toBe('positive');
  });

  it('负数为 negative', () => {
    expect(toneOf(-6.8)).toBe('negative');
  });

  it('零为 neutral', () => {
    expect(toneOf(0)).toBe('neutral');
  });
});

describe('forceNegText', () => {
  it('正数量级也恒显示负号', () => {
    expect(forceNegText(6.8)).toBe('−6.8');
  });

  it('零仍显示负号——EV 损失卡恒负，不因为这段时间没漏就变中性', () => {
    expect(forceNegText(0)).toBe('−0.0');
  });
});

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

  it('BB/100 卡：正数带 ASCII +，负数带 U+2212 −，零不带号——与设计稿（+4.2 / −6.8）一致', () => {
    const win = kpisOf({ ...empty, hands: 100, netBB: 420 })[1]!;
    const lose = kpisOf({ ...empty, hands: 100, netBB: -420 })[1]!;
    const flat = kpisOf(empty)[1]!;
    expect(win.value.startsWith('+')).toBe(true);
    expect(lose.value.startsWith('−')).toBe(true);
    expect(flat.value.startsWith('+')).toBe(false);
    expect(flat.value.startsWith('−')).toBe(false);
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

  it('榜首 evLoss 为 0（有次数但损失全 0）时不除零，全部记 0 宽', () => {
    const s = {
      ...empty,
      byTag: { ...empty.byTag, 'loose-call': { count: 3, evLoss: 0 }, 'loose-open': { count: 1, evLoss: 0 } },
    };
    const bars = leakBarsOf(s);
    expect(bars).toHaveLength(2);
    expect(bars.every(b => b.pct === 0)).toBe(true);
    expect(bars.every(b => Number.isFinite(b.pct))).toBe(true);
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

describe('smoothPath', () => {
  const pts = (...xy: [number, number][]) => xy.map(([x, y]) => [x, y] as const);

  it('空数组给空串', () => {
    expect(smoothPath([])).toBe('');
  });

  it('单点只有一个 M', () => {
    expect(smoothPath(pts([10, 20]))).toBe('M10,20');
  });

  it('两点之间是一段三次曲线，起止点精确落在数据点上', () => {
    const d = smoothPath(pts([0, 0], [10, 10]));
    expect(d.startsWith('M0,0')).toBe(true);
    expect(d.endsWith('10,10')).toBe(true);
    expect(d).toContain('C');
  });

  it('平坦数据不产生任何起伏：所有控制点的 y 与数据点相同', () => {
    const d = smoothPath(pts([0, 5], [10, 5], [20, 5], [30, 5]));
    const ys = [...d.matchAll(/-?\d+(?:\.\d+)?,(-?\d+(?:\.\d+)?)/g)].map(m => Number(m[1]));
    expect(ys.every(y => Math.abs(y - 5) < 1e-9)).toBe(true);
  });

  it('单调数据不过冲——控制点的 y 恒落在相邻两点之间', () => {
    // 这是用单调三次插值而不是普通样条的全部理由：累计盈亏曲线一旦过冲，
    // 就会在两手之间画出一段从未发生过的回撤。
    const data = pts([0, 100], [10, 90], [20, 60], [30, 58], [40, 10]);
    const d = smoothPath(data);
    const seg = [...d.matchAll(/C([-\d.]+),([-\d.]+) ([-\d.]+),([-\d.]+) ([-\d.]+),([-\d.]+)/g)];
    expect(seg.length).toBe(data.length - 1);
    seg.forEach((m, i) => {
      const y0 = data[i]![1];
      const y1 = data[i + 1]![1];
      const lo = Math.min(y0, y1) - 1e-9;
      const hi = Math.max(y0, y1) + 1e-9;
      expect(Number(m[2])).toBeGreaterThanOrEqual(lo);
      expect(Number(m[2])).toBeLessThanOrEqual(hi);
      expect(Number(m[4])).toBeGreaterThanOrEqual(lo);
      expect(Number(m[4])).toBeLessThanOrEqual(hi);
    });
  });

  it('局部极值处同样不过冲（先涨后跌）', () => {
    const data = pts([0, 50], [10, 10], [20, 50]);
    const d = smoothPath(data);
    const seg = [...d.matchAll(/C([-\d.]+),([-\d.]+) ([-\d.]+),([-\d.]+) ([-\d.]+),([-\d.]+)/g)];
    seg.forEach((m, i) => {
      const lo = Math.min(data[i]![1], data[i + 1]![1]) - 1e-9;
      const hi = Math.max(data[i]![1], data[i + 1]![1]) + 1e-9;
      for (const y of [Number(m[2]), Number(m[4])]) {
        expect(y).toBeGreaterThanOrEqual(lo);
        expect(y).toBeLessThanOrEqual(hi);
      }
    });
  });

  it('每个数据点都精确出现在路径上，不被平滑抹掉', () => {
    const data = pts([0, 0], [10, 30], [20, 5], [30, 40]);
    const d = smoothPath(data);
    for (const [x, y] of data.slice(1)) {
      expect(d).toContain(`${x},${y}`);
    }
  });
});
