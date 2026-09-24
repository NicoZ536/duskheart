/**
 * Ambient light of the gameplay light map (MASTERPROMPT §12.1 "Umgebungslicht: Tag 1,0 (wetterabhängig
 * bis 0,6), Dämmerung verlaufend, Nacht 0,05–0,12 (Mondphase), Finstermond 0,02, Höhle 0").
 *
 * On the surface the night light of the moon phase (`nightAmbientLight`, src/world/calendar.ts) blends
 * with the daylight of the calendar into the day light, which the weather over the tile dims (its
 * `lightFactor`, 1 … 0,6 – src/content/weather.ts): full day = the weather's light factor, full night =
 * the moon's light, the twilights in between. Clouds do not change the night: §12.1 ties the night only
 * to the moon. Below the surface the ambient is `BALANCE.light.map.caveAmbient` (0).
 * Only + − × ÷, so the level is bit-identical on every engine.
 */
import { BALANCE } from '../../content/balance';
import { nightAmbientLight } from '../calendar';
import type { Layer } from '../model/coords';

/** Surface ambient for a daylight factor (0 night … 1 day), the night's moon phase and the weather's light factor. */
export function surfaceAmbient(daylight: number, moonPhase: number, weatherLightFactor: number): number {
  const night = nightAmbientLight(moonPhase);
  const day = BALANCE.calendar.dayAmbientLight * weatherLightFactor;
  return night + (day - night) * daylight;
}

/** Ambient light of a tile on `layer` (caves: `caveAmbient`). */
export function ambientLevel(layer: Layer, daylight: number, moonPhase: number, weatherLightFactor: number): number {
  return layer === 0 ? surfaceAmbient(daylight, moonPhase, weatherLightFactor) : BALANCE.light.map.caveAmbient;
}
