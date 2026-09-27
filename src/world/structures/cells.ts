/**
 * Packed cells of the structure layers (MASTERPROMPT §16.1 "Ebenen: Boden · Struktur · Objekte · Wandobjekte ·
 * Dach"; M4-11). Every tile has one cell per build layer; a cell is one 32 bit integer:
 *
 * | bits  | field      | meaning |
 * |-------|------------|---------|
 * | 0–11  | part       | runtime id of the build part (`PartCatalog`), 0 = empty |
 * | 12–13 | rot        | rotation in quarter turns clockwise (0 = as drawn) |
 * | 14    | mirror     | mirrored (§16.6 "Spiegeln (F)") |
 * | 15    | open       | a door, gate or trapdoor stands open |
 * | 16    | blueprint  | a plan without material (§16.6 "Blaupausen") – no collision, no support, no room wall |
 * | 17    | covered    | the tile is covered by a part anchored elsewhere (multi-tile furniture, the gate) |
 * | 18–19 | dx         | covered: columns east of the anchor (the anchor is at tx − dx) |
 * | 20–21 | dy         | covered: rows south of the anchor (the anchor is at ty − dy) |
 *
 * The anchor of a part is the north-west tile of its (rotated) footprint; covered tiles repeat the part id and
 * the anchor's rotation, mirror, open and blueprint bits, so every tile answers "what stands here" without a
 * second lookup. Hit points are kept for the anchor only (`StructureChunk.hp`).
 */
import { BUILD_LAYERS, type BuildLayer } from '../../content/buildParts';

/** Number of build layers. */
export const BUILD_LAYER_COUNT = BUILD_LAYERS.length;
/** Index of each build layer in the cell arrays. */
export const BUILD_LAYER_INDEX: Readonly<Record<BuildLayer, number>> = Object.freeze(Object.fromEntries(BUILD_LAYERS.map((l, i) => [l, i])) as Record<BuildLayer, number>);

/** Bits of the part runtime id. */
export const CELL_PART_BITS = 12;
/** Mask of the part runtime id. */
export const CELL_PART_MASK = (1 << CELL_PART_BITS) - 1;
/** Largest part runtime id. */
export const MAX_PART_RUNTIME_ID = CELL_PART_MASK;
const ROT_SHIFT = CELL_PART_BITS;
const ROT_MASK = 0b11;
const MIRROR_SHIFT = 14;
const OPEN_SHIFT = 15;
const BLUEPRINT_SHIFT = 16;
const COVERED_SHIFT = 17;
const DX_SHIFT = 18;
const DY_SHIFT = 20;
const OFFSET_MASK = 0b11;
/** Mirrored. */
export const CELL_MIRROR = 1 << MIRROR_SHIFT;
/** Open (doors, gates, trapdoors). */
export const CELL_OPEN = 1 << OPEN_SHIFT;
/** Blueprint without material. */
export const CELL_BLUEPRINT = 1 << BLUEPRINT_SHIFT;
/** Covered by a part anchored elsewhere. */
export const CELL_COVERED = 1 << COVERED_SHIFT;
/** Bits a covered cell copies from its anchor (everything but the offset). */
export const CELL_ANCHOR_BITS = CELL_PART_MASK | (ROT_MASK << ROT_SHIFT) | CELL_MIRROR | CELL_OPEN | CELL_BLUEPRINT;
/** Quarter turns of a full turn. */
export const ROTATIONS = 4;
/** Largest offset of a covered tile from its anchor [tiles] (footprints up to 4 × 4). */
export const MAX_CELL_OFFSET = OFFSET_MASK;

/** Part runtime id of a cell (0 = empty). */
export function cellPart(cell: number): number {
  return cell & CELL_PART_MASK;
}

/** Rotation of a cell [quarter turns]. */
export function cellRot(cell: number): number {
  return (cell >>> ROT_SHIFT) & ROT_MASK;
}

/** Whether the cell is mirrored. */
export function cellMirror(cell: number): boolean {
  return (cell & CELL_MIRROR) !== 0;
}

/** Whether the cell stands open. */
export function cellOpen(cell: number): boolean {
  return (cell & CELL_OPEN) !== 0;
}

/** Whether the cell is a blueprint. */
export function cellBlueprint(cell: number): boolean {
  return (cell & CELL_BLUEPRINT) !== 0;
}

/** Whether the cell is covered by a part anchored elsewhere. */
export function cellCovered(cell: number): boolean {
  return (cell & CELL_COVERED) !== 0;
}

/** Columns east of its anchor (covered cells). */
export function cellDx(cell: number): number {
  return (cell >>> DX_SHIFT) & OFFSET_MASK;
}

/** Rows south of its anchor (covered cells). */
export function cellDy(cell: number): number {
  return (cell >>> DY_SHIFT) & OFFSET_MASK;
}

/** Packs an anchor cell. */
export function anchorCell(part: number, rot: number, mirror: boolean, open: boolean, blueprint: boolean): number {
  if (!Number.isInteger(part) || part < 1 || part > MAX_PART_RUNTIME_ID) throw new RangeError(`structure cell: part runtime id ${String(part)} outside 1…${MAX_PART_RUNTIME_ID}`);
  return part | ((rot & ROT_MASK) << ROT_SHIFT) | (mirror ? CELL_MIRROR : 0) | (open ? CELL_OPEN : 0) | (blueprint ? CELL_BLUEPRINT : 0);
}

/** The cell of a tile covered by the part of `anchor`, `dx` columns and `dy` rows from it. */
export function coveredCell(anchor: number, dx: number, dy: number): number {
  if (dx < 0 || dy < 0 || dx > OFFSET_MASK || dy > OFFSET_MASK || (dx === 0 && dy === 0)) throw new RangeError(`structure cell: offset ${dx}, ${dy} outside the footprint`);
  return (anchor & CELL_ANCHOR_BITS) | CELL_COVERED | (dx << DX_SHIFT) | (dy << DY_SHIFT);
}

/** `cell` with the open bit set or cleared. */
export function withOpen(cell: number, open: boolean): number {
  return open ? cell | CELL_OPEN : cell & ~CELL_OPEN;
}

/** `cell` with the blueprint bit cleared (finished). */
export function withoutBlueprint(cell: number): number {
  return cell & ~CELL_BLUEPRINT;
}

/** `cell` with another part id (upgrading in place keeps rotation, mirror, open state and offsets). */
export function withPart(cell: number, part: number): number {
  if (!Number.isInteger(part) || part < 1 || part > MAX_PART_RUNTIME_ID) throw new RangeError(`structure cell: part runtime id ${String(part)} outside 1…${MAX_PART_RUNTIME_ID}`);
  return (cell & ~CELL_PART_MASK) | part;
}

/** Footprint of a part rotated by `rot` quarter turns: width and depth swap on odd turns. */
export function rotatedSize(w: number, h: number, rot: number): { readonly w: number; readonly h: number } {
  return (rot & 1) === 0 ? { w, h } : { w: h, h: w };
}
