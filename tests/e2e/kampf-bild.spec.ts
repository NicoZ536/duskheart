/**
 * M6-05/M6-38 in the browser (MASTERPROMPT §6.2 "Kampf", §19.1, §29; docs/SPIEL.md §13): the fight's picture in the game
 * view, read from `__dh.call('worldInfo').combat` in the scenario `hitstop` (a heavy blow of the wooden club on a roe
 * deer, the picture three ticks into its six ticks of hitstop):
 * - the player's figure shows the club's heavy blow (`heavy_keule`) past its strike, the weapon turned towards the aim;
 * - the hit sprayed its pieces, left the swing's trail, put its damage number into the world UI and shook the camera;
 * - with the settings "Schadenszahlen" off and "Bildschirmwackeln" at 0 % (stored like a player's choice) the same hit
 *   shows no number and does not shake – the pieces and the trail stay.
 * No console errors or warnings.
 */
import { expect, test, type Page } from '@playwright/test';
import { logicUrl } from './logik';

interface CombatInfo {
  particles: number;
  smears: number;
  smearPixels: number;
  hits: number;
  damageNumbersShown: number;
  damageNumbersAdded: number;
  shake: [number, number];
  shakeAmplitude: number;
  clip: string | null;
  stage: string;
  aimAngle: number;
  handAngle: number;
}
interface Dh {
  ready: boolean;
  call(name: string, ...args: unknown[]): unknown;
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

/** localStorage key and version of the settings (src/engine/settings.ts). */
const SETTINGS_KEY = 'duskhearth.settings';
const SETTINGS_VERSION = 1;
/** Scenario settle timeout (world, atlas, script; SwiftShader). */
const READY_MS = 110_000;

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

/** Opens the scenario `hitstop` (with `settings` stored before the page starts) and returns the fight's info once it stands. */
async function hitstopPicture(page: Page, settings: Record<string, unknown> | null): Promise<CombatInfo> {
  if (settings !== null) {
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [SETTINGS_KEY, JSON.stringify({ v: SETTINGS_VERSION, settings })] as const);
  }
  await page.goto(logicUrl('scenario=hitstop'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.call('scenarioReady') === true, undefined, { timeout: READY_MS, polling: 500 });
  return page.evaluate(() => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { combat: CombatInfo }).combat);
}

test('Treffer im Bild: Kampfclip, gedrehte Waffe, Einschlag, Spur, Schadenszahl, Wackeln', async ({ page }) => {
  test.setTimeout(180_000);
  const msgs = collectConsole(page);
  const c = await hitstopPicture(page, null);
  expect(c.hits).toBe(1);
  expect(c.clip).toBe('heavy_keule');
  expect(c.stage).toBe('follow');
  // Aimed east at the deer while facing east: the weapon points along the aim.
  expect(c.aimAngle).toBeCloseTo(0, 6);
  expect(c.handAngle).toBeCloseTo(0, 6);
  expect(c.particles).toBeGreaterThan(4);
  expect(c.smears).toBe(1);
  expect(c.smearPixels).toBeGreaterThan(20);
  expect(c.damageNumbersAdded).toBe(1);
  expect(c.damageNumbersShown).toBe(1);
  // The heavy blow (impact 5) shakes the camera by whole pixels, decaying: three ticks in, still more than a pixel.
  expect(c.shakeAmplitude).toBeGreaterThan(1);
  expect(Math.abs(c.shake[0])).toBeLessThanOrEqual(Math.ceil(c.shakeAmplitude));
  expect(Number.isInteger(c.shake[0]) && Number.isInteger(c.shake[1])).toBe(true);
  expect(msgs).toEqual([]);
});

test('Schadenszahlen aus, Bildschirmwackeln 0 %: keine Zahl, kein Wackeln – Einschlag und Spur bleiben', async ({ page }) => {
  test.setTimeout(180_000);
  const msgs = collectConsole(page);
  const c = await hitstopPicture(page, { game: { damageNumbers: false }, accessibility: { screenshake: 0 } });
  expect(c.hits).toBe(1);
  expect(c.damageNumbersAdded).toBe(1);
  expect(c.damageNumbersShown).toBe(0);
  expect(c.shakeAmplitude).toBe(0);
  expect(c.shake).toEqual([0, 0]);
  expect(c.particles).toBeGreaterThan(4);
  expect(c.smears).toBe(1);
  expect(msgs).toEqual([]);
});
