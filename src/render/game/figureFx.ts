/**
 * Particles at the player and at lights (MASTERPROMPT §11.3 "sichtbare Wirkung", §6.2 "Feuer: animierte
 * Flammen, … Funken, Rauch", §2.7; M3-20, M3-22):
 *
 * - **Conditions** (`ConditionLook`, `conditionLook.ts`): drops fall off a soaked player and splash at the
 *   feet, blood drips from a bleeding one, sweat from the brow of an overheated one, little flames lick up
 *   a burning one (emissive: they glow, but light nothing – the light list stays the simulation's, §12.1),
 *   a freezing player breathes small clouds towards where they look and shivers – short zigzag marks
 *   tremble beside the body in bursts, so the shivering reads in a still picture too.
 * - **Light events**: a torch or fire that catches throws sparks, fuel landing in a fire too, something
 *   flammable that catches as well; a light that goes out (or embers going cold) lets off smoke.
 *
 * Every particle is a pure function of presentation time: particle k of an emitter starts at
 * k × period (plus a jitter from its hash), its path and life come from the same hash. A frozen frame
 * therefore always shows the same particles, and nothing is simulated or allocated per frame; light
 * bursts live in a fixed ring of events (the time of the frame that first drew them).
 */
import { hash3, hashToUnit } from '../../engine/rng';
import type { Facing } from '../../game/player/state';
import type { SimEventMap } from '../../game/sim';
import type { GameSession } from '../../game/session';
import { TILE_PX, type Layer } from '../../world/model/coords';
import { clipDuration, clipFrameAt, type AnimationClip } from '../anim/animation';
import type { AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { RenderScene } from '../scene';
import type { ConditionLook } from './conditionLook';

/** Particle sprites (group `effekte`) by use. */
export const FX_SPRITES = {
  tropfen: 'partikel_tropfen',
  blut: 'partikel_blutstropfen',
  flamme: 'partikel_flamme',
  atem: 'partikel_atem',
  rauch: 'partikel_rauch',
  funken: 'partikel_funken',
  zittern: 'partikel_zittern',
} as const;
type FxKind = keyof typeof FX_SPRITES;
const FX_KINDS = Object.keys(FX_SPRITES) as FxKind[];

/**
 * A falling drop: one every `period` s from a random point of the body (sideways within ±`spreadPx`,
 * `fromPx`–`toPx` above the feet), falling under `gravity` [px/s²]; it splashes for `splashSeconds`.
 */
interface DripSpec {
  readonly sprite: FxKind;
  readonly period: number;
  readonly spreadPx: number;
  readonly fromPx: number;
  readonly toPx: number;
  readonly gravity: number;
  readonly splashSeconds: number;
  readonly salt: number;
}

/** Drops of a soaked player: frequent, from the whole body. */
export const DRIP_WATER: DripSpec = { sprite: 'tropfen', period: 0.22, spreadPx: 5, fromPx: 6, toPx: 18, gravity: 240, splashSeconds: 0.12, salt: 0x5a11 };
/** Drops of a bleeding player: slower, from the torso. */
export const DRIP_BLOOD: DripSpec = { sprite: 'blut', period: 0.55, spreadPx: 3, fromPx: 7, toPx: 13, gravity: 240, splashSeconds: 0.2, salt: 0xb100 };
/** Sweat of an overheated player: from the brow. */
export const DRIP_SWEAT: DripSpec = { sprite: 'tropfen', period: 0.7, spreadPx: 3, fromPx: 18, toPx: 21, gravity: 200, splashSeconds: 0.1, salt: 0x5e47 };

/** Flames licking up a burning player: one every `period` s, rising `risePxPerSecond`, living `life` s. */
export const FLAMES = { period: 0.055, life: 0.42, spreadPx: 5, fromPx: 2, toPx: 14, risePxPerSecond: 22, fadeFrom: 0.55, salt: 0xf1a3 } as const;

/**
 * Breath of a freezing player: a cloud every `period` s by shiver level (faster breathing when colder),
 * from the mouth (`mouthPx` above the feet). In profile it drifts ahead of the face (`aheadPx` towards the
 * facing); facing the viewer or away it rises beside the head (`sidePx`, alternating sides) so it never
 * covers the face.
 */
export const BREATH = { period: [0, 1.6, 1.1], life: 0.8, mouthPx: 15, aheadPx: 6, sidePx: 8, driftPxPerSecond: 9, risePxPerSecond: 6, fadeFrom: 0.4, salt: 0xa7e3 } as const;
/**
 * Shiver marks of a freezing player: a burst every `period` s by shiver level, lasting `onShare` of it;
 * the marks stand `sidePx` left and right of the body's centre, `heightPx` above the feet, and flip their
 * zigzag `hz` times a second (the rate of the jitter, `conditionLook.ts`).
 */
export const SHIVER_MARKS = { period: [0, 1.4, 0.9], onShare: 0.6, sidePx: 9, heightPx: 6, hz: [0, 12, 18] } as const;
/** Sparks of a light that catches: pieces, launch speeds [px/s], gravity [px/s²], life [s]. */
export const SPARKS = { pieces: 8, fuelPieces: 5, up: [45, 85], side: 32, gravity: 220, life: 0.45, heightPx: 10 } as const;
/** Smoke of a light that goes out: puffs, their spacing [s], rise [px/s], drift [px/s], life [s]. */
export const SMOKE = { puffs: 3, spacing: 0.18, risePxPerSecond: 14, driftPxPerSecond: 5, life: 1.1, heightPx: 12, fadeFrom: 0.45 } as const;
/** Light bursts drawn at once at most (older ones are overwritten). */
const BURST_RING = 24;

/** Where the figure stands (the drawn, interpolated position) and looks. */
export interface FigureFxFrame {
  x: number;
  y: number;
  /** Height of the ground under the feet [px] (terrain level). */
  heightBase: number;
  facing: Facing;
  layer: Layer;
  time: number;
}

/** A fresh frame record. */
export function createFigureFxFrame(): FigureFxFrame {
  return { x: 0, y: 0, heightBase: 0, facing: 'down', layer: 0, time: 0 };
}

/** Uniform [0, 1) from particle `k` of emitter `salt`, channel `c`. */
function rand(k: number, salt: number, c: number): number {
  return hashToUnit(hash3(k, c, salt));
}

/** A light burst waiting for or being drawn. */
interface Burst {
  kind: 'sparks' | 'smoke';
  pieces: number;
  x: number;
  y: number;
  layer: number;
  /** Presentation time of the frame that first drew it (NaN until then). */
  start: number;
  seed: number;
}

export class FigureFx {
  private manifest: AtlasManifest | null = null;
  private readonly sprites: (AtlasSprite | null)[] = [];
  private readonly clips: (AnimationClip | null)[] = [];
  private readonly bursts: Burst[] = Array.from({ length: BURST_RING }, () => ({ kind: 'sparks' as const, pieces: 0, x: 0, y: 0, layer: 0, start: Number.NaN, seed: 0 }));
  private next = 0;
  private subscribed: Pick<GameSession, 'onEvent'> | null = null;
  private unsubscribe: (() => void)[] = [];
  /** Particles drawn in the last frame (tests, debug). */
  drawn = 0;

  /** Listens to the light events of `session` (re-subscribes when the view gets another session). */
  follow(session: Pick<GameSession, 'onEvent'>): void {
    if (this.subscribed === session) return;
    this.dispose();
    this.subscribed = session;
    this.unsubscribe = [
      session.onEvent('lightIgnited', (e) => this.burst('sparks', SPARKS.pieces, e.x, e.y, e.layer, e.tick, e.light)),
      session.onEvent('fireFueled', (e) => this.burst('sparks', SPARKS.fuelPieces, e.x, e.y, e.layer, e.tick, e.light)),
      session.onEvent('flammableIgnited', (e) => this.burst('sparks', SPARKS.pieces, (e.tx + 0.5) * TILE_PX, (e.ty + 0.5) * TILE_PX, e.layer, e.tick, e.tx ^ e.ty)),
      session.onEvent('lightExtinguished', (e: SimEventMap['lightExtinguished']) => {
        // A torch put away leaves the hand without a puff; everything else that goes out smokes.
        if (e.reason !== 'verstaut') this.burst('smoke', SMOKE.puffs, e.x, e.y, e.layer, e.tick, e.light);
      }),
      session.onEvent('fireCooled', (e) => this.burst('smoke', SMOKE.puffs, e.x, e.y, e.layer, e.tick, e.light)),
    ];
  }

  dispose(): void {
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
    this.subscribed = null;
  }

  /** Light bursts waiting or running (tests, debug). */
  get bursting(): number {
    let n = 0;
    for (const b of this.bursts) if (b.pieces > 0) n++;
    return n;
  }

  private burst(kind: Burst['kind'], pieces: number, x: number, y: number, layer: number, tick: number, id: number): void {
    const b = this.bursts[this.next] as Burst;
    this.next = (this.next + 1) % BURST_RING;
    b.kind = kind;
    b.pieces = pieces;
    b.x = x;
    b.y = y;
    b.layer = layer;
    b.start = Number.NaN;
    b.seed = hash3(tick, id, pieces);
  }

  /** Draws the condition particles of the figure (see module comment). */
  drawFigure(scene: RenderScene, manifest: AtlasManifest, look: ConditionLook, f: FigureFxFrame): void {
    this.bind(manifest);
    if (look.drips) this.drips(scene, DRIP_WATER, f);
    if (look.sweat) this.drips(scene, DRIP_SWEAT, f);
    if (look.blood) this.drips(scene, DRIP_BLOOD, f);
    if (look.flames) this.flames(scene, f);
    if (look.breath) this.breath(scene, look.shiver, f);
    if (look.shiver > 0) this.shiverMarks(scene, look.shiver, f);
  }

  /** Shiver marks beside the body while a burst lasts (see `SHIVER_MARKS`). */
  private shiverMarks(scene: RenderScene, level: number, f: FigureFxFrame): void {
    const sprite = this.sprite('zittern');
    const period = SHIVER_MARKS.period[level] ?? 0;
    const hz = SHIVER_MARKS.hz[level] ?? 0;
    if (sprite === null || !(period > 0)) return;
    const t = Math.max(0, f.time);
    if (t % period > period * SHIVER_MARKS.onShare) return;
    const frame = Math.floor(t * hz) % sprite.frames.length;
    // The two sides tremble in opposite phase.
    const depth = f.y + 0.6;
    this.push(scene, sprite, frame, f.x - SHIVER_MARKS.sidePx, f.y, SHIVER_MARKS.heightPx, f.heightBase, depth, 0);
    this.push(scene, sprite, (frame + 1) % sprite.frames.length, f.x + SHIVER_MARKS.sidePx, f.y, SHIVER_MARKS.heightPx, f.heightBase, depth, 0);
  }

  /** Draws the light bursts of `layer` (see module comment). */
  drawBursts(scene: RenderScene, manifest: AtlasManifest, layer: Layer, time: number): void {
    this.bind(manifest);
    for (const b of this.bursts) {
      if (b.pieces === 0) continue;
      if (Number.isNaN(b.start)) b.start = time;
      const age = time - b.start;
      const life = b.kind === 'sparks' ? SPARKS.life : SMOKE.life + SMOKE.spacing * (b.pieces - 1);
      if (age > life) {
        b.pieces = 0;
        continue;
      }
      if (b.layer !== layer || age < 0) continue;
      if (b.kind === 'sparks') this.sparks(scene, b, age);
      else this.smoke(scene, b, age);
    }
  }

  private drips(scene: RenderScene, spec: DripSpec, f: FigureFxFrame): void {
    const sprite = this.sprite(spec.sprite);
    if (sprite === null) return;
    const fallLongest = Math.sqrt((2 * spec.toPx) / spec.gravity);
    const reach = fallLongest + spec.splashSeconds;
    const last = Math.floor(f.time / spec.period);
    const first = Math.floor((f.time - reach) / spec.period) - 1;
    for (let k = first; k <= last; k++) {
      const born = (k + rand(k, spec.salt, 0) * 0.8) * spec.period;
      const age = f.time - born;
      if (age < 0) continue;
      const z0 = spec.fromPx + (spec.toPx - spec.fromPx) * rand(k, spec.salt, 1);
      const fall = Math.sqrt((2 * z0) / spec.gravity);
      if (age > fall + spec.splashSeconds) continue;
      const dx = Math.round((rand(k, spec.salt, 2) * 2 - 1) * spec.spreadPx);
      const z = age < fall ? Math.max(0, z0 - 0.5 * spec.gravity * age * age) : 0;
      const frame = age < fall ? 0 : 1;
      this.push(scene, sprite, frame, f.x + dx, f.y, z, f.heightBase, f.y + 0.5, 0);
    }
  }

  private flames(scene: RenderScene, f: FigureFxFrame): void {
    const sprite = this.sprite('flamme');
    const clip = this.clip('flamme');
    if (sprite === null) return;
    const F = FLAMES;
    const last = Math.floor(f.time / F.period);
    const first = Math.floor((f.time - F.life) / F.period) - 1;
    for (let k = first; k <= last; k++) {
      const born = (k + rand(k, F.salt, 0) * 0.7) * F.period;
      const age = f.time - born;
      if (age < 0 || age > F.life) continue;
      const dx = Math.round((rand(k, F.salt, 1) * 2 - 1) * F.spreadPx);
      const z = F.fromPx + (F.toPx - F.fromPx) * rand(k, F.salt, 2) + F.risePxPerSecond * age;
      const share = age / F.life;
      const frame = clip === null ? 0 : clipFrameAt(clip, age + rand(k, F.salt, 3));
      this.push(scene, sprite, frame, f.x + dx, f.y, z, f.heightBase, f.y + 0.6, share > F.fadeFrom ? (share - F.fadeFrom) / (1 - F.fadeFrom) : 0);
    }
  }

  private breath(scene: RenderScene, level: number, f: FigureFxFrame): void {
    const sprite = this.sprite('atem');
    const clip = this.clip('atem');
    const period = BREATH.period[level] ?? 0;
    if (sprite === null || !(period > 0)) return;
    const profile = f.facing === 'right' || f.facing === 'left';
    const last = Math.floor(f.time / period);
    for (let k = last - 1; k <= last; k++) {
      const born = (k + rand(k, BREATH.salt, 0) * 0.3) * period;
      const age = f.time - born;
      if (age < 0 || age > BREATH.life) continue;
      const share = age / BREATH.life;
      const side = profile ? (f.facing === 'right' ? 1 : -1) : k % 2 === 0 ? 1 : -1;
      const x = f.x + side * ((profile ? BREATH.aheadPx : BREATH.sidePx) + BREATH.driftPxPerSecond * age);
      const y = f.y + (f.facing === 'down' ? 1 : 0);
      const z = BREATH.mouthPx + BREATH.risePxPerSecond * age;
      const frame = clip === null ? 0 : clipFrameAt(clip, share * clipDuration(clip));
      // Facing away the breath rises behind the head.
      const depth = f.facing === 'up' ? f.y - 0.5 : f.y + 0.7;
      this.push(scene, sprite, frame, Math.round(x), Math.round(y), z, f.heightBase, depth, share > BREATH.fadeFrom ? (share - BREATH.fadeFrom) / (1 - BREATH.fadeFrom) : 0);
    }
  }

  private sparks(scene: RenderScene, b: Burst, age: number): void {
    const sprite = this.sprite('funken');
    const clip = this.clip('funken');
    if (sprite === null) return;
    const share = age / SPARKS.life;
    for (let j = 0; j < b.pieces; j++) {
      const up = SPARKS.up[0] + (SPARKS.up[1] - SPARKS.up[0]) * rand(j, b.seed, 0);
      const vx = (rand(j, b.seed, 1) * 2 - 1) * SPARKS.side;
      const vy = ((rand(j, b.seed, 2) * 2 - 1) * SPARKS.side) / 2;
      const z = Math.max(0, SPARKS.heightPx + up * age - 0.5 * SPARKS.gravity * age * age);
      const frame = clip === null ? 0 : clipFrameAt(clip, share * clipDuration(clip));
      this.push(scene, sprite, frame, Math.round(b.x + vx * age), Math.round(b.y + vy * age), z, 0, b.y + vy * age, 0);
    }
  }

  private smoke(scene: RenderScene, b: Burst, age: number): void {
    const sprite = this.sprite('rauch');
    const clip = this.clip('rauch');
    if (sprite === null) return;
    for (let j = 0; j < b.pieces; j++) {
      const own = age - j * SMOKE.spacing;
      if (own < 0 || own > SMOKE.life) continue;
      const share = own / SMOKE.life;
      const drift = (rand(j, b.seed, 0) * 2 - 1) * SMOKE.driftPxPerSecond;
      const z = SMOKE.heightPx + SMOKE.risePxPerSecond * own;
      const frame = clip === null ? 0 : clipFrameAt(clip, share * clipDuration(clip));
      this.push(scene, sprite, frame, Math.round(b.x + drift * own), b.y, z, 0, b.y + 0.5, share > SMOKE.fadeFrom ? (share - SMOKE.fadeFrom) / (1 - SMOKE.fadeFrom) : 0);
    }
  }

  /** One particle standing at (x, y) on the ground, `z` px above it. */
  private push(scene: RenderScene, sprite: AtlasSprite, frame: number, x: number, y: number, z: number, ground: number, depth: number, fade: number): void {
    const d = scene.sprite.reset();
    d.frame = (sprite.frames[frame] ?? sprite.frames[0]) as SpriteFrameRef;
    d.x = x;
    d.y = Math.round(y - z);
    d.depth = depth;
    d.heightBase = ground + z;
    d.fade = Math.min(1, Math.max(0, fade));
    scene.sprites.push(d);
    this.drawn++;
  }

  /** Starts the frame's count (the view calls it once per frame before drawing). */
  beginFrame(): void {
    this.drawn = 0;
  }

  private sprite(kind: FxKind): AtlasSprite | null {
    return this.sprites[FX_KINDS.indexOf(kind)] ?? null;
  }

  private clip(kind: FxKind): AnimationClip | null {
    return this.clips[FX_KINDS.indexOf(kind)] ?? null;
  }

  private bind(manifest: AtlasManifest): void {
    if (this.manifest === manifest) return;
    this.manifest = manifest;
    this.sprites.length = 0;
    this.clips.length = 0;
    for (const k of FX_KINDS) {
      const sprite = manifest.sprites[FX_SPRITES[k]] ?? null;
      this.sprites.push(sprite);
      this.clips.push(sprite === null ? null : (Object.values(sprite.clips)[0] ?? null));
    }
  }
}
