/**
 * Presentation bridge of the light sources (MASTERPROMPT §12.1 "gespeist aus derselben
 * Lichtquellenliste wie der Renderer", docs/SPIEL.md §4, docs/RENDER.md §3 `LightInstance`; M3-21, M3-22):
 * the game view's lights are the simulation's light source list (`LightSystem.sources`), converted one by
 * one into the renderer's `LightDesc` – position, height, radius, intensity, flicker and cone unchanged,
 * the colour from the palette reference of the flame (`paletteLight`), the ground under it from the level of its tile
 * (`LightFrame.levelAt`: the light pass needs it for a light beyond its occluder mask). The carried torch follows the
 * figure as the view interpolates it (the simulation holds the position of the last tick), with the same
 * hand offset; a light on the belt (shield, two-hander, bow, crossbow: §12.2, ADR-0172) hangs at the hip outside the figure
 * (`BELT_LIGHT`). Placed lights draw their sprites: a camp fire with the clip of its state (`aus`, `brennt`,
 * `schwach`, `glut`, `asche`), a torch burning on its stake (`fackel_stand`) or on a wall (`fackel_wand`,
 * hung `wallMountPx` above the floor).
 *
 * While a dish roasts over a camp fire (M7-102; §18 "Spieß am Feuer"), the fire carries a spit with the dish on it: the
 * sprite `spiess_<product>` of the running recipe's product (assets-src/sprites/platzierbar/lagerfeuer_spiess.ts; a recipe
 * whose product has none – charcoal, boiled water, a broth – shows no spit), standing on the fire's anchor and sorted just in
 * front of it, its skewer over the flame at the fire's `kochen` socket. It roasts while the player's first crafting order
 * is worked – its piece begun (its `station` is set while a piece runs) and nothing `blocked` (the stall rule of the
 * station view) – at a burning station (`brennt`), over the lit camp fire nearest the figure on its layer: the one the
 * crafting system found in reach when the piece began (the nearest in reach is the nearest of all), and the one the piece
 * goes on roasting at when the player steps away (a piece, once begun, does not check its reach again). A fireplace is no
 * cooking spot (`LightSystem.cookingFireNear`) and carries none.
 *
 * While the render debugger shows a light map view (`lightmapPass.ts`) the bridge feeds it the gameplay
 * light of the visible tiles and draws the lights steady: the light map ignores flicker, and the
 * comparison shows exactly what the gameplay sees. Reads the simulation, never writes it; no allocation
 * per frame (colours are cached per palette reference).
 */
import { BALANCE } from '../../content/balance';
import { lightKind } from '../../content/lights';
import { CRAFTING_SYSTEM_ID, CraftingSystem } from '../../game/crafting/system';
import { fireClip } from '../../game/light/formulas';
import { CARRIED_LIGHT_ID, LIGHT_SYSTEM_ID, LightSystem, type SimLightSource } from '../../game/light/system';
import type { Simulation } from '../../game/sim';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import { TILE_PX, type Layer } from '../../world/model/coords';
import { clipFrameAt, type AnimationClip } from '../anim/animation';
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
/** Sprite of a dish on the spit over a camp fire: this prefix and the recipe's product (M7-102), and its clip (the spit turning). */
export const SPIT_SPRITE_PREFIX = 'spiess_';
export const SPIT_CLIP = 'dreht';
/** The spit sorts this far in front of its fire [px]: over the flame, behind anything standing a pixel further south. */
const SPIT_DEPTH_BIAS = 0.5;
/** Offset of a wall torch's anchor from the wall line into its tile [px] (in front of the face, sorted after it). */
const WALL_ANCHOR_INSET_PX = 1;
/**
 * Where a light hanging on the belt shines from (M6-Gate; the simulation gives it the hand's place, 3 px ahead at 14 px –
 * at the chest, where its light and the torch's sparks read as a torch held upright): at the hip on the off hand's side.
 * `heightPx` above the feet: the belt line of the 24-px figure (its tunic's belt 7–8 px up). Facing the viewer or away the
 * off hand's hip lies `sidePx` beside the body's middle (where the hanging arm meets the belt); in profile the off hand is
 * the far side: `depthPx` north of the feet, behind the body, and `backPx` towards the back (the 10-px profile reaches 4–5
 * px back). The light pool stays on the figure (a few px off its centre); the gameplay light map keeps the simulation's
 * place (within one tile of this one, the same light); the torch's sparks rise from here too (`carriedLightAt`).
 */
