/**
 * Ghost preview of the build mode (MASTERPROMPT §16.6 "Geister-Vorschau grün/rot mit Grund („Keine Stütze in
 * Reichweite", „Blockiert", „Zu weit"), Drehen (R), Spiegeln (F), Ziehen für Linien und Rechtecke (Wände als
 * Umriss, Böden gefüllt), Pipette (Mittelklick)"; M4-22, M4-23).
 *
 * `BuildGhost` is the one record the build mode's UI (src/ui/screens/bau) and the game view share: the UI writes the
 * choice – piece, rotation, mirror, drag start, gamepad cursor, overlay – and reads back what the game view found
 * for it in the last frame: the cursor tile, the planned anchors in placing order with a verdict each (the reason
 * the simulation would refuse it, or none), the piece under the cursor (pipette). The UI sends the commands; the
 * game view never does.
 *
 * - **Cursor:** the tile under the mouse pointer, or with a gamepad the player's tile plus the cursor offset the
 *   UI moves with the stick.
 * - **Plan:** one anchor, or while dragging the line (one axis), the outline (walls, fences: "Wände als Umriss") or
 *   the filled rectangle (floors, roofs, jetties: "Böden gefüllt") from the drag start to the cursor
 *   (`dragAnchors`), at most `MAX_PLAN` anchors.
 * - **Verdicts:** `BuildingSystem.preview` for every anchor of a build part – read-only, the rules of `build.place`.
 *   Roofs carry each other while they are placed one after the other: a planned roof tile counts as carried when a
 *   chain of carried roof tiles, planned or built, leads to a support within its reach (the statics of
 *   src/game/building/statics.ts over the plan), and the plan is ordered nearest-to-support first. Anchors beyond the
 *   pieces in the bags are refused with `noMaterial`. Stations (`station.place`) are checked against the station
 *   system's ground rules (`stationPreview`).
 * - **Blueprint mode** (§16.6 "Blaupausen: Pläne ohne Material platzieren", M4-24): build parts are judged as
 *   `build.blueprint` would judge them (`BuildingSystem.preview` with `blueprint`: no material, no body in the way,
 *   planned roofs and supports carry planned roofs) and nothing caps a drag; stations cannot be planned
 *   (`notPlannable`).
 * - **Drawing:** every planned piece as its own sprite (neighbour masks as if the plan stood already), tinted green
 *   or red and half dithered, and its footprint as an unlit green or red field (overlay list), so the ghost reads by
 *   night too; the short reason of the first refusal centred over the cursor in the red of the world UI. A planned
 *   blueprint looks like a placed one (`BLUEPRINT_LOOK`: the plan blue, half dithered) on a blue field. Outside
 *   blueprint mode a part missing in the bags names the blueprint toggle above its reason (`planHint`, the blue of
 *   the plan).
 * - **Tools** (§16.6 "Aufwerten an Ort und Stelle (Holz → Stein), Flächenreparatur, Abbauen (100 % zurück in den ersten
 *   30 s, danach 60 %)"; `tool`, the build mode's tool bar): besides placing, the ghost judges the targets of the
 *   other tools read-only, by the simulation's own data and rules, and the UI sends the commands:
 *   - `abbauen`: the topmost thing under the cursor – a part (`build.remove` takes the topmost layer: wall furniture,
 *     furniture and chests and the hearth, structure, roof, floor), a station (`station.remove`) or a standing torch
 *     (`light.take`; a fire stays) –, while dragging everything in the rectangle, wall furniture and furniture before
 *     roofs, roofs before their supports, floors last (nothing falls or collapses on the way). Each target says what
 *     comes back now (`BuildingSystem.placedTick`, the station's `gesetzt`: whole within the full refund window with
 *     the seconds left, else the late share of its materials by the material book, a blueprint nothing) and whether
 *     it is out of reach or kept standing – asked read-only before the click (M5-36, M5-52): a jetty that carries
 *     something (`BuildingSystem.loadProblem`, the building system's own rule; in a drag not when all of its load comes
 *     down before it), a chest with items (`StorageSystem.removalProblem`), a burning or filled hearth
 *     (`HearthSystem.removalProblem`), a station at work (`StationSystem.removalProblem`; a station part of the build
 *     grid comes down as its part, not as a station).
 *   - `aufwerten`: the parts under the chosen piece's anchors (one, or the line or area of a drag) that it may replace
 *     (`isUpgrade`, the rule of `build.upgrade`): reach, the player's body, a roof's support, what keeps the old one
 *     standing (a chest with items, a hearth), the new piece in the bags or a chest near the part (the building site's
 *     material source), the old one's refund.
 *   - `reparieren`: the rectangle of a drag (one tile without): the damaged finished parts anchored in it within
 *     reach, what mending them costs (`repairCost`, paid part by part as `build.repair` pays), whether the hand holds
 *     a hammer and the area is small enough.
 *   Targets are drawn as unlit fields (amber: comes down, green: upgraded – the new piece as a tinted sprite –, blue
 *   ice: the repair rectangle, damaged parts green or red) with the UI's short text over the cursor (`toolLabel`).
 *
 * The verdicts are computed again only when their inputs change (piece, rotation, cursor, drag, buildings, bags, the
 * contents of the chests on the player's layer – `chestsChanged`, M5-52), and every `REFRESH_FRAMES` for what other
 * systems change on their own (a hearth burning out, a station's order, the full refund window).
 */
import { BALANCE } from '../../content/balance';
import { BUILD_LAYERS, type BuildLayer, type PartKind } from '../../content/buildParts';
import { lightKind } from '../../content/lights';
import { blueprintMaterials } from '../../game/blueprints/supply';
import { BuildingSystem, type BuildMaterialSource } from '../../game/building/system';
import type { ItemAmount } from '../../game/building/materials';
import { repairCost } from '../../game/building/repair';
import { roofDistances, roofSupportDistance, RoofScratch, type RoofGrid } from '../../game/building/statics';
import { HearthSystem } from '../../game/hearth/system';
import { InventorySystem } from '../../game/inventory/system';
import { LightSystem } from '../../game/light/system';
import { tileInReach } from '../../game/light/formulas';
import { WorldCollision } from '../../game/player/collision';
import type { ItemStack } from '../../game/items/stack';
import type { Simulation } from '../../game/sim';
import type { PlacedStation } from '../../game/stations/state';
import { StationSystem } from '../../game/stations/system';
import { StorageSystem } from '../../game/storage/system';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import { BLOCK_DEEP_WATER, BLOCK_HAZARD, BLOCK_OBJECT, BLOCK_SOLID, BLOCK_VOID, BLOCK_WALL } from '../../world/collision/tiles';
import { WATER_DEPTH_MASK } from '../../world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, type Layer } from '../../world/model/coords';
import { isUpgrade, type PartCatalog, type PartDef } from '../../world/structures/catalog';
import { BUILD_LAYER_INDEX, cellBlueprint, cellCovered, cellMirror, cellOpen, cellPart, cellRot, rotatedSize } from '../../world/structures/cells';
import { anchorOf, kindsConnect, ROT_DX, ROT_DY, type AnchorRef } from '../../world/structures/query';
import type { AtlasData, AtlasSprite } from '../assets/atlas';
import type { DebugOverlayList } from '../debugOverlay';
import { paletteRefHex } from '../palette/rows';
import { PALETTE_HEX, PALETTE_RAMPS } from '../../generated/palette';
import type { RenderScene } from '../scene';
import type { LabelTone } from '../worldUi/worldUi';
import { rgbaFromHex } from '../text/textBatch';
import { TILE_PX } from '../tilemap/chunk';
import { BLUEPRINT_LOOK, createPieceLook, emitPiece, PartSpriteCache, resetPieceLook, versionB, type PieceLook } from './building';
import { internalToWorld } from './objects';
import type { BuildOverlay } from './overlays';

/** How a piece is placed: a part of the build grid (`build.place`) or a station (`station.place`). */
export type PieceSource = 'bauteil' | 'station';

/** How dragging places a piece (§16.6): one piece, a line or outline (walls, fences), or a filled area (floors, roofs). */
export type DragShape = 'einzeln' | 'linie' | 'flaeche';

/** The build mode's tools (§16.6): placing (and planning), dismantling, upgrading in place, area repair. */
export const BUILD_TOOLS = ['setzen', 'abbauen', 'aufwerten', 'reparieren'] as const;
/** One tool of the build mode. */
export type BuildTool = (typeof BUILD_TOOLS)[number];

/** What taking a target down gives back now: the whole piece, a share of its materials, nothing (a blueprint). */
export type ToolRefund = 'ganz' | 'anteilig' | 'keine';

/** A thing the dismantle or upgrade tool acts on (filled by the game view, pooled). */
export interface ToolTarget {
  /** A part of the build grid, a placed station or a standing light (torch, fire). */
  art: 'bauteil' | 'station' | 'licht';
  /** The part, the station, or the light's item. */
  piece: string;
  /** Build layer of a part (stations and lights: `objekt`). */
  ebene: BuildLayer;
  /** Anchor tile and footprint [tiles], and how it stands (quarter turns, mirrored). */
  tx: number;
  ty: number;
  w: number;
  h: number;
  rot: number;
  mirror: boolean;
  /** Station or light id (0 for a part). */
  id: number;
  /** The part is a blueprint (nothing comes back). */
  blueprint: boolean;
  /** What dismantling (or, when upgrading, replacing) it gives back now. */
  refund: ToolRefund;
  /** Seconds left of the full refund window (`ganz`) [s], else 0. */
  secondsLeft: number;
  /** The late refund (`anteilig`): the items coming back. */
  items: ItemAmount[];
  /** Why the command would be refused (`BuildRejectReason`, a station's or a light's reason), or `null`. */
  reason: string | null;
  /** Upgrading: the part it becomes. */
  to: string | null;
}

