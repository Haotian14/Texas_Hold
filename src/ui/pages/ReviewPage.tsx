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
}: {
  /** 要复盘的那一手。null = 还没有任何一手打完（会话刚开始） */
  record: HandRecord | null;
  /** 本手复盘视图。null = analyzeHand 抛错了（见设计文档 §6），不是「没有决策点」 */
  view: HandView | null;
  /** 「我不认同这个判定」的当前状态。null = 这一手还没落库，标记无处可存 */
  disputed: boolean | null;
  onToggleDisputed: () => void;
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
        </header>
        <p className="rvp-blank">
          打完一手之后，这里会显示那一手的逐街复盘。也可以从下面翻已经存下来的手牌。
          <button type="button" className="rvp-btn rvp-btn-ghost" onClick={onAllHands}>
            全部手牌
          </button>
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
            <button type="button" className="rvp-btn rvp-btn-ghost" onClick={onAllHands}>
              全部手牌
            </button>
            {/* 只有落了库的手才谈得上标记。分析失败（view 为 null）的手照样可以
                标——用户不认同的可能正是「这手算不出来」这件事本身。 */}
            {disputed !== null && (
              <button
                type="button"
                className={
                  disputed ? 'rvp-btn rvp-btn-ghost rvp-dispute-on' : 'rvp-btn rvp-btn-ghost'
                }
                onClick={onToggleDisputed}
                aria-pressed={disputed}
              >
                {disputed ? '已标记有异议' : '我不认同这个判定'}
              </button>
            )}
            <button type="button" className="rvp-btn rvp-btn-primary" onClick={onPrimary}>
              {primaryLabel}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
