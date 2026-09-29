/**
 * M1-26 in the browser (§4.1 „warme Lichtinseln in kühler, bedrohlicher Dunkelheit“, ADR-0018):
 * colour temperature of the Grünhain clearing behind the title. Pixels that are green grass in the
 * albedo read warm in the torch core (red above green – the plain RGB product showed lime) and cool
 * in the darkness (blue above red and green – it showed green-black). Full daylight stays exactly the
 * palette: the final image of the daylight tile map equals its albedo buffer – measured without the occluder pass,
 * whose SDF ambient occlusion (§6.1 pass 5 "Umgebungslicht × SDF-AO", M5-04) darkens the daylight at the feet of
 * objects by design; with it, the pixels it changes are only darker, never tinted (ADR M5-Integration).
 */
import { expect, test, type Page } from '@playwright/test';
import { renderedFrames } from './frames';

type Rgba = readonly [number, number, number, number];

interface DhRender {
  readPixel(x: number, y: number): Promise<Rgba>;
  call(name: string, ...args: unknown[]): unknown;
}

/** 1920×1080: internal 480×270 at exactly ×4; the Grünhain camera rests on world (0, 0). */
test.use({ viewport: { width: 1920, height: 1080 } });
const VIEW_W = 480;
const VIEW_H = 270;
const SCALE = 4;

/** The near torch of the clearing (src/render/scenes/gruenhain.ts) and grass around it, north of the road. */
const TORCH: readonly [number, number] = [-44, 52];
const CORE_PATCH = { x: [-72, -56], y: [24, 44], step: 4 } as const;
/** Meadow far from both torches, below the title card (no sprite stands there). */
const DARK_PATCH = { x: [-60, 60], y: [-124, -92], step: 8 } as const;
/** Least number of grass pixels each patch must contain for the check to mean something. */
const MIN_GRASS = 12;

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

function frames(page: Page, n = 2): Promise<void> {
  // Frames the renderer drew (tests/e2e/frames.ts), not animation frames of the page.
  return renderedFrames(page, n);
}

function probe(page: Page, points: ReadonlyArray<readonly [number, number]>): Promise<Rgba[]> {
  return page.evaluate(async (pts) => {
    const d = (window as unknown as { __dh: DhRender }).__dh;
    return Promise.all(pts.map(([x, y]) => d.readPixel(x, y)));
  }, points);
}

/** Canvas pixel (centre of the ×4 block) showing world pixel (wx, wy) under a camera on world (0, 0). */
function canvasOf(wx: number, wy: number): [number, number] {
  return [(wx + VIEW_W / 2) * SCALE + SCALE / 2, (wy + VIEW_H / 2) * SCALE + SCALE / 2];
}

function patch(p: { readonly x: readonly [number, number]; readonly y: readonly [number, number]; readonly step: number }): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = p.y[0]; y <= p.y[1]; y += p.step) for (let x = p.x[0]; x <= p.x[1]; x += p.step) out.push([x, y]);
  return out;
}

/** Final colour of the patch pixels whose albedo is green grass (green above red and blue). */
async function litGrass(page: Page, world: ReadonlyArray<readonly [number, number]>): Promise<Rgba[]> {
  const points = world.map(([x, y]) => canvasOf(x, y));
  await dh(page, 'renderDebug', 'albedo');
  await frames(page);
  const albedo = await probe(page, points);
  await dh(page, 'renderDebug', 'off');
  await frames(page);
  const final = await probe(page, points);
  return final.filter((_, i) => {
    const a = albedo[i];
    return a !== undefined && a[1] > a[0] && a[1] > a[2];
  });
}

test('gruenhain: Fackellicht auf Gras liest warm (Rot > Grün), die Dunkelheit kühl (Blau > Rot)', async ({ page }) => {
  const msgs = collectConsole(page);
  await openScenario(page, 'gruenhain');
  const core = patch(CORE_PATCH);
  // The core patch lies within the torch's hot core (its radius is 112 px).
  for (const [x, y] of core) expect(Math.hypot(x - TORCH[0], y - TORCH[1])).toBeLessThan(40);
  const warm = await litGrass(page, core);
  expect(warm.length).toBeGreaterThanOrEqual(MIN_GRASS);
  for (const p of warm) expect(p[0], `Kern ${p.join(',')}`).toBeGreaterThan(p[1]);
  const cool = await litGrass(page, patch(DARK_PATCH));
  expect(cool.length).toBeGreaterThanOrEqual(MIN_GRASS);
  for (const p of cool) {
    expect(p[2], `Dunkel ${p.join(',')}`).toBeGreaterThan(p[0]);
    expect(p[2], `Dunkel ${p.join(',')}`).toBeGreaterThan(p[1]);
  }
  expect(msgs).toEqual([]);
});

/**
 * Whether `lit` is `albedo` only darkened: no channel brighter, and the colour's make-up kept – each channel's share of
 * the sum within `SHARE_TOLERANCE` of the albedo's (8-bit rounding of dark values moves a share by a few hundredths).
 */
const SHARE_TOLERANCE = 0.04;
function onlyDarker(lit: Rgba, albedo: Rgba): boolean {
  const sumLit = lit[0] + lit[1] + lit[2];
  const sumAlbedo = albedo[0] + albedo[1] + albedo[2];
  if (sumLit > sumAlbedo || [0, 1, 2].some((c) => (lit[c] as number) > (albedo[c] as number))) return false;
  if (sumLit === 0 || sumAlbedo === 0) return true;
  return [0, 1, 2].every((c) => Math.abs((lit[c] as number) / sumLit - (albedo[c] as number) / sumAlbedo) <= SHARE_TOLERANCE);
}

test('Tageslicht bleibt palettentreu: das Endbild der Kachelkarte gleicht ihrem Albedo, SDF-AO dunkelt nur ab', async ({ page }) => {
  const msgs = collectConsole(page);
  await openScenario(page, 'tilemap');
  const pts: Array<[number, number]> = [];
  for (let y = 2; y < 1080; y += 36) for (let x = 2; x < 1920; x += 36) pts.push([x, y]);
  const rgb = (p: Rgba): string => p.slice(0, 3).join(',');
  await frames(page);
  const occluded = await probe(page, pts);
  // The M1 claim on its own: without the occluder pass (no SDF ambient occlusion) the composition and the tone
  // mapping of full daylight give back the albedo exactly.
  await dh(page, 'renderPass', 'occluder', false);
  await frames(page);
  const final = await probe(page, pts);
  await dh(page, 'renderDebug', 'albedo');
  await frames(page);
  const albedo = await probe(page, pts);
  await dh(page, 'renderDebug', 'off');
  await dh(page, 'renderPass', 'occluder', true);
  expect(final.map(rgb)).toEqual(albedo.map(rgb));
  // With the occluder pass (M5-04): the samples the ambient occlusion reaches are only darker – the palette colour
  // keeps its hue – and they are few (the feet of objects, not the open ground).
  const changed = occluded.map((p, i) => ({ at: pts[i], lit: p, albedo: albedo[i] as Rgba })).filter((e) => rgb(e.lit) !== rgb(e.albedo));
  expect(changed.filter((e) => !onlyDarker(e.lit, e.albedo))).toEqual([]);
  expect(changed.length).toBeLessThan(pts.length / 10);
  expect(msgs).toEqual([]);
});
