/**
 * Damage the player's own conditions and fear deal (bleeding, poison, burning, harmful hallucinations;
 * MASTERPROMPT §11.3, §12.3) and the recognition of hits (§11.4 "Essen/Trinken (unterbrechbar)", §11.5
 * "Angriffe wecken").
 *
 * - `hurtPlayer`: lowers health (not below 0) and restarts the 5 s without damage before health
 *   regenerates (§11.1), exactly as the vitals system does for its own damage.
 * - `PlayerHarm.hurt`: `hurtPlayer` unless the debug cheat `god` is on (then nothing: no damage, no hit).
 * - `PlayerHarm`: which hits the player took *in this tick*. A hit is instant damage: every
 *   `playerDamaged` of this tick whose cause is not damage over time (falls today, attacks later) and every
 *   hit of the systems here (`markHit`). Only the running tick counts, so the result does not depend on
 *   when the presentation drains the event queue (replays stay exact); systems that deal hits must run
 *   before the systems that react to them (`addPlayerLifeSystems`, src/game/death/life.ts, registers that order). `lethalCause` names what
 *   brought health to 0 in this tick.
 */
import type { Entity } from '../../engine/ecs';
import { createDebugCheats, type DebugCheats } from '../cheats/state';
import type { SimEventMap, Simulation } from '../sim';
import { CONTINUOUS_DAMAGE_CAUSES, type Vitals } from '../survival/state';

/** Where the damage of the systems here comes from: a condition or a hallucination. */
export const AFFLICTION_SOURCES = ['zustand', 'trugbild'] as const;
/** One affliction source. */
export type AfflictionSource = (typeof AFFLICTION_SOURCES)[number];

/** Payload of `playerAfflicted`: damage of a condition (once per second) or a hallucination (at once). */
export interface PlayerAfflictedEvent {
  readonly entity: Entity;
  readonly source: AfflictionSource;
  /** Condition id or hallucination id. */
  readonly id: string;
  /** Health lost [HP]. */
  readonly amount: number;
  /** Health afterwards [HP]. */
  readonly health: number;
  readonly lethal: boolean;
  readonly tick: number;
}

/** Lowers the health of `v` by `amount` [HP] (not below 0) and restarts the regeneration delay; returns the damage dealt. */
export function hurtPlayer(v: Vitals, amount: number): number {
  if (!(amount > 0) || v.health <= 0) return 0;
  const dealt = Math.min(amount, v.health);
  v.health -= dealt;
  v.damageFreeTicks = 0;
  return dealt;
}

const CONTINUOUS: ReadonlySet<string> = new Set(CONTINUOUS_DAMAGE_CAUSES);

/** Hits of the running tick (see module comment). */
export class PlayerHarm {
  private hitTick = -1;
  private lethalTick = -1;
  private lethalId = '';
  /** Result of the last scan of the tick's `playerDamaged` events (one scan per tick, no allocation). */
  private scanTick = -1;
  private scanHit = false;
  private scanCause: string | null = null;
  private readonly cheats: Readonly<DebugCheats>;

  /** `cheats`: the debug switches (`god` spares the player); absent = every cheat off. */
  constructor(cheats: Readonly<DebugCheats> = createDebugCheats()) {
    this.cheats = cheats;
  }

  /** Whether god mode spares the player every damage (debug cheat `god`). */
  get spared(): boolean {
    return this.cheats.god;
  }

  /** Damage of a condition or hallucination: `hurtPlayer`, or nothing in god mode. Returns the damage dealt. */
  hurt(v: Vitals, amount: number): number {
    return this.cheats.god ? 0 : hurtPlayer(v, amount);
  }

  private readonly onDamaged = (p: SimEventMap['playerDamaged']): void => {
    if (p.tick !== this.scanTick) return;
    if (!CONTINUOUS.has(p.cause)) this.scanHit = true;
    if (p.lethal) this.scanCause = p.cause;
  };

  /** Records a hit of one of the systems here in this tick; `lethal` names its cause for the death screen. */
  markHit(sim: Simulation, cause: string, lethal: boolean): void {
    this.hitTick = sim.eventTick;
    if (lethal) this.markLethal(sim, cause);
  }

  /** Records what brought health to 0 in this tick (damage over time of a condition, a hit). */
  markLethal(sim: Simulation, cause: string): void {
    this.lethalTick = sim.eventTick;
    this.lethalId = cause;
  }

  /** Whether the player took a hit in this tick (instant `playerDamaged` or `markHit`). */
  hitThisTick(sim: Simulation): boolean {
    if (this.hitTick === sim.eventTick) return true;
    this.scan(sim);
    return this.scanHit;
  }

  /**
   * What brought the player's health to 0 in this tick: a cause recorded here, else the lethal
   * `playerDamaged` of this tick (its cause), else `null`.
   */
  lethalCause(sim: Simulation): string | null {
    if (this.lethalTick === sim.eventTick) return this.lethalId;
    this.scan(sim);
    return this.scanCause;
  }

  /** Reads the `playerDamaged` events of the running tick (pushed by the systems before the caller). */
  private scan(sim: Simulation): void {
    this.scanTick = sim.eventTick;
    this.scanHit = false;
    this.scanCause = null;
    sim.events.forEachOfType('playerDamaged', this.onDamaged);
  }
}