export const BELT_LIGHT = { heightPx: 7, sidePx: 6, depthPx: 3, backPx: 3 } as const;

/**
 * Turns the hand light's offset `o` (`LightSystem.carriedOffset`: `handReachPx` towards the facing) into the belt's
 * (`BELT_LIGHT`): the off hand's hip – on the right of the picture facing down, on the left facing up, the far hip in
 * profile. Returns `o`.
 */
export function beltLightOffset(o: { dx: number; dy: number }): { dx: number; dy: number } {
  if (o.dx > 0) {
    o.dx = -BELT_LIGHT.backPx;
    o.dy = -BELT_LIGHT.depthPx;
  } else if (o.dx < 0) {
    o.dx = BELT_LIGHT.backPx;
    o.dy = -BELT_LIGHT.depthPx;
  } else if (o.dy < 0) {
    o.dx = -BELT_LIGHT.sidePx;
    o.dy = 0;
  } else {
    o.dx = BELT_LIGHT.sidePx;
    o.dy = 0;
  }
  return o;
}

/** Where the carried light `s` shines from in the picture (`CarriedLightPlace`). */
export interface CarriedLightPlace {
  x: number;
  y: number;
  /** Height above the ground [px]. */
  height: number;
}

/**
 * The place of the carried light `s` (the simulation's `CARRIED_LIGHT_ID`) beside the figure drawn at (`figureX`,
 * `figureY`): in the hand the simulation's offset and flame height, on the belt at the hip (`BELT_LIGHT`). The light pass
 * and the torch's sparks and smoke both read it. `scratch` takes the offset. Returns `out`.
 */
export function carriedLightAt(light: LightSystem, sim: Simulation, s: SimLightSource, figureX: number, figureY: number, scratch: { dx: number; dy: number }, out: CarriedLightPlace): CarriedLightPlace {
  light.carriedOffset(sim, scratch);
  const belt = s.mount === 'guertel';
  if (belt) beltLightOffset(scratch);
  out.x = figureX + scratch.dx;
  out.y = figureY + scratch.dy;
  out.height = belt ? BELT_LIGHT.heightPx : s.height;
  return out;
}

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
  /**
   * Height level of tile (tx, ty) (a placed light stands on it: its sprite's height base, like stations and parts; every
   * light's ground, `LightDesc.base`).
   */
  levelAt(tx: number, ty: number): number;
}

/** A fresh frame record. */
export function createLightFrame(): LightFrame {
  return { layer: 0, time: 0, hasFigure: false, figureX: 0, figureY: 0, left: 0, top: 0, right: 0, bottom: 0, focusTx: -1, focusTy: -1, levelAt: () => 0 };
}

/** Counters of the last frame (debug info, tests). */
export interface LightBridgeStats {
  /** Lights handed to the renderer. */
  lights: number;
  /** Sprites of placed lights drawn. */
  sprites: number;
  /** Spits with a roasting dish drawn (M7-102; among `sprites`). */
  roasting: number;
}

/** The crafting system of a simulation and its burning stations (`brennt`: the camp fire), looked up once per simulation. */
interface Cooking {
  readonly sim: Simulation;
  readonly crafting: CraftingSystem | null;
  readonly burning: ReadonlySet<string>;
}

/** Whether `system` is the light system (a module function: no closure per lookup, §30). */
function isLightSystem(system: { readonly id: string }): boolean {
  return system.id === LIGHT_SYSTEM_ID;
}

