/**
 * M0-10/M0-12 Debug-Grundgerüst: `window.__dh` nur mit `?debug=1`, F3-Overlay, Konsole (^ / Backquote)
 * mit `help`, `freezeTime` hält die Simulation an (auch über einen Tab-Wechsel hinweg), `__dh.command`
 * führt Game-Commands aus und Tastatureingaben werden zu Commands (M0-08). Keine Konsolenfehler.
 */
import { expect, test, type Page } from '@playwright/test';

interface SimState {
  seed: number;
  tick: number;
  entities: number;
  controlled: { x: number; y: number } | null;
}

interface DhHandle {
  ready: boolean;
  timeFrozen: boolean;
  exec(cmd: string): string;
  command(cmd: unknown): unknown;
  state(): { sim: SimState };
  freezeTime(on: boolean): void;
  call(name: string, ...args: unknown[]): unknown;
}

// Pins the detected UI language, so console output can be compared with the English texts.
test.use({ locale: 'en-US' });

/** Frames rendered while frozen before the tick counter is compared again (≈ 0.5 s at 60 Hz). */
const FROZEN_FRAMES = 30;
/** Ticks the simulation must advance after unfreezing. */
const RESUME_TICKS = 10;

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

async function openDebug(page: Page, query = ''): Promise<void> {
  await page.goto(`/?debug=1${query}`);
  await page.waitForFunction(() => (window as unknown as { __dh?: DhHandle }).__dh?.ready === true);
}

function dhCall<T>(page: Page, name: string): Promise<T> {
  return page.evaluate((n) => (window as unknown as { __dh: DhHandle }).__dh.call(n) as T, name);
}

function simState(page: Page): Promise<SimState> {
  return page.evaluate(() => (window as unknown as { __dh: DhHandle }).__dh.state().sim);
}

/** Simulates hiding and showing the tab (the loop pauses while hidden). */
async function hideAndShowTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const hidden of [true, false]) {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    }
  });
}

test('ohne ?debug=1 gibt es kein window.__dh', async ({ page }) => {
  const msgs = collectConsole(page);
  await page.goto('/');
  await expect(page.locator('#dh-ui')).not.toBeEmpty();
  expect(await page.evaluate(() => typeof (window as unknown as { __dh?: unknown }).__dh)).toBe('undefined');
  await page.keyboard.press('F3');
  await page.keyboard.press('Backquote');
  await expect(page.locator('.dh-debug-overlay')).toHaveCount(0);
  await expect(page.locator('.dh-debug-console')).toHaveCount(0);
  expect(msgs).toEqual([]);
});

test('F3 schaltet das Leistungs-Overlay ein und aus', async ({ page }) => {
  const msgs = collectConsole(page);
  await openDebug(page);
  const overlay = page.locator('.dh-debug-overlay');
  await expect(overlay).toHaveCount(0);
  await page.keyboard.press('F3');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('FPS');
  await page.keyboard.press('F3');
  await expect(overlay).toHaveCount(0);
  expect(msgs).toEqual([]);
});

test('^ öffnet die Konsole, „help“ listet die Befehle', async ({ page }) => {
  const msgs = collectConsole(page);
  await openDebug(page);
  const consoleBox = page.locator('.dh-debug-console');
  await expect(consoleBox).toHaveCount(0);
  await page.keyboard.press('Backquote');
  await expect(consoleBox).toBeVisible();
  const input = consoleBox.locator('input.dh-debug-input');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');

  await page.keyboard.type('help');
  await page.keyboard.press('Enter');
  const scrollback = consoleBox.locator('.dh-debug-scrollback');
  for (const usage of ['set <path> <value>', 'speed <factor>', 'freeze <on|off>', 'help [command]', 'clear']) {
    await expect(scrollback).toContainText(usage);
  }
  await expect(input).toHaveValue('');

  // The toggle key inside the input closes the console again; the ISO key next to left Shift opens
  // it too (not in Playwright's US layout, so it is dispatched as a synthetic key event).
  await page.keyboard.press('Backquote');
  await expect(consoleBox).toHaveCount(0);
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'IntlBackslash', key: '<', bubbles: true })));
  await expect(consoleBox).toBeVisible();
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(consoleBox).toHaveCount(0);
  expect(msgs).toEqual([]);
});

