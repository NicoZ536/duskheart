/**
 * M7-58 Export/Import `.dhsave` und Seed teilen (MASTERPROMPT §28; docs/SPIEL.md §25 „Export/Import“): die Datei ist das gzip
 * des Welt-Dumps (kanonisches JSON samt Save-Version) mit genau einem Slot – dem jüngsten intakten – als `main`; der Import
 * prüft (gzip, Schema, eine Welt, Save-Version) und legt eine neue Welt neben die des Spielers; geladen ergibt sie denselben
 * Snapshot und dieselben Chunk-Diffs wie die exportierte. Dumps des Formats 1 (Fixtures v1–v3) bleiben lesbar. Seed teilen:
 * „DH-<Seed>-<Größe>“ hin und zurück. (Der Zustands-Hash einer ganzen Simulation: E2E `export-import.spec.ts`.)
 */
import { describe, expect, it } from 'vitest';
import { resolveSimConfig, type Simulation } from '../../../src/game/sim';
import type { SaveParticipant } from '../../../src/game/participant';
import { Autosaver } from '../../../src/save/autosave';
import { gzip } from '../../../src/save/chunkPack';
import { decodeDhsave, dhsaveFileName, encodeDhsave, exportDhsave, importDhsave, parseSharedSeed, shareSeedText } from '../../../src/save/dhsave';
import { parseWorldDump, WORLD_DUMP_FORMAT } from '../../../src/save/dump';
import { MemorySaveStore } from '../../../src/save/memoryStore';
import { SaveService } from '../../../src/save/saveService';
import { readNewestIntactSave } from '../../../src/save/world';
import { sharedStore } from '../../../src/save/writer';
import { chunkDiffHash } from '../../../src/world/stream/diff';
import { fixtureManager, settle } from '../world/streamFixture';

const WORLD = 'welt-export';
const CONFIG = resolveSimConfig({ seed: 4242, worldSize: 'small' });

/** A world with two autosaves and a main save (the newest autosave holds counter 3 and three dug chunks). */
async function savedWorld(): Promise<MemorySaveStore> {
  const { manager } = fixtureManager();
  settle(manager, 0, 10, 10);
  const counter = { value: 0 };
  const participant: SaveParticipant = { id: 'zaehler', version: 1, serialize: () => ({ value: counter.value }), deserialize: () => undefined };
  const sim = { participants: () => [participant], world: { materialized: true, chunks: manager }, config: CONFIG, tick: 77, clock: { day: 2 } } as unknown as Simulation;
  const store = new MemorySaveStore();
  let t = 1_000;
  const autosaver = new Autosaver({ sim, service: new SaveService({ access: sharedStore(store) }), target: { worldId: WORLD, name: 'Küste am Morgen' }, now: () => t, gameVersion: 'test', intervalMinutes: () => 3 });
  for (const [kind, n] of [['main', 1], ['auto', 2], ['auto', 3]] as const) {
    counter.value = n;
    manager.ensure(0, 10 + n, 10).ground.fill(n, 0, 40);
    t += 100;
    await autosaver.save(kind);
  }
  return store;
}

const snapshotValue = (snapshot: unknown): unknown => (snapshot as { participants: { zaehler: { data: unknown } } }).participants.zaehler.data;

