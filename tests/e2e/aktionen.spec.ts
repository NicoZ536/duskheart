/**
 * M3-25 in the browser: eating is interrupted by a hit. The player (debug mode with `?spieler=1`) gets
 * apples (`inventory.give`); by day an apple is eaten after 1,5 s. Then at night, in the
 * dark and deep in fear (`fear.set 95`, MASTERPROMPT §12.3), harmful hallucinations creep up and strike –
 * the player keeps eating until a strike lands during a meal: the meal stops (`activityInterrupted`),
 * nothing is eaten, the strike cost health (`playerAfflicted`, a hit).
 */
import { expect, test, type Page } from '@playwright/test';

interface PlayerState {
  x: number;
  y: number;
  health: number;
  satiety: number;
  state: string;
}

interface SimState {
  tick: number;
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

const INV0 = { bereich: 'inventar', index: 0 } as const;

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

function command(page: Page, cmd: unknown): Promise<unknown> {
  return page.evaluate((c) => (window as unknown as { __dh: Dh }).__dh.command(c), cmd);
}

/** Waits until the drained events of `type` reached `count`. */
async function waitEvents(page: Page, type: string, count: number, timeout = 30_000): Promise<SimState> {
  await page.waitForFunction(([t, n]) => ((window as unknown as { __dh: Dh }).__dh.state().sim.events[t as string] ?? 0) >= (n as number), [type, count] as const, { timeout });
  return sim(page);
}

test('Essen wird durch einen Treffer unterbrochen – ohne Treffer ist der Apfel nach 1,5 s gegessen', async ({ page }) => {
  test.setTimeout(180_000);
  const msgs = collectConsole(page);
  await page.goto('/?debug=1&spieler=1');
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  await command(page, { type: 'inventory.give', item: 'apfel', count: 20 });
  await waitEvents(page, 'itemsAdded', 1);

  // By day, standing still: the apple is eaten after 1,5 s (its nutrition: tests/unit/game/aktionen.test.ts).
  const t0 = (await sim(page)).tick;
  await command(page, { type: 'action.eat', from: INV0 });
  const eaten = await waitEvents(page, 'itemEaten', 1);
  expect(eaten.events['activityInterrupted'] ?? 0).toBe(0);
  expect(eaten.events['activityFinished']).toBe(1);
  expect(eaten.tick - t0).toBeGreaterThanOrEqual(90);

  // At night in the dark with fear 95: hallucinations strike. Keep eating until a strike lands during a meal.
  await command(page, { type: 'setTime', hour: 23, minute: 0 });
  await command(page, { type: 'fear.set', value: 95 });
  await page.waitForFunction(
    (from) => {
      const dh = (window as unknown as { __dh: Dh }).__dh;
      const e = dh.state().sim.events;
      const started = e['activityStarted'] ?? 0;
      const ended = (e['activityFinished'] ?? 0) + (e['activityInterrupted'] ?? 0);
      if ((e['activityInterrupted'] ?? 0) > 0) return true;
      if (started === ended) {
        dh.command({ type: 'fear.set', value: 95 });
        dh.command({ type: 'action.eat', from });
      }
      return false;
    },
    INV0,
    { timeout: 90_000, polling: 250 },
  );
  const hit = await sim(page);
  expect(hit.events['activityInterrupted']).toBe(1);
  expect(hit.events['playerAfflicted']).toBeGreaterThanOrEqual(1);
  // The interrupted meal ate nothing: every finished meal ate one apple, the interrupted one none.
  expect(hit.events['itemEaten']).toBe(hit.events['activityFinished']);
  expect(hit.events['activityStarted']).toBe((hit.events['activityFinished'] ?? 0) + 1);
  expect(msgs).toEqual([]);
});
