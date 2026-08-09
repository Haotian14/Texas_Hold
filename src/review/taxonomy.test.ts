import { describe, it, expect } from 'vitest';
import {
  severityOf,
  SEVERITY_THRESHOLDS,
  PREFLOP_TAGS,
  POSTFLOP_TAGS,
  PREFLOP_OK_FREQ,
} from './taxonomy';

describe('severityOf', () => {
  it('区间左闭右开，边界值归入更严重的一档', () => {
    expect(severityOf(0)).toBe('ok');
    expect(severityOf(0.199)).toBe('ok');
    expect(severityOf(0.2)).toBe('minor');
    expect(severityOf(0.999)).toBe('minor');
    expect(severityOf(1)).toBe('notable');
    expect(severityOf(2.999)).toBe('notable');
    expect(severityOf(3)).toBe('severe');
    expect(severityOf(100)).toBe('severe');
  });

  it('负的 evLoss 视为 ok —— 用户打得比推荐还好时不该报错', () => {
    // 蒙特卡洛噪声会让实际动作偶尔算出比推荐更高的 EV
    expect(severityOf(-0.5)).toBe('ok');
  });

  it('阈值表按 min 升序且首档为 0', () => {
    expect(SEVERITY_THRESHOLDS[0].min).toBe(0);
    for (let i = 1; i < SEVERITY_THRESHOLDS.length; i++) {
      expect(SEVERITY_THRESHOLDS[i].min).toBeGreaterThan(SEVERITY_THRESHOLDS[i - 1].min);
    }
  });
});

describe('MistakeTag 分组', () => {
  it('翻前六个、翻后九个，共十五个', () => {
    expect(PREFLOP_TAGS).toHaveLength(6);
    expect(POSTFLOP_TAGS).toHaveLength(9);
  });

  it('两组不重叠', () => {
    const pre = new Set<string>(PREFLOP_TAGS);
    for (const t of POSTFLOP_TAGS) expect(pre.has(t)).toBe(false);
  });

  it('翻前 tag 一律以 preflop_ 开头，便于 UI 分组与报表聚合', () => {
    for (const t of PREFLOP_TAGS) expect(t.startsWith('preflop_')).toBe(true);
  });
});

describe('翻前频率阈值', () => {
  it('等于 spec §8.2 规定的 0.15', () => {
    expect(PREFLOP_OK_FREQ).toBe(0.15);
  });
});
