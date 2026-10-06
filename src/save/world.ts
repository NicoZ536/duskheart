/**
 * Saving and loading whole simulations (MASTERPROMPT §28, M2-27): builds the save registry of a
 * simulation, writes world meta, world record, changed chunks and the snapshot atomically into a
 * `SaveStore`, and restores a fresh simulation from it with integrity check (stored hash),
 * migrations and the stored chunk diffs.
 * Saving happens between two ticks; queued commands are not saved (docs/ARCHITEKTUR.md "Datenfluss").
 *
 * The world itself is not saved: it is rebuilt from seed and size (docs/WORLD.md §2). Only chunks
 * that differ from their generated state are written, as diffs (src/save/chunks.ts); the zone's
 * frozen ticks, weather and calendar travel in the snapshot (participants `world-chunks`,
 * `weather-regions`, `calendar`).
 *
 * Slots (M7-57, src/save/slots.ts): every slot has its own chunk records and names the world record they are written in
 * (`SlotRecord.world`). `readWorldSave` reads one slot; `readNewestIntactSave` the newest slot that passes the integrity
 * check, skipping damaged ones (recovery from an older autosave). The game writes through the save writer
 * (src/save/writer.ts, in the save worker); `saveWorld` here is the in-thread path of tools and tests (plain records).
 */
import { stableHash64 } from '../game/canonical';
import { createSimulation, type SimulationOptions } from '../game/setup';
import { resolveSimConfig, type SimConfig, type Simulation } from '../game/sim';
import { WORLD_GEN_VERSION } from '../world/gen/world';
import { contentWorldIdTables } from '../world/model/runtimeIds';
import type { ChunkDiff } from '../world/stream/diff';
import { loadChunkWorld, saveChunkWorld, type ChunkChangeSource } from './chunks';
import { SaveError, SaveRegistry, type SaveSnapshot } from './registry';
import { MAIN_SLOT, slotsNewestFirst } from './slots';
import { parseStored, type SaveStore, type SlotRecord, type WorldMeta } from './store';
import { worldRecordSchema, type WorldRecord } from './worldMeta';

export { MAIN_SLOT } from './slots';

/** Registry over every save participant of `sim`, in restore order. */
export function simulationRegistry(sim: Simulation): SaveRegistry {
  return new SaveRegistry().registerAll(sim.participants());
}

/** Snapshot of a simulation plus its integrity hash. */
export interface CapturedSimulation {
  readonly config: SimConfig;
  readonly snapshot: SaveSnapshot;
  readonly hash: string;
}

/** Serializes the complete simulation state (the chunk diffs are saved separately, `saveWorld`). */
export function captureSimulation(sim: Simulation): CapturedSimulation {
  const snapshot = simulationRegistry(sim).serializeAll();
  return { config: sim.config, snapshot, hash: stableHash64(snapshot) };
}

/** Options of `restoreSimulation`: how the simulation gets its world, plus the stored chunk diffs. */
export interface RestoreOptions extends SimulationOptions {
  /** Diffs of the changed chunks (from the chunk store, remapped to the current runtime ids). */
  readonly chunkDiffs?: readonly ChunkDiff[];
}

/**
 * Creates a fresh simulation for `config`, hands it the stored chunk diffs and restores `snapshot`
 * into it (migrating old data).
 */
export function restoreSimulation(config: SimConfig, snapshot: unknown, options: RestoreOptions = {}): Simulation {
  const sim = createSimulation(resolveSimConfig(config), options);
  restoreInto(sim, snapshot, options.chunkDiffs ?? []);
  return sim;
}

/**
 * Hands the stored chunk diffs to a simulation that has not run yet and restores `snapshot` into it (migrating old
 * data). The browser boots a session from a save this way once the world worker handed the world over
 * (`SimWorld.provide`), so the world is never generated on the main thread.
 */
export function restoreInto(sim: Simulation, snapshot: unknown, chunkDiffs: readonly ChunkDiff[]): void {
  if (chunkDiffs.length > 0) sim.world.chunks.loadStored(chunkDiffs);
  simulationRegistry(sim).deserializeAll(snapshot);
  // The chunks that were active at the save are active again before the first tick, so its commands (a trap set, a spawn)
  // find the zone the uninterrupted run left – not a frozen world the zone update of that tick only wakes after them
  // (ActiveZone.resumeSaved, docs/ARCHITEKTUR.md "Aktive Zone").
  if (sim.world.materialized) sim.world.zone.resumeSaved();
}

/** Chunk changes of a simulation whose world was never materialised: none. */
const NO_CHUNK_CHANGES: ChunkChangeSource = {
  collectChanges: () => ({ writes: [] }),
  markSaved: () => undefined,
  forgetStorage: () => undefined,
};

/** Options of `saveWorld`. */
export interface SaveWorldOptions {
  readonly worldId: string;
  /** World name shown in the menu. */
  readonly name: string;
  /** Wall-clock time of the save in epoch milliseconds (supplied by the caller). */
  readonly now: number;
  /** Build that writes the save (`__DH_VERSION__`; supplied by the caller like the time). */
  readonly gameVersion: string;
  /** Target slot (default `main`). */
  readonly slot?: string;
}

/**
 * Writes world meta, world record, the changed chunks and the simulation snapshot in one
 * transaction (only chunks whose content differs from the store are written). Returns the stored meta.
 */
