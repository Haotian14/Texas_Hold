import type { HandView, DecisionView } from '../review/view';
import type { Severity, MistakeTag } from '../review/taxonomy';
import { severityOf } from '../review/taxonomy';
import { chipsGreater, round2 } from '../core/chips';
import type { Street, HandRecord } from '../core/types';
import { personaLabel } from '../session/seatLabels';
import { dateText } from './format';

export type Grade = 'unknown' | 'clean' | 'minor' | 'notable' | 'severe';

export interface GradeInfo {
  grade: Grade;
  /** 面向用户的一句话 */
  text: string;
}

/**
 * 三档失误的文案。用 Record<Exclude<Severity, 'ok'>, string> 而不是普通对象：
 * taxonomy.ts 将来给 Severity 加档时，这里会编译失败，而不是在界面上静默
 * 显示 undefined。同一个编译期穷尽手法在 src/ui/sound.ts 的 soundFor 里已经用过。
 */
const MISTAKE_TEXT: Record<Exclude<Severity, 'ok'>, string> = {
  minor: '有小偏差',
  notable: '有明显失误',
  severe: '有重大失误',
};

/**
 * 本手整体评级。
 *
 * 按 worstEvLoss（单点最大损失）定档，不是按 totalEvLoss ——
 * 与规格 §9 历史页的排序字段一致：一个 3 BB 的大错比十个 0.3 BB 的
 * 小偏差更该标红，累加会把后者顶到前者之上。
 *
 * 阈值不在这里重写，直接调 severityOf()。taxonomy.ts 顶部写明
 * 「调整判定松紧时只应该改这个文件」，UI 复制一份阈值就等于把它作废。
 *
 * unknown 单列一档是必要的：不能让「算不出来」和「没打错」显示成
 * 同一个颜色，那是用沉默冒充结论。
 */
export function handGrade(a: HandView): GradeInfo {
  if (a.decisions.length === 0 || a.decisions.every(d => d.degraded)) {
    return { grade: 'unknown', text: '本手没有可判定的决策点' };
  }
  const s = severityOf(a.worstEvLoss);
  if (s === 'ok') return { grade: 'clean', text: '这手没问题' };
  return { grade: s, text: MISTAKE_TEXT[s] };
}

export interface TimelineRow {
  decision: DecisionView;
  /** 该决策点在 HandView.decisions 里的下标。做 React key 用——它在一手牌内
   * 唯一且稳定，而组内是按 actionIndex 重排过的，用名次做 key 会在重排后
   * 把状态贴到错的那一行上 */
  index: number;
}

/** 街序固定，不随决策点出现顺序变化 */
const STREET_ORDER: readonly Street[] = ['preflop', 'flop', 'turn', 'river'];

/** 与 MISTAKE_TEXT 同理：Street 加成员时这里编译失败，而不是显示 undefined */
const STREET_LABEL: Record<Street, string> = {
  preflop: '翻前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
};

export interface Bar {
  label: string;
  /** 单位 BB */
  ev: number;
  /** 条形宽度，占轴长的百分比 */
  widthPct: number;
  /** 条形左端在轴上的位置，百分比 */
  leftPct: number;
  isRecommended: boolean;
  /** 用户实际选的那一条 */
  isActual: boolean;
}

export interface BarChart {
  bars: Bar[];
  /** 零点在轴上的位置，百分比。基线画在这里 */
  zeroPct: number;
}

/**
 * 某决策点的 EV 条形图。
 *
 * 轴取 [min(0, ...evs), max(0, ...evs)] —— 两端都把 0 括进来，
 * 保证零点基线永远在轴内、EV 恰为 0 的 fold 那根永远画得出来。
 * 负 EV 的条向左伸，右端正好贴住基线。
 *
 * degraded 的决策点 candidates 是空数组（见 review/types.ts），
 * 自然得到一张空图，调用方不必额外判断。
 */
export function barsOf(d: DecisionView): BarChart {
  if (d.candidates.length === 0) return { bars: [], zeroPct: 0 };

  const evs = d.candidates.map(c => c.ev);
  const lo = Math.min(0, ...evs);
  const hi = Math.max(0, ...evs);
  const span = hi - lo;
  // 所有候选 EV 全为 0：轴长为 0，不做除法，所有条宽记 0
  if (span === 0) {
    return {
      zeroPct: 0,
      bars: d.candidates.map(c => ({
        label: c.label,
        ev: c.ev,
        widthPct: 0,
        leftPct: 0,
        isRecommended: c.isRecommended,
        isActual: c.label === d.actualLabel,
      })),
    };
  }

  const zeroPct = ((0 - lo) / span) * 100;
  return {
    zeroPct,
    bars: d.candidates.map(c => {
      // c.ev 是 BB 金额，走 chips.ts 而不是裸 <（见 Global Constraints）。
      // 效果上还多一层保护：EV 为 -1e-13 这类浮点尾数的候选会被归到正侧，
      // 于是 leftPct 取 zeroPct、宽度约等于 0，不会在基线左边留一根看不见
      // 却把 outline 画歪的条。
      const negative = chipsGreater(0, c.ev);
      return {
        label: c.label,
        ev: c.ev,
        widthPct: (Math.abs(c.ev) / span) * 100,
        leftPct: negative ? ((c.ev - lo) / span) * 100 : zeroPct,
        isRecommended: c.isRecommended,
        isActual: c.label === d.actualLabel,
      };
    }),
  };
}

