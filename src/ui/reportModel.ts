import type { Street, Position } from '../core/types';
import type { MistakeTag } from '../review/taxonomy';
import type { WindowStats } from '../storage/summary';
import { bb100, trend, leaks } from '../storage/stats';
import { round2, isZeroChips, chipsGreater } from '../core/chips';
import { TAG_TEXT } from './reviewModel';

/**
 * 报表页（规格 §10.5）的纯数据变形层。UI 组件不写自动化测试（③-B 定下、
 * ③-C 沿用的分层），所有可测的判断、归一化、格式化都下沉到这里，
 * React 组件只管拿这些函数的输出往上摆。
 *
 * 内部量纲一律 BB，本模块不做实额换算——BB/100 与 EV 损失都是 BB 量纲
 * 的通用口径，换算成筹码额是 format.ts::chips() 的事，不是这里的事。
 */

/** 数值转文字，负号用 U+2212（−）而不是 ASCII 连字符，浮点比较走
    isZeroChips / chipsGreater，不裸比较——BB 量纲的加减会留下浮点尾数 */
function numText(v: number, decimals = 1): string {
  if (isZeroChips(v)) return (0).toFixed(decimals);
  return chipsGreater(v, 0) ? v.toFixed(decimals) : `−${Math.abs(v).toFixed(decimals)}`;
}

/**
 * EV 损失卡专用：不管数值本身是不是 0，恒显示负号。
 *
 * 它表示「本该更好却没做到多少」，是一个永远该被扣掉的量，不是一次
 * 盈亏——不能因为这段时间碰巧没漏（值为 0）就让它看起来像个中性数字。
 */
function forceNegText(magnitude: number, decimals = 1): string {
  return `−${Math.abs(magnitude).toFixed(decimals)}`;
}

export interface Kpi {
  key: 'hands' | 'bb100' | 'leak';
  label: string;
  value: string;
  unit: string | null;
  tone: 'neutral' | 'positive' | 'negative';
}

const STREET_ORDER: readonly Street[] = ['preflop', 'flop', 'turn', 'river'];

/**
 * 三张 KPI 卡：手数、BB/100（战绩）、每百手 EV 损失（漏洞）。
 *
 * BB/100 与 EV 损失是两个独立的数，量纲相同但含义不同——前者是「你赢了
 * 多少」，后者是「你本该更好却没做到多少」。一段时间里完全可能双高：
 * 赢着钱的同时也在漏钱，那正是报表最该让人看见的情形，所以 EV 损失卡
 * 的颜色不能跟着盈亏走：它恒红、恒负号（见 forceNegText）。
 */
export function kpisOf(s: WindowStats): Kpi[] {
  const winrate = bb100(s.hands, s.netBB);
  // 四街之和用 round2 逐步累加，与 aggregate/applyHand 里同样口径的
  // 累加方式保持一致，避免浮点尾数在这里单独冒出来
  const totalEvLoss = STREET_ORDER.reduce((acc, st) => round2(acc + s.byStreet[st]), 0);
  const evLossPer100 = bb100(s.hands, totalEvLoss);

  return [
    { key: 'hands', label: '手数', value: String(s.hands), unit: '手', tone: 'neutral' },
    {
      key: 'bb100',
      label: 'BB/100',
      value: numText(winrate),
      unit: 'BB/100',
      tone: isZeroChips(winrate) ? 'neutral' : chipsGreater(winrate, 0) ? 'positive' : 'negative',
    },
    {
      key: 'leak',
      label: '每百手 EV 损失',
      value: forceNegText(evLossPer100),
      unit: 'BB/100',
      tone: 'negative',
    },
  ];
}

export const MAX_POINTS = 240;

export interface CurvePoint {
  i: number;
  cum: number;
}

/**
 * 净盈亏曲线：先把整段窗口累计成折线，超过 MAX_POINTS 时再等距抽样。
 *
 * 抽样取累计值本身，不做区间平均——平均会把回撤削平，那是在美化数据。
 * 曲线的用处恰恰是让人看见那些坑：一段前赢后亏、首尾都归零的窗口，
 * 平均法会抹平中间的峰谷，只有直接取样才留得住「亏光了又赢回来」这件事。
 *
 * 采样公式 `Math.round(k * (n - 1) / (MAX_POINTS - 1))`：k 取遍
 * 0..MAX_POINTS-1 时，k=0 精确落到第一个点、k=MAX_POINTS-1 精确落到
 * 最后一个点——首尾必须保留，不然曲线看起来会在两端凭空截断。
 */
