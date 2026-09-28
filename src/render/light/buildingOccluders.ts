/**
 * Occluders of the build grid (M5-01, M5-34): walls, closed doors and gates are structural – they stop every light,
 * like the gameplay light map's raycast through the collision overlay ("Wände und geschlossene Türen massiv und
 * lichtdicht") –, fences are decor of their height (a rail fence only at its posts). Windows let the light through,
 * open doors and blueprints stand open; windows and open doors and gates mark their footprint as an opening of the
 * wall (for the light map comparison, M5-28). Pillars and furniture bring their own footprint in the atlas manifest
 * (sprite occluders).
 *
 * The grid also casts the sun's and moon's shadows of the house (`SunCasterList`, M5-02, M5-05): walls, closed doors
 * and gates as blocks of the wall's height, windows as panes (their sprite's glass colours the light), roofs as a slab
 * from the wall top up – the same shadow from outside and from inside, where roof and front wall are faded or cut.
 *
 * Footprints follow the build parts' sprite contract (assets-src/sprites/bau/_bau.ts): a thin wall in the band
 * 5–10 px of its tile (north–south runs: 5–10 px across), its arms reaching the tile edges towards the connected
 * neighbours (`connectMask`), so a wall's pixels – standing on the tile's last row – stand just south of their
 * footprint and a light inside the room meets the band before it leaves the house.
 */
import type { Layer } from '../../world/model/coords';
import type { PartCatalog, PartDef } from '../../world/structures/catalog';
import { BUILD_LAYER_INDEX, cellBlueprint, cellCovered, cellOpen, cellPart } from '../../world/structures/cells';
import { anchorOf, connectMask, type AnchorRef } from '../../world/structures/query';
import { structureIndex, type StructureStore } from '../../world/structures/store';
import { CHUNK_SHIFT, TILE_PX } from '../../world/model/coords';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import { BUILD_PARTS, buildPartSpriteId } from '../../content/buildParts';
import type { AtlasManifest } from '../assets/atlas';
import type { OccluderList } from './occluders';
import { BUILDING_SUN, OCCLUDER_CLASS, STRUCTURAL_TOP_PX, type OccluderClass } from './params';
import { SUN_CASTER_AXIS, SUN_CASTER_KIND, type PaneSprite, type SunCasterList } from './sunCasters';

const STRUCTURE = BUILD_LAYER_INDEX.struktur;
const ROOF = BUILD_LAYER_INDEX.dach;
/** The wall band of a tile [px from its west/north edge], `_bau.ts` BAND_VON … BAND_BIS (inclusive rows 5–10). */
export const WALL_BAND = { from: 5, to: 11 } as const;
/** Rows from a wall-like sprite's anchor (the tile's last row) up to the wall's foot (the band's last row). */
export const WALL_FOOT_ABOVE_ANCHOR = TILE_PX - WALL_BAND.to;
/** Rectangles of one wall piece [world px]: the knot and up to two arms, 4 numbers each. */
const RECTS_MAX = 3;
/**
 * Fences to the point lights by material (the sprites: `assets-src/sprites/bau/zaeune.ts`): height above their ground
 * [px], and the width of the post in the tile's middle [px] – a rail fence blocks only there (its two 2-px rails let
 * the light through between the posts: a torch behind it throws the posts' shadows, not a wall's); 0: it blocks as a
 * band of the wall's footprint (the dry-stone wall).
 */
export const FENCE_OCCLUDER: Readonly<Record<string, { readonly topPx: number; readonly postPx: number }>> = {
  holz: { topPx: 12, postPx: 4 },
  stein: { topPx: 8, postPx: 0 },
};
const DEFAULT_FENCE = { topPx: 12, postPx: 4 } as const;
/** Neighbour bits of `connectMask`. */
const N = 1;
const E = 2;
const S = 4;
const W = 8;

/**
 * The footprint rectangles of a wall-like piece with neighbour mask `mask` on tile (tx, ty) [world px] into `out`
 * (x0, y0, x1, y1 per rectangle); returns how many.
 */
