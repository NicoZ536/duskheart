/**
 * M7-57 Speicherslots und Autosave (MASTERPROMPT §28; docs/SPIEL.md §25 „Speicherslots“): `main` und drei rotierende
 * Autosaves, Chunk-Diffs je Slot (kein geteilter Chunk-Store, ADR-0020), inkrementell je Slot, gepackt und komprimiert im
 * Schreiber, atomar; Integritätsprüfung und Wiederherstellung aus dem jüngsten intakten älteren Slot (Korruptions-Fixture:
 * beschädigter Snapshot, beschädigter Chunk-Datensatz, unlesbarer Slot-Datensatz); IndexedDB-Schema 2 übernimmt die
 * Chunk-Datensätze des Schemas 1 in den Slot `main`.
 *
 * Ohne Weltgenerierung: die Chunks liefert der Streaming-Prüfstand (tests/unit/world/streamFixture.ts), den Snapshot ein
 * Zähler-Teilnehmer – der Autosaver sieht davon nur `participants()`, `world.chunks`, Config, Tick und Tag.
 */
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { resolveSimConfig, type Simulation } from '../../../src/game/sim';
import type { SaveParticipant } from '../../../src/game/participant';
import { Autosaver } from '../../../src/save/autosave';
import { decodeStoredChunk, isPackedChunkRecord, packChunkDiff, unpackChunkDiff, gzip } from '../../../src/save/chunkPack';
import { encodeChunkRecord } from '../../../src/save/chunks';
import { DEFAULT_CHUNK_SLOT, type SaveStore } from '../../../src/save/store';
import { openSaveDb, SAVE_DB_VERSION } from '../../../src/save/db';
import { MemorySaveStore } from '../../../src/save/memoryStore';
import { SaveService } from '../../../src/save/saveService';
import { AUTOSAVE_SLOTS, MAIN_SLOT, nextAutosaveSlot, slotsNewestFirst } from '../../../src/save/slots';
import { readNewestIntactSave, readWorldSave } from '../../../src/save/world';
import { sharedStore, SaveWriter } from '../../../src/save/writer';
import type { ChunkData } from '../../../src/world/model/chunk';
import { chunkDiffBytes, chunkDiffHash, diffChunk } from '../../../src/world/stream/diff';
import type { ChunkManager } from '../../../src/world/stream/chunkManager';
import { fixtureGenerate, fixtureManager, settle, type FixturePlan } from '../world/streamFixture';

const WORLD = 'welt-autosave';
const CONFIG = resolveSimConfig({ seed: 7, worldSize: 'small' });
const T0 = 1_760_000_000_000;

/** A simulation as the autosaver sees it: one counter participant, the fixture chunk store, a clock. */
interface FakeSim {
  readonly sim: Simulation;
  readonly chunks: ChunkManager<FixturePlan>;
  counter: { value: number };
  tick: number;
}

function fakeSim(): FakeSim {
  const { manager } = fixtureManager();
  settle(manager, 0, 10, 10);
  const counter = { value: 0 };
  const participant: SaveParticipant = {
    id: 'zaehler',
    version: 1,
    serialize: () => ({ value: counter.value }),
    deserialize: (d) => {
      counter.value = (d as { value: number }).value;
    },
  };
  const f = { counter, tick: 0, chunks: manager } as FakeSim;
  const sim = {
    participants: () => [participant],
    world: { materialized: true, chunks: manager },
    config: CONFIG,
    get tick() {
      return f.tick;
    },
    clock: { day: 1 },
  } as unknown as Simulation;
  return Object.assign(f, { sim });
}

/** Digs a trench into chunk (cx, cy) of the store (a change the chunk diff records). */
function dig(f: FakeSim, cx: number, cy: number, value: number): void {
  f.chunks.ensure(0, cx, cy).ground.fill(value, 32, 64);
}

function saver(f: FakeSim, store: SaveStore, now: { t: number }): { autosaver: Autosaver; service: SaveService } {
  const service = new SaveService({ access: sharedStore(store) });
  const autosaver = new Autosaver({ sim: f.sim, service, target: { worldId: WORLD, name: 'Autosave-Welt' }, now: () => now.t, gameVersion: 'test', intervalMinutes: () => 3 });
  return { autosaver, service };
}

/** Hashes of the chunks a slot holds, decoded (chunk key → diff hash). */
async function slotState(store: SaveStore, slot: string): Promise<Record<string, string>> {
  const save = await readWorldSave(store, WORLD, slot);
  return Object.fromEntries(save.chunkDiffs.map((d) => [`${d.layer}:${d.cx}:${d.cy}`, chunkDiffHash(d)]));
}

