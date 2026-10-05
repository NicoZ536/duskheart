/**
 * World plans and generated worlds by (seed, size) for the simulations of this thread
 * (docs/ARCHITEKTUR.md "Simulation").
 *
 * Plan and world are pure functions of seed, size and the generator versions (docs/WORLD.md §2) and
 * are never written to after generation, so simulations of the same world share one instance:
 * loading a save of the running world, restoring a snapshot or comparing two runs does not generate
 * the world again (Mittel ≈ 0,5–1 s, docs/ARCHITEKTUR.md "Dauer Mittel"). A simulation whose weather
 * needed only the plan hands that plan to the world generation later (`generateWorld(…, basePlan)`),
 * so nothing is built twice. The cache only saves time; which instance a simulation gets never
 * changes its state or `hashState()`.
 *
 * Worlds are kept by memory, not by count (M6-93): together at most `WORLD_BUDGET_BYTES` – as much as
 * two Groß worlds, the running world plus one more –, so of smaller worlds correspondingly more stay
 * (Klein: eight) and a thread that alternates between a few small worlds (a save of another world,
 * comparison runs) does not generate them again. The most recently used world always stays.
 *
 * The same holds one level down for the chunks of a world (`simChunkGenerator`, M6-93): the chunk store
 * of every simulation in this thread generates through one memory of the last `CHUNKS_PER_WORLD`
 * chunks per world object, so a second simulation of a cached world (the save loaded into it, the
 * restored snapshot, the second run) copies the chunks around its player instead of generating them
 * again (≈ 2–8 ms per surface chunk, 25 for an active zone).
 */
import type { WorldSizePreset } from '../content/balance';
import { generateWorldPlan, PLAN_VERSION, type WorldPlan } from '../world/gen/plan/index';
import { generateChunk } from '../world/gen/chunk';
import { generateWorld, WORLD_GEN_VERSION, type GeneratedWorld } from '../world/gen/world';
import { memoizeChunkGenerator } from '../world/stream/chunkMemo';
import type { ChunkGenerateFn } from '../world/stream/worker';

/**
 * Plans kept [plans]: the running world's plus one more (a save of another world being loaded, or the
 * second world of a comparison).
 */
const PLAN_CAPACITY = 2;
/**
 * Typed-array bytes the cached worlds may hold together [bytes] (the bulk of a world description: plan
 * fields and underground layers; docs/ARCHITEKTUR.md "Dauer Mittel"): two Groß worlds (≈ 2,6 MiB each)
 * – what the cache held before by count –, four Mittel (≈ 1,45 MiB) or eight Klein worlds (≈ 0,7 MiB).
 * More would only cost heap (§30). 6 MiB.
 */
const WORLD_BUDGET_BYTES = 6_291_456;
/**
 * Generated chunks kept per world object [chunks]: the active zone (5 × 5) of a simulation and the
 * chunks it walked through or streamed lately – ≈ 0,5 MiB tile data per world (8 KiB each).
 */
const CHUNKS_PER_WORLD = 64;

/** Most recently used first. */
const worlds: GeneratedWorld[] = [];
/** Plans as `generateWorldPlan` returns them (not the extended `GeneratedWorld.plan`), most recently used first. */
const plans: WorldPlan[] = [];
/** Typed-array bytes per cached world object (`typedArrayBytes`, measured once per world). */
const worldBytes = new WeakMap<GeneratedWorld, number>();

/** Moves `item` to the front of `list` (replacing the entry of the same seed and size). */
function touch<T extends { readonly seed: number; readonly preset: WorldSizePreset }>(list: T[], item: T): void {
  const at = list.findIndex((x) => x.seed === item.seed && x.preset === item.preset);
  if (at >= 0) list.splice(at, 1);
  list.unshift(item);
}

/** Bytes of every typed array reachable from `value` (each counted once). */
function typedArrayBytes(value: unknown): number {
  const seen = new Set<object>();
  const pending: unknown[] = [value];
  let bytes = 0;
  while (pending.length > 0) {
    const v = pending.pop();
    if (v === null || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    if (ArrayBuffer.isView(v)) bytes += v.byteLength;
    else if (v instanceof Map) for (const [k, x] of v) pending.push(k, x);
    else if (v instanceof Set) for (const x of v) pending.push(x);
    else for (const x of Object.values(v)) pending.push(x);
  }
  return bytes;
}

function bytesOf(world: GeneratedWorld): number {
  let bytes = worldBytes.get(world);
  if (bytes === undefined) {
    bytes = typedArrayBytes(world);
    worldBytes.set(world, bytes);
  }
  return bytes;
}

/** Keeps `world` as the most recently used world (evicting the least recently used ones beyond the budget). */
export function rememberWorld(world: GeneratedWorld): void {
  if (world.version !== WORLD_GEN_VERSION) throw new RangeError(`rememberWorld: generator version ${world.version} ≠ ${WORLD_GEN_VERSION}`);
  touch(worlds, world);
  let total = 0;
  for (let i = 0; i < worlds.length; i++) {
    total += bytesOf(worlds[i] as GeneratedWorld);
    if (i > 0 && total > WORLD_BUDGET_BYTES) {
      worlds.length = i;
      break;
    }
  }
}

/** The cached world of (seed, size), if any. */
export function cachedWorld(seed: number, preset: WorldSizePreset): GeneratedWorld | undefined {
  return worlds.find((w) => w.seed === seed && w.preset === preset);
}

/** The world plan of (seed, size): cached, or generated in this thread and cached. */
export function planFor(seed: number, preset: WorldSizePreset): WorldPlan {
  const plan = plans.find((p) => p.seed === seed && p.preset === preset && p.version === PLAN_VERSION) ?? generateWorldPlan(seed, preset);
  touch(plans, plan);
  plans.length = Math.min(plans.length, PLAN_CAPACITY);
  return plan;
}

/** The generated world of (seed, size): cached, or generated in this thread (from a cached plan if there is one) and cached. */
export function worldFor(seed: number, preset: WorldSizePreset): GeneratedWorld {
  const world = cachedWorld(seed, preset) ?? generateWorld(seed, preset, undefined, plans.find((p) => p.seed === seed && p.preset === preset && p.version === PLAN_VERSION));
  rememberWorld(world);
  return world;
}

/**
 * `generateChunk` for the chunk stores of the simulations in this thread: the last `CHUNKS_PER_WORLD`
 * chunks of each world object are handed out again (`memoizeChunkGenerator`; only `loadChunk`, which
 * copies, receives them).
 */
export const simChunkGenerator: ChunkGenerateFn<GeneratedWorld> = memoizeChunkGenerator(generateChunk, CHUNKS_PER_WORLD);
