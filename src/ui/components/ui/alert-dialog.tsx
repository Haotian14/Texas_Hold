import * as React from 'react';
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import { cn } from '../../lib/utils';
import { buttonVariants } from './button';

/**
 * 破坏性操作的确认对话框。
 *
 * 用 AlertDialog 而不是 Dialog，区别不在样式上：AlertDialog **点外面不关、
 * Esc 之外没有隐式退路**，且默认把焦点放在取消上。这正是"重置数据"需要的
 * ——它删掉的是用户几百手历史且不可撤销，一次误触外部区域不该有任何机会
 * 变成一次确认。
 *
 * 换掉的是原来那个「按钮原地变成取消 + 确认清空两颗」的行内确认。行内那版
 * 的两步语义是对的，但它不锁焦点，也不拦住背后的界面——用户可以在确认态
 * 下点别的地方，然后回过头来面对一颗还亮着的「确认清空」，不知道自己刚才
 * 点到了哪一步。
 */
const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay
        data-slot="alert-dialog-overlay"
        className={cn(
          'fixed inset-0 z-50 bg-[rgba(17,20,26,0.35)]',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        )}
      />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-[380px] -translate-x-1/2 -translate-y-1/2 gap-3',
          'rounded-xl border border-border bg-card p-5',
          'shadow-[0_1px_2px_rgba(17,20,26,0.04),0_18px_40px_-18px_rgba(17,20,26,0.14),0_48px_90px_-30px_rgba(17,20,26,0.18)]',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('text-[15px] font-semibold tracking-[-0.01em]', className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('text-[12.5px] leading-[1.55] text-muted-foreground', className)}
      {...props}
    />
  );
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn('mt-1 flex justify-end gap-2', className)}
      {...props}
    />
  );
}

function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return (
    <AlertDialogPrimitive.Action
      className={cn(
        buttonVariants({ variant: 'destructive', size: 'sm' }),
        'min-h-8 px-3 text-[12.5px]',
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      className={cn(
        buttonVariants({ variant: 'outline', size: 'sm' }),
        'min-h-8 px-3 text-[12.5px]',
        className,
      )}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
};
