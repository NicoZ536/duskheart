/**
 * M1-09: Ohne Float-Render-Targets kodiert der Renderer HDR-Ziele in RGBA8. Per `?forceRgba8=1`
 * erzwungen rendert die Testszene weiter – bis auf die Quantisierung der Kodierung dasselbe Bild.
 */
import { expect, test, type Page } from '@playwright/test';

type Rgba = readonly [number, number, number, number];

interface DhRender {
  readPixel(x: number, y: number): Promise<Rgba>;
  call(name: string, ...args: unknown[]): unknown;
}

interface RenderInfo {
  floatTargets: boolean;
  forcedRgba8: boolean;
  hdrFormat: string;
}

/** 1600×600 CSS px: 640×270 internal, the warm light of the test scene at (1061, 121). */
const VIEWPORT = { width: 1600, height: 600 };
const LIGHT_CENTER = [1061, 121] as const;
/** RGBA8 stores HDR / 4: up to two 8-bit steps of rounding on the way through. */
const TOLERANCE = 3;

test.use({ viewport: VIEWPORT });

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

async function render(page: Page, query: string): Promise<{ info: RenderInfo; pixels: Rgba[] }> {
  await page.goto(`/?debug=1&scenario=testszene${query}`);
  await page.waitForFunction(() => (window as unknown as { __dh?: DhRender }).__dh?.call('scenarioReady') === true);
  const points: Array<[number, number]> = [[...LIGHT_CENTER]];
  for (let gx = 0; gx < 6; gx++) for (let gy = 0; gy < 4; gy++) points.push([149 + gx * 250, 60 + gy * 150]);
  return page.evaluate(async (pts) => {
    const d = (window as unknown as { __dh: DhRender }).__dh;
    return { info: d.call('renderInfo') as RenderInfo, pixels: await Promise.all(pts.map(([x, y]) => d.readPixel(x, y))) };
  }, points);
}

test('erzwungener RGBA8-Fallback rendert die Testszene', async ({ page }) => {
  const msgs = collectConsole(page);
  const normal = await render(page, '');
  const fallback = await render(page, '&forceRgba8=1');
  expect(fallback.info.floatTargets).toBe(false);
  expect(fallback.info.hdrFormat).toBe('RGBA8');
  if (normal.info.floatTargets) {
    expect(normal.info.hdrFormat).toBe('RGBA16F');
    expect(fallback.info.forcedRgba8).toBe(true);
  }
  const [light] = fallback.pixels;
  expect(light?.[0]).toBeGreaterThan(220);
  fallback.pixels.forEach((px, i) => {
    const ref = normal.pixels[i] ?? [0, 0, 0, 0];
    for (let c = 0; c < 3; c++) expect(Math.abs((px[c] ?? 0) - (ref[c] ?? 0)), `Punkt ${i}, Kanal ${c}`).toBeLessThanOrEqual(TOLERANCE);
    expect(px[3]).toBe(255);
  });
  expect(new Set(fallback.pixels.map((p) => p.join(','))).size).toBeGreaterThanOrEqual(8);
  expect(msgs).toEqual([]);
});
