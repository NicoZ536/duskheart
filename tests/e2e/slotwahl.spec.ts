/**
 * M7-93 Einen älteren Speicherslot gezielt laden (MASTERPROMPT §28 „die letzten 3 Autosaves rotierend“; docs/SPIEL.md §25):
 * eine neue Welt aus dem Hauptmenü, zwei Autosaves zu zwei Zeitpunkten (der erste bei angehaltener Zeit, mit seinem
 * Zustands-Hash); zurück im Hauptmenü zeigt die Weltauswahl unter „Speicherslots“ die Slots der Welt, neuester zuerst und
 * markiert – der ältere Autosave lädt gezielt und ergibt genau seinen Zustands-Hash (Tick und `hashState`). Hat die so
 * geladene Sitzung gespeichert, setzt ein Neuladen des Tabs wieder beim neuesten Stand an. Jedes Wort der beiden
 * Knopfleisten passt auf Deutsch in seinen Knopf. Keine Konsolenfehler.
 */
import { expect, test, type Page } from '@playwright/test';
import { logicUrl } from './logik';

test.use({ viewport: { width: 1280, height: 720 }, locale: 'de-DE' });

interface Dh {
  ready: boolean;
  call(name: string, ...args: unknown[]): unknown;
  freezeTime(on: boolean): void;
  state(): { sim: { tick: number; player: unknown } };
}
interface Slot {
  slot: string;
  savedAt: number;
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

const freeze = (page: Page, on: boolean): Promise<void> => page.evaluate((o) => (window as unknown as { __dh: Dh }).__dh.freezeTime(o), on);
const tick = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.tick);
const request = (page: Page): Promise<unknown> => page.evaluate(() => JSON.parse(sessionStorage.getItem('duskhearth.start') ?? 'null') as unknown);

/**
 * The buttons of the world selection's bars whose word runs out of their inner box (between the paddings) – with
 * „Speicherslots“ as a fifth button in a bar, the German words were clipped.
 */
function clippedButtons(page: Page): Promise<string[]> {
  return page.locator('.dh-welten__leiste .dh-knopf').evaluateAll((els) =>
    els.flatMap((el) => {
      const style = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const range = document.createRange();
      range.selectNodeContents(el);
      const word = range.getBoundingClientRect().width;
      return word > inner + 0.5 ? [`${el.textContent ?? ''}: ${word.toFixed(1)} > ${inner.toFixed(1)}`] : [];
    }),
  );
}

async function inGame(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 120_000 });
}

test('Weltauswahl → Speicherslots: ein älterer Autosave lädt gezielt und ergibt seinen Zustands-Hash', async ({ page }) => {
  test.setTimeout(360_000);
  const errors = collectConsole(page);
  // A new world from the main menu (the world's form, the character, the loading screen).
  await page.goto(logicUrl('menue=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true, undefined, { timeout: 120_000 });
  await page.getByTestId('menue-neue-welt').click();
  await page.getByTestId('neue-welt-name').fill('Slotwelt');
  await page.getByTestId('neue-welt-seed').fill('DH-13572-small');
  await page.getByTestId('neue-welt-erschaffen').click();
  await expect(page.getByTestId('ui-charakter')).toBeVisible();
  await Promise.all([page.waitForEvent('load'), page.getByTestId('charakter-los').click()]);
  await inGame(page);
  await expect.poll(async () => (await call<unknown[]>(page, 'saves')).length, { timeout: 60_000 }).toBe(1);
  const [world] = await call<Array<{ id: string }>>(page, 'saves');
  const id = world?.id ?? '';

  // State A, time frozen: the first autosave (auto-1) holds exactly this state.
  await freeze(page, true);
  await call(page, 'autosave', 'auto');
  const a = await call<StateHash>(page, 'stateHash');
  // The world runs on; state B in the second autosave (auto-2).
  await freeze(page, false);
  await expect.poll(() => tick(page), { timeout: 60_000 }).toBeGreaterThan(a.tick + 120);
  await freeze(page, true);
  await call(page, 'autosave', 'auto');
  const b = await call<StateHash>(page, 'stateHash');
  expect(b.tick).toBeGreaterThan(a.tick);
  expect(b.hash).not.toBe(a.hash);
  const slots = await call<Slot[]>(page, 'saveSlots', id);
  expect(slots.map((s) => s.slot).sort()).toEqual(['auto-1', 'auto-2', 'main']);

  // Back to the main menu (leaving the game may write one more autosave – newer still).
  await page.evaluate(() => sessionStorage.removeItem('duskhearth.start'));
  await page.goto(logicUrl('menue=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true, undefined, { timeout: 120_000 });
  // From the next page on, time stops as soon as the debug API stands – before the loaded world's first tick.
  await page.addInitScript(() => {
    const wait = setInterval(() => {
      const dh = (window as unknown as { __dh?: Dh }).__dh;
      if (dh === undefined) return;
      dh.freezeTime(true);
      clearInterval(wait);
    }, 1);
  });
  await page.getByTestId('menue-welten').click();
  await page.getByTestId(`welt-${id}`).click();
  // Every word of both bars fits its button – in German too.
  await expect(page.locator('.dh-welten__leiste .dh-knopf')).toHaveCount(8);
  expect(await clippedButtons(page)).toEqual([]);
  await page.getByTestId('welten-slots').click();
  // The slots of the world, newest first; the newest is marked.
  const rows = page.locator('[data-slot]');
  await expect(rows.first()).toBeVisible();
  const order = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-slot')));
  const stored = (await page.evaluate(
    async (worldId) =>
      new Promise<Array<{ slot: string; savedAt: number }>>((resolve, reject) => {
        const open = indexedDB.open('duskhearth');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('slots').objectStore('slots').index('byWorld').getAll(worldId);
          all.onsuccess = () => {
            open.result.close();
            resolve((all.result as Array<{ slot: string; savedAt: number }>).map((r) => ({ slot: r.slot, savedAt: r.savedAt })));
          };
          all.onerror = () => reject(all.error);
        };
      }),
    id,
  )) as Slot[];
  expect(order).toEqual([...stored].sort((x, y) => y.savedAt - x.savedAt).map((s) => s.slot));
  expect(order).toContain('auto-1');
  expect(order[order.length - 1]).toBe('main');
  await expect(page.getByTestId(`welten-slot-${order[0] ?? ''}`)).toContainText('(neuester)');
  await expect(page.getByTestId('welten-slot-auto-1')).not.toContainText('(neuester)');

  // The older autosave, chosen: the game boots exactly that slot.
  await Promise.all([page.waitForEvent('load'), page.getByTestId('welten-slot-auto-1').click()]);
  await inGame(page);
  expect(await request(page)).toEqual({ kind: 'load', worldId: id, slot: 'auto-1' });
  expect(await call<StateHash>(page, 'stateHash')).toEqual(a);

  // Once this session has saved, the tab resumes its newest save again.
  await call(page, 'autosave', 'auto');
  await expect.poll(() => request(page), { timeout: 30_000 }).toEqual({ kind: 'load', worldId: id });
  expect(errors).toEqual([]);
});
