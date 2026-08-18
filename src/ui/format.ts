import type { Card } from '../core/cards';
import type { ActionType } from '../core/types';

/**
 * 一个大盲等于多少筹码。
 *
 * 这是整个项目里唯一的 BB ↔ 实额换算点。内部量纲（core / ai / review /
 * session）一律是 BB —— 范围表的标定、EV 的单位、534 个测试全都建立在
 * BB 上。实额只是显示。若日后要改盲注级别，只动这一个常量。
 *
 * 例外：EV 损失与复盘数字保持 BB。「你这一步亏了 2.3BB」比「亏了 92」
 * 有意义得多，且跨盲注级别可比。
 */
export const CHIPS_PER_BB = 40;

/** BB → 实额字符串，带千位分隔，取整到个位 */
export function chips(bb: number): string {
  const v = Math.round(bb * CHIPS_PER_BB) || 0;
  return v.toLocaleString('en-US');
}

/**
 * 实额筹码面额，从大到小。20 是最小下注单位（半个大盲）。
 * chipDenominations 的贪心拆分依赖这个降序。
 */
export const CHIP_DENOMINATIONS: readonly number[] = [1000, 500, 100, 20];

/** 一堆筹码最多画几枚。超出的不画——筹码堆是示意，旁边的数字才是权威 */
export const MAX_CHIPS_DRAWN = 5;

/**
 * BB 金额 → 从大到小的面额数组（实额），供界面画筹码堆。
 *
 * 贪心拆分。循环在两种情况下结束，两种都会留下不再表示的余额：
 * 画满 MAX_CHIPS_DRAWN 枚，或剩余额小于最小面额（20）放不下任何一枚。
 * 这是有意的——调用方必须同时用 chips() 显示精确金额。
 */
export function chipDenominations(bb: number): number[] {
  let remaining = Math.abs(Math.round(bb * CHIPS_PER_BB));
  const out: number[] = [];
  while (out.length < MAX_CHIPS_DRAWN) {
    const d = CHIP_DENOMINATIONS.find(v => v <= remaining);
    if (d === undefined) break;
    out.push(d);
    remaining -= d;
  }
  return out;
}

/**
 * 牌面显示用 '10'（用户决定，见 2026-08-15 复盘）。
 *
 * 注意这与 src/core/handClass.ts 的 RANK_CHARS = '23456789TJQKA' 刻意不同——
 * 那是引擎的手牌类别记法（范围表、AI 开池范围、翻前频率表、复盘引擎输出的
 * 'T9s' / 'ATo' 等两字符记法都建立在它上面），不是显示层。牌桌上看到 '10'、
 * 复盘文字里看到 'T9s' 是两套系统的一致设计，不要「统一」成同一个字符。
 */
const RANK_TEXT: Record<number, string> = {
  14: 'A',
  13: 'K',
  12: 'Q',
  11: 'J',
  10: '10',
};

/** 点数文字，如 'A' / '10' / '7' */
export function rankText(c: Card): string {
  return RANK_TEXT[c.rank] ?? String(c.rank);
}

/** 花色符号，如 '♠' */
export function suitText(c: Card): string {
  return { s: '♠', h: '♥', d: '♦', c: '♣' }[c.suit];
}

/** 牌面文字，如 'A♠'。点数与花色分开渲染时用上面两个 */
export function cardText(c: Card): string {
  return `${rankText(c)}${suitText(c)}`;
}

/** 四色牌的 CSS 类名：♠黑 ♥红 ♦蓝 ♣绿 */
export function suitClass(c: Card): string {
  return `suit-${c.suit}`;
}

/** 动作类型 → 中文。牌桌座位与复盘时间线共用，改文案只改这一处 */
export const ACTION_TEXT: Record<ActionType, string> = {
  fold: '弃牌',
  check: '过牌',
  call: '跟注',
  bet: '下注',
  raise: '加注',
  allin: '全下',
};

/**
 * 小数概率 → 百分比字符串，取整。0.333 → "33%"
 *
 * 与 src/review/explain.ts::formatPct 是同一个实现，刻意各留一份：
 * explain.ts 属于 src/review/（引擎层，生成解释文案），本文件属于
 * src/ui/（展示层）。为一个单行函数在两层之间拉一条依赖，换来的是
 * 引擎层的文案格式从此被 UI 绑住——不划算。两处若要改，一起改。
 */
export function pctText(v: number): string {
  return `${Math.round(v * 100)}%`;
}
