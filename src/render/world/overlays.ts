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
 *
 * Colours are palette colours with alpha (one palette, §2.11); labels are numbers formatted once and
 * cached, so a steady frame allocates nothing.
 */
import { PALETTE_HEX, PALETTE_RAMPS } from '../../generated/palette';
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
}

export class WorldOverlays {
  readonly enabled: Record<WorldOverlay, boolean> = { chunks: false, kollision: false, temperatur: false };
  readonly stats: OverlayStats = { chunks: 0, collisionTiles: 0, temperatureTiles: 0 };
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

  /** Fills `list` with the enabled overlays for `view` of `world`. */
  fill(list: DebugOverlayList, view: OverlayView, world: OverlayWorld): void {
    const s = this.stats;
    s.chunks = 0;
    s.collisionTiles = 0;
    s.temperatureTiles = 0;
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

  private collisionOverlay(list: DebugOverlayList, world: OverlayWorld, tx0: number, ty0: number, tx1: number, ty1: number): void {
    if (this.grid === null || this.gridTiles !== world.worldTiles) {
      this.grid = new CollisionGrid({ chunks: this.source, worldTiles: world.worldTiles });
      this.gridTiles = world.worldTiles;
    }
    const w = tx1 - tx0 + 1;
    const h = ty1 - ty0 + 1;
    if (this.info.length < w * h) this.info = new Uint16Array(w * h);
    const info = this.info;
    this.grid.fillInfo(world.layer, tx0, ty0, w, h, info);
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
