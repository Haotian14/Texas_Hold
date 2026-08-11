// 项目没有装 @types/node（tsconfig 的 lib/types 只声明了 ES2022 与
// vitest/globals），但测试运行在 vitest 的 node 环境里，node:fs 在运行时
// 确实可用，只是缺类型声明。这个文件本身不含任何 import/export，因此被
// TS 当成「全局脚本」而不是模块，可以在这里给一个不存在类型声明的内置
// 模块声明一个全新的最小 ambient 类型（而不是「扩展」一个必须已存在的
// 模块，那样会报 TS2664）。仅供架构防护测试（architecture.test.ts）读取
// 源文件文本用，不给 core 代码本身使用。
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string;
  export function readdirSync(
    path: string,
    options: { recursive: boolean },
  ): string[];
}
