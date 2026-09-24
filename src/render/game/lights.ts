/**
 * Presentation bridge of the light sources (MASTERPROMPT §12.1 "gespeist aus derselben
 * Lichtquellenliste wie der Renderer", docs/SPIEL.md §4, docs/RENDER.md §3 `LightInstance`; M3-21, M3-22):
 * the game view's lights are the simulation's light source list (`LightSystem.sources`), converted one by
 * one into the renderer's `LightDesc` – position, height, radius, intensity, flicker and cone unchanged,
 * the colour from the palette reference of the flame (`paletteLight`). The carried torch follows the
 * figure as the view interpolates it (the simulation holds the position of the last tick), with the same
 * hand offset. Placed lights draw their sprites: a camp fire with the clip of its state (`aus`, `brennt`,
 * `schwach`, `glut`, `asche`), a torch burning on its stake (`fackel_stand`) or on a wall (`fackel_wand`,
 * hung `wallMountPx` above the floor).
 *
 * While the render debugger shows a light map view (`lightmapPass.ts`) the bridge feeds it the gameplay
 * light of the visible tiles and draws the lights steady: the light map ignores flicker, and the
 * comparison shows exactly what the gameplay sees. Reads the simulation, never writes it; no allocation
 * per frame (colours are cached per palette reference).
 */
import { BALANCE } from '../../content/balance';
import { lightKind } from '../../content/lights';
import { fireClip } from '../../game/light/formulas';
import { CARRIED_LIGHT_ID, LIGHT_SYSTEM_ID, LightSystem } from '../../game/light/system';
import type { Simulation } from '../../game/sim';
import { TILE_PX, type Layer } from '../../world/model/coords';
import { clipFrameAt } from '../anim/animation';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import { LightmapDebugPass, LIGHTMAP_PASS_ORDER, type LightmapFeed } from '../debug/lightmapPass';
import { paletteLight, type Rgb } from '../light/lightColors';
import type { Renderer } from '../renderer';
import type { RenderScene } from '../scene';

/** Clip of a burning torch sprite (`fackel_stand`, `fackel_wand`) and of a put-out one. */
const TORCH_CLIP_LIT = 'idle';
const TORCH_CLIP_OUT = 'aus';
/** Animation phase offset per light id [s]: neighbouring flames do not flicker in step. */
const PHASE_STEP = 0.37;
/** Margin around the view in which placed lights still draw [px]: the tallest light sprite (32 px). */
const SPRITE_MARGIN = 2 * TILE_PX;
/** Offset of a wall torch's anchor from the wall line into its tile [px] (in front of the face, sorted after it). */
const WALL_ANCHOR_INSET_PX = 1;

/** What the bridge needs of the game view's frame. */
export interface LightFrame {
  /** Layer shown. */
  layer: Layer;
  /** Presentation time [s] (clips). */
  time: number;
  /** The figure as drawn (interpolated) – the carried light follows it; `hasFigure` false without one. */
  hasFigure: boolean;
  figureX: number;
  figureY: number;
  /** Visible world rectangle [px] (sprites outside are skipped). */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Tile of the interaction's use target (a fire to feed, a torch to take) on `layer`: that light carries the outline (§4.6); −1 none. */
  focusTx: number;
  focusTy: number;
}

/** A fresh frame record. */
export function createLightFrame(): LightFrame {
  return { layer: 0, time: 0, hasFigure: false, figureX: 0, figureY: 0, left: 0, top: 0, right: 0, bottom: 0, focusTx: -1, focusTy: -1 };
}

/** Counters of the last frame (debug info, tests). */
export interface LightBridgeStats {
  /** Lights handed to the renderer. */
  lights: number;
  /** Sprites of placed lights drawn. */
  sprites: number;
}

/** The light system of a simulation, or `null` (simulations without one, e.g. hand-built test worlds). */
export function lightSystemOf(sim: Simulation): LightSystem | null {
  const s = sim.systems.find((x) => x.id === LIGHT_SYSTEM_ID);
  return s instanceof LightSystem ? s : null;
}

class MapFeed implements LightmapFeed {
  sim: Simulation | null = null;
  light: LightSystem | null = null;
  layer: Layer = 0;

  fill(x0: number, y0: number, step: number, w: number, h: number, ambient: boolean, out: Float32Array): void {
    if (this.sim === null || this.light === null) {
      out.fill(0, 0, w * h);
      return;
    }
    this.light.mapFor(this.sim).fillLattice(this.layer, x0, y0, step, w, h, out, ambient);
  }
}

export class LightBridge {
  readonly stats: LightBridgeStats = { lights: 0, sprites: 0 };
  private pass: LightmapDebugPass | null = null;
  private readonly feed = new MapFeed();
  private readonly colours = new Map<string, Rgb>();
  private manifest: AtlasManifest | null = null;
  private readonly sprites = new Map<string, AtlasSprite | null>();
  private readonly offset = { dx: 0, dy: 0 };

