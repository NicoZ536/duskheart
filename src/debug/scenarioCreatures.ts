/**
 * The creature stock of the screenshot scenarios (M6 gate, picture review: in `brand` a wolf pressed against the player
 * beside the burning shed and a quail stood by the wall of flames; MASTERPROMPT §31.5 "deterministisch", docs/SPIEL.md §11).
 * Since M6 the world has creatures of its own: every home chunk's stock is seeded on the first world tick after the player
 * appeared (ADR-0096), the night brings its hunters and its brood. A scenario controls them explicitly, two ways:
 *
 * - A picture whose subject is not a creature keeps them off its subject (`KreaturenFern`): foes – every family but
 *   `friedlich` – leave within `feindeKacheln` of the subject (the whole view and the way into it: a wolf runs four tiles a
 *   second), peaceful animals within `tiereKacheln` (the subject itself); wildlife farther off stays part of the world. The
 *   scenario clears after it built its scene and before every tick it runs it, so nothing walks in meanwhile.
 * - A creature picture clears the stock in its view before its cast appears (`STOCK_CLEARING`): only the cast stands in it.
 *
 * They leave by the engine's `despawn` command (src/game/sim.ts: the entity and its components go at the end of the tick –
 * no loot, no carcass, no kill in the bestiary: they were never in the picture), queued like every other command of a
 * scenario. What stands where is read from the session's simulation (`ScenarioSession.sim`, only to read).
 */
import type { Entity } from '../engine/ecs';
import { CreatureSystem } from '../game/creatures/system';
import type { Simulation } from '../game/sim';
import { TILE_PX } from '../world/model/coords';

/** How far creatures keep off a picture's subject [tiles]. */
export interface KreaturenFern {
  /** Foes (every family but `friedlich`) leave within this distance. */
  readonly feindeKacheln: number;
  /** Peaceful animals leave within this distance. */
  readonly tiereKacheln: number;
}

/**
 * The view of a picture and a margin [tiles]: 640 × 270 px of the widest example view show ±20 × ±8,5 tiles, a creature
 * running in at 4 tiles/s crosses 4 more between two clearings of a creature picture's set-up.
 */
export const VIEW_CLEARING_TILES = 24;

/** A creature picture clears every creature of the stock within its view before its cast appears. */
export const STOCK_CLEARING: KreaturenFern = { feindeKacheln: VIEW_CLEARING_TILES, tiereKacheln: VIEW_CLEARING_TILES };

/**
 * Ground a picture's creatures do not stand on when it asks for the biome's own ground (`naturalGround`): the grey builder
 * paving (src/content/terrain.ts `strasse`) has the tone of grey fur, of the boar and the badger – they keep only their
 * 1 px outline on it (M6 gate `kreaturen-gruenhain-gegner`, `kampf-tag`).
 */
export const PAVED_GROUND: readonly string[] = ['strasse'];

/** The family of peaceful animals (src/content/creatures/schema.ts `CREATURE_FAMILIES`). */
const PEACEFUL = 'friedlich';

/** A living creature as the clearing sees it. */
export interface CreatureAt {
  readonly entity: Entity;
  readonly familie: string;
  readonly layer: number;
  /** World px. */
  readonly x: number;
  readonly y: number;
}

/**
 * Of `creatures`, the entities that leave a subject at world px (x, y) on `layer` by `fern` (into `out`, which is emptied
 * first): foes within `feindeKacheln`, peaceful animals within `tiereKacheln` – both inclusive.
 */
export function creaturesToClear(creatures: Iterable<CreatureAt>, layer: number, x: number, y: number, fern: KreaturenFern, out: Entity[]): Entity[] {
  out.length = 0;
  for (const c of creatures) {
    if (c.layer !== layer) continue;
    const reach = (c.familie === PEACEFUL ? fern.tiereKacheln : fern.feindeKacheln) * TILE_PX;
    const dx = c.x - x;
    const dy = c.y - y;
    if (dx * dx + dy * dy <= reach * reach) out.push(c.entity);
  }
  return out;
}

/** The living creatures of `sim` (none without a creature system). */
export function livingCreatures(sim: Simulation): CreatureAt[] {
  const system = sim.system('creatures');
  if (!(system instanceof CreatureSystem)) return [];
  const at = { x: 0, y: 0 };
  const out: CreatureAt[] = [];
  for (let i = 0; i < system.store.size; i++) {
    const s = system.store.valueAt(i);
    const e = system.store.entityAt(i);
    if (s.health <= 0 || !system.positionOf(e, at)) continue;
    out.push({ entity: e, familie: system.catalog.get(s.creature).def.familie, layer: s.layer, x: at.x, y: at.y });
  }
  return out;
}

/** What the clearing needs of the session (`ScenarioSession`). */
export interface ClearingSession {
  command(raw: unknown): unknown;
  sim?(): Simulation;
}

/**
 * Queues the `despawn` of every creature that leaves the subject at world px (x, y) on `layer` by `fern`; they are gone after
 * the next tick. Returns how many. Throws without a simulation to read: a picture that needs its creatures cleared must not be
 * taken with them.
 */
export function clearCreatures(session: ClearingSession, layer: number, x: number, y: number, fern: KreaturenFern): number {
  const sim = session.sim?.();
  if (sim === undefined) throw new Error('Szenario: die Kreaturen lassen sich nicht räumen – die Sitzung zeigt ihre Simulation nicht (ScenarioSession.sim)');
  const leave = creaturesToClear(livingCreatures(sim), layer, x, y, fern, []);
  for (const entity of leave) session.command({ type: 'despawn', entity });
  return leave.length;
}
