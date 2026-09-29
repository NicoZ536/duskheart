/**
 * M5-28: Lichtkarten-Abgleich nach dem finalen Licht-Pass (MASTERPROMPT §12.1 „Ein Debug-Overlay vergleicht
 * Gameplay-Licht mit gerendertem Licht (müssen übereinstimmen)“). Seit M5 wirft das Punktlicht Schatten: Wände,
 * geschlossene Türen und Klippen sperren es wie der Tile-Raycast der Lichtkarte, Stämme, Felsen und Möbel werfen
 * Schatten nur im Bild (die Karte ignoriert sie, §12.1 – die Ansicht rechnet ihr genommenes Licht zurück), Feuer in
 * Stationen leuchten aus ihrem Körper (M5-35).
 *
 * Die Ansicht `lightmap-quellen` des Render-Debuggers (src/render/debug/lightmapPass.ts): R = Gameplay-Licht der
 * Quellen / 2, G = gerendertes Licht / 2, B = 0 übereinstimmend (≤ 0,05), 255 abweichend, 128 nicht vergleichbar
 * (Sprites, geneigte Flächen, Halbschatten von Wänden und Klippen und der Boden bis eine Kachel neben ihnen – dort löst
 * die Karte die Verdeckung je Kachel auf, der Renderer je Pixel). Gelesen wird ein Raster interner Pixel (1920×1080 =
 * intern 480×270 bei ×4); jede Szene braucht mindestens 50 vergleichbare beleuchtete Stichproben, keine abweichende.
 *
 * - Nachtlager am Startstrand (Szenario `licht-abgleich`): Fackel in der Hand, Lagerfeuer, Fackel am Pfahl zwischen
 *   Bäumen und Büschen.
 * - Blockhütte bei Nacht (Szenario `basis-innen`): Kamin, Harzlampe, Laterne hinter Wänden – kein Licht außerhalb der
 *   geschlossenen Wände (M5-34), im Raum stimmen Karte und Bild überein. Die erste Kachel vor der West- und der Ostwand
 *   bleibt dunkel (auch wo der Abgleich nicht vergleicht, M5-Review Minor 9); und steht die Laterne der Hütte 60 px
 *   rechts neben dem Bild, ihre Westwand jenseits des Occluder-Rahmens, fällt kein Licht aus der Hütte ins Bild
 *   (M5-Review M2: der Occluder-Ring kennt die Wände neben dem Bild).
 * - Stationen bei Nacht (Szenario `stationen-nacht`): Lagerfeuer, Fackeln und die befeuerten Stationen.
 */
import { expect, test, type Page } from '@playwright/test';
import { renderedFrames } from './frames';

type Rgba = readonly [number, number, number, number];

interface Dh {
  ready: boolean;
  readPixel(x: number, y: number): Promise<Rgba>;
  call(name: string, ...args: unknown[]): unknown;
  command(raw: unknown): unknown;
  freezeTime(on: boolean): void;
  state(): { sim: { tick: number } };
}

interface WorldInfo {
  readonly camera: readonly [number, number];
  readonly figure: readonly [number, number] | null;
}

test.use({ viewport: { width: 1920, height: 1080 } });
const VIEW_W = 480;
const VIEW_H = 270;
const SCALE = 4;
/** Every n-th internal pixel is sampled (both axes). */
const STEP = 5;
/** Encoding of the view: value / 2 per 8-bit channel. */
const RANGE = 2;
/** Agreement of the acceptance: ≤ 0,05 light level – in channel steps, plus one step of rounding per channel. */
const TOLERANCE_STEPS = (0.05 / RANGE) * 255 + 2;
const MIN_SAMPLES = 50;
/** Settle time of the scenarios under SwiftShader (the base clears its site and builds). */
const READY_MS = 420_000;
const TILE = 16;
/** `basis-innen` (src/debug/basisScenarios.ts): the cabin is 8 × 6 tiles, the player stands on its tile (4, 3). */
const HUT = { w: 8, h: 6, playerX: 4, playerY: 3 } as const;
/** The standing lantern of the cabin: its tile (1, 3), its light radius (5 tiles, `laterne_stehend`). */
const LANTERN = { x: 1, y: 3, radius: 5 * TILE } as const;
/** Columns of a wall's band in its tile (`WALL_BAND`, src/render/light/buildingOccluders.ts). */
const WALL_BAND_FROM = 5;
/** Margin of the occluder mask around the view (`SDF.marginPx`): walls beyond it were unknown to the light pass. */
const SDF_MARGIN = 32;

