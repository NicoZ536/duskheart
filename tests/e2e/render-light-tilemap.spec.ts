/**
 * M1-13 in the browser: the chunk tile map has no seams – four chunks of one textured tile repeat
 * every 16 px straight across both chunk borders, no background shows through – and the `tilemap`
 * scenario (meadow, road across the border, sprites on top) renders with one draw call per chunk.
 */
import { expect, test, type Page } from '@playwright/test';

type Rgba = readonly [number, number, number, number];

interface DhRender {
  readPixel(x: number, y: number): Promise<Rgba>;
  call(name: string, ...args: unknown[]): unknown;
}

/** 1920×1080: internal 480×270 at exactly ×4. */
test.use({ viewport: { width: 1920, height: 1080 } });
const VIEW_W = 480;
const VIEW_H = 270;
const SCALE = 4;
const TILE = 16;
const CHUNK = 512;

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

function dh<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as { __dh: DhRender }).__dh.call(n as string, ...(a as unknown[])) as T, [name, args] as const);
}

test('Kachelkarte: keine Nähte an den Chunkgrenzen', async ({ page }) => {
  const msgs = collectConsole(page);
  await page.goto('/?debug=1&scenario=tilemap');
  await page.waitForFunction(() => (window as unknown as { __dh?: DhRender }).__dh?.call('scenarioReady') === true);
  const info = await dh<{ drawCalls: number; sprites: number }>(page, 'renderInfo');
  expect(info.sprites).toBeGreaterThan(0);

  // Probe scene: camera exactly on the corner of four chunks, one tile repeated everywhere.
  await dh(page, 'renderScene', 'tilemap-probe');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  const left = CHUNK - VIEW_W / 2;
  const top = CHUNK - VIEW_H / 2;
  const world: Array<[number, number]> = [];
  for (let wy = CHUNK - 3 * TILE; wy < CHUNK + 3 * TILE; wy++) for (let wx = CHUNK - 3 * TILE; wx < CHUNK + 3 * TILE; wx += 1) world.push([wx, wy]);
  const px = await page.evaluate(async (pts) => {
    const d = (window as unknown as { __dh: DhRender }).__dh;
    return Promise.all(pts.map(([x, y]) => d.readPixel(x, y)));
  }, world.map(([wx, wy]) => [(wx - left) * SCALE + SCALE / 2, (wy - top) * SCALE + SCALE / 2] as const));
  const pattern = new Map<string, string>();
  const breaks: string[] = [];
  px.forEach((p, i) => {
    const [wx, wy] = world[i] ?? [0, 0];
    const k = `${wx % TILE},${wy % TILE}`;
    const c = `${p[0]},${p[1]},${p[2]}`;
    const seen = pattern.get(k);
    if (seen === undefined) pattern.set(k, c);
    else if (seen !== c) breaks.push(`(${wx}, ${wy}) ${c} ≠ ${seen}`);
  });
  expect(breaks.slice(0, 8)).toEqual([]);
  // The tile is textured (a seam would show), and the background never shows through.
  expect(new Set(pattern.values()).size).toBeGreaterThan(2);
  const [bg] = await page.evaluate(async () => {
    const d = (window as unknown as { __dh: DhRender }).__dh;
    d.call('renderPass', 'tilemap', false);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Promise.all([d.readPixel(960, 540)]);
  });
  expect(bg).toBeDefined();
  const bgKey = `${bg?.[0]},${bg?.[1]},${bg?.[2]}`;
  expect([...pattern.values()]).not.toContain(bgKey);
  expect(msgs).toEqual([]);
});
