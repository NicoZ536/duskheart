/**
 * Timing of the contextual HUD (M3-27, §26 "Kontextuell"): when a display fades in and out, and what
 * counts as a sudden change. Everything runs on simulation ticks, not on the wall clock – a paused game
 * keeps its HUD as it is, a screenshot scenario with frozen time is deterministic, and a burst of catch-up
 * ticks in one frame is judged by game time. Pure classes, unit-tested (tests/unit/ui/hud-kontext.test.ts).
 *
 * - `Einblendung`: a display is shown while it is relevant and `NACHLAUF_S` longer; then it fades out in
 *   `AUSBLEND_STUFEN` hard steps of `STUFE_S` each (pixel art has no soft alpha ramps; with reduced
 *   motion it disappears at once). It returns the visible step: `VOLL` … 1, 0 = gone.
 * - `Aenderungswaechter`: a value that moves by at least `SCHRITT` within `FENSTER_S` changed suddenly
 *   (eating, a hit, sprinting); slow drifts – satiety −1 point every 20 s – never count.
 */
import { BALANCE } from '../../content/balance';

/** Shown step: fully visible. */
export const VOLL = 3;
/** Fade steps after the linger time (3 → 2 → 1 → gone). */
export const AUSBLEND_STUFEN = VOLL;
/** Time a display stays after it stopped being relevant [s]: long enough to read the new value. */
export const NACHLAUF_S = 3;
/** Duration of one fade step [s]: three steps read as a fade, not as flicker. */
export const STUFE_S = 0.12;
/** Least change that counts as sudden [points]: one whole point, the smallest visible step of a bar. */
export const SCHRITT = 1;
/** Window of a sudden change [s]: a point within a second is faster than any natural drain (§11.1). */
export const FENSTER_S = 1;

const TICK_HZ = BALANCE.time.tickHz;

export class Einblendung {
  /** Tick at which the display was last relevant (`null`: never). */
  private zuletzt: number | null = null;

  /** The visible step at `tick` (`VOLL` … 1, 0 = hidden) after reporting whether the display is relevant now. */
  stufe(tick: number, relevant: boolean, bewegungReduziert = false): number {
    if (relevant) {
      this.zuletzt = tick;
      return VOLL;
    }
    if (this.zuletzt === null) return 0;
    const vergangen = (tick - this.zuletzt) / TICK_HZ;
    if (vergangen < NACHLAUF_S) return VOLL;
    if (bewegungReduziert) return 0;
    const schritt = Math.floor((vergangen - NACHLAUF_S) / STUFE_S);
    return schritt >= AUSBLEND_STUFEN ? 0 : AUSBLEND_STUFEN - schritt;
  }

  /** Forgets the history (the display is hidden until it is relevant again). */
  zuruecksetzen(): void {
    this.zuletzt = null;
  }
}

export class Aenderungswaechter {
  private bezug = 0;
  private bezugTick: number | null = null;

  /** Reports `wert` at `tick`; true when it moved by `SCHRITT` or more within `FENSTER_S` since the reference. */
  melde(wert: number, tick: number): boolean {
    if (this.bezugTick === null || tick < this.bezugTick) {
      this.bezug = wert;
      this.bezugTick = tick;
      return false;
    }
    const fenster = FENSTER_S * TICK_HZ;
    if (Math.abs(wert - this.bezug) >= SCHRITT) {
      const schnell = tick - this.bezugTick <= fenster;
      this.bezug = wert;
      this.bezugTick = tick;
      return schnell;
    }
    if (tick - this.bezugTick > fenster) {
      this.bezug = wert;
      this.bezugTick = tick;
    }
    return false;
  }
}
