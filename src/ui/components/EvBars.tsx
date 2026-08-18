import type { BarChart } from '../reviewModel';

/**
 * EV 条形图。纯 CSS 宽度百分比手画，不引图表库。
 *
 * 组件里没有任何算术 —— 位置与宽度全部由 reviewModel.barsOf 算好并测过。
 * 数字单位是 BB，不换算实额（见 format.ts 顶部关于复盘数字保持 BB 的注释）。
 */
export function EvBars({ chart }: { chart: BarChart }) {
  if (chart.bars.length === 0) return null;
  return (
    <div className="ev-bars">
      {/* 零点基线：负 EV 的条向左伸、右端贴住它。
          外面必须套一层 .ev-zero-layer —— zeroPct 与条的 leftPct 是同一
          套坐标，而条定位在 .ev-track（grid 的 1fr 列）里，基线直接挂在
          .ev-bars 上就会按整宽解析，两者对不齐。见 CSS 里的注释。 */}
      <div className="ev-zero-layer" aria-hidden="true">
        <div className="ev-zero" style={{ left: `${chart.zeroPct}%` }} />
      </div>
      {chart.bars.map(b => (
        <div className="ev-row" key={b.label}>
          <span className="ev-label">{b.label}</span>
          <span className="ev-track">
            <span
              className={
                'ev-fill' +
                (b.isRecommended ? ' ev-rec' : '') +
                (b.isActual ? ' ev-actual' : '')
              }
              style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }}
            />
          </span>
          <span className="ev-value">
            {b.ev.toFixed(2)} BB
            {b.isActual ? <span className="ev-mark">你选的</span> : null}
            {b.isRecommended ? <span className="ev-mark ev-mark-rec">推荐</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
