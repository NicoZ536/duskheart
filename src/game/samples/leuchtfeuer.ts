/**
 * Samples of the bosses, the beacons and fast travel for the presentation (docs/SPIEL.md §30 "Bossbalken mit Phasenmarken,
 * Titelkarte (HUD) – sampleBoss", "`reisen` – sampleTravel", "`vision` – Content `visions`"; strand F, M7-32 … M7-37):
 * read-only views into the boss, beacon and travel systems, found once and kept. The boss bar is sampled every frame into a
 * held record (no allocation); the travel screen samples when it opens and after every trip.
 */
import { BeaconsSystem } from '../beacons/system';
import { BossesSystem } from '../bosses/system';
import type { BossSample } from '../bosses/types';
import type { Simulation } from '../sim';
import { TravelSystem } from '../travel/system';
import type { TravelSample } from '../travel/types';

/** A fresh boss sample (no boss awake). */
export function createBossSample(): BossSample {
  return { active: false, boss: '', health: 0, maxHealth: 0, phase: 0, phaseMarks: [], titleUntilTick: 0 };
}

/** A fresh travel sample (at no point). */
export function createTravelSample(): TravelSample {
  return { from: '', fromName: '', points: [], costs: [], blocked: 'notAtPoint' };
}

/** What the vision screen needs of a lit beacon: its number and whether its vision is still to be shown. */
export interface BeaconVisionSample {
  /** The lit beacon whose vision waits (0: none). */
  nummer: number;
}

/** Finds the boss, beacon and travel systems of a simulation once. */
export class LeuchtfeuerSampler {
  private bossSystem: BossesSystem | null | undefined = undefined;
  private beaconSystem: BeaconsSystem | null | undefined = undefined;
  private travelSystem: TravelSystem | null | undefined = undefined;

  private find<T>(sim: Simulation, type: abstract new (...args: never[]) => T): T | null {
    const s = sim.systems.find((x) => x instanceof type);
    return s instanceof type ? s : null;
  }

  /** The boss system, or null. */
  bosses(sim: Simulation): BossesSystem | null {
    if (this.bossSystem === undefined) this.bossSystem = this.find(sim, BossesSystem);
    return this.bossSystem;
  }

  /** The beacon system, or null. */
  beacons(sim: Simulation): BeaconsSystem | null {
    if (this.beaconSystem === undefined) this.beaconSystem = this.find(sim, BeaconsSystem);
    return this.beaconSystem;
  }

  /** The travel system, or null. */
  travel(sim: Simulation): TravelSystem | null {
    if (this.travelSystem === undefined) this.travelSystem = this.find(sim, TravelSystem);
    return this.travelSystem;
  }

  /** The awake boss for the HUD's bar and title card (`active` false without one or without the system). */
  boss(sim: Simulation, out: BossSample): BossSample {
    const b = this.bosses(sim);
    if (b === null) {
      out.active = false;
      return out;
    }
    return b.sample(out);
  }

  /** The player's sight in a boss's leaf storm (1 = none, or without the system): the HUD closes the view by it. */
  stormSight(sim: Simulation): number {
    return this.bosses(sim)?.playerStormSight(sim) ?? 1;
  }

  /** The travel points from where the player stands (`blocked` `notAtPoint` without the system). */
  travelPoints(sim: Simulation, out: TravelSample): TravelSample {
    const t = this.travel(sim);
    if (t === null) {
      out.from = '';
      out.fromName = '';
      out.points.length = 0;
      out.costs.length = 0;
      out.blocked = 'notAtPoint';
      return out;
    }
    return t.sample(sim, out);
  }

  /** The lit beacon whose vision has not been shown yet (the first), or 0. */
  pendingVision(sim: Simulation, out: BeaconVisionSample): BeaconVisionSample {
    out.nummer = 0;
    const b = this.beacons(sim);
    if (b === null) return out;
    for (let n = 1; n <= b.defs.length; n++) {
      const s = b.state(n);
      if (s.state === 'entzuendet' && !s.visionShown) {
        out.nummer = n;
        break;
      }
    }
    return out;
  }
}