/** The light system of a simulation, or `null` (simulations without one, e.g. hand-built test worlds). */
export function lightSystemOf(sim: Simulation): LightSystem | null {
  const s = sim.systems.find(isLightSystem);
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
  readonly stats: LightBridgeStats = { lights: 0, sprites: 0, roasting: 0 };
  private pass: LightmapDebugPass | null = null;
  private readonly feed = new MapFeed();
  private readonly colours = new Map<string, Rgb>();
  private manifest: AtlasManifest | null = null;
  private readonly sprites = new Map<string, AtlasSprite | null>();
  private readonly offset = { dx: 0, dy: 0 };
  private readonly carried: CarriedLightPlace = { x: 0, y: 0, height: 0 };
  private cooking: Cooking | null = null;
  /** The spit sprite of each recipe id seen (null: its product has none); cleared with the atlas. */
  private readonly spits = new Map<string, AtlasSprite | null>();

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
    this.stats.roasting = 0;
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
        const at = carriedLightAt(light, sim, s, frame.figureX, frame.figureY, this.offset, this.carried);
        d.x = at.x;
        d.y = at.y;
        d.height = at.height;
      } else {
        d.x = s.x;
        d.y = s.y;
        d.height = s.height;
      }
      // The ground it stands on (M5 review M2): the level of its tile, known here even where the light pass's occluder
      // mask does not reach (a light beside the view).
      d.base = frame.levelAt(Math.floor(d.x / TILE_PX), Math.floor(d.y / TILE_PX)) * WAND_PX_JE_STUFE;
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
    if (atlas !== null) this.drawPlaced(scene, atlas, sim, light, frame);
  }

  private drawPlaced(scene: RenderScene, atlas: AtlasData, sim: Simulation, light: LightSystem, frame: LightFrame): void {
    this.bind(atlas.manifest);
    const placed = light.state.placed;
    // The dish roasting now and the fire it roasts over (see the module comment): the lit camp fire nearest the figure.
    const spit = frame.hasFigure ? this.roasting(sim) : null;
    const spitClip: AnimationClip | undefined = spit?.clips[SPIT_CLIP];
    let spitFire = -1;
    if (spit !== null && spitClip !== undefined) {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < placed.length; i++) {
        const l = placed[i];
        if (l === undefined || l.layer !== frame.layer || l.fire === null || !l.fire.lit || lightKind(l.kind).moebel !== undefined) continue;
        const dx = (l.tx + 0.5) * TILE_PX - frame.figureX;
        const dy = (l.ty + 0.5) * TILE_PX - frame.figureY;
        const d2 = dx * dx + dy * dy;
        if (d2 <= best) {
          best = d2;
          spitFire = l.id;
        }
      }
    }
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
      // On the level it stands on (a torch on a plateau, a fire on a raised floor), a wall torch higher by its mount.
      d.heightBase = frame.levelAt(l.tx, l.ty) * WAND_PX_JE_STUFE + (wall ? BALANCE.light.torch.wallMountPx : 0);
      d.outline = l.tx === frame.focusTx && l.ty === frame.focusTy;
      scene.sprites.push(d);
      this.stats.sprites++;
      if (l.id !== spitFire || spit === null || spitClip === undefined) continue;
      // The spit on the fire's anchor, just in front of it (over its flame), on its height, outlined with the fire it belongs
      // to – read before the record is reset: `scene.sprite` is one record for every sprite pushed.
      const heightBase = d.heightBase;
      const outline = d.outline;
      const s = scene.sprite.reset();
      s.frame = (spit.frames[clipFrameAt(spitClip, frame.time + l.id * PHASE_STEP)] ?? spit.frames[0]) as SpriteFrameRef;
      s.x = x;
      s.y = y;
      s.depth = y + SPIT_DEPTH_BIAS;
      s.heightBase = heightBase;
      s.outline = outline;
      scene.sprites.push(s);
      this.stats.sprites++;
      this.stats.roasting++;
    }
  }

  /**
   * The spit sprite of the dish roasting now, or `null`: the player's first order is worked (its piece begun – `station`
   * is set from its first tick to its last –, not stalled) at a burning station and its product has a spit sprite.
   */
  private roasting(sim: Simulation): AtlasSprite | null {
    const c = this.cookingOf(sim);
    const crafting = c.crafting;
    if (crafting === null) return null;
    const order = crafting.orders[0];
    if (order === undefined || crafting.blocked !== null || order.station === undefined || !c.burning.has(order.station)) return null;
    let s = this.spits.get(order.rezept);
    if (s === undefined) {
      const recipe = crafting.recipes.find(order.rezept);
      s = recipe === undefined ? null : this.sprite(SPIT_SPRITE_PREFIX + recipe.ergebnis.item);
      this.spits.set(order.rezept, s);
    }
    return s;
  }

  private cookingOf(sim: Simulation): Cooking {
    let c = this.cooking;
    if (c === null || c.sim !== sim) {
      const found = sim.systems.find((x) => x.id === CRAFTING_SYSTEM_ID);
      const crafting = found instanceof CraftingSystem ? found : null;
      const burning = new Set<string>();
      if (crafting !== null) for (const st of crafting.recipes.stations.list) if (st.brennt === true) burning.add(st.id);
      c = { sim, crafting, burning };
      this.cooking = c;
    }
    return c;
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
    this.spits.clear();
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
