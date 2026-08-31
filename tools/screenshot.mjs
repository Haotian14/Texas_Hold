import { chromium } from 'playwright';

/**
 * 把四个页面在两种屏宽下截图，供 tools/visual-diff.mjs 逐像素对比。
 *
 * 用法：
 *   npm run build && npx vite preview --port 4173 &
 *   node tools/screenshot.mjs <输出目录>
 *
 * **牌桌那两张有约 0.5% 的固有噪声**：每次会话的 seed 是随机的，发的牌不同。
 * 判断"有没有改坏"时以另外三页为准，它们是静态的，无改动时应当逐像素一致
 * （实测 0.000%）。要让牌桌也可比，得先给应用加一个固定 seed 的入口，
 * 那是另一件事。
 *
 * PLAYWRIGHT_CHROMIUM 可以指定浏览器可执行文件；不设时走 playwright 自己的
 * 解析（本机 `npx playwright install` 装过就能直接跑）。
 */
const out = process.argv[2];
// 不给输出目录就明确报错。不加这一条时它会把图写进字面量目录 `undefined/`
// 并打印「截图完成 -> undefined」——看起来是成功的，而且会在仓库里留下一个
// 谁也不知道从哪来的目录（真踩过）。同 tools/overlap-all.sh 那条：
// 「没有报告问题」和「没有跑对」必须长得不一样。
if (!out) {
  console.error('用法：node tools/screenshot.mjs <输出目录>');
  process.exit(1);
}
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4173/';

const exe = process.env.PLAYWRIGHT_CHROMIUM;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

for (const [tag, size] of [
  ['desk', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
]) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.nav', { timeout: 15000 });
  await page.waitForTimeout(1200);            // 等 AI 先动完，牌桌进入 hero 回合
  await page.screenshot({ path: `${out}/${tag}-table.png`, fullPage: false });

  for (const name of ['复盘', '报表', '设置']) {
    await page.getByRole('button', { name: new RegExp(name) }).first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${tag}-${name}.png`, fullPage: false });
  }

  // 历史页：从复盘页的「全部手牌」进
  await page.getByRole('button', { name: /复盘/ }).first().click();
  await page.waitForTimeout(300);
  const all = page.getByRole('button', { name: /全部手牌/ });
  if (await all.count()) {
    await all.first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${tag}-历史.png` });
  }

  if (errs.length) console.log(`[${tag}] 控制台报错:`, errs.slice(0, 5));
  await ctx.close();
}

await browser.close();
console.log('截图完成 ->', out);
