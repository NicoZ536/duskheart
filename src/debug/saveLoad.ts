/**
 * Saves in the browser for debugging and E2E tests (MASTERPROMPT §28, §31.6). Loading went into the regular boot with the
 * main menu (M7-50, src/ui/menu/start.ts `bootArt`): a page with `?debug=1&laden=<worldId>` boots that world like the world
 * selection does – its newest intact slot (`readWorldForBoot`, src/save/world.ts `readNewestIntactSave`) – but starts
 * with time frozen at the save's tick:
 *
 * - `__dh.call('loadSave', worldId?)` reloads the page with `?debug=1&laden=<worldId>` (without an id: the world saved
 *   last). The boot reads the save before it creates the session, starts the session with the saved world config and
 *   restores the save into its simulation as soon as the world worker hands the world over (`restoreInto`: before the
 *   first tick and before any chunk is resident, so the world is never generated on the main thread). The player is
 *   the saved one (no `player.spawn`), and time starts frozen: tests read the loaded state at the tick of the save,
 *   `__dh.freezeTime(false)` lets it run.
 * - Read-only helpers: `stateHash` (tick and `Simulation.hashState()` of the running session), `saves` (the stored
 *   worlds, newest first), `saveSlots` (a world's slots with their time and hash), `exportSave` (a world's dump as text,
 *   src/save/dump.ts – the same records a fixture holds), `loadedSave` (the world this page booted from, or null).
 * - The page's saver and frame clock (M7-55, M7-57; `setDebugPageHooks`): `autosave` (its counts and the main thread's
 *   share of the last save, `autosave('auto' | 'main')` saves now), `frameLimit` (animation frames and the frames the loop
 *   ran under the FPS limit).
 */
import type { GameSession } from '../game/session';
import { openSaveDb } from '../save/db';
import { exportWorld, worldDumpText } from '../save/dump';
import type { SaveStore } from '../save/store';
import { readNewestIntactSave, type RecoveredWorldSave, type StoredWorldSave } from '../save/world';
import { isDebugEnabled, type DebugExtension } from './api';

/** URL parameter of a debug load: `?debug=1&laden=<worldId>` boots the session from that world's main slot. */
export const DEBUG_LOAD_PARAM = 'laden';

/** The world a page asks to boot from (`?debug=1&laden=<worldId>`), or null. Only the URL counts: the settings are not read yet. */
export function debugLoadRequest(url: string): string | null {
  if (!isDebugEnabled(url, false)) return null;
  let params: URLSearchParams;
  try {
    params = new URL(url, 'http://localhost/').searchParams;
  } catch {
    return null;
  }
  const id = params.get(DEBUG_LOAD_PARAM);
  return id === null || id === '' ? null : id;
}

/** `href` with debug mode on and the load parameter set to `worldId` (the other parameters stay). */
export function debugLoadUrl(href: string, worldId: string): string {
  const url = new URL(href);
  url.searchParams.set('debug', '1');
  url.searchParams.set(DEBUG_LOAD_PARAM, worldId);
  return url.href;
}

/**
 * Reads the world `worldId` to boot from: its newest intact slot with the chunk diffs, and the newer slots that failed
 * their check (the regular load of the world selection and of `?laden=`).
 */
export async function readWorldForBoot(idb: IDBFactory, worldId: string): Promise<RecoveredWorldSave> {
  const store = await openSaveDb(idb);
  try {
    return await readNewestIntactSave(store, worldId);
  } finally {
    store.close();
  }
}

/** The save a debug load boots from (`readWorldForBoot`'s slot). */
export async function readDebugLoad(idb: IDBFactory, worldId: string): Promise<StoredWorldSave> {
  return (await readWorldForBoot(idb, worldId)).save;
}

/** What the page's saver tells the debug tools. */
export interface DebugSaver {
  save(kind: 'main' | 'auto'): Promise<unknown>;
  readonly savedCount: number;
  readonly failedCount: number;
  /** Main-thread time of the last save's capture [ms]. */
  readonly lastCaptureMs: number;
  /** Main-thread time of handing the last save to the writer [ms] (the structured clone into the save worker). */
  readonly lastHandOffMs: number;
  /** Whether saves run in the save worker. */
  readonly inWorker: boolean;
}

