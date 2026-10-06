/**
 * M7-58 Export/Import `.dhsave` und Seed teilen (MASTERPROMPT §28; docs/SPIEL.md §25): eine gespeicherte Welt wird in der
 * Weltauswahl als `.dhsave` exportiert (gzip über CompressionStream), gelöscht (mit Rückfrage), wieder importiert – als
 * neue Welt – und geladen: der Zustands-Hash ist derselbe wie beim Speichern. „Seed kopieren“ legt „DH-<Seed>-<Größe>“ in
 * die Zwischenablage; eine Datei, die kein Spielstand ist, wird mit Grund abgewiesen.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { logicUrl } from './logik';

interface Dh {
  ready: boolean;
  call(name: string, ...args: unknown[]): unknown;
  freezeTime(on: boolean): void;
  state(): { sim: { player: unknown } };
}
interface StateHash {
  tick: number;
  hash: string;
}

function collectConsole(page: Page): string[] {
  const msgs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') msgs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`pageerror: ${e.message}`));
  return msgs;
}

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => (window as unknown as { __dh: Dh }).__dh.call(n as string, ...(a as unknown[])) as T, [name, args] as const);
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true, undefined, { timeout: 120_000 });
}

test('Export → Löschen → Import → Laden ergibt denselben Zustands-Hash; Seed kopieren; eine fremde Datei wird abgewiesen', async ({ page, context }, info) => {
  test.setTimeout(300_000);
  const errors = collectConsole(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  // A game on the start beach, saved into its main slot while time stands still.
  await page.goto(logicUrl('spieler=1'));
  await ready(page);
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.freezeTime(true));
  const saved = await call<StateHash>(page, 'stateHash');
  await call(page, 'autosave', 'main');
  const [world] = await call<Array<{ id: string; name: string; seed: number }>>(page, 'saves');
  if (world === undefined) throw new Error('keine Welt gespeichert');

  // The world selection of the main menu.
  await page.goto(logicUrl('menue=1'));
  await ready(page);
  await page.getByTestId('menue-welten').click();

  await expect(page.getByTestId(`welt-${world.id}`)).toBeVisible();

  // Seed sharing.
  await page.getByTestId('welten-seed').click();
  await expect(page.getByTestId('welten-status')).toContainText(`DH-${world.seed}-`);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`^DH-${world.seed}-(small|medium|large)$`));

  // Export: a gzip of the world's dump.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('welten-export').click()]);
  const file = info.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  expect(download.suggestedFilename()).toMatch(/\.dhsave$/);
  const dump = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as { world: { id: string }; slots: Array<{ slot: string }> };
  expect(dump.world.id).toBe(world.id);
  expect(dump.slots.map((s) => s.slot)).toEqual(['main']);

  // Delete asks first; cancel keeps it, confirm removes it.
  await page.getByTestId('welten-loeschen').click();
  await page.getByTestId('welten-loeschen-nein').click();
  await expect(page.getByTestId(`welt-${world.id}`)).toBeVisible();
  await page.getByTestId('welten-loeschen').click();
  await page.getByTestId('welten-loeschen-ja').click();
  await expect(page.getByTestId(`welt-${world.id}`)).toHaveCount(0);
  await expect(page.getByTestId('welten-leer')).toBeVisible();

  // A file that is no save is refused with its reason, nothing is added.
  await page.getByTestId('welten-import-datei').setInputFiles({ name: 'kaputt.dhsave', mimeType: 'application/gzip', buffer: Buffer.from('kein gzip') });
  await expect(page.getByTestId('welten-status')).toContainText(/DUSKHEARTH/);
  await expect(page.getByTestId('welten-leer')).toBeVisible();

  // Import: a new world beside the others, under a new id.
  // Handed over as the file's bytes (the output path carries the test title's arrows and umlauts).
  await page.getByTestId('welten-import-datei').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/gzip', buffer: readFileSync(file) });
  await expect(page.getByTestId('welten-status')).toContainText(world.name);
  const after = await call<Array<{ id: string; name: string; tick: number }>>(page, 'saves');
  expect(after).toHaveLength(1);
  const imported = after[0];
  if (imported === undefined) throw new Error('nichts importiert');
  expect(imported.id).not.toBe(world.id);
  expect(imported).toMatchObject({ name: world.name, tick: saved.tick });
  await expect(page.getByTestId(`welt-${imported.id}`)).toBeVisible();

  // Loading the imported world (debug load: frozen at the save's tick) gives the state hash of the save.
  expect(await call<string>(page, 'loadSave', imported.id)).toBe(imported.id);
  await page.waitForURL(/[?&]laden=/, { timeout: 30_000 });
  await ready(page);
  // The save is restored once the world worker handed the world over (the player is the saved one).
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 120_000 });
  expect(await call<StateHash>(page, 'stateHash')).toEqual(saved);
  expect(errors).toEqual([]);
});
