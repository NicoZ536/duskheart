/**
 * Wind of the world surface (MASTERPROMPT §6.2 "Wind: … Windstärke und -richtung aus dem Wetter", M5-17): the
 * weather gives the strength (`WeatherSample.wind`, blended over a weather change) and the simulation the direction
 * of each weather period (`windDirection`, the same eight directions the fire spreads with, M4-28). While a new
 * period blends in, the direction turns along the shorter arc with the weather's own blend, so the grass never
 * snaps round.
 */
import { DIR_DX, DIR_DY } from '../../game/fire/formulas';
import { SURFACE_PARAMS } from './params';

const DIRECTIONS = DIR_DX.length;
const TAU = Math.PI * 2;

/** Angle [rad, screen space: +x east, +y south] of direction `dir` (0 north … 7 north-west). */
export function directionAngle(dir: number): number {
  const d = ((Math.floor(dir) % DIRECTIONS) + DIRECTIONS) % DIRECTIONS;
  return Math.atan2(DIR_DY[d] as number, DIR_DX[d] as number);
}

/** Angle between `from` and `to` at share `t` along the shorter arc. */
export function turnAngle(from: number, to: number, t: number): number {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return from + delta * Math.min(1, Math.max(0, t));
}

/** The wind vector a frame sways with. */
export interface WindVector {
  x: number;
  y: number;
  /** Gust strength 0…1 (the weather's wind strength: gusts roll over the meadows only when it blows). */
  gust: number;
}

/**
 * Wind vector from the weather: strength 0…1, the direction of the previous and of the current period, and the
 * blend between them (0 = previous … 1 = current). Writes into `out`.
 */
export function windVector(strength: number, previousDir: number, currentDir: number, blend: number, out: WindVector): WindVector {
  const s = Math.min(1, Math.max(0, strength));
  const a = turnAngle(directionAngle(previousDir), directionAngle(currentDir), blend);
  const len = s * SURFACE_PARAMS.wind.scale;
  out.x = Math.cos(a) * len;
  out.y = Math.sin(a) * len;
  out.gust = s;
  return out;
}
