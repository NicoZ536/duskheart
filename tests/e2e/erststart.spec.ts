/**
 * M5-26: der erste Start wählt die Qualitätsstufe per Kurz-Benchmark und speichert sie (§6.3). Ein frisches Profil
 * (leerer localStorage) misst die Szene hinter dem Titel, sobald sie steht, von „Niedrig“ aufwärts; die gewählte
 * Stufe landet mit ihrer Voreinstellung und `autoDetected` in den gespeicherten Einstellungen. Der nächste Start misst
 * nicht noch einmal. Unter SwiftShader (Software-Rasterer) ist schon „Niedrig“ über dem Budget: die Wahl ist
 * „Niedrig“ – das richtige Verhalten für ein langsames Gerät. Eine Stufe in der URL einer Debug-Seite gilt als Wahl.
 */
import { expect, test, type Page } from '@playwright/test';

interface DhApi {
  readonly ready: boolean;
  call(name: string, ...args: unknown[]): unknown;
}

interface QualityState {
  level: string;
  source: string;
  benchmark: { phase: string; result: { level: string; medians: Array<{ level: string; ms: number }>; overBudget: string | null } | null };
}

interface StoredGraphics {
  quality: string;
  autoDetected: boolean;
  maxLights: number;
  shadows: string;
  water: string;
}

/** The benchmark waits for the world behind the title (generated in the worker) – minutes under SwiftShader on a loaded machine. */
const FIRST_START_TIMEOUT = 600_000;
const SETTINGS_KEY = 'duskhearth.settings';
const PRESETS: Readonly<Record<string, { maxLights: number; shadows: string; water: string }>> = {
  low: { maxLights: 32, shadows: 'sun', water: 'simple' },
  medium: { maxLights: 64, shadows: 'hard', water: 'noReflection' },
  high: { maxLights: 128, shadows: 'soft', water: 'full' },
  ultra: { maxLights: 256, shadows: 'soft', water: 'full' },
};

test.setTimeout(FIRST_START_TIMEOUT + 180_000);

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

function storedGraphics(page: Page): Promise<StoredGraphics | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : ((JSON.parse(raw) as { settings: { graphics: StoredGraphics } }).settings.graphics ?? null);
  }, SETTINGS_KEY);
}

test('Erststart im Spiel: der Kurz-Benchmark wählt eine Stufe und speichert sie; der nächste Start behält sie', async ({ page }) => {
  const errors = collectConsole(page);
  await page.goto('/');
  expect(await storedGraphics(page)).toBeNull();
  await page.waitForFunction((key) => {
    const raw = localStorage.getItem(key);
    return raw !== null && (JSON.parse(raw) as { settings: { graphics: { autoDetected: boolean } } }).settings.graphics.autoDetected === true;
  }, SETTINGS_KEY, { timeout: FIRST_START_TIMEOUT, polling: 1000 });
  const chosen = await storedGraphics(page);
  expect(chosen).not.toBeNull();
  const level = chosen?.quality ?? '';
  expect(Object.keys(PRESETS)).toContain(level);
  expect(chosen).toMatchObject({ autoDetected: true, ...PRESETS[level] });
  // A software rasteriser is far over the budget at every level.
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  });
  if (/swiftshader/i.test(renderer)) expect(level).toBe('low');

  // The next start keeps the level and measures no more (the stored settings stay exactly as they were).
  const before = await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY);
  await page.reload();
  await page.waitForTimeout(3000);
  expect(await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY)).toBe(before);
  expect(errors).toEqual([]);
});

test('Erststart auf einer Debug-Seite: der Regler berichtet Messung und Ergebnis, der Neustart misst nicht mehr', async ({ page }) => {
  const errors = collectConsole(page);
  await page.goto('/?debug=1');
  await page.waitForFunction(() => (window as unknown as { __dh?: DhApi }).__dh?.ready === true, undefined, { timeout: FIRST_START_TIMEOUT });
  const early = await dh<QualityState>(page, 'quality');
  expect(['wartet', 'misst', 'fertig']).toContain(early.benchmark.phase);
  await page.waitForFunction(() => ((window as unknown as { __dh: DhApi }).__dh.call('quality') as QualityState).benchmark.phase === 'fertig', undefined, {
    timeout: FIRST_START_TIMEOUT,
    polling: 1000,
  });
  const done = await dh<QualityState>(page, 'quality');
  const result = done.benchmark.result;
  expect(result).not.toBeNull();
  // Measured from the lowest level up, one median per measured level; the result is the level rendered now.
  expect(result?.medians[0]?.level).toBe('low');
  expect(result?.medians.every((m) => m.ms > 0)).toBe(true);
  expect(done).toMatchObject({ level: result?.level, source: 'einstellungen' });
  expect(await storedGraphics(page)).toMatchObject({ quality: result?.level, autoDetected: true });

  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __dh?: DhApi }).__dh?.ready === true, undefined, { timeout: FIRST_START_TIMEOUT });
  expect(await dh<QualityState>(page, 'quality')).toMatchObject({ level: result?.level, benchmark: { phase: 'aus' } });
  expect(errors).toEqual([]);
});

test('eine Stufe in der URL einer Debug-Seite gilt als Wahl: gespeichert, kein Benchmark', async ({ page }) => {
  await page.goto('/?debug=1&quality=ultra');
  await page.waitForFunction(() => (window as unknown as { __dh?: DhApi }).__dh?.ready === true, undefined, { timeout: FIRST_START_TIMEOUT });
  expect(await dh<QualityState>(page, 'quality')).toMatchObject({ level: 'ultra', benchmark: { phase: 'aus' } });
  expect(await storedGraphics(page)).toMatchObject({ quality: 'ultra', autoDetected: true, ...PRESETS.ultra });
});
