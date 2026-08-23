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
  /** text 是评级的中文标签（GradeInfo.text），进 aria-label —— 见下 */
  | { kind: 'ready'; grade: Grade; text: string };

/**
 * 结算区的「复盘」按钮。点它**切到复盘页**并展示刚打完这一手，不再弹卡片
 * （覆盖式的 ReviewSheet 已随复盘页的两栏布局一起撤掉）。
 *
 * 只有 pending 才禁用。按钮常驻是有意的：若改成「算完才渲染」，
 * 结算区会在结算后跳一下。
 *
 * 色点让「这手有没有打错」不点开就能看到。色点是 aria-hidden 的纯装饰，
 * 所以评级的文字走 aria-label —— 按钮上可见的文字只有「复盘」两个字，
 * 若不这么做，评级在这里就是**纯颜色编码**，色觉障碍用户与读屏用户都
 * 拿不到。（复盘页里每条街的标题与标签胶囊都是可见文字，那是切过去之后的事。）
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
      aria-label={status.kind === 'ready' ? `查看本手复盘：${status.text}` : '查看本手复盘'}
    >
      <span
        className={`rv-dot rv-dot-${status.kind === 'ready' ? status.grade : 'unknown'}`}
        aria-hidden="true"
      />
      复盘
    </button>
  );
}
