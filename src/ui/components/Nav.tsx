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
 */
const ITEMS: readonly { id: PageId; label: string }[] = [
  { id: 'table', label: '牌桌' },
  { id: 'history', label: '历史' },
  { id: 'report', label: '报表' },
];

export function Nav({ page, onNav }: { page: PageId; onNav: (p: PageId) => void }) {
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
    </nav>
  );
}
