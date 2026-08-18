import type { Grade } from '../reviewModel';

/**
 * 复盘按钮的三态。
 *
 * 「还没算好」与「算失败了」必须分开，不能都塌成一个 null——设计文档
 * §6 的错误表要求 analyzeHand 抛错时按钮**点得开**、点开显示「本手复盘
 * 失败」。若两者共用一个 null，失败的那一手会留下一个永远禁用、永远不
 * 解释自己的按钮，用户只会以为程序卡住了。
 */
export type ReviewStatus =
  | { kind: 'pending' }
  | { kind: 'failed' }
  | { kind: 'ready'; grade: Grade };

/**
 * 结算区的「复盘」按钮。
 *
 * 只有 pending 才禁用。按钮常驻是有意的：若改成「算完才渲染」，
 * 结算区会在结算后跳一下。
 *
 * 色点让「这手有没有打错」不点开就能看到；文字标签同时给出，
 * 颜色不是唯一编码。
 */
export function ReviewTrigger({
  status,
  onOpen,
}: {
  status: ReviewStatus;
  onOpen: () => void;
}) {
  return (
    <button
      className="rv-trigger"
      onClick={onOpen}
      disabled={status.kind === 'pending'}
      aria-label="打开本手复盘"
    >
      <span
        className={`rv-dot rv-dot-${status.kind === 'ready' ? status.grade : 'unknown'}`}
        aria-hidden="true"
      />
      复盘
    </button>
  );
}
