/**
 * Helpers of the world-generation acceptance tests (M2-12): the unit part (`tests/unit/world/
 * weltgen-validierung.test.ts`, repairs) and the slow sweeps in the integration project (`tests/
 * integration/weltgen-validierung.test.ts`, 20 Mittel seeds and the tile level; M4-37, ADR-0036).
 */
import { BLOCK_DEEP_WATER, BLOCK_HAZARD, BLOCK_OBJECT, BLOCK_SOLID, BLOCK_VOID, BLOCK_WALL, type MoverRules } from '../../../src/world/collision/tiles';
import { cellAtTile } from '../../../src/world/gen/plan/grid';
import type { WorldPlan } from '../../../src/world/gen/plan/index';
import { slotCellMask } from '../../../src/world/gen/locations';
import { roadCellMask, type RoadNetwork } from '../../../src/world/gen/roads';
import type { GeneratedWorld } from '../../../src/world/gen/world';

/** Generation of a Mittel world takes ≈ 0,4 s alone; parallel test files slow it down. */
export const WORLD_TIMEOUT_MS = 30_000;

/** Start cell of the reachability (the spawn tile on the start beach). */
export function rootCell(world: GeneratedWorld, plan: WorldPlan = world.plan): number {
  return cellAtTile(plan.grid, world.spawn.x + 0.5, world.spawn.y + 0.5);
}

/** Cells repairs must leave alone: places and roads (as the generator passes them). */
export function avoidMask(world: GeneratedWorld): Uint8Array {
  const avoid = slotCellMask(world.plan.grid, world.locations);
  roadCellMask(world.plan.grid, world.roads).forEach((v, c) => {
    if (v === 1) avoid[c] = 1;
  });
  return avoid;
}

/** Union-find over the roads: whether they join every terminal. */
export function roadsJoin(net: RoadNetwork): boolean {
  const parent = new Map<number, number>(net.terminals.map((t) => [t, t]));
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as number;
    return r;
  };
  for (const r of net.roads) parent.set(find(r.from), find(r.to));
  const roots = new Set(net.terminals.map(find));
  return roots.size === 1;
}

/** A walker that neither swims nor climbs cliffs: jumps down, climbs ramps and stairs (collision rules, ADR-0022). */
export const WALKER: MoverRules = { blockMask: BLOCK_SOLID | BLOCK_OBJECT | BLOCK_HAZARD | BLOCK_WALL | BLOCK_VOID | BLOCK_DEEP_WATER, mode: 'walk', dropDown: true };
