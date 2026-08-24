/**
 * 界面图标。
 *
 * 全部内联成 React 组件，不引第三方图标库：整个 UI 层的运行时依赖只有 React
 * 一项（见 README 技术栈），为两颗按钮拉进一个几百个图标的包不划算，而按需
 * 引入又要多配一层 tree-shaking 才能保证 bundle 不变大。
 *
 * 图形取自 Lucide（ISC 许可，https://lucide.dev），路径原样照抄，只把 24×24
 * 画布上的固定尺寸换成跟随字号的 1em——这样图标与旁边的文字一起缩放，改
 * `.nav-mute` 的 font-size 就够了，不必两处对齐。描边用 `currentColor`，
 * 选中态/悬停态继续由 CSS 的 color 控制，和原来那两个字符行为一致。
 *
 * `aria-hidden`：图标本身不携带信息，可访问名字由外层按钮的 aria-label 给。
 */

/** Lucide 的公共几何参数。三个图标共用，避免三处各写一遍描边宽度 */
const base = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: '1em',
  height: '1em',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

/** 喇叭 + 两道声波（Lucide `volume-2`）。有声状态 */
export function IconVolumeOn() {
  return (
    <svg {...base} className="icon">
      <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
      <path d="M16 9a5 5 0 0 1 0 6" />
      <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
    </svg>
  );
}

/** 喇叭 + 叉（Lucide `volume-x`）。静音状态 */
export function IconVolumeOff() {
  return (
    <svg {...base} className="icon">
      <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
      <line x1="22" x2="16" y1="9" y2="15" />
      <line x1="16" x2="22" y1="9" y2="15" />
    </svg>
  );
}

/**
 * 百分号（Lucide `percent`）。胜率读数开关。
 *
 * 没用饼图/柱状图那一类「统计」图标：导航里已经有一项「报表」，再放一个
 * 图表形状的图标会让人以为这颗按钮通向那一页。百分号指向的是牌桌上那个
 * 数字本身。
 */
export function IconPercent() {
  return (
    <svg {...base} className="icon">
      <line x1="19" x2="5" y1="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  );
}
