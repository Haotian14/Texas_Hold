import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/**
 * 逐像素对比两组截图，把有差异的那几张的差异图写进第三个目录。
 *
 * 用法：node tools/visual-diff.mjs <基线目录> <新目录> <差异图目录>
 *
 * 0.05% 以下算"一致"——低于这个量级的只可能是抗锯齿的抖动。牌桌那两张
 * 的噪声在 0.5% 上下，见 tools/screenshot.mjs 顶部的说明。
 */
const [a, b, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
let worst = 0;
for (const f of fs.readdirSync(a).filter(f => f.endsWith('.png'))) {
  if (!fs.existsSync(path.join(b, f))) { console.log(`缺失: ${f}`); continue; }
  const A = PNG.sync.read(fs.readFileSync(path.join(a, f)));
  const B = PNG.sync.read(fs.readFileSync(path.join(b, f)));
  if (A.width !== B.width || A.height !== B.height) { console.log(`尺寸不同: ${f}`); continue; }
  const out = new PNG({ width: A.width, height: A.height });
  const n = pixelmatch(A.data, B.data, out.data, A.width, A.height, { threshold: 0.1 });
  const pct = (n / (A.width * A.height)) * 100;
  worst = Math.max(worst, pct);
  console.log(`${pct > 0.05 ? '差异' : '一致'}  ${f.padEnd(18)} ${n} px (${pct.toFixed(3)}%)`);
  if (pct > 0.05) fs.writeFileSync(path.join(outDir, f), PNG.sync.write(out));
}
console.log(`\n最大差异 ${worst.toFixed(3)}%`);
