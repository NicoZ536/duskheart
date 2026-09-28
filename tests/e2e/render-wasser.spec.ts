/**
 * M5-07 … M5-09: der Wasser-Pass auf der Spielansicht (Szenario `wasser-ufer`, Grünhain-See im Sonnenschein) –
 * er zeichnet das Wasser mit dem Wasser-Distanzfeld des Occluder-Passes, ohne Shader- oder GL-Fehler; nach einem
 * Kontextverlust baut er Felder und Programme neu auf und zeichnet weiter; auf dem RGBA8-Fallback (kein
 * Float-Rendertarget) ebenso, das Wasser bleibt blau.
 */
import { expect, test, type Page } from '@playwright/test';

type Rgba = readonly [number, number, number, number];

interface DhRender {
  readPixel(x: number, y: number): Promise<Rgba>;
  call(name: string, ...args: unknown[]): unknown;
}

interface RenderInfo {
  frames: number;
  contextLost: boolean;
  contextRestores: number;
  hdrFormat: string;
  floatTargets: boolean;
  shaderErrors: unknown[];
}

interface WaterInfo {
  pass: { drawn: boolean; steps: number; impulses: number; shoreField: boolean; prepMs: number };
  settings: { refraction: boolean; reflection: boolean; waves: boolean; caustics: boolean; motionScale: number };
  scene: { immersed: number; impulses: number; raindrops: number; fish: number; prepMs: number } | null;
}

/** The scenario runs the session's world under SwiftShader: minutes on a loaded machine. */
const SCENARIO_TIMEOUT = 600_000;
/** 1920×1080: internal 480×270 at ×4. Open water of the lake (upper right) and the grass of the bank (lower left). */
const WATER_PX: readonly [number, number] = [1700, 220];
const GRASS_PX: readonly [number, number] = [300, 700];

test.use({ viewport: { width: 1920, height: 1080 } });
test.setTimeout(SCENARIO_TIMEOUT + 120_000);

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

function pixel(page: Page, [x, y]: readonly [number, number]): Promise<Rgba> {
  return page.evaluate(([px, py]) => (window as unknown as { __dh: DhRender }).__dh.readPixel(px as number, py as number), [x, y] as const);
}

async function openShore(page: Page, query: string): Promise<void> {
  await page.goto(`/?debug=1&scenario=wasser-ufer${query}`);
  await page.waitForFunction(() => (window as unknown as { __dh?: DhRender }).__dh?.call('scenarioReady') === true, undefined, { timeout: SCENARIO_TIMEOUT, polling: 500 });
}

/** Waits until `n` more frames are drawn. */
async function frames(page: Page, n: number): Promise<void> {
  const from = (await dh<RenderInfo>(page, 'renderInfo')).frames;
  await page.waitForFunction((f) => ((window as unknown as { __dh: DhRender }).__dh.call('renderInfo') as RenderInfo).frames > f, from + n);
}

function loseContext(page: Page, lose: boolean): Promise<void> {
  return page.evaluate((l) => {
    const w = window as unknown as { __dhLoseContext?: WEBGL_lose_context | null };
    if (w.__dhLoseContext === undefined) {
      const canvas = document.getElementById('dh-canvas') as HTMLCanvasElement;
      w.__dhLoseContext = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context') ?? null;
    }
    const ext = w.__dhLoseContext;
    if (!ext) throw new Error('WEBGL_lose_context fehlt');
    if (l) ext.loseContext();
    else ext.restoreContext();
  }, lose);
}

test('Wasser am Ufer: Distanzfeld, keine Fehler, nach Kontextverlust wieder gezeichnet', async ({ page }) => {
  const msgs = collectConsole(page);
  await openShore(page, '');
  const info = await dh<RenderInfo>(page, 'renderInfo');
  expect(info.shaderErrors).toEqual([]);
  const water = await dh<WaterInfo>(page, 'waterInfo');
  expect(water.pass.drawn).toBe(true);
  expect(water.pass.shoreField).toBe(true);
  expect(water.pass.prepMs).toBeGreaterThanOrEqual(0);
  expect(water.settings).toMatchObject({ refraction: true, reflection: true, waves: true, caustics: true });
  expect(water.scene).not.toBeNull();
  expect(await dh<unknown[]>(page, 'glErrors')).toEqual([]);
  const [r, g, b] = await pixel(page, WATER_PX);
  expect(b).toBeGreaterThan(r + 20);
  expect(b).toBeGreaterThan(g);
  const grass = await pixel(page, GRASS_PX);
  expect(grass[1]).toBeGreaterThan(grass[2]);

  await loseContext(page, true);
  await page.waitForFunction(() => ((window as unknown as { __dh: DhRender }).__dh.call('renderInfo') as RenderInfo).contextLost);
  await loseContext(page, false);
  await page.waitForFunction(() => {
    const i = (window as unknown as { __dh: DhRender }).__dh.call('renderInfo') as RenderInfo;
    return !i.contextLost && i.contextRestores === 1;
  });
  await frames(page, 3);
  const after = await dh<WaterInfo>(page, 'waterInfo');
  expect(after.pass.drawn).toBe(true);
  expect(after.pass.shoreField).toBe(true);
  expect((await dh<RenderInfo>(page, 'renderInfo')).shaderErrors).toEqual([]);
  expect(await dh<unknown[]>(page, 'glErrors')).toEqual([]);
  const [r2, g2, b2] = await pixel(page, WATER_PX);
  expect(b2).toBeGreaterThan(r2 + 20);
  expect(b2).toBeGreaterThan(g2);
  // Chromium reports the deliberate loss as a WebGL warning; nothing else may appear.
  for (const m of msgs) expect(m).toMatch(/WebGL.*(CONTEXT_LOST|context lost)/i);
});

test('Wasser am Ufer auf dem RGBA8-Fallback', async ({ page }) => {
  const msgs = collectConsole(page);
  await openShore(page, '&forceRgba8=1');
  const info = await dh<RenderInfo>(page, 'renderInfo');
  expect(info.floatTargets).toBe(false);
  expect(info.hdrFormat).toBe('RGBA8');
  expect(info.shaderErrors).toEqual([]);
  const water = await dh<WaterInfo>(page, 'waterInfo');
  expect(water.pass.drawn).toBe(true);
  expect(water.pass.shoreField).toBe(true);
  expect(await dh<unknown[]>(page, 'glErrors')).toEqual([]);
  const [r, g, b] = await pixel(page, WATER_PX);
  expect(b).toBeGreaterThan(r + 20);
  expect(b).toBeGreaterThan(g);
  expect(msgs).toEqual([]);
});
