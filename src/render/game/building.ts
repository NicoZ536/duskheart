/**
 * The build grid in the game view (MASTERPROMPT §16.1 "Raster & Ebenen", §16.2, §4.4 "Gebäude modular aus
 * Tiles"; M4-13, M4-22, M4-27): every part of the building system's structure layers
 * (src/world/structures) drawn with its modular sprite after the contract of assets-src/sprites/bau/_bau.ts.
 *
 * - **Floor layer:** floors `bau_boden_<material>` (two versions by tile hash, edges from the neighbour mask),
 *   jetties `bau_steg_holz` (piles reach into the water below), trapdoors `bau_falltuer_holz` with their raised
 *   flap when open.
 * - **Structure layer**, y-sorted like world objects: walls `bau_wand_<material>` (mask, version A/B by tile
 *   hash), fences, pillars, doors and windows in east–west or north–south walls (orientation from the wall
 *   mask), the two-tile gate, ladders, stairs (frame by rotation).
 * - **Objects** `obj_<id>` standing at the middle of the front edge of their (rotated) footprint, mirrored when
 *   the cell is and the sprite may be; carpets lie flat on the ground. **Wall objects** hang on the front of the wall
 *   north of their tile at the height of `MOEBEL_WANDHOEHE_PX`, sorted just in front of it. Objects with a state show
 *   it (`PartRole`): a chest opens its lid (`offen`) while its screen is open (`ChestLids`, the storage events), else
 *   `zu`; the furniture lights of the light system burn – a lamp with its flame (`idle`) or out (`aus`), the fireplace
 *   in the clip of its fire (`brennt`, `schwach`, `glut`, `asche`, `aus`, as the camp fire); the hearth fire
 *   (`obj_herdfeuer`) burns (`brennt`), sinks to embers on its last log (`glut`) or stands cold (`aus`), with the ember
 *   cores set in its niches glowing on the sockets `glutkern_1` … `glutkern_6` (`obj_herdfeuer_glutkern`). A station
 *   the grid owns as a part is left to the station view (`stations.ts`). The part the interaction targets carries the
 *   outline (§4.6).
 * - **Roofs** `bau_dach_<material>` with the row kind of their column (`roofs.ts`), sorted at the column's eave
 *   and carrying the canopy fade where they cover the player (§6.2: the circle dithers them out around the
 *   figure). In an interior the building's roof fades out completely and shows only its rim (`schnitt`), and the
 *   walls below the roof's top row cross-fade to their 4-px cuts (`InteriorView`).
 * - **Blueprints** (§16.6) are drawn half dithered in the plan colour.
 * - Windows of a room with a burning light glow at night (frames `…_licht`).
 *
 * Reads the simulation (structure layers, rooms), never writes it; no allocation per frame except the door memory
 * (one entry per door that moved).
 */
import { BALANCE } from '../../content/balance';
import { MOEBEL_WANDHOEHE_PX } from '../../content/items/moebel_deko';
import { lightKindOfItem } from '../../content/lights';
import { STATIONS } from '../../content/stations';
import { BUILDING_SYSTEM_ID, BuildingSystem } from '../../game/building/system';
import { HEARTH_ITEM, HEARTH_SYSTEM_ID, HearthSystem } from '../../game/hearth/system';
import type { Hearth } from '../../game/hearth/state';
import { fireClip } from '../../game/light/formulas';
import type { LightSystem } from '../../game/light/system';
import { keyTx, keyTy } from '../../game/rooms/detect';
import { ROOMS_SYSTEM_ID, RoomsSystem } from '../../game/rooms/system';
import type { GameSession } from '../../game/session';
import type { Simulation } from '../../game/sim';
import { STATIONS_SYSTEM_ID, StationSystem } from '../../game/stations/system';
import { distanceToChest } from '../../game/storage/formulas';
import { STORAGE_SYSTEM_ID, StorageSystem } from '../../game/storage/system';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import { CHUNK_SHIFT, type Layer } from '../../world/model/coords';
import type { PartCatalog, PartDef } from '../../world/structures/catalog';
import { BUILD_LAYER_INDEX, cellBlueprint, cellCovered, cellMirror, cellOpen, cellPart, cellRot, rotatedSize } from '../../world/structures/cells';
import { connectMask } from '../../world/structures/query';
import { structureIndex, type StructureStore } from '../../world/structures/store';
import { hash2, hashToUnit } from '../../engine/rng';
import { clipFrameAt } from '../anim/animation';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../assets/atlas';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { SpriteLayer } from '../batch/spriteLayout';
import type { RenderScene } from '../scene';
import { TILE_PX } from '../tilemap/chunk';
import { lightSystemOf } from './lights';
import { InteriorView, ROOF_ROW, roofColumn, type RoofRun } from './roofs';

const FLOOR = BUILD_LAYER_INDEX.boden;
const STRUCTURE = BUILD_LAYER_INDEX.struktur;
const OBJECT = BUILD_LAYER_INDEX.objekt;
const WALL_OBJECT = BUILD_LAYER_INDEX.wandobjekt;
const ROOF = BUILD_LAYER_INDEX.dach;
/** Build layers in drawing order. */
const LAYER_ORDER: readonly number[] = [FLOOR, STRUCTURE, OBJECT, WALL_OBJECT, ROOF];