interface Sample {
  readonly x: number;
  readonly y: number;
  readonly gameplay: number;
  readonly rendered: number;
  readonly mark: number;
}

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

function frames(page: Page, n = 3): Promise<void> {
  // Frames the renderer drew (tests/e2e/frames.ts), not animation frames of the page.
  return renderedFrames(page, n);
}

/** Reads the view on a grid of internal pixels. */
async function sampleView(page: Page): Promise<Sample[]> {
  const points: Array<[number, number]> = [];
  for (let y = STEP / 2; y < VIEW_H; y += STEP) for (let x = STEP / 2; x < VIEW_W; x += STEP) points.push([Math.floor(x), Math.floor(y)]);
  const px = await page.evaluate(async (pts) => {
    const d = (window as unknown as { __dh: Dh }).__dh;
    return Promise.all(pts.map(([x, y]) => d.readPixel(x, y)));
  }, points.map(([x, y]) => [x * SCALE + SCALE / 2, y * SCALE + SCALE / 2] as [number, number]));
  return points.map(([x, y], i) => {
    const p = px[i] ?? [0, 0, 0, 0];
    return { x, y, gameplay: p[0], rendered: p[1], mark: p[2] };
  });
}

function summarise(samples: readonly Sample[]): { compared: Sample[]; lit: Sample[]; differing: Sample[]; skipped: number; worst: number } {
  const compared = samples.filter((s) => s.mark < 64 || s.mark > 192);
  const lit = compared.filter((s) => s.gameplay > 0);
  const differing = compared.filter((s) => s.mark > 192 || Math.abs(s.gameplay - s.rendered) > TOLERANCE_STEPS);
  const worst = compared.reduce((m, s) => Math.max(m, Math.abs(s.gameplay - s.rendered)), 0);
  return { compared, lit, differing, skipped: samples.length - compared.length, worst };
}

/** Opens `scenario`, switches to the light map view of the sources and compares; returns the summary. */
async function compare(page: Page, scenario: string): Promise<ReturnType<typeof summarise>> {
  await page.goto(`/?debug=1&scenario=${scenario}`);
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.call('scenarioReady') === true, undefined, { timeout: READY_MS });
  await dh(page, 'renderDebug', 'lightmap-quellen');
  await frames(page, 4);
  expect((await dh<{ current: string }>(page, 'renderDebug')).current).toBe('lightmap-quellen');
  const s = summarise(await sampleView(page));
  test.info().annotations.push({
    type: 'abweichung',
    description: `${scenario}: ${s.lit.length} beleuchtete von ${s.compared.length} vergleichbaren Stichproben (${s.skipped} nicht vergleichbar), größte Abweichung ${((s.worst / 255) * RANGE).toFixed(3)}`,
  });
  return s;
}

test('Nachtlager mit Schatten: Gameplay-Licht = gerendertes Licht (≥ 50 Stichproben, ≤ 0,05)', async ({ page }) => {
  test.setTimeout(300_000);
  const msgs = collectConsole(page);
  const s = await compare(page, 'licht-abgleich');
  expect(s.lit.length, `worst ${s.worst}`).toBeGreaterThanOrEqual(MIN_SAMPLES);
  expect(s.differing.slice(0, 10)).toEqual([]);
  // The fire's core is glaring (> 0,9), the corners of the night dark in both.
  expect(Math.max(...s.lit.map((x) => x.gameplay))).toBeGreaterThan((0.9 / RANGE) * 255);
  await page.screenshot({ path: 'shots/latest/lichtabgleich-lager.png' });
  expect(await dh<string[]>(page, 'glErrors')).toEqual([]);
  expect(msgs).toEqual([]);
});

/** Rendered light (view `lightmap-quellen`, G channel) at world points `points` of the view whose camera centre is `camera`. */
async function renderedAt(page: Page, camera: readonly [number, number], points: ReadonlyArray<readonly [number, number]>): Promise<number[]> {
  const left = camera[0] - VIEW_W / 2;
  const top = camera[1] - VIEW_H / 2;
  const css = points.map(([x, y]) => [Math.floor(x - left) * SCALE + SCALE / 2, Math.floor(y - top) * SCALE + SCALE / 2] as [number, number]);
  for (const [x, y] of css) {
    expect(x, 'Stichprobe im Bild').toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(VIEW_W * SCALE);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThan(VIEW_H * SCALE);
  }
  const px = await page.evaluate(async (pts) => {
    const d = (window as unknown as { __dh: Dh }).__dh;
    return Promise.all(pts.map(([x, y]) => d.readPixel(x, y)));
  }, css);
  return px.map((p) => p[1]);
}

