/**
 * M0-16 UI-Schicht im Browser: Das Preact-Overlay liegt über der WebGL-Testszene, lässt Zeiger-
 * eingaben zur Spielwelt durch und verändert das gerenderte Bild nicht (Pixelprobe mit und ohne
 * Overlay gleich). Die Statuszeile folgt der Simulationszeit über die Signals-Brücke und der
 * Sprache ohne Neuladen; das Theme setzt Farb-Tokens und die ganzzahlige UI-Skalierung.
 * Keine Konsolenfehler.
 */
import { expect, test, type Page } from '@playwright/test';
import { UI_HEX } from '../../src/generated/palette';

type Rgba = readonly [number, number, number, number];
type Point = readonly [number, number];

interface DhHandle {
  ready: boolean;
  screenshot: boolean;
  timeFrozen: boolean;
  readPixel(x: number, y: number): Promise<Rgba>;
  call(name: string, ...args: unknown[]): unknown;
  screenshotMode(on: boolean): void;
  freezeTime(on: boolean): void;
  setSpeed(factor: number): void;
  exec(line: string): string;
  state(): { sim: { day: number; time: string } };
}

// Pins the detected UI language (German first; the second test switches to English at runtime).
test.use({ locale: 'de-DE' });

/** Simulation speed while waiting for the clock to advance (5 ticks per frame at most). */
const FAST_SPEED = 8;

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

function screenshotMode(page: Page, on: boolean): Promise<void> {
  return page.evaluate((v) => (window as unknown as { __dh: DhHandle }).__dh.screenshotMode(v), on);
}

function freezeTime(page: Page, on: boolean): Promise<void> {
  return page.evaluate((v) => (window as unknown as { __dh: DhHandle }).__dh.freezeTime(v), on);
}

function exec(page: Page, line: string): Promise<string> {
  return page.evaluate((l) => (window as unknown as { __dh: DhHandle }).__dh.exec(l), line);
}

function probe(page: Page, points: readonly Point[]): Promise<Rgba[]> {
  return page.evaluate(async (pts) => {
    const api = (window as unknown as { __dh: DhHandle }).__dh;
    return Promise.all(pts.map(([x, y]) => api.readPixel(x, y)));
  }, points);
}

function nextFrames(page: Page): Promise<unknown> {
  return page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function centerOf(page: Page, selector: string): Promise<Point> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} has no layout box`);
  return [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)];
}

/** Topmost hit-test target at a point: its id/test id and whether it lies inside the overlay root. */
function hitAt(page: Page, [x, y]: Point): Promise<{ id: string; inOverlay: boolean }> {
  return page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py);
      const host = el?.closest('[data-testid]') ?? el;
      return { id: host?.getAttribute('data-testid') ?? host?.id ?? '', inOverlay: el !== null && el.closest('#dh-ui') !== null };
    },
    [x, y] as const,
  );
}

test('Overlay liegt über der Testszene, die Pixelprobe der Szene bleibt unverändert', async ({ page }) => {
  const msgs = collectConsole(page);
  await page.goto('/?debug=1&scenario=testszene');
  await page.waitForFunction(() => (window as unknown as { __dh?: DhHandle }).__dh?.call('scenarioReady') === true);
  // The scenario starts in screenshot mode: overlay hidden, time frozen, fixed presentation time.
  await expect(page.locator('#dh-ui')).toBeHidden();

  await screenshotMode(page, false);
  await freezeTime(page, true);
  const status = page.getByTestId('ui-status');
  await expect(status).toBeVisible();
  await expect(status).toHaveText(/^Tag 1 · 06:\d\d$/);
  await expect(page.locator('.dh-titlecard')).toBeVisible();

  const statusCenter = await centerOf(page, '[data-testid="ui-status"]');
  const titleCenter = await centerOf(page, '.dh-title');
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const points: Point[] = [statusCenter, titleCenter];
  for (let gx = 1; gx <= 5; gx++) for (let gy = 1; gy <= 3; gy++) points.push([Math.round((viewport.width * gx) / 6), Math.round((viewport.height * gy) / 4)]);

  // Z-order: HUD text is click-through (pointer input reaches the canvas) …
  expect(await hitAt(page, statusCenter)).toEqual({ id: 'dh-canvas', inOverlay: false });
  expect(await hitAt(page, titleCenter)).toEqual({ id: 'dh-canvas', inOverlay: false });
  // … and as soon as it takes part in hit testing, it is the topmost element above the canvas.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-testid="ui-status"], .dh-titlecard')) el.style.pointerEvents = 'auto';
  });
  expect(await hitAt(page, statusCenter)).toEqual({ id: 'ui-status', inOverlay: true });
  expect((await hitAt(page, titleCenter)).inOverlay).toBe(true);

  // Pixel probe of the scene: identical with the overlay shown, hidden and shown again.
  await nextFrames(page);
  const shown = await probe(page, points);
  for (const px of shown) expect(px[3]).toBe(255);
  expect(new Set(shown.map((px) => px.slice(0, 3).join(','))).size).toBeGreaterThanOrEqual(6);

  await screenshotMode(page, true);
  await expect(page.locator('#dh-ui')).toBeHidden();
  await nextFrames(page);
  expect(await probe(page, points)).toEqual(shown);

  await screenshotMode(page, false);
  await expect(status).toBeVisible();
  await nextFrames(page);
  expect(await probe(page, points)).toEqual(shown);
  expect(msgs).toEqual([]);
});

test('Statuszeile folgt der Simulationszeit und der Sprache, Theme setzt Tokens und UI-Skalierung', async ({ page }) => {
  const msgs = collectConsole(page);
  await page.goto('/?debug=1');
  await page.waitForFunction(() => (window as unknown as { __dh?: DhHandle }).__dh?.ready === true);
  const status = page.getByTestId('ui-status');
  await expect(status).toHaveText(/^Tag 1 · 06:\d\d$/);

  // The clock runs: the status line follows the simulation through the bridge signals.
  const first = await status.textContent();
  await page.evaluate((f) => (window as unknown as { __dh: DhHandle }).__dh.setSpeed(f), FAST_SPEED);
  await expect.poll(() => status.textContent()).not.toBe(first);

  // Frozen: the line shows exactly the simulation's day and time.
  await freezeTime(page, true);
  await nextFrames(page);
  const sim = await page.evaluate(() => (window as unknown as { __dh: DhHandle }).__dh.state().sim);
  await expect(status).toHaveText(`Tag ${sim.day} · ${sim.time}`);

  // Language switch without reload re-renders the overlay.
  await exec(page, 'set language en');
  await expect(status).toHaveText(`Day ${sim.day} · ${sim.time}`);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');

  // Theme: colour tokens from the master palette, integer UI scale (auto from the viewport, or fixed).
  const cssVar = (name: string): Promise<string> => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  expect(await cssVar('--dh-akzent')).toBe(UI_HEX.akzent);
  expect(await cssVar('--dh-rahmen-hell')).toBe(UI_HEX.rahmenHell);
  expect(await cssVar('--dh-ui-scale')).toBe('2');
  const titleSize = (): Promise<string> => page.evaluate(() => getComputedStyle(document.querySelector('.dh-title') as Element).fontSize);
  expect(await titleSize()).toBe('48px');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect.poll(() => cssVar('--dh-ui-scale')).toBe('4');
  expect(await titleSize()).toBe('96px');
  await exec(page, 'set accessibility.uiScale 1');
  await expect.poll(() => cssVar('--dh-ui-scale')).toBe('1');
  expect(await titleSize()).toBe('24px');
  expect(msgs).toEqual([]);
});
