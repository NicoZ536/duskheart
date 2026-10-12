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
import { CONTENT } from '../../../src/content/index';
import { isRipe } from '../../../src/game/gathering/formulas';
import { generateChunk } from '../../../src/world/gen/chunk';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { CHUNK_MASK, CHUNK_SHIFT } from '../../../src/world/model/coords';

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

/**
 * The kinds of hand-picked plants (bushes and herbs, `pflanze`/`busch` with the tool `hand` – what the herbarium lists) that a
 * player can pick in spring within `radius` tiles of the spawn: their anchor tile in the generated surface chunks, their
 * standing drops ripe in spring by the gathering's own rule (`isRipe`, M7-107).
 */
export function springPickableAround(world: GeneratedWorld, radius: number): Set<string> {
  const ids = contentWorldIdTables().objects;
  const objects = CONTENT.collection('worldObjects');
  const chunks = new Map<number, ReturnType<typeof generateChunk>>();
  const out = new Set<string>();
  const { x: sx, y: sy } = world.spawn;
  for (let ty = sy - radius; ty <= sy + radius; ty++) {
    for (let tx = sx - radius; tx <= sx + radius; tx++) {
      if ((tx - sx) ** 2 + (ty - sy) ** 2 > radius * radius || tx < 0 || ty < 0) continue;
      const key = (ty >> CHUNK_SHIFT) * 65536 + (tx >> CHUNK_SHIFT);
      let c = chunks.get(key);
      if (c === undefined) {
        c = generateChunk(world, 0, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
        chunks.set(key, c);
      }
      const o = c.object[((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK)] as number;
      if (o === 0) continue;
      const def = objects.find(ids.stringId(o));
      if (def === undefined || (def.kind !== 'pflanze' && def.kind !== 'busch') || def.tool !== 'hand') continue;
      if (isRipe(def.drops ?? [], 'abbau', 'fruehling')) out.add(def.id);
    }
  }
  return out;
}
