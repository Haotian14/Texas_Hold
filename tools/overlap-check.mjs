import { chromium } from 'playwright';

/**
 * 牌桌元素的遮挡检测。
 *
 * 用法：node tools/overlap-check.mjs [屏宽]
 *
 * 「不要相互遮挡」这件事靠看截图是查不干净的：牌桌上的元素随牌局状态出现和
 * 消失（动作徽章只在刚行动过时挂着、下注筹码堆随街清空、摊牌才亮底牌），
 * 一屏截图只覆盖其中一种组合。这个脚本自动打若干手，在每个状态下量所有
 * 牌桌元素的 boundingBox 并两两求交。
 *
 * 排除祖先-后代对：子元素落在父元素框内是正常的，不是遮挡。
 */
const WIDTH = Number(process.argv[2] ?? 390);
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4173/';
const exe = process.env.PLAYWRIGHT_CHROMIUM;

/**
 * 参与检测的元素。每一项都必须是**自己就画得出东西**的视觉块。
 *
 * `.table-center` 刻意不在其中：它是个布局容器，宽屏上带 `padding-top: 28%`
 * 把内容推到牌桌中央，于是它的盒子横跨整个牌桌、高好几十像素，而真正画出
 * 东西的只有里面的 `.pot` 与 `.board`。把它算进来会让每一个座位都"遮挡"它，
 * 1280px 下一次报 243 组——全是假的。容器测不出遮挡，只有内容能。
 */
const SELECTORS = [
  '.seat-info', '.bubble', '.seat-bet', '.dealer-btn', '.seat-cards',
  '.pot', '.board', '.hero-cards', '.hero-equity',
];

const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 844 } });
const page = await ctx.newPage();
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('.table', { timeout: 15000 });

// 打开胜率读数：它在牌桌上多占一块，默认关着的话这条路径永远扫不到
const eq = page.getByRole('button', { name: '显示胜率' });
if (await eq.count()) await eq.first().click();

async function measure(label) {
  return page.evaluate(({ SELECTORS, label }) => {
    const nodes = [];
    for (const sel of SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        // 不可见的不算：淡出中的下注框（opacity 0）不该报遮挡
        if (r.width < 1 || r.height < 1) continue;
        if (st.visibility === 'hidden' || Number(st.opacity) < 0.05) continue;
        nodes.push({ sel, el, r, text: (el.textContent || '').trim().slice(0, 22) });
      }
    }
    const hits = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        // 祖先-后代不算遮挡
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (x <= 0.5 || y <= 0.5) continue;
        const area = x * y;
        const frac = area / Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
        hits.push({
          label,
          a: `${a.sel}${a.text ? `(${a.text})` : ''}`,
          b: `${b.sel}${b.text ? `(${b.text})` : ''}`,
          overlap: `${Math.round(x)}×${Math.round(y)}px`,
          frac: Math.round(frac * 100),
        });
      }
    }
    return hits;
  }, { SELECTORS, label });
}

/** 也检查有没有元素被挤出视口 */
async function offscreen(label) {
  return page.evaluate(({ SELECTORS, label, W }) => {
    const out = [];
    for (const sel of SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width < 1) continue;
        if (r.left < -0.5 || r.right > W + 0.5) {
          out.push({ label, sel, text: (el.textContent || '').trim().slice(0, 22),
                     left: Math.round(r.left), right: Math.round(r.right) });
        }
      }
    }
    return out;
  }, { SELECTORS, label, W: WIDTH });
}

const allHits = [];
const allOff = [];
const seen = new Set();

for (let step = 0; step < 60; step++) {
  await page.waitForTimeout(320);
  const hits = await measure(`步 ${step}`);
  for (const h of hits) {
    const key = `${h.a}|${h.b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    allHits.push(h);
  }
  for (const o of await offscreen(`步 ${step}`)) {
    const key = `off:${o.sel}:${o.text}`;
    if (!seen.has(key)) { seen.add(key); allOff.push(o); }
  }

  // 轮到 hero 就随便打一个；结算了就下一手
  const next = page.getByRole('button', { name: /下一手/ });
  if (await next.count()) { await next.first().click(); continue; }
  const rebuy = page.getByRole('button', { name: /^补 / });
  if (await rebuy.count()) { await rebuy.first().click(); continue; }
  const acts = ['加注到', '跟注', '过牌', '弃牌'];
  const pick = acts[step % acts.length];
  const btn = page.getByRole('button', { name: new RegExp(`^${pick}`) });
  if (await btn.count()) await btn.first().click();
}

await browser.close();

console.log(`\n屏宽 ${WIDTH}px，扫了 60 个牌局状态\n`);
if (allHits.length === 0) console.log('✅ 没有相互遮挡');
else {
  console.log(`❌ ${allHits.length} 组遮挡：`);
  for (const h of allHits.sort((x, y) => y.frac - x.frac)) {
    console.log(`   [${h.frac}%] ${h.a}\n        × ${h.b}   重叠 ${h.overlap}`);
  }
}
if (allOff.length) {
  console.log(`\n❌ ${allOff.length} 个元素超出视口：`);
  for (const o of allOff) console.log(`   ${o.sel}(${o.text})  left=${o.left} right=${o.right}`);
} else console.log('\n✅ 没有元素被挤出视口');
