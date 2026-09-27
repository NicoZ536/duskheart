/**
 * Debug loading of a save and the room query (src/debug/saveLoad.ts, src/debug/roomQuery.ts; M4-30, M4-31): the load
 * request comes only from a debug URL; `loadSave` checks the slot and reloads the page with it; `saves`, `exportSave`
 * and `stateHash` read the save database and the running session; `room` describes a room without changing anything.
 */
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { describeRoom } from '../../../src/debug/roomQuery';
import { debugLoadRequest, debugLoadUrl, readDebugLoad, saveExtensions } from '../../../src/debug/saveLoad';
import { GameSession } from '../../../src/game/session';
import { openSaveDb } from '../../../src/save/db';
import { parseWorldDumpText } from '../../../src/save/dump';
import { SaveError } from '../../../src/save/registry';
import { MAIN_SLOT, saveWorld } from '../../../src/save/world';
import { bauWelt, hut } from '../game/bau-testwelt';
import { meadow } from '../game/spieler-testwelt';

const BUILD = '0.1.0';

/** A session with a small world, saved as `welt-a` (older) and `welt-b` (newer) into a fresh save database. */
async function saved(): Promise<{ idb: IDBFactory; session: GameSession }> {
  const idb = new IDBFactory();
  const session = new GameSession({ config: { seed: 7, worldSize: 'small' } });
  session.step();
  const store = await openSaveDb(idb);
  await saveWorld(store, session.sim, { worldId: 'welt-a', name: 'A', now: 1000, gameVersion: BUILD });
  session.step();
  await saveWorld(store, session.sim, { worldId: 'welt-b', name: 'B', now: 2000, gameVersion: BUILD });
  store.close();
  return { idb, session };
}

/** The extensions as `__dh.call` calls them (untyped arguments). */
function extensions(deps: Parameters<typeof saveExtensions>[0]): Record<string, (...args: unknown[]) => unknown> {
  return saveExtensions(deps) as Record<string, (...args: unknown[]) => unknown>;
}

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('Laden eines Spielstands im Debug-Modus', () => {
  it('nur eine Debug-Adresse fordert ein Laden an; die Ladeadresse behält die übrigen Parameter', () => {
    expect(debugLoadRequest('http://h/?debug=1&laden=welt-7')).toBe('welt-7');
    expect(debugLoadRequest('http://h/?debug=true&spieler=1&laden=welt-7')).toBe('welt-7');
    expect(debugLoadRequest('http://h/?laden=welt-7')).toBeNull();
    expect(debugLoadRequest('http://h/?debug=1&laden=')).toBeNull();
    expect(debugLoadRequest('http://h/?debug=1')).toBeNull();
    const url = new URL(debugLoadUrl('http://h/spiel?spieler=1&seed=5', 'welt 5'));
    expect(url.pathname).toBe('/spiel');
    expect(Object.fromEntries(url.searchParams)).toEqual({ spieler: '1', seed: '5', debug: '1', laden: 'welt 5' });
    expect(debugLoadRequest(url.href)).toBe('welt 5');
  });

  it('saves, exportSave, stateHash lesen; loadSave prüft den Slot und lädt die Seite danach mit ihm neu', async () => {
    const { idb, session } = await saved();
    const went: string[] = [];
    const ext = extensions({ session, indexedDB: idb, loadedWorld: null, href: () => 'http://h/?debug=1&spieler=1', navigate: (url) => went.push(url) });
    expect(await ext['saves']?.()).toEqual([
      { id: 'welt-b', name: 'B', seed: 7, tick: 2, day: 1 },
      { id: 'welt-a', name: 'A', seed: 7, tick: 1, day: 1 },
    ]);
    const newest = parseWorldDumpText((await ext['exportSave']?.()) as string);
    expect(newest.world.id).toBe('welt-b');
    expect(newest.slots.map((s) => s.slot)).toEqual([MAIN_SLOT]);
    expect(parseWorldDumpText((await ext['exportSave']?.('welt-a')) as string).world.tick).toBe(1);
    expect(ext['stateHash']?.()).toEqual({ tick: session.sim.tick, hash: session.sim.hashState() });
    expect(ext['loadedSave']?.()).toBeNull();

    expect(await ext['loadSave']?.()).toBe('welt-b');
    // The page leaves only after the caller had its answer.
    expect(went).toEqual([]);
    await macrotask();
    expect(went).toEqual(['http://h/?debug=1&spieler=1&laden=welt-b']);
    await expect(ext['loadSave']?.('fehlt') as Promise<unknown>).rejects.toThrow(SaveError);
    await expect(ext['loadSave']?.(3) as Promise<unknown>).rejects.toThrow(TypeError);
    await macrotask();
    expect(went).toHaveLength(1);
    expect(extensions({ session, indexedDB: idb, loadedWorld: 'welt-b', href: () => '', navigate: () => undefined })['loadedSave']?.()).toBe('welt-b');
  });

  it('readDebugLoad liest Weltmeta, Snapshot und Chunk-Diffs; ohne Spielstand scheitert es', async () => {
    const { idb } = await saved();
    const save = await readDebugLoad(idb, 'welt-a');
    expect(save.meta).toMatchObject({ id: 'welt-a', seed: 7, tick: 1 });
    expect(save.snapshot).toMatchObject({ participants: expect.any(Object) });
    await expect(readDebugLoad(idb, 'fehlt')).rejects.toThrow(/does not exist/);
    const empty = new IDBFactory();
    await expect(extensions({ session: new GameSession({ config: { seed: 1, worldSize: 'small' } }), indexedDB: empty, loadedWorld: null, href: () => '', navigate: () => undefined })['exportSave']?.() as Promise<unknown>).rejects.toThrow(
      'Es gibt keine gespeicherte Welt.',
    );
  });
});

describe('Raumabfrage', () => {
  it('beschreibt den Raum an einer Kachel und um den Spieler; draußen und auf Wänden null; ändert den Zustand nicht', () => {
    const w = bauWelt(meadow(24, 24));
    w.env.air = 5;
    w.spawn(10, 10);
    hut(w, 9, 9, 11, 11);
    const at = w.tile(10, 10);
    const hash = w.sim.hashState();
    const room = describeRoom(w.sim, at.tx, at.ty);
    expect(room).toMatchObject({ layer: 0, interior: true, size: 9, roofed: 9, type: null, outsideC: 5, sourcesC: 0, lights: 0 });
    expect(room?.temperatureC).toBeGreaterThan(5);
    expect(room?.insulation).toBeGreaterThan(0);
    expect(describeRoom(w.sim)).toEqual(room);
    expect(describeRoom(w.sim, at.tx, at.ty, 0)).toEqual(room);
    const wall = w.tile(8, 10);
    expect(describeRoom(w.sim, wall.tx, wall.ty)).toBeNull();
    const out = w.tile(2, 2);
    expect(describeRoom(w.sim, out.tx, out.ty)).toBeNull();
    expect(w.sim.hashState()).toBe(hash);
    expect(() => describeRoom(w.sim, 1.5, 2)).toThrow(TypeError);
    expect(() => describeRoom(w.sim, 1, 2, 5)).toThrow(TypeError);
  });
});
