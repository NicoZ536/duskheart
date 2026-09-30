/**
 * M6-35 in the browser (MASTERPROMPT §31.6 "Overlays", §31.4 Konsole): the debug console's `spawn` makes creatures appear
 * around the player, the overlays `pfade`, `wahrnehmung` and `spawnzonen` draw them in the game view's debug layer
 * (`__dh.call('worldInfo').overlayStats`): the paths of the path service's log with their goals, every creature's
 * senses with its AI state, the spawn ring of the shadow brood at night; `kill <radius>` fells the creatures and the
 * perception overlay follows; switched off, every overlay draws nothing. No console errors or warnings.
 */
import { expect, test, type Page } from '@playwright/test';
import { renderedFrames } from './frames';
import { logicUrl } from './logik';

interface OverlayStats {
  spawnTiles: number;
  spawnBlockedTiles: number;
  perceived: number;
  paths: number;
  pendingPaths: number;
}
interface Dh {
  ready: boolean;
  exec(line: string): string;
  state(): { sim: { tick: number; player: { x: number; y: number } | null; events: Record<string, number> } };
  call(name: string, ...args: unknown[]): unknown;
}

test.use({ locale: 'de-DE', viewport: { width: 1280, height: 720 } });

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

function exec(page: Page, line: string): Promise<string> {
  return page.evaluate((l) => (window as unknown as { __dh: Dh }).__dh.exec(l), line);
}

function events(page: Page, name: string): Promise<number> {
  return page.evaluate((n) => (window as unknown as { __dh: Dh }).__dh.state().sim.events[n] ?? 0, name);
}

/** Runs `line` (a `spawn`) and waits until the simulation placed `count` more creatures. */
async function spawn(page: Page, line: string, count: number, answer: string): Promise<void> {
  const before = await events(page, 'creatureSpawned');
  expect(await exec(page, line)).toBe(answer);
  await page.waitForFunction(([n]) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events['creatureSpawned'] ?? 0) >= n, [before + count] as const, { timeout: 30_000 });
}

async function stats(page: Page): Promise<OverlayStats> {
  await renderedFrames(page, 2);
  return page.evaluate(() => ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { overlayStats: OverlayStats }).overlayStats);
}

/** Waits until the sum of the counters `keys` lies in [min, max]. */
function waitStats(page: Page, keys: readonly (keyof OverlayStats)[], min: number, max = Number.MAX_SAFE_INTEGER, timeout = 60_000): Promise<unknown> {
  return page.waitForFunction(
    ([k, lo, hi]) => {
      const s = ((window as unknown as { __dh: Dh }).__dh.call('worldInfo') as { overlayStats: Record<string, number> }).overlayStats;
      const n = k.reduce((a, key) => a + (s[key] ?? 0), 0);
      return n >= lo && n <= hi;
    },
    [keys, min, max] as const,
    { timeout, polling: 250 },
  );
}

test('Kreaturen-Overlays: spawn, pfade, wahrnehmung, spawnzonen bei Nacht, kill', async ({ page }) => {
  test.setTimeout(180_000);
  const msgs = collectConsole(page);
  await page.goto(logicUrl('spieler=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  expect(await exec(page, 'god an')).toBe('Gott-Modus an: kein Schaden.');
  // Night first (the jump runs its ticks), then the creatures a few tiles in front of the player.
  const tick = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.tick);
  expect(await exec(page, 'time 23:00')).toBe('Die Zeit springt vorwärts auf 23:00.');
  await page.waitForFunction((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.tick > t + 30, tick);
  await spawn(page, 'spawn reh 3', 3, 'Reh ×3 erscheint.');
  await spawn(page, 'spawn hase 2', 2, 'Hase ×2 erscheint.');

  // Perception: every creature in view with its senses and state (the five just spawned stand in front of the player).
  expect(await exec(page, 'overlay wahrnehmung')).toBe('Overlay wahrnehmung: An');
  await waitStats(page, ['perceived'], 5);
  const sensing = await stats(page);
  expect(sensing.paths).toBe(0);
  expect(sensing.pendingPaths).toBe(0);
  expect(await exec(page, 'overlay wahrnehmung aus')).toBe('Overlay wahrnehmung: Aus');
  await waitStats(page, ['perceived'], 0, 0);

  // Paths: the log runs from the overlay's first frame; wandering and fleeing creatures ask the path service.
  expect(await exec(page, 'overlay pfade')).toBe('Overlay pfade: An');
  await waitStats(page, ['paths', 'pendingPaths'], 1, undefined, 90_000);
  expect(await exec(page, 'overlay pfade aus')).toBe('Overlay pfade: Aus');
  expect(await exec(page, 'overlay wahrnehmung')).toBe('Overlay wahrnehmung: An');
  await waitStats(page, ['perceived'], 1);

  // Kill: the creatures around the player fall (the whole view and beyond), the overlay follows.
  const before = await stats(page);
  expect(await exec(page, 'kill 64')).toBe('Die Kreaturen im Umkreis von 64 Kacheln fallen.');
  await waitStats(page, ['perceived'], 0, before.perceived - 1);
  expect(await exec(page, 'overlay wahrnehmung aus')).toBe('Overlay wahrnehmung: Aus');

  // The spawn ring at night: tiles 16–40 tiles out in the dark.
  expect(await exec(page, 'overlay spawnzonen')).toBe('Overlay spawnzonen: An');
  await waitStats(page, ['spawnTiles'], 1);
  expect(await exec(page, 'overlay spawnzonen aus')).toBe('Overlay spawnzonen: Aus');
  const off = await stats(page);
  expect(off).toEqual({ ...off, spawnTiles: 0, spawnBlockedTiles: 0, perceived: 0, paths: 0, pendingPaths: 0 });
  expect(msgs).toEqual([]);
});