/** Neighbour bits of the sprite masks (north 1, east 2, south 4, west 8). */
export const MASK = { n: 1, o: 2, s: 4, w: 8 } as const;
/** Masks per frame table (a table of 16 frames per version or row kind). */
export const MASKS = 16;
/** Frames of a wall: version A `0–15`, version B `16–31`, cut `32–47` (`32 + mask`). */
export const WALL_CUT_BASE = 2 * MASKS;
/** Door frames: shut/half/open in an east–west wall, the same in a north–south wall from 3, the cut at 6. */
export const DOOR_FRAME = { side: 3, cut: 6 } as const;
/** Window frames: east–west 0, north–south 1, lit +2, cut 4. */
export const WINDOW_FRAME = { side: 1, lit: 2, cut: 4 } as const;
/** Hash salts of the per-tile versions (the house preview's, tools/assets/house-preview.ts). */
const SALT = { floor: 5, wall: 7 } as const;
/** Foot row of upright parts in their tile [px]: the last pixel row. */
const FOOT_ROW = TILE_PX - 1;
/** Foot line of a wall's front in its tile [px] (the thin wall's band ends at row 10, _bau.ts). */
const WALL_FRONT_FOOT = 10;
/** Height of a wall object's anchor above the front's foot line when the content names none [px]. */
const DEFAULT_WALL_OBJECT_HEIGHT = 2;
/** Depth offset of a wall object before its wall [px] (sorted directly in front of it). */
const WALL_OBJECT_DEPTH = 0.25;
/**
 * Ground sort of a floor [px below its tile's top]: after everything rooted in its tile on the ground (the dune
 * grass tufts of the ground decor end under the planks), before what stands further south.
 */
const FLOOR_DEPTH = TILE_PX + TILE_PX / 2;
/** A carpet sorts this far behind its anchor [px]: always over the floor it lies on. */
const CARPET_DEPTH = 2 * TILE_PX;
/** Depth offset of a roof column behind its eave row's anchor [px] (in front of the eave wall). */
const ROOF_DEPTH = 0.5;
/** Blueprints: dither fade and the plan colour (palette `wasser.4`) with its strength. */
export const BLUEPRINT_LOOK = { fade: 0.5, r: 0x4f, g: 0xb0, b: 0xb8, strength: 0.55 } as const;
/** Ambient light below which rooms with a light glow through their windows (dusk and night). */
const WINDOW_GLOW_BELOW = 0.5;
/** Frames a room's glow is remembered before it is asked again (torches go out). */
const GLOW_FRAMES = 30;
/** Door states: shut, half, open. */
const DOOR_SHUT = 0;
const DOOR_HALF = 1;
const DOOR_OPEN = 2;
/** How long a door shows its half-open frame after it moved [s]. */
const DOOR_SWING_SECONDS = 0.12;
/** Tiles pushed beyond the view's edges (tall sprites stand below the view, wide ones beside it). */
const MARGIN_TILES = { x: 2, top: 1, bottom: 4 } as const;
/** Key span of door tiles. */
const KEY_SPAN = 4096;

/**
 * What a part is to the systems beside the building grid, which decide its look: a chest of the storage system, the
 * hearth fire, a furniture light of the light system, a station of the station system (drawn by `stations.ts`), or
 * plain.
 */
export type PartRole = 'plain' | 'chest' | 'hearth' | 'light' | 'station';

/** The role of part `id` (see `PartRole`). */
export function partRole(id: string): PartRole {
  if (id === HEARTH_ITEM) return 'hearth';
  if (BALANCE.storage.containers[id] !== undefined) return 'chest';
  if (lightKindOfItem(id)?.moebel !== undefined) return 'light';
  if (STATIONS.some((s) => s.id === id)) return 'station';
  return 'plain';
}

/** The sprites of one part (null where the atlas lacks them: counted in `missing`). */
export interface PartSprites {
  readonly main: AtlasSprite | null;
  /** The north–south gate, the raised trapdoor flap. */
  readonly second: AtlasSprite | null;
  /** Frame of the part when it stands (lamps `aus`, chests `zu`); 0 otherwise. */
  readonly idleFrame: number;
  readonly role: PartRole;
}

/** Clips of a chest with its lid shut and open (assets-src/sprites/lager/lager.ts). */
export const CHEST_CLIP = { shut: 'zu', open: 'offen' } as const;
/** Clips of a lamp burning and out (assets-src/sprites/moebel/lichter.ts). */
export const LAMP_CLIP = { lit: 'idle', out: 'aus' } as const;
/** Clips of the hearth fire (assets-src/sprites/stationen/herdfeuer.ts): burning, on its last embers, cold. */
export const HEARTH_CLIP = { burning: 'brennt', embers: 'glut', cold: 'aus' } as const;
/** The ember core set in a niche of the hearth ring, and the sockets of the niches (`glutkern_1` … `glutkern_6`). */
export const HEARTH_CORE_SPRITE = 'obj_herdfeuer_glutkern';
export const HEARTH_CORE_SOCKET = 'glutkern_';
/**
 * Share of its log left below which a hearth with an empty store shows its embers (`glut`): the fire burns down on its
 * last log – the sign to feed it before it goes out (§16.5 "erlischt → kein Schutz").
 */
export const HEARTH_EMBERS_BELOW = 0.25;
/** Extra glow of a burning fire's emissive pixels (the hearth, the fireplace, a lamp's flame). */
const FIRE_GLOW = 0.1;
/** Animation phase offset per light id [s]: neighbouring flames do not flicker in step (as `lights.ts`). */
const LIGHT_PHASE_STEP = 0.37;
/** Extra reach a chest's lid stays open beyond the storage reach [px]: the figure is drawn between two ticks. */
const LID_REACH_SLACK = TILE_PX / 2;
/** Depth of the ember cores before their hearth [px]: set into its ring. */
const HEARTH_CORE_DEPTH = 0.25;
/** Kinds of parts the interaction uses (E): doors, gates, trapdoors, furniture and wall furniture. */
const USABLE_KINDS: ReadonlySet<string> = new Set(['tuer', 'tor', 'falltuer', 'moebel', 'wandmoebel']);

/**
 * The clip of the hearth fire `h` (`HEARTH_CLIP`): cold when it does not burn; embers when it burns its last log (the
 * store empty, less than `HEARTH_EMBERS_BELOW` of the log left); burning otherwise.
 */
