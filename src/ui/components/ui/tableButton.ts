/**
 * 牌桌上那几颗按钮的共同尺寸与主动作样式。
 *
 * 单独抽出来是因为它被三处共用：动作条的三颗大按钮、结算条的「下一手」、
 * 补码提示的「补 $X」——它们在视觉上是同一颗按钮，原来共用 table.css 的
 * `.btn` / `.btn-primary` 两条规则，那两条规则删掉之后总得有个地方放。
 *
 * 尺寸全部按 --u（牌桌宽度的比例单位，见 styles/table.css 的 .app-main > *）推，
 * 不用 Button 自带的固定像素档：整块牌桌区域跟着屏宽缩放，写死像素会让
 * 按钮在手机上和牌桌脱节。数值原样搬自原来的 .btn / .btn-primary。
 */

/** 牌桌按钮的基础尺寸。对应原来的 .btn */
export const TABLE_BTN =
  'min-h-[calc(6*var(--u))] rounded-[calc(1.44*var(--u))] text-[calc(1.56*var(--u))] font-semibold tracking-[-0.01em] tabular-nums';

/**
 * 主动作。同屏永远只有一颗——设计稿里实心蓝是"这是你现在最该按的那个"
 * 的唯一编码，出现第二颗就等于没有编码。
 */
export const PRIMARY_BTN = `${TABLE_BTN} border-none text-[calc(1.61*var(--u))] text-primary-foreground bg-[linear-gradient(180deg,#3d79ef,#2963e0)] shadow-[var(--sh-primary)] hover:brightness-[1.07]`;
