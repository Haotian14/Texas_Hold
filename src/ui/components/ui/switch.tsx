import * as React from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '../../lib/utils';

/**
 * 开关。
 *
 * 换掉的是原来那个「原生 checkbox + CSS 接管外观」的写法。原生那版把键盘、
 * 读屏、长按选中全都白拿到了，这里必须自己补回来——Radix 的 Switch 正是
 * 干这件事的：它渲染一个 `role="switch"` 的按钮并挂上 aria-checked，同时
 * 藏一个真的 checkbox 在下面供表单读取。
 *
 * 注意 role 从 checkbox 变成了 switch，测试里按 role 找控件的地方要跟着改。
 * 这是升级不是退步：switch 这个 role 存在的理由就是"立刻生效的开关"，
 * 读屏会念成「开/关」而不是「已选中/未选中」。
 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border border-transparent shadow-xs outline-none transition-all',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-secondary data-[state=unchecked]:border-input',
        'focus-visible:ring-[3px] focus-visible:ring-ring/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block size-[18px] rounded-full bg-background ring-0 transition-transform',
          'shadow-[0_1px_2px_rgba(17,20,26,0.28)]',
          'data-[state=checked]:translate-x-[17px] data-[state=unchecked]:translate-x-[1px]',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
