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
 */
import { stableHash64 } from '../game/canonical';
import { createSimulation, type SimulationOptions } from '../game/setup';
import { resolveSimConfig, type SimConfig, type Simulation } from '../game/sim';
import { WORLD_GEN_VERSION } from '../world/gen/world';
import { contentWorldIdTables } from '../world/model/runtimeIds';
import type { ChunkDiff } from '../world/stream/diff';
import { loadChunkWorld, saveChunkWorld, type ChunkChangeSource } from './chunks';
import { SaveError, SaveRegistry, type SaveSnapshot } from './registry';
import type { SaveStore, WorldMeta } from './store';

/** Slot of the manual save of a world. */
export const MAIN_SLOT = 'main';

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
  const diffs = options.chunkDiffs ?? [];
  if (diffs.length > 0) sim.world.chunks.loadStored(diffs);
  simulationRegistry(sim).deserializeAll(snapshot);
  return sim;
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
    extra: (b) => b.putSlot({ worldId, slot, savedAt: now, hash: captured.hash, snapshot: captured.snapshot }),
  });
  return report.world.meta;
}

/**
 * Loads a world slot into a fresh simulation, with the stored chunk diffs. Throws `SaveError` if the
 * world or slot is missing, corrupt or incompatible (newer build, removed content).
 */
export async function loadWorld(store: SaveStore, worldId: string, slot: string = MAIN_SLOT, options: SimulationOptions = {}): Promise<Simulation> {
  const meta = await store.getWorld(worldId);
  if (meta === undefined) throw new SaveError(`World "${worldId}" does not exist`);
  const record = await store.getSlot(worldId, slot);
  if (record === undefined) throw new SaveError(`World "${worldId}" has no save in slot "${slot}"`);
  const actual = stableHash64(record.snapshot);
  if (actual !== record.hash) throw new SaveError(`Save "${worldId}/${slot}" is corrupt: hash ${actual} ≠ stored ${record.hash}`);
  const chunkWorld = await loadChunkWorld(store, worldId, { tables: contentWorldIdTables(), generatorVersion: WORLD_GEN_VERSION });
  return restoreSimulation(meta.config, record.snapshot, { ...options, chunkDiffs: chunkWorld.diffs });
}
