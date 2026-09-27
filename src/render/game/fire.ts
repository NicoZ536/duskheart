/**
 * Burning tiles in the game view (MASTERPROMPT §16.2 "Brennbar", §16.8, §6.2 "Feuer: animierte Flammen"; M4-28 on
 * screen): every tile of the fire simulation (`FireSystem.cells`) on the shown layer carries animated flames of the
 * sprite `brand` (assets-src/sprites/effekte/brand.ts) where the thing that burns stands –
 * - on an upright part (walls, doors, windows, fences, pillars, gates) up its 16-px front and over its top,
 * - on furniture and wall furniture at its foot, on a floor low on the planks,
 * - on a roof at the roof's height (sorted with the roof, fading with it in the interior view),
 * - on a standing tree at the trunk and in the crown.
 * How big the flames are follows the fire's course (`fireStage`): a young fire grows from a small tongue to the full
 * blaze within seconds, a part burned down to its last hit points sinks to an ember bed, a barely flammable part
 * (timber frame, §16.2 "kaum (−70 %)") never burns in full. Neighbouring flames run out of step and some stand
 * mirrored (tile hash). The flames are emissive (they glow at night, as bright as a camp fire's); their light is the fire's entry in the
 * simulation's light source list (`FireSystem.lightProvider`, drawn by `lights.ts`) – one list with the gameplay
 * light map. Sparks, smoke and heat shimmer come with the full fire effects (M5-21).
 *
 * Reads the simulation, never writes it; no allocation per frame.
 */
import { BALANCE } from '../../content/balance';
import { hash2, hashToUnit } from '../../engine/rng';
import { BUILDING_SYSTEM_ID, BuildingSystem } from '../../game/building/system';
import { worldSecond } from '../../game/fire/formulas';
import type { FireCell } from '../../game/fire/state';
import { FIRE_SYSTEM_ID, FireSystem } from '../../game/fire/system';
import { createObjectHit, GATHERING_SYSTEM_ID, GatheringSystem } from '../../game/gathering/system';
import type { Simulation } from '../../game/sim';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import type { Layer } from '../../world/model/coords';
import type { PartDef } from '../../world/structures/catalog';
import { BUILD_LAYER_COUNT, BUILD_LAYER_INDEX, cellBlueprint, cellCovered, cellDx, cellDy, cellPart } from '../../world/structures/cells';
import { clipFrameAt, type AnimationClip } from '../anim/animation';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { RenderScene } from '../scene';
import { TILE_PX } from '../tilemap/chunk';
import type { WorldRenderTables } from '../world/tables';
import { roofColumn, type InteriorView, type RoofRun } from './roofs';

/** The flame sprite and its clips by stage (index = `fireStage`). */
export const FIRE_SPRITE = 'brand';
export const FIRE_STAGE_CLIPS = ['glimmen', 'klein', 'mittel', 'gross'] as const;
/** Stages: ember bed, small tongue, flame, full blaze. */
export const STAGE = { glimmen: 0, klein: 1, mittel: 2, gross: 3 } as const;

/**
 * Course of a fire on screen: seconds after catching when the flames reach the next stage (small → flame → full
 * blaze; a wall of wood burns 30 s, a neighbour catches after 12 s: `BALANCE.fire`), the share of hit points left below
 * which they sink one stage (flame, small tongue, ember bed), and the flammability below which a part never burns in
 * full (timber frame 0,3, §16.2 "kaum").
 */
export const FIRE_COURSE = { growSeconds: [1, 4], sinkBelow: [0.5, 0.3, 0.12], lowFlammability: 0.5 } as const;

/** Stage of a fire `age` seconds after it caught, `fuel` share of hit points left [0–1], burning `flammability`. */
export function fireStage(age: number, fuel: number, flammability: number): number {
  const G = FIRE_COURSE.growSeconds;
  let s: number = age < (G[0] as number) ? STAGE.klein : age < (G[1] as number) ? STAGE.mittel : STAGE.gross;
  const S = FIRE_COURSE.sinkBelow;
  if (fuel < (S[2] as number)) s = Math.min(s, STAGE.glimmen);
  else if (fuel < (S[1] as number)) s = Math.min(s, STAGE.klein);
  else if (fuel < (S[0] as number)) s = Math.min(s, STAGE.mittel);
  if (flammability < FIRE_COURSE.lowFlammability) s = Math.min(s, STAGE.mittel);
  return s;
}

/** Where flames sit on what burns: anchor offsets from the tile's top-left corner [px] and the stage below the fire's. */
interface FlameSpot {
  readonly dx: number;
  readonly dy: number;
  /** Stages below the fire's stage (0 = the fire's own); a spot below the ember bed is not drawn. */
  readonly less: number;
  /** Only from this fire stage on. */
  readonly from: number;
}

