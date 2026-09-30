/**
 * The fight for the presentation (docs/SPIEL.md §13 "Waffen frei rotiert im Low-Res-Puffer", M6-01, M6-05): what the
 * weapon sprite, the smears, the HUD and the E2E probes read of the player's fight each frame, filled by
 * `GameSession.sampleCombat` into a record the caller owns (no allocation per frame) – the aim angle and point, whether
 * the facing follows the aim, the attack phase with its clock and progress, class, item, heavy, combo, tension, block
 * or aim, hitstop and stagger, a loaded crossbow. Also the input probe of the session's translator (`combatInputProbe`:
 * the item in the hand and where the player stands).
 */
import type { WeaponClass } from '../../content/balance/tools';
import type { ItemDef } from '../../content/schema/item';
import type { InputProbe } from '../input';
import type { InventorySystem } from '../inventory/system';
import type { PlayerSystem } from '../player/system';
import type { Simulation } from '../sim';
import { aimAngle, FACING_ANGLE } from './formulas';
import type { AttackPhase } from './state';
import type { CombatSystem } from './system';

/** The player's fight in one frame. */
export interface CombatSample {
  /** A player exists (the rest is stale otherwise). */
  present: boolean;
  /** An aim point is set (`player.aim`). */
  aimed: boolean;
  /** The aim point [world px] (the player's feet without one). */
  aimX: number;
  aimY: number;
  /** Direction of the aim from the feet [rad, 0 = east, south = +π/2]: the aim point's, else the facing's. */
  aimAngle: number;
  /** The facing follows the aim now (fighting, aiming, blocking or just after). */
  fighting: boolean;
  phase: AttackPhase;
  /** Time in the phase [s] (hitstop ticks do not count). */
  phaseSeconds: number;
  /** Progress 0–1 of a phase with an end (wind-up, recovery, reload); 0 for charging and drawing. */
  phaseProgress: number;
  /** Class and item of the hand (`null`: the fist). */
  klasse: WeaponClass;
  item: string | null;
  heavy: boolean;
  combo: number;
  /** Tension 0–1 of a drawn bow, sling or throw (0 otherwise). */
  tension: number;
  /** The block (or aim with a ranged weapon) is up. */
  blocking: boolean;
  /** `block` (shield, weapon, fists) or `ziel` (a ranged weapon aims); `null` while not blocking. */
  blockKind: 'block' | 'ziel' | null;
  /** Time since the block became effective [s]. */
  blockSeconds: number;
  /** The body stands still in hitstop. */
  hitstop: boolean;
  staggered: boolean;
  /** A crossbow holds a bolt. */
  loaded: boolean;
}

/** A fresh `CombatSample`. */
export function createCombatSample(): CombatSample {
  return {
    present: false,
    aimed: false,
    aimX: 0,
    aimY: 0,
    aimAngle: 0,
    fighting: false,
    phase: 'bereit',
    phaseSeconds: 0,
    phaseProgress: 0,
    klasse: 'faust',
    item: null,
    heavy: false,
    combo: 0,
    tension: 0,
    blocking: false,
    blockKind: null,
    blockSeconds: 0,
    hitstop: false,
    staggered: false,
    loaded: false,
  };
}

/** What the sample reads of the aim. */
export interface AimSource {
  readonly aimPoint: Readonly<{ x: number; y: number }> | null;
}

const vec = { x: 0, y: 0 };
const feet = { x: 0, y: 0 };

/** Fills `out` with the player's fight after the last tick. Returns `out.present`. */
export function sampleCombat(sim: Simulation, combat: CombatSystem, player: PlayerSystem, aim: AimSource, out: CombatSample): boolean {
  const body = player.body(sim);
  out.present = body !== undefined && player.position(sim, feet);
  if (!out.present || body === undefined) return false;
  const p = combat.state.player;
  const tickHz = sim.clock.tickHz;
  const point = aim.aimPoint;
  out.aimed = point !== null;
  out.aimX = point === null ? feet.x : point.x;
  out.aimY = point === null ? feet.y : point.y;
  out.aimAngle = combat.aimVector(sim, vec) ? aimAngle(vec.x, vec.y) : FACING_ANGLE[body.facing];
  out.fighting = combat.fighting(sim);
  out.phase = p.phase;
  out.phaseSeconds = p.phaseTicks / tickHz;
  out.phaseProgress = p.phaseTotal > 0 ? Math.min(1, p.phaseTicks / p.phaseTotal) : 0;
  const prof = combat.handProfile();
  out.klasse = prof.klasse;
  out.item = prof.item;
  out.heavy = p.heavy;
  out.combo = p.combo;
  out.tension = p.phase === 'spannen' && prof.drawTicks > 0 ? Math.min(1, p.phaseTicks / prof.drawTicks) : 0;
  const block = combat.effectiveBlock(sim);
  out.blocking = block !== null;
  out.blockKind = block === null ? null : block.kind;
  out.blockSeconds = block === null ? 0 : (sim.tick - p.blockSinceTick) / tickHz;
  out.hitstop = combat.frozen(sim.tick);
  out.staggered = combat.staggered(sim.tick);
  out.loaded = p.loaded !== '';
  return true;
}

/** The input probe of the session (src/game/input.ts): the item in the hand and the player's feet. */
export function combatInputProbe(sim: Simulation, inventory: InventorySystem, player: PlayerSystem): InputProbe {
  return {
    hand: (): ItemDef | null => {
      const s = inventory.selected();
      return s === null ? null : inventory.bags.catalog.get(s.item);
    },
    position: (out) => player.position(sim, out),
  };
}
