import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 合并 class 名。shadcn 全部组件的约定入口。
 *
 * 两步：clsx 处理条件与数组，tailwind-merge 消解**同一属性的重复工具类**
 * ——`cn('px-2', 'px-4')` 得到 `px-4` 而不是两个都留下。后者是必需的：
 * 没有它，调用方传进来的 className 覆盖不掉组件自带的默认值，CSS 里
 * 谁赢取决于两个类在样式表里的先后顺序，而那个顺序调用方无从得知。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