/**
 * 本手弃过牌的座位号，供对手底牌灰显。
 *
 * HandResult 只有 seat / netBB / showdown，没有 folded 字段，
 * 「谁弃了牌」这件事的权威来源是动作序列本身。
 */
export function foldedSeatsOf(record: HandRecord): number[] {
  return [...new Set(record.actions.filter(a => a.type === 'fold').map(a => a.seat))];
}

/**
 * MistakeTag 的中文标签（文案抄自设计文档 §8.7 的分类表）。
 *
 * tag 是给引擎自己看的枚举名（`preflop_cold_call_too_wide`），不是给用户
 * 看的话。此前 ReviewDecision 直接把它渲染进一张全中文的卡片里，中间夹一串
 * 下划线英文——和本分支早先把 Seat.tsx 的 ACTION_TEXT 提到 format.ts 所修
 * 的是同一个毛病，只是漏在了这一处。
 *
 * 用 Record<MistakeTag, string> 而不是普通对象：taxonomy.ts 的
 * PREFLOP_TAGS / POSTFLOP_TAGS 加成员时这里会编译失败，而不是在界面上
 * 静默显示 undefined。同 MISTAKE_TEXT / STREET_LABEL。
 */
export const TAG_TEXT: Record<MistakeTag, string> = {
  preflop_cold_call_too_wide: '冷跟太宽',
  preflop_missed_3bet: '该 3bet 没 3bet',
  preflop_over_aggressive: '翻前过度激进',
  preflop_sb_limp: '小盲跛入',
  preflop_open_too_wide: '开池范围太宽',
  preflop_fold_too_tight: '弃得太紧',
  missed_cbet: '该 c-bet 没 c-bet',
  missed_value_bet: '错过价值下注',
  chasing_bad_odds: '赔率不足追听牌',
  call_too_light_vs_raise: '面对加注跟太松',
  should_have_folded: '该弃牌没弃',
  bet_size_too_small: '下注尺度过小',
  bet_size_too_large: '下注尺度过大',
  ineffective_bluff: '无效诈唬',
  over_bluffing: '诈唬过多',
};

/* ───────── ③-D 复盘页：左栏「一街一项」的汇总 ───────── */

/**
 * severity → 文字标签。颜色不是唯一编码。
 *
 * 从已删除的 ReviewTimeline.tsx 搬过来的（那个手风琴组件被复盘页的两栏布局
 * 取代）。搬到这里不只是为了找个地方放：组件不写自动化测试，留在组件里的
 * 这张表没有任何测试守着它的穷尽性。
 *
 * 用 Record<Severity, …> 而不是 if 链比 string：Severity 将来加一档时
 * 这里是编译错误，if 链只会静悄悄落到「没问题」——把新的失误档显示成
 * 没打错，正是复盘最不能犯的错。
 */
const SEV_TEXT: Record<Severity, string> = {
  ok: '没问题',
  minor: '小偏差',
  notable: '明显失误',
  severe: '重大失误',
};

/** 决策点的一句话结论。degraded 单独一档，不复用 ok —— 算不出来不等于打得对 */
export function severityText(degraded: boolean, severity: Severity): string {
  return degraded ? '无法判定' : SEV_TEXT[severity];
}

/**
 * severity 的排序权重。
 *
 * taxonomy.ts 的 Severity 是个联合类型，没有内建顺序；而「取这条街最严重的
 * 那个决策点」必须能比大小。同样用 Record 而不是数组 indexOf：加一档时
 * 这里编译失败，indexOf 只会返回 -1，把新的最严重档排到最前面之外。
 */
const SEVERITY_RANK: Record<Severity, number> = { ok: 0, minor: 1, notable: 2, severe: 3 };

/** 左栏卡片的三态，与设计稿 streetVisual 的 good / leak / skip 一一对应 */
export type StreetStatus = 'good' | 'leak' | 'skip';