describe('Slots und Rotation', () => {
  it('drei rotierende Autosaves: erst die fehlenden, dann der älteste; geladen wird der jüngste', () => {
    expect(nextAutosaveSlot([])).toBe('auto-1');
    expect(nextAutosaveSlot([{ slot: 'auto-1', savedAt: 5 }])).toBe('auto-2');
    expect(nextAutosaveSlot([{ slot: 'main', savedAt: 1 }, { slot: 'auto-1', savedAt: 5 }, { slot: 'auto-2', savedAt: 6 }, { slot: 'auto-3', savedAt: 4 }])).toBe('auto-3');
    expect(nextAutosaveSlot(AUTOSAVE_SLOTS.map((slot, i) => ({ slot, savedAt: 10 - i })))).toBe('auto-3');
    expect(slotsNewestFirst([{ slot: 'auto-2', savedAt: 3 }, { slot: 'main', savedAt: 9 }, { slot: 'auto-1', savedAt: 9 }]).map((s) => s.slot)).toEqual(['main', 'auto-1', 'auto-2']);
  });

  it('Autosaves schreiben reihum, jeder Slot hält seinen eigenen Stand samt Chunk-Diffs; inkrementell je Slot', async () => {
    const f = fakeSim();
    const store = new MemorySaveStore();
    const now = { t: T0 };
    const { autosaver } = saver(f, store, now);
    const results = [];
    // Five autosaves, each after one more change: auto-1, auto-2, auto-3, then auto-1 and auto-2 again.
    for (let i = 1; i <= 5; i++) {
      f.counter.value = i;
      f.tick = i * 100;
      dig(f, 9 + i, 10, i);
      now.t += 1000;
      results.push(await autosaver.save('auto'));
    }
    expect(results.map((r) => r?.slot)).toEqual(['auto-1', 'auto-2', 'auto-3', 'auto-1', 'auto-2']);
    // Each slot writes only what it lacks: the first everything (1 chunk), the second 2 (both changes), the third 3, then
    // auto-1 the three chunks changed since its first save plus the new one minus what it had (4 − 1 = 3).
    expect(results.map((r) => r?.written)).toEqual([1, 2, 3, 3, 3]);
    expect(await store.listSlots(WORLD)).toEqual(['auto-1', 'auto-2', 'auto-3']);
    expect(await store.listChunkSlots(WORLD)).toEqual(['auto-1', 'auto-2', 'auto-3']);
    // Every slot holds its own state: auto-3 the world after the third change (3 chunks), auto-2 after the fifth (5).
    expect(Object.keys(await slotState(store, 'auto-3'))).toEqual(['0:10:10', '0:11:10', '0:12:10']);
    expect(Object.keys(await slotState(store, 'auto-2')).length).toBe(5);
    expect(((await readWorldSave(store, WORLD, 'auto-3')).snapshot as { participants: { zaehler: { data: unknown } } }).participants.zaehler.data).toEqual({ value: 3 });
    // The newest slot is the one that loads.
    const newest = await readNewestIntactSave(store, WORLD);
    expect([newest.save.slot, newest.skipped]).toEqual(['auto-2', []]);
    expect(await store.getWorld(WORLD)).toMatchObject({ id: WORLD, tick: 500, savedAt: T0 + 5000 });
    // The chunk records of the slots are packed (gzip) and decode to the world's diffs.
    const record = await store.getChunk(WORLD, '0:12:10', 'auto-3');
    expect(isPackedChunkRecord(record?.data)).toBe(true);
    const diff = diffChunk(fixtureGenerate({ seed: 7 }, 0, 12, 10), f.chunks.ensure(0, 12, 10));
    expect(chunkDiffHash(await decodeStoredChunk('0:12:10', record?.data))).toBe(chunkDiffHash(diff as NonNullable<typeof diff>));
  });

  it('main ist der Spielstand des Spielers; ein zurückgesetzter Chunk wird nur in den Slots gelöscht, die ihn halten', async () => {
    const f = fakeSim();
    const store = new MemorySaveStore();
    const now = { t: T0 };
    const { autosaver } = saver(f, store, now);
    dig(f, 10, 10, 3);
    dig(f, 11, 10, 3);
    now.t += 10;
    expect((await autosaver.save('main'))?.slot).toBe(MAIN_SLOT);
    now.t += 10;
    await autosaver.save('auto');
    // Chunk 10:10 back at its generated state.
    const generated = fixtureGenerate({ seed: 7 }, 0, 10, 10);
    f.chunks.ensure(0, 10, 10).ground.set(generated.ground);
    now.t += 10;
    const third = await autosaver.save('auto');
    expect([third?.slot, third?.written, third?.deleted]).toEqual(['auto-2', 1, 0]);
    now.t += 10;
    const main = await autosaver.save('main');
    expect([main?.written, main?.deleted]).toEqual([0, 1]);
    expect(await store.listChunkKeys(WORLD, 'main')).toEqual(['0:11:10']);
    expect(await store.listChunkKeys(WORLD, 'auto-1')).toEqual(['0:10:10', '0:11:10']);
    expect(await store.listChunkKeys(WORLD, 'auto-2')).toEqual(['0:11:10']);
  });

  it('das Intervall zählt nur gespielte Zeit; ein Autosave setzt es zurück; zwei wartende Saves derselben Art werden einer', async () => {
    const f = fakeSim();
    const store = new MemorySaveStore();
    const now = { t: T0 };
    const { autosaver } = saver(f, store, now);
    autosaver.frame(170_000, true);
    autosaver.frame(60_000, false);
    expect(autosaver.savedCount).toBe(0);
    autosaver.frame(10_000, true);
    await autosaver.settled();
    expect(autosaver.savedCount).toBe(1);
    expect(autosaver.sinceLastSave).toBe(0);
    const a = autosaver.save('main');
    const b = autosaver.save('main');
    expect(await b).toBeNull();
    expect((await a)?.slot).toBe('main');
  });
});

