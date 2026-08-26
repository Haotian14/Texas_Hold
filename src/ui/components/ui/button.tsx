import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/**
 * 变体只留本项目用得上的那几种，没有照搬 shadcn 的全套（它还有 link、lg
 * 等）——项目原则是不留死代码，用到了再加。
 *
 * 尺寸对着原来手写的两种控件定：`sm` 对应旧的 `.pill`（筛选、导出这类次要
 * 动作），`default` 对应旧的 `.btn`（动作条上那三颗大按钮）。这样换过来
 * 之后触摸目标不会缩水——旧 CSS 上那句「min-height: 44px 触摸目标下限」
 * 是有理由的，手机上打牌全靠这三颗。
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium outline-none transition-all disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-[3px] focus-visible:ring-ring/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
        outline:
          'border border-input bg-card text-foreground shadow-xs hover:bg-secondary hover:text-foreground',
        ghost: 'text-muted-foreground hover:bg-secondary hover:text-foreground',
        destructive:
          'border border-destructive/35 bg-card text-destructive shadow-xs hover:bg-destructive hover:text-destructive-foreground hover:border-destructive',
      },
      size: {
        default: 'min-h-11 px-4 text-[15px]',
        sm: 'min-h-7 px-2.5 text-[11.5px]',
        icon: 'size-8 rounded-md',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** 把样式套在子元素上而不是渲染一个 button。用在「看起来是按钮的 label」上 */
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      // 默认 type="button"。原生默认是 submit，在表单里会意外提交——
      // 本项目没有 <form>，但这个默认值迟早会咬人一次
      type={asChild ? undefined : 'button'}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
