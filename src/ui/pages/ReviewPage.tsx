import { useMemo, useState } from 'react';
import type { HandRecord, Street } from '../../core/types';
import type { HandView } from '../../review/view';
import { chipsGreater } from '../../core/chips';
import {
  streetSummaries,
  defaultStreetOf,
  severityText,
  heroNetOf,
  netBBText,
  endingText,
  handSubtitle,
  type StreetStatus,
} from '../reviewModel';
import { ACTION_TEXT } from '../format';
import { ReviewDecision } from '../components/ReviewDecision';
import { OpponentCards } from '../components/OpponentCards';
import { Button } from '../components/ui/button';
import { QuickToggles } from '../components/QuickToggles';
import { cn } from '../lib/utils';

/**
 * 复盘页底部那三颗按钮的共同尺寸，数值原样搬自被删掉的 app.css `.rvp-btn`。
 *
 * 这一页的按钮不跟 --u 缩放（它不在牌桌区域里，是坐下来看的一页），所以
 * 这里是固定像素，与牌桌那批（见 ui/tableButton.ts）不是一套。
 */
const RVP_BTN = 'h-12 rounded-xl text-[13.5px] font-semibold';

/** 描边款。对应被删掉的 `.rvp-btn-ghost` */
const RVP_GHOST = 'border border-input px-5 text-muted-foreground bg-transparent';

/**
 * 主按钮。对应被删掉的 `.rvp-btn-primary`。
 *
 * `ml-auto` 把它推到最右——设计稿把两颗按钮并排贴左，但本页多了「我不认同」
 * 第三颗，三颗挤在一起时主按钮认不出来。这一条在换组件时差点丢掉。
 */
const RVP_PRIMARY =
  'ml-auto border-none px-[26px] text-primary-foreground bg-[linear-gradient(180deg,#3d79ef,#2963e0)] shadow-[var(--sh-primary)]';

/**
 * 左栏圆形标记里的符号，照抄设计稿 streetVisual 的三态。
 *
 * 符号本身对读屏器是 aria-hidden 的（✓ / ! / – 念出来是噪音）。这不会让状态
 * 变成纯颜色编码：卡片上那行 EV 文案三态各不相同（`—` / `−2.3 BB` / `n/a`），
 * 右栏标题与标签胶囊更是整句话，色觉障碍用户与读屏用户都拿得到结论。
 */
const MARK: Record<StreetStatus, string> = { good: '✓', leak: '!', skip: '–' };

/**
 * 复盘页（设计稿 Hand Review 屏）。整页两栏，不是覆盖式卡片。
 *
 * 左栏是**一街一项、恒四项**（翻前/翻牌/转牌/河牌），右栏是选中那条街的
 * 全部决策点。街与决策点是一对多：HandView.decisions 逐决策点，一条街可能
 * 有好几个，折叠成一张卡片的规则（取最严重的那个、evLoss 求和）在
 * reviewModel.streetSummaries 里，配了测试；这里只负责画。
 *
 * 设计稿没有的三块内容——EV 条形图、对手底牌、「我不认同这个判定」——全部
 * 保留在右栏：条形图与底牌在正文里跟着决策点走，异议按钮在底部按钮行。
 * 设计稿是一份视觉参考，不是功能清单，删掉这三块等于用对齐设计稿的名义
 * 砍掉本项目的复盘深度。
 */
