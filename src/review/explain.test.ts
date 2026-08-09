import { describe, it, expect } from 'vitest';
import { explain } from './explain';
import { POSTFLOP_TAGS, PREFLOP_TAGS } from './taxonomy';

// 构造一个最小可用的输入；situation 只需 explain 实际读到的字段
function input(overrides: Partial<Parameters<typeof explain>[0]> = {}) {
  return {
    tag: null,
    severity: 'ok' as const,
    situation: {
      pot: 10, toCall: 3, street: 'flop' as const, heroEquity: 0.4,
    } as never,
    actual: {
      seat: 0, street: 'flop' as const, type: 'call' as const, amount: 3,
      potBefore: 10, toCall: 3, stackBefore: 100,
    },
    actualEv: 1.2,
    recommended: { label: 'fold', actionType: 'fold' as const, investment: 0, ev: 0, isRecommended: true },
    evLoss: 0,
    degraded: false,
    heroEquity: 0.4,
    requiredEquity: 0.23,
    ...overrides,
  };
}

describe('explain', () => {
  it('每个 tag 都有对应模板，且产出非空文案', () => {
    for (const tag of [...PREFLOP_TAGS, ...POSTFLOP_TAGS]) {
      const text = explain(input({ tag, severity: 'minor', evLoss: 0.5 }));
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('NaN');
    }
  });

  it('降级时不出现任何 BB 数字', () => {
    const text = explain(input({ degraded: true, evLoss: 0, severity: 'ok' }));
    expect(text).not.toMatch(/\d+(\.\d+)?\s*BB/);
    expect(text).toContain('降级');
  });

  it('无失误时给简短肯定，不编造理由', () => {
    const text = explain(input({ tag: null, severity: 'ok', evLoss: 0 }));
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(40);
  });

  it('有损失时文案里带上损失数值', () => {
    const text = explain(input({ tag: 'chasing_bad_odds', severity: 'notable', evLoss: 1.8 }));
    expect(text).toContain('1.8');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 内容钉死测试 —— 不满足于「非空」，而是断言特定数字确实出现在对应位置。
  // 这三条如果模板被换成统一的占位文案（例如全部返回同一个词），会失败。
  // ─────────────────────────────────────────────────────────────────────────

  it('chasing_bad_odds 同时体现所需胜率与实际胜率两个数字', () => {
    const text = explain(input({
      tag: 'chasing_bad_odds',
      severity: 'notable',
      evLoss: 1.8,
      requiredEquity: 0.4,
      heroEquity: 0.25,
    }));
    expect(text).toContain('40%');
    expect(text).toContain('25%');
    expect(text).toContain('1.8');
  });

  it('bet_size_too_small 同时体现实际下注额与推荐下注额两个数字', () => {
    const text = explain(input({
      tag: 'bet_size_too_small',
      severity: 'minor',
      evLoss: 0.6,
      actual: {
        seat: 0, street: 'flop' as const, type: 'bet' as const, amount: 3,
        potBefore: 9, toCall: 0, stackBefore: 100,
      },
      recommended: { label: 'bet pot', actionType: 'bet' as const, investment: 9, ev: 4, isRecommended: true },
      requiredEquity: null,
    }));
    expect(text).toContain('3.0');
    expect(text).toContain('9.0');
    expect(text).toContain('0.6');
  });

  it('preflop_sb_limp 体现跛入的具体投入额度，且不引用不存在的所需胜率', () => {
    const text = explain(input({
      tag: 'preflop_sb_limp',
      severity: 'minor',
      evLoss: 0.3,
      situation: { pot: 1.5, toCall: 0, street: 'preflop' as const, heroEquity: 0.4 } as never,
      actual: {
        seat: 0, street: 'preflop' as const, type: 'call' as const, amount: 0.5,
        potBefore: 1.5, toCall: 0, stackBefore: 100,
      },
      requiredEquity: null,
    }));
    expect(text).toContain('0.5');
    expect(text).not.toContain('null');
    expect(text).not.toContain('undefined');
  });

  it('degraded 优先于 tag：即便带 tag 与 evLoss，降级时依旧返回固定语句、不含 BB 数字', () => {
    const text = explain(input({
      tag: 'should_have_folded',
      severity: 'severe',
      evLoss: 5.4,
      degraded: true,
    }));
    expect(text).toBe('本手此处对手范围过窄，估算已降级，不做判定。');
    expect(text).not.toMatch(/\d+(\.\d+)?\s*BB/);
  });
});