export interface StreetSummary {
  street: Street;
  label: string;
  status: StreetStatus;
  /** 该街所有决策点 evLoss 之和，BB */
  evLoss: number;
  /** 左栏卡片第二行的 EV 文案 */
  evText: string;
  /** 右栏标题行的标题 */
  title: string;
  /** 右栏标题行的标签胶囊 */
  tagText: string;
  /** 该街的**全部**决策点，按 actionIndex 升序 */
  rows: TimelineRow[];
}

/**
 * 按街汇总，恒返回四项（翻前/翻牌/转牌/河牌）。
 *
 * 它取代了 ③-B 的 timelineOf（那个只返回**有决策点**的街，配合手风琴时间线）：
 * 设计稿左栏是四张固定卡片，缺一张会让「这条街我没做决策」和「这条街被程序
 * 漏了」长得一模一样。timelineOf 与它的测试已经删掉，没有第二个调用方。
 *
 * 三态的判据（设计稿 streetVisual 只有三档，本项目的 severity 有四档，
 * 折叠规则写在这里而不是组件里）：
 * - 该街**没有决策点**、或全部 degraded → skip（灰 –）。degraded 的决策点
 *   severity 恒为 'ok'，若不先剔掉，「算不出来」会被显示成「打得对」。
 * - 余下的决策点里最严重的达到 notable → leak（红 !）
 * - 否则 → good（绿 ✓）
 *
 * evLoss 走 round2：四五个 0.1 级别的浮点数相加会攒出 2.3000000000000003
 * 这类尾数，而 evText 只印一位小数，尾数看不见但会在别处（比较、求和）咬人。
 *
 * view 为 null（analyzeHand 抛错）时四项全 skip —— 页面照常渲染出四张灰卡片，
 * 而不是整屏空白。
 */
export function streetSummaries(view: HandView | null): StreetSummary[] {
  return STREET_ORDER.map(street => {
    const rows: TimelineRow[] = [];
    view?.decisions.forEach((decision, index) => {
      if (decision.street === street) rows.push({ decision, index });
    });
    rows.sort((x, y) => x.decision.actionIndex - y.decision.actionIndex);

    const label = STREET_LABEL[street];
    const evLoss = round2(rows.reduce((sum, r) => sum + r.decision.evLoss, 0));

    // 最严重的那个决策点。同严重度时取损失更大的那个 —— 它的 tag 才是
    // 右栏标签胶囊上该写的那一条。
    let worst: DecisionView | null = null;
    for (const { decision: d } of rows) {
      if (d.degraded) continue;
      if (
        worst === null ||
        SEVERITY_RANK[d.severity] > SEVERITY_RANK[worst.severity] ||
        (SEVERITY_RANK[d.severity] === SEVERITY_RANK[worst.severity] &&
          chipsGreater(d.evLoss, worst.evLoss))
      ) {
        worst = d;
      }
    }

    const status: StreetStatus =
      worst === null
        ? 'skip'
        : SEVERITY_RANK[worst.severity] >= SEVERITY_RANK.notable
          ? 'leak'
          : 'good';

    if (status === 'leak' && worst !== null) {
      return {
        street,
        label,
        status,
        evLoss,
        // U+2212 减号而不是连字符：与设计稿一致，且在 tabular-nums 下宽度
        // 与数字对齐（连字符更短，会让左栏四行的数字错位）
        evText: `−${evLoss.toFixed(1)} BB`,
        title: `${label} — 损失 ${evLoss.toFixed(1)} BB`,
        tagText: worst.tag === null ? '有失误' : TAG_TEXT[worst.tag],
        rows,
      };
    }
    if (status === 'good') {
      return {
        street,
        label,
        status,
        evLoss,
        evText: '—',
        title: `${label} — 打得对`,
        tagText: '按计划',
        rows,
      };
    }
    return {
      street,
      label,
      status,
      evLoss,
      evText: 'n/a',
      title: rows.length === 0 ? `${label} — 没有决策点` : `${label} — 不做判定`,
      tagText: '不做判定',
      rows,
    };
  });
}

/**
 * 默认选中哪条街：第一个有失误的街；没有失误就选第一个有决策点的街。
 *
 * 四条街全是 skip 时落回翻前 —— 返回 null 会逼每个调用点各写一遍
 * 「没得选时显示什么」，而那时右栏本来就该显示「翻前没有决策点」。
 */
export function defaultStreetOf(summaries: readonly StreetSummary[]): Street {
  const leak = summaries.find(s => s.status === 'leak');
  if (leak !== undefined) return leak.street;
  const played = summaries.find(s => s.rows.length > 0);
  if (played !== undefined) return played.street;
  return 'preflop';
}

/* ───────── ③-D 复盘页：页头那一行 ───────── */