export function hearthClip(burning: boolean, h: Pick<Hearth, 'rest' | 'voll' | 'vorrat'>): string {
  if (!burning) return HEARTH_CLIP.cold;
  if (h.vorrat.length === 0 && h.voll > 0 && h.rest < h.voll * HEARTH_EMBERS_BELOW) return HEARTH_CLIP.embers;
  return HEARTH_CLIP.burning;
}

/** What a frame of the building view needs of the game view. */
export interface BuildingFrame {
  layer: Layer;
  /** Pushed rectangle [world px]. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  time: number;
  hasFigure: boolean;
  figureX: number;
  figureY: number;
  /** Canopy see-through circle [world px] (radius 0 = off). */
  fadeX: number;
  fadeY: number;
  fadeRadius: number;
  /** Ambient light 0–1 (windows glow at dusk and night). */
  ambient: number;
  /** Reduced motion: the roof lifts at once. */
  instant: boolean;
  /**
   * Dither of every roof while a build overlay is shown (0 = none): the rooms, temperatures and supports the overlay
   * marks on the ground show through the roofs above them (M4-26).
   */
  roofVeil: number;
  /** Tile of the interaction's use target on `layer` (−1 none): the part standing there carries the outline (§4.6). */
  focusTx: number;
  focusTy: number;
  /** Height level of a tile (the anchor rises by 16 px per level). */
  levelAt(tx: number, ty: number): number;
}

/** A fresh frame record. */
export function createBuildingFrame(): BuildingFrame {
  return { layer: 0, left: 0, top: 0, right: 0, bottom: 0, time: 0, hasFigure: false, figureX: 0, figureY: 0, fadeX: 0, fadeY: 0, fadeRadius: 0, ambient: 1, instant: false, roofVeil: 0, focusTx: -1, focusTy: -1, levelAt: () => 0 };
}

/** What the building view drew in the last frame. */
export interface BuildingStats {
  pieces: number;
  blueprints: number;
  roofs: number;
  /** Roof tiles drawn with the see-through circle around the player (§6.2, M4-27: the player behind a roof). */
  roofsInCircle: number;
  cutWalls: number;
  /** Fade of the interior roof: 0 drawn … 1 gone (M4-27). */
  roofFade: number;
  /** Roof tiles of the building the player is inside of. */
  roofTiles: number;
  /** The player stands in an interior. */
  inside: boolean;
  /** Parts without sprite in the atlas. */
  missing: number;
}

/** How one piece is drawn (reused, filled per piece). */
export interface PieceLook {
  mask: number;
  rot: number;
  mirror: boolean;
  /** Door, gate or trapdoor state: 0 shut, 1 half, 2 open. */
  door: number;
  /** Cut wall (interior view) and whether its south neighbour is cut. */
  cut: boolean;
  cutSouth: boolean;
  /** Version B of walls and floors. */
  versionB: boolean;
  /** Window glows. */
  lit: boolean;
  /** Roof row kind (`ROOF_ROW`) and the eave's depth [world px]. */
  roofRow: number;
  roofDepth: number;
  fade: number;
  canopyFade: boolean;
  tintR: number;
  tintG: number;
  tintB: number;
  tintStrength: number;
  heightBase: number;
  /** Frame of an object with a state (a chest's lid, a lamp's flame, the hearth's fire); −1: its standing frame. */
  frame: number;
  /** Carries the interaction outline (§4.6). */
  outline: boolean;
  /** Extra glow of its emissive pixels (a burning fire) [0–1]. */
  glow: number;
}

/** A fresh look (defaults of a plain piece). */
export function createPieceLook(): PieceLook {
  return { mask: 0, rot: 0, mirror: false, door: 0, cut: false, cutSouth: false, versionB: false, lit: false, roofRow: 0, roofDepth: 0, fade: 0, canopyFade: false, tintR: 0, tintG: 0, tintB: 0, tintStrength: 0, heightBase: 0, frame: -1, outline: false, glow: 0 };
}

/** Resets a look to a plain piece. */
export function resetPieceLook(l: PieceLook): PieceLook {
  l.mask = 0;
  l.rot = 0;
  l.mirror = false;
  l.door = 0;
  l.cut = false;
  l.cutSouth = false;
  l.versionB = false;
  l.lit = false;
  l.roofRow = 0;
  l.roofDepth = 0;
  l.fade = 0;
  l.canopyFade = false;
  l.tintR = 0;
  l.tintG = 0;
  l.tintB = 0;
  l.tintStrength = 0;
  l.heightBase = 0;
  l.frame = -1;
  l.outline = false;
  l.glow = 0;
  return l;
}

/** Sprite id of a part (docs/SPIEL.md §8: modular parts `bau_<id>`, furniture `obj_<id>`). */
export function partSpriteId(part: Pick<PartDef, 'id' | 'kind'>): string {
  return part.kind === 'moebel' || part.kind === 'wandmoebel' ? `obj_${part.id}` : `bau_${part.id}`;
}

/** The second sprite of a part: the north–south gate, the trapdoor's flap. */
export function partSecondSpriteId(part: Pick<PartDef, 'id' | 'kind'>): string | null {
  if (part.kind === 'tor') return `bau_${part.id}_seite`;
  if (part.kind === 'falltuer') return `bau_${part.id}_klappe`;
  return null;
}

/** The standing frame of a sprite: the first frame of its clip `aus` (lamps) or `zu` (chests), else 0. */
function idleFrameOf(s: AtlasSprite | null): number {
  if (s === null) return 0;
  const clip = s.clips.aus ?? s.clips.zu;
  return clip?.frames[0] ?? 0;
}

/** Resolves the sprites of a part in `m`. */
export function resolvePartSprites(m: AtlasManifest, part: Pick<PartDef, 'id' | 'kind'>): PartSprites {
  const main = m.sprites[partSpriteId(part)] ?? null;
  const secondId = partSecondSpriteId(part);
  const second = secondId === null ? null : (m.sprites[secondId] ?? null);
  return { main, second, idleFrame: idleFrameOf(main), role: partRole(part.id) };
}

