/**
 * Events of the creatures, the traps and the bestiary (docs/SPIEL.md §11; MASTERPROMPT §2.7 "Jede Aktion hat visuelles
 * und akustisches Feedback", §19.4 "Telegraphs … klar sichtbar und hörbar"). Aggregated into `SimEventMap`; the
 * presentation reads them after the tick (sprites and clips, the telegraph glint and ground mark, sounds of
 * src/audio/eventMap.ts, messages).
 *
 * - `creatureSpawned`: a creature appeared (first population, regrowth, the night spawner, the Nachtmahr, a restored
 *   chunk's stock, the debug console).
 * - `creatureCall`: a call – `alarm` when it notices a threat or prey (its `laut`), `ruf` an idle call now and then.
 * - `creatureFlushed`: a ground bird flutters up.
 * - `creatureTelegraph`: an attack winds up (M6-15): `ticks` until the blow lands (wind-up and run-up, scaled by the
 *   difficulty), `poseTicks` of them the readable pose; area attacks name their ground mark (`flaeche`).
 * - `creatureAttack`: the blow of an attack lands now (its sound; the hits follow as `hitLanded`).
 * - `creatureHurt`: a hit took health (its hurt cry; the impact itself is `hitLanded`'s).
 * - `creatureDied`: health reached 0 – `by` the attacker, `carcass` the carcass it leaves (−1 none), `loot` whether it
 *   dropped loot, `facing` and `variant` how the presentation lays it down (the death clip and dissolve of bodies without
 *   a carcass).
 * - `creatureFaded`: shadow brood dissolved without loot – at sunrise, the Nachtmahr banished by light or the player's
 *   death (M6-28, M6-29).
 * - `creatureBurning`: shadow brood takes damage in glaring light (once per second while it lasts).
 * - `doorBattered`: a creature that breaks doors struck a closed door (the damage itself is `partDamaged`'s).
 * - `carcassCarved`: the player carved a carcass with a knife; `carcassRotted`: a carcass nobody carved rotted away.
 * - `trapPlaced`, `trapSprung` (a creature was caught), `trapTaken` (the trap back into the bags, with its catch as a
 *   carcass at its place).
 * - `bestiaryUnlocked`: a creature's bestiary entry opened a stage (`gesichtet`, `resistenzen`, `beute`).
 * Refused commands raise `commandRejected` with a `CreatureRejectReason` (texts `ui.creatures.reject.<reason>`).
 */
import type { Entity } from '../../engine/ecs';
import type { Layer } from '../../world/model/coords';
import type { FadeReason } from './state';

/** Why a creature, carcass or trap command had no effect. */
export const CREATURE_REJECT_REASONS = [
  'noPlayer',
  'dead',
  'asleep',
  'unknownCreature',
  'noCarcass',
  'noKnife',
  'tooFar',
  'noTrap',
  'notATrap',
  'noItem',
  'blocked',
  'bagsFull',
] as const;
/** One reason. */
export type CreatureRejectReason = (typeof CREATURE_REJECT_REASONS)[number];

/** Stages of a bestiary entry (M6-32). */
export const BESTIARY_STAGES = ['gesichtet', 'resistenzen', 'beute'] as const;
/** One stage. */
export type BestiaryStage = (typeof BESTIARY_STAGES)[number];

interface Place {
  readonly layer: Layer;
  /** Position [world px]. */
  readonly x: number;
  readonly y: number;
  readonly tick: number;
}

export interface CreatureEventMap {
  creatureSpawned: Place & { readonly entity: Entity; readonly creature: string };
  creatureCall: Place & { readonly entity: Entity; readonly creature: string; readonly reason: 'alarm' | 'ruf' };
  creatureFlushed: Place & { readonly entity: Entity; readonly creature: string };
  creatureTelegraph: Place & {
    readonly entity: Entity;
    readonly creature: string;
    readonly angriff: string;
    /** Ticks until the blow lands, and of them the readable pose. */
    readonly ticks: number;
    readonly poseTicks: number;
    /** Direction of the attack [rad]. */
    readonly angle: number;
    /** Ground mark of an area attack: centre [px] and radius [px], or null. */
    readonly flaeche: { readonly x: number; readonly y: number; readonly radius: number } | null;
  };
  creatureAttack: Place & { readonly entity: Entity; readonly creature: string; readonly angriff: string; readonly angle: number };
  creatureHurt: Place & { readonly entity: Entity; readonly creature: string; readonly amount: number; readonly health: number };
  creatureDied: Place & {
    readonly entity: Entity;
    readonly creature: string;
    readonly by: Entity;
    readonly carcass: Entity;
    readonly loot: boolean;
    /** Where it faced [rad, 0 = east, y down] and its variant (−1 base form). */
    readonly facing: number;
    readonly variant: number;
  };
  creatureFaded: Place & { readonly entity: Entity; readonly creature: string; readonly reason: FadeReason };
  creatureBurning: Place & { readonly entity: Entity; readonly creature: string };
  doorBattered: { readonly entity: Entity; readonly layer: Layer; readonly tx: number; readonly ty: number; readonly tick: number };
  carcassCarved: Place & { readonly carcass: Entity; readonly creature: string; readonly pieces: number };
  carcassRotted: Place & { readonly carcass: Entity; readonly creature: string };
  trapPlaced: { readonly trap: number; readonly item: string; readonly layer: Layer; readonly tx: number; readonly ty: number; readonly tick: number };
  trapSprung: { readonly trap: number; readonly item: string; readonly creature: string; readonly layer: Layer; readonly tx: number; readonly ty: number; readonly tick: number };
  trapTaken: { readonly trap: number; readonly item: string; readonly caught: string | null; readonly layer: Layer; readonly tx: number; readonly ty: number; readonly tick: number };
  bestiaryUnlocked: { readonly creature: string; readonly stage: BestiaryStage; readonly tick: number };
}

/** Event names of `CreatureEventMap`. */
export const CREATURE_EVENT_TYPES = [
  'creatureSpawned',
  'creatureCall',
  'creatureFlushed',
  'creatureTelegraph',
  'creatureAttack',
  'creatureHurt',
  'creatureDied',
  'creatureFaded',
  'creatureBurning',
  'doorBattered',
  'carcassCarved',
  'carcassRotted',
  'trapPlaced',
  'trapSprung',
  'trapTaken',
  'bestiaryUnlocked',
] as const satisfies ReadonlyArray<keyof CreatureEventMap>;

/** Sounds of the creature system that no creature record names (src/content/sfx/kreaturen.ts). */
export const CREATURE_SFX = {
  telegraph: 'sfx_kreatur_telegraph',
  carve: 'sfx_kreatur_zerlegen',
  trapSet: 'sfx_kreatur_falle_stellen',
  trapSprung: 'sfx_kreatur_falle_zu',
  fade: 'sfx_kreatur_verblassen',
  burn: 'sfx_kreatur_brennen',
  /** A ground bird flushed (the quail's wings; other birds bring their own with their content). */
  flushed: 'sfx_kreatur_wachtel_auffliegen',
} as const;