export function curveOf(netSeries: readonly number[]): CurvePoint[] {
  const all: CurvePoint[] = [];
  let cum = 0;
  for (let i = 0; i < netSeries.length; i++) {
    cum = round2(cum + netSeries[i]!);
    all.push({ i: i + 1, cum });
  }
  if (all.length <= MAX_POINTS) return all;

  const out: CurvePoint[] = [];
  for (let k = 0; k < MAX_POINTS; k++) {
    out.push(all[Math.round((k * (all.length - 1)) / (MAX_POINTS - 1))]!);
  }
  return out;
}

export interface TrendView {
  current: number | null;
  previous: number | null;
  text: string;
}

/**
 * 最近 100 手 vs 之前 100 手的趋势。判断本身全在 stats.ts::trend()——
 * 那边已经决定了「样本不足时该返回 null 而不是硬算」，这里只管把
 * 两个数字（或 null）套成一句人话。
 */
export function trendOf(netSeries: readonly number[]): TrendView {
  const t = trend(netSeries, 100);
  if (t.current === null || t.previous === null) {
    return { ...t, text: '样本不足（需 200 手）' };
  }
  return {
    ...t,
    text: `最近 100 手 ${numText(t.current)} BB/100 · 之前 100 手 ${numText(t.previous)} BB/100`,
  };
}

export interface LeakBar {
  tag: MistakeTag;
  label: string;
  count: number;
  evLoss: number;
  pct: number;
}

/**
 * 漏洞排行榜的条形宽度。榜单顺序、过滤（次数为 0 不上榜）全部来自
 * stats.ts::leaks()，这里只负责把 evLoss 换算成相对榜首的百分比宽度。
 *
 * 榜首 evLoss 为 0 时（有次数但损失全是 0，理论上会发生：某分类恰好每次
 * 都没造成可计的 EV 损失）不能拿它当除数，全部记 0 宽——除以 0 只会
 * 得到 NaN/Infinity，没有别的意义。
 */
export function leakBarsOf(s: WindowStats): LeakBar[] {
  const rows = leaks(s.byTag);
  if (rows.length === 0) return [];
  const top = rows[0]!.evLoss;
  return rows.map(r => ({
    tag: r.tag,
    label: TAG_TEXT[r.tag],
    count: r.count,
    evLoss: r.evLoss,
    pct: isZeroChips(top) ? 0 : round2((r.evLoss / top) * 100),
  }));
}

export interface StreetBar {
  street: Street;
  label: string;
  evLoss: number;
  pct: number;
}

/** Record<Street, string> 而不是普通对象：Street 加成员时这里编译失败，
    而不是在报表上少画一段 */
const STREET_LABEL: Record<Street, string> = {
  preflop: '翻前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
};

/**
 * 分街 EV 损失占比。四段恒在（哪怕某街一次都没发生过 EV 损失），
 * 顺序固定为翻前→河牌——用户按牌局自然顺序读表，不按数值排序。
 *
 * 四街之和为 0 时（这段窗口一次失误都没有）不做除法，全部记 0 宽。
 */
export function streetBarsOf(s: WindowStats): StreetBar[] {
  const total = STREET_ORDER.reduce((acc, st) => round2(acc + s.byStreet[st]), 0);
  return STREET_ORDER.map(st => ({
    street: st,
    label: STREET_LABEL[st],
    evLoss: s.byStreet[st],
    pct: isZeroChips(total) ? 0 : round2((s.byStreet[st] / total) * 100),
  }));
}

export interface PositionRow {
  position: Position;
  hands: number;
  bb100: number | null;
}

const POSITION_ROW_ORDER: readonly Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

/**
 * 分位置战绩。六个位置恒在，顺序固定 UTG→BB，方便逐行对比。
 *
 * 没打过的位置（hands === 0）bb100 记 null 而不是 0——0 会被读成
 * 「打了但不赚不亏」，null 才对应界面上该显示的破折号「这个位置还没有
 * 样本」。hands 是手数计数，不是 BB 量纲，用裸 === 判断，与
 * stats.ts::bb100() 内部同一处判断口径一致。
 */
export function positionRowsOf(s: WindowStats): PositionRow[] {
  return POSITION_ROW_ORDER.map(p => {
    const stat = s.byPosition[p];
    return {
      position: p,
      hands: stat.hands,
      bb100: stat.hands === 0 ? null : bb100(stat.hands, stat.netBB),
    };
  });
}
