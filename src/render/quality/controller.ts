/**
 * The quality level of a renderer at runtime (MASTERPROMPT §6.3, M5-25/M5-26): applies the player settings to every
 * strand (`levels.ts`) whenever they change – the next frame renders at the new level, no reload –, lets a screenshot
 * scenario render at a level of its own without touching the settings, runs the first-start benchmark
 * (`autoPreset.ts`) and halves the light buffer on frame drops (`lightBuffer.ts`).
 *
 * The page drives it once per presented frame (`frame`); while the benchmark measures, the page times each frame
 * until the GPU has finished it and hands the time in (`benchmarkSample`). All clocks come in as arguments.
 */
import type { QualityLevel } from '../../engine/settings';
import { AutoPresetBenchmark, type AutoPresetResult } from './autoPreset';
import { LightBufferGovernor, type LightBufferVerdict } from './lightBuffer';
import { applyRenderQuality, atLevel, renderQualityFrom, type GiSlot, type QualityInput, type QualityTargets, type RenderQuality } from './levels';
import { AUTO_PRESET, TARGET_FRAME_MS } from './params';

const MS_PER_SECOND = 1000;

/**
 * How the light buffer is chosen: `auto` – the governor halves it on frame drops (when the setting
 * `graphics.adaptiveLightBuffer` allows); `full` / `half` – fixed (debug pages start at `full`: their frames must be
 * reproducible, `__dh.call('lightBuffer', mode)` switches).
 */
export const LIGHT_BUFFER_MODES = ['auto', 'full', 'half'] as const;
export type LightBufferMode = (typeof LIGHT_BUFFER_MODES)[number];
export function isLightBufferMode(v: unknown): v is LightBufferMode {
  return (LIGHT_BUFFER_MODES as readonly unknown[]).includes(v);
}

/** Where the level being rendered comes from. */
export type QualitySource = 'einstellungen' | 'szenario' | 'benchmark';

/** Phases of the first-start benchmark. */
export type BenchmarkPhase = 'aus' | 'wartet' | 'misst' | 'fertig' | 'abgebrochen';

/** The light pass part the controller switches (the light pipeline's `lighting`). */
export interface HalvableLightPass {
  halfResolution: boolean;
}

export interface QualityControllerTargets extends QualityTargets {
  readonly lighting: QualityTargets['lighting'] & { readonly lighting: HalvableLightPass };
}

/** What the controller reports (F3 overlay, `__dh.call('quality')`). */
export interface QualityState {
  /** The level rendered now. */
  readonly level: QualityLevel;
  readonly source: QualitySource;
  /** The level of the player settings. */
  readonly settingsLevel: QualityLevel;
  /** The detail options are the level's preset. */
  readonly preset: boolean;
  readonly gi: GiSlot;
  readonly lightBuffer: {
    readonly mode: LightBufferMode;
    /** The setting allows halving on frame drops. */
    readonly adaptive: boolean;
    /** The light pass draws into the halved buffer. */
    readonly halved: boolean;
    readonly governor: LightBufferVerdict;
  };
  readonly benchmark: {
    readonly phase: BenchmarkPhase;
    /** Level being measured (while `misst`). */
    readonly level: QualityLevel | null;
    readonly result: AutoPresetResult | null;
    /** Why it stopped without a result (`abgebrochen`). */
    readonly reason: string | null;
  };
  /** The settings every strand got. */
  readonly strands: RenderQuality;
}

export class QualityController {
  private input: QualityInput;
  private override: QualityLevel | null = null;
  private resolved: RenderQuality;
  private rendered: QualityLevel;
  private source: QualitySource = 'einstellungen';
  readonly governor = new LightBufferGovernor();
  private mode: LightBufferMode = 'auto';
  private lastFrameAt = Number.NaN;
  private bench: AutoPresetBenchmark | null = null;
  private phase: BenchmarkPhase = 'aus';
  private waitingSince = Number.NaN;
  private benchResult: AutoPresetResult | null = null;
  private cancelReason: string | null = null;
  private onBenchmarkDone: ((result: AutoPresetResult) => void) | null = null;

  constructor(
    private readonly targets: QualityControllerTargets,
    input: QualityInput,
  ) {
    this.input = input;
    this.resolved = renderQualityFrom(input);
    this.rendered = input.graphics.quality;
    this.refresh();
  }

  /** The player settings changed (or were loaded): every strand follows from the next frame on. */
  apply(input: QualityInput): void {
    this.input = input;
    this.refresh();
  }

  /** A scenario renders at `level` (null: the settings' level again); the settings stay as they are. */
  setOverride(level: QualityLevel | null): void {
    this.override = level;
    this.refresh();
  }

  setLightBufferMode(mode: LightBufferMode): void {
    this.mode = mode;
    if (mode === 'auto') this.governor.reset();
    this.updateLightBuffer();
  }

