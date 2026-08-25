// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from './SettingsPage';
import type { SettingsPageProps } from './SettingsPage';
import { resetAll, storageStatus } from '../../storage/repo';

/**
 * 设置页的渲染冒烟测试。
 *
 * 这一层测试是为「把手写控件换成组件库」这次重构专门补的。它**不测样式**，
 * 只钉住换库时最容易悄悄弄坏的那几件事：开关的取值方向、二次确认的两步语义、
 * 以及那个条件渲染的震动项。这些坏掉之后界面看起来完全正常——开关照样能点、
 * 按钮照样有反应——但行为是反的或少了一步，手点验证很容易漏过去。
 *
 * 存储层整个替换掉：这一页对它只有三个调用，而真的接 IndexedDB 会把一个
 * 渲染测试变成一个集成测试。
 */
vi.mock('../../storage/repo', () => ({
  allHands: vi.fn(async () => []),
  importHands: vi.fn(async () => ({ ok: true, imported: 0 })),
  resetAll: vi.fn(async () => true),
  storageStatus: vi.fn(() => 'ready' as const),
}));

function props(over: Partial<SettingsPageProps> = {}): SettingsPageProps {
  return {
    aiMode: 'personas',
    onAiMode: vi.fn(),
    fastMode: false,
    onFastMode: vi.fn(),
    vibrate: false,
    onVibrate: vi.fn(),
    autoReview: true,
    onAutoReview: vi.fn(),
    showEquity: false,
    onShowEquity: vi.fn(),
    muted: false,
    onMuted: vi.fn(),
    onDataReset: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storageStatus).mockReturnValue('ready');
});

// 控件的 role 是 switch 而不是 checkbox：Radix 的 Switch 渲染
// role="switch"，读屏会念「开/关」而不是「已选中/未选中」，这正是
// 这类"立刻生效的开关"该有的语义
describe('设置页的开关', () => {
  it('checked 状态跟着 props 走，不自己记状态', () => {
    render(<SettingsPage {...props({ fastMode: true, autoReview: false })} />);
    expect(screen.getByRole('switch', { name: /极速模式/ })).toBeChecked();
    expect(screen.getByRole('switch', { name: /结算后自动打开复盘/ })).not.toBeChecked();
  });

  it('点一下把「取反后的值」交给回调', async () => {
    const p = props({ fastMode: false });
    render(<SettingsPage {...p} />);
    await userEvent.click(screen.getByRole('switch', { name: /极速模式/ }));
    expect(p.onFastMode).toHaveBeenCalledWith(true);
  });

  // 音效这一项在 props 上叫 muted，在界面上叫「音效」——两者是反的。
  // 换控件时把这一层取反弄丢，界面会变成「打开音效 = 静音」。
  it('音效项与 muted 是反的：muted=false 时开关是开着的', () => {
    render(<SettingsPage {...props({ muted: false })} />);
    expect(screen.getByRole('switch', { name: /音效/ })).toBeChecked();
  });

  it('音效项与 muted 是反的：关掉音效等于 onMuted(true)', async () => {
    const p = props({ muted: false });
    render(<SettingsPage {...p} />);
    await userEvent.click(screen.getByRole('switch', { name: /音效/ }));
    expect(p.onMuted).toHaveBeenCalledWith(true);
  });
});

describe('震动项只在设备支持时出现', () => {
  it('navigator.vibrate 不存在时整项不渲染', () => {
    render(<SettingsPage {...props()} />);
    expect(screen.queryByRole('switch', { name: /震动/ })).not.toBeInTheDocument();
  });

  it('navigator.vibrate 存在时渲染出来', () => {
    vi.stubGlobal('navigator', { ...navigator, vibrate: () => true });
    render(<SettingsPage {...props()} />);
    expect(screen.getByRole('switch', { name: /震动/ })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

describe('AI 模式二选一', () => {
  it('当前值那一颗被标为选中，另一颗不是', () => {
    render(<SettingsPage {...props({ aiMode: 'personas' })} />);
    expect(screen.getByRole('button', { name: '原型池' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '全 GTO' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('点另一颗把新值交出去', async () => {
    const p = props({ aiMode: 'personas' });
    render(<SettingsPage {...p} />);
    await userEvent.click(screen.getByRole('button', { name: '全 GTO' }));
    expect(p.onAiMode).toHaveBeenCalledWith('gto');
  });
});

describe('重置数据的二次确认', () => {
  // 这是全项目唯一一个不可撤销的破坏性操作。二次确认在换成对话框之后
  // 必须仍然是两步——「点一下就清空」是这次重构最坏的可能结果。
  it('点「重置」不清空任何东西，只进入确认态', async () => {
    render(<SettingsPage {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: '重置' }));
    expect(resetAll).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '确认清空' })).toBeInTheDocument();
  });

  it('确认之后才真的清空，并通知 App 归零会话', async () => {
    const p = props();
    render(<SettingsPage {...p} />);
    await userEvent.click(screen.getByRole('button', { name: '重置' }));
    await userEvent.click(screen.getByRole('button', { name: '确认清空' }));
    expect(resetAll).toHaveBeenCalledTimes(1);
    expect(p.onDataReset).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent('已清空');
  });

  it('取消退回原样，什么都没删', async () => {
    render(<SettingsPage {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: '重置' }));
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(resetAll).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '重置' })).toBeInTheDocument();
  });

  it('存储不可用时按钮是禁用的', () => {
    vi.mocked(storageStatus).mockReturnValue('unavailable');
    render(<SettingsPage {...props()} />);
    expect(screen.getByRole('button', { name: '重置' })).toBeDisabled();
  });
});