/**
 * Flames on an upright part: at the foot of its 16-px front (the wall band ends at row 10, assets-src/sprites/bau/
 * _bau.ts), tongues over its top from a flame on, a third flame beside them in a full blaze. `side` (±1 by tile hash)
 * mirrors the side flames.
 */
const UPRIGHT_SPOTS: readonly FlameSpot[] = [
  { dx: 0, dy: 11, less: 0, from: STAGE.glimmen },
  { dx: 3, dy: 2, less: 1, from: STAGE.mittel },
  { dx: -4, dy: 6, less: 2, from: STAGE.gross },
];
/** Flames on furniture: at its foot, a tongue over it in a full blaze. */
const OBJECT_SPOTS: readonly FlameSpot[] = [
  { dx: 0, dy: 15, less: 0, from: STAGE.glimmen },
  { dx: 3, dy: 8, less: 2, from: STAGE.gross },
];
/** Flames on a floor: low on the planks (a floor burns flat: never a full blaze). */
const FLOOR_SPOTS: readonly FlameSpot[] = [{ dx: 0, dy: 14, less: 1, from: STAGE.glimmen }];
/** Flames on a roof: on its surface, which lies at wall height (rows −16 … −1 of its tile), tongues above from a flame on. */
const ROOF_SPOTS: readonly FlameSpot[] = [
  { dx: 0, dy: -2, less: 0, from: STAGE.glimmen },
  { dx: -4, dy: -8, less: 1, from: STAGE.mittel },
];
/** Flames on a tree: at the trunk (tile foot); the crown's are placed by the tree's height (`CROWN_SPOTS`). */
const TRUNK_SPOTS: readonly FlameSpot[] = [{ dx: 0, dy: 15, less: 0, from: STAGE.glimmen }];
/** Flames in a burning crown: offset [px] and height as a share of the tree's height above its foot. */
const CROWN_SPOTS: ReadonlyArray<{ readonly dx: number; readonly share: number; readonly less: number; readonly from: number }> = [
  { dx: -3, share: 0.55, less: 0, from: STAGE.mittel },
  { dx: 5, share: 0.75, less: 1, from: STAGE.gross },
];
/** Foot row of a tile [px]: flames on a tree root there. */
const TILE_FOOT = TILE_PX - 1;
/** Flames sort just in front of what burns on their tile (it sorts at its foot row) [px]. */
const FLAME_DEPTH = 0.5;
/** Flames on a roof sort just in front of the roof (sorted at its column's eave). */
const ROOF_FLAME_DEPTH = 0.25;
/** Offset of a roof column's depth behind its eave row's anchor [px] (as `building.ts` sorts roofs). */
const ROOF_DEPTH = 0.5;

/** Phase spread of the flames of one tile and between tiles [s] (the clips loop in half a second). */
const PHASE_SPAN = 0.5;
/** Hash salt of the flame phases and mirrors. */
const SALT = 11;
/** Tiles pushed beyond the view's edges (tall flames of a crown stand below the view). */
const MARGIN_TILES = 2;
/** Tallest tree above its foot when the render tables do not know it [px]. */
const DEFAULT_TREE_TOP = 48;

/** What a frame of the fire view needs of the game view. */
export interface FireFrame {
  layer: Layer;
  /** Pushed rectangle [world px]. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Presentation time [s]. */
  time: number;
  /** Height level of a tile (the lit height rises by 16 px per level). */
  levelAt(tx: number, ty: number): number;
}

/** A fresh frame record. */
export function createFireFrame(): FireFrame {
  return { layer: 0, left: 0, top: 0, right: 0, bottom: 0, time: 0, levelAt: () => 0 };
}

/** What the fire view drew in the last frame. */
export interface FireStats {
  /** Burning tiles drawn. */
  tiles: number;
  /** Flame sprites. */
  flames: number;
}

/** What burns on a tile, found once per tile and frame (reused). */
interface Burning {
  upright: boolean;
  object: boolean;
  floor: boolean;
  roof: boolean;
  /** Most flammable finished part on the tile [0–1] (a tree: its flammability). */
  flammability: number;
  /** Largest share of hit points left of what burns [0–1]. */
  fuel: number;
  /** Anchor foot row of the tallest thing burning [world px] (flames sort before it). */
  foot: number;
  /** Depth of the roof column over the tile, and the fade of the roof in the interior view. */
  roofDepth: number;
  roofFade: number;
  /** Height of a standing tree above its foot [px], 0 without one. */
  treeTop: number;
}

interface Systems {
  readonly sim: Simulation;
  readonly fire: FireSystem | null;
  readonly building: BuildingSystem | null;
  readonly gathering: GatheringSystem | null;
}