export function wallRects(tx: number, ty: number, mask: number, out: Float64Array): number {
  const x = tx * TILE_PX;
  const y = ty * TILE_PX;
  const a = WALL_BAND.from;
  const b = WALL_BAND.to;
  // The knot, then an arm to every connected side; an unconnected piece runs east–west (the sprites' default).
  const ew = (mask & (E | W)) !== 0 || (mask & (N | S)) === 0;
  const west = (mask & W) !== 0 || (ew && (mask & E) === 0);
  const east = (mask & E) !== 0 || (ew && (mask & W) === 0);
  out[0] = x + (west ? 0 : a);
  out[1] = y + a;
  out[2] = x + (east ? TILE_PX : b);
  out[3] = y + b;
  let n = 1;
  if ((mask & N) !== 0) n = putRect(out, n, x + a, y, x + b, y + a);
  if ((mask & S) !== 0) n = putRect(out, n, x + a, y + b, x + b, y + TILE_PX);
  return n;
}

function putRect(out: Float64Array, n: number, x0: number, y0: number, x1: number, y1: number): number {
  out[n * 4] = x0;
  out[n * 4 + 1] = y0;
  out[n * 4 + 2] = x1;
  out[n * 4 + 3] = y1;
  return n + 1;
}

/** Whether a door, window or gate stands in a north–south wall (render/game/building.ts `inSideWall`). */
export function inSideWall(mask: number): boolean {
  return (mask & (E | W)) === 0 && (mask & (N | S)) !== 0;
}

const FOOTPRINT = new Float64Array(RECTS_MAX * 4);

/** The footprint rectangles of a wall-like piece with neighbour mask `mask` on tile (tx, ty) [world px] into `out`. */
export function wallFootprint(tx: number, ty: number, mask: number, top: number, cls: OccluderClass, out: OccluderList): void {
  const n = wallRects(tx, ty, mask, FOOTPRINT);
  for (let i = 0; i < n; i++) out.rect(FOOTPRINT[i * 4] ?? 0, FOOTPRINT[i * 4 + 1] ?? 0, FOOTPRINT[i * 4 + 2] ?? 0, FOOTPRINT[i * 4 + 3] ?? 0, top, cls);
}

/** Pane sprites of the windows (their front view, frame 0) by part id, read from an atlas manifest. */
export class PaneSprites {
  private manifest: AtlasManifest | null = null;
  private readonly byPart = new Map<string, PaneSprite>();

  /** Reads the windows of `manifest` (no-op for the same manifest). */
  bind(manifest: AtlasManifest): void {
    if (this.manifest === manifest) return;
    this.manifest = manifest;
    this.byPart.clear();
    for (const p of BUILD_PARTS) {
      if (p.art !== 'fenster') continue;
      const sprite = manifest.sprites[buildPartSpriteId(p.id, p.art)];
      const f = sprite?.frames[0];
      if (f === undefined) continue;
      // The anchor column stands on the tile's middle; the foot's lower edge is the band's last row's lower edge.
      this.byPart.set(p.id, { x: f.x, y: f.y, w: f.w, h: f.h, ax: f.ax, footRow: f.ay + 1 - WALL_FOOT_ABOVE_ANCHOR, row: 0 });
    }
  }

  get(partId: string): PaneSprite | undefined {
    return this.byPart.get(partId);
  }
}

/** Collects the build grid's occluders of `layer` in the tile rectangle [tx0, tx1] × [ty0, ty1]. */
export class BuildingOccluders {
  private readonly anchor: AnchorRef = { tx: 0, ty: 0, cell: 0 };
  private readonly rects = new Float64Array(RECTS_MAX * 4);

