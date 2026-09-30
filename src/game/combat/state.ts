/**
 * State of the fight (saved by the participant `combat`, docs/SPIEL.md §15): the player's combat state (the attack in
 * progress, block, hitstop, stagger, knockback, broken armour, a loaded crossbow bolt), the parry marks on attackers, the
 * projectiles in flight (the ECS column store `projectile`, docs/SPIEL.md §10) with the pieces they carry, and the light of
 * glowing arrows that stuck.
 */
import { z } from 'zod';
import { ColumnStore, NULL_ENTITY, isEntityHandle, type Entity } from '../../engine/ecs';
import { isLayer, type Layer } from '../../world/model/coords';
import { itemStackSchema, type ItemStack } from '../items/stack';

/**
 * Phases of the player's attack: `bereit` (none), `ausholen` (winding up a blow), `aufladen` (a blow held past its wind-up:
 * charging the heavy attack), `spannen` (drawing a bow or sling, winding up a throw), `nachladen` (reloading a crossbow),
 * `erholung` (recovering after a blow, shot or throw).
 */
export const ATTACK_PHASES = ['bereit', 'ausholen', 'aufladen', 'spannen', 'nachladen', 'erholung'] as const;
/** One attack phase. */
export type AttackPhase = (typeof ATTACK_PHASES)[number];

/** The player's combat state. */
export interface PlayerCombat {
  phase: AttackPhase;
  /** Ticks spent in the phase (hitstop ticks do not count). */
  phaseTicks: number;
  /** Length of the phase [ticks]: wind-up, recovery, reload; 0 for the open-ended ones (aufladen, spannen). */
  phaseTotal: number;
  /** The attack button is held. */
  attackHeld: boolean;
  /** Tick of the press that began the attack (the heavy hold counts from it); −1 without one. */
  pressTick: number;
  /** Item of the attack in progress (`''`: the fist); another item in the hand ends it. */
  item: string;
  /** The blow in progress (or the last one, during its recovery) is heavy. */
  heavy: boolean;
  /** Step of the combo of the blow in progress or the last one (1 …; 0: none). */
  combo: number;
  /** Until this tick a light blow continues the combo (−1: none). */
  comboUntilTick: number;
  /** Tick of the last blow, shot, block or hit taken (the facing follows the aim until `fightingSeconds` after it); −1 never. */
  lastFightTick: number;
  /** The block button is held. */
  blockHeld: boolean;
  /** Tick the block became effective (parry window), −1 while not blocking. */
  blockSinceTick: number;
  /**
   * Hitstop: the body stands still (movement, attack clock) in the ticks after `hitstopFromTick` up to and including
   * `hitstopFromTick + hitstopTicks` – the same ticks whichever system dealt the hit within its tick (−1: none).
   */
  hitstopFromTick: number;
  hitstopTicks: number;
  /** Staggered up to and including this tick: no blow, no block (−1: none). */
  staggerUntilTick: number;
  /** Knockback per tick [px] and ticks left. */
  knockX: number;
  knockY: number;
  knockTicks: number;
  /** Armour broken by an axe [points] until `armorBreakUntilTick`. */
  armorBreak: number;
  armorBreakUntilTick: number;
  /** The bolt loaded in the crossbow (item id; `''`: unloaded). */
  loaded: string;
}

/** A player at rest. */
export function createPlayerCombat(): PlayerCombat {
  return {
    phase: 'bereit',
    phaseTicks: 0,
    phaseTotal: 0,
    attackHeld: false,
    pressTick: -1,
    item: '',
    heavy: false,
    combo: 0,
    comboUntilTick: -1,
    lastFightTick: -1,
    blockHeld: false,
    blockSinceTick: -1,
    hitstopFromTick: -1,
    hitstopTicks: 0,
    staggerUntilTick: -1,
    knockX: 0,
    knockY: 0,
    knockTicks: 0,
    armorBreak: 0,
    armorBreakUntilTick: -1,
    loaded: '',
  };
}

/** Kinds of projectile flight: flat (arrows, bolts, stones, knives, a spear) or an arc (bursting throwables). */
export const FLIGHT_FLAT = 0;
export const FLIGHT_ARC = 1;

/**
 * The ECS column store of projectiles (docs/SPIEL.md §10: x, y, vx, vy, z/arc height, life, owner, ammunition): position
 * [px], velocity [px/s], height above the ground [px], flight ticks done and total (an arc lands at its total; a flat shot
 * falls at it), the arc's peak [px], owner entity, the flying item (index in the catalog's id list), layer and flight
 * level, damage [HP], damage type (index of `DAMAGE_TYPES`), impact class, stagger [s], tension, the owner's team (index
 * of `COMBAT_TEAMS`), the flight kind and whether it is a ranged shot of the player's skill (`fernkampf`).
 */
