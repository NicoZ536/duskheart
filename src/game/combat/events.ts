/**
 * Events of the fight (docs/SPIEL.md §10 "Ereignisse"; MASTERPROMPT §2.7 "Jede Aktion hat visuelles und akustisches
 * Feedback", §19.1 "Hitstop, Knockback, Trefferblitz, Screenshake, Schadenszahlen"). Aggregated into `SimEventMap`; the
 * presentation reads them after the tick (sprites and smears, hit flash, damage numbers, particles per material, sounds
 * of src/audio/eventMap.ts).
 *
 * - `attackWindup`: a body began winding up a blow or drawing a shot (`ticks` until it lands at the earliest), or its
 *   held blow turned into a heavy one (`schwer`).
 * - `attackStarted`: the blow is struck or the shot released – class, heavy, the step of the combo (1 …), where and in
 *   which direction (`angle`, rad, 0 = east, south = +π/2), reach and swing for the smear.
 * - `hitLanded`: a resolved hit – damage after everything (`amount`), damage type (`art`), crit, impact class, hitstop,
 *   knockback, the target's side and material; `backstab` for the dagger's ×3 from behind.
 * - `parried`: a block begun in the parry window met the blow – no damage; the attacker staggers.
 * - `blocked`: a block absorbed part of a hit (`absorbed`); `guardBroken` when the blocker's stamina ran out; `mit` the
 *   item that met the blow (shield or weapon; its sound).
 * - `staggered`: a body staggers for `ticks` (a parry, a heavy blow, a guard break).
 * - `projectileFired`: an arrow, bolt, stone, spear or thrown weapon left (`item` = what flies, `tension` 0–1).
 * - `projectileHit`: a projectile met a body (`target`) or burst where it landed (`target` −1, `wirkung` and `radius`).
 * - `projectileStuck`: it came to rest – in the ground, a wall, a body, or sank in deep water; `drop` when it can be
 *   picked up again.
 * - `combatantDefeated`: a body's health reached 0 by a hit (`by` = the attacker).
 * Refused commands raise `commandRejected` with a `CombatRejectReason` (texts `ui.combat.reject.<reason>`).
 */
import type { WeaponClass } from '../../content/balance/tools';
import type { ThrowEffect } from '../../content/balance/combat';
import type { Entity } from '../../engine/ecs';
import type { Layer } from '../../world/model/coords';
import type { CombatTeam, DamageType, HitMaterial } from './targets';

/**
 * Why a combat command had no effect: no player, dead or asleep (§11.5, §11.6), rolling, jumping or climbing (`busy`),
 * swimming, staggered, out of stamina, a ranged weapon without its ammunition.
 */
export const COMBAT_REJECT_REASONS = ['noPlayer', 'dead', 'asleep', 'busy', 'swimming', 'staggered', 'noStamina', 'noAmmo'] as const;
/** One reason a combat command was refused. */
export type CombatRejectReason = (typeof COMBAT_REJECT_REASONS)[number];

/** Where a projectile came to rest. */
export const PROJECTILE_REST_PLACES = ['boden', 'wand', 'wasser', 'ziel'] as const;
/** One resting place of a projectile. */
export type ProjectileRestPlace = (typeof PROJECTILE_REST_PLACES)[number];

interface Place {
  readonly layer: Layer;
  /** Position [world px]. */
  readonly x: number;
  readonly y: number;
  readonly tick: number;
}

export interface CombatEventMap {
  attackWindup: { readonly entity: Entity; readonly klasse: WeaponClass; readonly schwer: boolean; readonly ticks: number; readonly tick: number };
  attackStarted: Place & {
    readonly entity: Entity;
    readonly klasse: WeaponClass;
    readonly schwer: boolean;
    /** Step of the combo (1 = the first blow). */
    readonly kombo: number;
    /** Direction of the blow [rad]. */
    readonly angle: number;
    /** Reach [px] and swing [°] of the blow. */
    readonly reichweite: number;
    readonly bogen: number;
    /** The item swung (null: the bare fist). */
    readonly item: string | null;
  };
  hitLanded: Place & {
    readonly attacker: Entity;
    readonly target: Entity;
    /** The target's side (the player's own hurt sound is `playerDamaged`'s). */
    readonly targetTeam: CombatTeam;
    readonly amount: number;
    readonly art: DamageType;
    readonly crit: boolean;
    readonly wucht: number;
    readonly hitstopTicks: number;
    readonly knockback: number;
    readonly material: HitMaterial;
    readonly backstab: boolean;
  };
  parried: Place & { readonly entity: Entity; readonly attacker: Entity };
  blocked: Place & {
    readonly entity: Entity;
    readonly attacker: Entity;
    readonly absorbed: number;
    readonly amount: number;
    readonly guardBroken: boolean;
    /** What met the blow: the player's shield, else the weapon or tool in the hand; `null` for bare arms and creatures (M6-33: the block's sound). */
    readonly mit: string | null;
  };
  staggered: { readonly entity: Entity; readonly ticks: number; readonly tick: number };
  projectileFired: Place & { readonly entity: Entity; readonly owner: Entity; readonly item: string; readonly klasse: WeaponClass; readonly vx: number; readonly vy: number; readonly tension: number };
  projectileHit: Place & { readonly entity: Entity; readonly owner: Entity; readonly item: string; readonly target: Entity; readonly wirkung: ThrowEffect | null; readonly radius: number };
  projectileStuck: Place & { readonly entity: Entity; readonly item: string; readonly wo: ProjectileRestPlace; readonly drop: boolean };
  combatantDefeated: Place & { readonly entity: Entity; readonly by: Entity };
}

/** Event names of `CombatEventMap`. */
export const COMBAT_EVENT_TYPES = [
  'attackWindup',
  'attackStarted',
  'hitLanded',
  'parried',
  'blocked',
  'staggered',
  'projectileFired',
  'projectileHit',
  'projectileStuck',
  'combatantDefeated',
] as const satisfies ReadonlyArray<keyof CombatEventMap>;

/**
 * Sound ids of the fight that are not weapon sounds (src/content/sfx/kampf.ts has those, M6-33): a projectile sinking in
 * deep water, and the bursts of thrown weapons by effect (`sfx_<bereich>_<name>`, docs/SPIEL.md §5).
 */
export const COMBAT_SFX = {
  /** A projectile sinks in deep water. */
  sink: 'sfx_wasser_platsch',
  /** Bursts of thrown weapons by effect. */
  burst: { einzel: 'sfx_aktion_aufprall', explosion: 'sfx_bau_einsturz', brand: 'sfx_brand_entflammen', frost: 'sfx_zustand_verlangsamt', blendung: 'sfx_zustand_geblendet' } satisfies Record<ThrowEffect, string>,
} as const;
