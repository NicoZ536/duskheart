/**
 * M6 creatures in the browser (M6-16b, M6-13, M6-27, M6-30): the debug console's `spawn` makes roe deer appear in front
 * of the player, the wildlife around the start beach walks – its paths come from the path worker (`__dh.call('creatures')`
 * counts the worker's answers: the worker chunk of the build loads and answers), and `kill <radius>` fells the creatures
 * around the player into carcasses. No console errors or warnings.
 */
import { expect, test, type Page } from '@playwright/test';
import { logicUrl } from './logik';

interface Summary {
  byId: Record<string, number>;
  carcasses: number;
  traps: number;
  paths: { requested: number; admitted: number; byWorker: number; inThread: number; cancelled: number; expanded: number };
}
interface Dh {
  ready: boolean;
  exec(line: string): string;
  state(): { sim: { player: { x: number; y: number } | null } };
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

function summary(page: Page): Promise<Summary> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.call('creatures') as Summary);
}

test('Kreaturen: spawn, Pfade aus dem Pfad-Worker, kill im Umkreis', async ({ page }) => {
  test.setTimeout(180_000);
  const msgs = collectConsole(page);
  await page.goto(logicUrl('spieler=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  const before = await summary(page);
  expect(await exec(page, 'spawn reh 2')).toBe('Reh ×2 erscheint.');
  await page.waitForFunction((n) => (((window as unknown as { __dh: Dh }).__dh.call('creatures') as Summary).byId['reh'] ?? 0) >= n, (before.byId['reh'] ?? 0) + 2, { timeout: 30_000 });
  // Wandering and fleeing creatures ask for paths; the worker answers them before they are due.
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('creatures') as Summary).paths.byWorker > 0, undefined, { timeout: 90_000 });
  const walking = await summary(page);
  expect(walking.paths.requested).toBeGreaterThan(0);
  expect(walking.paths.admitted).toBeGreaterThan(0);
  expect(await exec(page, 'kill 12')).toBe('Die Kreaturen im Umkreis von 12 Kacheln fallen.');
  await page.waitForFunction((c) => ((window as unknown as { __dh: Dh }).__dh.call('creatures') as Summary).carcasses >= c + 2, walking.carcasses, { timeout: 30_000 });
  expect(msgs).toEqual([]);
});
