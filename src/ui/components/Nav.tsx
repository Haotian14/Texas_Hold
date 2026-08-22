import { chipsGreater } from '../../core/chips';
import { chips } from '../format';

export type PageId = 'table' | 'history' | 'report';

/**
 * 主导航。
 *
 * 一份 DOM 两种版式：宽屏是设计稿那条 190px 左侧栏，窄屏折成顶部的一条分段
 * 控件（全部由 CSS 控制，见 app.css 的 .nav）。写成两套 DOM 再按屏宽二选一
 * 的话，两边的可访问性属性、选中态、键盘顺序都得各维护一遍。
 *
 * 三项：牌桌（正在打的这一手）、历史（已存的手牌列表，规格 §10.4）、
 * 报表（规格 §10.5 的漏洞报表，对应设计稿的 Progress 屏）。
 *
 * 底部「会话盈亏」区块是设计稿三屏左栏共有的部分（不是牌桌专属），所以
 * 净盈亏/买入/静音这几个 prop 挂在这里而不是 TopBar——Nav 本来就是三个
 * 页面共用的组件，切到历史/报表页时这块信息照样要显示。
 */
const ITEMS: readonly { id: PageId; label: string }[] = [
  { id: 'table', label: '牌桌' },
  { id: 'history', label: '历史' },
  { id: 'report', label: '报表' },
];

export function Nav({
  page,
  onNav,
  netBB,
  totalBuyIn,
  muted,
  onToggleMute,
}: {
  page: PageId;
  onNav: (p: PageId) => void;
  /** hero 本次会话累计净盈亏，BB */
  netBB: number;
  /** hero 本次会话累计买入，BB */
  totalBuyIn: number;
  muted: boolean;
  onToggleMute: () => void;
}) {
  const isNeg = chipsGreater(0, netBB);
  return (
    <nav className="nav" aria-label="主导航">
      <div className="nav-brand">
        <span className="nav-logo" aria-hidden="true">
          ♠
        </span>
        <span className="nav-title">德州扑克训练器</span>
      </div>
      <div className="nav-items">
        {ITEMS.map(item => (
          <button
            key={item.id}
            type="button"
            className={item.id === page ? 'nav-item nav-item-on' : 'nav-item'}
            onClick={() => onNav(item.id)}
            // 当前页用 aria-current 而不是只靠一个蓝点：那个点是 aria-hidden
            // 的装饰，读屏用户只能从这里知道自己在哪一页
            aria-current={item.id === page ? 'page' : undefined}
          >
            <span className="nav-dot" aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </div>
      <div className="nav-session">
        <div className="nav-session-head">
          <span className="nav-session-label">会话盈亏</span>
          <button
            type="button"
            className="nav-mute"
            onClick={onToggleMute}
            aria-pressed={muted}
            title={muted ? '取消静音' : '静音'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
        <div className={`nav-session-net ${isNeg ? 'neg' : 'pos'}`}>
          {isNeg ? '' : '+'}
          {chips(netBB)}
        </div>
        <div className="nav-session-buyin">买入 {chips(totalBuyIn)}</div>
      </div>
    </nav>
  );
}
