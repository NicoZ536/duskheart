/**
 * M2-28 in the browser: the world scenes render the generated world (world worker, chunk streaming,
 * terrain meshes, y-sorted objects) – every visible chunk drawn, draw calls within §30, no GL or
 * console errors, no mesh builds in a steady frame; the arrow keys pan the debug camera and the new
 * chunks stream in without holes; the cave scene is lit by its torches alone.
 */
import { expect, test, type Page } from '@playwright/test';

interface DhRender {
  readPixel(x: number, y: number): Promise<readonly [number, number, number, number]>;
  call(name: string, ...args: unknown[]): unknown;
}

interface WorldInfo {
  readonly state: string;
  readonly error: string | null;
  readonly camera: readonly [number, number];
  readonly figure: readonly [number, number] | null;
  readonly resident: number;
  readonly loading: number;
  readonly mode: string;
  readonly terrain: { readonly drawn: number; readonly missing: number; readonly partial: number; readonly buildsLastFrame: number; readonly meshes: number; readonly maxBuildMs: number };
  readonly objects: { readonly pushed: number };
}

test.use({ viewport: { width: 1920, height: 1080 } });
/** §30 "Draw-Calls typisch ≤ 150". */
const MAX_DRAW_CALLS = 150;
const CHUNK_PX = 512;
/** Frames the right arrow is held (3 px per frame without Shift). */
const PAN_FRAMES = 40;
/** Frames until the ring around the view has its meshes (one prefetch build per frame, ≤ 16 ring chunks). */
const RING_FRAMES = 30;

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

function frames(page: Page, n: number): Promise<void> {
  return page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const step = (): void => {
          if (--left <= 0) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    n,
  );
}

async function openWorld(page: Page, scenario: string): Promise<void> {
  await page.goto(`/?debug=1&scenario=${scenario}`);
  await page.waitForFunction(() => (window as unknown as { __dh?: DhRender }).__dh?.call('scenarioReady') === true, undefined, { timeout: 90_000 });
}

test('Grünhain bei Tag: generierte Welt im Worker, alle sichtbaren Chunks gezeichnet, Draw-Calls im Budget', async ({ page }) => {
  const msgs = collectConsole(page);
  await openWorld(page, 'gruenhain-tag');
  const info = await dh<WorldInfo>(page, 'worldInfo');
  expect(info.state).toBe('bereit');
  expect(info.mode).toBe('worker');
  expect(info.terrain.missing).toBe(0);
  expect(info.terrain.partial).toBe(0);
  expect(info.terrain.drawn).toBeGreaterThanOrEqual(1);
  expect(info.objects.pushed).toBeGreaterThan(20);
  expect(info.figure).not.toBeNull();
  const render = await dh<{ drawCalls: number; sprites: number }>(page, 'renderInfo');
  expect(render.drawCalls).toBeLessThanOrEqual(MAX_DRAW_CALLS);
  expect(render.sprites).toBeGreaterThan(20);
  // Once streaming and the ring prefetch are done, a steady frame builds no mesh.
  await page.waitForFunction(() => ((window as unknown as { __dh: DhRender }).__dh.call('worldInfo') as WorldInfo).loading === 0, undefined, { timeout: 30_000 });
  await frames(page, RING_FRAMES);
  expect((await dh<WorldInfo>(page, 'worldInfo')).terrain.buildsLastFrame).toBe(0);
  expect(await dh<string[]>(page, 'glErrors')).toEqual([]);
  expect(msgs).toEqual([]);
});

test('Debug-Kamera: Pfeiltasten verschieben die Kamera, neue Chunks strömen ohne Löcher nach', async ({ page }) => {
  const msgs = collectConsole(page);
  await openWorld(page, 'glutsand-tag');
  const before = await dh<WorldInfo>(page, 'worldInfo');
  await page.keyboard.down('ArrowRight');
  await frames(page, PAN_FRAMES);
  await page.keyboard.up('ArrowRight');
  const moved = await dh<WorldInfo>(page, 'worldInfo');
  expect(moved.camera[0]).toBeGreaterThan(before.camera[0]);
  expect(moved.camera[1]).toBe(before.camera[1]);
  // Jump two chunks south: the chunks stream in and every visible chunk gets its mesh.
  await dh(page, 'worldCamera', moved.camera[0], moved.camera[1] + 2 * CHUNK_PX);
  await page.waitForFunction(
    () => {
      const i = (window as unknown as { __dh: DhRender }).__dh.call('worldInfo') as WorldInfo;
      return i.terrain.missing === 0 && i.terrain.partial === 0 && i.loading === 0;
    },
    undefined,
    { timeout: 30_000 },
  );
  await frames(page, 3);
  const after = await dh<WorldInfo>(page, 'worldInfo');
  expect(after.terrain.missing).toBe(0);
  expect(after.terrain.partial).toBe(0);
  expect(after.terrain.drawn).toBeGreaterThanOrEqual(1);
  expect((await dh<{ drawCalls: number }>(page, 'renderInfo')).drawCalls).toBeLessThanOrEqual(MAX_DRAW_CALLS);
  expect(await dh<string[]>(page, 'glErrors')).toEqual([]);
  expect(msgs).toEqual([]);
});

test('Ebene −1 roh: Umgebungslicht ≈ 0, Fackeln erhellen den Pilzhain', async ({ page }) => {
  const msgs = collectConsole(page);
  await openWorld(page, 'ebene-1-roh');
  const info = await dh<WorldInfo>(page, 'worldInfo');
  expect(info.terrain.missing).toBe(0);
  const render = await dh<{ lights: number; lightsDrawn: number }>(page, 'renderInfo');
  expect(render.lights).toBeGreaterThanOrEqual(3);
  expect(render.lightsDrawn).toBe(render.lights);
  // The screen corners lie outside every torch pool: almost black. The centre (the figure beside a torch) is lit.
  const corner = await page.evaluate(() => (window as unknown as { __dh: DhRender }).__dh.readPixel(8, 1072));
  const centre = await page.evaluate(() => (window as unknown as { __dh: DhRender }).__dh.readPixel(1000, 560));
  const luma = (p: readonly number[]): number => (p[0] ?? 0) + (p[1] ?? 0) + (p[2] ?? 0);
  expect(luma(corner)).toBeLessThan(60);
  expect(luma(centre)).toBeGreaterThan(luma(corner) + 60);
  expect(await dh<string[]>(page, 'glErrors')).toEqual([]);
  expect(msgs).toEqual([]);
});
