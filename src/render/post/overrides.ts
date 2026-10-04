/**
 * Debug overrides of the atmosphere and post effects (screenshot scenarios, E2E, console:
 * `__dh.call('postDebug', name, value)`): pinned values for effects whose cause the simulation does
 * not offer as a command (low health, heat stages, a region's corruption, a shock wave without the
 * combat of M6). Held by `RenderScene.post` across frames; the game view applies them after it filled
 * the frame (`applyTo`), so a pinned value wins over the simulation's. `null` = not pinned.
 */
import type { CorruptionState } from './corruption';
import { shockwaveAt } from './distortion';
import type { GradingState } from './grading';
import type { PostState } from './state';

/** Effects that can be pinned (0…1 each; `corruption` is the region strength). */
export const POST_OVERRIDE_NAMES = ['fear', 'hurt', 'heat', 'cold', 'poison', 'drunk', 'tired', 'lid', 'frost', 'underwater', 'vignette', 'grain', 'transition', 'corruption'] as const;
export type PostOverrideName = (typeof POST_OVERRIDE_NAMES)[number];

/** A shock wave pinned to a world point: it starts at presentation second `start` and repeats every `period` s. */
export interface PinnedShockwave {
  x: number;
  y: number;
  start: number;
  period: number;
  speed: number;
  life: number;
  width: number;
  strength: number;
}

export function isPostOverrideName(name: string): name is PostOverrideName {
  return (POST_OVERRIDE_NAMES as readonly string[]).includes(name);
}

export class PostOverrides {
  readonly values: Record<PostOverrideName, number | null> = Object.fromEntries(POST_OVERRIDE_NAMES.map((n) => [n, null])) as Record<PostOverrideName, number | null>;
  /** CRT filter on/off regardless of the setting. */
  crt: boolean | null = null;
  /** Grading on/off (off: the palette as painted, for comparisons). */
  grading: boolean | null = null;
  /** A repeating shock wave. */
  shockwave: PinnedShockwave | null = null;
  /** Values pinned through `set` (none: the frame reads no effect value to overwrite it, §30). */
  private pinned = 0;
  private readonly wave = { radius: 0, strength: 0 };

  /** Pins `name` to `value` (clamped to 0…1), `null` releases it. */
  set(name: PostOverrideName, value: number | null): void {
    const was = this.values[name] !== null;
    this.values[name] = value === null ? null : Math.max(0, Math.min(1, value));
    if (was !== (value !== null)) this.pinned += value !== null ? 1 : -1;
  }

  /** Releases every pin. */
  clear(): void {
    for (const n of POST_OVERRIDE_NAMES) this.values[n] = null;
    this.pinned = 0;
    this.crt = null;
    this.grading = null;
    this.shockwave = null;
  }

  /** Whether anything is pinned. */
  get any(): boolean {
    return this.crt !== null || this.grading !== null || this.shockwave !== null || POST_OVERRIDE_NAMES.some((n) => this.values[n] !== null);
  }

  /** Whether the corruption's strength is pinned (`applyTo` replaces the frame's own). */
  get pinsCorruption(): boolean {
    return this.pinned > 0 && this.values.corruption !== null;
  }

  /** Writes the pinned values over the frame's (after the scene filled it). */
  applyTo(post: PostState, grading: GradingState, corruption: CorruptionState, time: number): void {
    if (this.pinned > 0) this.applyValues(post, corruption);
    if (this.grading === false) grading.active = false;
    const s = this.shockwave;
    if (s !== null && s.period > 0) {
      const since = time - s.start;
      const age = since - Math.floor(since / s.period) * s.period;
      shockwaveAt(age, s.speed, s.life, s.strength, this.wave);
      post.distortion.shockwave(s.x, s.y, this.wave.radius, s.width, this.wave.strength);
    }
  }

  private applyValues(post: PostState, corruption: CorruptionState): void {
    const v = this.values;
    post.fear = v.fear ?? post.fear;
    post.hurt = v.hurt ?? post.hurt;
    post.heat = v.heat ?? post.heat;
    post.cold = v.cold ?? post.cold;
    post.poison = v.poison ?? post.poison;
    post.drunk = v.drunk ?? post.drunk;
    post.tired = v.tired ?? post.tired;
    post.lid = v.lid ?? post.lid;
    post.frost = v.frost ?? post.frost;
    post.underwater = v.underwater ?? post.underwater;
    post.vignette = v.vignette ?? post.vignette;
    post.grain = v.grain ?? post.grain;
    post.transition = v.transition ?? post.transition;
    corruption.strength = v.corruption ?? corruption.strength;
  }
}

/** What `__dh.call('postDebug')` reports: every pin (null = not pinned). */
export interface PostOverrideReport {
  readonly values: Readonly<Record<PostOverrideName, number | null>>;
  readonly crt: boolean | null;
  readonly grading: boolean | null;
  readonly shockwave: Readonly<PinnedShockwave> | null;
}

/**
 * The debug command `__dh.call('postDebug', name?, value?)` (arguments from untyped scripts, validated):
 * without arguments it reports the pins; `clear` releases all; `crt`/`grading` take true, false or null;
 * an effect name takes a number 0…1 or null. Returns the pins afterwards.
 */
export function postDebugCommand(overrides: PostOverrides, name?: unknown, value?: unknown): PostOverrideReport {
  if (name !== undefined) {
    if (name === 'clear') overrides.clear();
    else if (name === 'crt' || name === 'grading') {
      if (value !== null && typeof value !== 'boolean') throw new TypeError(`postDebug: ${name} erwartet true, false oder null`);
      overrides[name] = value;
    } else if (typeof name === 'string' && isPostOverrideName(name)) {
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new TypeError(`postDebug: ${name} erwartet eine Zahl 0…1 oder null`);
      overrides.set(name, value);
    } else throw new Error(`postDebug: unbekannter Effekt „${String(name)}“ (verfügbar: ${[...POST_OVERRIDE_NAMES, 'crt', 'grading', 'clear'].join(', ')})`);
  }
  return { values: { ...overrides.values }, crt: overrides.crt, grading: overrides.grading, shockwave: overrides.shockwave === null ? null : { ...overrides.shockwave } };
}
