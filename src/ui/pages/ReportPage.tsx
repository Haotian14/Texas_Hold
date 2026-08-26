import { useEffect, useState } from 'react';
import type { ReportData, ReportWindow } from '../../storage/repo';
import { loadReport, ensureSummaries, reanalyzeStale, storageStatus } from '../../storage/repo';
import { analyzeHand } from '../../review/analyzeHand';
import { viewOf } from '../../review/view';
import type { HandView } from '../../review/view';
import type { HandRecord } from '../../core/types';
import {
  kpisOf,
  curveOf,
  trendOf,
  leakBarsOf,
  streetBarsOf,
  positionRowsOf,
  numText,
  toneOf,
  forceNegText,
  smoothPath,
} from '../reportModel';
import type { CurvePoint } from '../reportModel';
import { Button } from '../components/ui/button';
import { QuickToggles } from '../components/QuickToggles';

/**
 * 报表页（规格 §10.5，对应设计稿 Progress 屏）。
 *
 * 内容取舍与设计稿的差异（design-gap.md 「四、Progress 屏」一节）不是漏做，
 * 是既定取舍：设计稿的三张 KPI 卡换成手数/BB100/EV 损失、Win rate vs persona
 * 换成分位置盈亏、額外加一段设计稿没有的分街 EV 损失分布。视觉抄设计稿，
 * 内容以规格为准。
 */

const WINDOWS: readonly { id: ReportWindow; label: string }[] = [
  { id: 200, label: '最近 200' },
  { id: 500, label: '最近 500' },
  { id: 1000, label: '最近 1000' },
  { id: 'all', label: '全部' },
];

/** 四种空态之外，「统计可能不完整」是叠加在正常渲染上的一条注记，不是空态 */
type LoadState = 'loading' | 'ready' | 'unavailable' | 'partial-backfill';

const CURVE_W = 300;
const CURVE_H = 120;
/** 上下各留一点边，末点的圆点不然会被 viewBox 边缘削掉 */
const CURVE_PAD = 6;
/**
 * 横向也要留边，理由同上——末点恰好落在 x = CURVE_W 上时，圆点有一半在
 * 画布外。留 2.5 个 viewBox 单位，横向缩放约 2.9 倍后是 7px 上下，刚好
 * 兜住那个 6px 的点。
 */
const CURVE_PAD_X = 2.5;

/**
 * 内联 SVG 折线图，不引图表库（全局约束）。
 *
 * 定义域刻意把 0 纳入 min/max：这样"回本线"（cum = 0）恒落在可见范围内，
 * 曲线相对零轴的位置才有意义——只用数据自身的 min/max 会让全程为正的窗口
 * 把零轴挤到画布外，看不出"赢的这些到底有没有回过本"。
 * min === max（含"整段只有一手、且恰好是 0"这种退化情形）时不能除零，
 * 把线画在正中间的高度。
 */
