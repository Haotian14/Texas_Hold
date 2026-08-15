import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map(f => `${dir}/${f.split('\\').join('/')}`);
}

// 判断 import/export 的具名说明符子句是否「整体不产生运行时依赖」：
// - 整体 type 子句，如 `import type Foo from …`、`export type * from …`
// - 花括号里的具名说明符全部带内联 `type`，如 `{ type X, type Y }`
// 只要出现默认导入、命名空间导入（`* as ns`）或任意一个非 type 的具名说明符，就判定为取值。
function isTypeOnlyClause(clause: string): boolean {
  const trimmed = clause.trim();
  if (/^type\b/.test(trimmed)) return true;

  const braceMatch = trimmed.match(/\{([^}]*)\}/);
  if (!braceMatch) return false; // 裸的默认导入 / 命名空间导入 / `export * from`，都是取值

  const outsideBraces = trimmed.replace(braceMatch[0], '').replace(/,/g, '').trim();
  if (outsideBraces !== '') return false; // 花括号之外还有默认导入等具名说明符，是取值

  const specifiers = braceMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  return specifiers.every(s => /^type\b/.test(s));
}

// 判断 src 是否存在从 mod 取「值」的 import/export，命中返回原因，否则返回 null。
// 分别覆盖四种会产生运行时依赖的写法；纯 type 写法（含内联 type 说明符）一律放行。
function valueImportOffense(src: string, mod: string): string | null {
  // 副作用导入：`import '…/mod';` —— 没有 from 子句，加载整个模块即产生运行时依赖。
  if (new RegExp(`import\\s+['"][^'"]*${mod}['"]`).test(src)) {
    return '副作用导入';
  }

  // 动态导入：`import('…/mod')` —— 无论出现在什么位置都会产生运行时依赖。
  if (new RegExp(`import\\s*\\(\\s*['"][^'"]*${mod}['"]`).test(src)) {
    return '动态导入';
  }

  // `import ... from '…/mod'` 与 `export ... from '…/mod'`（含 `export * from`）：
  // 逐条取出 import/export 与 from 之间的子句，交给 isTypeOnlyClause 判断是否全是类型。
  const clauseRe = new RegExp(`(import|export)\\s+([^;]*?)\\s+from\\s+['"][^'"]*${mod}['"]`, 'g');
  let m: RegExpExecArray | null;
  while ((m = clauseRe.exec(src))) {
    const [, keyword, clause] = m;
    if (!isTypeOnlyClause(clause)) return `${keyword} 取值`;
  }

  return null;
}

// 剥离行注释与块注释后再匹配 Math.random 的真实调用，避免像
// src/core/rng.ts 顶部那种「core 层禁止使用 Math.random()」的说明性注释
// 被误判成违规调用。块注释按非贪婪跨行匹配去掉，再去掉行注释。
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// tsconfig 为了 src/ui 全仓加了 DOM lib 之后，document/window/setTimeout/
// setInterval/Math.random 在 core/ai/review 里也能编译通过了——纯度只能
// 靠这类测试守，不能再指望「压根编译不过」。
const PURE_LAYER_DIRS = ['src/core', 'src/ai', 'src/review', 'src/session'] as const;
const BROWSER_GLOBAL_LAYER_DIRS = ['src/core', 'src/ai', 'src/review'] as const;

describe('三期分层守卫', () => {
  it('src/session/ 不导入 React，也不碰浏览器 API', () => {
    const offenders: string[] = [];
    const files = sourceFiles('src/session');
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      if (/from\s+['"]react(-dom)?['"]/.test(src)) offenders.push(`${file}: react`);
      if (/\bsetTimeout\b|\bsetInterval\b/.test(src)) offenders.push(`${file}: 计时器`);
      if (/\bdocument\.|\bwindow\./.test(src)) offenders.push(`${file}: DOM`);
    }
    expect(offenders).toEqual([]);
  });

  it('src/session/ 不使用 Math.random', () => {
    const offenders: string[] = [];
    const files = sourceFiles('src/session');
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
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
        const offense = valueImportOffense(src, mod);
        if (offense) offenders.push(`${file} -> ${mod} (${offense})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('跨层纯度守卫（tsconfig 加了 DOM lib 之后，编译期不再天然拦这些）', () => {
  it.each(PURE_LAYER_DIRS)('%s 不使用 Math.random（真实调用；注释里提及不算）', dir => {
    const offenders: string[] = [];
    const files = sourceFiles(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf-8'));
      if (/Math\.random\s*\(/.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it.each(BROWSER_GLOBAL_LAYER_DIRS)('%s 不碰浏览器全局（document/window/setTimeout/setInterval）', dir => {
    const offenders: string[] = [];
    const files = sourceFiles(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      if (/\bdocument\.|\bwindow\./.test(src)) offenders.push(`${file}: DOM`);
      if (/\bsetTimeout\b|\bsetInterval\b/.test(src)) offenders.push(`${file}: 计时器`);
    }
    expect(offenders).toEqual([]);
  });
});
