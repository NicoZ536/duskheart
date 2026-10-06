/**
 * M7-57 Speicherslots und Autosave (MASTERPROMPT §28; docs/SPIEL.md §25): eine neue Welt aus dem Hauptmenü (Neue Welt →
 * Ladebildschirm → Spiel) speichert nach ihrem ersten Tick in `main`, der Startauftrag des Tabs wird zum Laden derselben
 * Welt; Autosaves rotieren durch `auto-1 … auto-3` (der vierte überschreibt den ältesten), ein verborgener Tab speichert;
 * der Hauptthread erfasst nur den Zustand und reicht ihn an den Worker (zusammen unter 16 ms – kein Bild lang blockiert),
 * Hash, Packen, gzip und die Transaktion laufen im Speicher-Worker. Ein Neuladen setzt die Welt fort; ist ihr neuester Slot beschädigt, lädt der älteste intakte
 * und der Ladebildschirm sagt es.
 */
import { expect, test, type Page } from '@playwright/test';
import { logicUrl } from './logik';

interface Dh {
  ready: boolean;
  call(name: string, ...args: unknown[]): unknown;
  state(): { sim: { tick: number; player: unknown } };
}
interface SaveStats {
  saved: number;
  failed: number;
  lastCaptureMs: number;
  lastHandOffMs: number;
  inWorker: boolean;
}
interface Slot {
  slot: string;
  savedAt: number;
  hash: string;
  chunks: number;
}

/** §28/§30: a save must never cost the main thread a frame (60 Hz). */
const FRAME_MS = 16;

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

async function inGame(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as { __dh: Dh }).__dh.state().sim.player !== null, undefined, { timeout: 120_000 });
}

test('neue Welt aus dem Menü, Autosave-Rotation im Worker, Fortsetzen nach dem Neuladen, Wiederherstellung nach Beschädigung', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectConsole(page);
  await page.goto(logicUrl('menue=1'));
  await page.waitForFunction(() => (window as unknown as { __dh?: Dh }).__dh?.ready === true, undefined, { timeout: 120_000 });
  await page.getByTestId('menue-neue-welt').click();
  await expect(page.getByTestId('ui-neue-welt')).toBeVisible();
  await page.getByTestId('neue-welt-name').fill('Probewelt');
  await page.getByTestId('neue-welt-seed').fill('DH-24680-small');
  await expect(page.getByTestId('neue-welt-groesse-wert')).toHaveText(/^(Klein|Small)$/);
  await Promise.all([page.waitForEvent('load'), page.getByTestId('neue-welt-erschaffen').click()]);
  // The loading screen shows while the world is generated, then the game runs with the player on the beach.
  await expect(page.getByTestId('ui-laden')).toBeVisible();
  await inGame(page);
  await expect(page.getByTestId('ui-laden')).toHaveCount(0);

  // The first save comes right after the first tick; the tab's request turns into loading this world.
  await expect.poll(async () => (await call<unknown[]>(page, 'saves')).length, { timeout: 60_000 }).toBe(1);
  const [world] = await call<Array<{ id: string; name: string; seed: number }>>(page, 'saves');
  expect(world).toMatchObject({ name: 'Probewelt', seed: 24680 });
  const id = world?.id ?? '';
  const request = await page.evaluate(() => JSON.parse(sessionStorage.getItem('duskhearth.start') ?? 'null') as unknown);
  expect(request).toEqual({ kind: 'load', worldId: id });
  expect((await call<Slot[]>(page, 'saveSlots', id)).map((s) => s.slot)).toEqual(['main']);

  // Four autosaves: auto-1, auto-2, auto-3, then the oldest (auto-1) again – each in the worker, the main thread captures only.
  const before = await call<SaveStats>(page, 'autosave');
  for (let i = 0; i < 4; i++) {
    const stats = await call<SaveStats>(page, 'autosave', 'auto');
    expect(stats.inWorker).toBe(true);
    // The save's whole share of the main thread: the capture between two ticks and the hand-off (structured clone) to the worker.
    expect(stats.lastCaptureMs + stats.lastHandOffMs).toBeLessThan(FRAME_MS);
  }
  const slots = await call<Slot[]>(page, 'saveSlots', id);
  expect(slots.map((s) => s.slot)).toEqual(['auto-1', 'auto-2', 'auto-3', 'main']);
  const newest = [...slots].sort((a, b) => b.savedAt - a.savedAt)[0];
  expect(newest?.slot).toBe('auto-1');
  // Every slot holds its own chunk records (src/save/writer.ts): written from the same state, they hold the same set.
  expect(new Set(slots.map((s) => s.chunks)).size).toBe(1);
  const after = await call<SaveStats>(page, 'autosave');
  expect(after.saved - before.saved).toBe(4);
  expect(after.failed).toBe(0);

  // A hidden tab saves as well.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await call<SaveStats>(page, 'autosave')).saved, { timeout: 30_000 }).toBeGreaterThan(after.saved);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const tickBefore = await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.tick);

  // Reloading the tab resumes the world from its newest slot (no new spawn, the clock goes on).
  await page.reload();
  await inGame(page);
  expect(await call<string | null>(page, 'loadedSave')).toBeNull();
  expect(await page.evaluate(() => (window as unknown as { __dh: Dh }).__dh.state().sim.tick)).toBeGreaterThanOrEqual(tickBefore);
  await expect(page.getByTestId('laden-hinweis')).toHaveCount(0);

  // The newest slot damaged (its snapshot no longer matches its hash): the next start loads the next older one and says so.
  // Damaged from another page of the game's origin: leaving the game writes an autosave (`pagehide`), which would be newer.
  await page.goto('/manifest.webmanifest');
  const damaged = await page.evaluate(
    async (worldId) =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open('duskhearth');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('slots', 'readwrite');
          tx.onerror = () => reject(tx.error);
          const store = tx.objectStore('slots');
          // The slots of one world (index `byWorld`, src/save/db.ts).
          const all = store.index('byWorld').getAll(worldId);
          all.onsuccess = () => {
            const records = (all.result as Array<{ slot: string; savedAt: number; snapshot: { participants: Record<string, unknown> } }>).sort((a, b) => b.savedAt - a.savedAt);
            const top = records[0];
            if (top === undefined) return reject(new Error('kein Slot'));
            top.snapshot.participants['beschaedigt'] = 1;
            store.put(top);
            tx.oncomplete = () => {
              db.close();
              resolve(top.slot);
            };
          };
        };
      }),
    id,
  );
  expect(damaged).toMatch(/^(main|auto-\d)$/);
  // The tab's request still says to load the world.
  await page.goto(logicUrl('menue=1'));
  await expect(page.getByTestId('laden-hinweis')).toBeVisible({ timeout: 120_000 });
  await inGame(page);
  await expect(page.getByTestId('laden-hinweis')).toContainText(/(beschädigt|damaged)/);
  expect(errors).toEqual([]);
});
