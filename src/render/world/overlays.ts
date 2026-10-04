/**
 * Producers of the world view's debug overlays (M2-29, MASTERPROMPT §31.6 "Overlays (Chunks,
 * Kollision, …, Temperaturfeld)"). Each frame they read the world state around the camera and put
 * rectangles and labels into the frame's `DebugOverlayList` (drawn by `DebugOverlayPass`):
 *
 * - `chunks`: every chunk in view tinted and bordered by its state – active (the active zone ticks
 *   it), frozen (resident, not ticking), loading (a worker job is on its way), missing (not resident:
 *   a hole in the picture) – with its chunk coordinates `cx:cy` in the corner.
 * - `kollision`: every blocking tile in the colour of its collision category (solid rock, object,
 *   deep water, cliff wall, hazard, outside the world), ramp and stair tiles marked – exactly what
 *   `CollisionGrid` hands the movers (derived live from the chunk arrays).
 * - `temperatur`: the temperature field per tile in 5 °C bands from cold blue to hot red, with the
 *   value every eight tiles – what `TemperatureField` computes for the tile (biome, season, time of
 *   day, weather, height, lava heat).
 * - `spawnzonen` (M6-35, §12.4): the ring 16–40 tiles around the player where the night spawner may put shadow brood,
 *   every tile of it in view tinted where a body could appear now – open ground a walking creature stands on (the
 *   overlays' collision grid), dark (light < 0,15 on the gameplay light map), inside the creatures' zone, outside the
 *   burning hearths' spawn ban (those tiles warm); the ring's edges dotted, a legend at the player; and on every active
 *   chunk in view the count of wild animals at home there (in the chunk's visible part, when it holds the label).
 * - `wahrnehmung` (M6-35, M6-14): every creature's sight – its 120° cone out to the range it has for the player now
 *   (sight × light at the player, own light × 2, weather) – and its hearing of a walking step (radius × hearing, rain
 *   damping), coloured by what it does (calm, alarmed or investigating, hunting or attacking), its AI state beside it.
 * - `pfade` (M6-35, M6-17): the last path every creature received from the path service (its debug log, switched on
 *   with the overlay; green found, yellow partial, red none), the step each walker heads for, and the requests
 *   still pending as a line from start to goal; beside each goal its length and who computed it (worker or simulation).
 *
 * Colours are palette colours with alpha (one palette, §2.11); labels are numbers formatted once and
 * cached, so a steady frame allocates nothing.
 */
import { PALETTE_HEX, PALETTE_RAMPS } from '../../generated/palette';
import { BALANCE } from '../../content/balance';
import type { AiState } from '../../game/creatures/state';
import { hearingRadiusTiles, sightRangeTiles } from '../../game/creatures/formulas';
import { CREATURES_SYSTEM_ID, CreatureSystem } from '../../game/creatures/system';
import { insideZone, worldCreatureZone, type CreatureZone } from '../../game/creatures/zone';
import { HearthSystem } from '../../game/hearth/system';
import { LightSystem } from '../../game/light/system';
import { PlayerSystem } from '../../game/player/system';
import type { Simulation } from '../../game/sim';
import { createWeatherSample } from '../../world/climate/weather';
import { NO_WEATHER_REGION } from '../../world/climate/temperature';
import type { PathDebugPath } from '../../world/path/log';
import type { PathTicket } from '../../world/path/types';
import type { Translate } from '../errorOverlay';
import { CircleCache } from '../game/combatFeedback';
import type { TemperatureField } from '../../world/climate/temperature';
import {
  BLOCK_DEEP_WATER,
  BLOCK_HAZARD,
  BLOCK_OBJECT,
  BLOCK_SOLID,
  BLOCK_VOID,
  BLOCK_WALL,
  CollisionGrid,
  infoCategories,
  infoConnector,
} from '../../world/collision';
import type { ChunkData } from '../../world/model/chunk';
import { CHUNK_AREA, CHUNK_MASK, CHUNK_SHIFT, packChunkId, type Layer } from '../../world/model/coords';
import { WORLD_OVERLAYS, type DebugOverlayList, type WorldOverlay } from '../debugOverlay';
import { paletteRefHex } from '../palette/rows';
import { rgbaFromHex } from '../text/textBatch';
import { CHUNK_PX, CHUNK_TILES, TILE_PX } from '../tilemap/chunk';

/** Opacity of the overlay fills (0–255): the world stays readable underneath. */
const FILL_ALPHA = 0.42 * 255;
/** Opacity of the chunk state tint (a hint of colour over the whole chunk). */
const TINT_ALPHA = 0.2 * 255;
/** Chunk border width [px]. */
const BORDER_PX = 1;
/** Label inset from the chunk corner [px]. */
const LABEL_INSET = 3;

