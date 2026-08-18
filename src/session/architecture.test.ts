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
// 被误判成违规调用。
//
// 用字符串字面量感知的逐字符扫描，而不是先前那种朴素正则
// （`/\/\*[\s\S]*?\*\//g` 加 `/\/\/.*$/gm`）：朴素版不认识字符串边界，
// 一旦字符串字面量里含 `//` 或 `/*`（比如一个 URL 常量），就会把它当成
// 注释起点，误吞掉同一行/同一块里紧跟着的真实代码——包括真实的
// `Math.random()` 调用。这里遇到引号（`'`/`"`/`` ` ``）就原样把整段字符串
// 字面量（含转义字符）抄进输出、跳过其中的 `//`/`/*`，只有在字符串之外
// 遇到 `//`/`/*` 才当作注释剥离，从而不会再把字符串里的注释状字符错当
// 成注释边界，也不会漏掉紧跟其后的真实调用。
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const two = src.slice(i, i + 2);
    const ch = src[i];
    if (two === '//') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (two === '/*') {
      i += 2;
      while (i < n && src.slice(i, i + 2) !== '*/') i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < n) {
          out += src[i] + src[i + 1];
          i += 2;
          continue;
        }
        out += src[i];
        i++;
      }
      if (i < n) {
        out += src[i];
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// tsconfig 为了 src/ui 全仓加了 DOM lib 之后，document/window/setTimeout/
// setInterval/Math.random 在 core/ai/review 里也能编译通过了——纯度只能
// 靠这类测试守，不能再指望「压根编译不过」。
const PURE_LAYER_DIRS = ['src/core', 'src/ai', 'src/review', 'src/session'] as const;
const BROWSER_GLOBAL_LAYER_DIRS = ['src/core', 'src/ai', 'src/review'] as const;

/** 音频只允许存在于 src/ui/。session 及以下四层一律禁止 */
const AUDIO_BANNED = /\bAudioContext\b|\bwebkitAudioContext\b|new\s+Audio\b|\bHTMLAudioElement\b/;

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

  // src/session 不使用 Math.random 的守卫已并入下面「跨层纯度守卫」的
  // it.each(PURE_LAYER_DIRS)：曾经这里还有一条不剥离注释、直接对整个源码
  // 做 /Math\.random/ 匹配的旧版本，与 PURE_LAYER_DIRS 那条（剥离注释后
  // 再匹配，注释里提及不算违规）对同一个目录编码了两条互相矛盾的规则，
  // 是重复 + 不一致，已删除，以 PURE_LAYER_DIRS 的规则为准。

  it('src/session/ 不 import src/storage/ —— 对局逻辑不该知道有没有数据库', () => {
    // 刷新即丢的行为必须仍然成立：IndexedDB 在隐私模式、被禁用的存储、配额
    // 耗尽时都可能不可用，而牌局在那些情况下一样要能打。会话层一旦依赖存储，
    // 「存不进去也能继续」就从一条设计约束退化成一句口号。
    const offenders: string[] = [];
    const files = sourceFiles('src/session');
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      if (/from\s+['"][^'"]*storage\//.test(src) || /import\s*\(\s*['"][^'"]*storage\//.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('indexedDB 只出现在 src/storage/db.ts', () => {
    // 存储层刻意只有一个文件碰浏览器 API（见 db.ts 顶部）。这条守卫是那句话
    // 的执行者：一旦有人图方便在别处直接开库，schema / 统计 / 查询那几层
    // 「纯函数、可测」的前提就没了。
    const offenders: string[] = [];
    for (const dir of ['src/core', 'src/ai', 'src/review', 'src/session', 'src/ui', 'src/storage']) {
      for (const file of sourceFiles(dir)) {
        if (file.endsWith('src/storage/db.ts')) continue;
        if (/indexedDB/.test(stripComments(readFileSync(file, 'utf-8')))) {
          offenders.push(file);
        }
      }
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

  it.each(PURE_LAYER_DIRS)('%s 不碰音频 API', dir => {
    const offenders: string[] = [];
    const files = sourceFiles(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      if (AUDIO_BANNED.test(stripComments(readFileSync(file, 'utf-8')))) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
