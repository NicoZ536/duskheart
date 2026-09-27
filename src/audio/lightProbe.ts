/**
 * The kind of a placed light (M4-29, one sound per moment): `fireFueled` names the light only by its id, and fuel on a
 * fire – a log thunking onto the embers – sounds different from resin put into a lamp's bowl. Read from the light
 * system like the renderer reads it (src/audio/eventMap.ts `EventSfxContext.placedLightKind`).
 */
import { LightSystem } from '../game/light/system';
import type { Simulation } from '../game/sim';

/** Finds the kind of a placed light (the light system is looked up once per simulation). */
export class LightProbe {
  private sim: Simulation | null = null;
  private light: LightSystem | null = null;

  /** The light kind (src/content/lights.ts) of placed light `id`, or null when there is no such light. */
  kindOf(sim: Simulation, id: number): string | null {
    if (this.sim !== sim) {
      this.sim = sim;
      this.light = null;
      for (const s of sim.systems) if (s instanceof LightSystem) this.light = s;
    }
    return this.light?.placed(id)?.kind ?? null;
  }
}
