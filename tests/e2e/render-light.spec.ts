/**
 * M1-18/M1-19 in the browser (WebGL2): the light buffer equals the canonical light model per pixel
 * (float targets and forced RGBA8 fallback), normal mapping lights the side of a relief that faces the
 * light, every pass of the lit pipeline can be switched off on its own with a complete image and back
 * on to the identical frame, tonemapping only touches overexposed pixels – without any console or GL
 * message.
 */
import { expect, test, type Page } from '@playwright/test';
import { lightLevelAt } from '../../src/engine/lightFalloff';
import { LIGHT_PROBE_CAMERA, LIGHT_PROBE_LIGHTS } from '../../src/render/light/probeLayout';

type Rgba = readonly [number, number, number, number];

interface DhRender {
  readPixel(x: number, y: number): Promise<Rgba>;
  call(name: string, ...args: unknown[]): unknown;
}

/** 1920×1080: internal 480×270 at exactly ×4 (no linear step). */
test.use({ viewport: { width: 1920, height: 1080 } });
const VIEW_W = 480;
const VIEW_H = 270;
const SCALE = 4;

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

async function openScenario(page: Page, name: string, query = ''): Promise<void> {
  await page.goto(`/?debug=1&scenario=${name}${query}`);
  await page.waitForFunction(() => (window as unknown as { __dh?: DhRender }).__dh?.call('scenarioReady') === true);
}

function dh<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as { __dh: DhRender }).__dh.call(n as string, ...(a as unknown[])) as T, [name, args] as const);
}

