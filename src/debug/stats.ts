/**
 * Performance statistics for the F3 overlay (MASTERPROMPT §30, §31.6).
 * Values live in Preact signals so the overlay re-renders only what changed;
 * producers (loop, renderer, ECS) push samples via `updateDebugStats`.
 */
import { batch, signal, type Signal } from '@preact/signals';

export interface DebugStatsSnapshot {
  fps: number;
  /** Whole frame CPU time, ms. */
  frameMs: number;
  /** Simulation ticks in this frame, ms. */
  simMs: number;
  /** Render preparation + submission, ms. */
  renderMs: number;
  drawCalls: number;
  sprites: number;
  lights: number;
  particles: number;
  /** JS heap in MB, null where the browser does not expose it. */
  heapMb: number | null;
  entities: number;
}
export type DebugStatKey = keyof DebugStatsSnapshot;

export type DebugStats = { readonly [K in DebugStatKey]: Signal<DebugStatsSnapshot[K]> } & {
  /** Whether the overlay is shown (F3). */
  readonly visible: Signal<boolean>;
};

/** Display order of the overlay rows. */
export const DEBUG_STAT_KEYS: readonly DebugStatKey[] = [
  'fps',
  'frameMs',
  'simMs',
  'renderMs',
  'drawCalls',
  'sprites',
  'lights',
  'particles',
  'heapMb',
  'entities',
];

export interface StatBudget {
  readonly limit: number;
  /** "max": values above the limit are bad; "min": values below it are bad (fps). */
  readonly kind: 'max' | 'min';
}

/** Budgets from §30; the overlay highlights values outside them. */
export const DEBUG_BUDGETS: Readonly<Partial<Record<DebugStatKey, StatBudget>>> = {
  fps: { limit: 60, kind: 'min' }, // 60 FPS stable at "high"
  frameMs: { limit: 8, kind: 'max' }, // CPU per frame ≤ 8 ms
  simMs: { limit: 3, kind: 'max' }, // simulation ≤ 3 ms
  renderMs: { limit: 3, kind: 'max' }, // render preparation ≤ 3 ms
  drawCalls: { limit: 150, kind: 'max' }, // typically ≤ 150 draw calls
  sprites: { limit: 6000, kind: 'max' }, // up to 6 000 sprites
  lights: { limit: 256, kind: 'max' }, // 256 lights (ultra)
  particles: { limit: 20000, kind: 'max' }, // 20 000 particles
  heapMb: { limit: 350, kind: 'max' }, // JS heap ≤ 350 MB
};

export function emptyDebugStats(): DebugStatsSnapshot {
  return { fps: 0, frameMs: 0, simMs: 0, renderMs: 0, drawCalls: 0, sprites: 0, lights: 0, particles: 0, heapMb: null, entities: 0 };
}

export function createDebugStats(initiallyVisible = false): DebugStats {
  const s = emptyDebugStats();
  return {
    fps: signal(s.fps),
    frameMs: signal(s.frameMs),
    simMs: signal(s.simMs),
    renderMs: signal(s.renderMs),
    drawCalls: signal(s.drawCalls),
    sprites: signal(s.sprites),
    lights: signal(s.lights),
    particles: signal(s.particles),
    heapMb: signal<number | null>(s.heapMb),
    entities: signal(s.entities),
    visible: signal(initiallyVisible),
  };
}

/** Push a (partial) sample; all signal writes are batched into one render. */
export function updateDebugStats(stats: DebugStats, sample: Partial<DebugStatsSnapshot>): void {
  batch(() => {
    if (sample.fps !== undefined) stats.fps.value = sample.fps;
    if (sample.frameMs !== undefined) stats.frameMs.value = sample.frameMs;
    if (sample.simMs !== undefined) stats.simMs.value = sample.simMs;
    if (sample.renderMs !== undefined) stats.renderMs.value = sample.renderMs;
    if (sample.drawCalls !== undefined) stats.drawCalls.value = sample.drawCalls;
    if (sample.sprites !== undefined) stats.sprites.value = sample.sprites;
    if (sample.lights !== undefined) stats.lights.value = sample.lights;
    if (sample.particles !== undefined) stats.particles.value = sample.particles;
    if (sample.heapMb !== undefined) stats.heapMb.value = sample.heapMb;
    if (sample.entities !== undefined) stats.entities.value = sample.entities;
  });
}

export function snapshotDebugStats(stats: DebugStats): DebugStatsSnapshot {
  return {
    fps: stats.fps.peek(),
    frameMs: stats.frameMs.peek(),
    simMs: stats.simMs.peek(),
    renderMs: stats.renderMs.peek(),
    drawCalls: stats.drawCalls.peek(),
    sprites: stats.sprites.peek(),
    lights: stats.lights.peek(),
    particles: stats.particles.peek(),
    heapMb: stats.heapMb.peek(),
    entities: stats.entities.peek(),
  };
}

export function isOverBudget(key: DebugStatKey, value: number | null): boolean {
  const b = DEBUG_BUDGETS[key];
  if (!b || value === null) return false;
  return b.kind === 'max' ? value > b.limit : value < b.limit;
}

/** Frames averaged for the FPS read-out (one second at 60 Hz). */
export const FRAME_METER_WINDOW = 60;
const MS_PER_SECOND = 1000;

/**
 * Rolling frame-time meter. Frame durations are pushed by the caller (from the
 * loop's injected clock), so no time source is read here.
 */
export class FrameMeter {
  private readonly samples: Float64Array;
  private count = 0;
  private head = 0;
  private sum = 0;

  constructor(windowSize: number = FRAME_METER_WINDOW) {
    this.samples = new Float64Array(Math.max(1, Math.floor(windowSize)));
  }

  push(frameMs: number): void {
    if (!Number.isFinite(frameMs) || frameMs < 0) return;
    if (this.count === this.samples.length) this.sum -= this.samples[this.head] ?? 0;
    else this.count++;
    this.samples[this.head] = frameMs;
    this.sum += frameMs;
    this.head = (this.head + 1) % this.samples.length;
  }

  get averageMs(): number {
    return this.count === 0 ? 0 : this.sum / this.count;
  }

  get fps(): number {
    const avg = this.averageMs;
    return avg > 0 ? MS_PER_SECOND / avg : 0;
  }

  get worstMs(): number {
    let worst = 0;
    for (let i = 0; i < this.count; i++) worst = Math.max(worst, this.samples[i] ?? 0);
    return worst;
  }

  reset(): void {
    this.count = 0;
    this.head = 0;
    this.sum = 0;
  }
}
