/**
 * Owned creatures (docs/SPIEL.md §17 "Haken", ADR-0207): creatures that do not come from the spawn tables – a place's
 * guards, a vault's guards and its mini-boss, a boss's servants. They live in their home chunk's stock like every creature
 * (ADR-0096: written into it when the chunk freezes, back to life when it activates), carry their owner in the optional
 * field `besitzer` of the creature state and of the stock (saved only when set), and report their death to the owner's
 * system. Spawn blockers veto the table spawns (the first population and regrowth of a chunk, the night spawner, the
 * Nachtmahr) on a tile – a peaceful world, a beacon zone, a vault box, a boss arena; owned spawns ignore them.
 */
import { z } from 'zod';
import type { CreatureFamily } from '../../content/creatures/schema';
import type { Entity } from '../../engine/ecs';
import type { Layer } from '../../world/model/coords';
import type { Simulation } from '../sim';

/** Owner of a creature that does not come from the spawn tables: a place's guard, a vault's guard, a boss's servant. */
export type CreatureOwner = `ort:${number}` | `gewoelbe:${number}` | `boss:${string}`;

export interface OwnedSpawn {
  readonly creature: string;
  /** Index of the variant (`varianten`), −1 the base form; absent = the variant of the biome at the spawn point. */
  readonly variant?: number;
  readonly layer: Layer;
  /** Spawn point [world px]; also the creature's home (leash centre). */
  readonly x: number;
  readonly y: number;
  readonly owner: CreatureOwner;
  /** Leash radius [tiles]; absent = the AI profile's. */
  readonly leashTiles?: number;
}

/** A creature of `owner` was killed (not despawned, not frozen). */
export type OwnedDeathListener = (sim: Simulation, owner: CreatureOwner, creature: string, entity: Entity) => void;

/** Spawn veto for table spawns (peaceful world, beacon zone, vault box, boss arena); owned spawns ignore it. */
export type SpawnBlocker = (sim: Simulation, layer: Layer, tx: number, ty: number, family: CreatureFamily) => boolean;

export interface OwnedCreaturesApi {
  /** Spawns one owned creature now (it lives in its home chunk's stock like every creature, ADR-0096). */
  spawnOwned(sim: Simulation, spawn: OwnedSpawn): Entity;
  /** Living creatures of `owner`, active or in a frozen chunk's stock. */
  countOwned(owner: CreatureOwner): number;
  /** Removes every creature of `owner` without death or loot (boss reset); returns how many. */
  despawnOwned(sim: Simulation, owner: CreatureOwner): number;
  onOwnedDeath(listener: OwnedDeathListener): void;
  addSpawnBlocker(blocker: SpawnBlocker): void;
}

/** Owner ids: `ort:<slot>`, `gewoelbe:<slot>` (slot ids are non-negative integers), `boss:<content id>`. */
export const CREATURE_OWNER_PATTERN = /^(?:(?:ort|gewoelbe):(?:0|[1-9][0-9]*)|boss:[a-z][a-z0-9]*(?:_[a-z0-9]+)*)$/;

/** Whether `value` is a well formed owner. */
export function isCreatureOwner(value: unknown): value is CreatureOwner {
  return typeof value === 'string' && CREATURE_OWNER_PATTERN.test(value);
}

/** Schema of a saved owner (the optional `besitzer` of a creature and of a stock member). */
export const creatureOwnerSchema = z.custom<CreatureOwner>(isCreatureOwner, { message: 'owner must be ort:<slot>, gewoelbe:<slot> or boss:<id>' });