/** What the repair tool found in its rectangle (§16.6 "Flächenreparatur"). */
export interface RepairQuote {
  /** The rectangle [tiles], inclusive. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Damaged finished parts anchored in it within reach, and how many of them the materials at hand mend. */
  damaged: number;
  mendable: number;
  /** What mending the mendable ones costs, summed per item (the share of each part rounded up, like `build.repair`). */
  readonly cost: ItemAmount[];
  /** A hammer in the hand. */
  hammer: boolean;
  /** Why `build.repair` would be refused (`noHammer`, `areaTooLarge`, `nothingToRepair`, `noMaterial`), or `null`. */
  reason: string | null;
}

function toolTarget(): ToolTarget {
  return { art: 'bauteil', piece: '', ebene: 'boden', tx: 0, ty: 0, w: 1, h: 1, rot: 0, mirror: false, id: 0, blueprint: false, refund: 'keine', secondsLeft: 0, items: [], reason: null, to: null };
}

/** Most anchors of a plan: a square of the build reach (§16.1 "Baureichweite 8 Tiles" in each direction). */
export const MAX_PLAN = (2 * BALANCE.building.reachTiles + 1) ** 2;

/** How dragging places pieces of `kind` (`null`: a station, placed one at a time). */
export function dragShapeOf(kind: PartKind | null): DragShape {
  switch (kind) {
    case 'wand':
    case 'zaun':
      return 'linie';
    case 'boden':
    case 'dach':
    case 'steg':
      return 'flaeche';
    default:
      return 'einzeln';
  }
}

/** Whether a piece of `kind` has distinct rotations (stairs lead up one way, the gate stands east–west or north–south). */
export function rotatableKind(kind: PartKind | null): boolean {
  return kind === 'treppe' || kind === 'tor';
}

/**
 * Anchors of a drag from (x0, y0) to (x1, y1) as flat pairs `[tx, ty, …]` into `out` (cleared first), at most
 * `max`; returns their number. `einzeln`: the end tile. `linie`: the straight line when the drag stays on one row
 * or column, else the rectangle's outline (§16.6 "Wände als Umriss"). `flaeche`: the filled rectangle, rows from the
 * start towards the end (§16.6 "Böden gefüllt"). The start tile comes first.
 */
export function dragAnchors(shape: DragShape, x0: number, y0: number, x1: number, y1: number, out: number[], max: number = MAX_PLAN): number {
  out.length = 0;
  const add = (x: number, y: number): boolean => {
    if (out.length >= 2 * max) return false;
    out.push(x, y);
    return true;
  };
  if (shape === 'einzeln') {
    add(x1, y1);
    return out.length / 2;
  }
  const sx = x1 >= x0 ? 1 : -1;
  const sy = y1 >= y0 ? 1 : -1;
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  if (shape === 'flaeche') {
    for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) if (!add(x0 + i * sx, y0 + j * sy)) return out.length / 2;
    return out.length / 2;
  }
  if (w === 0 || h === 0) {
    const n = Math.max(w, h);
    for (let i = 0; i <= n; i++) if (!add(x0 + (w === 0 ? 0 : i * sx), y0 + (h === 0 ? 0 : i * sy))) break;
    return out.length / 2;
  }
  // Outline: along the start row, down the far column, back along the end row, up the start column.
  for (let i = 0; i <= w; i++) if (!add(x0 + i * sx, y0)) return out.length / 2;
  for (let j = 1; j <= h; j++) if (!add(x1, y0 + j * sy)) return out.length / 2;
  for (let i = w - 1; i >= 0; i--) if (!add(x0 + i * sx, y1)) return out.length / 2;
  for (let j = h - 1; j >= 1; j--) if (!add(x0, y0 + j * sy)) return out.length / 2;
  return out.length / 2;
}

/** The piece under the cursor (pipette): what it is and how it stands. */
export interface HoveredPiece {
  piece: string | null;
  source: PieceSource;
  rot: number;
  mirror: boolean;
}

/** The build mode's shared record (see module comment). Fields above the line are the UI's, below the game view's. */
export class BuildGhost {
  /** Build mode is on: the ghost and the overlay are drawn. */
  active = false;
  /** The chosen piece (a part id or a station item), or `null`. */
  piece: string | null = null;
  source: PieceSource = 'bauteil';
  /** Rotation in quarter turns (only rotatable parts use it). */
  rot = 0;
  mirror = false;
  /** Drag start tile; NaN while not dragging. */
  dragTx = Number.NaN;
  dragTy = Number.NaN;
  /** Drag end held while a tool's action waits for its confirmation (the area stays marked); NaN otherwise. */
  lockTx = Number.NaN;
  lockTy = Number.NaN;
  /** Gamepad cursor: on (the cursor follows the player) and its offset from the player's tile [tiles]. */
  pad = false;
  padDx = 0;
  padDy = 2;
  /** The build overlay shown, or `null` (M4-26). */
  overlay: BuildOverlay | null = null;
  /** Blueprint mode (M4-24): build parts are planned without material (`build.blueprint`); stations cannot be. */
  blueprint = false;
  /**
   * Short hint of the blueprint toggle with its key on the device used ("[G] Blaupause"), drawn above the reason when
   * a part is missing in the bags outside blueprint mode; `null`: none (the toggle is unbound there).
   */
  planHint: string | null = null;
  /** The tool in use (§16.6): placing, dismantling, upgrading in place or area repair. */
  tool: BuildTool = 'setzen';
  /** Short text of the tool's verdict over the cursor ("60 % zurück", "» Steinwand"), translated by the UI; or `null`. */
  toolLabel: string | null = null;

  // --- written by the game view -----------------------------------------------------------
  /** The cursor tile and whether it is over the world. */
  cursorTx = 0;
  cursorTy = 0;
  cursorValid = false;
  /** The piece the plan and its verdicts were judged for (the choice may have changed since the last frame). */
  judged: string | null = null;
  judgedSource: PieceSource = 'bauteil';
  /** Whether the verdicts were judged in blueprint mode. */
  judgedBlueprint = false;
  /** Planned anchors `[tx, ty, …]` in placing order and their verdicts (reason of refusal or `null`). */
  readonly plan: number[] = [];
  readonly verdicts: Array<string | null> = [];
  /** Anchors that can be placed and the first refusal (the hint names it). */
  okCount = 0;
  firstReason: string | null = null;
  /** Pieces of the chosen piece in the bags. */
  available = 0;
  /** The piece under the cursor (pipette, M4-23). */
  readonly hovered: HoveredPiece = { piece: null, source: 'bauteil', rot: 0, mirror: false };
  /** The tool the targets and the repair quote were judged for. */
  judgedTool: BuildTool = 'setzen';
  /**
   * Targets of the dismantle and upgrade tools (the first `targetCount`, in the order the commands go out; pooled).
   * `plan` and `verdicts` hold their anchors and reasons too, so `okCount` and `firstReason` speak for every tool.
   */
  readonly targets: ToolTarget[] = [];
  targetCount = 0;
  /** Counts the tools' judgements (the UI reads targets and quote again when it changes). */
  toolRevision = 0;
  /** What the repair tool found (valid while `judgedTool` is `reparieren`). */
  readonly repair: RepairQuote = { x0: 0, y0: 0, x1: 0, y1: 0, damaged: 0, mendable: 0, cost: [], hammer: false, reason: null };
  /** Frames the game view prepared (the UI knows the plan is fresh). */
  frames = 0;

  /** Whether a drag is under way. */
  get dragging(): boolean {
    return !Number.isNaN(this.dragTx);
  }

  /** Forgets the game view's results (build mode closed). */
  clearResults(): void {
    this.judged = null;
    this.judgedBlueprint = false;
    this.judgedTool = 'setzen';
    this.plan.length = 0;
    this.verdicts.length = 0;
    this.okCount = 0;
    this.firstReason = null;
    this.cursorValid = false;
    this.hovered.piece = null;
    this.targetCount = 0;
    this.repair.damaged = 0;
    this.repair.mendable = 0;
    this.repair.cost.length = 0;
    this.repair.reason = null;
  }
}

/** What the ghost needs of the frame. */
export interface GhostFrame {
  layer: Layer;
  cameraX: number;
  cameraY: number;
  viewW: number;
  viewH: number;
  hasFigure: boolean;
  figureX: number;
  figureY: number;
  time: number;
  levelAt(tx: number, ty: number): number;
  /** Short texts of the refusal reasons (world label), or null (no label). */
  reasonLabel(reason: string): string | null;
}

/** A fresh ghost frame. */
export function createGhostFrame(): GhostFrame {
  return { layer: 0, cameraX: 0, cameraY: 0, viewW: 0, viewH: 0, hasFigure: false, figureX: 0, figureY: 0, time: 0, levelAt: () => 0, reasonLabel: () => null };
}

/** The pointer of the frame (the session's mouse in internal render px). */
export interface GhostPointer {
  readonly inside: boolean;
  readonly x: number;
  readonly y: number;
}

/** Dither fade and tint strength of the ghost sprites. */
const GHOST_LOOK = { fade: 0.15, ok: 0.4, refused: 0.55 } as const;
/** Unlit footprint: fill opacity, outline opacity (0–255). */
const FIELD_ALPHA = 0.45 * 255;
const EDGE_ALPHA = 255;
/** Fill opacity of the repair rectangle (0–255): faint, the damaged parts in it stand out. */
const REPAIR_AREA_ALPHA = 0.2 * 255;
/**
 * The reason over the cursor (world UI, centred like a name): its baseline above the cursor tile's top [px] – clear
 * of the ghost's sprite, which rises up to one tile above its footprint (walls, roofs).
 */
