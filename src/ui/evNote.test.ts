import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 规格 §12 的局限性说明必须出现在**所有报 EV 数字的页面**上。
 *
 * 这条曾经说到没做到：报表页印了，复盘页从 ③-B 起就一直没有（见 README
 * 「已知的覆盖边界」），而逐个决策点报「你这步亏了 X BB」的恰恰是复盘页——
 * 那里最容易让人把近似当成 solver 的精确输出。补上之后加这条测试，是因为
 * 一句纯展示的文案没有任何别的东西会拦着它被顺手删掉。
 *
 * 扫源码文本而不是渲染组件：这个仓库的测试跑在 node 环境下，没有 DOM，
 * 也没有装测试渲染器。与 architecture.test.ts / pwa.test.ts 同一手法。
 */

const NOTE = 'EV 数字为近似估算，非 solver 输出。';

const PAGES = ['src/ui/pages/ReportPage.tsx', 'src/ui/pages/ReviewPage.tsx'];

describe('规格 §12 的 EV 局限性说明', () => {
  it.each(PAGES)('%s 印了这句话', file => {
    expect(readFileSync(file, 'utf-8')).toContain(NOTE);
  });

  it('两页用的是同一句话，不是两个近义的说法', () => {
    // 同一件事在两页上有两种说法，用户会以为它们说的是两回事。
    const counts = PAGES.map(f => readFileSync(f, 'utf-8').split(NOTE).length - 1);
    expect(counts).toEqual([1, 1]);
  });
});
