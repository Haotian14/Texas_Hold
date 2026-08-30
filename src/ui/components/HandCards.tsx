import type { HandRecord } from '../../core/types';
import { foldedSeatsOf } from '../reviewModel';
import { CardView } from './Card';

/**
 * 本手牌面：公共牌 + 桌上每个人的底牌。只有复盘看得到这个全貌。
 *
 * 前身是 OpponentCards，只画对手的两张牌。那样看不出结论：「他拿这手牌为
 * 什么这么打」得对着公共牌才答得上来，而公共牌当时不在这一页上，全靠脑子
 * 记。hero 自己的牌同理——五个人里独独缺他一个，对比无从谈起。
 *
 * hero 排第一行，其余按 record.seats 的顺序跟在后面。位置列对所有人一致
 * （hero 的 BTN 也照写），「你」是行尾的一枚标记而不是替掉位置——位置是
 * 读这一页时要横向对齐的东西，把其中一行换成别的字，这一列就废了。
 *
 * 弃牌的座位灰显并标注，但**牌照样显示**：复盘要看的正是「他拿这手牌为
 * 什么弃」，藏起来就等于把这一页最有价值的一半删掉。这一条对 hero 那行
 * 同样成立，他自己的弃牌不是特权。
 */
export function HandCards({ record }: { record: HandRecord }) {
  const folded = new Set(foldedSeatsOf(record));
  // 先 hero 后其余。用 filter 拼而不是 sort：座位顺序照抄 record，
  // 只把 hero 那一条提到最前，其余的相对次序一动不动。
  const rows = [
    ...record.seats.filter(s => s.seat === record.heroSeat),
    ...record.seats.filter(s => s.seat !== record.heroSeat),
  ];
  // 与 EvBars 同款：没内容就整块不出，而不是留一个带标题和分隔线的空盒
  if (rows.length === 0) return null;

  return (
    <div className="hc">
      <div className="hc-title">本手牌面（仅复盘可见）</div>
      <div className="hc-row hc-board">
        <span className="hc-pos">公共牌</span>
        {/* 翻前就结束的手 board 是空数组。写明「未发出」而不是留一排空位：
            空位读起来像「这里本该有牌但没画出来」，是个 bug 的样子。 */}
        {record.board.length === 0 ? (
          <span className="hc-note">未发出公共牌</span>
        ) : (
          <span className="hc-hand">
            {record.board.map((c, i) => (
              <CardView key={`${c.rank}${c.suit}-${i}`} card={c} size="sm" />
            ))}
          </span>
        )}
      </div>
      {rows.map(s => {
        const isHero = s.seat === record.heroSeat;
        const cls = ['hc-row', 'hc-seat', isHero ? 'hc-hero' : '', folded.has(s.seat) ? 'hc-folded' : '']
          .filter(Boolean)
          .join(' ');
        return (
          <div className={cls} key={s.seat}>
            <span className="hc-pos">{s.position}</span>
            <span className="hc-hand">
              <CardView card={s.holeCards[0]} size="sm" />
              <CardView card={s.holeCards[1]} size="sm" />
            </span>
            {isHero && <span className="hc-you">你</span>}
            {folded.has(s.seat) ? <span className="hc-note">已弃牌</span> : null}
          </div>
        );
      })}
    </div>
  );
}
