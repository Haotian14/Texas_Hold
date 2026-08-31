import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const [W,H] = (process.argv[2]||'360x688').split('x').map(Number);
const ctx = await b.newContext({ viewport: { width: W, height: H } });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await p.waitForSelector('.table');
// hero 一上来就弃牌，触发「亮出还在牌里的对手底牌」
for (let i = 0; i < 60; i++) {
  await p.waitForTimeout(200);
  const cards = await p.locator('.opponent-slot .seat-cards').count();
  const pot = await p.locator('.pot').count();
  if (cards > 0 && pot > 0) break;
  const nx = p.getByRole('button', { name: /下一手/ });
  if (await nx.count()) { await nx.first().click(); continue; }
  const rb = p.getByRole('button', { name: /^补 / });
  if (await rb.count()) { await rb.first().click(); continue; }
  const f = p.getByRole('button', { name: '弃牌' });
  if (await f.count()) { await f.first().click(); continue; }
}
const r = await p.evaluate(() => {
  const box = e => { const b = e.getBoundingClientRect();
    return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right) }; };
  const pot = document.querySelector('.pot');
  const out = { 底池: pot ? box(pot) : null, 各座位底牌: [] };
  for (const slot of document.querySelectorAll('.opponent-slot')) {
    const c = slot.querySelector('.seat-cards');
    if (!c) continue;
    out.各座位底牌.push({ 槽: slot.className.match(/slot-\d/)[0], ...box(c) });
  }
  const b2 = document.querySelector('.board');
  out.公共牌 = b2 ? box(b2) : null;
  return out;
});
console.log(JSON.stringify(r, null, 1));
await b.close();
