/**
 * M7-99 Ein Esc schließt jeden pausierenden Bildschirm (MASTERPROMPT §26 „Esc/B: zurück“; docs/SPIEL.md §30; ADR-0247): das
 * Pause-Menü, die Perk-Wahl, die Vision eines entzündeten Leuchtfeuers und der Tafel-Bildschirm halten das Spiel an – ein
 * einzelnes Esc schließt jeden von ihnen, das Spiel läuft weiter, und dasselbe Esc öffnet nicht dahinter das Pause-Menü. Die
 * Karte (sie pausiert nicht, ohne eigenes `onBack` geschrieben) schließt ebenso mit einem Esc. Keine Konsolenfehler.
 */
import { expect, test, type Page } from '@playwright/test';
import { logicUrl } from './logik';

test.use({ viewport: { width: 1280, height: 720 }, locale: 'de-DE' });

interface Dh {
  ready?: boolean;
  call(name: string, ...args: unknown[]): unknown;
  command(cmd: unknown): unknown;
  exec(line: string): string;
  state(): { sim: { tick: number; player: { x: number; y: number; layer: number } | null; events: Record<string, number> } };
}

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

const exec = (page: Page, line: string): Promise<string> => page.evaluate((l) => (window as unknown as { __dh: Dh }).__dh.exec(l), line);
const tick = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.tick);
const events = (page: Page, type: string): Promise<number> => page.evaluate((t) => (window as unknown as { __dh: Dh }).__dh.state().sim.events[t] ?? 0, type);

async function befehl(page: Page, cmd: Record<string, unknown>): Promise<void> {
  await page.evaluate((c) => (window as unknown as { __dh: Dh }).__dh.command(c), cmd);
}

/** A key press and two rendered frames after it (the screens read the menu input once per frame). */
async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function starte(page: Page): Promise<void> {
  await page.goto(logicUrl('spieler=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  // The spec judges the screens, not a fight.
  await exec(page, 'god an');
}

/**
 * The screen `testId` is open: if it pauses, the simulation stands; one Esc closes it, nothing else opens (the pause menu
 * stays shut), and the simulation runs on.
 */
async function einEsc(page: Page, testId: string, pausiert: boolean): Promise<void> {
  const screen = page.getByTestId(testId);
  await expect(screen).toBeVisible({ timeout: 30_000 });
  const t0 = await tick(page);
  if (pausiert) {
    await page.waitForTimeout(800);
    expect(await tick(page), `${testId} pausiert`).toBe(t0);
  }
  await press(page, 'Escape');
  await expect(screen, `ein Esc schließt ${testId}`).toBeHidden({ timeout: 5_000 });
  // Two more frames: the same Esc must not open the pause menu behind it.
  await press(page, 'Shift');
  await expect(page.getByTestId('ui-pause')).toBeHidden();
  await expect(screen).toBeHidden();
  await expect.poll(() => tick(page), { timeout: 30_000 }).toBeGreaterThan(t0);
}

test('Ein Esc schließt Pause-Menü, Karte, Perk-Wahl und Vision', async ({ page }) => {
  test.setTimeout(300_000);
  const fehler = collectConsole(page);
  await starte(page);

  // The pause menu: Esc opens it, one Esc closes it.
  await press(page, 'Escape');
  await einEsc(page, 'ui-pause', true);

  // The map (M; it does not pause).
  await press(page, 'm');
  await einEsc(page, 'ui-karte', false);

  // The perk choice: a skill rises to 100, the choice opens by itself and pauses.
  await befehl(page, { type: 'debug.unlock', skill: 'holzfaellen' });
  await einEsc(page, 'ui-perkwahl', true);

  // The vision of the Greengrove's beacon: its guardian falls, the beacon is lit – the vision opens and pauses.
  await befehl(page, { type: 'boss.debug', boss: 'borkenvater', aktion: 'besiegen' });
  await befehl(page, { type: 'beacon.debug', beacon: 1, aktion: 'entzuenden' });
  await expect.poll(() => events(page, 'beaconLit'), { timeout: 30_000 }).toBe(1);
  await einEsc(page, 'ui-vision', true);

  expect(fehler).toEqual([]);
});

test('Ein Esc schließt den Tafel-Bildschirm', async ({ page }) => {
  test.setTimeout(240_000);
  const fehler = collectConsole(page);
  await starte(page);
  // Down into the nearest vault, its puzzles solved, a Builder tablet read as E in front of it does.
  expect(await exec(page, 'vault')).toMatch(/^Hinab ins Gewölbe \d+/u);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player?.layer === -1, undefined, { timeout: 30_000 });
  expect(await exec(page, 'solve')).toMatch(/gelöst\.$/u);
  expect(await exec(page, 'tafel')).toMatch(/gelesen\.$/u);
  await einEsc(page, 'ui-tafel', true);
  expect(await events(page, 'tabletRead')).toBe(1);

  expect(fehler).toEqual([]);
});
