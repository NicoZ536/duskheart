import { expect, test, type Page } from '@playwright/test';

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __dh?: { ready?: boolean } }).__dh?.ready === true);
}

test('startet mit WebGL2 ohne Konsolenfehler', async ({ page }) => {
  const msgs = collectConsole(page);
  await page.goto('/?debug=1');
  await waitReady(page);
  const info = await page.evaluate(() => (window as unknown as { __dh: { call(n: string): { webgl2: boolean } } }).__dh.call('gl'));
  expect(info.webgl2).toBe(true);
  await page.waitForFunction(() => (window as unknown as { __dh: { call(n: string): number } }).__dh.call('frames') > 5);
  expect(msgs).toEqual([]);
});

test('zeigt ohne WebGL2 eine verständliche Meldung', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2') return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto('/');
  const box = page.locator('[data-testid="no-webgl2"]');
  await expect(box).toBeVisible();
  await expect(box).toContainText('WebGL2');
});

test('Einstellungen bleiben nach Neuladen erhalten', async ({ page }) => {
  const msgs = collectConsole(page);
  await page.goto('/?debug=1');
  await waitReady(page);
  await page.evaluate(() => (window as unknown as { __dh: { exec(c: string): string } }).__dh.exec('set language en'));
  await page.reload();
  await waitReady(page);
  const lang = await page.evaluate(() => document.documentElement.lang);
  expect(lang).toBe('en');
  expect(msgs).toEqual([]);
});
