import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('poker-trainer.fastMode', '1');
  });
});

test('fixed seed keeps the deal reproducible and the training loop works', async ({ page }) => {
  await page.goto('/');

  const heroCards = page.locator('.hero-cards .card');
  await expect(heroCards).toHaveCount(2);
  const firstDeal = await heroCards.allTextContents();

  await page.reload();
  await expect(heroCards).toHaveCount(2);
  await expect.poll(() => heroCards.allTextContents()).toEqual(firstDeal);

  await page.getByRole('button', { name: '弃牌', exact: true }).click();
  const reviewTrigger = page.getByRole('button', { name: /查看本手复盘/ });
  await expect(reviewTrigger).toBeVisible({ timeout: 30_000 });
  await reviewTrigger.click();

  await expect(page.getByRole('heading', { name: '复盘', exact: true })).toBeVisible();
  await expect(page.getByText('EV 数字为近似估算，非 solver 输出。')).toBeVisible();

  await page.getByRole('button', { name: '报表', exact: true }).click();
  await expect(page.getByRole('heading', { name: '报表', exact: true })).toBeVisible();
  const handsKpi = page.locator('.rep-kpi').filter({ hasText: '手数' });
  await expect(handsKpi).toBeVisible();
  await expect(handsKpi).toContainText('1');
});