function color(ref: string, alpha = 255): number {
  return rgbaFromHex(paletteRefHex(ref, PALETTE_RAMPS, PALETTE_HEX), Math.round(alpha));
}

/** Chunk states and their colours (border opaque, tint faint). */
const CHUNK_STATE = {
  aktiv: { border: color('gras.5'), tint: color('gras.4', TINT_ALPHA) },
  eingefroren: { border: color('wasser.4'), tint: color('wasser.3', TINT_ALPHA) },
  laedt: { border: color('sand.4'), tint: color('sand.3', TINT_ALPHA) },
  fehlt: { border: color('feuer.2'), tint: color('feuer.1', TINT_ALPHA) },
} as const;
const CHUNK_LABEL = color('eis.4');

/** Collision categories in priority order (a tile with several shows the first) and their colours. */
const COLLISION_COLORS: ReadonlyArray<readonly [number, number]> = [
  [BLOCK_VOID, color('nacht.0', FILL_ALPHA)],
  [BLOCK_WALL, color('verderb.3', FILL_ALPHA)],
  [BLOCK_SOLID, color('stein.4', FILL_ALPHA)],
  [BLOCK_DEEP_WATER, color('wasser.2', FILL_ALPHA)],
  [BLOCK_HAZARD, color('feuer.3', FILL_ALPHA)],
  [BLOCK_OBJECT, color('holz.4', FILL_ALPHA)],
];
/** Ramp and stair tiles (connectors between levels): a small marker in the tile centre. */
const CONNECTOR_COLOR = color('gras.5', 0.8 * 255);
const CONNECTOR_INSET = 5;

/** Temperature bands: lower edge of the first band, band width [°C] and one palette colour per band (cold → hot). */
export const TEMPERATURE_BANDS = {
  fromC: -35,
  widthC: 5,
  colors: ['wasser.0', 'wasser.1', 'wasser.2', 'wasser.3', 'eis.2', 'eis.4', 'gras.4', 'gras.5', 'sand.3', 'feuer.4', 'feuer.3', 'feuer.2', 'feuer.1'].map((ref) => color(ref, FILL_ALPHA)),
} as const;
const TEMPERATURE_LABEL = color('eis.4');
/** A temperature label every this many tiles (aligned to the world grid). */
const TEMPERATURE_LABEL_STEP = 8;
/** Range of the cached temperature labels [°C] (values outside are clamped to the ends). */
const LABEL_MIN_C = -60;
const LABEL_MAX_C = 99;
const TEMPERATURE_LABELS: readonly string[] = Array.from({ length: LABEL_MAX_C - LABEL_MIN_C + 1 }, (_, i) => `${i + LABEL_MIN_C}°`);

/** Band index of a temperature. */
export function temperatureBand(c: number): number {
  const b = Math.floor((c - TEMPERATURE_BANDS.fromC) / TEMPERATURE_BANDS.widthC) + 1;
  return b < 0 ? 0 : b >= TEMPERATURE_BANDS.colors.length ? TEMPERATURE_BANDS.colors.length - 1 : b;
}

/** The label of a temperature (rounded to whole °C; cached strings). */
export function temperatureLabel(c: number): string {
  const r = Math.round(c);
  const i = (r < LABEL_MIN_C ? LABEL_MIN_C : r > LABEL_MAX_C ? LABEL_MAX_C : r) - LABEL_MIN_C;
  return TEMPERATURE_LABELS[i] as string;
}

/** Where the overlays read the world. */
export interface OverlayWorld {
  /** The simulation (the creature overlays read its creatures, light, hearths and paths); none: no creature overlays. */
  readonly sim?: Simulation | null;
  /** Texts in the page's language (legends of the creature overlays); keys shown raw without it. */
  readonly t?: Translate | null;
  readonly layer: Layer;
  readonly worldTiles: number;
  get(layer: Layer, cx: number, cy: number): ChunkData | undefined;
  /** Whether a load job for the chunk is running. */
  isLoading(layer: Layer, cx: number, cy: number): boolean;
  /** Whether the active zone ticks the chunk. */
  isActive(layer: Layer, cx: number, cy: number): boolean;
  /** The temperature field (null: no temperature overlay). */
  readonly temperature: TemperatureField | null;
}

