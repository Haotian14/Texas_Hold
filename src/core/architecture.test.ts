import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// 用 npm test / vitest run 的默认工作目录（项目根目录 E:\puke）拼相对路径，
// 而不是 import.meta.url + URL：相对路径更省事，且这个仓库里所有 npm
// scripts 都是从根目录跑的。
function readSource(relPath: string): string {
  return readFileSync(relPath, 'utf-8');
}

describe('模块边界结构性防护（防止 phase 2 悄悄重新形成环依赖）', () => {
  it('chips.ts 不引用任何本地模块，保持叶子模块', () => {
    const src = readSource('src/core/chips.ts');
    const localImports = src.match(/from\s+['"]\.\/[^'"]+['"]/g) ?? [];
    expect(localImports).toEqual([]);
  });

  it('gameEngine.ts 不引用 handRecord', () => {
    const src = readSource('src/core/gameEngine.ts');
    expect(src).not.toMatch(/handRecord/);
  });
});