test('Blockhütte bei Nacht: kein Licht außerhalb der Wände, im Raum stimmen Karte und Bild überein', async ({ page }) => {
  test.setTimeout(600_000);
  const msgs = collectConsole(page);
  const s = await compare(page, 'basis-innen');
  expect(s.lit.length, `worst ${s.worst}`).toBeGreaterThanOrEqual(MIN_SAMPLES);
  // A leak through the walls would be rendered light where the map is dark: a differing sample.
  expect(s.differing.slice(0, 10)).toEqual([]);
  const darkOutside = s.compared.filter((x) => x.gameplay === 0);
  expect(darkOutside.length).toBeGreaterThan(MIN_SAMPLES);
  expect(darkOutside.every((x) => x.rendered === 0)).toBe(true);
  await page.screenshot({ path: 'shots/latest/lichtabgleich-basis.png' });

  // The first tile outside the west and the east wall (no opening there), where the comparison does not compare (a wall
  // within a tile): no rendered light at all – every pixel of those tiles' middle rows.
  const info = await dh<WorldInfo>(page, 'worldInfo');
  const figure = info.figure;
  expect(figure).not.toBeNull();
  const ox = Math.floor((figure?.[0] ?? 0) / TILE) - HUT.playerX;
  const oy = Math.floor((figure?.[1] ?? 0) / TILE) - HUT.playerY;
  const outside: Array<[number, number]> = [];
  for (let ty = oy + 1; ty < oy + HUT.h - 1; ty++) {
    for (let px = 2; px < TILE - 1; px += 3) {
      outside.push([(ox - 1) * TILE + px, ty * TILE + TILE / 2]);
      outside.push([(ox + HUT.w) * TILE + px, ty * TILE + TILE / 2]);
    }
  }
  expect(await renderedAt(page, info.camera, outside)).toEqual(outside.map(() => 0));

  // The lantern 60 px right of the picture, the cabin's west wall beyond the occluder mask's margin: its light stays in.
  const band = ox * TILE + WALL_BAND_FROM;
  const lanternX = (ox + LANTERN.x + 0.5) * TILE;
  const lanternY = (oy + LANTERN.y + 0.5) * TILE;
  const right = lanternX - 60;
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.freezeTime(false));
  const tick = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.tick);
  await page.evaluate((c) => (window as unknown as { __dh: Dh }).__dh.command(c), { type: 'player.teleport', x: right - VIEW_W / 2, y: lanternY, layer: 0 });
  await page.waitForFunction((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.tick > t + 2, tick);
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.freezeTime(true));
  await frames(page, 6);
  const beside = await dh<WorldInfo>(page, 'worldInfo');
  const viewRight = beside.camera[0] + VIEW_W / 2;
  // The set-up this checks: the lantern beyond the picture but within its reach of it, its wall beyond the mask.
  expect(lanternX - viewRight).toBeGreaterThan(40);
  expect(lanternX - viewRight).toBeLessThan(LANTERN.radius - 8);
  expect(band).toBeGreaterThan(viewRight + SDF_MARGIN);
  const edge: Array<[number, number]> = [];
  for (let y = Math.max(beside.camera[1] - VIEW_H / 2 + 1, lanternY - LANTERN.radius); y < Math.min(beside.camera[1] + VIEW_H / 2 - 1, lanternY + LANTERN.radius); y += 4) {
    for (let x = viewRight - 24; x < viewRight - 1; x += 3) edge.push([x, y]);
  }
  expect(edge.length).toBeGreaterThan(MIN_SAMPLES);
  expect(await renderedAt(page, beside.camera, edge)).toEqual(edge.map(() => 0));
  await page.screenshot({ path: 'shots/latest/lichtabgleich-basis-daneben.png' });
  expect(await dh<string[]>(page, 'glErrors')).toEqual([]);
  expect(msgs).toEqual([]);
});

test('Stationen bei Nacht: die befeuerten Stationen leuchten in Karte und Bild gleich', async ({ page }) => {
  test.setTimeout(600_000);
  const msgs = collectConsole(page);
  const s = await compare(page, 'stationen-nacht');
  expect(s.lit.length, `worst ${s.worst}`).toBeGreaterThanOrEqual(MIN_SAMPLES);
  expect(s.differing.slice(0, 10)).toEqual([]);
  await page.screenshot({ path: 'shots/latest/lichtabgleich-stationen.png' });
  expect(await dh<string[]>(page, 'glErrors')).toEqual([]);
  expect(msgs).toEqual([]);
});
