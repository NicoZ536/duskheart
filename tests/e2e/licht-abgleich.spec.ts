/**
 * M3-21/M3-22 in the browser: the gameplay light map matches the light the renderer draws (§12.1 "Ein
 * Debug-Overlay vergleicht Gameplay-Licht mit gerendertem Licht (müssen übereinstimmen)").
 *
 * The screenshot scenario `licht-abgleich` sets up a night camp on the start beach – the player with a
 * burning torch, a lit camp fire beside them, a torch on its stake – and shows the render debugger's view
 * `lightmap-quellen`: R = gameplay light of the sources / 2, G = the renderer's light / 2, B = 0 agree
 * (≤ 0,05), 255 differ, 128 not comparable (sprites, tilted surfaces). The test reads a grid of internal
 * pixels (1920×1080 = internal 480×270 at ×4) and demands at least 50 comparable ground pixels in the lit
 * camp, none of them differing. By day the view `lightmap` compares the whole light – the ambient of
 * §12.1 plus the sources – the same way. The game view reports the lights it handed to the renderer.
 */
import { expect, test, type Page } from '@playwright/test';

type Rgba = readonly [number, number, number, number];

interface Dh {
  ready: boolean;
  state(): { sim: { tick: number; events: Record<string, number> } };
  command(cmd: unknown): unknown;
  freezeTime(on: boolean): void;
  readPixel(x: number, y: number): Promise<Rgba>;
  call(name: string, ...args: unknown[]): unknown;
}

interface WorldInfo {
  lights: { lights: number; sprites: number };
}

/** 1920×1080: internal 480×270 at exactly ×4 (no linear step). */
test.use({ viewport: { width: 1920, height: 1080 } });
const VIEW_W = 480;
const VIEW_H = 270;
const SCALE = 4;
/** Every n-th internal pixel is sampled (both axes). */
const STEP = 6;
/** Encoding of the view (src/render/debug/lightmapPass.ts): value / 2 per 8-bit channel. */
const RANGE = 2;
/** Agreement of the acceptance: ≤ 0,05 light level – in channel steps, plus one step of rounding per channel. */
const TOLERANCE_STEPS = (0.05 / RANGE) * 255 + 2;
const MIN_SAMPLES = 50;

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

function dh<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as { __dh: Dh }).__dh.call(n as string, ...(a as unknown[])) as T, [name, args] as const);
}

async function frames(page: Page, n = 3): Promise<void> {
  for (let i = 0; i < n; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

interface Sample {
  readonly x: number;
  readonly y: number;
  readonly gameplay: number;
  readonly rendered: number;
  readonly mark: number;
}

/** Reads the view on a grid of internal pixels. */
async function sampleView(page: Page): Promise<Sample[]> {
  const points: Array<[number, number]> = [];
  for (let y = STEP / 2; y < VIEW_H; y += STEP) for (let x = STEP / 2; x < VIEW_W; x += STEP) points.push([x, y]);
  const px = await page.evaluate(async (pts) => {
    const d = (window as unknown as { __dh: Dh }).__dh;
    return Promise.all(pts.map(([x, y]) => d.readPixel(x, y)));
  }, points.map(([x, y]) => [x * SCALE + SCALE / 2, y * SCALE + SCALE / 2] as [number, number]));
  return points.map(([x, y], i) => {
    const p = px[i] ?? [0, 0, 0, 0];
    return { x, y, gameplay: p[0], rendered: p[1], mark: p[2] };
  });
}

function summarise(samples: readonly Sample[]): { compared: Sample[]; lit: Sample[]; differing: Sample[]; worst: number } {
  const compared = samples.filter((s) => s.mark < 64 || s.mark > 192);
  const lit = compared.filter((s) => s.gameplay > 0);
  const differing = compared.filter((s) => s.mark > 192 || Math.abs(s.gameplay - s.rendered) > TOLERANCE_STEPS);
  const worst = compared.reduce((m, s) => Math.max(m, Math.abs(s.gameplay - s.rendered)), 0);
  return { compared, lit, differing, worst };
}

test('Nachtlager: Gameplay-Licht der Lichtquellen = gerendertes Licht (≥ 50 Stichproben, ≤ 0,05)', async ({ page }) => {
  test.setTimeout(180_000);
  const msgs = collectConsole(page);
  await page.goto('/?debug=1&scenario=licht-abgleich');
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.call('scenarioReady') === true, undefined, { timeout: 120_000 });
  await frames(page);
  expect(((await dh<{ current: string }>(page, 'renderDebug')) as { current: string }).current).toBe('lightmap-quellen');
  // The camp stands: the carried torch, the camp fire and the stake torch are the renderer's lights.
  const info = await dh<WorldInfo>(page, 'worldInfo');
  expect(info.lights.lights).toBe(3);
  expect(info.lights.sprites).toBe(2);
  const s = summarise(await sampleView(page));
  test.info().annotations.push({ type: 'abweichung', description: `${s.lit.length} beleuchtete Stichproben, größte Abweichung ${((s.worst / 255) * RANGE).toFixed(3)}` });
  expect(s.lit.length, `worst ${s.worst}`).toBeGreaterThanOrEqual(MIN_SAMPLES);
  expect(s.differing.slice(0, 10)).toEqual([]);
  // Around the fire the light is glaring (> 0,9 ⇒ > 115 in the encoding), in the corners of the night nothing.
  expect(Math.max(...s.lit.map((x) => x.gameplay))).toBeGreaterThan((0.9 / RANGE) * 255);
  const corners = s.compared.filter((x) => (x.x < 30 || x.x > VIEW_W - 30) && (x.y < 30 || x.y > VIEW_H - 30));
  expect(corners.length).toBeGreaterThan(0);
  expect(corners.every((x) => x.gameplay === 0 && x.rendered === 0)).toBe(true);
  await page.screenshot({ path: 'shots/latest/licht-abgleich-e2e.png' });
  expect(await dh<string[]>(page, 'glErrors')).toEqual([]);
  expect(msgs).toEqual([]);
});

test('bei Tag: ganzes Licht (Umgebungslicht §12.1 + Lichtquellen) = gerendertes Licht', async ({ page }) => {
  test.setTimeout(180_000);
  const msgs = collectConsole(page);
  await page.goto('/?debug=1&scenario=licht-abgleich');
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.call('scenarioReady') === true, undefined, { timeout: 120_000 });
  const before = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.tick);
  await page.evaluate(() => {
    const d = (window as unknown as { __dh: Dh }).__dh;
    d.command({ type: 'setTime', hour: 12, minute: 0 });
    d.freezeTime(false);
  });
  await page.waitForFunction((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.tick > t + 2, before, { timeout: 30_000 });
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.freezeTime(true));
  await dh(page, 'renderDebug', 'lightmap');
  await frames(page, 4);
  const s = summarise(await sampleView(page));
  test.info().annotations.push({ type: 'abweichung', description: `${s.compared.length} Stichproben, größte Abweichung ${((s.worst / 255) * RANGE).toFixed(3)}` });
  expect(s.compared.length).toBeGreaterThanOrEqual(MIN_SAMPLES);
  // Daylight: the ambient alone is 1,0 at most (weather), ≥ 0,6 – every comparable pixel is lit.
  expect(s.compared.every((x) => x.gameplay >= (0.6 / RANGE) * 255 - 1)).toBe(true);
  expect(s.differing.slice(0, 10)).toEqual([]);
  expect(await dh<string[]>(page, 'glErrors')).toEqual([]);
  expect(msgs).toEqual([]);
});
