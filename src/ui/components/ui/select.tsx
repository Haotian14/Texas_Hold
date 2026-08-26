import * as React from 'react';
import { Select as SelectPrimitive } from 'radix-ui';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * 下拉选择。
 *
 * 这是整次重构里收益最实在的一处。原生 `<select>` 在移动端由系统接管：
 * iOS 弹一个底部滚轮、Android 弹一个系统列表，两者的外观、字号、选中态
 * 都不受页面控制，和这份浅色设计稿完全不是一套语言。Radix 的 Select 是
 * 自绘的，因此四个筛选器终于能跟界面其余部分长一样。
 *
 * 代价照说：自绘意味着键盘导航、焦点陷阱、输入法、滚动锁定这些原生白拿的
 * 东西现在由库来实现——Radix 做了，但它是代码，不是浏览器。
 *
 * **值不能是空串。** Radix 用空串表示"没有选中任何项"，一个 value="" 的
 * Item 会被它当成清空指令并报错。原来那四个筛选器的「全部位置/全部街道」
 * 用的正是空串，换过来时必须改成一个哨兵值（见 HistoryPage 的 ALL）。
 */
const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'flex min-h-8 w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-card px-2.5 py-1',
        'text-[11.5px] font-medium text-foreground shadow-xs outline-none transition-all',
        'hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        "data-[placeholder]:text-muted-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        className={cn(
          'relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin)',
          'overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground',
          // 浮层的层次靠阴影而不是边框，与设计稿其余部分一致
          'shadow-[0_1px_2px_rgba(17,20,26,0.04),0_10px_22px_-14px_rgba(17,20,26,0.2)]',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport
          className={cn(
            'p-1',
            position === 'popper' && 'h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width)',
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex w-full cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2.5',
        'text-[12.5px] outline-none select-none',
        'focus:bg-accent focus:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute right-2.5 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-3.5" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem };
