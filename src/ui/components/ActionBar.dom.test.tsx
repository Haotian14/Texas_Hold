// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionBar } from './ActionBar';
import type { ActionBarModel } from '../../session/actionBarModel';

/**
 * 动作条的渲染冒烟测试。
 *
 * 钉的是**金额口径**，不是样式。动作条上有两个不同的数并存：金额框与提交
 * 走的是引擎口径的「本次投入额」，按钮上印的是「加注到 X」（多一个本街
 * 已投入额 committed）。这两者混淆过一次真 bug（界面写「加注到 $720」
 * 而实际加注到 $760，见 git 历史 aeb8b45），换控件时极易复发——而且复发
 * 之后界面看起来完全正常，只有牌局结果不对。
 *
 * 上行原来是「底池比例预设 + 滑块」，现在是加价步进器（+$40 / +$100 /
 * +$500 / +$1,000 / 全下 / 重置）。步进器只能往上加，所以「重置」不是
 * 装饰——没有它，加过头就没有回头路。
 */

/**
 * 金额框（上行）里那个数。它与主按钮（下行）印的是**同一个数**——「加注到
 * X」的总额，也就是本次投入额加上本街已投入额。两处一旦口径不同，用户没有
 * 办法判断该信哪个，所以下面每条断言都把两处一起钉住。
 */
function amountBoxText(): string {
  const el = document.querySelector('.raise-amount');
  if (el === null) throw new Error('金额框没有渲染');
  return el.textContent ?? '';
}

/** 面对一个加注：最小投入 3BB、最多 100BB（=剩余筹码）、本街已投入 1BB */
function raiseModel(): ActionBarModel {
  return {
    enabled: true,
    fold: true,
    passive: { type: 'call', amount: 2 },
    raise: { type: 'raise', min: 3, max: 100, committed: 1 },
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
    expect(amountBoxText()).toBe('$160');
  });

  it('加一档之后文案跟着走', async () => {
    render(<ActionBar model={raiseModel()} onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '+$500' }));
    // 投入额 3BB($120) + $500 = $620，加注到 $620 + committed $40 = $660
    expect(amountBoxText()).toBe('$660');
    expect(screen.getByRole('button', { name: '加注到 $660' })).toBeInTheDocument();
  });

  it('推到最大时改说「全下」，且不再加 committed', async () => {
    render(<ActionBar model={raiseModel()} onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '全下' }));
    // 全下写的是推出去多少（100BB = $4,000），不是加注到的总额（$4,040）
    expect(screen.getByRole('button', { name: '全下 $4,000' })).toBeInTheDocument();
    expect(amountBoxText()).toBe('$4,000');
  });
});

describe('提交的是本次投入额，不是按钮上那个数', () => {
  it('加注提交 clamped，而不是 raiseTo', async () => {
    const onAction = vi.fn();
    render(<ActionBar model={raiseModel()} onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: '+$500' }));
    await userEvent.click(screen.getByRole('button', { name: '加注到 $660' }));
    // 按钮上印的是 16.5BB，交给引擎的必须是 15.5BB
    expect(onAction).toHaveBeenCalledWith({ type: 'raise', amount: 15.5 });
  });

  it('全下提交 allin 动作本身，不带金额', async () => {
    const onAction = vi.fn();
    render(<ActionBar model={raiseModel()} onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: '全下' }));
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

describe('加价步进器', () => {
  it('四档按实额累加，$40 永远是 $40（不随筹码量变化）', async () => {
    render(<ActionBar model={raiseModel()} onAction={vi.fn()} />);
    // 每一档都恰好把数字抬高那一档的实额（committed $40 是常数，不影响增量）
    await userEvent.click(screen.getByRole('button', { name: '+$40' }));
    expect(amountBoxText()).toBe('$200');
    await userEvent.click(screen.getByRole('button', { name: '+$100' }));
    expect(amountBoxText()).toBe('$300');
    await userEvent.click(screen.getByRole('button', { name: '+$1,000' }));
    expect(amountBoxText()).toBe('$1,300');
  });

  it('「重置」收回最小额——步进器只能往上，没有它就没有回头路', async () => {
    render(<ActionBar model={raiseModel()} onAction={vi.fn()} />);
    // 停在最小额时无处可退，按钮是禁用的
    expect(screen.getByRole('button', { name: '重置' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '+$1,000' }));
    expect(amountBoxText()).toBe('$1,160');
    await userEvent.click(screen.getByRole('button', { name: '重置' }));
    expect(amountBoxText()).toBe('$160');
  });

  // 加过头不夹到 max 而是禁用：夹的话点一下 "+$1,000" 就悄悄变成全下，
  // 而全下必须走它自己那颗按钮（主按钮文案会跟着变，用户才看得见）。
  it('剩余额度不够一档时那一档禁用，不会被夹成全下', async () => {
    const model = raiseModel();
    // 最多 4BB = $160，从 3BB = $120 起步，只剩 $40 的空间
    model.raise = { ...model.raise!, max: 4 };
    model.allin = { amount: 4 };
    render(<ActionBar model={model} onAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: '+$40' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '+$100' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '+$1,000' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '+$40' }));
    // 全下印的是推出去多少（4BB = $160），不加 committed
    expect(amountBoxText()).toBe('$160');
    // 恰好加满到 max，此时才是全下——主按钮的文案必须跟着变
    expect(screen.getByRole('button', { name: '全下 $160' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+$40' })).toBeDisabled();
  });

  it('区间变了就收回最小值，不残留一个已经非法的数字', async () => {
    const { rerender } = render(<ActionBar model={raiseModel()} onAction={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '全下' }));
    expect(amountBoxText()).toBe('$4,000');

    // 新的一街：额度区间整个变了
    const next = raiseModel();
    next.raise = { ...next.raise!, min: 8, max: 60 };
    rerender(<ActionBar model={next} onAction={vi.fn()} />);
    // 收回新区间的最小额 8BB，加注到 8 + committed 1 = 9BB = $360
    expect(amountBoxText()).toBe('$360');
  });
});

describe('没有加注权时', () => {
  it('整个上行都不出现，主按钮直接说全下', async () => {
    const onAction = vi.fn();
    const model: ActionBarModel = {
      enabled: true,
      fold: true,
      passive: { type: 'call', amount: 40 },
      raise: null,
      allin: { amount: 55 },
    };
    render(<ActionBar model={model} onAction={onAction} />);
    expect(document.querySelector('.raise-panel')).toBeNull();
    expect(screen.queryByRole('button', { name: '+$40' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '全下 $2,200' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'allin' });
  });
});
