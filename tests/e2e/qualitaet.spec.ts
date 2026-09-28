/**
 * M5-25: die Qualitätsstufen sind zur Laufzeit umschaltbar, ohne Neuladen. Auf der Spielansicht hinter dem Titel
 * (Startstrand mit See, Zeit angehalten: jedes Bild gleich) wechselt `__dh.call('quality', stufe)` die Stufe wie der
 * Spieler – gespeichert, mit ihrer Voreinstellung – und schon das nächste Bild zeigt sie: das Wasser vereinfacht auf
 * „Niedrig“, voll auf „Hoch“; zurück auf „Hoch“ ist das Bild wieder dasselbe. Jede Stufe rendert ohne GL- und
 * Konsolenfehler; jede Stufe erreicht die Stränge (Wasser, Licht, Partikel) auf der Seite.
 */
import { expect, test, type Page } from '@playwright/test';

type Rgba = readonly [number, number, number, number];

interface DhApi {
  readonly ready: boolean;
  readPixel(x: number, y: number): Promise<Rgba>;
  call(name: string, ...args: unknown[]): unknown;
  freezeTime(on: boolean): void;
  state(): { settings: { graphics: Record<string, unknown> }; sim: { world: { ready: boolean } } };
}

interface QualityState {
  level: string;
  source: string;
  settingsLevel: string;
  strands: { light: { maxLights: number; shadows: string }; water: { reflection: boolean; refraction: boolean }; particles: { weatherShare: number; particleLights: boolean }; surface: { puddleMirror: boolean } };
  benchmark: { phase: string };
}

/** World generation and the full M5 pipeline under SwiftShader take minutes on a loaded machine. */
const WORLD_TIMEOUT = 600_000;
const LEVELS = ['low', 'medium', 'high', 'ultra'] as const;
const MAX_LIGHTS: Readonly<Record<(typeof LEVELS)[number], number>> = { low: 32, medium: 64, high: 128, ultra: 256 };

test.setTimeout(WORLD_TIMEOUT + 300_000);

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

function dh<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as { __dh: DhApi }).__dh.call(n as string, ...(a as unknown[])) as T, [name, args] as const);
}

/** Pixel centres of a coarse grid over the 1280×720 canvas. */
function grid(step: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let y = step / 2; y < 720; y += step) for (let x = step / 2; x < 1280; x += step) pts.push([x, y]);
  return pts;
}

/** The grid's pixels of one frame rendered after the call (a coarse grid: every probed pixel is a read of its own). */
async function picture(page: Page): Promise<string[]> {
  return page.evaluate(async (pts) => {
    const d = (window as unknown as { __dh: DhApi }).__dh;
    await d.readPixel(0, 0);
    const px = await Promise.all(pts.map(([x, y]) => d.readPixel(x, y)));
    return px.map((p) => p.join(','));
  }, grid(80));
}

const differing = (a: readonly string[], b: readonly string[]): number => a.filter((v, i) => v !== b[i]).length;

test('Qualitätsstufen zur Laufzeit: jede Stufe erreicht die Stränge, das Bild folgt ohne Neuladen', async ({ page }) => {
  const errors = collectConsole(page);
  // The page starts at "Hoch" (named in the URL: stored like a choice, no first-start benchmark).
  await page.goto('/?debug=1&quality=high');
  await page.waitForFunction(() => (window as unknown as { __dh?: DhApi }).__dh?.ready === true, undefined, { timeout: WORLD_TIMEOUT });
  await page.waitForFunction(
    () => {
      const d = (window as unknown as { __dh: DhApi }).__dh;
      return d.state().sim.world.ready && (d.call('renderInfo') as { sceneReady: boolean }).sceneReady;
    },
    undefined,
    { timeout: WORLD_TIMEOUT, polling: 1000 },
  );
  // Time stands still: every frame shows the same picture.
  await page.evaluate(() => (window as unknown as { __dh: DhApi }).__dh.freezeTime(true));
  await dh(page, 'glErrors');

  const start = await dh<QualityState>(page, 'quality');
  expect(start).toMatchObject({ level: 'high', settingsLevel: 'high', source: 'einstellungen', benchmark: { phase: 'aus' } });
  const high = await picture(page);

  for (const level of LEVELS) {
    const q = await dh<QualityState>(page, 'quality', level);
    expect(q.level, level).toBe(level);
    expect(q.strands.light.maxLights, level).toBe(MAX_LIGHTS[level]);
    expect(q.strands.water.reflection, level).toBe(level === 'high' || level === 'ultra');
    expect(q.strands.water.refraction, level).toBe(level !== 'low');
    expect(q.strands.particles.weatherShare < 1, level).toBe(level === 'low');
    expect(q.strands.particles.particleLights, level).toBe(level === 'ultra');
    expect(q.strands.surface.puddleMirror, level).toBe(level === 'high' || level === 'ultra');
    // Stored like the player's choice, with its preset.
    const graphics = await page.evaluate(() => (window as unknown as { __dh: DhApi }).__dh.state().settings.graphics);
    expect(graphics, level).toMatchObject({ quality: level, maxLights: MAX_LIGHTS[level] });
    // The water pass got the level's settings.
    const water = await dh<{ settings: { reflection: boolean; refraction: boolean } }>(page, 'waterInfo');
    expect(water.settings, level).toMatchObject({ reflection: q.strands.water.reflection, refraction: q.strands.water.refraction });
    const shot = await picture(page);
    if (level === 'low') {
      // Simplified water (no refraction, no caustics, no mirror): the lake reads differently.
      expect(differing(shot, high), 'Niedrig gegen Hoch').toBeGreaterThan(0);
    }
    expect(await dh<string[]>(page, 'glErrors'), level).toEqual([]);
  }

  // Back to "Hoch": the same picture as at the start.
  await dh(page, 'quality', 'high');
  const again = await picture(page);
  expect(differing(again, high)).toBe(0);
  expect(errors).toEqual([]);
});
