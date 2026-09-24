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
 */
import type { WorldSizePreset } from '../content/balance';
import { generateWorldPlan, PLAN_VERSION, type WorldPlan } from '../world/gen/plan/index';
import { generateWorld, WORLD_GEN_VERSION, type GeneratedWorld } from '../world/gen/world';

/**
 * Entries kept per kind [worlds]. The running world plus one more (a save of another world being
 * loaded, or the second world of a comparison) – a Groß world holds ≈ 3,3 MB (docs/ARCHITEKTUR.md),
 * so more would only cost heap (§30).
 */
const CACHE_CAPACITY = 2;

/** Most recently used first. */
const worlds: GeneratedWorld[] = [];
/** Plans as `generateWorldPlan` returns them (not the extended `GeneratedWorld.plan`), most recently used first. */
const plans: WorldPlan[] = [];

function touch<T extends { readonly seed: number; readonly preset: WorldSizePreset }>(list: T[], item: T): void {
  const at = list.findIndex((x) => x.seed === item.seed && x.preset === item.preset);
  if (at >= 0) list.splice(at, 1);
  list.unshift(item);
  list.length = Math.min(list.length, CACHE_CAPACITY);
}

/** Keeps `world` as the most recently used world (evicting the oldest beyond the capacity). */
export function rememberWorld(world: GeneratedWorld): void {
  if (world.version !== WORLD_GEN_VERSION) throw new RangeError(`rememberWorld: generator version ${world.version} ≠ ${WORLD_GEN_VERSION}`);
  touch(worlds, world);
}

/** The cached world of (seed, size), if any. */
export function cachedWorld(seed: number, preset: WorldSizePreset): GeneratedWorld | undefined {
  return worlds.find((w) => w.seed === seed && w.preset === preset);
}

/** The world plan of (seed, size): cached, or generated in this thread and cached. */
export function planFor(seed: number, preset: WorldSizePreset): WorldPlan {
  const plan = plans.find((p) => p.seed === seed && p.preset === preset && p.version === PLAN_VERSION) ?? generateWorldPlan(seed, preset);
  touch(plans, plan);
  return plan;
}

/** The generated world of (seed, size): cached, or generated in this thread (from a cached plan if there is one) and cached. */
export function worldFor(seed: number, preset: WorldSizePreset): GeneratedWorld {
  const world = cachedWorld(seed, preset) ?? generateWorld(seed, preset, undefined, plans.find((p) => p.seed === seed && p.preset === preset && p.version === PLAN_VERSION));
  rememberWorld(world);
  return world;
}