/** The view rectangle [world px]. */
export interface OverlayView {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Counters of the last frame (`worldView`, tests). */
export interface OverlayStats {
  chunks: number;
  collisionTiles: number;
  temperatureTiles: number;
  /** Tiles of the spawn ring where shadow brood may appear, and those a burning hearth keeps free (`spawnzonen`). */
  spawnTiles: number;
  spawnBlockedTiles: number;
  /** Creatures whose sight and hearing are drawn (`wahrnehmung`). */
  perceived: number;
  /** Paths of the debug log and pending requests drawn (`pfade`). */
  paths: number;
  pendingPaths: number;
}

export class WorldOverlays {
  readonly enabled: Record<WorldOverlay, boolean> = { chunks: false, kollision: false, temperatur: false, spawnzonen: false, wahrnehmung: false, pfade: false };
  readonly stats: OverlayStats = { chunks: 0, collisionTiles: 0, temperatureTiles: 0, spawnTiles: 0, spawnBlockedTiles: 0, perceived: 0, paths: 0, pendingPaths: 0 };
  /** The creature overlays (M6-35). */
  private readonly creatures = new CreatureOverlays();
  private grid: CollisionGrid | null = null;
  private gridTiles = 0;
  private info = new Uint16Array(0);
  private readonly temperatures = new Float32Array(CHUNK_AREA);
  /** Chunk labels by packed chunk id (created once per chunk). */
  private readonly chunkLabels = new Map<number, string>();
  private world: OverlayWorld | null = null;
  private readonly source = { get: (layer: Layer, cx: number, cy: number): ChunkData | undefined => this.world?.get(layer, cx, cy) };

  /** Whether any overlay is on. */
  get any(): boolean {
    for (const o of WORLD_OVERLAYS) if (this.enabled[o]) return true;
    return false;
  }

  /**
   * A frame without overlays (and the start of every frame with them): the counters to zero, the path log of `sim` on
   * only while `pfade` shows – it runs from the first frame its overlay shows until the overlay is switched off or the
   * simulation changes (debug data: neither saved nor hashed).
   */
  idle(sim: Simulation | null): void {
    const s = this.stats;
    s.chunks = 0;
    s.collisionTiles = 0;
    s.temperatureTiles = 0;
    s.spawnTiles = 0;
    s.spawnBlockedTiles = 0;
    s.perceived = 0;
    s.paths = 0;
    s.pendingPaths = 0;
    this.creatures.logPaths(sim, this.enabled.pfade);
  }

  /** Fills `list` with the enabled overlays for `view` of `world`. */
  fill(list: DebugOverlayList, view: OverlayView, world: OverlayWorld): void {
    this.idle(world.sim ?? null);
    if (!this.any) return;
    this.world = world;
    const cx0 = Math.floor(view.left / CHUNK_PX);
    const cx1 = Math.floor((view.right - 1) / CHUNK_PX);
    const cy0 = Math.floor(view.top / CHUNK_PX);
    const cy1 = Math.floor((view.bottom - 1) / CHUNK_PX);
    const tx0 = Math.floor(view.left / TILE_PX);
    const ty0 = Math.floor(view.top / TILE_PX);
    const tx1 = Math.floor((view.right - 1) / TILE_PX);
    const ty1 = Math.floor((view.bottom - 1) / TILE_PX);
    if (this.enabled.temperatur && world.temperature !== null) this.temperatureOverlay(list, world, world.temperature, cx0, cy0, cx1, cy1, tx0, ty0, tx1, ty1);
    if (this.enabled.kollision) this.collisionOverlay(list, world, tx0, ty0, tx1, ty1);
    if (this.enabled.chunks) this.chunkOverlay(list, world, view, cx0, cy0, cx1, cy1);
    const sim = world.sim ?? null;
    if (sim !== null && (this.enabled.spawnzonen || this.enabled.wahrnehmung || this.enabled.pfade)) {
      this.creatures.fill(list, view, world, sim, this.gridFor(world), this.enabled, this.stats);
    }
    this.world = null;
  }

