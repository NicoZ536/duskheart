/**
 * Save form of the structure layers (M4-11; saved by the building system's participant `building`).
 *
 * `{ ids, cells }`: `ids` are the part ids that occur, in code unit order; `cells` is a flat list of 7-tuples
 * `[layer, buildLayer, tx, ty, idIndex, flags, hp]` in the store's deterministic order (chunks by packed id,
 * then build layer, then tile index), with `flags` = the cell without its part id. Parts are stored by their
 * string id, so the runtime numbering of a later build (new parts) does not matter; a part that no longer exists
 * is a load error instead of a silently vanished wall.
 */
import { CHUNK_AREA, CHUNK_SHIFT, isLayer, localX, localY, type Layer } from '../model/coords';
import { BUILD_LAYER_COUNT, CELL_PART_MASK, cellCovered, cellDx, cellDy, cellPart } from './cells';
import { StructureStore } from './store';

/** Numbers per stored cell. */
export const STRUCTURE_CELL_STRIDE = 7;
/** Largest hit points a cell can hold [HP] (Uint16). */
const MAX_HP = 0xffff;
/** Offsets inside a tuple. */
const AT_LI = 1;
const AT_TX = 2;
const AT_TY = 3;
const AT_ID = 4;
const AT_FLAGS = 5;
const AT_HP = 6;

/** Saved structure layers. */
export interface StructureSnapshot {
  readonly ids: string[];
  readonly cells: number[];
}

/** Serializes the store; `idOf` names the part of a runtime id. */
export function serializeStructures(store: StructureStore, idOf: (rid: number) => string): StructureSnapshot {
  const used = new Set<string>();
  const raw: Array<[Layer, number, number, number, string, number, number]> = [];
  for (const c of store.chunks()) {
    for (let li = 0; li < BUILD_LAYER_COUNT; li++) {
      for (let i = 0; i < CHUNK_AREA; i++) {
        const cell = c.cells[li * CHUNK_AREA + i] as number;
        if (cell === 0) continue;
        const id = idOf(cellPart(cell));
        used.add(id);
        raw.push([c.layer, li, (c.cx << CHUNK_SHIFT) + localX(i), (c.cy << CHUNK_SHIFT) + localY(i), id, cell & ~CELL_PART_MASK, c.hp[li * CHUNK_AREA + i] as number]);
      }
    }
  }
  const ids = [...used].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const index = new Map(ids.map((id, i) => [id, i]));
  const cells: number[] = [];
  for (const [layer, li, tx, ty, id, flags, hp] of raw) cells.push(layer, li, tx, ty, index.get(id) as number, flags >>> 0, hp);
  return { ids, cells };
}

function fail(reason: string): never {
  throw new TypeError(`Structure snapshot invalid: ${reason}`);
}

/**
 * Restores a store from `serializeStructures` output; `ridOf` gives the runtime id of a part id (or `undefined`
 * when the part no longer exists – a load error). Throws `TypeError` on malformed data.
 */
export function deserializeStructures(data: unknown, ridOf: (id: string) => number | undefined): StructureStore {
  if (typeof data !== 'object' || data === null) fail('not an object');
  const { ids, cells } = data as Partial<Record<keyof StructureSnapshot, unknown>>;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) fail('ids must be a list of part ids');
  if (!Array.isArray(cells) || cells.length % STRUCTURE_CELL_STRIDE !== 0) fail(`cells must be ${STRUCTURE_CELL_STRIDE}-tuples`);
  const rids = (ids as string[]).map((id) => {
    const rid = ridOf(id);
    if (rid === undefined) fail(`build part "${id}" does not exist (any more)`);
    return rid;
  });
  const store = new StructureStore();
  for (let k = 0; k < cells.length; k += STRUCTURE_CELL_STRIDE) {
    const layer = cells[k] as unknown;
    const li = cells[k + AT_LI] as unknown;
    const tx = cells[k + AT_TX] as unknown;
    const ty = cells[k + AT_TY] as unknown;
    const idIndex = cells[k + AT_ID] as unknown;
    const flags = cells[k + AT_FLAGS] as unknown;
    const hp = cells[k + AT_HP] as unknown;
    if (!isLayer(layer)) fail(`cell ${k / STRUCTURE_CELL_STRIDE}: unknown layer ${String(layer)}`);
    if (!Number.isInteger(li) || (li as number) < 0 || (li as number) >= BUILD_LAYER_COUNT) fail(`cell ${k / STRUCTURE_CELL_STRIDE}: build layer ${String(li)}`);
    if (!Number.isInteger(tx) || !Number.isInteger(ty) || (tx as number) < 0 || (ty as number) < 0) fail(`cell ${k / STRUCTURE_CELL_STRIDE}: tile ${String(tx)}, ${String(ty)}`);
    if (!Number.isInteger(idIndex) || (idIndex as number) < 0 || (idIndex as number) >= rids.length) fail(`cell ${k / STRUCTURE_CELL_STRIDE}: part index ${String(idIndex)}`);
    if (!Number.isInteger(flags) || (flags as number) < 0 || ((flags as number) & CELL_PART_MASK) !== 0) fail(`cell ${k / STRUCTURE_CELL_STRIDE}: flags ${String(flags)}`);
    if (!Number.isInteger(hp) || (hp as number) < 0 || (hp as number) > MAX_HP) fail(`cell ${k / STRUCTURE_CELL_STRIDE}: hit points ${String(hp)}`);
    if (store.cell(layer, li as number, tx as number, ty as number) !== 0) fail(`cell ${k / STRUCTURE_CELL_STRIDE}: tile ${String(tx)}, ${String(ty)} listed twice`);
    store.set(layer, li as number, tx as number, ty as number, (flags as number) | (rids[idIndex as number] as number), hp as number);
  }
  // Every covered cell belongs to an anchor of the same part.
  for (const c of store.chunks()) {
    for (let li = 0; li < BUILD_LAYER_COUNT; li++) {
      for (let i = 0; i < CHUNK_AREA; i++) {
        const cell = c.cells[li * CHUNK_AREA + i] as number;
        if (cell === 0 || !cellCovered(cell)) continue;
        const ax = (c.cx << CHUNK_SHIFT) + localX(i) - cellDx(cell);
        const ay = (c.cy << CHUNK_SHIFT) + localY(i) - cellDy(cell);
        const anchor = store.cell(c.layer, li, ax, ay);
        if (anchor === 0 || cellCovered(anchor) || cellPart(anchor) !== cellPart(cell)) fail(`covered cell at ${ax + cellDx(cell)}, ${ay + cellDy(cell)} has no anchor of its part`);
      }
    }
  }
  return store;
}