describe('.dhsave Export und Import', () => {
  it('Export → Import: neue Welt, derselbe Snapshot, dieselben Chunk-Diffs; nur der jüngste intakte Slot als main', async () => {
    const store = await savedWorld();
    const out = await exportDhsave(store, WORLD);
    expect(out.fileName).toBe('kuste-am-morgen-4242.dhsave');
    expect(out.dump.format).toBe(WORLD_DUMP_FORMAT);
    expect(out.dump.slots.map((s) => s.slot)).toEqual(['main']);
    expect(new Set(out.dump.chunks.map((c) => c.slot))).toEqual(new Set(['main']));
    // gzip magic bytes.
    expect([out.bytes[0], out.bytes[1]]).toEqual([0x1f, 0x8b]);
    const target = new MemorySaveStore();
    const meta = await importDhsave(target, out.bytes, { worldId: 'welt-import', name: 'Küste (Import)' });
    expect(meta).toMatchObject({ id: 'welt-import', name: 'Küste (Import)', seed: 4242, tick: 77, day: 2 });
    const original = (await readNewestIntactSave(store, WORLD)).save;
    const imported = (await readNewestIntactSave(target, 'welt-import')).save;
    expect(original.slot).toBe('auto-2');
    expect(snapshotValue(imported.snapshot)).toEqual({ value: 3 });
    expect(imported.snapshot).toEqual(original.snapshot);
    expect(imported.chunkDiffs.map(chunkDiffHash)).toEqual(original.chunkDiffs.map(chunkDiffHash));
    expect(imported.chunkDiffs.length).toBe(3);
    // Imported into the same store beside the original: nothing of the original changes.
    await importDhsave(store, out.bytes, { worldId: 'welt-kopie', name: 'Kopie' });
    expect((await store.listWorlds()).map((w) => w.id).sort()).toEqual(['welt-export', 'welt-kopie']);
    expect((await store.listSlots(WORLD)).sort()).toEqual(['auto-1', 'auto-2', 'main']);
  });

  it('beschädigte oder fremde Dateien werden abgelehnt, ohne etwas zu schreiben', async () => {
    const store = await savedWorld();
    const { bytes, dump } = await exportDhsave(store, WORLD);
    const target = new MemorySaveStore();
    await expect(importDhsave(target, new TextEncoder().encode('kein gzip'), { worldId: 'x', name: 'x' })).rejects.toThrow(/Not a DUSKHEARTH save file/);
    const cut = bytes.subarray(0, bytes.length - 10);
    await expect(decodeDhsave(cut)).rejects.toThrow();
    await expect(decodeDhsave(await gzip(new TextEncoder().encode('{"format":2}')))).rejects.toThrow(/World dump invalid/);
    const newer = await encodeDhsave({ ...dump, saveVersion: dump.saveVersion + 1 });
    await expect(decodeDhsave(newer)).rejects.toThrow(/newer than this build/);
    expect(await target.listWorlds()).toEqual([]);
  });

  it('Dumps des Formats 1 (ohne Slots) gelten weiter: ihre Chunk-Datensätze gehören main', async () => {
    const store = await savedWorld();
    const { dump } = await exportDhsave(store, WORLD);
    const v1 = parseWorldDump({ ...dump, format: 1, chunks: dump.chunks.map(({ slot: _slot, ...c }) => c) });
    expect(v1.chunks.every((c) => c.slot === 'main')).toBe(true);
    expect(v1.chunks.map((c) => c.key)).toEqual(dump.chunks.map((c) => c.key));
  });

  it('Dateinamen ohne Sonderzeichen', () => {
    expect(dhsaveFileName({ name: 'Grünhain – Größte Welt!', seed: 7 })).toBe('grunhain-grosste-welt-7.dhsave');
    expect(dhsaveFileName({ name: '???', seed: 1 })).toBe('welt-1.dhsave');
  });
});

describe('Seed teilen', () => {
  it('„DH-<Seed>-<Größe>“ hin und zurück; eine bloße Zahl ist ein Seed; Ungültiges ist null', () => {
    expect(shareSeedText(20260923, 'medium')).toBe('DH-20260923-medium');
    expect(parseSharedSeed('DH-20260923-medium')).toEqual({ seed: 20260923, size: 'medium' });
    expect(parseSharedSeed('  dh-5-LARGE ')).toEqual({ seed: 5, size: 'large' });
    expect(parseSharedSeed('123456')).toEqual({ seed: 123456, size: null });
    expect(parseSharedSeed('DH-1-riesig')).toBeNull();
    expect(parseSharedSeed('DH-99999999999-small')).toBeNull();
    expect(parseSharedSeed('-5')).toBeNull();
    expect(parseSharedSeed('Hallo')).toBeNull();
  });
});