function CurveChart({ points }: { points: CurvePoint[] }) {
  if (points.length === 0) return null;

  const cums = points.map(p => p.cum);
  const min = Math.min(0, ...cums);
  const max = Math.max(0, ...cums);
  const flat = min === max;
  const usable = CURVE_H - CURVE_PAD * 2;

  const yOf = (v: number): number =>
    flat ? CURVE_H / 2 : CURVE_PAD + (1 - (v - min) / (max - min)) * usable;
  const xOf = (idx: number): number =>
    points.length <= 1
      ? CURVE_W / 2
      : CURVE_PAD_X + (idx / (points.length - 1)) * (CURVE_W - CURVE_PAD_X * 2);

  const coords = points.map((p, idx) => [xOf(idx), yOf(p.cum)] as const);
  const linePath = smoothPath(coords);
  const firstX = coords[0]![0];
  const [lastX, lastY] = coords[coords.length - 1]!;
  // 填充区沿用同一条平滑路径，再垂直落到底边闭合——两者若一个曲一个折，
  // 填充的上沿会和线错开
  const areaPath = `M${firstX},${CURVE_H} L${firstX},${coords[0]![1]} ${linePath.slice(1)} L${lastX},${CURVE_H} Z`;
  const zeroY = yOf(0);

  return (
    <svg
      viewBox={`0 0 ${CURVE_W} ${CURVE_H}`}
      preserveAspectRatio="none"
      className="rep-curve-svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="repCurveFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--blue)" stopOpacity={0.16} />
          <stop offset="100%" stopColor="var(--blue)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <line
        x1={0}
        y1={CURVE_H * 0.25}
        x2={CURVE_W}
        y2={CURVE_H * 0.25}
        stroke="var(--line)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={0}
        y1={CURVE_H * 0.55}
        x2={CURVE_W}
        y2={CURVE_H * 0.55}
        stroke="var(--line)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {/* 回本线：cum = 0 的水平线，虚线——它是这张图最该让人先看到的刻度 */}
      <line
        x1={0}
        y1={zeroY}
        x2={CURVE_W}
        y2={zeroY}
        stroke="var(--line-2)"
        strokeWidth={1}
        strokeDasharray="4 4"
        vectorEffect="non-scaling-stroke"
      />
      <path d={areaPath} fill="url(#repCurveFill)" />
      <path
        d={linePath}
        fill="none"
        stroke="var(--blue)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* 末点用「零长度线段 + 圆头线帽」画，而不是 <circle>：viewBox 被
          非等比拉伸，circle 会变成椭圆，而线帽的粗细走 non-scaling-stroke，
          在屏幕上恒是正圆。直径 = strokeWidth。 */}
      <path
        d={`M${lastX},${lastY} L${lastX},${lastY}`}
        stroke="var(--blue)"
        strokeWidth={6}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function ReportBody({ data }: { data: ReportData }) {
  const s = data.stats;
  const kpis = kpisOf(s);
  const curvePoints = curveOf(s.netSeries);
  const trend = trendOf(s.netSeries);
  const leakBars = leakBarsOf(s);
  const streetBars = streetBarsOf(s);
  const posRows = positionRowsOf(s);
  const midPoint = curvePoints[Math.floor((curvePoints.length - 1) / 2)];

  return (
    <>
      <div className="rep-kpis">
        {kpis.map(k => (
          <div key={k.key} className="rep-kpi">
            <div className="rep-kpi-label">{k.label}</div>
            <div className={`rep-kpi-value rep-kpi-value-${k.tone}`}>
              {k.value}
              {k.unit !== null && <span className="rep-kpi-unit">{k.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="rep-main">
        <div className="rep-card rep-curve-card">
          <div className="rep-card-title">累计净盈亏</div>
          <CurveChart points={curvePoints} />
          <div className="rep-curve-axis">
            <span>第 {curvePoints[0]!.i} 手</span>
            {midPoint !== undefined && <span>第 {midPoint.i} 手</span>}
            <span>第 {curvePoints[curvePoints.length - 1]!.i} 手</span>
          </div>
          <div className="rep-trend">{trend.text}</div>
        </div>

        <div className="rep-side">
          <div className="rep-card rep-bars-card">
            <div className="rep-card-title">漏洞排行榜</div>
            {leakBars.length === 0 ? (
              <p className="rep-side-empty">这段窗口没有记录到失误。</p>
            ) : (
              leakBars.map(l => (
                <div key={l.tag} className="rep-bar-row">
                  <div className="rep-bar-line">
                    <span className="rep-bar-name">{l.label}</span>
                    <span className="rep-bar-count">×{l.count}</span>
                    <span className="rep-bar-amount">{forceNegText(l.evLoss)} BB</span>
                  </div>
                  <div className="rep-bar-track">
                    <div className="rep-bar-fill" style={{ width: `${l.pct}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="rep-card rep-bars-card">
            <div className="rep-card-title">分街 EV 损失</div>
            {streetBars.map(b => (
              <div key={b.street} className="rep-bar-row">
                <div className="rep-bar-line">
                  <span className="rep-bar-name">{b.label}</span>
                  <span className="rep-bar-amount">{forceNegText(b.evLoss)} BB</span>
                </div>
                <div className="rep-bar-track">
                  <div className="rep-bar-fill" style={{ width: `${b.pct}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="rep-card rep-pos-card">
            <div className="rep-card-title">分位置盈亏</div>
            {posRows.map(p => (
              <div key={p.position} className="rep-pos-row">
                <span
                  className={`rep-pos-dot rep-pos-dot-${
                    p.bb100 === null ? 'neutral' : toneOf(p.bb100)
                  }`}
                  aria-hidden="true"
                />
                <span className="rep-pos-name">{p.position}</span>
                <span className="rep-pos-rate">
                  {p.bb100 === null ? '—' : `${numText(p.bb100)} BB/100`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * 重跑一手的分析。抛错按「这一手分析失败」处理（view 记 null），与 App.tsx
 * 手牌结束后那段 try/catch 是同一套语义 —— 算不出来不该掀掉页面。
 */
function reanalyze(record: HandRecord): HandView | null {
  try {
    return viewOf(analyzeHand(record));
  } catch {
    return null;
  }
}

export function ReportPage({
  onSettings,
  onHandRanks,
}: {
  onSettings: () => void;
  /** 打开牌型大小对照 */
  onHandRanks: () => void;
}) {
  const [win, setWin] = useState<ReportWindow>(200);
  const [data, setData] = useState<ReportData | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    // 快速连点窗口档时，先发的请求可能后到，把新窗口的数据覆盖成旧的——
    // alive 这道闸就是挡这个的。
    let alive = true;
    setState('loading');
    void (async () => {
      // 判定规则变过之后，库里的旧结论是按旧规则算出来的，直接聚合会把两套
      // 规则的 evLoss 混进同一个数。重跑放在报表页而不是启动路径上，理由与
      // ensureSummaries 相同：从不看报表的用户不该为这次全表扫描买单。
      // 每手之间有一次 await（IndexedDB 写入），所以阻塞是一手一帧，
      // 不是一次几十秒 —— 与 App.tsx 里"每手算一次复盘"的代价同量级。
      await reanalyzeStale(reanalyze);
      const filled = await ensureSummaries();
      const out = await loadReport(win);
      if (!alive) return;
      setData(out);
      setState(
        storageStatus() === 'unavailable' ? 'unavailable' : filled ? 'ready' : 'partial-backfill',
      );
    })();
    return () => {
      alive = false;
    };
  }, [win]);

  // partial（窗口比库大）不是空态：选了「最近 1000 手」但库里只有 37 手的
  // 新用户必须照常看到报表，只在窗口控件旁标注实际手数。
  const noHands = data !== null && data.stats.hands === 0;
  const showEmpty: 'loading' | 'unavailable' | 'no-data' | null =
    state === 'loading'
      ? 'loading'
      : state === 'unavailable'
        ? 'unavailable'
        : noHands
          ? 'no-data'
          : null;

  return (
    <div className="rep">
      <header className="rep-head">
        <h2 className="rep-title">报表</h2>
        <div className="rep-win">
          {WINDOWS.map(w => (
            <Button
              key={String(w.id)}
              size="sm"
              variant={w.id === win ? 'outline' : 'ghost'}
              className={
                w.id === win
                  ? 'border-primary/30 bg-accent text-accent-foreground'
                  : 'border border-input text-secondary-foreground'
              }
              aria-pressed={w.id === win}
              onClick={() => setWin(w.id)}
            >
              {w.label}
            </Button>
          ))}
        </div>
        {/* 设置不再有自己的导航项（收进了右上角齿轮），所以每一页的页头都要
            有一个入口——只在牌桌页给的话，用户在这一页会找不到它 */}
        <QuickToggles tableToggles={false} onSettings={onSettings} onHandRanks={onHandRanks} />
        {/* 库里一手都没有时已经在下面用「还没有记录」说清楚了，这里不重复 */}
        {data !== null && data.partial && !noHands && (
          <span className="rep-partial-note">库里共 {data.stats.hands} 手</span>
        )}
        {state === 'partial-backfill' && (
          <span className="rep-backfill-note">统计可能不完整</span>
        )}
      </header>

      {showEmpty !== null ? (
        <p className="rep-empty">
          {showEmpty === 'loading' && '读取中…'}
          {/* 与顶栏「未记录」同源——本机存储不可用时两处都这么说 */}
          {showEmpty === 'unavailable' && '本机存储不可用，报表无法统计。'}
          {showEmpty === 'no-data' && '还没有记录，先去牌桌打几手。'}
        </p>
      ) : (
        data !== null && <ReportBody data={data} />
      )}

      {/* 规格 §12 要求把这条局限性说明摆在界面上 */}
      <p className="rep-note">EV 数字为近似估算，非 solver 输出。</p>
    </div>
  );
}
