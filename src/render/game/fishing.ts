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
import type { FeldSession } from './farming';
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

/** What the fishing view draws in a frame. */
export interface FishingFrame {
  layer: Layer;
  left: number;
  top: number;
  right: number;
  bottom: number;
  time: number;
  /** The figure's feet [world px] (drawn position), its height base [px] and whether there is a figure. */
  figureX: number;
  figureY: number;
  figureHeight: number;
  hasFigure: boolean;
  /** The figure's main hand in the frame [world px] (`HandPoint`), when it drew one: the rod's butt. */
  handX: number;
  handY: number;
  hand: boolean;
  levelAt: (tx: number, ty: number) => number;
}

export function createFishingFrame(): FishingFrame {
  return { layer: 0, left: 0, top: 0, right: 0, bottom: 0, time: 0, figureX: 0, figureY: 0, figureHeight: 0, hasFigure: false, handX: 0, handY: 0, hand: false, levelAt: () => 0 };
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
  private lastTime = 0;
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
    const dt = Math.max(0, Math.min(0.1, f.time - this.lastTime));
    this.lastTime = f.time;
    const phase = s.phase;
    if (phase === 'aus' || s.layer !== f.layer || !f.hasFigure) {
      this.lastPhase = phase;
      this.lastLeap = false;
      return;
    }
    // Splashes: the float landing, the bite, a leap; a wake while the fish fights.
    if (phase === 'warten' && this.lastPhase === 'wurf') scene.water.impulse('arrow', s.floatX, s.floatY);
    if (phase === 'biss' && this.lastPhase !== 'biss') scene.water.impulse('fish', s.floatX, s.floatY);
    if (s.leaping && !this.lastLeap) scene.water.impulse('splash', s.floatX, s.floatY);
    if (phase === 'drill') scene.water.impulse('figureIdle', s.floatX, s.floatY, dt * (1 + Math.abs(s.pull) * 3));
    this.lastPhase = phase;
    this.lastLeap = s.leaping;
    if (phase === 'gefangen' || phase === 'verloren') return;
    const side = s.floatX >= f.figureX ? 1 : -1;
    const hx = f.hand ? f.handX : f.figureX + side * HAND_SIDE;
    const hy = f.hand ? f.handY : f.figureY - HAND_UP;
    const taut = phase === 'drill' ? s.tension : 0;
    const tipX = hx + side * ROD_OUT + s.pull * ROD_PULL * taut;
    const tipY = hy - ROD_UP + taut * ROD_BEND;
    // The rod: a quadratic curve from the hand, its control point on the unbent rod (straight while the line is slack, bowed
    // as the taut line pulls the tip down); in front of the figure, lifted over its feet (its height base: the dots stand on
    // the figure's ground line).
    const cx = hx + side * ROD_OUT * ROD_STIFF;
    const cy = hy - ROD_UP * ROD_STIFF;
    // Fishing up the screen the figure turns its back: the rod goes out behind its body.
    const away = s.floatY < f.figureY && f.figureY - s.floatY > Math.abs(s.floatX - f.figureX);
    const rodDepth = f.figureY + (away ? ROD_BEHIND : ROD_DEPTH);
    const rodDots = Math.min(ROD_DOTS_MAX, Math.ceil(Math.hypot(tipX - hx, tipY - hy) / DOT_STEP) + 2);
    this.lastDotX = Number.NaN;
    for (let k = 0; k <= rodDots; k++) {
      const t = k / rodDots;
      const u = 1 - t;
      this.pushDot(scene, 0, u * u * hx + 2 * u * t * cx + t * t * tipX, u * u * hy + 2 * u * t * cy + t * t * tipY, rodDepth, f.figureY, f.figureHeight);
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
    const n = Math.max(LINE_MIN, Math.min(LINE_MAX, Math.round(Math.hypot(lx, ly) / DOT_STEP)));
    this.lastDotX = Number.NaN;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const ground = f.figureY + (fy - f.figureY) * t;
      this.pushDot(scene, 1, tipX + lx * t, tipY + ly * t + sag * 4 * t * (1 - t), ground + LINE_DEPTH, ground, f.figureHeight * (1 - t));
    }
  }

  /**
   * One dot of rod or line at (x, y) standing over ground line `ground` (y-sorted at `depth`), on height base `base` [px]: its
   * height over that line lifts it (`heightBase`), so the G-buffer puts it in front of what lies behind its foot.
   */
  private pushDot(scene: RenderScene, frame: number, x: number, y: number, depth: number, ground: number, base: number): void {
    const dot = this.dot;
    const rx = Math.round(x);
    const ry = Math.round(y);
    // A dot on the pixel of the one before adds nothing.
    if (dot === null || (rx === this.lastDotX && ry === this.lastDotY)) return;
    this.lastDotX = rx;
    this.lastDotY = ry;
    const d = scene.sprite.reset();
    d.frame = (dot.frames[frame] ?? dot.frames[0]) as SpriteFrameRef;
    d.x = rx;
    d.y = ry;
    d.depth = depth;
    d.heightBase = base + Math.max(0, ground - d.y);
    scene.sprites.push(d);
    this.dots++;
  }

  private drawTraps(scene: RenderScene, session: FeldSession, f: FishingFrame): void {
    const trap = this.trap;
    if (trap === null) return;
    const full = trap.clips['voll']?.frames[0] ?? 1;
    const cx0 = Math.floor(f.left / TILE_PX) >> CHUNK_SHIFT;
    const cx1 = Math.floor(f.right / TILE_PX) >> CHUNK_SHIFT;
    const cy0 = Math.floor(f.top / TILE_PX) >> CHUNK_SHIFT;
    const cy1 = Math.floor((f.bottom + TILE_PX) / TILE_PX) >> CHUNK_SHIFT;
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
    if (x + TILE_PX < f.left || x > f.right || y + TILE_PX < f.top || y > f.bottom) return;
    const d = scene.sprite.reset();
    d.frame = hole.frames[0] as SpriteFrameRef;
    d.x = x;
    d.y = y;
    d.layer = 'ground';
    d.heightBase = f.levelAt(h.tx, h.ty) * WAND_PX_JE_STUFE;
    scene.sprites.push(d);
  }
}
