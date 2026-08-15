import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map(f => `${dir}/${f.split('\\').join('/')}`);
}

describe('三期分层守卫', () => {
  it('src/session/ 不导入 React，也不碰浏览器 API', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src/session')) {
      const src = readFileSync(file, 'utf-8');
      if (/from\s+['"]react(-dom)?['"]/.test(src)) offenders.push(`${file}: react`);
      if (/\bsetTimeout\b|\bsetInterval\b/.test(src)) offenders.push(`${file}: 计时器`);
      if (/\bdocument\.|\bwindow\./.test(src)) offenders.push(`${file}: DOM`);
    }
    expect(offenders).toEqual([]);
  });

  it('src/session/ 不使用 Math.random', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src/session')) {
      if (/Math\.random/.test(readFileSync(file, 'utf-8'))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('src/ui/ 不从引擎与 AI 取值，只允许类型导入', () => {
    const banned = ['core/gameEngine', 'ai/decide', 'ai/selfPlayAi'];
    const offenders: string[] = [];
    const files = sourceFiles('src/ui');
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      for (const mod of banned) {
        // 匹配「不是 import type 的」导入语句。import type 编译后不产生
        // 运行时依赖，Card / Position 这类类型是渲染必需的，不该被禁。
        const re = new RegExp(`import\\s+(?!type\\b)[^;]*?from\\s+['"][^'"]*${mod}['"]`, 's');
        if (re.test(src)) offenders.push(`${file} -> ${mod}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
