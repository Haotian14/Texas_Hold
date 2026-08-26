import { BarChart3, ClipboardList, Spade } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

/**
 * 「历史」不在导航里：它是复盘页右栏底部那颗「全部手牌」按钮的去处，
 * 不是一个平级的顶层页面。它仍然是一个 PageId —— 页面切换只有这一套状态，
 * 为它另开一个布尔量会让「现在到底在哪一页」有两个来源。
 *
 * 「设置」也不在导航里了：它收进了右上角的齿轮（见 QuickToggles）。理由是
 * 手机上底部导航一行放三项才够手指点——四项挤在 360px 宽上每项只有 90px，
 * 而设置是全项目里打开频率最低的一页，让它占一个常驻位置不划算。
 */
export type PageId = 'table' | 'review' | 'history' | 'report' | 'settings' | 'handRanks';

/**
 * 主导航。
 *
 * 一份 DOM 两种版式：宽屏是设计稿那条 190px 左侧栏，窄屏折成**底部**的一条
 * 标签栏（全部由 CSS 控制，见 app.css 的 .nav）。写成两套 DOM 再按屏宽二选一
 * 的话，两边的可访问性属性、选中态、键盘顺序都得各维护一遍。
 *
 * 手机上放底部而不是顶部：牌桌页的纵向空间全靠顶上那一条让出来，而拇指
 * 够得到的也是屏幕下缘。图标 + 文字两行，是移动端标签栏的通行版式——
 * 只有文字的话，一条 56px 高的横条上三个词会显得空且不好点。
 */
const ITEMS: readonly { id: PageId; label: string; Icon: typeof Spade }[] = [
  { id: 'table', label: '牌桌', Icon: Spade },
  { id: 'review', label: '复盘', Icon: ClipboardList },
  { id: 'report', label: '报表', Icon: BarChart3 },
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
        {ITEMS.map(({ id, label, Icon }) => {
          // 历史页高亮「复盘」：它是复盘的下一级，不高亮任何一项会让用户在
          // 那一页看不出自己身处应用的哪一块。设置页与牌型页同理挂在「牌桌」
          // 上——它们是从牌桌页右上角进去的，返回也回到那里。
          const on =
            id === page ||
            (id === 'review' && page === 'history') ||
            (id === 'table' && (page === 'settings' || page === 'handRanks'));
          return (
            <Button
              key={id}
              variant="ghost"
              // min-h-0 与 justify-start 把 Button 默认尺寸档里那两条中和掉：
              // .nav-item 自己没写 min-height 和 justify-content
              className={cn('min-h-0 justify-start', on ? 'nav-item nav-item-on' : 'nav-item')}
              onClick={() => onNav(id)}
              // 当前页用 aria-current 而不是只靠一个蓝点：那个点是 aria-hidden
              // 的装饰，读屏用户只能从这里知道自己在哪一页
              aria-current={on ? 'page' : undefined}
            >
              <span className="nav-dot" aria-hidden="true" />
              <Icon className="nav-icon" aria-hidden="true" />
              {label}
            </Button>
          );
        })}
      </div>
    </nav>
  );
}