/** Whether a kind is part of a wall (walls, doors, gates, windows join in the sprites' mask). */
function wallish(kind: string): boolean {
  return kind === 'wand' || kind === 'tuer' || kind === 'tor' || kind === 'fenster';
}

/** Whether a door, window or gate stands in a north–south wall (its wall neighbours lie north and south). */
export function inSideWall(mask: number): boolean {
  return (mask & (MASK.o | MASK.w)) === 0 && (mask & (MASK.n | MASK.s)) !== 0;
}

/** Frame of a wall from its mask and look. */
export function wallFrame(look: Pick<PieceLook, 'mask' | 'cut' | 'cutSouth' | 'versionB'>): number {
  if (look.cut) return WALL_CUT_BASE + look.mask;
  // A full wall joins full walls only: its arm towards a cut wall below would end in the air.
  const mask = look.cutSouth ? look.mask & ~MASK.s : look.mask;
  return (look.versionB ? MASKS : 0) + mask;
}

/** Frame of a door (`bau_tuer_*`) from its look. */
export function doorFrame(look: Pick<PieceLook, 'mask' | 'cut' | 'door'>): number {
  const side = inSideWall(look.mask);
  if (look.cut && !side) return DOOR_FRAME.cut;
  return (side ? DOOR_FRAME.side : 0) + look.door;
}

/** Frame of a window (`bau_fenster_*`) from its look. */
export function windowFrame(look: Pick<PieceLook, 'mask' | 'cut' | 'lit'>): number {
  const side = inSideWall(look.mask);
  if (look.cut && !side) return WINDOW_FRAME.cut;
  return (side ? WINDOW_FRAME.side : 0) + (look.lit ? WINDOW_FRAME.lit : 0);
}

/** Frame of a roof tile. */
export function roofFrame(look: Pick<PieceLook, 'mask' | 'roofRow'>): number {
  return look.roofRow * MASKS + look.mask;
}

/** Version B of a tile (the house preview's hash). */
export function versionB(tx: number, ty: number, salt: number): boolean {
  return hashToUnit(hash2(tx, ty, salt)) >= 0.5;
}

/**
 * Pushes one piece of `part` with its anchor tile (tx, ty) (the north-west tile of its rotated footprint) and
 * `look`. Returns the number of sprites pushed (0 when the atlas lacks the sprite).
 */
export function emitPiece(scene: RenderScene, sprites: PartSprites, part: PartDef, tx: number, ty: number, look: PieceLook, time: number): number {
  const main = sprites.main;
  if (main === null) return 0;
  const left = tx * TILE_PX;
  const top = ty * TILE_PX;
  const foot = top + FOOT_ROW;
  switch (part.kind) {
    case 'boden':
      return push(scene, main, (look.versionB ? MASKS : 0) + look.mask, left, top, 'ground', top + FLOOR_DEPTH, look);
    case 'steg':
      // Piles reach into the water below; everything standing on the jetty sorts after it.
      return push(scene, main, look.mask, left, top, 'objects', top - ROOF_DEPTH, look);
    case 'falltuer': {
      let n = push(scene, main, look.door === DOOR_SHUT ? 0 : 1, left, top, 'ground', Number.NaN, look);
      if (look.door !== DOOR_SHUT && sprites.second !== null) n += push(scene, sprites.second, look.door === DOOR_HALF ? 0 : 1, left + TILE_PX / 2, foot, 'objects', Number.NaN, look);
      return n;
    }
    case 'treppe':
      return push(scene, main, look.rot % main.frames.length, left, top, 'ground', Number.NaN, look);
    case 'leiter':
      return push(scene, main, 0, left, top, 'objects', foot, look);
    case 'wand':
      return push(scene, main, wallFrame(look), left + TILE_PX / 2, foot, 'objects', Number.NaN, look);
    case 'tuer':
      return push(scene, main, doorFrame(look), left + TILE_PX / 2, foot, 'objects', Number.NaN, look);
    case 'fenster':
      return push(scene, main, windowFrame(look), left + TILE_PX / 2, foot, 'objects', Number.NaN, look);
    case 'zaun':
      return push(scene, main, look.mask, left + TILE_PX / 2, foot, 'objects', Number.NaN, look);
    case 'saeule':
      return push(scene, main, 0, left + TILE_PX / 2, foot, 'objects', Number.NaN, look);
    case 'tor':
      // Two tiles east–west: the anchor lies between them; north–south: the side sprite on the southern tile.
      if ((look.rot & 1) === 0) return push(scene, main, look.door, left + TILE_PX, foot, 'objects', Number.NaN, look);
      return sprites.second === null ? 0 : push(scene, sprites.second, look.door, left + TILE_PX / 2, foot + TILE_PX, 'objects', Number.NaN, look);
    case 'dach':
      return push(scene, main, roofFrame(look), left + TILE_PX / 2, foot, 'objects', look.roofDepth, look);
    case 'moebel': {
      const size = rotatedSize(part.w, part.h, look.rot);
      const x = left + (size.w * TILE_PX) / 2;
      const y = top + size.h * TILE_PX - 1;
      // A carpet lies flat: it goes with the floors, under everything standing on it.
      const carpet = part.blocks === 0 && part.category === 'teppich';
      return push(scene, main, look.frame >= 0 ? look.frame : idleOrClip(main, sprites.idleFrame, time), x, y, carpet ? 'ground' : 'objects', carpet ? y + CARPET_DEPTH : Number.NaN, look);
    }
    case 'wandmoebel': {
      // Hangs on the front of the wall north of its tile (its foot line: row 10 of the wall's tile).
      const wallTop = top - TILE_PX;
      const y = wallTop + WALL_FRONT_FOOT - (MOEBEL_WANDHOEHE_PX[part.id] ?? DEFAULT_WALL_OBJECT_HEIGHT);
      return push(scene, main, look.frame >= 0 ? look.frame : idleOrClip(main, sprites.idleFrame, time), left + TILE_PX / 2, y, 'objects', wallTop + FOOT_ROW + WALL_OBJECT_DEPTH, look);
    }
  }
}

