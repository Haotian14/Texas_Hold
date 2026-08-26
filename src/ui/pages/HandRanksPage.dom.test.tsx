// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HandRanksPage } from './HandRanksPage';
import { HAND_RANKS, handRankName } from '../handRankModel';

/**
 * 牌型对照页的渲染冒烟测试。
 *
 * 「哪个牌型更大」的正确性由 handRankModel.test.ts 用引擎跑过了（每个示例都
 * 真的丢进 evaluate5Slow 验过牌型与顺序）。这里只钉住渲染层的两件事：**页面上
 * 的先后顺序确实是模型给的那个顺序**（把 map 写反或者顺手 sort 一下，牌型大小
 * 就整个教反了，而页面看着完全正常），以及每一档都真的画出了五张牌。
 */
describe('牌型对照页', () => {
  it('九档牌型按模型的顺序渲染，从同花顺到高牌', () => {
    render(<HandRanksPage onSettings={vi.fn()} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(9);
    // 页面上的文本顺序必须与模型顺序逐项相同
    const names = items.map(li => li.querySelector('.hr-name')?.textContent);
    expect(names).toEqual(HAND_RANKS.map(r => handRankName(r.category)));
    expect(names[0]).toBe('同花顺');
    expect(names[names.length - 1]).toBe('高牌');
  });

  it('每一档都画出五张牌', () => {
    const { container } = render(<HandRanksPage onSettings={vi.fn()} />);
    for (const li of container.querySelectorAll('.hr-row')) {
      expect(li.querySelectorAll('.hr-cards .card')).toHaveLength(5);
    }
  });

  // <ol> 而不是一堆 div：读屏会念「第 3 项，共 9 项」，那正是这一页要传达的信息
  it('用有序列表承载，序号本身不进无障碍树', () => {
    const { container } = render(<HandRanksPage onSettings={vi.fn()} />);
    expect(container.querySelector('ol.hr-list')).toBeInTheDocument();
    for (const seq of container.querySelectorAll('.hr-seq')) {
      expect(seq).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('页头有设置入口，但没有指向自己的「牌型」入口', async () => {
    const onSettings = vi.fn();
    render(<HandRanksPage onSettings={onSettings} />);
    await userEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '牌型大小' })).not.toBeInTheDocument();
  });

  // 看完表之后必然会问「都是一对怎么办」。不解释的话新手会以为平分底池
  it('说清同档牌型怎么比大小，以及七选五', () => {
    render(<HandRanksPage onSettings={vi.fn()} />);
    expect(screen.getByText(/踢脚/)).toBeInTheDocument();
    expect(screen.getByText(/任选五张/)).toBeInTheDocument();
  });
});
