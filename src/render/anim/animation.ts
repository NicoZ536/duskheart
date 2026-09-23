/**
 * Animation system (MASTERPROMPT §4.5, docs/RENDER.md §1 `clips`): clips with frame rates (figures
 * 8–12 fps, effects faster), frame events, four directions with mirroring only for symmetric sprites.
 * Clip time is presentation time; nothing here reads a clock.
 */

export const DIRECTIONS = ['down', 'left', 'up', 'right'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Figures animate at 8–12 fps (§4.5); effects may be faster. */
export const FIGURE_FPS_MIN = 8;
export const FIGURE_FPS_MAX = 12;
/** Fastest effect clip accepted (one frame per 60 Hz display frame would be pointless beyond that). */
export const EFFECT_FPS_MAX = 30;
/** Most loops `Animator.advance` replays in one call (a long stall does not flood event sinks). */
export const MAX_LOOPS_PER_ADVANCE = 2;
/** Guards frame boundaries against binary rounding (0.3 s × 10 fps = 2.9999…). */
const STEP_EPSILON = 1e-9;

export interface ClipEvent {
  /** Position in `frames` (0-based) at which the event fires. */
  readonly frame: number;
  readonly name: string;
}

export interface AnimationClip {
  readonly name: string;
  /** Frame indices of the owning sprite, in playback order. */
  readonly frames: readonly number[];
  readonly fps: number;
  readonly loop: boolean;
  readonly events?: readonly ClipEvent[];
}

export type ClipKind = 'figure' | 'effect';

/** Throws unless the clip is playable and its rate fits its kind. */
export function validateClip(clip: AnimationClip, kind: ClipKind): void {
  if (clip.frames.length === 0) throw new Error(`Clip ${clip.name}: keine Frames`);
  if (!(clip.fps > 0)) throw new Error(`Clip ${clip.name}: fps muss positiv sein`);
  if (kind === 'figure' && (clip.fps < FIGURE_FPS_MIN || clip.fps > FIGURE_FPS_MAX)) {
    throw new Error(`Clip ${clip.name}: Figuren laufen mit ${FIGURE_FPS_MIN}–${FIGURE_FPS_MAX} fps, nicht ${clip.fps}`);
  }
  if (kind === 'effect' && clip.fps > EFFECT_FPS_MAX) throw new Error(`Clip ${clip.name}: höchstens ${EFFECT_FPS_MAX} fps`);
  for (const e of clip.events ?? []) {
    if (!Number.isInteger(e.frame) || e.frame < 0 || e.frame >= clip.frames.length) throw new Error(`Clip ${clip.name}: Ereignis ${e.name} auf Frame ${e.frame} existiert nicht`);
  }
}

export function clipDuration(clip: AnimationClip): number {
  return clip.frames.length / clip.fps;
}

/** Whole frame steps elapsed after `time` seconds. */
function stepAt(clip: AnimationClip, time: number): number {
  return Math.floor(Math.max(0, time) * clip.fps + STEP_EPSILON);
}

function positionOfStep(clip: AnimationClip, step: number): number {
  const n = clip.frames.length;
  return clip.loop ? step % n : Math.min(step, n - 1);
}

/** Position in `clip.frames` shown `time` seconds after the clip started. */
export function clipPositionAt(clip: AnimationClip, time: number): number {
  return positionOfStep(clip, stepAt(clip, time));
}

/** Sprite frame index shown `time` seconds after the clip started. */
export function clipFrameAt(clip: AnimationClip, time: number): number {
  return clip.frames[clipPositionAt(clip, time)] ?? 0;
}

/** True once a non-looping clip has shown its last frame for a full frame time. */
export function clipFinished(clip: AnimationClip, time: number): boolean {
  return !clip.loop && stepAt(clip, time) >= clip.frames.length;
}

/** Clips of one action for the four directions. */
export interface DirectionalClips {
  readonly name: string;
  /** The sprite (and everything attached) looks right when mirrored: left/right may be derived. */
  readonly symmetric: boolean;
  readonly clips: Partial<Record<Direction, AnimationClip>>;
}

export interface ResolvedClip {
  clip: AnimationClip | null;
  mirror: boolean;
}

const OPPOSITE_SIDE: Partial<Record<Direction, Direction>> = { left: 'right', right: 'left' };

/**
 * The clip for `dir`: an explicit clip, or – only for symmetric sets – the mirrored opposite side
 * (left ↔ right). Throws when the direction cannot be shown.
 */
export function resolveDirection(set: DirectionalClips, dir: Direction, out: ResolvedClip = { clip: null, mirror: false }): ResolvedClip {
  const own = set.clips[dir];
  if (own) {
    out.clip = own;
    out.mirror = false;
    return out;
  }
  const other = OPPOSITE_SIDE[dir];
  const mirrored = other ? set.clips[other] : undefined;
  if (mirrored && set.symmetric) {
    out.clip = mirrored;
    out.mirror = true;
    return out;
  }
  const why = mirrored ? 'nicht symmetrisch, Spiegeln verboten' : 'kein Clip';
  throw new Error(`Animation ${set.name}: Richtung ${dir} fehlt (${why})`);
}

/** Throws unless all four directions resolve. */
export function validateDirectional(set: DirectionalClips, kind: ClipKind): void {
  for (const d of DIRECTIONS) resolveDirection(set, d);
  for (const c of Object.values(set.clips)) if (c) validateClip(c, kind);
}

/** Receives frame events: event name and the frame position that fired it. */
export type FrameEventSink = (event: string, framePosition: number) => void;

/**
 * Stateful player of one clip: advances with presentation time and fires the events of every frame
 * it enters, in order, also when one call spans several frames (capped at `MAX_LOOPS_PER_ADVANCE`).
 */
export class Animator {
  private current: AnimationClip | null = null;
  private t = 0;
  private enterFirst = false;

  get clip(): AnimationClip | null {
    return this.current;
  }

  get time(): number {
    return this.t;
  }

  /** Current position in the clip's frame list. */
  get position(): number {
    return this.current ? clipPositionAt(this.current, this.t) : 0;
  }

  /** Current sprite frame. */
  get frame(): number {
    return this.current ? clipFrameAt(this.current, this.t) : 0;
  }

  get finished(): boolean {
    return this.current ? clipFinished(this.current, this.t) : true;
  }

  /** Starts `clip`; playing the running clip again continues it unless `restart`. */
  play(clip: AnimationClip, restart = false): void {
    if (clip === this.current && !restart) return;
    this.current = clip;
    this.t = 0;
    this.enterFirst = true;
  }

  advance(dt: number, sink?: FrameEventSink): void {
    const clip = this.current;
    if (clip === null) return;
    if (this.enterFirst) {
      this.enterFirst = false;
      this.fire(clip, 0, sink);
    }
    if (!(dt > 0)) return;
    const n = clip.frames.length;
    const before = stepAt(clip, this.t);
    this.t += dt;
    let after = stepAt(clip, this.t);
    if (!clip.loop) after = Math.min(after, n - 1);
    const first = Math.max(before + 1, after - n * MAX_LOOPS_PER_ADVANCE + 1);
    for (let s = first; s <= after; s++) this.fire(clip, positionOfStep(clip, s), sink);
  }

  private fire(clip: AnimationClip, position: number, sink: FrameEventSink | undefined): void {
    if (!sink || !clip.events) return;
    for (const e of clip.events) if (e.frame === position) sink(e.name, position);
  }
}
