/**
 * Light as the creatures read it (MASTERPROMPT §12, §19.4; docs/SPIEL.md §11 "Wahrnehmung", "Schattenbrut-Licht"):
 * the gameplay light map's tile levels (shadow brood avoids and burns in light, spawns only in the dark), the level at a
 * point (the light at the player scales sight), whether the player carries a burning light (seen twice as far), and
 * the path sampler that marks bright tiles for light-avoiding path requests (`lightListSampler`, M6-16c).
 * `lightSystemCreatureLight` reads the light system of the game; tests hand in their own.
 */
import { ambientLevel } from '../../world/lightmap/ambient';
import type { Layer } from '../../world/model/coords';
import { lightListSampler, type PathLightSampler } from '../../world/path/light';
import type { LightSystem } from '../light/system';
import type { Simulation } from '../sim';

/** The light the creatures read. */
export interface CreatureLight {
  /** Light level at the centre of tile (tx, ty) of `layer` (the gameplay light map). */
  tileLevel(sim: Simulation, layer: Layer, tx: number, ty: number): number;
  /** Light level at world px (x, y) of `layer`. */
  levelAt(sim: Simulation, layer: Layer, x: number, y: number): number;
  /** Whether the player carries a burning light (in the hand or on the belt). */
  playerLit(sim: Simulation): boolean;
  /** Marks bright tiles for path requests that avoid light. */
  readonly paths: PathLightSampler;
}

/** The daylight and moon the ambient bound needs (the world's calendar). */
export interface AmbientClock {
  readonly daylight: number;
  readonly moonPhase: number;
}

/** The light of the game's light system (`sim` is the simulation it belongs to; the path sampler has no other way to it). */
export function lightSystemCreatureLight(sim: Simulation, light: LightSystem, calendar: AmbientClock): CreatureLight {
  return {
    tileLevel: (s, layer, tx, ty) => light.mapFor(s).tileLevel(layer, tx, ty),
    levelAt: (s, layer, x, y) => light.levelAt(s, layer, x, y),
    playerLit(s) {
      const list = light.sources(s);
      for (let i = 0; i < list.length; i++) {
        const mount = list[i]?.mount;
        if (mount === 'hand' || mount === 'guertel') return true;
      }
      return false;
    },
    paths: lightListSampler({
      lights: () => light.sources(sim),
      levels: () => light.mapFor(sim),
      // The weather only dims the day (§12.1), so the calendar's light without weather bounds every tile.
      ambientBound: (layer) => ambientLevel(layer, calendar.daylight, calendar.moonPhase, 1),
    }),
  };
}