describe('Integrität und Wiederherstellung (Korruptions-Fixture)', () => {
  async function threeSaves(): Promise<{ store: MemorySaveStore; states: Map<string, Record<string, string>> }> {
    const f = fakeSim();
    const store = new MemorySaveStore();
    const now = { t: T0 };
    const { autosaver } = saver(f, store, now);
    const states = new Map<string, Record<string, string>>();
    for (let i = 1; i <= 3; i++) {
      f.counter.value = i;
      dig(f, 10, 10 + i, i);
      now.t += 1000;
      const r = await autosaver.save('auto');
      states.set(r?.slot ?? '', await slotState(store, r?.slot ?? ''));
    }
    return { store, states };
  }

  it('ein beschädigter Snapshot im jüngsten Autosave: der nächstältere intakte lädt, der Grund wird genannt', async () => {
    const { store, states } = await threeSaves();
    const newest = await store.getSlot(WORLD, 'auto-3');
    await store.write((b) => b.putSlot({ ...(newest as NonNullable<typeof newest>), snapshot: { format: 1, participants: { zaehler: { version: 1, data: { value: 99 } } } } }));
    const got = await readNewestIntactSave(store, WORLD);
    expect(got.save.slot).toBe('auto-2');
    expect(got.skipped.map((s) => s.slot)).toEqual(['auto-3']);
    expect(got.skipped[0]?.error).toMatch(/corrupt: hash/);
    expect(Object.fromEntries(got.save.chunkDiffs.map((d) => [`${d.layer}:${d.cx}:${d.cy}`, chunkDiffHash(d)]))).toEqual(states.get('auto-2'));
  });

  it('ein beschädigter Chunk-Datensatz (gekippte Bytes, falscher Hash) macht nur seinen Slot unbrauchbar', async () => {
    const { store } = await threeSaves();
    const rec = await store.getChunk(WORLD, '0:10:13', 'auto-3');
    const data = rec?.data as { format: string; hash: string; bytes: Uint8Array };
    const broken = new Uint8Array(data.bytes);
    const at = broken.length - 6;
    broken[at] = (broken[at] ?? 0) ^ 0xff;
    await store.write((b) => b.putChunk({ worldId: WORLD, slot: 'auto-3', key: '0:10:13', data: { ...data, bytes: broken } }));
    const first = await readNewestIntactSave(store, WORLD);
    expect([first.save.slot, first.skipped.map((s) => s.slot)]).toEqual(['auto-2', ['auto-3']]);
    expect(first.skipped[0]?.error).toMatch(/Chunk record "0:10:13" is corrupt/);
    // A hash that does not match the diff is caught as well (auto-2's newest chunk).
    const rec2 = await store.getChunk(WORLD, '0:10:12', 'auto-2');
    await store.write((b) => b.putChunk({ worldId: WORLD, slot: 'auto-2', key: '0:10:12', data: { ...(rec2?.data as object), hash: '0000000000000000' } }));
    const second = await readNewestIntactSave(store, WORLD);
    expect([second.save.slot, second.skipped.map((s) => s.slot)]).toEqual(['auto-1', ['auto-3', 'auto-2']]);
  });

  it('kein intakter Slot: der Fehler nennt jeden Slot und seinen Grund', async () => {
    const { store } = await threeSaves();
    for (const slot of AUTOSAVE_SLOTS) {
      const r = await store.getSlot(WORLD, slot);
      await store.write((b) => b.putSlot({ ...(r as NonNullable<typeof r>), hash: 'ffffffffffffffff' }));
    }
    await expect(readNewestIntactSave(store, WORLD)).rejects.toThrow(/no intact save: auto-3: .*auto-2: .*auto-1: /);
    await expect(readNewestIntactSave(store, 'fehlt')).rejects.toThrow(/does not exist/);
  });

  it('ein Schreiber, dessen Transaktion scheitert, verliert nichts: der nächste Save schreibt den Slot vollständig', async () => {
    const f = fakeSim();
    const store = new MemorySaveStore();
    let fail = true;
    const failing: SaveStore = Object.create(store) as SaveStore;
    failing.write = (build) => (fail ? Promise.reject(new Error('Speicher voll')) : store.write(build));
    const writer = new SaveWriter(sharedStore(failing));
    const service = { write: (r: Parameters<SaveWriter['write']>[0]) => writer.write(r), takeLost: () => false };
    const errors: string[] = [];
    const autosaver = new Autosaver({ sim: f.sim, service, target: { worldId: WORLD, name: 'W' }, now: () => T0, gameVersion: 'test', intervalMinutes: () => 3, onError: (e) => errors.push(e.message) });
    dig(f, 10, 10, 1);
    expect(await autosaver.save('main')).toBeNull();
    expect(errors[0]).toMatch(/Speicher voll/);
    fail = false;
    dig(f, 11, 10, 1);
    const ok = await autosaver.save('main');
    expect(ok?.written).toBe(2);
    expect(Object.keys(await slotState(store, 'main'))).toEqual(['0:10:10', '0:11:10']);
  });
});

