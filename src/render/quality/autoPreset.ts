/**
 * First-start benchmark (MASTERPROMPT §6.3 "Automatische Voreinstellung per kurzem Benchmark beim ersten Start",
 * M5-26): renders the scene behind the title at each quality level in turn, from the lowest up, and picks the highest
 * level whose frames fit the budget. A pure state machine – the page renders at `level`, times each frame (CPU
 * preparation until the GPU has finished it) and feeds the time in with `sample`.
 *
 * Per level the first `warmupFrames` frames are discarded (programs compiled, pools and effects filled on the switch),
 * then the median of `sampleFrames` frames judges. The first level over the budget ends the run: its predecessor is
 * the result (the lowest level if even that one is over – a slow device still plays, at "Niedrig"). A device fast
 * enough for every level gets the highest one.
 */
import { QUALITY_LEVELS, type QualityLevel } from '../../engine/settings';
import { AUTO_PRESET } from './params';

export type AutoPresetParams = typeof AUTO_PRESET;

export interface AutoPresetResult {
  /** The chosen level. */
  readonly level: QualityLevel;
  /** Median frame time per measured level [ms], in the order measured. */
  readonly medians: ReadonlyArray<{ readonly level: QualityLevel; readonly ms: number }>;
  /** The level that exceeded the budget and ended the run (null: every level fit). */
  readonly overBudget: QualityLevel | null;
}

/** Median of the first `n` values of `values` (sorted in place). */
export function medianOf(values: Float64Array, n: number): number {
  if (n <= 0) return Number.NaN;
  const v = values.subarray(0, n).sort();
  const m = n >> 1;
  return n % 2 === 1 ? (v[m] as number) : ((v[m - 1] as number) + (v[m] as number)) / 2;
}

export class AutoPresetBenchmark {
  private index = 0;
  private frames = 0;
  private count = 0;
  private readonly samples: Float64Array;
  private readonly medians: Array<{ level: QualityLevel; ms: number }> = [];
  private resultValue: AutoPresetResult | null = null;

  constructor(
    private readonly params: AutoPresetParams = AUTO_PRESET,
    private readonly levels: readonly QualityLevel[] = QUALITY_LEVELS,
  ) {
    if (levels.length === 0) throw new RangeError('AutoPresetBenchmark braucht mindestens eine Stufe');
    this.samples = new Float64Array(Math.max(1, params.sampleFrames));
  }

  /** The level the next frame renders at (the chosen one once done). */
  get level(): QualityLevel {
    return this.resultValue?.level ?? (this.levels[this.index] as QualityLevel);
  }

  get done(): boolean {
    return this.resultValue !== null;
  }

  get result(): AutoPresetResult | null {
    return this.resultValue;
  }

  /** Measured frames of the current level so far (warm-up frames not counted). */
  get measured(): number {
    return this.count;
  }

  /** The time of one frame rendered at `level` [ms]; returns true when the level to render changed (or the run ended). */
  sample(frameMs: number): boolean {
    if (this.resultValue !== null || !(frameMs >= 0) || !Number.isFinite(frameMs)) return false;
    this.frames++;
    if (this.frames <= this.params.warmupFrames) return false;
    this.samples[this.count++] = frameMs;
    if (this.count < this.params.sampleFrames) return false;
    const level = this.levels[this.index] as QualityLevel;
    const ms = medianOf(this.samples, this.count);
    this.medians.push({ level, ms });
    if (ms > this.params.budgetMs) {
      this.finish(this.levels[Math.max(0, this.index - 1)] as QualityLevel, level);
    } else if (this.index === this.levels.length - 1) {
      this.finish(level, null);
    } else {
      this.index++;
      this.frames = 0;
      this.count = 0;
    }
    return true;
  }

  private finish(level: QualityLevel, overBudget: QualityLevel | null): void {
    this.resultValue = { level, medians: this.medians.slice(), overBudget };
  }
}
