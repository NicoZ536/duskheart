/**
 * Light as the creatures read it (MASTERPROMPT §12, §19.4; docs/SPIEL.md §11 "Wahrnehmung", "Schattenbrut-Licht"):
 * the gameplay light map's tile levels (shadow brood avoids and burns in light, spawns only in the dark), the level at a
 * point (the light at the player scales sight), whether the player carries a burning light (seen twice as far), and
 * the path sampler that marks bright tiles for light-avoiding path requests (`lightListSampler`, M6-16c).
 * `lightSystemCreatureLight` reads the light system of the game; tests hand in their own.
 */
import { ambientLevel } from '../../world/lightmap/ambient';
import type { Layer } from '../../world/model/coords';
import type { MapLight } from '../../world/lightmap/lightmap';
import { lightListSampler, type LightListInputs, type PathLightSampler, type TileLightLevels } from '../../world/path/light';
import type { LightSystem } from '../light/system';
import type { Simulation } from '../sim';

/** The light the creatures read. */
export interface CreatureLight {
  /** Light level at the centre of tile (tx, ty) of `layer` (the gameplay light map). */
  tileLevel(sim: Simulation, layer: Layer, tx: number, ty: number): number;
  /**
   * `tileLevel` into `out[index]` (M6-16f): the form the creature tick reads every tick – a level returned from a call
   * that is not inlined is a new heap number, an out parameter is not. Typed `undefined`, so a function that returns the
   * level instead of writing it does not compile.
   */
  tileLevelInto(sim: Simulation, layer: Layer, tx: number, ty: number, out: Float64Array, index: number): undefined;
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

/**
 * The creatures' light over the game's light system, and the inputs of its path sampler (`lightListSampler`). Methods of
 * one class rather than closures made per world (M6-16f): a shadow brood reads the light of its tile every tick, and a
 * call whose target changes with every new world (a load, the next bench round) would stay unoptimised.
 */
class LightSystemCreatureLight implements CreatureLight, LightListInputs {
  readonly paths: PathLightSampler;

  constructor(
    private readonly sim: Simulation,
    private readonly light: LightSystem,
    private readonly calendar: AmbientClock,
  ) {
    this.paths = lightListSampler(this);
  }

  tileLevel(sim: Simulation, layer: Layer, tx: number, ty: number): number {
    return this.light.mapFor(sim).tileLevel(layer, tx, ty);
  }

  tileLevelInto(sim: Simulation, layer: Layer, tx: number, ty: number, out: Float64Array, index: number): undefined {
    out[index] = this.light.mapFor(sim).tileLevel(layer, tx, ty);
    return undefined;
  }

  levelAt(sim: Simulation, layer: Layer, x: number, y: number): number {
    return this.light.levelAt(sim, layer, x, y);
  }

  playerLit(sim: Simulation): boolean {
    const list = this.light.sources(sim);
    for (let i = 0; i < list.length; i++) {
      const mount = list[i]?.mount;
      if (mount === 'hand' || mount === 'guertel') return true;
    }
    return false;
  }

  // The path sampler's inputs (the light system's list and map of the simulation it belongs to).
  lights(): readonly MapLight[] {
    return this.light.sources(this.sim);
  }

  levels(): TileLightLevels {
    return this.light.mapFor(this.sim);
  }

  /** The weather only dims the day (§12.1), so the calendar's light without weather bounds every tile. */
  ambientBound(layer: Layer): number {
    return ambientLevel(layer, this.calendar.daylight, this.calendar.moonPhase, 1);
  }
}

/** The light of the game's light system (`sim` is the simulation it belongs to; the path sampler has no other way to it). */
export function lightSystemCreatureLight(sim: Simulation, light: LightSystem, calendar: AmbientClock): CreatureLight {
  return new LightSystemCreatureLight(sim, light, calendar);
}