/** The burning tiles of the game view (see module comment). */
export class FireView {
  readonly stats: FireStats = { tiles: 0, flames: 0 };
  private systems: Systems | null = null;
  private manifest: AtlasManifest | null = null;
  private sprite: AtlasSprite | null = null;
  private readonly clips: (AnimationClip | null)[] = [null, null, null, null];
  private readonly hit = createObjectHit();
  private readonly run: RoofRun = { top: 0, bottom: 0 };
  private readonly burning: Burning = { upright: false, object: false, floor: false, roof: false, flammability: 0, fuel: 0, foot: 0, roofDepth: 0, roofFade: 0, treeTop: 0 };

  /** Draws the flames of the frame's layer inside its pushed rectangle; `interior` fades flames on a faded roof. */
  draw(scene: RenderScene, atlas: AtlasData, sim: Simulation, f: FireFrame, tables: WorldRenderTables | null, interior: InteriorView | null): void {
    this.stats.tiles = 0;
    this.stats.flames = 0;
    const sys = this.systemsOf(sim);
    if (sys.fire === null || sys.fire.size === 0) return;
    this.bind(atlas.manifest);
    if (this.sprite === null) return;
    const now = worldSecond(sim.tick);
    const x0 = f.left - MARGIN_TILES * TILE_PX;
    const x1 = f.right + MARGIN_TILES * TILE_PX;
    const y0 = f.top - MARGIN_TILES * TILE_PX;
    const y1 = f.bottom + MARGIN_TILES * TILE_PX;
    for (const c of sys.fire.cells) {
      if (c.layer !== f.layer) continue;
      const px = c.tx * TILE_PX;
      const py = c.ty * TILE_PX;
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;
      this.drawCell(scene, sys, c, now, f, tables, interior);
    }
  }

  private drawCell(scene: RenderScene, sys: Systems, c: Readonly<FireCell>, now: number, f: FireFrame, tables: WorldRenderTables | null, interior: InteriorView | null): void {
    const b = this.inspect(sys, c, tables, interior);
    const stage = fireStage(now - c.seit, b.fuel, b.flammability);
    const left = c.tx * TILE_PX + TILE_PX / 2;
    const top = c.ty * TILE_PX;
    const heightBase = f.levelAt(c.tx, c.ty) * WAND_PX_JE_STUFE;
    const h = hash2(c.tx, c.ty, SALT);
    const side = (h & 1) === 0 ? 1 : -1;
    const phase = hashToUnit(h) * PHASE_SPAN;
    let n = 0;
    const depth = b.foot + FLAME_DEPTH;
    if (b.upright) n += this.spots(scene, UPRIGHT_SPOTS, stage, left, top, side, depth, 0, heightBase, phase, f.time);
    else if (b.object) n += this.spots(scene, OBJECT_SPOTS, stage, left, top, side, depth, 0, heightBase, phase, f.time);
    else if (b.floor && b.treeTop === 0 && !b.roof) n += this.spots(scene, FLOOR_SPOTS, stage, left, top, side, depth, 0, heightBase, phase, f.time);
    if (b.roof) n += this.spots(scene, ROOF_SPOTS, stage, left, top, side, b.roofDepth + ROOF_FLAME_DEPTH, b.roofFade, heightBase + WAND_PX_JE_STUFE, phase, f.time);
    if (b.treeTop > 0) {
      n += this.spots(scene, TRUNK_SPOTS, stage, left, top, side, depth, 0, heightBase, phase, f.time);
      for (let i = 0; i < CROWN_SPOTS.length; i++) {
        const s = CROWN_SPOTS[i] as (typeof CROWN_SPOTS)[number];
        if (stage < s.from) continue;
        n += this.flame(scene, stage - s.less, left + side * s.dx, top + TILE_FOOT - Math.round(b.treeTop * s.share), depth, 0, heightBase + Math.round(b.treeTop * s.share), side < 0, phase + (i + 1) * PHASE_SPAN / 2, f.time);
      }
    }
    // Nothing standing burns any more this second: the ember bed on the ground until the fire is out.
    if (n === 0) n += this.flame(scene, STAGE.glimmen, left, top + TILE_FOOT, top + TILE_FOOT + FLAME_DEPTH, 0, heightBase, side < 0, phase, f.time);
    this.stats.tiles++;
    this.stats.flames += n;
  }

