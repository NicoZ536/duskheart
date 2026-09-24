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

/** Boot mit WebGL2 (Chromium + SwiftShader) und Einstellungen über Neuladen; ohne WebGL2: webgl2-fehlt.spec.ts. */
test('startet mit WebGL2 ohne Konsolenfehler', async ({ page }) => {
  const msgs = collectConsole(page);
  await page.goto('/?debug=1');
  await waitReady(page);
  const info = await page.evaluate(() => (window as unknown as { __dh: { call(n: string): { webgl2: boolean } } }).__dh.call('gl'));
  expect(info.webgl2).toBe(true);
  await page.waitForFunction(() => (window as unknown as { __dh: { call(n: string): number } }).__dh.call('frames') > 5);
  expect(msgs).toEqual([]);
});

/** §30 "Start: Titelbildschirm ≤ 3 s". */
const TITLE_BUDGET_MS = 3000;
/** §30 "neue Welt ‚Mittel' spielbar ≤ 8 s": the session world generated in the worker and its view streamed in. */
const WORLD_BUDGET_MS = 8000;

interface GameViewInfo {
  scene: string;
  state: string;
  mode: string;
  seed: number;
  camera: [number, number];
  follows: boolean;
  resident: number;
  syncLoads: number;
  terrain: { drawn: number; missing: number; partial: number };
  objects: { pushed: number };
}

test('zeigt sofort den Titel und dahinter den Startstrand der im Welt-Worker erzeugten Sitzungswelt', async ({ page }) => {
  const msgs = collectConsole(page);
  await page.goto('/?debug=1');
  await expect(page.locator('.dh-titlecard')).toBeVisible();
  const titleMs = await page.evaluate(() => performance.now());
  expect(titleMs).toBeLessThan(TITLE_BUDGET_MS);
  await waitReady(page);
  // While the world is generated, the title shows the running step and the simulation rests.
  await page.waitForFunction(() => (window as unknown as { __dh: { call(n: string): { sceneReady: boolean } } }).__dh.call('renderInfo').sceneReady, undefined, { timeout: 60_000 });
  const readyMs = await page.evaluate(() => performance.now());
  expect(readyMs).toBeLessThan(WORLD_BUDGET_MS);
  await expect(page.getByTestId('ui-world-loading')).toHaveCount(0);
  const view = await page.evaluate(() => (window as unknown as { __dh: { call(n: string): GameViewInfo } }).__dh.call('worldInfo'));
  const sim = await page.evaluate(() => (window as unknown as { __dh: { state(): { sim: { seed: number; worldSize: string; world: { ready: boolean } } } } }).__dh.state().sim);
  expect(view).toMatchObject({ scene: 'spiel', state: 'bereit', mode: 'worker', follows: false, syncLoads: 0 });
  expect(view.seed).toBe(sim.seed);
  expect(sim.worldSize).toBe('medium');
  expect(sim.world.ready).toBe(true);
  expect(view.terrain.missing).toBe(0);
  expect(view.terrain.drawn).toBeGreaterThanOrEqual(1);
  expect(view.objects.pushed).toBeGreaterThan(10);
  const info = await page.evaluate(() => (window as unknown as { __dh: { call(n: string): Record<string, unknown> } }).__dh.call('renderInfo'));
  expect(info).toMatchObject({ scene: 'spiel', debugView: 'off', gameAtlas: 'bereit', shaderErrors: [] });
  // The simulation runs once the world is there.
  await page.waitForFunction(() => (window as unknown as { __dh: { call(n: string): number } }).__dh.call('tick') > 10);
  console.info('boot', JSON.stringify({ titleMs: Math.round(titleMs), readyMs: Math.round(readyMs) }));
  expect(msgs).toEqual([]);
});

test('die Titelzeile nennt den laufenden Schritt der Weltgenerierung, bis die Welt steht', async ({ page }) => {
  const msgs = collectConsole(page);
  // Another seed: a world the page has not generated before (the medium world takes 1–2 s in the worker).
  await page.goto('/?debug=1&seed=77');
  const line = page.getByTestId('ui-world-loading');
  await expect(line).toBeVisible();
  await expect(line).toContainText(/\((\d)\/8\)/);
  await page.waitForFunction(() => (window as unknown as { __dh?: { call(n: string): { sceneReady: boolean } } }).__dh?.call('renderInfo').sceneReady === true, undefined, { timeout: 60_000 });
  await expect(line).toHaveCount(0);
  expect(msgs).toEqual([]);
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
