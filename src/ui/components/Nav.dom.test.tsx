// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Nav } from './Nav';
import { TopBar } from './TopBar';
import type { TopBarProps } from './TopBar';
import { QuickToggles } from './QuickToggles';
import { RebuyPrompt } from './RebuyPrompt';

/**
 * 导航、顶栏、右上角开关、补码提示的渲染冒烟测试。
 *
 * 钉住的是与版式无关的行为：导航三项各自在哪一页高亮、顶栏那个「第几手」的
 * +1 换算、开关的可访问名字随状态翻转、以及设置在**每一页**都有入口。
 * 最后一条是这次改版最容易留下的坑——设置从导航项收进右上角齿轮之后，
 * 只在牌桌页给入口的话，用户在复盘页与报表页会彻底找不到它。
 */
function topBarProps(over: Partial<TopBarProps> = {}): TopBarProps {
  return {
    handsPlayed: 7,
    inProgress: true,
    deepStack: false,
    storageOk: true,
    netBB: 12.5,
    muted: false,
    onToggleMute: vi.fn(),
    showEquity: false,
    onToggleEquity: vi.fn(),
    onSettings: vi.fn(),
    onHandRanks: vi.fn(),
    ...over,
  };
}

describe('主导航', () => {
  it('只有三项，设置不在其中', () => {
    render(<Nav page="table" onNav={vi.fn()} />);
    for (const label of ['牌桌', '复盘', '报表']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /设置/ })).not.toBeInTheDocument();
  });

  it('当前页带 aria-current', () => {
    render(<Nav page="report" onNav={vi.fn()} />);
    expect(screen.getByRole('button', { name: /报表/ })).toHaveAttribute('aria-current', 'page');
  });

  // 历史是复盘的下一级，不是平级页面
  it('在历史页时高亮的是「复盘」', () => {
    render(<Nav page="history" onNav={vi.fn()} />);
    expect(screen.getByRole('button', { name: /复盘/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /牌桌/ })).not.toHaveAttribute('aria-current');
  });

  // 设置页是从牌桌页的齿轮进去的，返回也回到那里。不高亮任何一项会让用户
  // 在设置页看不出自己身处应用的哪一块
  it('在设置页时高亮的是「牌桌」', () => {
    render(<Nav page="settings" onNav={vi.fn()} />);
    expect(screen.getByRole('button', { name: /牌桌/ })).toHaveAttribute('aria-current', 'page');
  });

  it('在牌型页时也高亮「牌桌」', () => {
    render(<Nav page="handRanks" onNav={vi.fn()} />);
    expect(screen.getByRole('button', { name: /牌桌/ })).toHaveAttribute('aria-current', 'page');
  });

  it('点一项把页面 id 交出去', async () => {
    const onNav = vi.fn();
    render(<Nav page="table" onNav={onNav} />);
    await userEvent.click(screen.getByRole('button', { name: /报表/ }));
    expect(onNav).toHaveBeenCalledWith('report');
  });
});

describe('右上角的开关', () => {
  // 图标是 aria-hidden 的，按钮里没有别的文字——可访问名字只能由 aria-label
  // 给，且必须随状态翻转，否则读屏用户按下去不知道发生了什么
  it('静音按钮的名字随状态翻转', () => {
    const { rerender } = render(<TopBar {...topBarProps({ muted: false })} />);
    expect(screen.getByRole('button', { name: '静音' })).toBeInTheDocument();
    rerender(<TopBar {...topBarProps({ muted: true })} />);
    expect(screen.getByRole('button', { name: '取消静音' })).toBeInTheDocument();
  });

  it('胜率按钮的名字随状态翻转，且带 aria-pressed', () => {
    const { rerender } = render(<TopBar {...topBarProps({ showEquity: false })} />);
    expect(screen.getByRole('button', { name: '显示胜率' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    rerender(<TopBar {...topBarProps({ showEquity: true })} />);
    expect(screen.getByRole('button', { name: '隐藏胜率' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('四颗按钮各自触发回调', async () => {
    const p = topBarProps();
    render(<TopBar {...p} />);
    await userEvent.click(screen.getByRole('button', { name: '静音' }));
    await userEvent.click(screen.getByRole('button', { name: '显示胜率' }));
    await userEvent.click(screen.getByRole('button', { name: '牌型大小' }));
    await userEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(p.onToggleMute).toHaveBeenCalledTimes(1);
    expect(p.onToggleEquity).toHaveBeenCalledTimes(1);
    expect(p.onHandRanks).toHaveBeenCalledTimes(1);
    expect(p.onSettings).toHaveBeenCalledTimes(1);
  });

  // 复盘页与报表页的页头只挂齿轮：胜率读数画在牌桌上、音效是发牌的声音，
  // 两者在那两页都无从谈起
  it('非牌桌页不渲染胜率与音效，但仍给牌型与设置的入口', () => {
    render(<QuickToggles tableToggles={false} onSettings={vi.fn()} onHandRanks={vi.fn()} />);
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '牌型大小' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /胜率/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /静音/ })).not.toBeInTheDocument();
  });

  // 牌型页自己不该有一个指向自己的入口
  it('不传 onHandRanks 时那颗按钮整个不渲染', () => {
    render(<QuickToggles tableToggles={false} onSettings={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '牌型大小' })).not.toBeInTheDocument();
  });
});

describe('顶栏', () => {
  // handsPlayed 在结算那一刻就自增了，所以结算后它本身就是当前手的序号。
  // 这个 +1 换算错掉的话，手数会在每次结算时跳两格或停一拍
  it('手牌进行中时显示的是「正在打第几手」', () => {
    render(<TopBar {...topBarProps({ handsPlayed: 7, inProgress: true })} />);
    expect(screen.getByText(/第 8 手/)).toBeInTheDocument();
  });

  it('已结算时不再 +1', () => {
    render(<TopBar {...topBarProps({ handsPlayed: 7, inProgress: false })} />);
    expect(screen.getByText(/第 7 手/)).toBeInTheDocument();
  });

  // 会话盈亏从 Nav 底部搬到了顶栏。正数要带 + 号，负数的 - 由 chips() 出，
  // 这里不能再补一个
  it('会话盈亏正数带 + 号', () => {
    render(<TopBar {...topBarProps({ netBB: 12.5 })} />);
    expect(screen.getByText('+$500')).toBeInTheDocument();
  });

  it('会话盈亏负数只有一个负号', () => {
    render(<TopBar {...topBarProps({ netBB: -12.5 })} />);
    expect(screen.getByText('-$500')).toBeInTheDocument();
  });

  it('存储不可用要说出来，否则用户会以为都记着了', () => {
    render(<TopBar {...topBarProps({ storageOk: false })} />);
    expect(screen.getByText('未记录')).toBeInTheDocument();
  });

  it('深筹码标记只在深筹码时出现', () => {
    const { rerender } = render(<TopBar {...topBarProps({ deepStack: false })} />);
    expect(screen.queryByText('深筹码')).not.toBeInTheDocument();
    rerender(<TopBar {...topBarProps({ deepStack: true })} />);
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
    render(<RebuyPrompt options={[100]} buyInCount={2} totalBuyIn={300} onRebuy={vi.fn()} />);
    expect(screen.getByText(/第 3 次买入/)).toBeInTheDocument();
    expect(screen.getByText(/累计买入 \$12,000/)).toBeInTheDocument();
  });
});