/** The standing frame, or the running clip of a sprite without one (a pendulum, a flag in the wind). */
function idleOrClip(s: AtlasSprite, idle: number, time: number): number {
  if (idle !== 0 || s.clips.aus !== undefined || s.clips.zu !== undefined) return idle;
  const clip = s.clips.idle;
  return clip === undefined ? 0 : clipFrameAt(clip, time);
}

function push(scene: RenderScene, s: AtlasSprite, frame: number, x: number, y: number, layer: SpriteLayer, depth: number, look: PieceLook): number {
  const f: SpriteFrameRef | undefined = s.frames[frame] ?? s.frames[0];
  if (f === undefined) return 0;
  const d = scene.sprite.reset();
  d.frame = f;
  d.x = x;
  d.y = y;
  d.layer = layer;
  d.depth = depth;
  d.mirror = look.mirror && s.symmetric;
  d.heightBase = look.heightBase;
  d.fade = look.fade;
  d.canopyFade = look.canopyFade;
  d.tintR = look.tintR;
  d.tintG = look.tintG;
  d.tintB = look.tintB;
  d.tintStrength = look.tintStrength;
  d.outline = look.outline;
  d.emissiveBoost = look.glow;
  scene.sprites.push(d);
  return 1;
}

/** The building and rooms systems of a simulation (looked up once per simulation). */
interface Systems {
  readonly sim: Simulation;
  readonly building: BuildingSystem | null;
  readonly rooms: RoomsSystem | null;
  readonly storage: StorageSystem | null;
  readonly hearth: HearthSystem | null;
  readonly light: LightSystem | null;
  readonly stations: StationSystem | null;
}

/**
 * Which chests have their lid open (§16.7; M4-21): the storage system opens and shuts a lid for the chest screen
 * (`chestOpened`, `chestClosed`) and keeps no state of it – the view remembers the open ones from the session's events.
 * A lid shuts when the chest is taken down (`chestRemoved`); the screen closes without a word when the player walks out
 * of reach, so the view shuts a lid itself once the figure is out of the storage reach (`isOpen`).
 */
export class ChestLids {
  private readonly open = new Set<number>();
  private subscribed: Pick<GameSession, 'onEvent'> | null = null;
  private unsubscribe: (() => void)[] = [];

  /** Listens to the chest events of `session` (once per session; the listeners' closures live in `subscribe`, so the check that runs every frame allocates no context (§30)). */
  follow(session: Pick<GameSession, 'onEvent'>): void {
    if (this.subscribed !== session) this.subscribe(session);
  }

  private subscribe(session: Pick<GameSession, 'onEvent'>): void {
    this.dispose();
    this.subscribed = session;
    this.unsubscribe = [
      session.onEvent('chestOpened', (e) => this.open.add(e.chest)),
      session.onEvent('chestClosed', (e) => this.open.delete(e.chest)),
      session.onEvent('chestRemoved', (e) => this.open.delete(e.chest)),
    ];
  }

  /** Forgets the session and every open lid. */
  dispose(): void {
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
    this.subscribed = null;
    this.open.clear();
  }

  /** Whether chest `id` stands open (its screen was opened and not shut). */
  opened(id: number): boolean {
    return this.open.has(id);
  }

  /** Whether chest `id` with footprint `c` stands open for a figure at (x, y) [world px] (`hasFigure` false: none). */
  isOpen(id: number, c: Parameters<typeof distanceToChest>[0], hasFigure: boolean, x: number, y: number): boolean {
    if (!this.open.has(id)) return false;
    if (hasFigure && distanceToChest(c, x, y) <= BALANCE.storage.reachTiles * TILE_PX + LID_REACH_SLACK) return true;
    this.open.delete(id);
    return false;
  }
}

/** Sprites of the parts of a catalog, resolved once per atlas manifest. */
export class PartSpriteCache {
  private manifest: AtlasManifest | null = null;
  private catalog: PartCatalog | null = null;
  private byRid: PartSprites[] = [];

  /** The sprites of part runtime id `rid`. */
  get(m: AtlasManifest, catalog: PartCatalog, rid: number): PartSprites | undefined {
    if (m !== this.manifest || catalog !== this.catalog) {
      this.manifest = m;
      this.catalog = catalog;
      this.byRid = [];
      for (const p of catalog.parts) this.byRid[p.rid] = resolvePartSprites(m, p);
    }
    return this.byRid[rid];
  }
}

const ROOM_KEYS = { tx: keyTx, ty: keyTy };

/** The build grid of the game view (see module comment). */
export class BuildingView {
  readonly interior = new InteriorView();
  readonly stats: BuildingStats = { pieces: 0, blueprints: 0, roofs: 0, roofsInCircle: 0, cutWalls: 0, roofFade: 0, roofTiles: 0, inside: false, missing: 0 };
  readonly sprites = new PartSpriteCache();
  private systems: Systems | null = null;
  private readonly look = createPieceLook();
  private readonly run: RoofRun = { top: 0, bottom: 0 };
  /** Door tiles that moved: key → [open, presentation time of the move]. */
  private readonly doors = new Map<number, { open: boolean; since: number }>();
  /** Glow of the rooms with a light (per region, asked every `GLOW_FRAMES`). */
  private readonly glow = new WeakMap<object, { lit: boolean; frame: number }>();
  private frame = 0;
  /** Open chest lids (the storage events of the session). */
  readonly lids = new ChestLids();
  private readonly socket = { x: 0, y: 0 };