export async function saveWorld(store: SaveStore, sim: Simulation, options: SaveWorldOptions): Promise<WorldMeta> {
  const { worldId, name, now, gameVersion } = options;
  const slot = options.slot ?? MAIN_SLOT;
  const captured = captureSimulation(sim);
  const report = await saveChunkWorld(store, {
    worldId,
    name,
    config: sim.config,
    tick: sim.tick,
    day: sim.clock.day,
    now,
    gameVersion,
    generatorVersion: WORLD_GEN_VERSION,
    tables: contentWorldIdTables(),
    // A world that was never materialised has no chunk changes (and needs no generation to say so).
    chunks: sim.world.materialized ? sim.world.chunks : NO_CHUNK_CHANGES,
    // The slot names the world record its chunk records are written in (M7-57).
    extra: (b, world) => b.putSlot({ worldId, slot, savedAt: now, hash: captured.hash, snapshot: captured.snapshot, world: world.record }),
  });
  return report.world.meta;
}

/**
 * Loads a world slot into a fresh simulation, with the stored chunk diffs. Throws `SaveError` if the
 * world or slot is missing, corrupt or incompatible (newer build, removed content).
 */
export async function loadWorld(store: SaveStore, worldId: string, slot: string = MAIN_SLOT, options: SimulationOptions = {}): Promise<Simulation> {
  const save = await readWorldSave(store, worldId, slot);
  return restoreSimulation(save.meta.config, save.snapshot, { ...options, chunkDiffs: save.chunkDiffs });
}

/** A world slot read from a store and checked: world meta, the slot's snapshot, the stored chunk diffs (current ids). */
export interface StoredWorldSave {
  readonly meta: WorldMeta;
  readonly snapshot: unknown;
  readonly chunkDiffs: readonly ChunkDiff[];
  /** The slot it was read from. */
  readonly slot: string;
  /** When that slot was saved [epoch ms]. */
  readonly savedAt: number;
  /** The world record its chunk records are written in (absent: a save before chunk worlds). */
  readonly record?: WorldRecord;
}

/** The world record a slot names (`SlotRecord.world`), checked; undefined for slots before M7. Throws `SaveError`. */
function slotWorldRecord(worldId: string, slot: SlotRecord): WorldRecord | undefined {
  if (slot.world === undefined) return undefined;
  try {
    return parseStored(worldRecordSchema, slot.world, `world record of "${worldId}/${slot.slot}"`);
  } catch (err) {
    throw new SaveError((err as Error).message);
  }
}

/**
 * Reads a world slot with its chunk diffs (remapped to the current runtime ids) without restoring it (`loadWorld`
 * restores into a fresh simulation, `restoreInto` into one that has not run yet). Throws `SaveError` if the world or
 * slot is missing, corrupt (snapshot hash, any chunk record) or incompatible (newer build, removed content).
 */
export async function readWorldSave(store: SaveStore, worldId: string, slot: string = MAIN_SLOT): Promise<StoredWorldSave> {
  const meta = await store.getWorld(worldId);
  if (meta === undefined) throw new SaveError(`World "${worldId}" does not exist`);
  const record = await store.getSlot(worldId, slot);
  if (record === undefined) throw new SaveError(`World "${worldId}" has no save in slot "${slot}"`);
  const actual = stableHash64(record.snapshot);
  if (actual !== record.hash) throw new SaveError(`Save "${worldId}/${slot}" is corrupt: hash ${actual} ≠ stored ${record.hash}`);
  const own = slotWorldRecord(worldId, record);
  const chunkWorld = await loadChunkWorld(store, worldId, { tables: contentWorldIdTables(), generatorVersion: WORLD_GEN_VERSION }, { slot, ...(own === undefined ? {} : { record: own }) });
  return { meta, snapshot: record.snapshot, chunkDiffs: chunkWorld.diffs, slot, savedAt: record.savedAt, ...(chunkWorld.record === undefined ? {} : { record: chunkWorld.record }) };
}

/** A slot loading skipped, and why. */
export interface SkippedSlot {
  readonly slot: string;
  readonly savedAt: number;
  readonly error: string;
}

/** The newest intact slot of a world, and the newer slots that failed their check (newest first). */
export interface RecoveredWorldSave {
  readonly save: StoredWorldSave;
  readonly skipped: readonly SkippedSlot[];
}

/**
 * Reads the newest slot of a world that passes the integrity check (§28 "Wiederherstellung aus älterem Autosave bei
 * Korruption"): slots newest first (`slotsNewestFirst`); a slot whose record or chunk records fail is skipped for the next
 * older one and reported in `skipped`. A slot record that cannot even be parsed counts as damaged. Throws `SaveError` when
 * the world is missing or no slot is intact (naming every slot's reason).
 */
export async function readNewestIntactSave(store: SaveStore, worldId: string): Promise<RecoveredWorldSave> {
  const meta = await store.getWorld(worldId);
  if (meta === undefined) throw new SaveError(`World "${worldId}" does not exist`);
  const stamps: Array<{ slot: string; savedAt: number }> = [];
  const unreadable: SkippedSlot[] = [];
  for (const slot of await store.listSlots(worldId)) {
    try {
      const r = await store.getSlot(worldId, slot);
      if (r !== undefined) stamps.push({ slot, savedAt: r.savedAt });
    } catch (err) {
      unreadable.push({ slot, savedAt: 0, error: (err as Error).message });
    }
  }
  const skipped: SkippedSlot[] = [];
  for (const stamp of slotsNewestFirst(stamps)) {
    try {
      return { save: await readWorldSave(store, worldId, stamp.slot), skipped: [...skipped, ...unreadable] };
    } catch (err) {
      if (!(err instanceof SaveError)) throw err;
      skipped.push({ slot: stamp.slot, savedAt: stamp.savedAt, error: err.message });
    }
  }
  const all = [...skipped, ...unreadable];
  throw new SaveError(all.length === 0 ? `World "${worldId}" has no save` : `World "${worldId}" has no intact save: ${all.map((s) => `${s.slot}: ${s.error}`).join('; ')}`);
}