  private spots(scene: RenderScene, spots: readonly FlameSpot[], stage: number, x: number, top: number, side: number, depth: number, fade: number, heightBase: number, phase: number, time: number): number {
    let n = 0;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i] as FlameSpot;
      if (stage < s.from) continue;
      n += this.flame(scene, stage - s.less, x + side * s.dx, top + s.dy, depth, fade, heightBase, (i & 1) === 1 ? side > 0 : side < 0, phase + (i * PHASE_SPAN) / spots.length, time);
    }
    return n;
  }

  private flame(scene: RenderScene, stage: number, x: number, y: number, depth: number, fade: number, heightBase: number, mirror: boolean, phase: number, time: number): number {
    if (stage < STAGE.glimmen || fade >= 1) return 0;
    const s = this.sprite as AtlasSprite;
    const clip = this.clips[stage];
    if (clip === null || clip === undefined) return 0;
    const d = scene.sprite.reset();
    d.frame = (s.frames[clipFrameAt(clip, time + phase)] ?? s.frames[0]) as SpriteFrameRef;
    d.x = x;
    d.y = y;
    d.depth = depth;
    d.mirror = mirror && s.symmetric;
    d.heightBase = heightBase;
    d.fade = fade;
    scene.sprites.push(d);
    return 1;
  }

  /** What burns on the tile of `c`. */
  private inspect(sys: Systems, c: Readonly<FireCell>, tables: WorldRenderTables | null, interior: InteriorView | null): Burning {
    const b = this.burning;
    b.upright = false;
    b.object = false;
    b.floor = false;
    b.roof = false;
    b.flammability = 0;
    b.fuel = 0;
    b.foot = c.ty * TILE_PX + TILE_FOOT;
    b.roofDepth = 0;
    b.roofFade = 0;
    b.treeTop = 0;
    const building = sys.building;
    if (building !== null) {
      const store = building.structures;
      for (let li = 0; li < BUILD_LAYER_COUNT; li++) {
        const cell = store.cell(c.layer, li, c.tx, c.ty);
        if (cell === 0 || cellBlueprint(cell)) continue;
        const part = building.catalog.byRuntimeId(cellPart(cell));
        if (part === undefined || !(part.flammability > 0)) continue;
        const ax = cellCovered(cell) ? c.tx - cellDx(cell) : c.tx;
        const ay = cellCovered(cell) ? c.ty - cellDy(cell) : c.ty;
        b.flammability = Math.max(b.flammability, part.flammability);
        b.fuel = Math.max(b.fuel, store.hp(c.layer, li, ax, ay) / part.hp);
        this.mark(b, part, li);
      }
      if (b.roof) {
        roofColumn(store, c.layer, c.tx, c.ty, this.run);
        b.roofDepth = this.run.bottom * TILE_PX + TILE_FOOT + ROOF_DEPTH;
        b.roofFade = interior !== null && interior.fade > 0 && interior.fadesRoof(c.tx, c.ty) ? interior.fade : 0;
      }
    }
    const gathering = sys.gathering;
    if (gathering !== null && gathering.standingTreeAt(c.layer, c.tx, c.ty, this.hit)) {
      const rule = this.hit.rule;
      const def = rule === null || tables === null ? null : (tables.objects[rule.runtimeId] ?? null);
      b.treeTop = def?.top ?? DEFAULT_TREE_TOP;
      b.flammability = Math.max(b.flammability, BALANCE.fire.tree.flammability);
      b.fuel = Math.max(b.fuel, c.baum < 0 ? 1 : c.baum / BALANCE.fire.tree.burnHp);
    }
    return b;
  }

  private mark(b: Burning, part: PartDef, li: number): void {
    if (li === BUILD_LAYER_INDEX.dach) b.roof = true;
    else if (li === BUILD_LAYER_INDEX.struktur) b.upright = true;
    else if (li === BUILD_LAYER_INDEX.objekt || li === BUILD_LAYER_INDEX.wandobjekt) b.object = b.object || part.category !== 'teppich';
    else b.floor = true;
    // A carpet lies flat like a floor.
    if (li === BUILD_LAYER_INDEX.objekt && part.category === 'teppich') b.floor = true;
  }

  private bind(m: AtlasManifest): void {
    if (this.manifest === m) return;
    this.manifest = m;
    this.sprite = m.sprites[FIRE_SPRITE] ?? null;
    for (let i = 0; i < FIRE_STAGE_CLIPS.length; i++) this.clips[i] = this.sprite?.clips[FIRE_STAGE_CLIPS[i] as string] ?? null;
  }

  private systemsOf(sim: Simulation): Systems {
    let s = this.systems;
    if (s === null || s.sim !== sim) {
      const fire = sim.systems.find((x) => x.id === FIRE_SYSTEM_ID);
      const building = sim.systems.find((x) => x.id === BUILDING_SYSTEM_ID);
      const gathering = sim.systems.find((x) => x.id === GATHERING_SYSTEM_ID);
      s = { sim, fire: fire instanceof FireSystem ? fire : null, building: building instanceof BuildingSystem ? building : null, gathering: gathering instanceof GatheringSystem ? gathering : null };
      this.systems = s;
    }
    return s;
  }
}