/**
 * hero 在这一手的净盈亏，BB。
 *
 * 「刚打完的那一手」与「历史里翻出来的那一手」以前各算一遍同样的
 * find(...)?.netBB ?? 0，两处任一漏掉 heroSeat 都不会有测试发现。
 */
export function heroNetOf(record: HandRecord): number {
  return record.results.find(r => r.seat === record.heroSeat)?.netBB ?? 0;
}

/**
 * 页头净盈亏的文案，单位 BB。
 *
 * **不换算实额**。分工是：牌桌讲「你赢了多少钱」用实额，复盘与报表讲
 * 「你打得多好」用 BB（报表页已经这么定了，设计稿这一处写的也是 `+18 BB`）。
 * 同屏的 EV 损失本来就是 BB，混排两种量纲更糟。
 *
 * 负号用 U+2212 而不是连字符，与左栏的 evText 一致：tabular-nums 下连字符
 * 比数字窄，两处并排会错位。正负号在这里出，调用方只负责套红绿。
 */
export function netBBText(netBB: number): string {
  // 金额比较走 chips.ts，不用裸 <（见 Global Constraints）
  return `${chipsGreater(0, netBB) ? '−' : '+'}${Math.abs(netBB).toFixed(1)} BB`;
}

/** 这一手怎么结束的。文案与结算条（SummaryBar）刻意不同：那里说的是「有没有摊牌」 */
export function endingText(record: HandRecord): string {
  return record.results.some(r => r.showdown) ? '摊牌' : '弃牌结束';
}

/**
 * 手牌编号取自 record.id 的 `-h<handIndex>` 后缀（见 handSession.beginHand，
 * id 是 `${seed}-h${handIndex}`）。
 *
 * HandRecord 里**没有**手牌序号字段，而页头要显示「第 N 手」。从 id 里取而
 * 不是给 record 加字段：加字段要动 core 的 schema 和 HAND_RECORD_SCHEMA_VERSION，
 * 为一行副标题不值得；取不到时上层退回显示日期，不会印一个编出来的号。
 *
 * handIndex 从 0 起，显示的编号 +1。
 */
export function handNumberOf(record: HandRecord): number | null {
  const m = /-h(\d+)$/.exec(record.id);
  if (m === null) return null;
  return Number(m[1]) + 1;
}

/**
 * persona id → 名字，**认不出来时返回 null 而不是抛**。
 *
 * personaLabel 底下是 ai/personas.ts 的 getPersona，遇到未知 id 直接 throw。
 * 在 Seat.tsx 那种调用点这没问题——活局里的 id 是本进程刚发的，必然合法。
 * 但复盘页会渲染**从库里取出来的**手牌，而 storage/transfer.ts 的
 * looksLikeHand 不校验 personaId：别人导出的文件、或旧版本里已经删掉的
 * persona，都会带着一个不认识的 id 进来。应用没有 ErrorBoundary，一抛就是
 * 整页白屏——而白掉的是「历史里随便点开一手」这条主路径。
 *
 * 兜底选在这里而不是改 personaLabel：那个函数服务的是牌桌，让它对未知 id
 * 静默返回一个名字，等于把「persona 表和存档对不上」这件事永久藏起来。
 * 这里只需要知道「叫不出名字」，于是副标题退回不点名的说法（`vs 5 名对手`），
 * 信息量降一档，但页面还在。
 */
function personaTextOf(personaId: string): string | null {
  try {
    return personaLabel(personaId);
  } catch {
    return null;
  }
}

/**
 * 页头副标题：「第 N 手 · vs 对手」。
 *
 * 「对手」取**打到最后还没弃牌**的那些非 hero 座位：设计稿是单挑局，写的是
 * 一个具体对手名；本项目是 6-max，只有当最后剩一个对手时说得出「vs 谁」，
 * 其余情况只能说人数。宁可说「vs 5 名对手」，也不要随手挑一个座位冒充
 * 「那个对手」。
 *
 * 只读 seats 的 position / personaId 与 actions 里的弃牌，**不读 holeCards** ——
 * 底牌在这一页只出现在底部「仅复盘可见」那一块里，不参与任何判断或描述。
 */
export function handSubtitle(record: HandRecord): string {
  const no = handNumberOf(record);
  const head = no === null ? dateText(record.timestamp) : `第 ${no} 手`;
  const others = record.seats.filter(s => s.seat !== record.heroSeat);
  const folded = new Set(foldedSeatsOf(record));
  const contested = others.filter(s => !folded.has(s.seat));
  const only = contested.length === 1 ? contested[0] : null;
  const persona = only === null ? null : personaTextOf(only.personaId);
  const who =
    only !== null && persona !== null
      ? `${only.position}（${persona}）`
      : `${others.length} 名对手`;
  return `${head} · vs ${who}`;
}
