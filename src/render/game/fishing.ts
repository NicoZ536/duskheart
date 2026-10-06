/**
 * Fishing in the game view (docs/SPIEL.md §30 "src/render/game/fishing.ts (Schnur, Pose, Rutenbiegung, Spritzer über
 * scene.water-Impuls)"; M7-24), from `GameSession.sampleFishing` (a held record) and the fishing system's traps and holes:
 * - the rod from the figure's hand towards the float, bent down and towards the fish by the line's tension (the fish's pull
 *   bends its tip aside); the line from the rod's tip to the float, sagging when slack and drawn straight when taut – both
 *   set from the dots of `angel_schnur`;
 * - the float (`angel_pose`): bobbing while it waits, pulled under at the bite and through the fight, jerking with the pull;
 * - splashes as impulses into the water's wave field: the float landing, the bite, every leap, a soft wake while the fish
 *   fights;
 * - the fish traps (`obj_reuse`, `voll` when something is inside) and the open ice holes (`fang_eisloch`, ground layer).
 * Allocates nothing per frame.
 */
import { BALANCE } from '../../content/balance';
import type { IceHole } from '../../game/fishing/system';
import type { FishingPhase } from '../../game/fishing/types';
import { createFishingSample } from '../../game/samples/feld';
import type { FeldRect, FeldSession } from './farming';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import { CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import { clipFrameAt } from '../anim/animation';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { RenderScene } from '../scene';

/** The hand holding the rod when the figure drew none, from its feet [px]: chest high, to the side the line goes. */
const HAND_UP = 11;
const HAND_SIDE = 3;
/** The rod: reach of its unbent tip from the hand [px] (sideways, up) – longer than the figure is wide, held up at 45°. */
const ROD_OUT = 12;
const ROD_UP = 13;
/** Where along the unbent rod its curve's control point lies [share from the hand]: the rod bends in its upper third. */
const ROD_STIFF = 0.6;
/** How far the taut line bends the tip down [px at tension 1], and aside with the fish's pull. */
const ROD_BEND = 6;
const ROD_PULL = 2;
/** Sag of the slack line at its middle [px]; a taut line sags `TAUT_SAG`. */
const SLACK_SAG = 9;
const TAUT_SAG = 1;
/** Dots of rod and line: one every `DOT_STEP` px (no gap at a diagonal), the line between 6 and 96. */
const DOT_STEP = 0.75;
const ROD_DOTS_MAX = 32;
const LINE_MIN = 6;
const LINE_MAX = 96;
/**
 * The wake of a fighting fish in the wave field: one kick of strength `WAKE_STEP` (× the `figureIdle` impulse) for every
 * `WAKE_STEP` of fight time, which runs `1 + WAKE_PULL × |pull|` times faster the harder the fish pulls; at most
 * `WAKE_KICKS_MAX` kicks in a frame (after a stall).
 */
const WAKE_STEP = 0.1;
const WAKE_PULL = 3;
const WAKE_KICKS_MAX = 4;
/** The float jerks aside with the fish's pull [px]. */
const FLOAT_JERK = 1;
/** The trap's anchor below the tile's top edge [px]. */
const TRAP_FOOT = 12;
/** Frame of `angel_pose` pulled under (bite and fight). */
const POSE_TAUCHT = 2;
/** The rod in front of the figure (its parts sort at the feet, a swung item `NEAR_HAND_DEPTH` further) [px]. */
const ROD_DEPTH = 6;
/** The rod behind the figure's body when it fishes up the screen [px from its feet]. */
const ROD_BEHIND = -1;
/** The line just behind its own ground line (the float in front of it) [px]. */
const LINE_DEPTH = -0.25;

/** The figure as drawn: its feet [world px] and its height base [px] (`PlayerFigure.drawn`). */
export interface FeldFigure {
  readonly x: number;
  readonly y: number;
  readonly heightBase: number;
}

/** The figure's main hand as drawn [world px] (the `HandPoint` of the combat sample): the rod's butt while `drawn`. */
export interface FeldHand {
  readonly x: number;
  readonly y: number;
  readonly drawn: boolean;
}

/**
 * What the fishing view draws in a frame. Rectangle, figure and hand are held by reference (the game view's own
 * records, updated in place): nothing is copied per frame (see `FarmFrame`).
 */
export interface FishingFrame {
  layer: Layer;
  view: FeldRect;
  time: number;
  /** Whether the figure is drawn this frame. */
  hasFigure: boolean;
  figure: FeldFigure;
  hand: FeldHand;
  levelAt: (tx: number, ty: number) => number;
}

/** First value of the frame's fractional fields: a double from the start (the `DOUBLE_FIELD` of src/render/batch/spriteList.ts). */
const DOUBLE_FIELD = Number.NaN;
/** The presentation time of the last frame with a line out: none. */
const NO_TIME = Number.NaN;

/** A frame over `view`, `figure` and `hand` (the game view hands in its own records once). */
export function createFishingFrame(
  view: FeldRect = { left: 0, top: 0, right: 0, bottom: 0 },
  figure: FeldFigure = { x: 0, y: 0, heightBase: 0 },
  hand: FeldHand = { x: 0, y: 0, drawn: false },
): FishingFrame {
  const f: FishingFrame = { layer: 0, view, time: DOUBLE_FIELD, hasFigure: false, figure, hand, levelAt: () => 0 };
  f.time = 0;
  return f;
}

export class FishingView {
  private manifest: AtlasManifest | null = null;
  private pose: AtlasSprite | null = null;
  private dot: AtlasSprite | null = null;
  private trap: AtlasSprite | null = null;
  private hole: AtlasSprite | null = null;
  private readonly sample = createFishingSample();
  private lastPhase: FishingPhase = 'aus';
  private lastLeap = false;
  private lastTime = NO_TIME;
  /** The held frame and scene of the hole callback (no closure per frame). */
  private holeScene: RenderScene | null = null;
  private holeFrame: FishingFrame | null = null;
  private holeDay = 0;
  private readonly drawHole = (h: IceHole): void => this.pushHole(h);
  /** Dots drawn in the last frame (rod and line). */
  dots = 0;
  /** The pixel of the dot pushed last (NaN: none yet in this stroke). */
  private lastDotX = Number.NaN;
  private lastDotY = Number.NaN;
  /** The stroke being drawn: depth, ground line and height base at its start and its end [px] (doubles from the start). */
  private strokeDepth0 = Number.NaN;
  private strokeDepth1 = Number.NaN;
  private strokeGround0 = Number.NaN;
  private strokeGround1 = Number.NaN;
  private strokeBase0 = Number.NaN;
  private strokeBase1 = Number.NaN;
  /** The fight's wake added up since its last kick [s × pull factor]. */
  private wake = Number.NaN;

  private bind(manifest: AtlasManifest): void {
    this.manifest = manifest;
    this.pose = manifest.sprites['angel_pose'] ?? null;
    this.dot = manifest.sprites['angel_schnur'] ?? null;
    this.trap = manifest.sprites['obj_reuse'] ?? null;
    this.hole = manifest.sprites['fang_eisloch'] ?? null;
  }

  draw(scene: RenderScene, atlas: AtlasData, session: FeldSession, f: FishingFrame): void {
    if (this.manifest !== atlas.manifest) this.bind(atlas.manifest);
    this.dots = 0;
    this.drawTraps(scene, session, f);
    this.holeScene = scene;
    this.holeFrame = f;
    this.holeDay = session.sim.clock.day;
    session.sampleIceHoles().forEach(this.drawHole);
    this.holeScene = null;
    this.holeFrame = null;
    const s = session.sampleFishing(this.sample);
    const phase = s.phase;
    if (phase === 'aus' || s.layer !== f.layer || !f.hasFigure) {
      this.lastPhase = phase;
      this.lastLeap = false;
      this.lastTime = NO_TIME;
      return;
    }
    // The time since the last frame with the line out (0 in its first frame), at most a tenth of a second.
    const now = f.time;
    const dt = Number.isNaN(this.lastTime) ? 0 : Math.max(0, Math.min(0.1, now - this.lastTime));
    this.lastTime = now;
    const fig = f.figure;
    const hand = f.hand;
    // Splashes: the float landing, the bite, a leap; a wake while the fish fights.
    // (Whole pixels and constant strengths: a fraction handed to a call that is not inlined would be boxed every frame.)
    const px = Math.round(s.floatX);
    const py = Math.round(s.floatY);
    if (phase === 'warten' && this.lastPhase === 'wurf') scene.water.impulse('arrow', px, py);
    if (phase === 'biss' && this.lastPhase !== 'biss') scene.water.impulse('fish', px, py);
    if (s.leaping && !this.lastLeap) scene.water.impulse('splash', px, py);
    if (phase === 'drill') {
      // The wake: one kick of `WAKE_STEP` every time the fight's pull has added up that much.
      this.wake += dt * (1 + Math.abs(s.pull) * WAKE_PULL);
      for (let k = 0; k < WAKE_KICKS_MAX && this.wake >= WAKE_STEP; k++) {
        this.wake -= WAKE_STEP;
        scene.water.impulse('figureIdle', px, py, WAKE_STEP);
      }
    } else this.wake = 0;
    this.lastPhase = phase;
    this.lastLeap = s.leaping;
    if (phase === 'gefangen' || phase === 'verloren') return;
    const side = s.floatX >= fig.x ? 1 : -1;
    const hx = hand.drawn ? hand.x : fig.x + side * HAND_SIDE;
    const hy = hand.drawn ? hand.y : fig.y - HAND_UP;
    const taut = phase === 'drill' ? s.tension : 0;
    const tipX = hx + side * ROD_OUT + s.pull * ROD_PULL * taut;
    const tipY = hy - ROD_UP + taut * ROD_BEND;
    // The rod: a quadratic curve from the hand, its control point on the unbent rod (straight while the line is slack, bowed
    // as the taut line pulls the tip down); in front of the figure, lifted over its feet (its height base: the dots stand on
    // the figure's ground line).
    const cx = hx + side * ROD_OUT * ROD_STIFF;
    const cy = hy - ROD_UP * ROD_STIFF;
    // Fishing up the screen the figure turns its back: the rod goes out behind its body.
    const away = s.floatY < fig.y && fig.y - s.floatY > Math.abs(s.floatX - fig.x);
    const rodDepth = fig.y + (away ? ROD_BEHIND : ROD_DEPTH);
    const rodDots = Math.min(ROD_DOTS_MAX, Math.ceil(Math.sqrt((tipX - hx) * (tipX - hx) + (tipY - hy) * (tipY - hy)) / DOT_STEP) + 2);
    this.lastDotX = Number.NaN;
    this.strokeDepth0 = rodDepth;
    this.strokeDepth1 = rodDepth;
    this.strokeGround0 = fig.y;
    this.strokeGround1 = fig.y;
    this.strokeBase0 = fig.heightBase;
    this.strokeBase1 = fig.heightBase;
    for (let k = 0; k <= rodDots; k++) {
      const t = k / rodDots;
      const u = 1 - t;
      this.pushDot(scene, 0, Math.round(u * u * hx + 2 * u * t * cx + t * t * tipX), Math.round(u * u * hy + 2 * u * t * cy + t * t * tipY), k, rodDots);
    }
    // The float.
    let fx = s.floatX;
    const fy = s.floatY;
    const pose = this.pose;
    if (pose !== null) {
      const d = scene.sprite.reset();
      let frame = 0;
      if (phase === 'biss' || phase === 'drill') {
        frame = POSE_TAUCHT;
        fx += s.pull * FLOAT_JERK;
      } else {
        const clip = pose.clips['ruhig'];
        frame = clip === undefined ? 0 : clipFrameAt(clip, f.time);
      }
      d.frame = (pose.frames[frame] ?? pose.frames[0]) as SpriteFrameRef;
      d.x = Math.round(fx);
      d.y = Math.round(fy);
      scene.sprites.push(d);
    }
    // The line: from the tip to the float, sagging at its middle; its ground line runs from the figure's feet to the float.
    const sag = SLACK_SAG + (TAUT_SAG - SLACK_SAG) * taut;
    const lx = fx - tipX;
    const ly = fy - 2 - tipY;
    const n = Math.max(LINE_MIN, Math.min(LINE_MAX, Math.round(Math.sqrt(lx * lx + ly * ly) / DOT_STEP)));
    this.lastDotX = Number.NaN;
    this.strokeGround0 = fig.y;
    this.strokeGround1 = fy;
    this.strokeDepth0 = fig.y + LINE_DEPTH;
    this.strokeDepth1 = fy + LINE_DEPTH;
    this.strokeBase0 = fig.heightBase;
    this.strokeBase1 = 0;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      this.pushDot(scene, 1, Math.round(tipX + lx * t), Math.round(tipY + ly * t + sag * 4 * t * (1 - t)), k, n);
    }
  }

  /**
   * Dot `k` of `n` of the stroke (rod or line) on pixel (rx, ry): it stands over the stroke's ground line at that share (the
   * `stroke…` fields, from start to end), y-sorted at its depth, on its height base [px]; its height over the ground line lifts
   * it (`heightBase`), so the G-buffer puts it in front of what lies behind its foot. Only whole numbers are handed over (a
   * fraction passed to a call that is not inlined would be boxed for every dot).
   */
  private pushDot(scene: RenderScene, frame: number, rx: number, ry: number, k: number, n: number): void {
    const dot = this.dot;
    // A dot on the pixel of the one before adds nothing.
    if (dot === null || (rx === this.lastDotX && ry === this.lastDotY)) return;
    this.lastDotX = rx;
    this.lastDotY = ry;
    const t = k / n;
    const ground = this.strokeGround0 + (this.strokeGround1 - this.strokeGround0) * t;
    const d = scene.sprite.reset();
    d.frame = (dot.frames[frame] ?? dot.frames[0]) as SpriteFrameRef;
    d.x = rx;
    d.y = ry;
    d.depth = this.strokeDepth0 + (this.strokeDepth1 - this.strokeDepth0) * t;
    d.heightBase = this.strokeBase0 + (this.strokeBase1 - this.strokeBase0) * t + Math.max(0, ground - ry);
    scene.sprites.push(d);
    this.dots++;
  }

  private drawTraps(scene: RenderScene, session: FeldSession, f: FishingFrame): void {
    const trap = this.trap;
    if (trap === null) return;
    const full = trap.clips['voll']?.frames[0] ?? 1;
    const v = f.view;
    const cx0 = Math.floor(v.left / TILE_PX) >> CHUNK_SHIFT;
    const cx1 = Math.floor(v.right / TILE_PX) >> CHUNK_SHIFT;
    const cy0 = Math.floor(v.top / TILE_PX) >> CHUNK_SHIFT;
    const cy1 = Math.floor((v.bottom + TILE_PX) / TILE_PX) >> CHUNK_SHIFT;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const traps = session.sampleFishTraps(f.layer, cx, cy);
        for (let k = 0; k < traps.length; k++) {
          const t = traps[k];
          if (t === undefined) continue;
          const d = scene.sprite.reset();
          d.frame = (trap.frames[t.fish.length > 0 ? full : 0] ?? trap.frames[0]) as SpriteFrameRef;
          d.x = t.tx * TILE_PX + TILE_PX / 2;
          d.y = t.ty * TILE_PX + TRAP_FOOT;
          d.heightBase = f.levelAt(t.tx, t.ty) * WAND_PX_JE_STUFE;
          scene.sprites.push(d);
        }
      }
    }
  }

  private pushHole(h: IceHole): void {
    const scene = this.holeScene;
    const f = this.holeFrame;
    const hole = this.hole;
    if (scene === null || f === null || hole === null || h.layer !== f.layer || this.holeDay - h.day >= BALANCE.fishing.iceHoleDays) return;
    const x = h.tx * TILE_PX;
    const y = h.ty * TILE_PX;
    const v = f.view;
    if (x + TILE_PX < v.left || x > v.right || y + TILE_PX < v.top || y > v.bottom) return;
    const d = scene.sprite.reset();
    d.frame = hole.frames[0] as SpriteFrameRef;
    d.x = x;
    d.y = y;
    d.layer = 'ground';
    d.heightBase = f.levelAt(h.tx, h.ty) * WAND_PX_JE_STUFE;
    scene.sprites.push(d);
  }
}
