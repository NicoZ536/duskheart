/**
 * Death state of the world (MASTERPROMPT §11.6): the difficulty whose penalties apply, the player's death
 * (while the death screen shows), the respawn point of the last bed, and the graves with their items.
 * Saved by the participant `death`.
 */
import { z } from 'zod';
import { DIFFICULTIES, type Difficulty } from '../../content/balance/death';
import { BALANCE } from '../../content/balance';
import { itemStackSchema, type ItemStack } from '../items/stack';
import type { SleepPlaceKind } from '../sleep/formulas';

/** Deepest world layer (docs/WORLD.md §1). */
const LAYER_MIN = -3;

/** A grave (§11.6: "Am Todesort entsteht ein Grab mit dem Inventar (auf der Karte markiert, bleibt bis geleert)"). */
export interface Grave {
  readonly id: number;
  /** Position [world px]. */
  readonly x: number;
  readonly y: number;
  readonly layer: number;
  /** Items inside, in the order they were taken from the bags. */
  items: ItemStack[];
  /** Tick of the death. */
  readonly tick: number;
}

/** The player's death while the death screen shows. */
export interface Death {
  readonly tick: number;
  readonly x: number;
  readonly y: number;
  readonly layer: number;
  /** What killed the player (damage cause, condition id, `trugbild`, `debug`, `unbekannt`). */
  readonly cause: string;
  /** The grave of this death, or `null` when nothing went into one. */
  readonly grave: number | null;
  /** Unbarmherzig: the world is over. */
  readonly permadeath: boolean;
}

/** The respawn point set by a bed (§11.5). */
export interface RespawnPoint {
  readonly x: number;
  readonly y: number;
  readonly layer: number;
  readonly kind: SleepPlaceKind;
}

/** Death state. */
export interface DeathState {
  difficulty: Difficulty;
  death: Death | null;
  respawn: RespawnPoint | null;
  graves: Grave[];
  nextGraveId: number;
}

/** The death state of a new world. */
export function createDeathState(): DeathState {
  return { difficulty: BALANCE.death.defaultDifficulty, death: null, respawn: null, graves: [], nextGraveId: 1 };
}

const layer = z.number().int().min(LAYER_MIN).max(0);

/** Saved death state (participant `death`, version 1). */
export const deathStateSchema = z
  .object({
    difficulty: z.enum(DIFFICULTIES),
    death: z
      .object({ tick: z.number().int().min(0), x: z.number(), y: z.number(), layer, cause: z.string().min(1), grave: z.number().int().min(1).nullable(), permadeath: z.boolean() })
      .strict()
      .nullable(),
    respawn: z
      .object({ x: z.number(), y: z.number(), layer, kind: z.enum(Object.keys(BALANCE.sleep.places) as [SleepPlaceKind, ...SleepPlaceKind[]]) })
      .strict()
      .nullable(),
    graves: z.array(z.object({ id: z.number().int().min(1), x: z.number(), y: z.number(), layer, items: z.array(itemStackSchema).min(1), tick: z.number().int().min(0) }).strict()),
    nextGraveId: z.number().int().min(1),
  })
  .strict();

/** Copy of the death state (saves must not share the live objects). */
export function copyDeathState(s: DeathState): DeathState {
  return {
    difficulty: s.difficulty,
    death: s.death === null ? null : { ...s.death },
    respawn: s.respawn === null ? null : { ...s.respawn },
    graves: s.graves.map((g) => ({ ...g, items: g.items.slice() })),
    nextGraveId: s.nextGraveId,
  };
}
