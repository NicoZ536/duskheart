/**
 * M7-10 … M7-13, M7-46 Ein Gewölbe im Browser (MASTERPROMPT §21 "Gewölbe", §8 "Vermittlung über 60 Erbauer-Tafeln"; docs/SPIEL.md
 * §19, §30 "`tafel` (Tafel lesen) – Öffner `tabletRead`"): über die Debug-Konsole hinab ins nächste Gewölbe der Spielwelt (Ebene
 * −1, das Gewölbe zählt als betreten), seine Rätsel gelöst (die Rätseltüren öffnen sich, `puzzleSolved`), dann eine Erbauer-Tafel
 * gelesen wie mit E davor: der Tafel-Bildschirm öffnet sich auf `tabletRead`, zeigt Nummer, Titel und Zeilen der Tafel, hält das
 * Spiel an und schließt mit Esc – danach läuft die Simulation weiter, und ohne neues `tabletRead` öffnet nichts ihn wieder.
 * Keine Konsolenfehler.
 */
import { expect, test, type Page } from '@playwright/test';
import { logicUrl } from './logik';

test.use({ viewport: { width: 1280, height: 720 }, locale: 'de-DE' });

interface Dh {
  ready?: boolean;
  call(name: string, ...args: unknown[]): unknown;
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

test('Gewölbe: hinab, Rätsel gelöst, Erbauer-Tafel gelesen – der Bildschirm hält das Spiel an und schließt mit Esc', async ({ page }) => {
  test.setTimeout(240_000);
  const fehler = collectConsole(page);
  await page.goto(logicUrl('spieler=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true);
  await page.waitForFunction(() => ((window as unknown as { __dh: Dh }).__dh.call('renderInfo') as { sceneReady: boolean }).sceneReady, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });

  // The guards rise when the player arrives: the spec judges the vault, not a fight.
  await exec(page, 'god an');
  // Down into the nearest vault: layer −1, entered.
  expect(await exec(page, 'vault')).toMatch(/^Hinab ins Gewölbe \d+ \(\w+, \d+ Räume\)\.$/u);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player?.layer === -1, undefined, { timeout: 30_000 });
  await expect.poll(() => events(page, 'vaultEntered'), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

  // Its puzzles solved: every one at once, the doors grind open.
  expect(await exec(page, 'solve')).toMatch(/^Alle Rätsel von Gewölbe \d+ gelöst\.$/u);
  await expect.poll(() => events(page, 'puzzleSolved'), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => events(page, 'vaultDoorOpened'), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

  // A Builder tablet read as E in front of it does: the screen opens on `tabletRead`.
  const tafel = page.getByTestId('ui-tafel');
  await expect(tafel).toBeHidden();
  const gelesen = await exec(page, 'tafel');
  expect(gelesen).toMatch(/^Tafel tafel_\d\d bei -?\d+, -?\d+ gelesen\.$/u);
  const id = /tafel_\d\d/u.exec(gelesen)?.[0] ?? '';
  await expect(tafel).toBeVisible({ timeout: 30_000 });
  await expect(tafel.locator('.dh-tafel')).toHaveAttribute('data-tafel', id);
  await expect(tafel.locator('.dh-tafel__nummer')).toHaveText(`Tafel ${Number(id.slice(-2))} von 60`);
  await expect(tafel.locator('.dh-tafel__titel')).not.toBeEmpty();
  expect(await tafel.locator('.dh-tafel__zeile').count()).toBeGreaterThanOrEqual(2);
  await expect(tafel.locator('.dh-tafel__fundort')).toHaveText('Gefunden in einem Gewölbe der Erbauer');
  expect(await events(page, 'tabletRead')).toBe(1);

  // The screen pauses the game: the simulation stands while it is open.
  const t0 = await tick(page);
  await page.waitForTimeout(1500);
  expect(await tick(page)).toBe(t0);

  // Esc closes it; the game runs on, and nothing opens it again without a new `tabletRead`.
  await page.keyboard.press('Escape');
  await expect(tafel).toBeHidden({ timeout: 15_000 });
  await expect.poll(() => tick(page), { timeout: 30_000 }).toBeGreaterThan(t0);
  await page.waitForTimeout(1000);
  expect(await events(page, 'tabletRead')).toBe(1);
  await expect(tafel).toBeHidden();

  expect(fehler).toEqual([]);
});
