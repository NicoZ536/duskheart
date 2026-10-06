/**
 * The beacons in the game view (MASTERPROMPT §8 "Entzünden → die Region heilt sichtbar", §6.2; docs/SPIEL.md §22, §30
 * "Render-Szenen-Teile"; strand F, M7-35). Read only from the system `beacons` (found once per simulation):
 *
 * - **The beacon** `leuchtfeuer` (assets-src/sprites/leuchtfeuer/leuchtfeuer.ts) on its 3 × 3 site, its foot on the
 *   footprint's front edge, the clip by its state: `erloschen`, `bereit` (its warden defeated: embers breathe), `entzuenden`
 *   spread over the ignition sequence (`BALANCE.beacons.ignitionSeconds`), `brennend`. The interaction's use target on its
 *   footprint carries the outline. Its light is the system's (`lightProvider`, the light bridge draws it).
 * - **The light wave** of a freshly lit beacon: its front – the radius `waveRadiusTiles` the healing runs out with – as a
 *   ring of cool Lumen sparks on the ground (`kampf_punkt` frames `eis.4*`/`eis.3*`, twinkling), a dimmer ring a few pixels
 *   behind it; drawn only where the ring crosses the view and only until it has passed the whole view.
 * The healing of the grade and the retreat of the corruption are the atmosphere's (src/render/world/beaconScene.ts).
 *
 * No allocation per frame: sprite and clips looked up once per atlas, the wave walked on the circle by angle.
 */
import { BALANCE } from '../../content/balance';
import { BeaconsSystem } from '../../game/beacons/system';
import { waveRadiusTiles } from '../../game/beacons/formulas';
import type { BeaconState } from '../../game/beacons/types';
import type { Simulation } from '../../game/sim';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { AnimationClip } from '../anim/animation';
import { clipFrameAt } from '../anim/animation';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { RenderScene } from '../scene';
import { DOT_SPRITE, PUNKT } from './combatFeedback';

const TICK_HZ = BALANCE.time.tickHz;
/** The beacon's sprite and its clips per state. */
export const BEACON_SPRITE = 'leuchtfeuer';
export const BEACON_CLIPS = { erloschen: 'erloschen', bereit: 'bereit', entzuendung: 'entzuenden', entzuendet: 'brennend' } as const satisfies Record<BeaconState['state'], string>;
/** Ticks of the ignition sequence (the system's). */
const IGNITION_TICKS = Math.round(BALANCE.beacons.ignitionSeconds * TICK_HZ);
/** Half the footprint [tiles] (3 × 3 around the site's centre tile). */
const HALF = 1;
/** Gap between the wave's front ring and the dimmer ring behind it [px]. */
const WAVE_TRAIL_PX = 5;
/** Spacing of the wave's sparks along the ring [px], and how often they twinkle [ticks]. */
const WAVE_STEP_PX = 2;
const WAVE_TWINKLE_TICKS = 3;
/** Emissive boost of the wave's sparks. */
const WAVE_GLOW = 0.7;

/** What the beacon view needs of the game view's frame. */
export interface BeaconFrame {
  layer: Layer;
  /** Pushed rectangle [world px]. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Presentation time [s] and the simulation's time [ticks, with the render fraction]. */
  time: number;
  now: number;
  /** Tile of the interaction's use target on `layer` (−1 none). */
  focusTx: number;
  focusTy: number;
  levelAt(tx: number, ty: number): number;
}

/** A fresh frame record. */
export function createBeaconFrame(): BeaconFrame {
  return { layer: 0, left: 0, top: 0, right: 0, bottom: 0, time: 0, now: 0, focusTx: -1, focusTy: -1, levelAt: () => 0 };
}

/** Counters of the last frame (debug info, tests). */
export interface BeaconViewStats {
  beacons: number;
  wavePixels: number;
}

/** Clip position of the ignition sequence at `now` [ticks] (`start` = the ignition's tick): spread over its length. */
export function ignitionPosition(clip: AnimationClip, start: number, now: number): number {
  const share = (now - start) / IGNITION_TICKS;
  return Math.max(0, Math.min(clip.frames.length - 1, Math.floor(share * clip.frames.length)));
}

export class BeaconView {
  readonly stats: BeaconViewStats = { beacons: 0, wavePixels: 0 };
  private system: BeaconsSystem | null = null;
  private systemSim: Simulation | null = null;
  private manifest: AtlasManifest | null = null;
  private sprite: AtlasSprite | null = null;
  private dot: AtlasSprite | null = null;