export function ReviewPage({
  record,
  view,
  disputed,
  onToggleDisputed,
  onAllHands,
  onPrimary,
  primaryLabel,
  onSettings,
}: {
  /** 要复盘的那一手。null = 还没有任何一手打完（会话刚开始） */
  record: HandRecord | null;
  /** 本手复盘视图。null = analyzeHand 抛错了（见设计文档 §6），不是「没有决策点」 */
  view: HandView | null;
  /** 「我不认同这个判定」的当前状态。null = 这一手还没落库，标记无处可存 */
  disputed: boolean | null;
  onToggleDisputed: () => void;
  /** 打开设置页。设置没有导航项了，每一页的页头各挂一个入口 */
  onSettings: () => void;
  /** 右栏底部次要按钮：进历史列表（设计稿那颗 All hands） */
  onAllHands: () => void;
  onPrimary: () => void;
  /** 主按钮文案。历史里翻出来的手没有「下一手」可开，见 App 里的 canNext */
  primaryLabel: string;
}) {
  // 选中的街跟着 record.id 一起存：换一手（打完下一手、或从历史点开另一手）时
  // 自动落回默认选中，不需要一个 useEffect 去清状态——那种写法会先渲染一帧
  // 旧选中，再被 effect 改掉。
  const [picked, setPicked] = useState<{ handId: string; street: Street } | null>(null);

  const summaries = useMemo(() => streetSummaries(view), [view]);

  if (record === null) {
    return (
      <div className="rvp">
        <header className="rvp-head">
          <div>
            <h2 className="rvp-title">复盘</h2>
            <div className="rvp-sub">还没有打完的手牌</div>
          </div>
          {/* 设置的入口，理由见 ReportPage 里那条注释 */}
          <QuickToggles tableToggles={false} onSettings={onSettings} />
        </header>
        <p className="rvp-blank">
          打完一手之后，这里会显示那一手的逐街复盘。也可以从下面翻已经存下来的手牌。
          <Button variant="outline" size="sm" className={cn(RVP_BTN, RVP_GHOST)} onClick={onAllHands}>
            全部手牌
          </Button>
        </p>
      </div>
    );
  }

  const selected =
    picked !== null && picked.handId === record.id ? picked.street : defaultStreetOf(summaries);
  // find 一定命中：summaries 恒含四条街，selected 只可能来自其中之一。
  // 仍然写兜底而不是 `!`：真出了岔子时显示第一条街，好过整页白屏。
  const sel = summaries.find(s => s.street === selected) ?? summaries[0];

  const net = heroNetOf(record);
  // 与 SummaryBar / Nav 同款判据：金额比较走 chips.ts，不用裸 <
  const isNeg = chipsGreater(0, net);

  return (
    <div className="rvp">
      <header className="rvp-head">
        <div>
          <h2 className="rvp-title">复盘</h2>
          <div className="rvp-sub">{handSubtitle(record)}</div>
        </div>
        {/* 单位是 BB，不是实额：复盘讲的是「你打得多好」，与同屏的 EV 损失
            同量纲（设计稿这一处写的也是 `+18 BB`）。正负号由 netBBText 出，
            这里只负责套红绿。 */}
        <div className={isNeg ? 'rvp-net neg' : 'rvp-net pos'}>
          {netBBText(net)}
          <span className="rvp-net-note"> · {endingText(record)}</span>
        </div>
        {/* 设置的入口，理由见 ReportPage 里那条注释 */}
        <QuickToggles tableToggles={false} onSettings={onSettings} />
      </header>

      <div className="rvp-cols">
        <div className="rvp-streets">
          {summaries.map(s => (
            <button
              key={s.street}
              type="button"
              className={
                s.street === selected
                  ? 'rvp-street rvp-street-on'
                  : 'rvp-street'
              }
              // 四张卡片是一组互斥的选择器，不是四个开关：aria-pressed 会被
              // 读成「按下/未按下」。用 aria-current 说「你正在看这一条」。
              aria-current={s.street === selected ? 'true' : undefined}
              onClick={() => setPicked({ handId: record.id, street: s.street })}
            >
              <span className={`rvp-mark rvp-mark-${s.status}`} aria-hidden="true">
                {MARK[s.status]}
              </span>
              <span className="rvp-street-text">
                <span className="rvp-street-name">{s.label}</span>
                {/* 结论同时给文字（title 里）与颜色，色觉障碍用户不靠颜色也读得出 */}
                <span className={`rvp-street-ev rvp-street-ev-${s.status}`}>{s.evText}</span>
              </span>
            </button>
          ))}
        </div>

        <section className="rvp-detail" aria-label={sel.title}>
          <div className="rvp-detail-head">
            <span className="rvp-detail-title">{sel.title}</span>
            <span className={`rvp-tag rvp-tag-${sel.status}`}>{sel.tagText}</span>
          </div>

          <div className="rvp-detail-body">
            {view === null ? (
              <p className="rv-empty">本手复盘失败。牌局不受影响，可以继续。</p>
            ) : sel.rows.length === 0 ? (
              <p className="rvp-body-text">这条街你没有需要判定的决策点。</p>
            ) : (
              sel.rows.map(({ decision: d, index }) => (
                <div className="rvp-dec" key={index}>
                  <div className="rvp-dec-head">
                    <span
                      className={`rv-dot rv-dot-${d.degraded ? 'unknown' : d.severity}`}
                      aria-hidden="true"
                    />
                    <span className="rvp-dec-act">
                      {ACTION_TEXT[d.actual.type]}
                      {chipsGreater(d.actual.amount, 0) ? ` ${d.actual.amount.toFixed(1)} BB` : ''}
                    </span>
                    <span className="rvp-dec-sev">{severityText(d.degraded, d.severity)}</span>
                  </div>
                  <ReviewDecision d={d} />
                </div>
              ))
            )}

            {/* 对手底牌只在这里**展示**，不参与任何判定（见 review 的红线）。
                放在正文末尾而不是右栏顶部：它是「看完结论之后再对答案」的东西，
                摆在结论之前会诱导人用底牌反推该怎么打。 */}
            <OpponentCards record={record} />
          </div>

          <div className="rvp-actions">
            <Button variant="outline" size="sm" className={cn(RVP_BTN, RVP_GHOST)} onClick={onAllHands}>
              全部手牌
            </Button>
            {/* 只有落了库的手才谈得上标记。分析失败（view 为 null）的手照样可以
                标——用户不认同的可能正是「这手算不出来」这件事本身。 */}
            {disputed !== null && (
              <Button
                variant="outline"
                size="sm"
                // rvp-dispute-on 是无层规则，压得过 Button 的 hover 工具类——
                // 已标记态鼠标放上去不会变回未标记的样子。原来这件事要靠
                // `.rvp-btn-ghost:not(.rvp-dispute-on):hover` 手动排除
                className={cn(RVP_BTN, RVP_GHOST, disputed && 'rvp-dispute-on')}
                onClick={onToggleDisputed}
                aria-pressed={disputed}
              >
                {disputed ? '已标记有异议' : '我不认同这个判定'}
              </Button>
            )}
            <Button size="sm" className={cn(RVP_BTN, RVP_PRIMARY)} onClick={onPrimary}>
              {primaryLabel}
            </Button>
          </div>
        </section>
      </div>

      {/* 规格 §12 要求把这条局限性说明摆在界面上，报表页印的是同一句。
          这一页更需要它：报表给的是聚合趋势，而这里逐个决策点报「你这步亏了
          X BB」，最容易被当成 solver 的精确输出。 */}
      <p className="rvp-note">EV 数字为近似估算，非 solver 输出。</p>
    </div>
  );
}
