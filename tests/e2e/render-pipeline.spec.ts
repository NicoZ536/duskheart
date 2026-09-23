/**
 * M1-11/M1-12/M1-17: Paletten-Tausch zeigt nur Palettenfarben, 5 000 animierte Sprites in höchstens vier
 * Draw-Calls, der Render-Debugger zeigt jeden G-Buffer-Anhang einzeln.
 */
import { expect, test, type Page } from '@playwright/test';
import { PALETTE_HEX, UI_HEX } from '../../src/generated/palette';
import { nearestPaletteIndex } from '../../src/render/palette/lut';
import { STRESS_SPRITES } from '../../src/render/scenes/ids';

type Rgba = readonly [number, number, number, number];

interface DhRender {
  readPixel(x: number, y: number): Promise<Rgba>;
  call(name: string, ...args: unknown[]): unknown;
}

interface RenderInfo {
  sprites: number;
  spriteDrawCalls: number;
  debugView: string;
}

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

async function openScenario(page: Page, name: string): Promise<void> {
  await page.goto(`/?debug=1&scenario=${name}`);
  await page.waitForFunction(() => (window as unknown as { __dh?: DhRender }).__dh?.call('scenarioReady') === true);
}

function dh<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as { __dh: DhRender }).__dh.call(n as string, ...(a as unknown[])) as T, [name, args] as const);
}

function probe(page: Page, points: ReadonlyArray<readonly [number, number]>): Promise<Rgba[]> {
  return page.evaluate(async (pts) => {
    const d = (window as unknown as { __dh: DhRender }).__dh;
    return Promise.all(pts.map(([x, y]) => d.readPixel(x, y)));
  }, points);
}

/** Pixel centres of a coarse grid over the 1920×1080 canvas (internal 480×270, scale 4). */
function grid(step: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let y = 2; y < 1080; y += step) for (let x = 2; x < 1920; x += step) pts.push([x, y]);
  return pts;
}

/** 1920×1080: internal 480×270 at exactly ×4 (no linear step, palette-exact pixels). */
test.use({ viewport: { width: 1920, height: 1080 } });

const hex = (p: Rgba): string => `#${[p[0], p[1], p[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

test('palette-swap: jedes Pixel ist eine Palettenfarbe, vier Palettenzeilen sichtbar', async ({ page }) => {
  const msgs = collectConsole(page);
  await openScenario(page, 'palette-swap');
  const palette = new Set(PALETTE_HEX.slice(0, 64));
  const pixels = await probe(page, grid(12));
  const foreign = pixels.map(hex).filter((c) => !palette.has(c));
  expect(foreign).toEqual([]);
  // The four crowns (summer green, autumn, winter, corruption) differ.
  const crowns = await probe(page, [
    [362, 386],
    [762, 386],
    [1162, 386],
    [1562, 386],
  ]);
  expect(new Set(crowns.map(hex)).size).toBe(4);
  expect(msgs).toEqual([]);
});

test('sprites-5000: 5 000 animierte Sprites auf der Kachelkarte in höchstens vier Draw-Calls', async ({ page }) => {
  const msgs = collectConsole(page);
  await openScenario(page, 'sprites-5000');
  const info = await dh<RenderInfo>(page, 'renderInfo');
  expect(info.sprites).toBe(STRESS_SPRITES);
  expect(info.spriteDrawCalls).toBeGreaterThan(0);
  expect(info.spriteDrawCalls).toBeLessThanOrEqual(4);
  expect(msgs).toEqual([]);
});

test('Render-Debugger: G-Buffer-Anhänge einzeln, „off“ zeigt wieder das Bild', async ({ page }) => {
  const msgs = collectConsole(page);
  await openScenario(page, 'gbuffer-albedo');
  const points = grid(96);
  const next = (): Promise<unknown> => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const shots: Record<string, string[]> = {};
  for (const view of ['albedo', 'normal', 'height', 'emissive', 'material', 'off']) {
    const res = await dh<{ current: string; available: string[] }>(page, 'renderDebug', view);
    expect(res.current).toBe(view);
    await next();
    shots[view] = (await probe(page, points)).map(hex);
  }
  // Every view shows something else; the unlit final image is the albedo plus the accent outline
  // around the interactable figure.
  const distinct = new Set(['albedo', 'normal', 'height', 'emissive', 'material'].map((v) => shots[v]?.join()));
  expect(distinct.size).toBe(5);
  const accent = PALETTE_HEX[nearestPaletteIndex(PALETTE_HEX, UI_HEX.akzent) - 1];
  const differing = (shots['off'] ?? []).filter((c, i) => c !== shots['albedo']?.[i]);
  expect(differing.every((c) => c === accent)).toBe(true);
  // Flat ground has the normal (0, 0, 1) and no emission.
  expect(shots['normal']?.[0]).toBe('#8080ff');
  expect(shots['emissive']?.[0]).toBe('#000000');
  await expect(page.evaluate(() => (window as unknown as { __dh: DhRender }).__dh.call('renderDebug', 'gibtsnicht'))).rejects.toThrow(/unbekannter Puffer/);
  expect(msgs).toEqual([]);
});
