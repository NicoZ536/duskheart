/**
 * Saving and loading whole simulations (MASTERPROMPT §28): builds the save registry of a
 * simulation, writes world meta + snapshot atomically into a `SaveStore`, and restores a fresh
 * simulation from it with integrity check (stored hash) and migrations.
 * Saving happens between two ticks; queued commands are not saved (docs/ARCHITEKTUR.md "Datenfluss").
 */
import { stableHash64 } from '../game/canonical';
import { createSimulation } from '../game/setup';
import { resolveSimConfig, type SimConfig, type Simulation } from '../game/sim';
import { SAVE_SNAPSHOT_FORMAT, SaveError, SaveRegistry, type SaveSnapshot } from './registry';
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

/** Serializes the complete simulation state. */
export function captureSimulation(sim: Simulation): CapturedSimulation {
  const snapshot = simulationRegistry(sim).serializeAll();
  return { config: sim.config, snapshot, hash: stableHash64(snapshot) };
}

/** Creates a fresh simulation for `config` and restores `snapshot` into it (migrating old data). */
export function restoreSimulation(config: SimConfig, snapshot: unknown): Simulation {
  const sim = createSimulation(resolveSimConfig(config));
  simulationRegistry(sim).deserializeAll(snapshot);
  return sim;
}

/** Options of `saveWorld`. */
export interface SaveWorldOptions {
  readonly worldId: string;
  /** World name shown in the menu. */
  readonly name: string;
  /** Wall-clock time of the save in epoch milliseconds (supplied by the caller). */
  readonly now: number;
  /** Target slot (default `main`). */
  readonly slot?: string;
}

/** Writes world meta and the simulation snapshot in one transaction. Returns the stored meta. */
export async function saveWorld(store: SaveStore, sim: Simulation, options: SaveWorldOptions): Promise<WorldMeta> {
  const { worldId, name, now } = options;
  const slot = options.slot ?? MAIN_SLOT;
  const captured = captureSimulation(sim);
  const previous = await store.getWorld(worldId);
  const meta: WorldMeta = {
    id: worldId,
    name,
    seed: sim.config.seed,
    config: { ...sim.config },
    saveFormat: SAVE_SNAPSHOT_FORMAT,
    tick: sim.tick,
    day: sim.clock.day,
    createdAt: previous?.createdAt ?? now,
    savedAt: now,
  };
  await store.write((b) => {
    b.putWorld(meta);
    b.putSlot({ worldId, slot, savedAt: now, hash: captured.hash, snapshot: captured.snapshot });
  });
  return meta;
}

/** Loads a world slot into a fresh simulation. Throws `SaveError` if missing, corrupt or incompatible. */
export async function loadWorld(store: SaveStore, worldId: string, slot: string = MAIN_SLOT): Promise<Simulation> {
  const meta = await store.getWorld(worldId);
  if (meta === undefined) throw new SaveError(`World "${worldId}" does not exist`);
  const record = await store.getSlot(worldId, slot);
  if (record === undefined) throw new SaveError(`World "${worldId}" has no save in slot "${slot}"`);
  const actual = stableHash64(record.snapshot);
  if (actual !== record.hash) throw new SaveError(`Save "${worldId}/${slot}" is corrupt: hash ${actual} ≠ stored ${record.hash}`);
  return restoreSimulation(meta.config, record.snapshot);
}
