// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionBar } from './ActionBar';
import type { ActionBarModel } from '../../session/actionBarModel';

/**
 * 动作条的渲染冒烟测试，为「滑块换组件库」这次重构补的。
 *
 * 钉的是**金额口径**，不是样式。动作条上有两个不同的数并存：滑块与提交
 * 走的是引擎口径的「本次投入额」，按钮上印的是「加注到 X」（多一个本街
 * 已投入额 committed）。这两者混淆过一次真 bug（界面写「加注到 $720」
 * 而实际加注到 $760，见 git 历史 aeb8b45），换控件时极易复发——而且复发
 * 之后界面看起来完全正常，只有牌局结果不对。
 *
 * 读滑块的值刻意兼容两种实现：原生 `<input type="range">` 与 Radix 那种
 * `div[role="slider"]` 都有 slider 这个 role，前者把值放在 value 上、
 * 后者放在 aria-valuenow 上。测试只关心「滑块反映了当前选中额度」这件事，
 * 不该因为底层换了个元素就红。
 */
function sliderValue(): number {
  const el = screen.getByRole('slider');
  const now = el.getAttribute('aria-valuenow');
  if (now !== null) return Number(now);
  return Number((el as HTMLInputElement).value);
}

/** 面对一个加注：最小投入 3BB、最多 100BB（=剩余筹码）、本街已投入 1BB */
function raiseModel(): ActionBarModel {
  return {
    enabled: true,
    fold: true,
    passive: { type: 'call', amount: 2 },
    raise: {
      type: 'raise',
      min: 3,
      max: 100,
      committed: 1,
      presets: [
        { label: '1/3 池', amount: 5 },
        { label: '满池', amount: 12 },
      ],
    },
    allin: { amount: 100 },
  };
}

describe('轮不到 hero 时', () => {
  it('只显示等待文案，不给任何可点的动作', () => {
    const model: ActionBarModel = {
      enabled: false,
      fold: false,
      passive: null,
      raise: null,
      allin: null,
    };
    render(<ActionBar model={model} onAction={vi.fn()} />);
    expect(screen.getByText('等待其他玩家…')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('主按钮的文案是「加注到」的总额', () => {
  it('初始停在最小额，文案带上本街已投入额', () => {
    render(<ActionBar model={raiseModel()} onAction={vi.fn()} />);
    // 投入 3BB + 已投入 1BB = 加注到 4BB = $160
    expect(screen.getByRole('button', { name: '加注到 $160' })).toBeInTheDocument();
  });

  it('选一个预设后文案跟着走', async () => {
    render(<ActionBar model={raiseModel()} onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '满池' }));
    // 12 + 1 = 13BB = $520
    expect(screen.getByRole('button', { name: '加注到 $520' })).toBeInTheDocument();
  });

  it('推到最大时改说「全下」，且不再加 committed', async () => {
    render(<ActionBar model={raiseModel()} onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '最大' }));
    // 全下写的是推出去多少（100BB = $4,000），不是加注到的总额（$4,040）
    expect(screen.getByRole('button', { name: '全下 $4,000' })).toBeInTheDocument();
  });
});

describe('提交的是本次投入额，不是按钮上那个数', () => {
  it('加注提交 clamped，而不是 raiseTo', async () => {
    const onAction = vi.fn();
    render(<ActionBar model={raiseModel()} onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: '满池' }));
    await userEvent.click(screen.getByRole('button', { name: '加注到 $520' }));
    // 按钮上印的是 13BB，交给引擎的必须是 12BB
    expect(onAction).toHaveBeenCalledWith({ type: 'raise', amount: 12 });
  });

  it('全下提交 allin 动作本身，不带金额', async () => {
    const onAction = vi.fn();
    render(<ActionBar model={raiseModel()} onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: '最大' }));
    await userEvent.click(screen.getByRole('button', { name: '全下 $4,000' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'allin' });
  });

  it('弃牌与跟注直接交出去', async () => {
    const onAction = vi.fn();
    render(<ActionBar model={raiseModel()} onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: '弃牌' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'fold' });
    await userEvent.click(screen.getByRole('button', { name: '跟注 $80' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'call' });
  });
});

describe('滑块反映当前选中额度', () => {
  it('初始等于最小投入额', () => {
    render(<ActionBar model={raiseModel()} onAction={vi.fn()} />);
    expect(sliderValue()).toBe(3);
  });

  it('点预设后滑块跟着动', async () => {
    render(<ActionBar model={raiseModel()} onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '1/3 池' }));
    expect(sliderValue()).toBe(5);
  });

  // 预设档位是按底池比例算的（1/3 池、1/2 池…），round2 之后常常不落在
  // 步进网格（SMALL_BLIND = 0.5）上。原生 <input type="range"> 只能停在
  // min + k*step 的格子上，这类金额永远够不到；换成 Radix 之后受控值原样
  // 显示，只在用户拖动/按键时才吸附。这条测试钉的就是那个差别——注释里
  // 声称了这件事，就得有东西撑着它
  it('预设金额不落在步进网格上时，滑块照样精确停在那个数', async () => {
    const model = raiseModel();
    model.raise = { ...model.raise!, presets: [{ label: '1/3 池', amount: 4.33 }] };
    render(<ActionBar model={model} onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '1/3 池' }));
    expect(sliderValue()).toBe(4.33);
  });

  it('区间变了就收回最小值，不残留一个已经非法的数字', async () => {
    const { rerender } = render(<ActionBar model={raiseModel()} onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '最大' }));
    expect(sliderValue()).toBe(100);

    // 新的一街：额度区间整个变了
    const next = raiseModel();
    next.raise = { ...next.raise!, min: 8, max: 60 };
    rerender(<ActionBar model={next} onAction={vi.fn()} />);
    expect(sliderValue()).toBe(8);
  });
});

describe('没有加注权时', () => {
  it('只剩全下，主按钮直接说全下', async () => {
    const onAction = vi.fn();
    const model: ActionBarModel = {
      enabled: true,
      fold: true,
      passive: { type: 'call', amount: 40 },
      raise: null,
      allin: { amount: 55 },
    };
    render(<ActionBar model={model} onAction={onAction} />);
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '全下 $2,200' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'allin' });
  });
});