  /**
   * Adds the pieces' footprints to `out` and – with `sun` – their sun casters (windows with their pane sprite from
   * `panes`, without one as open frames); returns the pieces with a footprint in the mask (openings included).
   */
  collect(
    store: StructureStore,
    catalog: PartCatalog,
    layer: Layer,
    tx0: number,
    ty0: number,
    tx1: number,
    ty1: number,
    levelAt: (tx: number, ty: number) => number,
    out: OccluderList,
    sun: SunCasterList | null = null,
    panes: PaneSprites | null = null,
  ): number {
    let n = 0;
    const size = 1 << CHUNK_SHIFT;
    for (let cy = ty0 >> CHUNK_SHIFT; cy <= ty1 >> CHUNK_SHIFT; cy++) {
      for (let cx = tx0 >> CHUNK_SHIFT; cx <= tx1 >> CHUNK_SHIFT; cx++) {
        const chunk = store.chunk(layer, cx, cy);
        if (chunk === undefined) continue;
        const ya = Math.max(ty0, cy * size);
        const yb = Math.min(ty1, cy * size + size - 1);
        const xa = Math.max(tx0, cx * size);
        const xb = Math.min(tx1, cx * size + size - 1);
        for (let ty = ya; ty <= yb; ty++) {
          for (let tx = xa; tx <= xb; tx++) {
            const cell = chunk.cells[structureIndex(STRUCTURE, tx, ty)] as number;
            if (cell !== 0) n += this.piece(store, catalog, layer, cell, tx, ty, levelAt, out, sun, panes);
            const roof = chunk.cells[structureIndex(ROOF, tx, ty)] as number;
            if (roof !== 0) this.roof(store, catalog, layer, roof, tx, ty, levelAt, out, sun);
          }
        }
      }
    }
    return n;
  }

  private piece(
    store: StructureStore,
    catalog: PartCatalog,
    layer: Layer,
    cell: number,
    tx: number,
    ty: number,
    levelAt: (tx: number, ty: number) => number,
    out: OccluderList,
    sun: SunCasterList | null,
    panes: PaneSprites | null,
  ): number {
    // A covered tile (the second tile of a gate) takes the state of its anchor.
    let anchorCell = cell;
    if (cellCovered(cell)) {
      if (!anchorOf(store, layer, STRUCTURE, tx, ty, this.anchor)) return 0;
      anchorCell = this.anchor.cell;
    }
    if (cellBlueprint(anchorCell)) return 0;
    const part: PartDef | undefined = catalog.byRuntimeId(cellPart(anchorCell));
    if (part === undefined) return 0;
    const base = levelAt(tx, ty) * WAND_PX_JE_STUFE;
    switch (part.kind) {
      case 'wand': {
        const mask = connectMask(store, catalog, layer, STRUCTURE, tx, ty);
        wallFootprint(tx, ty, mask, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural, out);
        if (sun !== null) this.wallSun(tx, ty, mask, base, sun);
        return 1;
      }
      case 'tuer':
      case 'tor': {
        const mask = connectMask(store, catalog, layer, STRUCTURE, tx, ty);
        // Open: a doorway – no blocker, the mark of an opening for the light map comparison.
        if (cellOpen(anchorCell)) {
          wallFootprint(tx, ty, mask, 0, OCCLUDER_CLASS.opening, out);
          return 1;
        }
        wallFootprint(tx, ty, mask, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.structural, out);
        if (sun !== null) this.wallSun(tx, ty, mask, base, sun);
        return 1;
      }
      case 'fenster': {
        // Glass lets the light through: the window is an opening of its wall (a mark, no blocker).
        const mask = connectMask(store, catalog, layer, STRUCTURE, tx, ty);
        wallFootprint(tx, ty, mask, 0, OCCLUDER_CLASS.opening, out);
        if (sun === null) return 1;
        const pane = panes?.get(part.id);
        const n = wallRects(tx, ty, mask, this.rects);
        const r = this.rects;
        const side = inSideWall(mask);
        for (let i = 0; i < n; i++) {
          const x0 = r[i * 4] ?? 0;
          const y0 = r[i * 4 + 1] ?? 0;
          const x1 = r[i * 4 + 2] ?? 0;
          const y1 = r[i * 4 + 3] ?? 0;
          if (pane === undefined) sun.block(x0, y0, x1, y1, base, base + BUILDING_SUN.wallTopPx);
          else sun.pane(x0, y0, x1, y1, base, base + BUILDING_SUN.wallTopPx, side ? SUN_CASTER_AXIS.y : SUN_CASTER_AXIS.x, (side ? ty : tx) * TILE_PX + TILE_PX / 2 - pane.ax, pane);
        }
        return 1;
      }
      case 'zaun': {
        const fence = FENCE_OCCLUDER[part.material] ?? DEFAULT_FENCE;
        const top = base + fence.topPx;
        if (fence.postPx > 0) {
          // The post: square, in the tile's middle, its foot on the band's last row.
          const x0 = tx * TILE_PX + (TILE_PX - fence.postPx) / 2;
          const y1 = ty * TILE_PX + WALL_BAND.to;
          out.rect(x0, y1 - fence.postPx, x0 + fence.postPx, y1, top, OCCLUDER_CLASS.decor);
        } else wallFootprint(tx, ty, connectMask(store, catalog, layer, STRUCTURE, tx, ty), top, OCCLUDER_CLASS.decor, out);
        return 1;
      }
      default:
        return 0;
    }
  }

