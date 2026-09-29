/**
 * M5-03: Wolkenschatten folgen der Windrichtung – Pixelvergleich zweier Zeitpunkte. Die Szenarien `wolkenschatten`
 * und `wolkenschatten-spaeter` zeigen dieselbe Stelle am bewölkten Vormittag, das zweite einige Sekunden später
 * (eingefrorene Präsentationszeit). Die Render-Debugger-Ansicht `wolken` zeigt die Wolkenschatten allein; das spätere
 * Bild ist das frühere, verschoben – um die Drift, die die Szene für beide Zeitpunkte meldet, und zwar windabwärts.
 */
import { expect, test, type Page } from '@playwright/test';
import { renderedFrames } from './frames';

type Rgba = readonly [number, number, number, number];

interface Dh {
  readPixel(x: number, y: number): Promise<Rgba>;
  call(name: string, ...args: unknown[]): unknown;
}

interface SkyInfo {
  windX: number;
  windY: number;
  clouds: { cover: number; offsetX: number; offsetY: number };
}

test.use({ viewport: { width: 1920, height: 1080 } });
const VIEW_W = 480;
const VIEW_H = 270;
const SCALE = 4;
/** Sampling step of the cloud field [internal px] (clouds are ~176 px across: a coarse grid suffices). */
const STEP = 3;
/** Largest shift searched [internal px] (4 s of the strongest drift, 22 px/s, is 88 px). */
const SEARCH = 96;

function dh<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as { __dh: Dh }).__dh.call(n as string, ...(a as unknown[])) as T, [name, args] as const);
}

/** Opens `scenario`, shows the cloud view and reads it on the grid (red channel 0…255) with the sky of the frame. */
async function clouds(page: Page, scenario: string): Promise<{ grid: Float64Array; w: number; h: number; sky: SkyInfo }> {
  await page.goto(`/?debug=1&scenario=${scenario}`);
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.call('scenarioReady') === true, undefined, { timeout: 180_000 });
  await dh(page, 'renderDebug', 'wolken');
  await renderedFrames(page, 4);
  const w = Math.floor(VIEW_W / STEP);
  const h = Math.floor(VIEW_H / STEP);
  const points: Array<[number, number]> = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) points.push([(i * STEP + 1) * SCALE + SCALE / 2, (j * STEP + 1) * SCALE + SCALE / 2]);
  const px = await page.evaluate(async (pts) => {
    const d = (window as unknown as { __dh: Dh }).__dh;
    return Promise.all(pts.map(([x, y]) => d.readPixel(x, y)));
  }, points);
  const grid = Float64Array.from(px.map((p) => p[0]));
  return { grid, w, h, sky: await dh<SkyInfo>(page, 'skyInfo') };
}

/** Mean squared difference of `b(p)` against `a(p + shift)` over the overlap (shift in grid cells). */
function mismatch(a: Float64Array, b: Float64Array, w: number, h: number, sx: number, sy: number): number {
  let sum = 0;
  let n = 0;
  for (let j = Math.max(0, -sy); j < Math.min(h, h - sy); j++) {
    for (let i = Math.max(0, -sx); i < Math.min(w, w - sx); i++) {
      const d = (b[j * w + i] ?? 0) - (a[(j + sy) * w + i + sx] ?? 0);
      sum += d * d;
      n++;
    }
  }
  return n > 0 ? sum / n : Number.POSITIVE_INFINITY;
}

test('Wolkenschatten ziehen mit dem Wind (Pixelvergleich zweier Zeitpunkte)', async ({ page }) => {
  test.setTimeout(420_000);
  const early = await clouds(page, 'wolkenschatten');
  const late = await clouds(page, 'wolkenschatten-spaeter');
  // A cloudy sky with wind: shadows in the picture, and the view changed between the two moments.
  expect(early.sky.clouds.cover).toBeGreaterThan(0.3);
  expect(Math.hypot(early.sky.windX, early.sky.windY)).toBeGreaterThan(0);
  const shaded = early.grid.filter((v) => v < 250).length / early.grid.length;
  expect(shaded).toBeGreaterThan(0.1);
  expect(shaded).toBeLessThan(0.95);
  expect(mismatch(early.grid, late.grid, early.w, early.h, 0, 0)).toBeGreaterThan(10);
  // The drift the scene reports: the later field at p is the earlier one at p + Δoffset.
  const dx = late.sky.clouds.offsetX - early.sky.clouds.offsetX;
  const dy = late.sky.clouds.offsetY - early.sky.clouds.offsetY;
  expect(Math.hypot(dx, dy)).toBeGreaterThan(2 * STEP);
  // It is downwind: the offset runs against the wind, the pattern with it.
  expect(dx * early.sky.windX + dy * early.sky.windY).toBeLessThan(0);
  // Find the shift that matches the two pictures best.
  const cells = Math.ceil(SEARCH / STEP);
  let best = { sx: 0, sy: 0, e: Number.POSITIVE_INFINITY };
  for (let sy = -cells; sy <= cells; sy++) {
    for (let sx = -cells; sx <= cells; sx++) {
      const e = mismatch(early.grid, late.grid, early.w, early.h, sx, sy);
      if (e < best.e) best = { sx, sy, e };
    }
  }
  test.info().annotations.push({ type: 'drift', description: `gemessen (${best.sx * STEP}, ${best.sy * STEP}) px, gemeldet (${dx.toFixed(1)}, ${dy.toFixed(1)}) px, Rest ${best.e.toFixed(1)}` });
  expect(Math.abs(best.sx * STEP - dx)).toBeLessThanOrEqual(STEP);
  expect(Math.abs(best.sy * STEP - dy)).toBeLessThanOrEqual(STEP);
  // Shifted back, the pictures agree (the grid samples fall on the cloud field's pixels within a step).
  expect(best.e).toBeLessThan(mismatch(early.grid, late.grid, early.w, early.h, 0, 0) / 4);
});
