import { test, expect, apiGet } from 'touchstone';

test('@smoke the app is reachable', async () => {
  const res = await apiGet("/", { auth: false });
  expect(res.status).toBeLessThan(500);
});

test('@e2e the home page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
});