  get lightBufferMode(): LightBufferMode {
    return this.mode;
  }

  /** One presented frame at page time `nowMs`: the governor sees the interval since the previous one. */
  frame(nowMs: number): void {
    const last = this.lastFrameAt;
    this.lastFrameAt = nowMs;
    if (Number.isNaN(last)) return;
    this.governor.frame(nowMs - last);
    this.updateLightBuffer();
  }

  // -------------------------------------------------------------------------------------------------------------
  // First-start benchmark

  /** Starts the benchmark: it waits for the scene to be complete (`benchmarkTick`), then measures level by level. */
  startBenchmark(onDone: (result: AutoPresetResult) => void, nowMs: number): void {
    this.bench = new AutoPresetBenchmark();
    this.benchResult = null;
    this.cancelReason = null;
    this.onBenchmarkDone = onDone;
    this.phase = 'wartet';
    this.waitingSince = nowMs;
    this.refresh();
  }

  /** Whether the next frame is a measured benchmark frame (the page times it until the GPU has finished). */
  get benchmarkMeasuring(): boolean {
    return this.phase === 'misst';
  }

  get benchmarkPhase(): BenchmarkPhase {
    return this.phase;
  }

  /**
   * Before a frame while the benchmark waits: once the scene is complete it starts measuring; a scene that is not
   * complete within `AUTO_PRESET.readyTimeoutMs` cancels it (the settings keep their level, the next start tries again).
   */
  benchmarkTick(nowMs: number, sceneReady: boolean): void {
    if (this.phase !== 'wartet') return;
    if (sceneReady) {
      this.phase = 'misst';
      this.refresh();
    } else if (nowMs - this.waitingSince > AUTO_PRESET.readyTimeoutMs) this.cancelBenchmark('szene-nicht-bereit');
  }

  /** The time of one measured frame [ms] (CPU preparation until the GPU finished it). */
  benchmarkSample(frameMs: number): void {
    const bench = this.bench;
    if (this.phase !== 'misst' || bench === null) return;
    if (!bench.sample(frameMs)) return;
    const result = bench.result;
    if (result === null) {
      this.refresh();
      return;
    }
    this.benchResult = result;
    this.phase = 'fertig';
    this.bench = null;
    // The measured frames waited for the GPU: the frame times start afresh at the chosen level.
    this.governor.reset();
    const done = this.onBenchmarkDone;
    this.onBenchmarkDone = null;
    this.refresh();
    done?.(result);
  }

  /** Stops the benchmark without a result (the player chose a level, the context was lost, the scene never came). */
  cancelBenchmark(reason: string): void {
    if (this.phase !== 'wartet' && this.phase !== 'misst') return;
    this.bench = null;
    this.onBenchmarkDone = null;
    this.phase = 'abgebrochen';
    this.cancelReason = reason;
    this.governor.reset();
    this.refresh();
  }

  // -------------------------------------------------------------------------------------------------------------

  get quality(): RenderQuality {
    return this.resolved;
  }

  state(): QualityState {
    const r = this.resolved;
    return {
      level: this.rendered,
      source: this.source,
      settingsLevel: this.input.graphics.quality,
      preset: r.preset,
      gi: r.gi,
      lightBuffer: { mode: this.mode, adaptive: r.adaptiveLightBuffer, halved: this.targets.lighting.lighting.halfResolution, governor: this.governor.verdict() },
      benchmark: { phase: this.phase, level: this.phase === 'misst' ? (this.bench?.level ?? null) : null, result: this.benchResult, reason: this.cancelReason },
      strands: r,
    };
  }

  /** Resolves the level to render (benchmark, scenario, settings) and configures every strand with it. */
  private refresh(): void {
    const measuring = this.phase === 'misst' && this.bench !== null;
    const level = measuring ? (this.bench as AutoPresetBenchmark).level : this.override;
    this.source = measuring ? 'benchmark' : this.override !== null ? 'szenario' : 'einstellungen';
    const input = level === null ? this.input : atLevel(this.input, level);
    this.resolved = renderQualityFrom(input);
    this.rendered = input.graphics.quality;
    applyRenderQuality(this.targets, this.resolved);
    const limit = input.graphics.fpsLimit;
    this.governor.setTarget(limit > 0 ? Math.max(TARGET_FRAME_MS, MS_PER_SECOND / limit) : TARGET_FRAME_MS);
    this.updateLightBuffer();
  }

  private updateLightBuffer(): void {
    // The benchmark measures each level as it is: never with the halved buffer.
    const half = this.phase !== 'misst' && (this.mode === 'half' || (this.mode === 'auto' && this.resolved.adaptiveLightBuffer && this.governor.halved));
    this.targets.lighting.lighting.halfResolution = half;
  }
}
