import { chromium } from 'playwright';

/**
 * 牌面点数是否会被撑出牌外。
 *
 * 用法：node tools/card-fit-check.mjs [屏宽...]
 *
 * 「10」是唯一两个字符的点数，字号与单字符一致之后，它是最可能溢出的那个。
 * 这个脚本自动打若干手，把出现过的每一张牌都量一遍：点数文字的实际排版宽度
 * （Range.getBoundingClientRect，不是元素的 offsetWidth——后者会被 flex 压缩
 * 而读不出溢出）必须落在牌面的内容宽度里。
 *
 * 三档牌面（sm/md/lg）与 hero、board 的各自覆盖都要覆盖到，所以要摊牌、要
 * 走到河牌，脚本靠一直点「下一手」跑够手数。
 */
const widths = process.argv.slice(2).map(Number);
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4173/';
const exe = process.env.PLAYWRIGHT_CHROMIUM;

const browser = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0, seen = 0;

for (const W of (widths.length ? widths : [320, 360, 390, 430, 1280])) {
  const ctx = await browser.newContext({ viewport: { width: W, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.table', { timeout: 15000 });

  const ranks = new Map();          // 点数 -> 最坏的占用比
  for (let step = 0; step < 50; step++) {
    await page.waitForTimeout(260);
    const rows = await page.evaluate(() => {
      const out = [];
      for (const card of document.querySelectorAll('.card')) {
        const rankEl = card.querySelector('.card-rank');
        if (!rankEl || !rankEl.firstChild) continue;
        const cs = getComputedStyle(card);
        const inner = card.clientWidth
          - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        // 用 Range 量真实排版宽度：元素本身会被 flex 压扁，读不出溢出
        const rg = document.createRange();
        rg.selectNodeContents(rankEl);
        const w = rg.getBoundingClientRect().width;
        out.push({ text: rankEl.textContent, w, inner });
      }
      return out;
    });
    for (const r of rows) {
      seen++;
      const frac = r.w / r.inner;
      const prev = ranks.get(r.text);
      if (prev === undefined || frac > prev) ranks.set(r.text, frac);
    }
    const next = page.getByRole('button', { name: /下一手/ });
    if (await next.count()) { await next.first().click(); continue; }
    const rebuy = page.getByRole('button', { name: /^补 / });
    if (await rebuy.count()) { await rebuy.first().click(); continue; }
    for (const n of ['过牌', '跟注', '加注到']) {
      const b = page.getByRole('button', { name: new RegExp(`^${n}`) });
      if (await b.count()) { await b.first().click(); break; }
    }
  }

  const worst = [...ranks.entries()].sort((a, b) => b[1] - a[1]);
  const over = worst.filter(([, f]) => f > 1);
  bad += over.length;
  const top = worst.slice(0, 3).map(([t, f]) => `${t} ${Math.round(f * 100)}%`).join('  ');
  console.log(`${W}px  见过 ${ranks.size} 种点数，占牌宽最多的：${top}` +
              (over.length ? `   ❌ 溢出：${over.map(([t]) => t).join(', ')}` : '   ✅'));
  await ctx.close();
}

await browser.close();
console.log(bad === 0
  ? `\n✅ 量了 ${seen} 张牌，没有一张的点数被撑出牌外`
  : `\n❌ ${bad} 处溢出`);
