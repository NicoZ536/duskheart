/**
 * Loading a save in the browser for debugging and E2E tests (MASTERPROMPT §28, §31.6) until the title screen's world
 * selection arrives (M7-50):
 *
 * - `__dh.call('loadSave', worldId?)` reloads the page with `?debug=1&laden=<worldId>` (without an id: the world saved
 *   last). The boot (src/main.tsx) sees the parameter (`debugLoadRequest`), reads the world's main slot and chunk diffs
 *   from IndexedDB before it creates the session (`readDebugLoad`), starts the session with the saved world config and
 *   restores the save into its simulation as soon as the world worker hands the world over (`restoreInto`: before the
 *   first tick and before any chunk is resident, so the world is never generated on the main thread). The player is
 *   the saved one (no `player.spawn`), and time starts frozen: tests read the loaded state at the tick of the save,
 *   `__dh.freezeTime(false)` lets it run.
 * - Read-only helpers: `stateHash` (tick and `Simulation.hashState()` of the running session), `saves` (the stored
 *   worlds, newest first), `exportSave` (a world's dump as text, src/save/dump.ts – the same records a fixture holds),
 *   `loadedSave` (the world this page booted from, or null).
 */
import type { GameSession } from '../game/session';
import { openSaveDb } from '../save/db';
import { exportWorld, worldDumpText } from '../save/dump';
import type { SaveStore } from '../save/store';
import { readWorldSave, type StoredWorldSave } from '../save/world';
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

/** Reads the main slot of `worldId` with its chunk diffs from the save database (checked like `loadWorld`). */
export async function readDebugLoad(idb: IDBFactory, worldId: string): Promise<StoredWorldSave> {
  const store = await openSaveDb(idb);
  try {
    return await readWorldSave(store, worldId);
  } finally {
    store.close();
  }
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

/** The extensions `stateHash`, `saves`, `exportSave`, `loadSave` and `loadedSave` (see the module comment). */
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
        // Checked before leaving the page: a missing or corrupt slot is reported here, not after the reload.
        await readWorldSave(store, id);
        const url = debugLoadUrl(deps.href(), id);
        // After the caller got its answer (an E2E `evaluate` would lose it to the navigation).
        setTimeout(() => deps.navigate(url), 0);
        return id;
      }),
    loadedSave: () => deps.loadedWorld,
  };
}
