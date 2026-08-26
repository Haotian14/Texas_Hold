import * as React from 'react';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/**
 * 小标记。顶栏的「未记录」「深筹码」用它。
 *
 * `warn` 这一档不是 shadcn 的标准变体，是本项目的：它标的是"注意但不是错"
 * ——深筹码会让复盘精度下降，但那不是用户打错了。用琥珀而不是红，免得和
 * 复盘里那个"你打错了"的红抢同一个语义。
 */
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-secondary text-secondary-foreground',
        warn: 'border-warn/25 bg-warn/10 text-warn',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
