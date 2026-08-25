// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Nav } from './Nav';
import { TopBar } from './TopBar';
import { RebuyPrompt } from './RebuyPrompt';

/**
 * 导航、顶栏、补码提示的渲染冒烟测试。
 *
 * 这三个组件的骨架会在换设计系统时被动到（按钮换 Button、导航可能换
 * Tabs、补码提示可能换 Dialog）。钉住的是三件与实现无关的事：历史页
 * 高亮的是「复盘」、静音/胜率两颗图标按钮的可访问名字随状态翻转、
 * 以及顶栏那个「第几手」的 +1 换算。
 */
function navProps(over: Record<string, unknown> = {}) {
  return {
    page: 'table' as const,
    onNav: vi.fn(),
    netBB: 12.5,
    totalBuyIn: 100,
    muted: false,
    onToggleMute: vi.fn(),
    showEquity: false,
    onToggleEquity: vi.fn(),
    ...over,
  };
}

describe('主导航', () => {
  it('四项都在，当前页带 aria-current', () => {
    render(<Nav {...navProps({ page: 'report' })} />);
    for (const label of ['牌桌', '复盘', '报表', '设置']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /报表/ })).toHaveAttribute('aria-current', 'page');
  });

  // 历史是复盘的下一级，不是平级页面。高亮丢了的话，用户在历史页
  // 会看不出自己身处应用的哪一块
  it('在历史页时高亮的是「复盘」', () => {
    render(<Nav {...navProps({ page: 'history' })} />);
    expect(screen.getByRole('button', { name: /复盘/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /牌桌/ })).not.toHaveAttribute('aria-current');
  });

  it('点一项把页面 id 交出去', async () => {
    const p = navProps();
    render(<Nav {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /设置/ }));
    expect(p.onNav).toHaveBeenCalledWith('settings');
  });
});

describe('静音与胜率两颗图标按钮', () => {
  // 图标是 aria-hidden 的，按钮里没有别的文字——可访问名字只能由
  // aria-label 给，且必须随状态翻转，否则读屏用户按下去不知道发生了什么
  it('静音按钮的名字随状态翻转', () => {
    const { rerender } = render(<Nav {...navProps({ muted: false })} />);
    expect(screen.getByRole('button', { name: '静音' })).toBeInTheDocument();
    rerender(<Nav {...navProps({ muted: true })} />);
    expect(screen.getByRole('button', { name: '取消静音' })).toBeInTheDocument();
  });

  it('胜率按钮的名字随状态翻转，且带 aria-pressed', () => {
    const { rerender } = render(<Nav {...navProps({ showEquity: false })} />);
    expect(screen.getByRole('button', { name: '显示胜率' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    rerender(<Nav {...navProps({ showEquity: true })} />);
    expect(screen.getByRole('button', { name: '隐藏胜率' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('点击各自触发回调', async () => {
    const p = navProps();
    render(<Nav {...p} />);
    await userEvent.click(screen.getByRole('button', { name: '静音' }));
    await userEvent.click(screen.getByRole('button', { name: '显示胜率' }));
    expect(p.onToggleMute).toHaveBeenCalledTimes(1);
    expect(p.onToggleEquity).toHaveBeenCalledTimes(1);
  });
});

describe('顶栏', () => {
  // handsPlayed 在结算那一刻就自增了，所以结算后它本身就是当前手的序号。
  // 这个 +1 换算错掉的话，手数会在每次结算时跳两格或停一拍
  it('手牌进行中时显示的是「正在打第几手」', () => {
    render(<TopBar handsPlayed={7} inProgress={true} deepStack={false} storageOk={true} />);
    expect(screen.getByText(/第 8 手/)).toBeInTheDocument();
  });

  it('已结算时不再 +1', () => {
    render(<TopBar handsPlayed={7} inProgress={false} deepStack={false} storageOk={true} />);
    expect(screen.getByText(/第 7 手/)).toBeInTheDocument();
  });

  it('存储不可用要说出来，否则用户会以为都记着了', () => {
    render(<TopBar handsPlayed={1} inProgress={true} deepStack={false} storageOk={false} />);
    expect(screen.getByText('未记录')).toBeInTheDocument();
  });

  it('深筹码标记只在深筹码时出现', () => {
    const { rerender } = render(
      <TopBar handsPlayed={1} inProgress={true} deepStack={false} storageOk={true} />,
    );
    expect(screen.queryByText('深筹码')).not.toBeInTheDocument();
    rerender(<TopBar handsPlayed={1} inProgress={true} deepStack={true} storageOk={true} />);
    expect(screen.getByText('深筹码')).toBeInTheDocument();
  });
});

describe('补码提示', () => {
  it('每个档位一颗按钮，点击带出目标筹码额', async () => {
    const onRebuy = vi.fn();
    render(
      <RebuyPrompt options={[100, 200]} buyInCount={2} totalBuyIn={300} onRebuy={onRebuy} />,
    );
    await userEvent.click(screen.getByRole('button', { name: '补 $4,000' }));
    expect(onRebuy).toHaveBeenCalledWith(100);
  });

  it('说清这是第几次买入与累计买入额', () => {
    render(
      <RebuyPrompt options={[100]} buyInCount={2} totalBuyIn={300} onRebuy={vi.fn()} />,
    );
    expect(screen.getByText(/第 3 次买入/)).toBeInTheDocument();
    expect(screen.getByText(/累计买入 \$12,000/)).toBeInTheDocument();
  });
});
