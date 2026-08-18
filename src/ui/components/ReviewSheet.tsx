import type { HandRecord } from '../../core/types';
import type { HandAnalysis } from '../../review/types';
import { handGrade, timelineOf } from '../reviewModel';
import { ReviewTimeline } from './ReviewTimeline';
import { OpponentCards } from './OpponentCards';
import { chipsGreater } from '../../core/chips';
import { chips } from '../format';

/**
 * 复盘卡片。覆盖牌桌，用户主动打开。
 *
 * 顶部净盈亏用实额（那是「这手赢了多少钱」，与牌桌上的筹码同一量纲），
 * 卡片内部所有 EV / 底池 / 损失一律 BB —— 见 format.ts 顶部的注释：
 * 「你这一步亏了 2.3BB」比「亏了 92」有意义得多，且跨盲注级别可比。
 */
export function ReviewSheet({
  analysis,
  record,
  netBB,
  onNext,
  onClose,
}: {
  analysis: HandAnalysis;
  record: HandRecord;
  /** 本手 hero 净盈亏，BB */
  netBB: number;
  onNext: () => void;
  onClose: () => void;
}) {
  const grade = handGrade(analysis);
  // 与 SummaryBar.tsx 同款判据：金额比较走 chips.ts，不用裸 <
  const isNeg = chipsGreater(0, netBB);

  return (
    <div className="rv-sheet" role="dialog" aria-label="本手复盘">
      <header className="rv-head">
        <div className="rv-head-left">
          <span className={isNeg ? 'neg' : 'pos'}>
            本手 {isNeg ? '' : '+'}
            {chips(netBB)}
          </span>
          <span className={`rv-grade rv-grade-${grade.grade}`}>{grade.text}</span>
        </div>
        <button className="rv-close" onClick={onClose} aria-label="关闭复盘">
          ✕
        </button>
      </header>

      <div className="rv-body">
        <ReviewTimeline groups={timelineOf(analysis)} />
        <OpponentCards record={record} />
      </div>

      <footer className="rv-foot">
        <button className="btn btn-primary" onClick={onNext}>
          下一手
        </button>
      </footer>
    </div>
  );
}
