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
 * - **Particles** at the bowl (sources of src/content/particles/leuchtfeuer.ts): embers breathing while the beacon waits
 *   (`bereit`), the storm of Lumen motes growing with the ignition and dying away `STORM_AFTER_SECONDS` after the flame
 *   stands (docs/SPIEL.md §22 "Partikelsturm"), then the calm sparks of the burning beacon.
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
import { particleEmitter } from '../particles/tables';
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
/** Height of the bowl above the sprite's foot [px] (assets-src/sprites/leuchtfeuer/leuchtfeuer.ts: bowl row 52, anchor row 112). */
const BOWL_HEIGHT_PX = 60;
/** How long the Lumen storm lasts after the flame stands [s] – it dies away linearly (the wave carries the light on). */
const STORM_AFTER_SECONDS = 6;
/** Stable numbers of the beacons' particle sources (four per beacon), far from the light sources' `id × 4`. */
const PARTICLE_ID_BASE = 0x4c460000;
/** Tiles beyond the view in which a beacon is still drawn: beside and below it, and above it (its sprite reaches 7 tiles up). */
const VIEW_MARGIN_TILES = 4;
const BELOW_MARGIN_TILES = 8;
/** Wave speed [tiles/s] as a whole number (the integer test below), checked against the balance. */
const WAVE_TILES_PER_SECOND = BALANCE.beacons.waveTilesPerSecond;
if (!Number.isInteger(WAVE_TILES_PER_SECOND)) throw new Error('beacons: waveTilesPerSecond must be a whole number of tiles');

/**
 * Whether the wave of a beacon lit at `litTick` may still cross the frame's tiles – integers only: its radius
 * (ticks × tiles per second / tick rate) has not yet passed the frame's farthest tile (a Manhattan bound, never too small).
 */
function waveCrosses(site: { readonly tx: number; readonly ty: number }, litTick: number, f: BeaconFrame): boolean {
  const ax = site.tx - f.tileLeft;
  const bx = f.tileRight - site.tx;
  const ay = site.ty - f.tileTop;
  const by = f.tileBottom - site.ty;
  const far = (ax > bx ? (ax > -ax ? ax : -ax) : bx > -bx ? bx : -bx) + (ay > by ? (ay > -ay ? ay : -ay) : by > -by ? by : -by) + 2;
  return (f.tick - litTick) * WAVE_TILES_PER_SECOND <= far * TICK_HZ;
}

/** What the beacon view needs of the game view's frame. */
export interface BeaconFrame {
  layer: Layer;
  /** Pushed rectangle [whole world px] and the tiles it covers (integers: a frame without a beacon in view forms no number). */
  left: number;
  top: number;
  right: number;
  bottom: number;
  tileLeft: number;
  tileTop: number;
  tileRight: number;
  tileBottom: number;
  /** Presentation time [s]; the simulation's tick and render fraction; `now` = tick + fraction, formed by the view only when needed. */
  time: number;
  tick: number;
  alpha: number;
  now: number;
  /** Tile of the interaction's use target on `layer` (−1 none). */
  focusTx: number;
  focusTy: number;
  levelAt(tx: number, ty: number): number;
}

/** A fresh frame record. */
export function createBeaconFrame(): BeaconFrame {
  return { layer: 0, left: 0, top: 0, right: 0, bottom: 0, tileLeft: 0, tileTop: 0, tileRight: 0, tileBottom: 0, time: 0, tick: 0, alpha: 0, now: 0, focusTx: -1, focusTy: -1, levelAt: () => 0 };
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
  private presets: { readonly storm: number; readonly sparks: number; readonly embers: number } | null = null;

  /** Draws the beacons of the frame's layer and the light waves crossing its view. */
  draw(scene: RenderScene, atlas: AtlasData, sim: Simulation, f: BeaconFrame): void {
    this.stats.beacons = 0;
    this.stats.wavePixels = 0;
    const s = this.systemOf(sim);
    if (s === null) return;
    this.bind(atlas.manifest);
    let timed = false;
    for (let n = 1; n <= s.defs.length; n++) {
      const site = s.site(sim, n);
      if (site === null || site.layer !== f.layer) continue;
      const st = s.state(n);
      const waving = st.state === 'entzuendet' && waveCrosses(site, st.litTick, f);
      // The beacon (its flame reaches above the view's top) or its wave in view: only then a number is formed.
      const inView = site.tx + VIEW_MARGIN_TILES >= f.tileLeft && site.tx - VIEW_MARGIN_TILES <= f.tileRight && site.ty + VIEW_MARGIN_TILES >= f.tileTop && site.ty - BELOW_MARGIN_TILES <= f.tileBottom;
      if (!waving && !inView) continue;
      if (!timed) {
        f.now = f.tick + f.alpha;
        timed = true;
      }
      if (waving) this.wave(scene, site.x, site.y, st.litTick, f);
      if (!inView) continue;
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
      this.particles(scene, st, n, d.x, d.y, f);
    }
  }

  /** The particles at the bowl of beacon `n` (foot at x, y) in its state (see the module comment). */
  private particles(scene: RenderScene, st: Readonly<BeaconState>, n: number, x: number, y: number, f: BeaconFrame): void {
    const p = (this.presets ??= { storm: particleEmitter('leuchtfeuer_sturm'), sparks: particleEmitter('leuchtfeuer_funken'), embers: particleEmitter('leuchtfeuer_glut') });
    const e = scene.particles.emitters;
    const id = PARTICLE_ID_BASE + n * 4;
    if (st.state === 'bereit') e.push(p.embers, x, y, BOWL_HEIGHT_PX, 1, id);
    else if (st.state === 'entzuendung') {
      e.push(p.embers, x, y, BOWL_HEIGHT_PX, 1, id);
      e.push(p.storm, x, y, BOWL_HEIGHT_PX, Math.max(0, Math.min(1, (f.now - st.ignitionTick) / IGNITION_TICKS)), id + 1);
    } else if (st.state === 'entzuendet') {
      e.push(p.sparks, x, y, BOWL_HEIGHT_PX, 1, id + 2);
      const after = (f.now - st.litTick) / TICK_HZ;
      if (after < STORM_AFTER_SECONDS) e.push(p.storm, x, y, BOWL_HEIGHT_PX, 1 - Math.max(0, after) / STORM_AFTER_SECONDS, id + 1);
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
