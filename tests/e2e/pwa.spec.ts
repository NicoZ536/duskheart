/**
 * M7-59 PWA (MASTERPROMPT §3.1 „installierbar, offline startbar“; docs/SPIEL.md §25): der Produktions-Build bringt ein
 * Manifest (Name, Start-URL, Vollbild, Icons 192 und 512 px aus den Pixel-Quellen) und einen Service Worker
 * (vite-plugin-pwa, Workbox), der Build, Atlanten und Worker beim ersten Laden zwischenspeichert. Danach startet das
 * Spiel ohne Netz: das Hauptmenü erscheint über seiner Szene. Debug-Seiten installieren keinen Service Worker.
 */
import { expect, test } from '@playwright/test';

interface Manifest {
  name: string;
  start_url: string;
  display: string;
  icons: Array<{ src: string; sizes: string; type: string }>;
}

test('Manifest und Icons; nach dem ersten Laden startet das Spiel offline ins Hauptmenü', async ({ page, context }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('/');
  await expect(page.getByTestId('ui-hauptmenue')).toBeVisible({ timeout: 120_000 });

  // The manifest the page links, with its icons.
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).not.toBeNull();
  const manifest = (await (await page.request.get(new URL(href ?? '', page.url()).href)).json()) as Manifest;
  expect(manifest).toMatchObject({ name: 'DUSKHEARTH', display: 'fullscreen' });
  for (const size of ['192x192', '512x512']) {
    const icon = manifest.icons.find((i) => i.sizes === size && i.type === 'image/png');
    expect(icon, size).toBeDefined();
    const res = await page.request.get(new URL(icon?.src ?? '', page.url()).href);
    expect(res.ok(), size).toBe(true);
  }

  // The service worker installs and takes the page; its precache holds the build.
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state ?? null), { timeout: 120_000 }).toBe('activated');
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 60_000 });
  const cached = await page.evaluate(async () => {
    let n = 0;
    for (const name of await caches.keys()) n += (await (await caches.open(name)).keys()).length;
    return n;
  });
  expect(cached).toBeGreaterThan(10);

  // Offline: the game starts from the cache – main menu over its scene.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('ui-hauptmenue')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('menue-neue-welt')).toBeVisible();
  await context.setOffline(false);
  expect(errors).toEqual([]);
});

test('eine Debug-Seite installiert keinen Service Worker', async ({ page }) => {
  await page.goto('/?debug=1');
  await page.waitForFunction(() => (window as unknown as { __dh?: { ready: boolean } }).__dh?.ready === true, undefined, { timeout: 120_000 });
  await page.waitForTimeout(1000);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});