const LABEL_LIFT = TILE_PX + 3;
/** The blueprint hint one line above the reason [px]: a line of the world font (ascent 10 + descent 2). */
const HINT_LIFT = 12;
/**
 * Label tone of the blueprint hint: the rarity tone whose ink is the plan blue `wasser.4` (`RARITY_REFS.selten`,
 * the colour of `BLUEPRINT_LOOK`; tests/unit/render/bau-geist.test.ts holds them together).
 */
export const PLAN_HINT_TONE = 'selten' as const;

function color(ref: string, alpha = 255): number {
  return rgbaFromHex(paletteRefHex(ref, PALETTE_RAMPS, PALETTE_HEX), Math.round(alpha));
}
function rgb(ref: string): readonly [number, number, number] {
  const v = Number.parseInt(paletteRefHex(ref, PALETTE_RAMPS, PALETTE_HEX).slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}
/** Green and red of the preview (§16.6 "grün/rot"): field, frame (brighter, reads on dark ground too) and tint. */
const OK_REF = { fill: 'gras.4', edge: 'gras.5', tint: 'gras.4' } as const;
const REFUSED_REF = { fill: 'feuer.2', edge: 'feuer.3', tint: 'feuer.2' } as const;
/** Blue of a planned blueprint (the renderer's plan colour `wasser.4`, `BLUEPRINT_LOOK`; frame brighter). */
const PLAN_REF = { fill: 'wasser.4', edge: 'wasser.5' } as const;
export const GHOST_COLORS = {
  ok: { fill: color(OK_REF.fill, FIELD_ALPHA), edge: color(OK_REF.edge, EDGE_ALPHA), tint: rgb(OK_REF.tint) },
  refused: { fill: color(REFUSED_REF.fill, FIELD_ALPHA), edge: color(REFUSED_REF.edge, EDGE_ALPHA), tint: rgb(REFUSED_REF.tint) },
  plan: { fill: color(PLAN_REF.fill, FIELD_ALPHA), edge: color(PLAN_REF.edge, EDGE_ALPHA), tint: [BLUEPRINT_LOOK.r, BLUEPRINT_LOOK.g, BLUEPRINT_LOOK.b] as const },
} as const;

/** Unlit fields of the tools: what comes down (amber), what is upgraded (green), the repair rectangle (ice). */
export const TOOL_COLORS = {
  abbauen: { fill: color('feuer.4', FIELD_ALPHA), edge: color('feuer.5', EDGE_ALPHA) },
  aufwerten: GHOST_COLORS.ok,
  bereich: { fill: color('eis.3', REPAIR_AREA_ALPHA), edge: color('eis.4', EDGE_ALPHA) },
  heil: { fill: color('gras.4', FIELD_ALPHA), edge: color('gras.5', EDGE_ALPHA) },
  refused: GHOST_COLORS.refused,
} as const;
/** Label tones of the tools' texts over the cursor (a refusal: the enemy red of the world UI). */
export const TOOL_LABEL_TONES: Readonly<Record<Exclude<BuildTool, 'setzen'>, LabelTone>> = { abbauen: 'legendaer', aufwerten: 'ungewoehnlich', reparieren: 'gewoehnlich' };

const FLOOR = BUILD_LAYER_INDEX.boden;
const STRUCTURE = BUILD_LAYER_INDEX.struktur;
const OBJECT = BUILD_LAYER_INDEX.objekt;
const WALL_OBJECT = BUILD_LAYER_INDEX.wandobjekt;
const ROOF = BUILD_LAYER_INDEX.dach;
/** What the pipette picks first: what the hand reaches first (the building system's removal order). */
const PICK_ORDER: readonly number[] = [WALL_OBJECT, OBJECT, STRUCTURE, ROOF, FLOOR];
/**
 * The order an area comes down in: wall furniture before its wall, furniture (with stations and lights) before the
 * floor, roofs before the walls that carry them – nothing falls off or collapses on the way –, floors last.
 */
const DISMANTLE_ORDER: readonly number[] = [WALL_OBJECT, OBJECT, ROOF, STRUCTURE, FLOOR];
/** The build layers whose parts load a jetty's tile (the building system's `carriesLoad`). */
const LOAD_LAYERS: readonly number[] = [STRUCTURE, OBJECT, WALL_OBJECT];
/** Reach of building (placing, dismantling, upgrading, repairing) [px] (§16.1 "Baureichweite 8 Tiles"). */
const BUILD_REACH_PX = BALANCE.building.reachTiles * TILE_PX;
/** Reach of `station.remove` [px]: the reach of using a station. */
const STATION_USE_REACH_PX = BALANCE.stations.reachTiles * TILE_PX;
/** Reach of `light.take` [tiles]: the interaction's reach. */
const LIGHT_TAKE_REACH_TILES = BALANCE.interaction.reachTiles;
/** Ticks after placing in which dismantling gives the piece back whole (§16.6). */
const FULL_REFUND_TICKS = BALANCE.building.refund.fullSeconds * BALANCE.time.tickHz;
/** Radius of the player's body [px]: a part that stands in the way is not set onto it. */
const BODY_RADIUS_PX = BALANCE.player.movement.colliderRadiusPx;
/** Collision of a part that cannot be set onto the player's body (the building system's rule). */
const BODY_BLOCKERS = BLOCK_SOLID | BLOCK_OBJECT | BLOCK_HAZARD;
/** Collision categories no station stands on (the station system's rule, src/game/stations/system.ts). */
const STATION_BLOCKERS = BLOCK_SOLID | BLOCK_OBJECT | BLOCK_HAZARD | BLOCK_DEEP_WATER | BLOCK_WALL | BLOCK_VOID;
/** Reach of a station's placing [px]. */
const STATION_REACH_PX = BALANCE.stations.placeReachTiles * TILE_PX;
/** Key span of plan tiles. */
const KEY_SPAN = 4096;
/** Offset of the keys of standing lights among the targets taken (stations: −id, lights: −(offset + id)). */
const LIGHT_KEY = 1 << 24;
/** Frames after which unchanged verdicts are judged again (things of other systems may have moved). */
const REFRESH_FRAMES = 15;

interface GhostSystems {
  readonly sim: Simulation;
  readonly building: BuildingSystem | null;
  readonly inventory: InventorySystem | null;
  readonly stations: StationSystem | null;
  readonly collision: WorldCollision | null;
  readonly light: LightSystem | null;
  /** Chests and hearths: what they keep standing (`removalProblem`, M5-36). */
  readonly storage: StorageSystem | null;
  readonly hearth: HearthSystem | null;
  /** The building site's material source, counted only (the bags, then the chests near the part; M4-24). */
  readonly materials: BuildMaterialSource | null;
}

/**
 * The roof grid of a roof drag (`GhostView.chainRoofs`): built roofs and supports plus the planned tiles, which carry
 * with the reach of the dragged roof. One kept object, its fields set per judgement.
 */
class ChainedRoofGrid implements RoofGrid {
  building: BuildingSystem | null = null;
  layer: Layer = 0;
  plans = false;
  reach = 0;
  planned: ReadonlySet<number> = new Set<number>();

  roofReach(tx: number, ty: number): number {
    const b = this.building;
    if (b === null) return 0;
    if (this.planned.has(ty * KEY_SPAN + tx)) return this.reach;
    const cell = b.structures.cell(this.layer, ROOF, tx, ty);
    return cell === 0 || (!this.plans && cellBlueprint(cell)) ? 0 : (b.catalog.byRuntimeId(cellPart(cell))?.roofReach ?? 0);
  }

  support(tx: number, ty: number): boolean {
    const b = this.building;
    if (b === null) return false;
    const cell = b.structures.cell(this.layer, STRUCTURE, tx, ty);
    return cell !== 0 && (this.plans || !cellBlueprint(cell)) && b.catalog.byRuntimeId(cellPart(cell))?.supports === true;
  }
}

/** Plans, judges and draws the ghost (see module comment). */
export class GhostView {
  private readonly sprites = new PartSpriteCache();
  private readonly look: PieceLook = createPieceLook();
  private readonly anchor: AnchorRef = { tx: 0, ty: 0, cell: 0 };
  private readonly world = { x: 0, y: 0 };
  private readonly planned = new Set<number>();
  private readonly order: number[] = [];
  /** Kept between judgements of a roof drag (no allocation while the player walks with the drag held, M4-Gate). */
  private readonly roofScratch = new RoofScratch();
  private readonly chainGrid = new ChainedRoofGrid();
  private readonly sortIdx: number[] = [];
  private readonly oldPlan: number[] = [];
  private readonly oldVerdicts: Array<string | null> = [];
  private systems: GhostSystems | null = null;
  /** Inputs of the last verdicts (they are judged again when one changes, or every `REFRESH_FRAMES`). */
  private readonly inputs = { tool: 'setzen' as BuildTool, piece: null as string | null, source: 'bauteil' as PieceSource, rot: 0, mirror: false, blueprint: false, fromX: 0, fromY: 0, toX: 0, toY: 0, revision: -1, available: -1, px: 0, py: 0, layer: 0, age: 0 };
  /** Anchors of the dismantle and upgrade tools already taken (keys of layer, build layer and tile). */
  private readonly seen = new Set<number>();
  /** The keys of `seen` whose targets come down (no refusal): in a drag they unload a jetty dismantled after them. */
  private readonly cleared = new Set<number>();
  /** Whether the dismantle tool judges a drag's rectangle (the targets come down one after the other). */
  private area = false;
  private readonly loadAnchor: AnchorRef = { tx: 0, ty: 0, cell: 0 };
  /**
   * The stacks in the slots of the chests on the player's layer at the last judgement, chest after chest: stacks are
   * replaced whenever a slot changes, never changed in place, so identity tells a changed chest (`chestsChanged`).
   */
  private readonly chestSlots: Array<ItemStack | null> = [];
  private chestSlotCount = 0;
  private chestLayer: Layer = 0;
  /** Items already promised to earlier targets of one upgrade or repair (the material source is counted per target). */
  private readonly promised = new Map<string, number>();
  /** Anchors of an upgrade drag. */
  private readonly cells: number[] = [];
  /** The roofs with a roof upgraded in place (its new reach). */
  private readonly candidateRoof = new CandidateRoofGrid();
  /** Sprites and fields drawn in the last frame. */
  drawn = 0;

  private systemsOf(sim: Simulation): GhostSystems {
    let s = this.systems;
    if (s === null || s.sim !== sim) {
      const find = (id: string): unknown => sim.systems.find((x) => x.id === id);
      const b = find('building');
      const i = find('inventory');
      const st = find('stations');
      const c = find('world-collision');
      const l = find('light');
      const sto = find('storage');
      const h = find('hearth');
      const inventory = i instanceof InventorySystem ? i : null;
      s = {
        sim,
        building: b instanceof BuildingSystem ? b : null,
        inventory,
        stations: st instanceof StationSystem ? st : null,
        collision: c instanceof WorldCollision ? c : null,
        light: l instanceof LightSystem ? l : null,
        storage: sto instanceof StorageSystem ? sto : null,
        hearth: h instanceof HearthSystem ? h : null,
        materials: inventory === null ? null : sto instanceof StorageSystem ? blueprintMaterials({ inventory, storage: sto }) : { count: (_sim, item) => inventory.count(item), take: () => false },
      };
      this.systems = s;
      this.inputs.piece = null;
    }
    return s;
  }

  /** Cursor, pipette, plan and verdicts of the frame (written into `ghost`). */
  update(sim: Simulation, pointer: GhostPointer, f: GhostFrame, ghost: BuildGhost): void {
    ghost.frames++;
    const sys = this.systemsOf(sim);
    if (!ghost.active || sys.building === null || !f.hasFigure) {
      ghost.clearResults();
      this.inputs.piece = null;
      return;
    }
    // Cursor: the pointer, or with a gamepad the player's tile plus the stick's offset.
    if (ghost.pad || !pointer.inside) {
      ghost.cursorTx = Math.floor(f.figureX / TILE_PX) + ghost.padDx;
      ghost.cursorTy = Math.floor(f.figureY / TILE_PX) + ghost.padDy;
      ghost.cursorValid = true;
    } else {
      internalToWorld(pointer.x, pointer.y, f.cameraX, f.cameraY, f.viewW, f.viewH, this.world);
      ghost.cursorTx = Math.floor(this.world.x / TILE_PX);
      ghost.cursorTy = Math.floor(this.world.y / TILE_PX);
      ghost.cursorValid = true;
    }
    this.pick(sys, f.layer, ghost);
    if (ghost.tool !== 'setzen') {
      this.updateTool(sim, sys.building, sys, f, ghost);
      return;
    }
    ghost.judgedTool = 'setzen';
    ghost.targetCount = 0;
    const piece = ghost.piece;
    if (piece === null) {
      this.inputs.piece = null;
      ghost.judged = null;
      ghost.plan.length = 0;
      ghost.verdicts.length = 0;
      ghost.okCount = 0;
      ghost.firstReason = null;
      ghost.available = 0;
      return;
    }
    const part = ghost.source === 'bauteil' ? (sys.building.catalog.find(piece) ?? null) : null;
    const available = sys.inventory?.count(piece) ?? 0;
    const shape = ghost.source === 'station' ? 'einzeln' : dragShapeOf(part?.kind ?? null);
    const fromX = ghost.dragging && shape !== 'einzeln' ? ghost.dragTx : ghost.cursorTx;
    const fromY = ghost.dragging && shape !== 'einzeln' ? ghost.dragTy : ghost.cursorTy;
    const k = this.inputs;
    const px = Math.floor(f.figureX);
    const py = Math.floor(f.figureY);
    const revision = sys.building.structures.revision;
    const chests = this.chestsChanged(sys.storage, f.layer);
    const same =
      !chests &&
      k.tool === 'setzen' && k.piece === piece && k.source === ghost.source && k.rot === ghost.rot && k.mirror === ghost.mirror && k.blueprint === ghost.blueprint && k.fromX === fromX && k.fromY === fromY && k.toX === ghost.cursorTx && k.toY === ghost.cursorTy && k.revision === revision && k.available === available && k.px === px && k.py === py && k.layer === f.layer;
    if (same && ++k.age < REFRESH_FRAMES) return;
    k.tool = 'setzen';
    k.piece = piece;
    k.source = ghost.source;
    k.rot = ghost.rot;
    k.mirror = ghost.mirror;
    k.blueprint = ghost.blueprint;
    k.fromX = fromX;
    k.fromY = fromY;
    k.toX = ghost.cursorTx;
    k.toY = ghost.cursorTy;
    k.revision = revision;
    k.available = available;
    k.px = px;
    k.py = py;
    k.layer = f.layer;
    k.age = 0;
    ghost.available = available;
    ghost.judged = piece;
    ghost.judgedSource = ghost.source;
    ghost.judgedBlueprint = ghost.blueprint;
    dragAnchors(shape, fromX, fromY, ghost.cursorTx, ghost.cursorTy, ghost.plan);
    if (ghost.source === 'station') this.judgeStation(sys, f, ghost, available);
    else this.judgeParts(sim, sys.building, part, f.layer, ghost, available);
  }

  /**
   * The targets of the dismantle and upgrade tools, or the repair quote (see module comment) – judged again when their
   * inputs change, and every `REFRESH_FRAMES` (the full refund window counts down, stations and lights come and go).
   */
  private updateTool(sim: Simulation, building: BuildingSystem, sys: GhostSystems, f: GhostFrame, ghost: BuildGhost): void {
    const tool = ghost.tool;
    const next = tool === 'aufwerten' && ghost.piece !== null && ghost.source === 'bauteil' ? (building.catalog.find(ghost.piece) ?? null) : null;
    // Upgrading drags the chosen piece's shape (walls a line or outline, floors and roofs an area); the other tools an area.
    const shape: DragShape = tool === 'aufwerten' ? dragShapeOf(next?.kind ?? null) : 'flaeche';
    const locked = !Number.isNaN(ghost.lockTx);
    const toX = locked ? ghost.lockTx : ghost.cursorTx;
    const toY = locked ? ghost.lockTy : ghost.cursorTy;
    const fromX = ghost.dragging && shape !== 'einzeln' ? ghost.dragTx : toX;
    const fromY = ghost.dragging && shape !== 'einzeln' ? ghost.dragTy : toY;
    const available = next === null ? 0 : (sys.inventory?.count(next.id) ?? 0);
    const k = this.inputs;
    const px = Math.floor(f.figureX);
    const py = Math.floor(f.figureY);
    const revision = building.structures.revision;
    const chests = this.chestsChanged(sys.storage, f.layer);
    const same = !chests && k.tool === tool && k.piece === ghost.piece && k.source === ghost.source && k.fromX === fromX && k.fromY === fromY && k.toX === toX && k.toY === toY && k.revision === revision && k.available === available && k.px === px && k.py === py && k.layer === f.layer;
    if (same && ++k.age < REFRESH_FRAMES) return;
    k.tool = tool;
    k.piece = ghost.piece;
    k.source = ghost.source;
    k.fromX = fromX;
    k.fromY = fromY;
    k.toX = toX;
    k.toY = toY;
    k.revision = revision;
    k.available = available;
    k.px = px;
    k.py = py;
    k.layer = f.layer;
    k.age = 0;
    ghost.judgedTool = tool;
    ghost.toolRevision++;
    ghost.judged = ghost.piece;
    ghost.judgedSource = ghost.source;
    ghost.judgedBlueprint = false;
    ghost.available = available;
    ghost.targetCount = 0;
    ghost.plan.length = 0;
    ghost.verdicts.length = 0;
    this.seen.clear();
    this.cleared.clear();
    this.promised.clear();
    if (tool === 'reparieren') {
      this.judgeRepair(sim, building, sys, f, ghost, fromX, fromY, toX, toY);
      return;
    }
    if (tool === 'abbauen') this.judgeDismantle(sim, building, sys, f, ghost, fromX, fromY, toX, toY);
    else if (next !== null) this.judgeUpgrade(sim, building, f, ghost, next, shape, fromX, fromY, toX, toY);
    for (let i = 0; i < ghost.targetCount; i++) {
      const t = ghost.targets[i] as ToolTarget;
      ghost.plan.push(t.tx, t.ty);
      ghost.verdicts.push(t.reason);
    }
    this.finish(ghost, available);
  }

  /** The next pooled target, or `null` when the plan is full. */
  private nextTarget(ghost: BuildGhost): ToolTarget | null {
    if (ghost.targetCount >= MAX_PLAN) return null;
    let t = ghost.targets[ghost.targetCount];
    if (t === undefined) {
      t = toolTarget();
      ghost.targets.push(t);
    }
    ghost.targetCount++;
    t.items.length = 0;
    t.to = null;
    t.reason = null;
    t.secondsLeft = 0;
    t.id = 0;
    t.rot = 0;
    t.mirror = false;
    return t;
  }

  /**
   * Dismantling: one tile – the topmost thing as `build.remove` without a layer takes it, else a station or a torch –,
   * or the whole rectangle of a drag in `DISMANTLE_ORDER`.
   */
  private judgeDismantle(sim: Simulation, building: BuildingSystem, sys: GhostSystems, f: GhostFrame, ghost: BuildGhost, fromX: number, fromY: number, toX: number, toY: number): void {
    const layer = f.layer;
    const x0 = Math.min(fromX, toX);
    const x1 = Math.max(fromX, toX);
    const y0 = Math.min(fromY, toY);
    const y1 = Math.max(fromY, toY);
    this.area = x0 !== x1 || y0 !== y1;
    if (!this.area) {
      for (let i = 0; i < PICK_ORDER.length; i++) if (this.addPart(sim, building, f, ghost, PICK_ORDER[i] as number, x0, y0, null)) return;
      const st = sys.stations?.stationAt(layer, x0, y0);
      if (st !== undefined) this.addStation(sim, sys, f, ghost, st);
      else this.addLight(sys, f, ghost, x0, y0);
      return;
    }
    for (let i = 0; i < DISMANTLE_ORDER.length; i++) {
      const li = DISMANTLE_ORDER[i] as number;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.addPart(sim, building, f, ghost, li, x, y, null);
      if (li !== OBJECT) continue;
      // Stations and standing lights are objects too: after the furniture, before the roofs.
      for (const p of sys.stations?.placed ?? []) {
        if (p.layer !== layer) continue;
        const size = sys.stations?.footprintOf(p) ?? { b: 1, t: 1 };
        if (p.tx <= x1 && x0 < p.tx + size.b && p.ty <= y1 && y0 < p.ty + size.t) this.addStation(sim, sys, f, ghost, p);
      }
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.addLight(sys, f, ghost, x, y);
    }
  }

  /**
   * Adds the part covering tile (tx, ty) of build layer `li` (once per anchor) with its refund and reach; with `next`
   * as the upgrade to `next`. False when no part lies there.
   */
  private addPart(sim: Simulation, building: BuildingSystem, f: GhostFrame, ghost: BuildGhost, li: number, tx: number, ty: number, next: PartDef | null): boolean {
    const layer = f.layer;
    if (!anchorOf(building.structures, layer, li, tx, ty, this.anchor)) return false;
    const { tx: ax, ty: ay, cell } = this.anchor;
    const key = (li * KEY_SPAN + ay) * KEY_SPAN + ax;
    if (this.seen.has(key)) return true;
    this.seen.add(key);
    const part = building.catalog.byRuntimeId(cellPart(cell));
    if (part === undefined) return false;
    const t = this.nextTarget(ghost);
    if (t === null) return true;
    const rot = cellRot(cell);
    const size = rotatedSize(part.w, part.h, rot);
    t.art = 'bauteil';
    t.piece = part.id;
    t.ebene = part.layer;
    t.tx = ax;
    t.ty = ay;
    t.w = size.w;
    t.h = size.h;
    t.rot = rot;
    t.mirror = cellMirror(cell);
    t.blueprint = cellBlueprint(cell);
    if (t.blueprint) t.refund = 'keine';
    else {
      const placed = building.placedTick(layer, part.layer, ax, ay);
      if (placed !== undefined && sim.tick - placed <= FULL_REFUND_TICKS) {
        t.refund = 'ganz';
        t.secondsLeft = Math.max(1, Math.ceil((placed + FULL_REFUND_TICKS - sim.tick) / BALANCE.time.tickHz));
      } else {
        t.refund = 'anteilig';
        for (const a of building.materials.refund([{ part: part.id, pieces: 1 }], BALANCE.building.refund.lateShare)) t.items.push(a);
      }
    }
    if (next === null) {
      // The order of `build.remove`: reach, the load of a jetty, what other systems keep standing.
      t.reason = distanceToRect(f.figureX, f.figureY, ax, ay, size.w, size.h) > BUILD_REACH_PX ? 'tooFar' : t.blueprint ? null : (this.loadOf(sim, building, part, cell, layer, ax, ay) ?? this.keptBy(part, layer, ax, ay));
      if (t.reason === null) this.cleared.add(key);
    } else {
      t.to = next.id;
      t.reason = this.upgradeProblem(sim, building, f, part, next, cell, ax, ay, size.w, size.h);
    }
    return true;
  }

  /**
   * `carriesLoad` when the finished jetty of `cell` on (tx, ty) carries something that stays (`BuildingSystem.loadProblem`,
   * the rule of `build.remove`), or `null`. In a drag the targets come down in `DISMANTLE_ORDER`, floors last: a jetty
   * whose whole load is a target of the same drag that comes down before it is free.
   */
  private loadOf(sim: Simulation, building: BuildingSystem, part: PartDef, cell: number, layer: Layer, tx: number, ty: number): 'carriesLoad' | null {
    const load = building.loadProblem(sim, part, cell, layer, tx, ty);
    if (load === null || !this.area) return load;
    const sys = this.systems;
    let known = false;
    for (let i = 0; i < LOAD_LAYERS.length; i++) {
      const li = LOAD_LAYERS[i] as number;
      if (building.structures.cell(layer, li, tx, ty) === 0) continue;
      known = true;
      if (!anchorOf(building.structures, layer, li, tx, ty, this.loadAnchor)) return load;
      if (!this.cleared.has((li * KEY_SPAN + this.loadAnchor.ty) * KEY_SPAN + this.loadAnchor.tx)) return load;
    }
    const st = sys?.stations?.stationAt(layer, tx, ty);
    if (st !== undefined) {
      known = true;
      if (!this.cleared.has(-st.id)) return load;
    }
    const l = sys?.light?.lightAt(layer, tx, ty);
    if (l !== undefined) {
      known = true;
      if (!this.cleared.has(-LIGHT_KEY - l.id)) return load;
    }
    // A load of another system the ghost does not know stays.
    return known ? null : load;
  }

  /**
   * Whether the contents of a chest on `layer` changed since the last call, or chests came or went (M5-52: an emptied
   * chest is free in the next frame, not after `REFRESH_FRAMES`). Remembers the current stacks; compares identities,
   * allocates only while the remembered list grows.
   */
  private chestsChanged(storage: StorageSystem | null, layer: Layer): boolean {
    if (storage === null) return false;
    const memo = this.chestSlots;
    const chests = storage.chests;
    let changed = layer !== this.chestLayer;
    this.chestLayer = layer;
    let k = 0;
    for (let i = 0; i < chests.length; i++) {
      const c = chests[i] as (typeof chests)[number];
      if (c.layer !== layer) continue;
      const slots = c.slots;
      for (let j = 0; j < slots.length; j++, k++) {
        const stack = slots[j] ?? null;
        if (k >= memo.length) {
          memo.push(stack);
          changed = true;
        } else if (memo[k] !== stack) {
          memo[k] = stack;
          changed = true;
        }
      }
    }
    if (k !== this.chestSlotCount) changed = true;
    for (let i = k; i < this.chestSlotCount; i++) memo[i] = null;
    this.chestSlotCount = k;
    return changed;
  }

  /**
   * Adds placed station `p` (`station.remove`): whole within its full refund window, else the late share of every stage;
   * refused out of reach or while an order is worked at it. A station part of the build grid is no station target – it
   * comes down as its part.
   */
  private addStation(sim: Simulation, sys: GhostSystems, f: GhostFrame, ghost: BuildGhost, p: Readonly<PlacedStation>): void {
    const stations = sys.stations;
    const building = sys.building;
    if (stations === null || building === null || this.seen.has(-p.id)) return;
    this.seen.add(-p.id);
    const kept = stations.removalProblem(p);
    if (kept === 'builtIn') return;
    const t = this.nextTarget(ghost);
    if (t === null) return;
    const size = stations.footprintOf(p);
    t.art = 'station';
    t.piece = p.station;
    t.ebene = 'objekt';
    t.tx = p.tx;
    t.ty = p.ty;
    t.w = size.b;
    t.h = size.t;
    t.id = p.id;
    t.mirror = p.gespiegelt === true;
    t.blueprint = false;
    if (p.gesetzt !== undefined && sim.tick - p.gesetzt <= FULL_REFUND_TICKS) {
      t.refund = 'ganz';
      t.secondsLeft = Math.max(1, Math.ceil((p.gesetzt + FULL_REFUND_TICKS - sim.tick) / BALANCE.time.tickHz));
    } else {
      // Every stage of its line up to its own was built (the station system's late refund).
      const def = stations.stations.find(p.station);
      const stages = def === undefined ? [] : stations.stations.list.filter((d) => d.linie === def.linie && d.stufe <= def.stufe).map((d) => ({ part: d.id, pieces: 1 }));
      t.refund = 'anteilig';
      for (const a of building.materials.refund(stages, BALANCE.building.refund.lateShare)) t.items.push(a);
    }
    t.reason = distanceToRect(f.figureX, f.figureY, p.tx, p.ty, size.b, size.t) > STATION_USE_REACH_PX ? 'outOfReach' : kept;
    if (t.reason === null) this.cleared.add(-p.id);
  }

  /**
   * Why another system keeps the finished part `part` anchored on (tx, ty) of `layer` standing – a chest with items, a
   * burning or filled hearth, a station part at which an order is worked – or `null`: the removal rules `build.remove`
   * and `build.upgrade` ask, asked read-only.
   */
  private keptBy(part: PartDef, layer: Layer, tx: number, ty: number): string | null {
    const sys = this.systems;
    if (sys === null) return null;
    return sys.storage?.removalProblem(part, layer, tx, ty) ?? sys.hearth?.removalProblem(part, layer, tx, ty) ?? sys.stations?.partRemovalProblem(part, layer, tx, ty) ?? null;
  }

  /** Adds the standing light on tile (tx, ty): a torch is taken back (`light.take`), a fire stays; a lamp is a part. */
  private addLight(sys: GhostSystems, f: GhostFrame, ghost: BuildGhost, tx: number, ty: number): void {
    const l = sys.light?.lightAt(f.layer, tx, ty);
    if (l === undefined || this.seen.has(-LIGHT_KEY - l.id)) return;
    const kind = lightKind(l.kind);
    if (kind.moebel !== undefined) return;
    this.seen.add(-LIGHT_KEY - l.id);
    const t = this.nextTarget(ghost);
    if (t === null) return;
    t.art = 'licht';
    t.piece = kind.gegenstand;
    t.ebene = 'objekt';
    t.tx = l.tx;
    t.ty = l.ty;
    t.w = l.groesse?.b ?? 1;
    t.h = l.groesse?.t ?? 1;
    t.id = l.id;
    t.blueprint = false;
    t.refund = 'ganz';
    t.reason = l.torch === null ? 'notTakeable' : tileInReach(f.figureX, f.figureY, l.tx, l.ty, LIGHT_TAKE_REACH_TILES) ? null : 'outOfReach';
    if (t.reason === null) this.cleared.add(-LIGHT_KEY - l.id);
  }

  /** Upgrading to `next`: the parts under the anchors of the chosen piece's shape (one per anchor, in plan order). */
  private judgeUpgrade(sim: Simulation, building: BuildingSystem, f: GhostFrame, ghost: BuildGhost, next: PartDef, shape: DragShape, fromX: number, fromY: number, toX: number, toY: number): void {
    const cells = this.cells;
    const n = dragAnchors(shape, fromX, fromY, toX, toY, cells);
    for (let i = 0; i < n; i++) this.addPart(sim, building, f, ghost, next.layerIndex, cells[2 * i] as number, cells[2 * i + 1] as number, next);
  }

  /**
   * Why `build.upgrade` of the part `old` (cell `cell`, anchored on (ax, ay), footprint w × h) to `next` would be refused
   * (the building system's rules, in its order, with what other systems keep standing – `keptBy`), or `null`. The new
   * piece comes from the material source near the part; earlier targets of the same drag have promised theirs.
   */
  private upgradeProblem(sim: Simulation, building: BuildingSystem, f: GhostFrame, old: PartDef, next: PartDef, cell: number, ax: number, ay: number, w: number, h: number): string | null {
    if (!isUpgrade(old, next)) return 'notUpgradable';
    if (distanceToRect(f.figureX, f.figureY, ax, ay, w, h) > BUILD_REACH_PX) return 'tooFar';
    const blueprint = cellBlueprint(cell);
    const open = cellOpen(cell);
    const newlyBlocks = ((open ? next.blocksOpen : next.blocks) & BODY_BLOCKERS) !== 0 && ((open ? old.blocksOpen : old.blocks) & BODY_BLOCKERS) === 0;
    if (!blueprint && newlyBlocks && distanceToRect(f.figureX, f.figureY, ax, ay, w, h) < BODY_RADIUS_PX) return 'blocked';
    if (next.layer === 'dach' && roofSupportDistance(this.candidateRoof.set(building, f.layer, blueprint, ax, ay, next.roofReach), ax, ay) < 0) return 'noSupport';
    if (blueprint) return null;
    const kept = this.keptBy(old, f.layer, ax, ay);
    if (kept !== null) return kept;
    const source = this.systems?.materials;
    const promised = this.promised.get(next.id) ?? 0;
    if (source === null || source === undefined || source.count(sim, next.id, f.layer, ax, ay) - promised < 1) return 'noMaterial';
    this.promised.set(next.id, promised + 1);
    return null;
  }

  /**
   * The repair quote of the rectangle from the drag start (the cursor without a drag) to the cursor: every finished,
   * damaged part anchored in it within reach, in the order of the build layers and rows, mended while the materials
   * near it last (`build.repair`'s own order); the damaged parts are the targets.
   */
  private judgeRepair(sim: Simulation, building: BuildingSystem, sys: GhostSystems, f: GhostFrame, ghost: BuildGhost, fromX: number, fromY: number, toX: number, toY: number): void {
    const q = ghost.repair;
    const layer = f.layer;
    q.x0 = Math.min(fromX, toX);
    q.x1 = Math.max(fromX, toX);
    q.y0 = Math.min(fromY, toY);
    q.y1 = Math.max(fromY, toY);
    q.damaged = 0;
    q.mendable = 0;
    q.cost.length = 0;
    q.hammer = this.hammerInHand(sys);
    const max = BALANCE.building.repair.maxAreaTiles;
    if (q.x1 - q.x0 + 1 > max || q.y1 - q.y0 + 1 > max) {
      q.reason = 'areaTooLarge';
      ghost.okCount = 0;
      ghost.firstReason = q.reason;
      return;
    }
    const store = building.structures;
    const source = sys.materials;
    for (let li = 0; li < BUILD_LAYERS.length; li++) {
      for (let ty = q.y0; ty <= q.y1; ty++) {
        for (let tx = q.x0; tx <= q.x1; tx++) {
          const cell = store.cell(layer, li, tx, ty);
          if (cell === 0 || cellCovered(cell) || cellBlueprint(cell)) continue;
          const part = building.catalog.byRuntimeId(cellPart(cell));
          if (part === undefined) continue;
          const hp = store.hp(layer, li, tx, ty);
          if (hp >= part.hp) continue;
          const size = rotatedSize(part.w, part.h, cellRot(cell));
          if (distanceToRect(f.figureX, f.figureY, tx, ty, size.w, size.h) > BUILD_REACH_PX) continue;
          q.damaged++;
          const cost = repairCost(building.materials.materials(part.id), hp, part.hp, BALANCE.building.repair.materialShare);
          const ok = source !== null && cost.every((c) => source.count(sim, c.item, layer, tx, ty) - (this.promised.get(c.item) ?? 0) >= c.count);
          if (ok) {
            q.mendable++;
            for (const c of cost) {
              this.promised.set(c.item, (this.promised.get(c.item) ?? 0) + c.count);
              const i = q.cost.findIndex((x) => x.item === c.item);
              if (i < 0) q.cost.push(c);
              else q.cost[i] = { item: c.item, count: (q.cost[i] as ItemAmount).count + c.count };
            }
          }
          const t = this.nextTarget(ghost);
          if (t === null) continue;
          t.art = 'bauteil';
          t.piece = part.id;
          t.ebene = part.layer;
          t.tx = tx;
          t.ty = ty;
          t.w = size.w;
          t.h = size.h;
          t.blueprint = false;
          t.refund = 'keine';
          t.reason = ok ? null : 'noMaterial';
          ghost.plan.push(tx, ty);
          ghost.verdicts.push(t.reason);
        }
      }
    }
    q.reason = !q.hammer ? 'noHammer' : q.damaged === 0 ? 'nothingToRepair' : q.mendable === 0 ? 'noMaterial' : null;
    ghost.okCount = q.hammer ? q.mendable : 0;
    ghost.firstReason = q.reason;
  }

  /** Whether the hand holds a hammer that is not broken (§16.6 "mit Hammer"; the building system's rule). */
  private hammerInHand(sys: GhostSystems): boolean {
    const inv = sys.inventory;
    const stack = inv?.selected() ?? null;
    if (inv === null || stack === null) return false;
    const def = inv.bags.catalog.find(stack.item);
    return def?.werkzeug?.art === BALANCE.building.blueprintTool && (stack.haltbarkeit === undefined || stack.haltbarkeit > 0);
  }

  /** The piece under the cursor (pipette). */
  private pick(sys: GhostSystems, layer: Layer, ghost: BuildGhost): void {
    const h = ghost.hovered;
    h.piece = null;
    const b = sys.building;
    if (b === null) return;
    for (let i = 0; i < PICK_ORDER.length; i++) {
      if (!anchorOf(b.structures, layer, PICK_ORDER[i] as number, ghost.cursorTx, ghost.cursorTy, this.anchor)) continue;
      const part = b.catalog.byRuntimeId(cellPart(this.anchor.cell));
      if (part === undefined) continue;
      h.piece = part.id;
      h.source = 'bauteil';
      h.rot = cellRot(this.anchor.cell);
      h.mirror = cellMirror(this.anchor.cell);
      return;
    }
    const st = sys.stations?.stationAt(layer, ghost.cursorTx, ghost.cursorTy);
    if (st !== undefined) {
      h.piece = st.station;
      h.source = 'station';
      h.rot = 0;
      h.mirror = false;
    }
  }

  /**
   * Verdicts of build parts: the simulation's preview, roofs carrying each other, the pieces in the bags – in
   * blueprint mode the preview of `build.blueprint`, and nothing is missing.
   */
  private judgeParts(sim: Simulation, building: BuildingSystem, part: PartDef | null, layer: Layer, ghost: BuildGhost, available: number): void {
    const plan = ghost.plan;
    const n = plan.length / 2;
    const verdicts = ghost.verdicts;
    verdicts.length = n;
    if (part === null) {
      for (let i = 0; i < n; i++) verdicts[i] = 'unknownPart';
      this.finish(ghost, available);
      return;
    }
    const rot = rotatableKind(part.kind) ? ghost.rot : 0;
    const plans = ghost.blueprint;
    for (let i = 0; i < n; i++) verdicts[i] = building.preview(sim, part.id, plan[2 * i] as number, plan[2 * i + 1] as number, rot, plans);
    if (part.kind === 'dach' && n > 1) this.chainRoofs(building, part, layer, ghost, plans);
    if (plans) {
      this.finish(ghost, available);
      return;
    }
    // Pieces in the bags: the first `available` placeable anchors are placed, the rest would lack material.
    let left = available;
    for (let i = 0; i < n; i++) {
      if (verdicts[i] !== null && verdicts[i] !== 'noMaterial') continue;
      if (left > 0) {
        verdicts[i] = null;
        left--;
      } else verdicts[i] = 'noMaterial';
    }
    this.finish(ghost, available);
  }

  /**
   * Planned roof tiles carry each other (§16.3 in placing order): a tile refused only for want of support counts as
   * carried when the statics over the built roofs plus the plan reach it; the plan is sorted by distance to the
   * support, so each tile is carried by those placed before it. With `plans` (blueprint mode) blueprints of roofs
   * and supports count as built (the rule of `build.blueprint`).
   */
  private chainRoofs(building: BuildingSystem, part: PartDef, layer: Layer, ghost: BuildGhost, plans: boolean): void {
    const plan = ghost.plan;
    const n = plan.length / 2;
    const planned = this.planned;
    planned.clear();
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const tx = plan[2 * i] as number;
      const ty = plan[2 * i + 1] as number;
      const v = ghost.verdicts[i];
      if (v === null || v === 'noSupport' || v === 'noMaterial') planned.add(ty * KEY_SPAN + tx);
      x0 = Math.min(x0, tx);
      y0 = Math.min(y0, ty);
      x1 = Math.max(x1, tx);
      y1 = Math.max(y1, ty);
    }
    const grid = this.chainGrid;
    grid.building = building;
    grid.layer = layer;
    grid.plans = plans;
    grid.reach = part.roofReach;
    grid.planned = planned;
    const margin = part.roofReach + 1;
    const w = x1 - x0 + 1 + 2 * margin;
    const h = y1 - y0 + 1 + 2 * margin;
    const d = roofDistances(grid, x0 - margin, y0 - margin, w, h, this.roofScratch);
    grid.building = null;
    const order = this.order;
    order.length = 0;
    for (let i = 0; i < n; i++) {
      const tx = plan[2 * i] as number;
      const ty = plan[2 * i + 1] as number;
      const dist = d.dist[(ty - d.y0) * d.w + (tx - d.x0)] as number;
      if (ghost.verdicts[i] === 'noSupport' && dist >= 0) ghost.verdicts[i] = null;
      order.push(ghost.verdicts[i] === null ? dist : Number.MAX_SAFE_INTEGER, i);
    }
    // Stable sort of the anchors by distance (placeable first, nearest to the support first).
    const idx = this.sortIdx;
    idx.length = 0;
    for (let i = 0; i < n; i++) idx.push(i);
    idx.sort((a, b) => (order[2 * a] as number) - (order[2 * b] as number) || a - b);
    const oldPlan = this.oldPlan;
    oldPlan.length = 0;
    for (let i = 0; i < plan.length; i++) oldPlan.push(plan[i] as number);
    const oldVerdicts = this.oldVerdicts;
    oldVerdicts.length = 0;
    for (let i = 0; i < ghost.verdicts.length; i++) oldVerdicts.push(ghost.verdicts[i] ?? null);
    for (let k = 0; k < n; k++) {
      const i = idx[k] as number;
      plan[2 * k] = oldPlan[2 * i] as number;
      plan[2 * k + 1] = oldPlan[2 * i + 1] as number;
      ghost.verdicts[k] = oldVerdicts[i] ?? null;
    }
  }

  /**
   * Verdict of a station (the station system's `station.place` rules, src/game/stations/system.ts: within the
   * placing reach, no other station on the footprint, no rock, water, cliff face or blocking object under it, no
   * placed light on it); `noMaterial` without the item in the bags; `notPlannable` in blueprint mode (a station is
   * set up from the bags, it has no plan).
   */
  private judgeStation(sys: GhostSystems, f: GhostFrame, ghost: BuildGhost, available: number): void {
    const plan = ghost.plan;
    ghost.verdicts.length = plan.length / 2;
    const tx = plan[0] as number;
    const ty = plan[1] as number;
    ghost.verdicts[0] = ghost.blueprint ? 'notPlannable' : (this.stationProblem(sys, f, ghost.piece ?? '', tx, ty) ?? (available > 0 ? null : 'noMaterial'));
    this.finish(ghost, available);
  }

  private stationProblem(sys: GhostSystems, f: GhostFrame, station: string, tx: number, ty: number): string | null {
    const stations = sys.stations;
    const def = stations?.stations.find(station);
    if (stations === null || def === undefined) return 'notAStation';
    if (def.brennt === true) return 'placedElsewhere';
    const w = def.groesse.b;
    const d = def.groesse.t;
    const px = Math.max(tx * TILE_PX, Math.min(f.figureX, (tx + w) * TILE_PX));
    const py = Math.max(ty * TILE_PX, Math.min(f.figureY, (ty + d) * TILE_PX));
    if (Math.hypot(f.figureX - px, f.figureY - py) > STATION_REACH_PX) return 'outOfReach';
    for (const p of stations.placed) {
      if (p.layer !== f.layer) continue;
      const o = p.groesse ?? stations.stations.get(p.station).groesse;
      if (tx < p.tx + o.b && p.tx < tx + w && ty < p.ty + o.t && p.ty < ty + d) return 'tileTaken';
    }
    const collision = sys.collision;
    if (collision === null) return null;
    for (let y = ty; y < ty + d; y++) {
      for (let x = tx; x < tx + w; x++) {
        if ((collision.grid.tileInfo(f.layer, x, y) & STATION_BLOCKERS) !== 0) return 'tileBlocked';
        const chunk = collision.chunks.get(f.layer, x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
        if (chunk === undefined || ((chunk.water[((y & CHUNK_MASK) << CHUNK_SHIFT) | (x & CHUNK_MASK)] as number) & WATER_DEPTH_MASK) !== 0) return 'tileBlocked';
        if (sys.light?.lightAt(f.layer, x, y) !== undefined || sys.building?.partAt(f.layer, 'objekt', x, y) !== undefined || sys.building?.partAt(f.layer, 'struktur', x, y) !== undefined) return 'tileTaken';
      }
    }
    return null;
  }

  private finish(ghost: BuildGhost, available: number): void {
    ghost.available = available;
    let ok = 0;
    let first: string | null = null;
    for (let i = 0; i < ghost.verdicts.length; i++) {
      const v = ghost.verdicts[i] ?? null;
      if (v === null) ok++;
      else first ??= v;
    }
    ghost.okCount = ok;
    ghost.firstReason = first;
  }

  /** Draws the plan: tinted sprites and unlit footprints (blueprints in the plan blue), the reason over the cursor. */
  draw(scene: RenderScene, atlas: AtlasData, sim: Simulation, f: GhostFrame, ghost: BuildGhost, overlay: DebugOverlayList): void {
    this.drawn = 0;
    const sys = this.systemsOf(sim);
    if (!ghost.active || sys.building === null || !ghost.cursorValid) return;
    if (ghost.tool !== 'setzen') {
      if (ghost.judgedTool === ghost.tool) this.drawTool(scene, atlas, sys.building, f, ghost, overlay);
      return;
    }
    if (ghost.piece === null) return;
    const plan = ghost.plan;
    const n = Math.min(plan.length / 2, ghost.verdicts.length);
    const m = atlas.manifest;
    const catalog = sys.building.catalog;
    const part = ghost.source === 'bauteil' ? (catalog.find(ghost.piece) ?? null) : null;
    const stationSprite = ghost.source === 'station' ? (m.sprites[`obj_${ghost.piece}`] ?? null) : null;
    const planned = this.planned;
    planned.clear();
    for (let i = 0; i < n; i++) planned.add((plan[2 * i + 1] as number) * KEY_SPAN + (plan[2 * i] as number));
    for (let i = 0; i < n; i++) {
      const tx = plan[2 * i] as number;
      const ty = plan[2 * i + 1] as number;
      const ok = ghost.verdicts[i] === null;
      const planned = ok && ghost.judgedBlueprint;
      const colors = planned ? GHOST_COLORS.plan : ok ? GHOST_COLORS.ok : GHOST_COLORS.refused;
      const look = resetPieceLook(this.look);
      look.fade = planned ? BLUEPRINT_LOOK.fade : GHOST_LOOK.fade;
      look.tintR = colors.tint[0];
      look.tintG = colors.tint[1];
      look.tintB = colors.tint[2];
      look.tintStrength = planned ? BLUEPRINT_LOOK.strength : ok ? GHOST_LOOK.ok : GHOST_LOOK.refused;
      look.heightBase = f.levelAt(tx, ty) * WAND_PX_JE_STUFE;
      look.mirror = ghost.mirror;
      let w = 1;
      let h = 1;
      if (part !== null) {
        look.rot = rotatableKind(part.kind) ? ghost.rot : 0;
        const size = rotatedSize(part.w, part.h, look.rot);
        w = size.w;
        h = size.h;
        this.lookOfPlan(sys.building.structures, catalog, part, f.layer, tx, ty, look);
        const sprites = this.sprites.get(m, catalog, part.rid);
        if (sprites !== undefined) this.drawn += emitPiece(scene, sprites, part, tx, ty, look, f.time);
      } else if (stationSprite !== null) {
        const def = sys.stations?.stations.find(ghost.piece);
        w = def?.groesse.b ?? 1;
        h = def?.groesse.t ?? 1;
        this.drawn += pushStation(scene, stationSprite, tx, ty, w, h, look);
      }
      overlay.rect(tx * TILE_PX, ty * TILE_PX, w * TILE_PX, h * TILE_PX, colors.fill);
      edges(overlay, tx * TILE_PX, ty * TILE_PX, w * TILE_PX, h * TILE_PX, colors.edge);
      this.drawn++;
    }
    const reason = ghost.firstReason;
    if (reason !== null) {
      const label = f.reasonLabel(reason);
      const x = (ghost.cursorTx + 0.5) * TILE_PX;
      const y = ghost.cursorTy * TILE_PX - LABEL_LIFT;
      if (label !== null) scene.worldUi.label(x, y, label, 'feind');
      // A part missing in the bags can still be planned: the toggle above the reason.
      const hint = ghost.planHint;
      if (label !== null && hint !== null && reason === 'noMaterial' && !ghost.judgedBlueprint && ghost.judgedSource === 'bauteil') scene.worldUi.label(x, y - HINT_LIFT, hint, PLAN_HINT_TONE);
    }
  }

  /**
   * Draws the targets of a tool: what comes down on an amber field, what is upgraded on a green one under the new
   * piece's tinted sprite, the repair rectangle in faint ice with its damaged parts green (mended) or red (materials
   * missing), refusals red; the UI's short text over the cursor, red when the target under it is refused.
   */
  private drawTool(scene: RenderScene, atlas: AtlasData, building: BuildingSystem, f: GhostFrame, ghost: BuildGhost, overlay: DebugOverlayList): void {
    const tool = ghost.judgedTool;
    if (tool === 'setzen') return;
    const m = atlas.manifest;
    const catalog = building.catalog;
    if (tool === 'reparieren') {
      const q = ghost.repair;
      const c = TOOL_COLORS.bereich;
      const x = q.x0 * TILE_PX;
      const y = q.y0 * TILE_PX;
      const w = (q.x1 - q.x0 + 1) * TILE_PX;
      const h = (q.y1 - q.y0 + 1) * TILE_PX;
      overlay.rect(x, y, w, h, c.fill);
      edges(overlay, x, y, w, h, c.edge);
      this.drawn++;
    }
    const planned = this.planned;
    planned.clear();
    for (let i = 0; i < ghost.targetCount; i++) {
      const t = ghost.targets[i] as ToolTarget;
      planned.add(t.ty * KEY_SPAN + t.tx);
    }
    for (let i = 0; i < ghost.targetCount; i++) {
      const t = ghost.targets[i] as ToolTarget;
      const ok = t.reason === null;
      const colors = !ok ? TOOL_COLORS.refused : tool === 'abbauen' ? TOOL_COLORS.abbauen : tool === 'aufwerten' ? TOOL_COLORS.aufwerten : TOOL_COLORS.heil;
      if (tool === 'aufwerten' && ok && t.to !== null) {
        // The new piece where the old one stands, as it stands (turned, mirrored), tinted like a placeable ghost.
        const next = catalog.find(t.to);
        const sprites = next === undefined ? undefined : this.sprites.get(m, catalog, next.rid);
        if (next !== undefined && sprites !== undefined) {
          const look = resetPieceLook(this.look);
          look.fade = GHOST_LOOK.fade;
          look.tintR = GHOST_COLORS.ok.tint[0];
          look.tintG = GHOST_COLORS.ok.tint[1];
          look.tintB = GHOST_COLORS.ok.tint[2];
          look.tintStrength = GHOST_LOOK.ok;
          look.heightBase = f.levelAt(t.tx, t.ty) * WAND_PX_JE_STUFE;
          look.rot = t.rot;
          look.mirror = t.mirror;
          this.lookOfPlan(building.structures, catalog, next, f.layer, t.tx, t.ty, look);
          this.drawn += emitPiece(scene, sprites, next, t.tx, t.ty, look, f.time);
        }
      }
      overlay.rect(t.tx * TILE_PX, t.ty * TILE_PX, t.w * TILE_PX, t.h * TILE_PX, colors.fill);
      edges(overlay, t.tx * TILE_PX, t.ty * TILE_PX, t.w * TILE_PX, t.h * TILE_PX, colors.edge);
      this.drawn++;
    }
    const label = ghost.toolLabel;
    if (label === null) return;
    // Red when nothing can be done (a single refused target, the repair's refusal), else the tool's colour – an area
    // with nothing damaged in it is no refusal.
    const refused = tool === 'reparieren' ? ghost.repair.reason !== null && ghost.repair.reason !== 'nothingToRepair' : ghost.targetCount > 0 && ghost.okCount === 0;
    scene.worldUi.label((ghost.cursorTx + 0.5) * TILE_PX, ghost.cursorTy * TILE_PX - LABEL_LIFT, label, refused ? 'feind' : TOOL_LABEL_TONES[tool]);
  }

  /** Neighbour mask and versions of a planned piece: the built neighbours and the other planned pieces join it. */
  private lookOfPlan(store: BuildingSystem['structures'], catalog: PartCatalog, part: PartDef, layer: Layer, tx: number, ty: number, look: PieceLook): void {
    const li = part.layerIndex;
    let mask = 0;
    for (let r = 0; r < ROT_DX.length; r++) {
      const nx = tx + (ROT_DX[r] as number);
      const ny = ty + (ROT_DY[r] as number);
      if (this.planned.has(ny * KEY_SPAN + nx)) {
        mask |= 1 << r;
        continue;
      }
      const cell = store.cell(layer, li, nx, ny);
      const other = cell === 0 ? undefined : catalog.byRuntimeId(cellPart(cell));
      if (other !== undefined && kindsConnect(part.kind, other.kind)) mask |= 1 << r;
    }
    look.mask = mask;
    if (part.kind === 'boden') look.versionB = versionB(tx, ty, 5);
    else if (part.kind === 'wand') look.versionB = versionB(tx, ty, 7);
    if (part.kind === 'dach') {
      // The planned roof shows its front row; it sorts at its own tile.
      look.roofRow = 0;
      look.roofDepth = ty * TILE_PX + TILE_PX - 0.5;
    }
  }
}

/** Distance from world px (x, y) to the nearest point of the tile rectangle of w × h tiles at (tx, ty) [px]. */
function distanceToRect(x: number, y: number, tx: number, ty: number, w: number, h: number): number {
  const nx = Math.max(tx * TILE_PX, Math.min(x, (tx + w) * TILE_PX));
  const ny = Math.max(ty * TILE_PX, Math.min(y, (ty + h) * TILE_PX));
  return Math.hypot(x - nx, y - ny);
}

/**
 * The finished roofs and supports of the build grid (with `plans` blueprints too) and one roof tile on (cx, cy) with a
 * new reach – a roof upgraded in place (the building system asks its statics the same question).
 */
class CandidateRoofGrid implements RoofGrid {
  private building: BuildingSystem | null = null;
  private layer: Layer = 0;
  private plans = false;
  private cx = 0;
  private cy = 0;
  private reach = 0;

  set(building: BuildingSystem, layer: Layer, plans: boolean, cx: number, cy: number, reach: number): this {
    this.building = building;
    this.layer = layer;
    this.plans = plans;
    this.cx = cx;
    this.cy = cy;
    this.reach = reach;
    return this;
  }

  roofReach(tx: number, ty: number): number {
    if (tx === this.cx && ty === this.cy) return this.reach;
    const b = this.building;
    const cell = b === null ? 0 : b.structures.cell(this.layer, ROOF, tx, ty);
    return b === null || cell === 0 || (!this.plans && cellBlueprint(cell)) ? 0 : (b.catalog.byRuntimeId(cellPart(cell))?.roofReach ?? 0);
  }

  support(tx: number, ty: number): boolean {
    const b = this.building;
    const cell = b === null ? 0 : b.structures.cell(this.layer, STRUCTURE, tx, ty);
    return b !== null && cell !== 0 && (this.plans || !cellBlueprint(cell)) && b.catalog.byRuntimeId(cellPart(cell))?.supports === true;
  }
}

/** A station's sprite standing at the middle of its footprint's front edge (like furniture). */
function pushStation(scene: RenderScene, s: AtlasSprite, tx: number, ty: number, w: number, h: number, look: PieceLook): number {
  const idle = s.clips.aus ?? s.clips.leer;
  const f = s.frames[idle?.frames[0] ?? 0] ?? s.frames[0];
  if (f === undefined) return 0;
  const d = scene.sprite.reset();
  d.frame = f;
  d.x = tx * TILE_PX + (w * TILE_PX) / 2;
  d.y = (ty + h) * TILE_PX - 1;
  d.heightBase = look.heightBase;
  d.fade = look.fade;
  d.tintR = look.tintR;
  d.tintG = look.tintG;
  d.tintB = look.tintB;
  d.tintStrength = look.tintStrength;
  // A station set up mirrored (F, `station.place {mirror}`) stands mirrored where its sprite may be: its ghost shows it so.
  d.mirror = look.mirror && s.symmetric;
  scene.sprites.push(d);
  return 1;
}

/** A 1-px frame around the rectangle. */
function edges(list: DebugOverlayList, x: number, y: number, w: number, h: number, c: number): void {
  list.rect(x, y, w, 1, c);
  list.rect(x, y + h - 1, w, 1, c);
  list.rect(x, y + 1, 1, h - 2, c);
  list.rect(x + w - 1, y + 1, 1, h - 2, c);
}