test('Konsolenbefehle freeze und speed wirken auf die Debug-API', async ({ page }) => {
  const msgs = collectConsole(page);
  await openDebug(page);
  await page.keyboard.press('Backquote');
  const input = page.locator('.dh-debug-console input.dh-debug-input');
  await expect(input).toBeFocused();
  await page.keyboard.type('freeze on');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as unknown as { __dh: DhHandle }).__dh.timeFrozen)).toBe(true);
  await expect(page.locator('.dh-debug-line--output').last()).toHaveText('Time frozen');
  await page.keyboard.type('freeze off');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as unknown as { __dh: DhHandle }).__dh.timeFrozen)).toBe(false);
  await expect(page.locator('.dh-debug-line--output').last()).toHaveText('Time running');
  const out = await page.evaluate(() => (window as unknown as { __dh: DhHandle }).__dh.exec('speed 2'));
  expect(out).toContain('2');
  expect(await page.evaluate(() => (window as unknown as { __dh: { speed: number } }).__dh.speed)).toBe(2);
  expect(msgs).toEqual([]);
});

test('freezeTime hält den Simulationstakt an, Rendern läuft weiter', async ({ page }) => {
  const msgs = collectConsole(page);
  await openDebug(page);
  await page.waitForFunction(() => ((window as unknown as { __dh: DhHandle }).__dh.call('tick') as number) > 0);

  await page.evaluate(() => (window as unknown as { __dh: DhHandle }).__dh.freezeTime(true));
  const frozenTick = await dhCall<number>(page, 'tick');
  const frames = await dhCall<number>(page, 'frames');
  await page.waitForFunction(
    (target) => ((window as unknown as { __dh: DhHandle }).__dh.call('frames') as number) >= target,
    frames + FROZEN_FRAMES,
  );
  expect(await dhCall<number>(page, 'tick')).toBe(frozenTick);
  // Showing the tab again must not cancel the debug freeze.
  await hideAndShowTab(page);
  const framesAfterTab = await dhCall<number>(page, 'frames');
  await page.waitForFunction(
    (target) => ((window as unknown as { __dh: DhHandle }).__dh.call('frames') as number) >= target,
    framesAfterTab + FROZEN_FRAMES,
  );
  expect(await dhCall<number>(page, 'tick')).toBe(frozenTick);
  expect((await simState(page)).tick).toBe(frozenTick);

  await page.evaluate(() => (window as unknown as { __dh: DhHandle }).__dh.freezeTime(false));
  await page.waitForFunction(
    (target) => ((window as unknown as { __dh: DhHandle }).__dh.call('tick') as number) >= target,
    frozenTick + RESUME_TICKS,
  );
  expect(msgs).toEqual([]);
});

test('__dh.command führt Game-Commands aus, WASD steuert die Entität über Commands', async ({ page }) => {
  const msgs = collectConsole(page);
  await openDebug(page, '&seed=4242');
  expect((await simState(page)).seed).toBe(4242);
  await page.evaluate(() => (window as unknown as { __dh: DhHandle }).__dh.command({ type: 'spawnDebugMover', x: 800, y: 800, controlled: true }));
  await page.waitForFunction(() => (window as unknown as { __dh: DhHandle }).__dh.state().sim.controlled !== null);
  const start = await simState(page);
  expect(start.entities).toBe(1);
  expect(start.controlled).toEqual({ entity: 0, x: 800, y: 800 });

  // Keyboard → action moveRight → move command → motion system.
  await page.keyboard.down('KeyD');
  await page.waitForFunction((x0) => ((window as unknown as { __dh: DhHandle }).__dh.state().sim.controlled?.x ?? 0) > x0 + 20, start.controlled?.x ?? 0);
  await page.keyboard.up('KeyD');
  const moved = await simState(page);
  expect(moved.controlled?.y).toBe(800);

  // After releasing the key the entity stops (a stop command was sent).
  await page.waitForFunction(() => {
    const dh = (window as unknown as { __dh: DhHandle; __dhLastX?: number }).__dh;
    const w = window as unknown as { __dhLastX?: number };
    const x = dh.state().sim.controlled?.x ?? 0;
    const still = w.__dhLastX === x;
    w.__dhLastX = x;
    return still;
  }, undefined, { polling: 200 });

  const invalid = await page.evaluate(() => {
    try {
      (window as unknown as { __dh: DhHandle }).__dh.command({ type: 'move', dx: 3, dy: 0 });
      return 'accepted';
    } catch (e) {
      return (e as Error).name;
    }
  });
  expect(invalid).toBe('TypeError');
  expect(msgs).toEqual([]);
});
