/**
 * Combatants of the fight (M6, docs/SPIEL.md §10): the player and the creatures take part through providers. The combat
 * system (src/game/combat/system.ts) finds bodies in reach through `queryCircle`, judges them through `view` and hands
 * every resolved hit to `applyHit` of the provider that owns the body. The player's provider belongs to the combat
 * system, the creatures' to the creature system (src/game/creatures/); both register with
 * `CombatSystem.addTargetProvider` while the simulation is built (src/game/setup.ts).
 *
 * The records are held and refilled (no allocation per query, §30): `out` lists and `view` records belong to the caller;
 * the caller knows which provider it asked, so the lists hold bare entities.
 */
import type { Entity } from '../../engine/ecs';
import type { Simulation } from '../sim';

/** The eight damage types of §19.3. */
export const DAMAGE_TYPES = ['hieb', 'stich', 'wucht', 'feuer', 'frost', 'gift', 'licht', 'schatten'] as const;
/** One damage type. */
export type DamageType = (typeof DAMAGE_TYPES)[number];

/** Sides of a fight: who may hit whom is `CombatSystem.hostile(a, b)` (the player and wild animals fight each other only when one attacks). */
export const COMBAT_TEAMS = ['spieler', 'tier', 'feind', 'schattenbrut'] as const;
/** One side. */
export type CombatTeam = (typeof COMBAT_TEAMS)[number];

/**
 * What a body is made of, for the impact of a hit (docs/SPIEL.md §10 `hitLanded.material`: particles and sounds per
 * material). Additive field of M6 (ADR-0080 "Ergänzungen frei").
 */
export const HIT_MATERIALS = ['fleisch', 'fell', 'panzer', 'holz', 'stein', 'schatten'] as const;
/** One hit material. */
export type HitMaterial = (typeof HIT_MATERIALS)[number];

/** What the combat system reads of a body (refilled by `view`). */
export interface CombatantView {
  entity: Entity;
  team: CombatTeam;
  layer: number;
  /** Height level of its tile (hits reach the same level only, ramps aside). */
  level: number;
  /** Centre of the body [world px]. */
  x: number;
  y: number;
  /** Radius of the body [px]. */
  radius: number;
  /** Direction the body faces [rad, 0 = east, counter-clockwise with y down as in the world]. */
  facing: number;
  health: number;
  maxHealth: number;
  /** Armour value R of §19.3 (reduction R / (R + 50)), after armour break. */
  armor: number;
  /** Resistance per damage type (−1 … 1: 0.5 halves, −0.5 is a weakness taking 1.5×). */
  resist: Record<DamageType, number>;
  /** No hit lands (roll, god mode, fading shadow brood). */
  invulnerable: boolean;
  /** The tick the body began to block, or −1 (parry window of §19.1: a block begun ≤ 0.15 s before the hit). */
  blockSinceTick: number;
  /** Block power 0 … 1 of the shield or weapon it blocks with (0 = not blocking). */
  blockPower: number;
  /**
   * Additive (M6): stamina a block costs per point of absorbed damage [points/HP]; absent = `BALANCE.combat.block.staminaPerDamage`.
   * The combat system clears it before every `view`.
   */
  blockStaminaPerDamage?: number;
  /** Additive (M6): what the body is made of (hit particles and sounds); absent = `fleisch`. The combat system clears it before every `view`. */
  material?: HitMaterial;
}

/** A resolved hit, handed to the provider of the target. */
export interface HitResult {
  attacker: Entity;
  attackerTeam: CombatTeam;
  /** Damage after resistance, armour, block and crit [HP]. */
  amount: number;
  type: DamageType;
  crit: boolean;
  parried: boolean;
  blocked: boolean;
  /** Stamina the block costs the target. */
  blockStamina: number;
  /** Knockback [px] along (dirX, dirY). */
  knockback: number;
  dirX: number;
  dirY: number;
  /** Ticks both stand still (hitstop, 2–6 by impact). */
  hitstopTicks: number;
  /** Stagger ticks of the target. */
  staggerTicks: number;
  /** Condition the hit applies (`src/content/conditions.ts` id), with its seconds, or null. */
  condition: string | null;
  conditionSeconds: number;
  /** Armour break of the axe's heavy attack [R points, seconds]. */
  armorBreak: number;
  armorBreakSeconds: number;
}

/** A kind of combatant (the player, the creatures). */
export interface CombatTargetProvider {
  readonly id: string;
  /** Entities of this provider whose body circle touches (x, y, r) on `layer`, appended to `out` (held by the caller). */
  queryCircle(sim: Simulation, layer: number, x: number, y: number, r: number, out: Entity[]): void;
  /** Fills `out` with the body's state; false if the entity is gone. */
  view(sim: Simulation, entity: Entity, out: CombatantView): boolean;
  /** Whether the body is aware of `attacker` (the dagger's backstab ×3 of §19.2 needs `false`). */
  aware(sim: Simulation, entity: Entity, attacker: Entity): boolean;
  /** Applies a resolved hit (health, conditions, stagger, knockback, hitstop, events of its own). */
  applyHit(sim: Simulation, entity: Entity, hit: HitResult): void;
}
