import { describe, it, expect } from 'vitest';
import { parseRange, formatRange } from './rangeNotation';
import { allHandClasses } from './handClass';

const keys = (s: string) => [...parseRange(s).keys()].sort();

describe('parseRange 单个类别', () => {
  it('解析对子、同花、非同花', () => {
    expect(keys('AA')).toEqual(['AA']);
    expect(keys('AKs')).toEqual(['AKs']);
    expect(keys('72o')).toEqual(['72o']);
  });

  it('默认权重为 1', () => {
    expect(parseRange('AA').get('AA')).toBe(1);
  });

  it('空串得到空范围', () => {
    expect(parseRange('').size).toBe(0);
    expect(parseRange('   ').size).toBe(0);
  });
});

describe('parseRange 加号', () => {
  it('对子加号向上展开到 AA', () => {
    expect(keys('QQ+')).toEqual(['AA', 'KK', 'QQ'].sort());
  });

  it('同花加号固定大牌、小牌递增到大牌下一位', () => {
    expect(keys('ATs+')).toEqual(['AJs', 'AKs', 'AQs', 'ATs'].sort());
  });

  it('非同花加号同理', () => {
    expect(keys('KTo+')).toEqual(['KJo', 'KQo', 'KTo'].sort());
  });

  it('A2s+ 展开为 12 个类别', () => {
    expect(parseRange('A2s+').size).toBe(12);
  });

  it('AKs+ 只有它自己', () => {
    expect(keys('AKs+')).toEqual(['AKs']);
  });
});

describe('parseRange 区间', () => {
  it('对子区间，顺序不限', () => {
    expect(keys('99-66')).toEqual(['66', '77', '88', '99'].sort());
    expect(keys('66-99')).toEqual(['66', '77', '88', '99'].sort());
  });

  it('同花区间，顺序不限', () => {
    expect(keys('A5s-A2s')).toEqual(['A2s', 'A3s', 'A4s', 'A5s'].sort());
    expect(keys('A2s-A5s')).toEqual(['A2s', 'A3s', 'A4s', 'A5s'].sort());
  });

  it('区间两端大牌不一致时抛错', () => {
    expect(() => parseRange('A5s-K2s')).toThrow();
  });

  it('区间两端类型不一致时抛错', () => {
    expect(() => parseRange('A5s-A2o')).toThrow();
    expect(() => parseRange('99-A2s')).toThrow();
  });
});

describe('parseRange 权重', () => {
  it('冒号后的数值作为权重', () => {
    expect(parseRange('AJo:0.5').get('AJo')).toBe(0.5);
  });

  it('权重作用于展开后的每个类别', () => {
    const r = parseRange('QQ+:0.25');
    expect(r.get('AA')).toBe(0.25);
    expect(r.get('QQ')).toBe(0.25);
  });

  it('权重超出 [0,1] 抛错', () => {
    expect(() => parseRange('AA:1.5')).toThrow();
    expect(() => parseRange('AA:-0.1')).toThrow();
  });

  it('非数值权重抛错', () => {
    expect(() => parseRange('AA:abc')).toThrow();
  });
});

describe('parseRange 多 token', () => {
  it('逗号分隔，允许多余空白', () => {
    expect(keys('AA,  KK ,QQ')).toEqual(['AA', 'KK', 'QQ'].sort());
  });

  it('重复出现的类别取较大权重', () => {
    expect(parseRange('AA:0.3, AA:0.8').get('AA')).toBe(0.8);
    expect(parseRange('AA:0.8, AA:0.3').get('AA')).toBe(0.8);
  });

  it('组合记法', () => {
    const r = parseRange('77+, A9s+, KTo+, QJs');
    expect(r.has('AA')).toBe(true);
    expect(r.has('77')).toBe(true);
    expect(r.has('66')).toBe(false);
    expect(r.has('A9s')).toBe(true);
    expect(r.has('A8s')).toBe(false);
    expect(r.has('KTo')).toBe(true);
    expect(r.has('QJs')).toBe(true);
  });
});

describe('parseRange 错误处理', () => {
  it('未知类别抛错', () => {
    expect(() => parseRange('XY')).toThrow();
    expect(() => parseRange('AKx')).toThrow();
  });

  it('小牌在前抛错', () => {
    expect(() => parseRange('KAs')).toThrow();
  });

  it('错误信息包含出问题的 token', () => {
    expect(() => parseRange('AA, ZZ, KK')).toThrow(/ZZ/);
  });
});

describe('formatRange', () => {
  it('按 allHandClasses 的顺序输出', () => {
    const s = formatRange(parseRange('KK, AA, QQ'));
    expect(s).toBe('AA, KK, QQ');
  });

  it('权重非 1 时带上权重', () => {
    expect(formatRange(parseRange('AA:0.5'))).toBe('AA:0.5');
  });

  it('空范围输出空串', () => {
    expect(formatRange(new Map())).toBe('');
  });

  it('往返：解析后格式化再解析，结果相同', () => {
    const src = '77+, A9s+, KTo+, QJs, AJo:0.5';
    const once = parseRange(src);
    const twice = parseRange(formatRange(once));
    expect([...twice.entries()].sort()).toEqual([...once.entries()].sort());
  });
});

describe('parseRange 全集', () => {
  it('把 169 个类别逐个写出来能解析出全集', () => {
    const all = allHandClasses();
    expect(parseRange(all.join(', ')).size).toBe(169);
  });
});