  private chunkOverlay(list: DebugOverlayList, world: OverlayWorld, view: OverlayView, cx0: number, cy0: number, cx1: number, cy1: number): void {
    const layer = world.layer;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const state =
          world.get(layer, cx, cy) === undefined
            ? world.isLoading(layer, cx, cy)
              ? CHUNK_STATE.laedt
              : CHUNK_STATE.fehlt
            : world.isActive(layer, cx, cy)
              ? CHUNK_STATE.aktiv
              : CHUNK_STATE.eingefroren;
        const x = cx * CHUNK_PX;
        const y = cy * CHUNK_PX;
        list.rect(x, y, CHUNK_PX, CHUNK_PX, state.tint);
        list.rect(x, y, CHUNK_PX, BORDER_PX, state.border);
        list.rect(x, y, BORDER_PX, CHUNK_PX, state.border);
        // The label sits in the visible corner of the chunk (every chunk in view is named).
        list.label(Math.max(x, view.left) + LABEL_INSET, Math.max(y, view.top) + LABEL_INSET, this.chunkLabel(layer, cx, cy), CHUNK_LABEL);
        this.stats.chunks++;
      }
    }
  }

  private chunkLabel(layer: Layer, cx: number, cy: number): string {
    const id = packChunkId(layer, cx, cy);
    let label = this.chunkLabels.get(id);
    if (label === undefined) {
      label = `${cx}:${cy}`;
      this.chunkLabels.set(id, label);
    }
    return label;
  }

  /** The overlays' own collision grid of `world`'s chunks (no memo: it reads the resident chunks as they are). */
  private gridFor(world: OverlayWorld): CollisionGrid {
    if (this.grid === null || this.gridTiles !== world.worldTiles) {
      this.grid = new CollisionGrid({ chunks: this.source, worldTiles: world.worldTiles });
      this.gridTiles = world.worldTiles;
    }
    return this.grid;
  }

  private collisionOverlay(list: DebugOverlayList, world: OverlayWorld, tx0: number, ty0: number, tx1: number, ty1: number): void {
    const grid = this.gridFor(world);
    const w = tx1 - tx0 + 1;
    const h = ty1 - ty0 + 1;
    if (this.info.length < w * h) this.info = new Uint16Array(w * h);
    const info = this.info;
    grid.fillInfo(world.layer, tx0, ty0, w, h, info);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = info[y * w + x] as number;
        const cats = infoCategories(v);
        const px = (tx0 + x) * TILE_PX;
        const py = (ty0 + y) * TILE_PX;
        if (cats !== 0) {
          for (let k = 0; k < COLLISION_COLORS.length; k++) {
            const entry = COLLISION_COLORS[k] as readonly [number, number];
            if ((cats & entry[0]) === 0) continue;
            list.rect(px, py, TILE_PX, TILE_PX, entry[1]);
            this.stats.collisionTiles++;
            break;
          }
        } else if (infoConnector(v)) {
          list.rect(px + CONNECTOR_INSET, py + CONNECTOR_INSET, TILE_PX - 2 * CONNECTOR_INSET, TILE_PX - 2 * CONNECTOR_INSET, CONNECTOR_COLOR);
        }
      }
    }
  }

  private temperatureOverlay(
    list: DebugOverlayList,
    world: OverlayWorld,
    field: TemperatureField,
    cx0: number,
    cy0: number,
    cx1: number,
    cy1: number,
    tx0: number,
    ty0: number,
    tx1: number,
    ty1: number,
  ): void {
    const t = this.temperatures;
    const colors = TEMPERATURE_BANDS.colors;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = world.get(world.layer, cx, cy);
        if (chunk === undefined) continue;
        field.fillChunk(chunk, t);
        const bx = cx * CHUNK_TILES;
        const by = cy * CHUNK_TILES;
        const lx0 = Math.max(tx0, bx) - bx;
        const lx1 = Math.min(tx1, bx + CHUNK_MASK) - bx;
        const ly0 = Math.max(ty0, by) - by;
        const ly1 = Math.min(ty1, by + CHUNK_MASK) - by;
        for (let ly = ly0; ly <= ly1; ly++) {
          for (let lx = lx0; lx <= lx1; lx++) {
            const c = t[(ly << CHUNK_SHIFT) | lx] as number;
            list.rect((bx + lx) * TILE_PX, (by + ly) * TILE_PX, TILE_PX, TILE_PX, colors[temperatureBand(c)] as number);
            this.stats.temperatureTiles++;
          }
        }
        for (let ly = ly0; ly <= ly1; ly++) {
          if ((by + ly) % TEMPERATURE_LABEL_STEP !== TEMPERATURE_LABEL_STEP / 2) continue;
          for (let lx = lx0; lx <= lx1; lx++) {
            if ((bx + lx) % TEMPERATURE_LABEL_STEP !== TEMPERATURE_LABEL_STEP / 2) continue;
            list.label((bx + lx) * TILE_PX, (by + ly) * TILE_PX, temperatureLabel(t[(ly << CHUNK_SHIFT) | lx] as number), TEMPERATURE_LABEL);
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Creature overlays (M6-35)
// ---------------------------------------------------------------------------------------------

/** Spawn ring: allowed tiles (the violet of the shadow brood), tiles a hearth keeps free, the ring's edges. */
/** A chunk's stock label needs this much of the chunk in view [px] (a label is ≈ 60 × 10 px at the internal size). */
const STOCK_LABEL_MIN_PX = { w: 64, h: 16 } as const;
const SPAWN_COLORS = { allowed: color('verderb.3', FILL_ALPHA), hearth: color('feuer.3', TINT_ALPHA * 2), edge: color('verderb.4'), label: color('eis.4'), stock: color('gras.5') } as const;
/** Perception by what the creature does: calm, alarmed or investigating, hunting or attacking; hearing fainter. */
const SENSE_COLORS = { ruhig: color('gras.5'), wachsam: color('sand.4'), jagd: color('feuer.3'), hearing: color('wasser.4', 0.6 * 255), label: color('eis.4') } as const;
const HUNTING: ReadonlySet<AiState> = new Set<AiState>(['jagen', 'angreifen', 'umkreisen']);
const ALERT: ReadonlySet<AiState> = new Set<AiState>(['untersuchen', 'fliehen', 'rueckzug']);
/** Paths by status, pending requests, the step a walker heads for. */
const PATH_COLORS = { found: color('gras.5'), partial: color('sand.4'), none: color('feuer.2'), pending: color('stein.4', 0.7 * 255), next: color('eis.4'), label: color('eis.4') } as const;
/** A path tile is a square this big in the tile's middle [px]; a pending line a dot every this many px. */
const PATH_DOT_PX = 4;
const PENDING_STEP_PX = 4;
/** The ring's edges and the cones are dotted: one pixel lit of every this many along them. */
const EDGE_EVERY = 2;
/** Cone edges and arcs: step along them [px]. */
const CONE_STEP_PX = 3;
/** Labels sit this far beside what they name [px]. */
const LABEL_OFFSET_PX = 6;
/** Labels of path lengths are cached up to this many steps. */
const MAX_PATH_LABEL = 4096;

type PathColor = keyof typeof PATH_COLORS;

class CreatureOverlays {
  private readonly circles = new CircleCache();
  private zoneFor: { readonly sim: Simulation; readonly zone: CreatureZone } | null = null;
  private systems: { readonly sim: Simulation; readonly creatures: CreatureSystem | null; readonly light: LightSystem | null; readonly hearth: HearthSystem | null; readonly player: PlayerSystem | null } | null = null;
  private logging: CreatureSystem | null = null;
  private readonly weather = createWeatherSample();
  private readonly at = { x: 0, y: 0 };
  /** Translated texts (legends, AI states) of the language they were made in, and path labels. */
  private texts = new Map<string, string>();
  private textsFor: Translate | null = null;
  private readonly pathLabels = new Map<number, string>();
  private readonly stockLabels: string[] = [];
  // The frame's target of the visitors (bound once: passing them allocates nothing).
  private list: DebugOverlayList | null = null;
  private view: OverlayView | null = null;
  private layer: Layer = 0;
  private stats: OverlayStats | null = null;
  private readonly visitPath = (p: PathDebugPath): void => this.drawPath(p);
  private readonly visitPending = (_t: PathTicket, layer: Layer, fx: number, fy: number, tx: number, ty: number): void => this.drawPending(layer, fx, fy, tx, ty);

  /** Switches the path log of `sim`'s path service on while `on` (and off again). */
  logPaths(sim: Simulation | null, on: boolean): void {
    const creatures = sim === null ? null : this.systemsOf(sim).creatures;
    const want = on ? creatures : null;
    if (want === this.logging) return;
    this.logging?.paths.setDebug(false);
    want?.paths.setDebug(true);
    this.logging = want;
  }

  fill(list: DebugOverlayList, view: OverlayView, world: OverlayWorld, sim: Simulation, grid: CollisionGrid, enabled: Readonly<Record<WorldOverlay, boolean>>, stats: OverlayStats): void {
    this.bindTexts(world.t ?? null);
    const sys = this.systemsOf(sim);
    this.list = list;
    this.view = view;
    this.layer = world.layer;
    this.stats = stats;
    if (enabled.spawnzonen) this.spawnZones(list, view, world, sim, grid);
    if (enabled.wahrnehmung && sys.creatures !== null) this.perception(list, view, sim, sys.creatures);
    if (enabled.pfade && sys.creatures !== null) this.paths(sys.creatures);
    this.list = null;
    this.view = null;
    this.stats = null;
  }

  // --- spawn zones ---------------------------------------------------------------------------

  private spawnZones(list: DebugOverlayList, view: OverlayView, world: OverlayWorld, sim: Simulation, grid: CollisionGrid): void {
    const sys = this.systemsOf(sim);
    const stats = this.stats as OverlayStats;
    const layer = world.layer;
    if (sys.player !== null && sys.player.position(sim, this.at) && sys.player.body(sim)?.layer === layer) {
      const px = this.at.x;
      const py = this.at.y;
      const SB = BALANCE.spawn.shadowBrood;
      const lo = SB.minTiles * TILE_PX;
      const hi = SB.maxTiles * TILE_PX;
      const zone = this.zoneOf(sim);
      const map = sys.light === null ? null : sys.light.mapFor(sim);
      const tx0 = Math.floor(Math.max(view.left, px - hi) / TILE_PX);
      const tx1 = Math.floor((Math.min(view.right, px + hi) - 1) / TILE_PX);
      const ty0 = Math.floor(Math.max(view.top, py - hi) / TILE_PX);
      const ty1 = Math.floor((Math.min(view.bottom, py + hi) - 1) / TILE_PX);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const x = (tx + 1 / 2) * TILE_PX;
          const y = (ty + 1 / 2) * TILE_PX;
          const dx = x - px;
          const dy = y - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < lo * lo || d2 > hi * hi || !insideZone(zone, layer, x, y) || !grid.openAt(layer, tx, ty)) continue;
          if (map !== null && map.tileLevel(layer, tx, ty) >= SB.maxLight) continue;
          if (sys.hearth !== null && sys.hearth.spawnBlocked(sim, layer, x, y)) {
            list.rect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX, SPAWN_COLORS.hearth);
            stats.spawnBlockedTiles++;
            continue;
          }
          list.rect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX, SPAWN_COLORS.allowed);
          stats.spawnTiles++;
        }
      }
      this.dottedCircle(list, view, px, py, lo, SPAWN_COLORS.edge);
      this.dottedCircle(list, view, px, py, hi, SPAWN_COLORS.edge);
      list.label(px + LABEL_OFFSET_PX, py + LABEL_OFFSET_PX, this.text('debug.overlay.spawnzonen.ring', { von: SB.minTiles, bis: SB.maxTiles }), SPAWN_COLORS.label);
    }
    // Wild animals at home on each active chunk in view.
    const creatures = sys.creatures;
    if (creatures === null) return;
    const cx0 = Math.floor(view.left / CHUNK_PX);
    const cx1 = Math.floor((view.right - 1) / CHUNK_PX);
    const cy0 = Math.floor(view.top / CHUNK_PX);
    const cy1 = Math.floor((view.bottom - 1) / CHUNK_PX);
    for (let cy = cy0; cy <= cy1; cy++) {
      // The label stands in the chunk's visible part, bottom left – not for a sliver too small to hold it.
      const bottom = Math.min((cy + 1) * CHUNK_PX, view.bottom);
      if (bottom - Math.max(cy * CHUNK_PX, view.top) < STOCK_LABEL_MIN_PX.h) continue;
      for (let cx = cx0; cx <= cx1; cx++) {
        const left = Math.max(cx * CHUNK_PX, view.left);
        if (Math.min((cx + 1) * CHUNK_PX, view.right) - left < STOCK_LABEL_MIN_PX.w || !world.isActive(layer, cx, cy)) continue;
        let n = 0;
        for (let i = 0; i < creatures.store.size; i++) {
          const c = creatures.store.valueAt(i);
          if (c.layer === layer && c.homeCx === cx && c.homeCy === cy && !(creatures.catalog.find(c.creature)?.shadow ?? false)) n++;
        }
        list.label(left + LABEL_INSET, bottom - LABEL_INSET * 4, this.stockLabel(n), SPAWN_COLORS.stock);
      }
    }
  }

  // --- perception ----------------------------------------------------------------------------

  private perception(list: DebugOverlayList, view: OverlayView, sim: Simulation, creatures: CreatureSystem): void {
    const sys = this.systemsOf(sim);
    const stats = this.stats as OverlayStats;
    const layer = this.layer;
    // What the sight depends on: the light at the player, a light it carries, the weather over it.
    let level = 1;
    let lit = false;
    let haze = 0;
    let precipitation = 0;
    if (sys.player !== null && sys.player.position(sim, this.at)) {
      if (sys.light !== null) {
        level = sys.light.levelAt(sim, layer, this.at.x, this.at.y);
        const sources = sys.light.sources(sim);
        for (let i = 0; i < sources.length; i++) {
          const mount = sources[i]?.mount;
          if (mount === 'hand' || mount === 'guertel') lit = true;
        }
      }
      if (layer === 0 && sim.world.materialized) {
        const region = sim.world.regionAt(Math.floor(this.at.x / TILE_PX), Math.floor(this.at.y / TILE_PX));
        if (region !== NO_WEATHER_REGION) {
          const w = sim.world.weather.sample(region, this.weather);
          haze = w.haze;
          precipitation = w.precipitation;
        }
      }
    }
    const cosHalf = Math.cos((BALANCE.ai.perception.coneDeg * Math.PI) / 360);
    const half = Math.acos(cosHalf);
    for (let i = 0; i < creatures.store.size; i++) {
      const s = creatures.store.valueAt(i);
      if (s.layer !== layer || !creatures.positionOf(creatures.store.entityAt(i), this.at)) continue;
      const x = this.at.x;
      const y = this.at.y;
      const kind = creatures.catalog.find(s.creature);
      if (kind === undefined) continue;
      const sight = sightRangeTiles(kind.profile.sicht, level, lit, haze, precipitation) * TILE_PX;
      const hearing = hearingRadiusTiles(BALANCE.ai.noise.step, kind.profile.gehoer, precipitation) * TILE_PX;
      if (x + Math.max(sight, hearing) < view.left || x - Math.max(sight, hearing) > view.right || y + Math.max(sight, hearing) < view.top || y - Math.max(sight, hearing) > view.bottom) continue;
      const col = HUNTING.has(s.state) ? SENSE_COLORS.jagd : ALERT.has(s.state) || s.alarmedUntilTick >= sim.tick ? SENSE_COLORS.wachsam : SENSE_COLORS.ruhig;
      // The cone: both edges and the arc at the range.
      for (let side = -1; side <= 1; side += 2) {
        const a = s.facing + side * half;
        for (let r = 0; r <= sight; r += CONE_STEP_PX) this.dot(list, view, x + Math.cos(a) * r, y + Math.sin(a) * r, col);
      }
      const steps = Math.max(2, Math.ceil((2 * half * sight) / CONE_STEP_PX));
      for (let k = 0; k <= steps; k++) {
        const a = s.facing - half + (2 * half * k) / steps;
        this.dot(list, view, x + Math.cos(a) * sight, y + Math.sin(a) * sight, col);
      }
      if (hearing > 0) this.dottedCircle(list, view, x, y, hearing, SENSE_COLORS.hearing);
      list.label(x + LABEL_OFFSET_PX, y - LABEL_OFFSET_PX, this.text(`debug.overlay.ki.${s.state}`), SENSE_COLORS.label);
      stats.perceived++;
    }
  }

  // --- paths ---------------------------------------------------------------------------------

  private paths(creatures: CreatureSystem): void {
    creatures.paths.forEachDebugPath(this.visitPath);
    creatures.paths.forEachPending(this.visitPending);
    // The step every walker heads for now.
    const list = this.list as DebugOverlayList;
    for (let i = 0; i < creatures.store.size; i++) {
      const s = creatures.store.valueAt(i);
      if (s.layer !== this.layer || s.pathIndex < 0 || s.pathIndex * 2 + 1 >= s.path.length) continue;
      const tx = s.path[s.pathIndex * 2] as number;
      const ty = s.path[s.pathIndex * 2 + 1] as number;
      list.rect(tx * TILE_PX + (TILE_PX - PATH_DOT_PX) / 2 - 1, ty * TILE_PX + (TILE_PX - PATH_DOT_PX) / 2 - 1, PATH_DOT_PX + 2, PATH_DOT_PX + 2, PATH_COLORS.next);
    }
  }

  private drawPath(p: PathDebugPath): void {
    const list = this.list;
    const view = this.view;
    if (list === null || view === null || p.layer !== this.layer) return;
    const col: PathColor = p.status === 'found' ? 'found' : p.status === 'partial' ? 'partial' : 'none';
    const c = PATH_COLORS[col];
    for (let k = 0; k < p.steps; k++) {
      const x = (p.tiles[k * 2] as number) * TILE_PX + (TILE_PX - PATH_DOT_PX) / 2;
      const y = (p.tiles[k * 2 + 1] as number) * TILE_PX + (TILE_PX - PATH_DOT_PX) / 2;
      if (x + PATH_DOT_PX < view.left || x > view.right || y + PATH_DOT_PX < view.top || y > view.bottom) continue;
      list.rect(x, y, PATH_DOT_PX, PATH_DOT_PX, c);
    }
    const gx = p.toTx * TILE_PX;
    const gy = p.toTy * TILE_PX;
    list.rect(gx, gy, TILE_PX, 1, c);
    list.rect(gx, gy + TILE_PX - 1, TILE_PX, 1, c);
    list.rect(gx, gy, 1, TILE_PX, c);
    list.rect(gx + TILE_PX - 1, gy, 1, TILE_PX, c);
    if (gx + TILE_PX >= view.left && gx <= view.right && gy + TILE_PX >= view.top && gy <= view.bottom) list.label(gx + TILE_PX + 2, gy, this.pathLabel(p.steps, p.byWorker), PATH_COLORS.label);
    (this.stats as OverlayStats).paths++;
  }

  private drawPending(layer: Layer, fx: number, fy: number, tx: number, ty: number): void {
    const list = this.list;
    const view = this.view;
    if (list === null || view === null || layer !== this.layer) return;
    const x0 = (fx + 1 / 2) * TILE_PX;
    const y0 = (fy + 1 / 2) * TILE_PX;
    const x1 = (tx + 1 / 2) * TILE_PX;
    const y1 = (ty + 1 / 2) * TILE_PX;
    const len = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
    const steps = Math.max(1, Math.floor(len / PENDING_STEP_PX));
    for (let k = 0; k <= steps; k++) this.dot(list, view, x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps, PATH_COLORS.pending);
    (this.stats as OverlayStats).pendingPaths++;
  }

  // --- helpers -------------------------------------------------------------------------------

  /** A dotted circle of radius `r` [px] around (x, y): every `EDGE_EVERY`-th pixel of its midpoint circle in view. */
  private dottedCircle(list: DebugOverlayList, view: OverlayView, x: number, y: number, r: number, c: number): void {
    const points = this.circles.of(r);
    const cx = Math.round(x);
    const cy = Math.round(y);
    for (let k = 0; k < points.length; k += EDGE_EVERY) {
      const p = points[k] as { dx: number; dy: number };
      this.dot(list, view, cx + p.dx, cy + p.dy, c);
    }
  }

  private dot(list: DebugOverlayList, view: OverlayView, x: number, y: number, c: number): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < view.left || px >= view.right || py < view.top || py >= view.bottom) return;
    list.rect(px, py, 1, 1, c);
  }

  private systemsOf(sim: Simulation): NonNullable<CreatureOverlays['systems']> {
    const s = this.systems;
    // The lookup's closures live in `lookUpSystems`: the check that runs every frame allocates no context (§30).
    return s !== null && s.sim === sim ? s : this.lookUpSystems(sim);
  }

  private lookUpSystems(sim: Simulation): NonNullable<CreatureOverlays['systems']> {
    const find = <T>(id: string, type: abstract new (...args: never[]) => T): T | null => {
      const x = sim.systems.find((y) => y.id === id);
      return x instanceof type ? x : null;
    };
    const s = { sim, creatures: find(CREATURES_SYSTEM_ID, CreatureSystem), light: find('light', LightSystem), hearth: find('hearth', HearthSystem), player: find('player', PlayerSystem) };
    this.systems = s;
    return s;
  }

  private zoneOf(sim: Simulation): CreatureZone {
    if (this.zoneFor?.sim !== sim) this.zoneFor = { sim, zone: worldCreatureZone(sim.world) };
    return this.zoneFor.zone;
  }

  private bindTexts(t: Translate | null): void {
    if (t === this.textsFor) return;
    this.textsFor = t;
    this.texts = new Map();
    this.pathLabels.clear();
    this.stockLabels.length = 0;
  }

  /** The text of `key` (with `params`), translated once per language. */
  private text(key: string, params?: Readonly<Record<string, string | number>>): string {
    let s = this.texts.get(key);
    if (s === undefined) {
      s = this.textsFor === null ? key : this.textsFor(key, params);
      this.texts.set(key, s);
    }
    return s;
  }

  /** "12 · Worker" / "12 · Simulation": the length of a path and who computed it (cached). */
  private pathLabel(steps: number, byWorker: boolean): string {
    const k = Math.min(steps, MAX_PATH_LABEL) * 2 + (byWorker ? 1 : 0);
    let s = this.pathLabels.get(k);
    if (s === undefined) {
      s = `${Math.min(steps, MAX_PATH_LABEL)} · ${this.text(byWorker ? 'debug.overlay.pfade.worker' : 'debug.overlay.pfade.simulation')}`;
      this.pathLabels.set(k, s);
    }
    return s;
  }

  /** "Wildtiere: n" of a chunk (cached per count). */
  private stockLabel(n: number): string {
    let s = this.stockLabels[n];
    if (s === undefined) {
      s = this.textsFor === null ? `${n}` : this.textsFor('debug.overlay.spawnzonen.bestand', { anzahl: n });
      this.stockLabels[n] = s;
    }
    return s;
  }
}
