// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HistoryPage } from './HistoryPage';
import type { HistoryQuery } from '../../storage/repo';
import { listHands, storageStatus } from '../../storage/repo';

/**
 * 历史页的渲染冒烟测试，为「四个原生 select 换组件库下拉」这次重构补的。
 *
 * 钉的是**筛选条件最终交给 listHands 的形状**，不是下拉长什么样。这一层
 * 有两处容易在换控件时坏掉且不易察觉：空串要还原成"不筛这一项"（而不是
 * 筛一个空值），以及"有异议/无异议"是布尔而不是字符串——两者坏掉之后
 * 下拉照样能选，只是列表悄悄筛错。
 */
vi.mock('../../storage/repo', () => ({
  listHands: vi.fn(async () => ({ rows: [], nextOffset: null })),
  storageStatus: vi.fn(() => 'ready' as const),
}));

/**
 * 选一个下拉项。
 *
 * **换下拉实现时只需要改这一个函数**——原生 `<select>` 用 selectOptions
 * 驱动，Radix 那种自绘下拉要先点开 trigger 再点选项，两者的驱动方式不同
 * 但测试关心的事情（选完之后筛选条件对不对）完全一样。
 */
async function choose(filterName: string | RegExp, optionText: string | RegExp) {
  const el = screen.getByRole('combobox', { name: filterName });
  if (el.tagName === 'SELECT') {
    await userEvent.selectOptions(el, screen.getByRole('option', { name: optionText }));
    return;
  }
  await userEvent.click(el);
  await userEvent.click(await screen.findByRole('option', { name: optionText }));
}

/**
 * 最后一次 listHands 调用带的参数。
 *
 * listHands 的形参有默认值（`q: HistoryQuery = {}`），所以在类型上它是可选的
 * ——`?? {}` 补的是这个，不是在掩盖"根本没调用过"：没调用过时下面的 `!`
 * 就已经断在数组越界上了。
 */
function lastQuery(): HistoryQuery {
  const calls = vi.mocked(listHands).mock.calls;
  return calls[calls.length - 1]![0] ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listHands).mockResolvedValue({ rows: [], nextOffset: null });
  vi.mocked(storageStatus).mockReturnValue('ready');
});

describe('默认排序', () => {
  it('首次读取按 worstEvLoss，不按时间', async () => {
    render(<HistoryPage onOpen={vi.fn()} patched={null} />);
    await waitFor(() => expect(listHands).toHaveBeenCalled());
    expect(lastQuery().sortBy).toBe('worstEvLoss');
    expect(lastQuery().filter).toEqual({});
  });

  it('点「按时间」换排序并重取', async () => {
    render(<HistoryPage onOpen={vi.fn()} patched={null} />);
    await waitFor(() => expect(listHands).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: '按时间' }));
    await waitFor(() => expect(lastQuery().sortBy).toBe('timestamp'));
  });
});

describe('筛选条件交给 listHands 的形状', () => {
  it('按位置筛选传的是位置本身', async () => {
    render(<HistoryPage onOpen={vi.fn()} patched={null} />);
    await waitFor(() => expect(listHands).toHaveBeenCalled());
    await choose('按位置筛选', 'BTN');
    await waitFor(() => expect(lastQuery().filter).toEqual({ position: 'BTN' }));
  });

  it('按街道筛选传的是街道 id，不是界面上那个中文标签', async () => {
    render(<HistoryPage onOpen={vi.fn()} patched={null} />);
    await waitFor(() => expect(listHands).toHaveBeenCalled());
    await choose('按街道筛选', '翻牌有失误');
    await waitFor(() => expect(lastQuery().filter).toEqual({ street: 'flop' }));
  });

  // 「有异议」在存储层是布尔。下拉的值是字符串，中间那次转换掉了的话，
  // filter.disputed 会变成 'true' 这个字符串——筛选静默失效
  it('只看有异议传的是布尔 true，不是字符串', async () => {
    render(<HistoryPage onOpen={vi.fn()} patched={null} />);
    await waitFor(() => expect(listHands).toHaveBeenCalled());
    await choose('按是否有异议筛选', '只看有异议');
    await waitFor(() => expect(lastQuery().filter).toEqual({ disputed: true }));
  });

  it('只看无异议传的是布尔 false，而不是"没筛"', async () => {
    render(<HistoryPage onOpen={vi.fn()} patched={null} />);
    await waitFor(() => expect(listHands).toHaveBeenCalled());
    await choose('按是否有异议筛选', '只看无异议');
    await waitFor(() => expect(lastQuery().filter).toEqual({ disputed: false }));
  });

  // 选回「全部」不是筛一个空值，是把这一项整个删掉——isFilterEmpty 与
  // 「筛没了」那句提示都是按键的有无判断的
  it('选回「全部位置」把这一项从条件里删掉，而不是留一个空串', async () => {
    render(<HistoryPage onOpen={vi.fn()} patched={null} />);
    await waitFor(() => expect(listHands).toHaveBeenCalled());
    await choose('按位置筛选', 'BTN');
    await waitFor(() => expect(lastQuery().filter).toEqual({ position: 'BTN' }));
    await choose('按位置筛选', '全部位置');
    await waitFor(() => expect(lastQuery().filter).toEqual({}));
  });

  it('多个条件叠加', async () => {
    render(<HistoryPage onOpen={vi.fn()} patched={null} />);
    await waitFor(() => expect(listHands).toHaveBeenCalled());
    await choose('按位置筛选', 'CO');
    await waitFor(() => expect(lastQuery().filter).toEqual({ position: 'CO' }));
    await choose('按街道筛选', '河牌有失误');
    await waitFor(() =>
      expect(lastQuery().filter).toEqual({ position: 'CO', street: 'river' }),
    );
  });
});

describe('清除筛选', () => {
  it('没有筛选时不出现这颗按钮', async () => {
    render(<HistoryPage onOpen={vi.fn()} patched={null} />);
    await waitFor(() => expect(listHands).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '清除筛选' })).not.toBeInTheDocument();
  });

  it('筛过之后出现，点一下条件清空', async () => {
    render(<HistoryPage onOpen={vi.fn()} patched={null} />);
    await waitFor(() => expect(listHands).toHaveBeenCalled());
    await choose('按位置筛选', 'SB');
    await userEvent.click(await screen.findByRole('button', { name: '清除筛选' }));
    await waitFor(() => expect(lastQuery().filter).toEqual({}));
  });
});

describe('四种空列表说四种话', () => {
  it('一手都没有时说会自动存', async () => {
    render(<HistoryPage onOpen={vi.fn()} patched={null} />);
    expect(await screen.findByText(/还没有记录/)).toBeInTheDocument();
  });

  it('筛没了时说的是另一句', async () => {
    render(<HistoryPage onOpen={vi.fn()} patched={null} />);
    await waitFor(() => expect(listHands).toHaveBeenCalled());
    await choose('按位置筛选', 'UTG');
    expect(await screen.findByText(/没有符合这些条件的手牌/)).toBeInTheDocument();
  });

  it('存储不可用时给一颗重试按钮', async () => {
    vi.mocked(storageStatus).mockReturnValue('unavailable');
    render(<HistoryPage onOpen={vi.fn()} patched={null} />);
    expect(await screen.findByText(/本机存储不可用/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });
});
