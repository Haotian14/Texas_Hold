import * as React from 'react';
import { Slider as SliderPrimitive } from 'radix-ui';
import { cn } from '../../lib/utils';

/**
 * 滑块。
 *
 * 换掉 `<input type="range">` 的直接收益是**已填充轨道不必再自己画**。原来
 * 那版靠一个 `--fill` 百分比变量 + 背景渐变模拟，因为原生 range 根本没有
 * "已走过部分"这个概念（只有 Firefox 的 ::-moz-range-progress，Chrome 没有
 * 对应物）。Radix 给了真的 Range 元素，那个变量和那段渐变一起删掉了。
 *
 * 另一处不再是问题的是**步进网格**：原生 range 的可停点是从 min 开始按 step
 * 累加的，所以预设档位金额和 max 本身常常够不到格子。Radix 同样按 step 走，
 * 但它允许 value 被外部设成任意值（受控时不吸附），预设按钮设进来的金额
 * 因此能精确落上。
 */
function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary"
      >
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        className={cn(
          'block size-[18px] shrink-0 rounded-full border border-primary bg-background',
          'shadow-[0_1px_3px_rgba(17,20,26,0.3)] transition-[color,box-shadow]',
          'hover:ring-4 hover:ring-ring/20 focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none',
          'disabled:pointer-events-none',
        )}
      />
    </SliderPrimitive.Root>
  );
}

export { Slider };
