/**
 * M0-11/M0-12: Die WebGL2-Testszene rendert (Pixelprobe über `__dh.readPixel`). Im Szenario
 * „testszene“ (Screenshot-Modus: HUD aus, Zeit eingefroren) ist das Bild deterministisch; bei einem
 * sehr breiten Fenster liegt die Szene zwischen schwarzen Balken (§4.2, interne Breite ≤ 640 px).
 */
import { expect, test, type Page } from '@playwright/test';

type Rgba = readonly [number, number, number, number];

interface DhProbe {
  ready: boolean;
  screenshot: boolean;
  timeFrozen: boolean;
  readPixel(x: number, y: number): Promise<Rgba>;
  call(name: string, ...args: unknown[]): unknown;
}

/** 1600×600 CSS px (DPR 1): 640×270 intern, Faktor 20/9 → Bild 1422 px breit, 89 px Balken links und rechts. */
const VIEWPORT = { width: 1600, height: 600 };
const BAR_WIDTH = 89;
/**
 * Mitte des wandernden Warmlichts bei der eingefrorenen Szenariozeit 1,7 s: intern (437, 215) von
 * unten (testScene.ts: 640·(0,5 + 0,35·cos(1,02)), 270·(0,5 + 0,3·sin(1,53))), also Bildschirm
 * x = 89 + 437,5·20/9 ≈ 1061, y = (270 − 216 + 0,5)·20/9 ≈ 121.
 */
const LIGHT_CENTER = [1061, 121] as const;

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

function probe(page: Page, points: ReadonlyArray<readonly [number, number]>): Promise<Rgba[]> {
  return page.evaluate(async (pts) => {
    const dh = (window as unknown as { __dh: DhProbe }).__dh;
    return Promise.all(pts.map(([x, y]) => dh.readPixel(x, y)));
  }, points);
}

test.use({ viewport: VIEWPORT });

test('Pixelprobe: Testszene gerendert, Balken schwarz, eingefrorenes Bild stabil', async ({ page }) => {
  const msgs = collectConsole(page);
  await page.goto('/?debug=1&scenario=testszene');
  await page.waitForFunction(() => (window as unknown as { __dh?: DhProbe }).__dh?.call('scenarioReady') === true);
  const state = await page.evaluate(() => {
    const dh = (window as unknown as { __dh: DhProbe }).__dh;
    return { gl: dh.call('gl') as { webgl2: boolean }, screenshot: dh.screenshot, frozen: dh.timeFrozen };
  });
  expect(state).toEqual({ gl: expect.objectContaining({ webgl2: true }), screenshot: true, frozen: true });
  await expect(page.locator('#dh-ui')).toBeHidden();

  // Side bars: the clear colour, opaque black.
  const bars = await probe(page, [
    [10, 300],
    [BAR_WIDTH - 2, 20],
    [VIEWPORT.width - 10, 580],
  ]);
  for (const px of bars) expect(px).toEqual([0, 0, 0, 255]);

  // Scene: a 6×4 grid inside the image shows the lit palette ramps.
  const grid: Array<[number, number]> = [];
  for (let gx = 0; gx < 6; gx++) for (let gy = 0; gy < 4; gy++) grid.push([BAR_WIDTH + 60 + gx * 250, 60 + gy * 150]);
  const first = await probe(page, grid);
  for (const px of first) expect(px[3]).toBe(255);
  const distinct = new Set(first.map((px) => px.slice(0, 3).join(','))).size;
  expect(distinct).toBeGreaterThanOrEqual(8);
  // Under the light the brightest palette ramp (near white) glows warm: red ≥ green ≥ blue, bright.
  const [light] = await probe(page, [LIGHT_CENTER]);
  const [r, g, b] = light ?? [0, 0, 0, 0];
  expect(r).toBeGreaterThan(220);
  expect(r).toBeGreaterThanOrEqual(g);
  expect(g).toBeGreaterThanOrEqual(b);
  // Far from the light the scene is dark but not the clear colour everywhere.
  const darkest = Math.min(...first.map(([pr, pg, pb]) => pr + pg + pb));
  expect(darkest).toBeLessThan(r);

  // Frozen time: the next frames show exactly the same image.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await probe(page, grid)).toEqual(first);

  await expect(page.evaluate((w) => (window as unknown as { __dh: DhProbe }).__dh.readPixel(w, 0), VIEWPORT.width)).rejects.toThrow(/außerhalb/);
  expect(msgs).toEqual([]);
});