  /** Draws the beacons of the frame's layer and the light waves crossing its view. */
  draw(scene: RenderScene, atlas: AtlasData, sim: Simulation, f: BeaconFrame): void {
    this.stats.beacons = 0;
    this.stats.wavePixels = 0;
    const s = this.systemOf(sim);
    if (s === null) return;
    this.bind(atlas.manifest);
    for (let n = 1; n <= s.defs.length; n++) {
      const site = s.site(sim, n);
      if (site === null || site.layer !== f.layer) continue;
      const st = s.state(n);
      if (st.state === 'entzuendet') this.wave(scene, site.x, site.y, st.litTick, f);
      const margin = 4 * TILE_PX;
      if (site.x < f.left - margin || site.x > f.right + margin || site.y < f.top - margin || site.y > f.bottom + 8 * TILE_PX) continue;
      const sp = this.sprite;
      if (sp === null) continue;
      const clip = sp.clips[BEACON_CLIPS[st.state]];
      let frame = 0;
      if (clip !== undefined) frame = st.state === 'entzuendung' ? (clip.frames[ignitionPosition(clip, st.ignitionTick, f.now)] ?? 0) : clipFrameAt(clip, f.time);
      const d = scene.sprite.reset();
      d.frame = (sp.frames[frame] ?? sp.frames[0]) as SpriteFrameRef;
      d.x = site.x;
      d.y = site.y + (HALF + 1 / 2) * TILE_PX - 1;
      d.heightBase = f.levelAt(site.tx, site.ty) * WAND_PX_JE_STUFE;
      d.outline = Math.abs(f.focusTx - site.tx) <= HALF && Math.abs(f.focusTy - site.ty) <= HALF;
      d.emissiveBoost = st.state === 'entzuendet' ? 0.35 : st.state === 'entzuendung' ? 0.5 : 0;
      scene.sprites.push(d);
      this.stats.beacons++;
    }
  }

  /** The front of the light wave of a beacon lit at `litTick` around (cx, cy), where it crosses the view. */
  private wave(scene: RenderScene, cx: number, cy: number, litTick: number, f: BeaconFrame): void {
    const dot = this.dot;
    if (dot === null) return;
    const r = waveRadiusTiles(litTick, f.now) * TILE_PX;
    if (r <= 0) return;
    // Nearest and farthest point of the view from the centre: the ring crosses the view only between them.
    const nx = cx < f.left ? f.left : cx > f.right ? f.right : cx;
    const ny = cy < f.top ? f.top : cy > f.bottom ? f.bottom : cy;
    const near = Math.hypot(nx - cx, ny - cy);
    const fx = Math.max(Math.abs(f.left - cx), Math.abs(f.right - cx));
    const fy = Math.max(Math.abs(f.top - cy), Math.abs(f.bottom - cy));
    const far = Math.hypot(fx, fy);
    if (r < near || r - WAVE_TRAIL_PX > far) return;
    this.ring(scene, dot, cx, cy, r, f, PUNKT.schmier);
    if (r > WAVE_TRAIL_PX) this.ring(scene, dot, cx, cy, r - WAVE_TRAIL_PX, f, PUNKT.schmierDunkel);
  }

  private ring(scene: RenderScene, dot: AtlasSprite, cx: number, cy: number, r: number, f: BeaconFrame, frame: number): void {
    const step = WAVE_STEP_PX / r;
    const twinkle = Math.floor(f.now / WAVE_TWINKLE_TICKS);
    let k = 0;
    for (let a = 0; a < 2 * Math.PI; a += step, k++) {
      const x = Math.round(cx + Math.cos(a) * r);
      const y = Math.round(cy + Math.sin(a) * r);
      if (x < f.left || x > f.right || y < f.top || y > f.bottom) continue;
      // Sparks twinkle: a third of them dark at any moment, moving along the ring.
      if ((k + twinkle) % 3 === 0) continue;
      const d = scene.sprite.reset();
      d.frame = dot.frames[frame] as SpriteFrameRef;
      d.x = x;
      d.y = y;
      d.layer = 'ground';
      d.emissiveBoost = WAVE_GLOW;
      scene.sprites.push(d);
      this.stats.wavePixels++;
    }
  }

  private bind(m: AtlasManifest): void {
    if (this.manifest === m) return;
    this.manifest = m;
    this.sprite = m.sprites[BEACON_SPRITE] ?? null;
    this.dot = m.sprites[DOT_SPRITE] ?? null;
  }

  private systemOf(sim: Simulation): BeaconsSystem | null {
    if (this.systemSim !== sim) {
      const s = sim.systems.find((x) => x instanceof BeaconsSystem);
      this.system = s instanceof BeaconsSystem ? s : null;
      this.systemSim = sim;
    }
    return this.system;
  }
}
