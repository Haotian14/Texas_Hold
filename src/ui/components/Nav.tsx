import { chipsGreater } from '../../core/chips';
import { chips } from '../format';

/**
 * 「历史」不在导航里：它是复盘页右栏底部那颗「全部手牌」按钮的去处，
 * 不是一个平级的顶层页面（设计稿三屏里也没有它，见 design-gap.md 第三节）。
 * 它仍然是一个 PageId —— 页面切换只有这一套状态，为它另开一个布尔量会让
 * 「现在到底在哪一页」有两个来源。
 */
export type PageId = 'table' | 'review' | 'history' | 'report';

/**
 * 主导航。
 *
 * 一份 DOM 两种版式：宽屏是设计稿那条 190px 左侧栏，窄屏折成顶部的一条分段
 * 控件（全部由 CSS 控制，见 app.css 的 .nav）。写成两套 DOM 再按屏宽二选一
 * 的话，两边的可访问性属性、选中态、键盘顺序都得各维护一遍。
 *
 * 三项：牌桌（正在打的这一手）、复盘（对应设计稿的 Hand Review 屏，显示
 * 最近打完或从历史选中的那一手）、报表（规格 §10.5 的漏洞报表，对应设计稿
 * 的 Progress 屏）。历史列表（规格 §10.4）是复盘页的下一级，从那一页的
 * 「全部手牌」按钮进，所以在这里高亮的仍是「复盘」。
 *
 * 底部「会话盈亏」区块是设计稿三屏左栏共有的部分（不是牌桌专属），所以
 * 净盈亏/买入/静音这几个 prop 挂在这里而不是 TopBar——Nav 本来就是三个
 * 页面共用的组件，切到历史/报表页时这块信息照样要显示。
 */
const ITEMS: readonly { id: PageId; label: string }[] = [
  { id: 'table', label: '牌桌' },
  { id: 'review', label: '复盘' },
  { id: 'report', label: '报表' },
];

export function Nav({
  page,
  onNav,
  netBB,
  totalBuyIn,
  muted,
  onToggleMute,
  showEquity,
  onToggleEquity,
}: {
  page: PageId;
  onNav: (p: PageId) => void;
  /** hero 本次会话累计净盈亏，BB */
  netBB: number;
  /** hero 本次会话累计买入，BB */
  totalBuyIn: number;
  muted: boolean;
  onToggleMute: () => void;
  showEquity: boolean;
  onToggleEquity: () => void;
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
        {ITEMS.map(item => {
          // 历史页高亮「复盘」：它是复盘的下一级，不高亮任何一项会让用户在
          // 那一页看不出自己身处应用的哪一块
          const on = item.id === page || (item.id === 'review' && page === 'history');
          return (
          <button
            key={item.id}
            type="button"
            className={on ? 'nav-item nav-item-on' : 'nav-item'}
            onClick={() => onNav(item.id)}
            // 当前页用 aria-current 而不是只靠一个蓝点：那个点是 aria-hidden
            // 的装饰，读屏用户只能从这里知道自己在哪一页
            aria-current={on ? 'page' : undefined}
          >
            <span className="nav-dot" aria-hidden="true" />
            {item.label}
          </button>
          );
        })}
      </div>
      <div className="nav-session">
        <div className="nav-session-head">
          <span className="nav-session-label">会话盈亏</span>
          {/* 胜率开关与静音并排：两者是同一类东西——纯显示偏好、随时可切、
              存 localStorage、与对局状态无关。放在设置页更"正确"，但设置页
              是 ③-D-3，而一个训练辅助开关埋进二级页面等于没有。 */}
          <button
            type="button"
            className={showEquity ? 'nav-mute nav-toggle-on' : 'nav-mute'}
            onClick={onToggleEquity}
            aria-pressed={showEquity}
            title={showEquity ? '隐藏胜率' : '显示胜率'}
          >
            %
          </button>
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