/** What the page lets the debug tools reach besides the session (set by src/main.tsx before the debug tools start). */
export interface DebugPageHooks {
  readonly saver?: DebugSaver;
  readonly frameLimit?: () => { readonly animationFrames: number; readonly delivered: number };
}

let pageHooks: DebugPageHooks = {};

/** Hands the page's saver and frame clock to the debug tools. */
export function setDebugPageHooks(hooks: DebugPageHooks): void {
  pageHooks = hooks;
}

/** What the save extensions need from the page. */
export interface SaveExtensionDeps {
  readonly session: Pick<GameSession, 'sim'>;
  readonly indexedDB: IDBFactory;
  /** The world this page booted from (`debugLoadRequest`), or null. */
  readonly loadedWorld: string | null;
  readonly href: () => string;
  /** Leaves the page for `url` (the browser: `location.assign`). */
  readonly navigate: (url: string) => void;
}

/** A stored world as `saves` lists it. */
export interface DebugSavedWorld {
  readonly id: string;
  readonly name: string;
  readonly seed: number;
  readonly tick: number;
  readonly day: number;
}

/** The extensions `stateHash`, `saves`, `saveSlots`, `exportSave`, `loadSave`, `loadedSave`, `autosave` and `frameLimit` (see the module comment). */
export function saveExtensions(deps: SaveExtensionDeps): Readonly<Record<string, DebugExtension>> {
  async function withStore<T>(use: (store: SaveStore) => Promise<T>): Promise<T> {
    const store = await openSaveDb(deps.indexedDB);
    try {
      return await use(store);
    } finally {
      store.close();
    }
  }
  /** `worldId` checked, or the world saved last. */
  async function worldOf(store: SaveStore, worldId: unknown): Promise<string> {
    if (worldId !== undefined) {
      if (typeof worldId !== 'string' || worldId === '') throw new TypeError('erwartet die Id einer gespeicherten Welt');
      return worldId;
    }
    const newest = (await store.listWorlds())[0];
    if (newest === undefined) throw new Error('Es gibt keine gespeicherte Welt.');
    return newest.id;
  }
  return {
    stateHash: () => ({ tick: deps.session.sim.tick, hash: deps.session.sim.hashState() }),
    saves: () => withStore(async (store): Promise<DebugSavedWorld[]> => (await store.listWorlds()).map((w) => ({ id: w.id, name: w.name, seed: w.seed, tick: w.tick, day: w.day }))),
    exportSave: (worldId?: string) => withStore(async (store) => worldDumpText(await exportWorld(store, await worldOf(store, worldId)))),
    loadSave: (worldId?: string) =>
      withStore(async (store) => {
        const id = await worldOf(store, worldId);
        // Checked before leaving the page: a world without an intact slot is reported here, not after the reload.
        await readNewestIntactSave(store, id);
        const url = debugLoadUrl(deps.href(), id);
        // After the caller got its answer (an E2E `evaluate` would lose it to the navigation).
        setTimeout(() => deps.navigate(url), 0);
        return id;
      }),
    loadedSave: () => deps.loadedWorld,
    saveSlots: (worldId?: string) =>
      withStore(async (store) => {
        const id = await worldOf(store, worldId);
        const out: Array<{ slot: string; savedAt: number; hash: string; chunks: number }> = [];
        for (const slot of await store.listSlots(id)) {
          const r = await store.getSlot(id, slot);
          if (r !== undefined) out.push({ slot, savedAt: r.savedAt, hash: r.hash, chunks: (await store.listChunkKeys(id, slot)).length });
        }
        return out;
      }),
    autosave: async (kind?: 'main' | 'auto') => {
      const saver = pageHooks.saver;
      if (saver === undefined) throw new Error('Diese Seite speichert nicht (kein Spiel, kein Autosave).');
      if (kind !== undefined && kind !== 'main' && kind !== 'auto') throw new TypeError('autosave erwartet main oder auto');
      if (kind !== undefined) await saver.save(kind);
      return { saved: saver.savedCount, failed: saver.failedCount, lastCaptureMs: saver.lastCaptureMs, lastHandOffMs: saver.lastHandOffMs, inWorker: saver.inWorker };
    },
    frameLimit: () => {
      const stats = pageHooks.frameLimit?.();
      if (stats === undefined) throw new Error('Der Takt dieser Seite meldet keine Bildrate.');
      return { animationFrames: stats.animationFrames, delivered: stats.delivered };
    },
  };
}