async function frames(page: Page, n = 2): Promise<void> {
  for (let i = 0; i < n; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

function probe(page: Page, points: ReadonlyArray<readonly [number, number]>): Promise<Rgba[]> {
  return page.evaluate(async (pts) => {
    const d = (window as unknown as { __dh: DhRender }).__dh;
    return Promise.all(pts.map(([x, y]) => d.readPixel(x, y)));
  }, points);
}

/** Canvas pixel showing world pixel (wx, wy) for a camera centred on whole pixels (cx, cy). */
function canvasOf(wx: number, wy: number, cx: number, cy: number): [number, number] {
  return [(wx - (cx - VIEW_W / 2)) * SCALE + SCALE / 2, (wy - (cy - VIEW_H / 2)) * SCALE + SCALE / 2];
}

test('Lichtpuffer = kanonische Dämpfung und Kegel (Float und erzwungenes RGBA8)', async ({ page }) => {
  const msgs = collectConsole(page);
  const [camX, camY] = LIGHT_PROBE_CAMERA;
  const world: Array<[number, number]> = [];
  for (const l of LIGHT_PROBE_LIGHTS) {
    for (let dy = -l.radius; dy <= l.radius; dy += 12) {
      for (let dx = -l.radius; dx <= l.radius; dx += 12) {
        const wx = Math.round(l.x + dx);
        const wy = Math.round(l.y + dy);
        if (Math.abs(wx - camX) < VIEW_W / 2 && Math.abs(wy - camY) < VIEW_H / 2) world.push([wx, wy]);
      }
    }
  }
  const expected = world.map(([wx, wy]) => {
    let sum = 0;
    for (const l of LIGHT_PROBE_LIGHTS) sum += lightLevelAt(l, wx + 0.5, wy + 0.5, 0, 0);
    return Math.round(Math.min(1, sum) * 255);
  });
  for (const [query, tolerance] of [
    ['', 3],
    ['&forceRgba8=1', 5],
  ] as const) {
    await openScenario(page, 'testszene', query);
    await dh(page, 'renderScene', 'licht-probe');
    await dh(page, 'renderDebug', 'light');
    await frames(page, 3);
    const px = await probe(
      page,
      world.map(([wx, wy]) => canvasOf(wx, wy, camX, camY)),
    );
    const off = px.map((p, i) => ({ at: world[i], got: p[0], want: expected[i] ?? 0 })).filter((e) => Math.abs(e.got - e.want) > tolerance);
    expect(off.slice(0, 10), `query ${query}`).toEqual([]);
    // White light: all channels equal.
    expect(px.every((p) => p[0] === p[1] && p[1] === p[2])).toBe(true);
    // The spot light is dark behind its cone although it is within the radius.
    const spot = LIGHT_PROBE_LIGHTS[1];
    if (spot) {
      const [behind] = await probe(page, [canvasOf(spot.x - 40, spot.y - 40, camX, camY)]);
      expect(behind?.[0]).toBe(0);
    }
  }
  expect(msgs).toEqual([]);
});

/** Scanline through the big rock of `normalmap-licht` (world y) and the search range (world x). */
const ROCK_ROW = 20;
const ROCK_SEARCH: readonly [number, number] = [-60, 0];

test('Normal-Mapping: die Lichtseite des Felsens ist heller als flacher Boden, die Schattenseite dunkler', async ({ page }) => {
  const msgs = collectConsole(page);
  await openScenario(page, 'normalmap');
  const xs = Array.from({ length: ROCK_SEARCH[1] - ROCK_SEARCH[0] }, (_, i) => ROCK_SEARCH[0] + i);
  const row = xs.map((x) => canvasOf(x, ROCK_ROW, 0, 0));
  await dh(page, 'renderDebug', 'normal');
  await frames(page);
  const normals = await probe(page, row);
  const tilted = xs.filter((_, i) => {
    const n = normals[i];
    return n !== undefined && (Math.abs(n[0] - 128) > 8 || Math.abs(n[1] - 128) > 8);
  });
  const left = tilted[0];
  const right = tilted[tilted.length - 1];
  expect(left).toBeDefined();
  expect(right).toBeDefined();
  if (left === undefined || right === undefined) return;
  // The rock's outer pixels: normals point outwards (red channel = +x).
  const [nl] = await probe(page, [canvasOf(left, ROCK_ROW, 0, 0)]);
  const [nr] = await probe(page, [canvasOf(right, ROCK_ROW, 0, 0)]);
  expect(nl?.[0]).toBeLessThan(128);
  expect(nr?.[0]).toBeGreaterThan(128);
  await dh(page, 'renderDebug', 'light');
  await frames(page);
  const lum = (p: Rgba | undefined): number => (p ? p[0] + p[1] + p[2] : 0);
  // The wandering light stands left of the rock: its left edge faces it, the right edge faces away.
  const [rockLeft, groundLeft, rockRight, groundRight] = await probe(page, [
    canvasOf(left, ROCK_ROW, 0, 0),
    canvasOf(left - 2, ROCK_ROW, 0, 0),
    canvasOf(right, ROCK_ROW, 0, 0),
    canvasOf(right + 2, ROCK_ROW, 0, 0),
  ]);
  expect(lum(rockLeft)).toBeGreaterThan(lum(groundLeft));
  expect(lum(rockRight)).toBeLessThan(lum(groundRight));
  expect(msgs).toEqual([]);
});

function grid(step: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let y = 2; y < 1080; y += step) for (let x = 2; x < 1920; x += step) pts.push([x, y]);
  return pts;
}

const key = (p: Rgba): string => `${p[0]},${p[1]},${p[2]}`;

test('Passes einzeln abschaltbar: Bild bleibt vollständig, danach wieder identisch', async ({ page }) => {
  const msgs = collectConsole(page);
  await openScenario(page, 'normalmap');
  const pts = grid(40);
  const shot = async (): Promise<string[]> => {
    await frames(page);
    return (await probe(page, pts)).map(key);
  };
  const base = await shot();
  const passes = await dh<Array<{ name: string; enabled: boolean }>>(page, 'renderPass');
  expect(passes.filter((p) => p.enabled).map((p) => p.name)).toEqual(expect.arrayContaining(['tilemap', 'gbuffer', 'lighting', 'composite', 'post', 'outline']));
  expect(passes.find((p) => p.name === 'unlit')?.enabled).toBe(false);
  expect(passes.find((p) => p.name === 'resolve')?.enabled).toBe(false);

  // Without the light pass the night scene shows unlit – exactly the albedo.
  await dh(page, 'renderPass', 'lighting', false);
  const unlit = await shot();
  await dh(page, 'renderDebug', 'albedo');
  const albedo = await shot();
  await dh(page, 'renderDebug', 'off');
  expect(unlit).toEqual(albedo);
  expect(unlit).not.toEqual(base);
  await dh(page, 'renderPass', 'lighting', true);
  expect(await shot()).toEqual(base);

  // Without the composition the unlit fallback draws the HDR target.
  await dh(page, 'renderPass', 'composite', false);
  expect(await shot()).toEqual(albedo);
  await dh(page, 'renderPass', 'composite', true);
  expect(await shot()).toEqual(base);

  // Without the ground pass the tile map is gone (background shows), the sprites stay.
  await dh(page, 'renderPass', 'tilemap', false);
  expect(await shot()).not.toEqual(base);
  await dh(page, 'renderPass', 'tilemap', true);
  expect(await shot()).toEqual(base);
  expect(msgs).toEqual([]);
});

test('post-grundlage: Tonemapping wirkt nur auf überbelichtete Pixel, Post abschaltbar', async ({ page }) => {
  const msgs = collectConsole(page);
  await openScenario(page, 'post-grundlage');
  const pts = grid(24);
  const shot = async (): Promise<Rgba[]> => {
    await frames(page);
    return probe(page, pts);
  };
  const tonemapped = await shot();
  await dh(page, 'renderPass', 'post', false);
  const clamped = await shot();
  const changed = tonemapped.map((p, i) => [p, clamped[i]] as const).filter(([a, b]) => b !== undefined && key(a) !== key(b));
  // Some pixels are overexposed near the blazing light …
  expect(changed.length).toBeGreaterThan(0);
  // … and only those: a clamped pixel with a channel below 255 is never touched by the tonemapping.
  for (const [, c] of changed) expect(Math.max(c?.[0] ?? 0, c?.[1] ?? 0, c?.[2] ?? 0)).toBe(255);
  await dh(page, 'renderPass', 'post', true);
  expect((await shot()).map(key)).toEqual(tonemapped.map(key));
  const info = await dh<{ lights: number; lightsDrawn: number }>(page, 'renderInfo');
  expect(info.lights).toBe(3);
  expect(info.lightsDrawn).toBe(3);
  expect(msgs).toEqual([]);
});

test('RGBA8-Fallback: die Nacht-Lichtung gleicht dem Float-Bild bis auf die Quantisierung', async ({ page }) => {
  const msgs = collectConsole(page);
  const pts = grid(16);
  await openScenario(page, 'normalmap');
  const float = await probe(page, pts);
  await openScenario(page, 'normalmap', '&forceRgba8=1');
  const info = await dh<{ floatTargets: boolean; hdrFormat: string }>(page, 'renderInfo');
  expect(info.floatTargets).toBe(false);
  expect(info.hdrFormat).toBe('RGBA8');
  const rgba8 = await probe(page, pts);
  let sum = 0;
  let far = 0;
  float.forEach((p, i) => {
    const q = rgba8[i];
    if (!q) return;
    const d = Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
    sum += d;
    // A pixel may land in the neighbouring light band; anything beyond that is an encoding error.
    if (d > 40) far++;
  });
  expect(sum / float.length).toBeLessThan(3);
  expect(far).toBe(0);
  expect(msgs).toEqual([]);
});