  /** The light map debug pass while attached. */
  get debugPass(): LightmapDebugPass | null {
    return this.pass;
  }

  /** Adds the light map views to the renderer's debugger (the game view is shown). */
  attach(renderer: Renderer): void {
    if (this.pass !== null && renderer.passes.get(this.pass.name) === this.pass) return;
    const pipeline = renderer.lighting;
    this.pass = new LightmapDebugPass(() => pipeline.lighting);
    this.pass.setFeed(this.feed);
    renderer.passes.add(this.pass, LIGHTMAP_PASS_ORDER);
  }

  /** Removes the light map views (the game view is hidden). */
  detach(renderer: Renderer): void {
    if (this.pass !== null) renderer.passes.remove(this.pass.name);
    this.pass = null;
    this.feed.sim = null;
    this.feed.light = null;
  }

  /** Hands the simulation's lights of `frame.layer` to the renderer and draws the placed lights. */
  fill(scene: RenderScene, atlas: AtlasData | null, sim: Simulation, frame: LightFrame): void {
    this.stats.lights = 0;
    this.stats.sprites = 0;
    const light = lightSystemOf(sim);
    this.feed.sim = sim;
    this.feed.light = light;
    this.feed.layer = frame.layer;
    if (light === null) return;
    const steady = this.pass?.wanted ?? false;
    const sources = light.sources(sim);
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      if (s === undefined || s.layer !== frame.layer) continue;
      const d = scene.light.reset();
      if (s.id === CARRIED_LIGHT_ID && frame.hasFigure) {
        light.carriedOffset(sim, this.offset);
        d.x = frame.figureX + this.offset.dx;
        d.y = frame.figureY + this.offset.dy;
      } else {
        d.x = s.x;
        d.y = s.y;
      }
      d.height = s.height;
      d.radius = s.radius;
      const rgb = this.colour(s.farbe);
      d.r = rgb[0];
      d.g = rgb[1];
      d.b = rgb[2];
      d.intensity = s.intensity;
      d.flicker = steady ? 0 : s.flicker;
      d.seed = s.seed;
      d.coneDirection = s.coneDirection;
      d.coneAngle = s.coneAngle;
      scene.lights.push(d);
      this.stats.lights++;
    }
    if (atlas !== null) this.drawPlaced(scene, atlas, light, frame);
  }

  private drawPlaced(scene: RenderScene, atlas: AtlasData, light: LightSystem, frame: LightFrame): void {
    this.bind(atlas.manifest);
    const placed = light.state.placed;
    for (let i = 0; i < placed.length; i++) {
      const l = placed[i];
      if (l === undefined || l.layer !== frame.layer) continue;
      const x = (l.tx + 0.5) * TILE_PX;
      const wall = l.mount === 'wand';
      const y = wall ? l.ty * TILE_PX + WALL_ANCHOR_INSET_PX : (l.ty + 0.5) * TILE_PX;
      if (x < frame.left - SPRITE_MARGIN || x > frame.right + SPRITE_MARGIN || y < frame.top - SPRITE_MARGIN || y > frame.bottom + SPRITE_MARGIN) continue;
      const kind = lightKind(l.kind);
      let spriteId: string | undefined;
      let clipName: string;
      if (l.fire !== null) {
        spriteId = kind.sprites.boden;
        clipName = fireClip(l.fire);
      } else {
        spriteId = wall ? kind.sprites.wand : kind.sprites.stand;
        clipName = l.torch?.lit === true ? TORCH_CLIP_LIT : TORCH_CLIP_OUT;
      }
      const sprite = spriteId === undefined ? null : this.sprite(spriteId);
      const clip = sprite?.clips[clipName];
      if (sprite === null || clip === undefined) continue;
      const d = scene.sprite.reset();
      d.frame = (sprite.frames[clipFrameAt(clip, frame.time + l.id * PHASE_STEP)] ?? sprite.frames[0]) as SpriteFrameRef;
      d.x = x;
      d.y = y;
      d.heightBase = wall ? BALANCE.light.torch.wallMountPx : 0;
      d.outline = l.tx === frame.focusTx && l.ty === frame.focusTy;
      scene.sprites.push(d);
      this.stats.sprites++;
    }
  }

  private colour(ref: string): Rgb {
    let c = this.colours.get(ref);
    if (c === undefined) {
      c = paletteLight(ref);
      this.colours.set(ref, c);
    }
    return c;
  }

  private bind(manifest: AtlasManifest): void {
    if (this.manifest === manifest) return;
    this.manifest = manifest;
    this.sprites.clear();
  }

  private sprite(id: string): AtlasSprite | null {
    let s = this.sprites.get(id);
    if (s === undefined) {
      s = this.manifest?.sprites[id] ?? null;
      this.sprites.set(id, s);
    }
    return s;
  }
}
