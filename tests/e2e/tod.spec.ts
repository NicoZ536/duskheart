/**
 * M3-26 in the browser: the player's light goes out (`death.kill`, the debug console's `kill`) – the
 * simulation reports the death, the body lies still at 0 health; `death.respawn` brings the player back on
 * the start beach with the maximum health of "Erschüttert" (85). The death screen itself, in German, from
 * the screenshot scenario `todesbildschirm`: title „Dein Licht ist erloschen.“, cause, consequences and
 * the places to wake, the bed focused; the picture goes to `shots/latest/todesbildschirm-de.png`.
 */
import { expect, test, type Page } from '@playwright/test';

interface PlayerState {
  x: number;
  y: number;
  health: number;
  state: string;
}

interface SimState {
  player: PlayerState | null;
  events: Record<string, number>;
}

interface Dh {
  ready: boolean;
  state(): { sim: SimState };
  command(cmd: unknown): unknown;
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

function sim(page: Page): Promise<SimState> {
  return page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim);
}

async function waitEvents(page: Page, type: string, count: number): Promise<SimState> {
  await page.waitForFunction(([t, n]) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events[t as string] ?? 0) >= (n as number), [type, count] as const, { timeout: 30_000 });
  return sim(page);
}

test('das Licht erlischt und entfacht am Startstrand wieder – mit „Erschüttert“', async ({ page }) => {
  test.setTimeout(120_000);
  const msgs = collectConsole(page);
  await page.goto('/?debug=1&spieler=1');
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.command({ type: 'death.kill' }));
  const dead = await waitEvents(page, 'playerDied', 1);
  expect(dead.player?.health).toBe(0);
  const at = { x: dead.player?.x, y: dead.player?.y };
  // The body lies still: a movement key does not move it.
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.command({ type: 'player.move', dx: 1, dy: 0 }));
  await page.waitForTimeout(300);
  const still = await sim(page);
  expect({ x: still.player?.x, y: still.player?.y }).toEqual(at);
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.command({ type: 'player.move', dx: 0, dy: 0 }));
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.command({ type: 'death.respawn', at: 'strand' }));
  const back = await waitEvents(page, 'playerRespawned', 1);
  expect(back.player?.health).toBeCloseTo(85, 5);
  expect(back.events['conditionApplied']).toBeGreaterThanOrEqual(1);
  expect(msgs).toEqual([]);
});

test('Todesbildschirm: „Dein Licht ist erloschen.“, Ursache, Folgen und die Orte zum Erwachen (Tastaturfokus)', async ({ page }) => {
  test.setTimeout(180_000);
  const msgs = collectConsole(page);
  await page.goto('/?debug=1&scenario=todesbildschirm');
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.call('scenarioReady') === true, undefined, { timeout: 120_000 });
  const screen = page.getByTestId('todesbildschirm');
  await expect(screen).toBeVisible();
  await expect(page.getByTestId('tod-titel')).toHaveText('Dein Licht ist erloschen.');
  await expect(page.getByTestId('tod-ursache')).toHaveText('Ursache: erfroren');
  const folgen = page.getByTestId('tod-folgen');
  await expect(folgen).toContainText('Dein Grab liegt am Todesort: 9 Stapel warten dort');
  await expect(folgen).toContainText('Erschüttert: 3\u00a0min lang 15\u00a0% weniger maximales Leben.');
  await expect(folgen).toContainText('Jede Fertigkeit verliert 25\u00a0%');
  await expect(page.getByTestId('tod-erwachen-bett')).toHaveText('Am Bett erwachen');
  await expect(page.getByTestId('tod-erwachen-strand')).toHaveText('Am Startstrand erwachen');
  await expect(page.getByTestId('tod-erwachen-bett')).toHaveAttribute('data-fokus-sichtbar', '');
  await page.screenshot({ path: 'shots/latest/todesbildschirm-de.png' });
  expect(msgs).toEqual([]);
});