describe('Kompression und Datenbankschema', () => {
  it('gepackte Diffs: bitgleich zurück, kleiner als die rohen Felder, beschädigte Puffer abgelehnt', async () => {
    const base = fixtureGenerate({ seed: 7 }, 0, 4, 4);
    const cur: ChunkData = base.clone();
    cur.ground.fill(9, 0, 600);
    cur.object[17] = 3;
    cur.setObjectState(40, 2, 0.5, 900);
    const diff = diffChunk(base, cur);
    if (diff === null) throw new Error('no diff');
    const packed = packChunkDiff(diff);
    expect(chunkDiffHash(unpackChunkDiff(packed))).toBe(chunkDiffHash(diff));
    const gz = await gzip(packed);
    expect(gz.byteLength).toBeLessThan(chunkDiffBytes(diff));
    expect(() => unpackChunkDiff(packed.subarray(0, packed.length - 3))).toThrow(/truncated/);
    const wrongMagic = new Uint8Array(packed);
    wrongMagic[0] = 0;
    expect(() => unpackChunkDiff(wrongMagic)).toThrow(/magic/);
    // Plain records (saves before M7, the tools' saveWorld) decode through the same reader.
    expect(chunkDiffHash(await decodeStoredChunk('0:4:4', encodeChunkRecord(diff)))).toBe(chunkDiffHash(diff));
  });

  it('IndexedDB-Schema 2: die Chunk-Datensätze von Schema 1 wandern beim Öffnen in den Slot main', async () => {
    const factory = new IDBFactory();
    // A database of schema 1 with one chunk record of the old shape.
    await new Promise<void>((resolve, reject) => {
      const req = factory.open('alt', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('worlds', { keyPath: 'id' });
        db.createObjectStore('slots', { keyPath: ['worldId', 'slot'] }).createIndex('byWorld', 'worldId');
        db.createObjectStore('chunks', { keyPath: ['worldId', 'key'] }).createIndex('byWorld', 'worldId');
        db.createObjectStore('blobs', { keyPath: ['worldId', 'name'] }).createIndex('byWorld', 'worldId');
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('chunks', 'readwrite');
        tx.objectStore('chunks').put({ worldId: 'w', key: '0:1:2', data: { n: 7 } });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error ?? new Error('write failed'));
      };
      req.onerror = () => reject(req.error ?? new Error('open failed'));
    });
    const store = await openSaveDb(factory, 'alt');
    try {
      expect(store.version).toBe(SAVE_DB_VERSION);
      expect(SAVE_DB_VERSION).toBe(2);
      expect(await store.listChunkKeys('w')).toEqual(['0:1:2']);
      expect(await store.listChunkSlots('w')).toEqual([DEFAULT_CHUNK_SLOT]);
      expect(await store.getChunk('w', '0:1:2')).toEqual({ worldId: 'w', slot: 'main', key: '0:1:2', data: { n: 7 } });
      await store.write((b) => {
        b.putChunk({ worldId: 'w', slot: 'auto-1', key: '0:1:2', data: 1 });
        b.putChunk({ worldId: 'w', slot: 'auto-1', key: '0:3:3', data: 2 });
      });
      expect(await store.listChunkKeys('w', 'auto-1')).toEqual(['0:1:2', '0:3:3']);
      await store.write((b) => b.deleteSlotChunks('w', 'auto-1'));
      expect(await store.listChunkSlots('w')).toEqual(['main']);
    } finally {
      store.close();
    }
  });
});
