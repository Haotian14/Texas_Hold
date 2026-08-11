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
});
