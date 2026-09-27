/**
 * Read access to the structure layers for the systems and the renderer (M4-11): anchors of multi-tile parts,
 * the collision overlay of the built structures (src/world/collision/tiles.ts `CollisionOverlay`), the
 * neighbour masks of the modular sprites and the directions of stairs.
 *
 * - **Collision** (`StructureCollisionOverlay`): walls and closed doors and gates are solid (they stop movers
 *   and light), windows, pillars, fences and standing furniture are objects (they stop walkers and
 *   projectiles, not light), an open trapdoor is a hole, a jetty bridges the water under it (§16.1 "Wasserbauten
 *   … auf Pfählen"), stairs join their tile and the tile they lead up to (a cliff face under them no longer
 *   blocks). Blueprints do not collide.
 * - **Neighbour mask** (`connectMask`, the contract of the build part sprites, assets-src/sprites/bau/_bau.ts):
 *   north 1, east 2, south 4, west 8 when the neighbour carries a connecting part – walls with walls, doors,
 *   gates and windows; fences with fences and gates; roofs with roofs, floors with floors, jetties with jetties.
 */
import type { PartKind } from '../../content/buildParts';
import { OVERLAY_CONNECTOR, type CollisionOverlay } from '../collision/tiles';
import type { Layer } from '../model/coords';
import type { PartCatalog, PartDef } from './catalog';
import { BUILD_LAYER_INDEX, cellBlueprint, cellCovered, cellDx, cellDy, cellOpen, cellPart, cellRot } from './cells';
import type { StructureStore } from './store';

const FLOOR = BUILD_LAYER_INDEX.boden;
const STRUCTURE = BUILD_LAYER_INDEX.struktur;
const OBJECT = BUILD_LAYER_INDEX.objekt;

/** Direction of each rotation [tile step]: 0 north, 1 east, 2 south, 3 west (stairs lead up this way, wall objects face the opposite). */
export const ROT_DX: readonly number[] = [0, 1, 0, -1];
export const ROT_DY: readonly number[] = [-1, 0, 1, 0];

/** Anchor of the part on tile (tx, ty), filled by `anchorOf`. */
export interface AnchorRef {
  tx: number;
  ty: number;
  /** Packed cell of the anchor. */
  cell: number;
}

/** Resolves the part on tile (tx, ty) of build layer `li` to its anchor; false (leaving `out`) on an empty tile. */
export function anchorOf(store: StructureStore, layer: Layer, li: number, tx: number, ty: number, out: AnchorRef): boolean {
  const cell = store.cell(layer, li, tx, ty);
  if (cell === 0) return false;
  if (!cellCovered(cell)) {
    out.tx = tx;
    out.ty = ty;
    out.cell = cell;
    return true;
  }
  const ax = tx - cellDx(cell);
  const ay = ty - cellDy(cell);
  out.tx = ax;
  out.ty = ay;
  out.cell = store.cell(layer, li, ax, ay);
  return out.cell !== 0;
}

/** The part on tile (tx, ty) of build layer `li` (covered tiles included), or `undefined`. */
export function partAt(store: StructureStore, catalog: PartCatalog, layer: Layer, li: number, tx: number, ty: number): PartDef | undefined {
  const cell = store.cell(layer, li, tx, ty);
  return cell === 0 ? undefined : catalog.byRuntimeId(cellPart(cell));
}

/** Whether the built part `p` (cell `cell`) closes a room now: a wall, door, gate or window that is no blueprint. */
export function closesRoom(p: PartDef, cell: number): boolean {
  return p.closesRoom && !cellBlueprint(cell);
}

/** Whether two kinds join in the sprites' neighbour mask. */
export function kindsConnect(a: PartKind, b: PartKind): boolean {
  const wallish = (k: PartKind): boolean => k === 'wand' || k === 'tuer' || k === 'tor' || k === 'fenster';
  if (wallish(a) && wallish(b)) return true;
  if ((a === 'zaun' || a === 'tor') && (b === 'zaun' || b === 'tor')) return true;
  if (a === 'dach' && b === 'dach') return true;
  if ((a === 'boden' || a === 'falltuer') && (b === 'boden' || b === 'falltuer')) return true;
  return a === 'steg' && b === 'steg';
}

/** Neighbour mask (north 1, east 2, south 4, west 8) of the part on tile (tx, ty) of build layer `li`; 0 on an empty tile. */
export function connectMask(store: StructureStore, catalog: PartCatalog, layer: Layer, li: number, tx: number, ty: number): number {
  const own = partAt(store, catalog, layer, li, tx, ty);
  if (own === undefined) return 0;
  let mask = 0;
  for (let r = 0; r < ROT_DX.length; r++) {
    const other = partAt(store, catalog, layer, li, tx + (ROT_DX[r] as number), ty + (ROT_DY[r] as number));
    // Bit r: north 1, east 2, south 4, west 8 – the order of the rotations.
    if (other !== undefined && kindsConnect(own.kind, other.kind)) mask |= 1 << r;
  }
  return mask;
}

/** Collision of the built structures (see module comment). */
export class StructureCollisionOverlay implements CollisionOverlay {
  constructor(
    private readonly store: StructureStore,
    private readonly catalog: PartCatalog,
  ) {}

  overlayAt(layer: Layer, tx: number, ty: number): number {
    let bits = this.bitsOf(layer, STRUCTURE, tx, ty) | this.bitsOf(layer, OBJECT, tx, ty) | this.bitsOf(layer, FLOOR, tx, ty);
    // Stairs next to the tile that lead up onto it join it to their level.
    for (let r = 0; r < ROT_DX.length; r++) {
      const sx = tx - (ROT_DX[r] as number);
      const sy = ty - (ROT_DY[r] as number);
      const cell = this.store.cell(layer, STRUCTURE, sx, sy);
      if (cell === 0 || cellBlueprint(cell) || cellRot(cell) !== r) continue;
      if (this.catalog.byRuntimeId(cellPart(cell))?.kind === 'treppe') bits |= OVERLAY_CONNECTOR;
    }
    return bits;
  }

  private bitsOf(layer: Layer, li: number, tx: number, ty: number): number {
    const cell = this.store.cell(layer, li, tx, ty);
    if (cell === 0 || cellBlueprint(cell)) return 0;
    const p = this.catalog.byRuntimeId(cellPart(cell));
    if (p === undefined) return 0;
    if (p.kind === 'treppe') return OVERLAY_CONNECTOR;
    return cellOpen(cell) ? p.blocksOpen : p.blocks;
  }
}
