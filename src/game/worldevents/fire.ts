/**
 * The forest fire's dry storm (M7-40; MASTERPROMPT §10 "Waldbrand (Sommer, Blitz)"; docs/SPIEL.md §18): a summer thunderstorm
 * whose rain evaporates before it reaches the ground. While the forest fire runs (`WorldEventsSystem.dry`), the fire
 * simulation (M4-28) reads its climate without the rain that puts fires out – the wind stays, so the flames the lightning
 * lit spread with it instead of drowning in the storm's first second. `createSimulation` wraps the world's fire environment
 * with `dryStormEnvironment`; the climate is recorded per second, so a chunk that catches up burns the same.
 */
import { climateCode, codeWet } from '../fire/formulas';
import type { FireEnvironment } from '../fire/system';

/** The bit of a climate code that says rain puts fires out (the codes of a wet and a dry calm differ only in it). */
const WET_BIT = climateCode(1, 0, 0) ^ climateCode(0, 0, 0);

/** `code` without its rain (wind class and direction kept). */
export function withoutRain(code: number): number {
  return codeWet(code) ? code & ~WET_BIT : code;
}

/** `base` whose climate has no rain while `dry()` holds (the forest fire runs). */
export function dryStormEnvironment(base: FireEnvironment, dry: () => boolean): FireEnvironment {
  return {
    active: base.active,
    region: base.region,
    regions: base.regions,
    climate: (sim, region) => {
      const code = base.climate(sim, region);
      return dry() ? withoutRain(code) : code;
    },
  };
}