  /** Listens to the chest events of the session (the game view calls it every frame; subscribes once). */
  follow(session: Pick<GameSession, 'onEvent'>): void {
    this.lids.follow(session);
  }

  /** Forgets the session (scene switched away). */
  dispose(): void {
    this.lids.dispose();
  }

  /** The building system of `sim`, or null (simulations without building). */
  building(sim: Simulation): BuildingSystem | null {
    return this.systemsOf(sim).building;
  }

  /** The rooms system of `sim`, or null. */
  rooms(sim: Simulation): RoomsSystem | null {
    return this.systemsOf(sim).rooms;
  }

  private systemsOf(sim: Simulation): Systems {
    let s = this.systems;
    if (s === null || s.sim !== sim) {
      const b = sim.systems.find((x) => x.id === BUILDING_SYSTEM_ID);
      const r = sim.systems.find((x) => x.id === ROOMS_SYSTEM_ID);
      const storage = sim.systems.find((x) => x.id === STORAGE_SYSTEM_ID);
      const hearth = sim.systems.find((x) => x.id === HEARTH_SYSTEM_ID);
      const stations = sim.systems.find((x) => x.id === STATIONS_SYSTEM_ID);
      s = {
        sim,
        building: b instanceof BuildingSystem ? b : null,
        rooms: r instanceof RoomsSystem ? r : null,
        storage: storage instanceof StorageSystem ? storage : null,
        hearth: hearth instanceof HearthSystem ? hearth : null,
        light: lightSystemOf(sim),
        stations: stations instanceof StationSystem ? stations : null,
      };
      this.systems = s;
      this.interior.reset();
    }
    return s;
  }

