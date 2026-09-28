/**
 * Weathering of the world surface (MASTERPROMPT §6.2 "Nässe: … trocknet langsam ab", "Schneemaske, die mit Schneefall
 * wächst"; M5-19, M5-20): the ground's wetness, the puddles and the snow cover as they build up and fade over game
 * time. The weather itself is the simulation's (a pure function of seed, regions and calendar, M2-26); what lies on
 * the ground is presentation – integrated here from the weather at the camera, frame by frame over the game minutes
 * that passed (a time skip integrates its whole span with the weather at its end).
 *
 * A view that sees the world for the first time (a loaded game, a teleport to another layer) starts from the
 * weather's steady state: wet while it rains, snow-covered where it is freezing.
 */
import { SURFACE_PARAMS } from './params';

const P = SURFACE_PARAMS;
/** Longest span integrated at once [game minutes]; beyond it the steady state of the current weather is taken. */
const MAX_SPAN_MINUTES = 7 * 24 * 60;
/** Temperature above which heat speeds up drying [°C]. */
const WARM_DRYING_FROM_C = 15;

/** The weather at the camera that the ground reacts to. */
export interface GroundWeather {
  /** Falling rain 0…1 (0 when the precipitation is not rain). */
  rain: number;
  /** Falling snow 0…1. */
  snow: number;
  /** Air temperature at the camera [°C]. */
  temperatureC: number;
  /** Whether it is winter (a first sight of the world outside winter finds no old snow, only what falls now). */
  winter: boolean;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Wetness gain per minute of `rain`. */
function wetRate(rain: number): number {
  return P.wet.wetPerMinute * clamp01(rain);
}

/** Drying per minute at `temperatureC`. */
function dryRate(temperatureC: number): number {
  return P.wet.dryPerMinute + Math.max(0, temperatureC - WARM_DRYING_FROM_C) * P.wet.dryPerMinuteC;
}

/** Wetness the ground settles at under `w`. */
export function steadyWetness(w: GroundWeather): number {
  const a = wetRate(w.rain);
  return a <= 0 ? 0 : a / (a + dryRate(w.temperatureC));
}

/** Puddle fill wetness `wet` sustains: none below `puddleFrom`, full on soaked ground. */
export function puddleTarget(wet: number): number {
  const from = P.wet.puddleFrom;
  return wet <= from ? 0 : clamp01((wet - from) / (1 - from));
}

/** Snow cover of a world first seen at `temperatureC`: full at or below `coldC`, none at or above `warmC`. */
export function steadySnow(temperatureC: number): number {
  const s = P.snow;
  return clamp01((s.warmC - temperatureC) / (s.warmC - s.coldC));
}

export class Weathering {
  wetness = 0;
  puddles = 0;
  snow = 0;
  /** Game minute of the last step; NaN before the first. */
  private minute = Number.NaN;

  /** Whether the next step starts from the steady state (nothing integrated yet). */
  get fresh(): boolean {
    return !Number.isFinite(this.minute);
  }

  /** Forgets the history: the next step starts from the steady state of its weather. */
  reset(): void {
    this.minute = Number.NaN;
  }

  /** Brings the ground to game minute `minute` under weather `w`. */
  step(minute: number, w: GroundWeather): void {
    const dt = minute - this.minute;
    this.minute = minute;
    if (!(dt >= 0) || dt > MAX_SPAN_MINUTES) {
      this.wetness = steadyWetness(w);
      this.puddles = puddleTarget(this.wetness);
      this.snow = w.snow > 0 && w.temperatureC < P.snow.meltFromC ? Math.max(steadySnow(w.temperatureC), clamp01(w.snow)) : steadySnow(w.temperatureC);
      // Outside winter only permanently frozen places (the high Frostkamm) carry old snow; elsewhere what falls now.
      if (!w.winter && w.temperatureC > P.snow.permanentBelowC) this.snow = w.snow > 0 ? Math.min(this.snow, clamp01(w.snow)) : 0;
      return;
    }
    if (dt === 0) return;
    // Wetness: dw/dt = a (1 − w) − d w, solved exactly over the span.
    const a = wetRate(w.rain);
    const k = a + dryRate(w.temperatureC);
    const eq = a / k;
    this.wetness = clamp01(eq + (this.wetness - eq) * Math.exp(-k * dt));
    // Puddles follow the wetness: they fill fast while it rains and dry slowly.
    const target = puddleTarget(this.wetness);
    const diff = target - this.puddles;
    this.puddles = clamp01(this.puddles + (diff > 0 ? Math.min(diff, P.wet.puddleFillPerMinute * dt) : Math.max(diff, -P.wet.puddleDryPerMinute * dt)));
    // Snow: falling snow builds up, warmth melts it.
    const melt = Math.max(0, w.temperatureC - P.snow.meltFromC) * P.snow.meltPerMinuteC;
    this.snow = clamp01(this.snow + (P.snow.growPerMinute * clamp01(w.snow) - melt) * dt);
  }
}