export const PROJECTILE_COLUMNS = {
  x: 'f64',
  y: 'f64',
  vx: 'f64',
  vy: 'f64',
  z: 'f64',
  ticks: 'i32',
  total: 'i32',
  peak: 'f64',
  owner: 'f64',
  item: 'i32',
  layer: 'i32',
  level: 'i32',
  damage: 'f64',
  art: 'u8',
  wucht: 'u8',
  stagger: 'f64',
  tension: 'f64',
  team: 'u8',
  flight: 'u8',
} as const;

/** The projectile store. */
export type ProjectileStore = ColumnStore<typeof PROJECTILE_COLUMNS>;

/** Creates the projectile store. */
export function createProjectileStore(): ProjectileStore {
  return new ColumnStore(PROJECTILE_COLUMNS);
}

/** A parried attacker: its next hit is critical until `untilTick`. */
export interface ParryMark {
  entity: Entity;
  untilTick: number;
}

/** The light of a glowing arrow that stuck (in the ground, a wall or a body it follows). */
export interface Glow {
  /** Light id (unique among the light sources: `GLOW_LIGHT_ID_BASE` + serial). */
  id: number;
  layer: Layer;
  x: number;
  y: number;
  /** The body it stuck in (it follows it), or `NULL_ENTITY`. */
  target: Entity;
  /** Radius [tiles]. */
  radiusTiles: number;
  untilTick: number;
}

/** Everything of the fight that is saved. */
export interface CombatState {
  player: PlayerCombat;
  marks: ParryMark[];
  glows: Glow[];
  /** Serial of the next glow light. */
  serial: number;
  /** Pieces a flying projectile carries back into the world (a thrown spear with its durability, a throwing knife). */
  carried: Map<Entity, ItemStack>;
}

/** A fresh state. */
export function createCombatState(): CombatState {
  return { player: createPlayerCombat(), marks: [], glows: [], serial: 0, carried: new Map() };
}

// ---------------------------------------------------------------------------------------------
// Save schema (participant `combat`, version 1)
// ---------------------------------------------------------------------------------------------

const tickOrNone = z.number().int().min(-1);
const count = z.number().int().min(0);
const entity = z.number().int().refine((e) => e === NULL_ENTITY || isEntityHandle(e), { message: 'must be an entity handle or -1' });
const handle = z.number().int().refine(isEntityHandle, { message: 'must be an entity handle' });
const layer = z.number().int().refine(isLayer, { message: 'unknown layer' });

export const playerCombatSchema = z
  .object({
    phase: z.enum(ATTACK_PHASES),
    phaseTicks: count,
    phaseTotal: count,
    attackHeld: z.boolean(),
    pressTick: tickOrNone,
    item: z.string(),
    heavy: z.boolean(),
    combo: count,
    comboUntilTick: tickOrNone,
    lastFightTick: tickOrNone,
    blockHeld: z.boolean(),
    blockSinceTick: tickOrNone,
    hitstopFromTick: tickOrNone,
    hitstopTicks: count,
    staggerUntilTick: tickOrNone,
    knockX: z.number(),
    knockY: z.number(),
    knockTicks: count,
    armorBreak: z.number().min(0),
    armorBreakUntilTick: tickOrNone,
    loaded: z.string(),
  })
  .strict();

/** One saved projectile: its entity, the flying item by id, every column, and the piece it carries. */
export const savedProjectileSchema = z
  .object({
    entity: handle,
    item: z.string().min(1),
    x: z.number(),
    y: z.number(),
    vx: z.number(),
    vy: z.number(),
    z: z.number(),
    ticks: count,
    total: count,
    peak: z.number().min(0),
    owner: entity,
    layer,
    level: count,
    damage: z.number().min(0),
    art: count,
    wucht: count,
    stagger: z.number().min(0),
    tension: z.number().min(0).max(1),
    team: count,
    flight: z.union([z.literal(FLIGHT_FLAT), z.literal(FLIGHT_ARC)]),
    carried: itemStackSchema.nullable(),
  })
  .strict();
/** One saved projectile. */
export type SavedProjectile = z.output<typeof savedProjectileSchema>;

export const combatSnapshotSchema = z
  .object({
    player: playerCombatSchema,
    marks: z.array(z.object({ entity: handle, untilTick: count }).strict()),
    glows: z.array(
      z
        .object({ id: count, layer, x: z.number(), y: z.number(), target: entity, radiusTiles: z.number().positive(), untilTick: count })
        .strict(),
    ),
    serial: count,
    projectiles: z.array(savedProjectileSchema),
  })
  .strict();
/** The saved fight. */
export type CombatSnapshot = z.output<typeof combatSnapshotSchema>;