  /** The sun caster of a wall, closed door or gate: its footprint as a block of the wall's height. */
  private wallSun(tx: number, ty: number, mask: number, base: number, sun: SunCasterList): void {
    const n = wallRects(tx, ty, mask, this.rects);
    const r = this.rects;
    for (let i = 0; i < n; i++) sun.block(r[i * 4] ?? 0, r[i * 4 + 1] ?? 0, r[i * 4 + 2] ?? 0, r[i * 4 + 3] ?? 0, base, base + BUILDING_SUN.wallTopPx);
  }

  /**
   * A roof tile: the cover of the point-light mask, and a sun caster – a slab over the tile from the wall top up, its
   * open sides ending at the eave (glass lets the sun through).
   */
  private roof(
    store: StructureStore,
    catalog: PartCatalog,
    layer: Layer,
    cell: number,
    tx: number,
    ty: number,
    levelAt: (tx: number, ty: number) => number,
    out: OccluderList,
    sun: SunCasterList | null,
  ): void {
    let anchorCell = cell;
    if (cellCovered(cell)) {
      if (!anchorOf(store, layer, ROOF, tx, ty, this.anchor)) return;
      anchorCell = this.anchor.cell;
    }
    if (cellBlueprint(anchorCell)) return;
    const part: PartDef | undefined = catalog.byRuntimeId(cellPart(anchorCell));
    if (part === undefined || part.kind !== 'dach') return;
    // Roofs lie on the wall tiles too; an open side ends with its eave just beyond the wall band (`_bau.ts`).
    const mask = connectMask(store, catalog, layer, ROOF, tx, ty);
    const x = tx * TILE_PX;
    const y = ty * TILE_PX;
    const eave = BUILDING_SUN.eavePx;
    const x0 = (mask & W) !== 0 ? x : x + WALL_BAND.from - eave;
    const x1 = (mask & E) !== 0 ? x + TILE_PX : x + WALL_BAND.to + eave;
    const y0 = (mask & N) !== 0 ? y : y + WALL_BAND.from - eave;
    const y1 = (mask & S) !== 0 ? y + TILE_PX : y + WALL_BAND.to + eave;
    // The cover: a light under a roof does not light the outside of roofs and crowns, the sky reaches the floor under it
    // only in part (the composition).
    out.rect(x0, y0, x1, y1, STRUCTURAL_TOP_PX, OCCLUDER_CLASS.roof);
    if (sun === null) return;
    const base = levelAt(tx, ty) * WAND_PX_JE_STUFE;
    const kind = part.material === 'glas' ? SUN_CASTER_KIND.clearGlass : SUN_CASTER_KIND.opaque;
    sun.block(x0, y0, x1, y1, base + BUILDING_SUN.roofBottomPx, base + BUILDING_SUN.roofTopPx, kind);
  }
}
