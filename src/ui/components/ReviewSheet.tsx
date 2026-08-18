import type { HandRecord } from '../../core/types';
import type { HandView } from '../../review/view';
import { handGrade, timelineOf } from '../reviewModel';
import { useEffect, useRef } from 'react';
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
  view,
  record,
  netBB,
  onNext,
  nextLabel,
  onClose,
}: {
  /** 本手复盘视图。null = analyzeHand 抛错了（见设计文档 §6），不是「没有决策点」 */
  view: HandView | null;
  record: HandRecord;
  /** 本手 hero 净盈亏，BB */
  netBB: number;
  onNext: () => void;
  /** 底部按钮的文案。破产那一手开不了下一手，只能「关闭」 */
  nextLabel: string;
  onClose: () => void;
}) {
  const grade = view === null ? null : handGrade(view);
  // 与 SummaryBar.tsx 同款判据：金额比较走 chips.ts，不用裸 <
  const isNeg = chipsGreater(0, netBB);

  // Esc 关卡片。这是全屏遮罩（z-index 20，本文件最高），底下的动作条与
  // 顶栏仍在 tab 序里，键盘用户至少要有一条出得来的路。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 开卡片时把焦点搬进来。aria-modal="true" 是在向读屏器声明「外面的东西
  // 现在不算数」，可焦点若还留在底下的触发按钮上，读屏用户的虚拟光标就停在
  // 一片被声明为不存在的内容里——等于告诉他有个对话框，却不告诉他在哪。
  // 落在关闭按钮上而不是容器上：它是这张全屏遮罩唯一的出口，第一个 Tab 位
  // 就该是它。（不做焦点回填：触发按钮所在的结算区往往随下一手一起卸载，
  // 还给一个已经不存在的元素没有意义。）
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div className="rv-sheet" role="dialog" aria-modal="true" aria-label="本手复盘">
      <header className="rv-head">
        <div className="rv-head-left">
          <span className={isNeg ? 'neg' : 'pos'}>
            本手 {isNeg ? '' : '+'}
            {chips(netBB)}
          </span>
          {grade !== null ? (
            <span className={`rv-grade rv-grade-${grade.grade}`}>{grade.text}</span>
          ) : null}
        </div>
        <button ref={closeRef} className="rv-close" onClick={onClose} aria-label="关闭复盘">
          ✕
        </button>
      </header>

      <div className="rv-body">
        {view === null ? (
          <p className="rv-empty">本手复盘失败。牌局不受影响，可以继续。</p>
        ) : (
          <>
            <ReviewTimeline groups={timelineOf(view)} />
            <OpponentCards record={record} />
          </>
        )}
      </div>

      <footer className="rv-foot">
        <button className="btn btn-primary" onClick={onNext}>
          {nextLabel}
        </button>
      </footer>
    </div>
  );
}
