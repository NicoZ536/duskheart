/**
 * CPU time of a section of the frame path, measured in one call of every `CLOCK_SAMPLE_EVERY` (MASTERPROMPT §30
 * "keine Allokation im Frame-Pfad"): V8 hands out every reading of `performance.now()` as a fresh heap number, so a
 * section timed in every frame allocates in every frame. The debug views that show these times (`particleInfo`,
 * `waterInfo`) read a value at most `CLOCK_SAMPLE_EVERY` frames old; the first call is always measured.
 */

/** Calls between two measurements (half a second at 60 Hz). */
export const CLOCK_SAMPLE_EVERY = 32;

export class SampledClock {
  /** CPU time of the last measured call [ms]. */
  ms = 0;
  private calls = 0;
  private running = false;
  private startedAt = 0;

  /** Starts a call of the section; measures it when its turn has come. */
  begin(): void {
    const measure = this.calls === 0;
    this.running = measure;
    this.calls = this.calls + 1 === CLOCK_SAMPLE_EVERY ? 0 : this.calls + 1;
    if (measure) this.startedAt = performance.now();
  }

  /** Ends the call; returns true when it was measured (`ms` holds its time). */
  end(): boolean {
    if (!this.running) return false;
    this.running = false;
    this.ms = performance.now() - this.startedAt;
    return true;
  }
}