  /** Draws the structures of the frame's layer inside its pushed rectangle. */
  draw(scene: RenderScene, atlas: AtlasData, sim: Simulation, f: BuildingFrame): void {
    this.frame++;
    const st = this.stats;
    st.pieces = 0;
    st.blueprints = 0;
    st.roofs = 0;
    st.roofsInCircle = 0;
    st.cutWalls = 0;
    st.missing = 0;
    const { building, rooms } = this.systemsOf(sim);
    if (building === null) return;
    const store = building.structures;
    const layer = f.layer;
    this.updateInterior(building, rooms, f);
    const tx0 = Math.floor(f.left / TILE_PX) - MARGIN_TILES.x;
    const tx1 = Math.floor(f.right / TILE_PX) + MARGIN_TILES.x;
    const ty0 = Math.floor(f.top / TILE_PX) - MARGIN_TILES.top;
    const ty1 = Math.floor(f.bottom / TILE_PX) + MARGIN_TILES.bottom;
    const cx0 = tx0 >> CHUNK_SHIFT;
    const cx1 = tx1 >> CHUNK_SHIFT;
    const cy0 = ty0 >> CHUNK_SHIFT;
    const cy1 = ty1 >> CHUNK_SHIFT;
    const chunkTiles = 1 << CHUNK_SHIFT;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = store.chunk(layer, cx, cy);
        if (chunk === undefined) continue;
        const ya = Math.max(ty0, cy * chunkTiles);
        const yb = Math.min(ty1, cy * chunkTiles + chunkTiles - 1);
        const xa = Math.max(tx0, cx * chunkTiles);
        const xb = Math.min(tx1, cx * chunkTiles + chunkTiles - 1);
        for (let li = 0; li < LAYER_ORDER.length; li++) {
          const buildLayer = LAYER_ORDER[li] as number;
          for (let ty = ya; ty <= yb; ty++) {
            for (let tx = xa; tx <= xb; tx++) {
              const cell = chunk.cells[structureIndex(buildLayer, tx, ty)] as number;
              if (cell === 0 || cellCovered(cell)) continue;
              this.drawCell(scene, atlas.manifest, sim, building, rooms, store, f, buildLayer, cell, tx, ty);
            }
          }
        }
      }
    }
    st.roofFade = this.interior.fade;
    st.roofTiles = this.interior.roofTiles;
    st.inside = this.interior.inside;
  }

  /** The interior the player stands in (roof fade, cut walls). */
  private updateInterior(building: BuildingSystem, rooms: RoomsSystem | null, f: BuildingFrame): void {
    let room: { id: number; interior: boolean; tiles: readonly number[] } | null | undefined = null;
    if (rooms !== null && f.hasFigure) {
      const tx = Math.floor(f.figureX / TILE_PX);
      const ty = Math.floor(f.figureY / TILE_PX);
      const region = rooms.map.regionAt(f.layer, tx, ty);
      // A tile that closes rooms (a doorway) keeps the last decision.
      room = region === null ? (building.structures.cell(f.layer, STRUCTURE, tx, ty) !== 0 ? undefined : null) : region.room ? region : null;
    }
    this.interior.update(building.structures, f.layer, room, ROOM_KEYS, building.structures.revision, f.time, f.instant);
  }

  private drawCell(scene: RenderScene, m: AtlasManifest, sim: Simulation, building: BuildingSystem, rooms: RoomsSystem | null, store: StructureStore, f: BuildingFrame, buildLayer: number, cell: number, tx: number, ty: number): void {
    const catalog = building.catalog;
    const part = catalog.byRuntimeId(cellPart(cell));
    if (part === undefined) return;
    const sprites = this.sprites.get(m, catalog, part.rid);
    if (sprites === undefined || sprites.main === null) {
      this.stats.missing++;
      return;
    }
    const layer = f.layer;
    const look = resetPieceLook(this.look);
    look.rot = cellRot(cell);
    look.mirror = cellMirror(cell);
    look.heightBase = f.levelAt(tx, ty) * WAND_PX_JE_STUFE;
    const blueprint = cellBlueprint(cell);
    if (blueprint) {
      look.fade = BLUEPRINT_LOOK.fade;
      look.tintR = BLUEPRINT_LOOK.r;
      look.tintG = BLUEPRINT_LOOK.g;
      look.tintB = BLUEPRINT_LOOK.b;
      look.tintStrength = BLUEPRINT_LOOK.strength;
      this.stats.blueprints++;
    }
    const sys = this.systems as Systems;
    // A station the grid owns is the station view's: its clip follows the station's work.
    if (sprites.role === 'station' && !blueprint && sys.stations?.stationAt(layer, tx, ty) !== undefined) return;
    const hearth = blueprint || sprites.role === 'plain' ? null : this.stateLook(sys, sprites.role, sprites.main, look, layer, tx, ty, f);
    look.outline = this.targeted(part, blueprint, buildLayer, tx, ty, look.rot, f);
    const inside = this.interior;
    const fade = inside.fade;
    switch (part.kind) {
      case 'boden':
        look.mask = connectMask(store, catalog, layer, buildLayer, tx, ty);
        look.versionB = versionB(tx, ty, SALT.floor);
        break;
      case 'steg':
      case 'zaun':
        look.mask = connectMask(store, catalog, layer, buildLayer, tx, ty);
        break;
      case 'falltuer':
      case 'tuer':
      case 'tor':
        look.mask = connectMask(store, catalog, layer, buildLayer, tx, ty);
        look.door = this.doorState(tx, ty, cellOpen(cell), f.time);
        break;
      case 'fenster':
        look.mask = connectMask(store, catalog, layer, buildLayer, tx, ty);
        look.lit = f.ambient < WINDOW_GLOW_BELOW && this.windowGlows(sim, rooms, layer, tx, ty, look.mask);
        break;
      case 'wand':
        look.mask = connectMask(store, catalog, layer, buildLayer, tx, ty);
        look.versionB = versionB(tx, ty, SALT.wall);
        break;
      case 'wandmoebel': {
        // An object on a wall that is cut away in the interior view would float: it leaves with the wall.
        const wall = store.cell(layer, STRUCTURE, tx, ty - 1);
        if (fade > 0 && wall !== 0 && inside.cutsWall(tx, ty - 1)) look.fade = Math.max(look.fade, fade);
        break;
      }
      case 'dach':
        look.mask = connectMask(store, catalog, layer, buildLayer, tx, ty);
        look.roofRow = roofColumn(store, layer, tx, ty, this.run);
        look.roofDepth = this.run.bottom * TILE_PX + FOOT_ROW + ROOF_DEPTH;
        look.canopyFade = f.hasFigure && f.fadeRadius > 0 && look.roofDepth > f.figureY && this.nearCircle(tx, ty, f);
        look.fade = Math.max(look.fade, f.roofVeil);
        this.stats.roofs++;
        if (look.canopyFade) this.stats.roofsInCircle++;
        break;
      default:
        break;
    }
    // Interior view: the building's roof fades out and leaves its rim, the walls below its top row cross-fade to their cuts.
    if (part.kind === 'dach' && fade > 0 && inside.fadesRoof(tx, ty)) {
      look.fade = Math.max(look.fade, fade);
      this.stats.pieces += emitPiece(scene, sprites, part, tx, ty, look, f.time);
      look.roofRow = ROOF_ROW.schnitt;
      look.fade = Math.max(blueprint ? BLUEPRINT_LOOK.fade : 0, 1 - fade);
      look.canopyFade = false;
      this.stats.pieces += emitPiece(scene, sprites, part, tx, ty, look, f.time);
      return;
    }
    if (wallish(part.kind) && part.kind !== 'tor' && fade > 0 && inside.cutsWall(tx, ty)) {
      look.cutSouth = inside.cutsWall(tx, ty + 1) && wallish(catalog.byRuntimeId(cellPart(store.cell(layer, STRUCTURE, tx, ty + 1)))?.kind ?? '');
      look.fade = Math.max(look.fade, fade);
      this.stats.pieces += emitPiece(scene, sprites, part, tx, ty, look, f.time);
      look.cut = true;
      look.fade = Math.max(blueprint ? BLUEPRINT_LOOK.fade : 0, 1 - fade);
      this.stats.pieces += emitPiece(scene, sprites, part, tx, ty, look, f.time);
      this.stats.cutWalls++;
      return;
    }
    this.stats.pieces += emitPiece(scene, sprites, part, tx, ty, look, f.time);
    if (hearth !== null) this.stats.pieces += this.drawCores(scene, m, sprites.main, part, hearth, tx, ty, look, f.time);
  }

  /**
   * The look of an object with a state (`PartRole`): its frame from the clip of its state and the glow of a burning
   * fire. Returns the hearth standing there (its cores are drawn after it), else null.
   */
  private stateLook(sys: Systems, role: PartRole, s: AtlasSprite, look: PieceLook, layer: Layer, tx: number, ty: number, f: BuildingFrame): Readonly<Hearth> | null {
    let clip: string | null = null;
    let phase = 0;
    let burning = false;
    let hearth: Readonly<Hearth> | null = null;
    switch (role) {
      case 'chest': {
        const c = sys.storage?.chestAt(layer, tx, ty);
        if (c !== undefined) clip = this.lids.isOpen(c.id, c, f.hasFigure, f.figureX, f.figureY) ? CHEST_CLIP.open : CHEST_CLIP.shut;
        break;
      }
      case 'light': {
        const l = sys.light?.lightAt(layer, tx, ty);
        if (l === undefined) break;
        phase = l.id * LIGHT_PHASE_STEP;
        if (l.torch !== null) {
          burning = l.torch.lit;
          clip = burning ? LAMP_CLIP.lit : LAMP_CLIP.out;
        } else if (l.fire !== null) {
          burning = l.fire.lit || l.fire.embers > 0;
          clip = fireClip(l.fire);
        }
        break;
      }
      case 'hearth': {
        const h = sys.hearth?.hearthAt(layer, tx, ty);
        if (h === undefined || sys.hearth === null) break;
        hearth = h;
        clip = hearthClip(sys.hearth.burning(sys.sim, h), h);
        burning = clip !== HEARTH_CLIP.cold;
        phase = h.id * LIGHT_PHASE_STEP;
        break;
      }
      default:
        break;
    }
    const c = clip === null ? undefined : s.clips[clip];
    if (c !== undefined) look.frame = clipFrameAt(c, f.time + phase);
    if (burning && s.emissive) look.glow = FIRE_GLOW;
    return hearth;
  }

  /** The ember cores set in the niches of `hearth`, each on its socket of the hearth sprite's frame `look.frame`. */
  private drawCores(scene: RenderScene, m: AtlasManifest, s: AtlasSprite, part: PartDef, hearth: Readonly<Hearth>, tx: number, ty: number, look: PieceLook, time: number): number {
    const core = m.sprites[HEARTH_CORE_SPRITE];
    const frame = s.frames[look.frame >= 0 ? look.frame : 0] ?? s.frames[0];
    if (core === undefined || frame === undefined) return 0;
    const size = rotatedSize(part.w, part.h, look.rot);
    // The hearth stands like every object: anchor on the middle of its footprint's front edge.
    const ax = tx * TILE_PX + (size.w * TILE_PX) / 2;
    const ay = ty * TILE_PX + size.h * TILE_PX - 1;
    const clip = core.clips.idle;
    let n = 0;
    for (let i = 0; i < hearth.kerne.length; i++) {
      if (hearth.kerne[i] === null) continue;
      const track = s.sockets[`${HEARTH_CORE_SOCKET}${i + 1}`];
      const p = track?.[look.frame >= 0 ? look.frame : 0] ?? track?.[0] ?? null;
      if (p === null || p === undefined) continue;
      this.socket.x = ax - frame.ax + p[0];
      this.socket.y = ay - frame.ay + p[1];
      const d = scene.sprite.reset();
      d.frame = (core.frames[clip === undefined ? 0 : clipFrameAt(clip, time + i * LIGHT_PHASE_STEP)] ?? core.frames[0]) as SpriteFrameRef;
      d.x = this.socket.x;
      d.y = this.socket.y;
      // Set into the ring: in front of the hearth sprite, which sorts at its anchor.
      d.depth = ay + HEARTH_CORE_DEPTH;
      d.heightBase = look.heightBase;
      d.fade = look.fade;
      d.emissiveBoost = FIRE_GLOW;
      scene.sprites.push(d);
      n++;
    }
    return n;
  }

  /** Whether the piece is the interaction's use target (a door, a piece of furniture, a blueprint to finish). */
  private targeted(part: PartDef, blueprint: boolean, buildLayer: number, tx: number, ty: number, rot: number, f: BuildingFrame): boolean {
    if (f.focusTx < 0 || buildLayer === ROOF) return false;
    if (!blueprint && (!USABLE_KINDS.has(part.kind) || part.category === 'teppich')) return false;
    const size = rotatedSize(part.w, part.h, rot);
    return f.focusTx >= tx && f.focusTx < tx + size.w && f.focusTy >= ty && f.focusTy < ty + size.h;
  }

  /** Whether the roof tile's sprite (its tile and the 16 px above) touches the canopy circle. */
  private nearCircle(tx: number, ty: number, f: BuildingFrame): boolean {
    const x0 = tx * TILE_PX;
    const y0 = ty * TILE_PX - TILE_PX;
    const x1 = x0 + TILE_PX;
    const y1 = ty * TILE_PX + TILE_PX;
    const dx = f.fadeX < x0 ? x0 - f.fadeX : f.fadeX > x1 ? f.fadeX - x1 : 0;
    const dy = f.fadeY < y0 ? y0 - f.fadeY : f.fadeY > y1 ? f.fadeY - y1 : 0;
    return dx * dx + dy * dy < f.fadeRadius * f.fadeRadius;
  }

  /** State of a door: shut or open, half open for a moment after it moved. */
  private doorState(tx: number, ty: number, open: boolean, time: number): number {
    const key = ty * KEY_SPAN + tx;
    const seen = this.doors.get(key);
    if (seen === undefined) {
      if (open) this.doors.set(key, { open, since: Number.NEGATIVE_INFINITY });
      return open ? DOOR_OPEN : DOOR_SHUT;
    }
    if (seen.open !== open) {
      seen.open = open;
      seen.since = time;
    }
    if (time - seen.since < DOOR_SWING_SECONDS && time >= seen.since) return DOOR_HALF;
    if (!open && time - seen.since >= DOOR_SWING_SECONDS) this.doors.delete(key);
    return open ? DOOR_OPEN : DOOR_SHUT;
  }

  /** Whether a room on either side of the window has a burning light (asked every `GLOW_FRAMES`). */
  private windowGlows(sim: Simulation, rooms: RoomsSystem | null, layer: Layer, tx: number, ty: number, mask: number): boolean {
    if (rooms === null) return false;
    const side = inSideWall(mask);
    return this.roomGlows(sim, rooms, layer, side ? tx - 1 : tx, side ? ty : ty - 1) || this.roomGlows(sim, rooms, layer, side ? tx + 1 : tx, side ? ty : ty + 1);
  }

  private roomGlows(sim: Simulation, rooms: RoomsSystem, layer: Layer, tx: number, ty: number): boolean {
    const region = rooms.map.regionAt(layer, tx, ty);
    if (region === null || !region.interior) return false;
    const known = this.glow.get(region);
    if (known !== undefined && this.frame - known.frame < GLOW_FRAMES) return known.lit;
    const lit = (rooms.roomAt(sim, layer, tx, ty)?.contents.lights ?? 0) > 0;
    this.glow.set(region, { lit, frame: this.frame });
    return lit;
  }
}
