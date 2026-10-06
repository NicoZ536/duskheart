/**
 * Place layouts as grids (docs/SPIEL.md §18 "Aufbau im Weltgenerator", ADR-0207; strand B): the ASCII templates of the
 * content (`placeLayouts`, src/content/places/layouts/) compiled once into per-cell arrays – ground, object, mark and mark
 * data per cell, `.` keeps the generated tile – and the quarter turns and mirroring the generator applies to them.
 *
 * Transform (`QuarterTurn`, `mirror`): the layout is first mirrored east–west, then turned clockwise by `rotation` quarter
 * turns. Only layouts with `drehbar` are transformed; objects with a non-square footprint stand only in layouts that are not
 * (the validator, tools/validator/orte.ts): a sprite does not turn with its layout, so its footprint must keep its shape.
 */
import { CONTENT } from '../../../content/index';
import { LAYOUT_KEEP, PLACE_MARKS, type PlaceLayoutDef, type PlaceMark } from '../../../content/places/schema';
import type { QuarterTurn } from './types';

/** "No mark" in `CompiledLayout.mark`. */
export const NO_MARK = -1;

/** A layout compiled into per-cell arrays (row-major, `w × h`). */
export interface CompiledLayout {
  readonly id: string;
  readonly ortstyp: string;
  readonly biom: string;
  readonly variante: string | null;
  readonly drehbar: boolean;
  readonly w: number;
  readonly h: number;
  /** 1 where the layout keeps the generated tile (`.`). */
  readonly keep: Uint8Array;
  /** Ground terrain id per cell (`null`: keep the generated ground). */
  readonly ground: readonly (string | null)[];
  /** World object id per cell (`null`: the cell clears the tile's object, unless it keeps the tile). */
  readonly object: readonly (string | null)[];
  /** Index into `PLACE_MARKS` per cell, or `NO_MARK`. */
  readonly mark: Int8Array;
  /** Mark data per cell (`''` without). */
  readonly data: readonly string[];
}

/** Compiles one layout record. */
export function compileLayout(def: PlaceLayoutDef): CompiledLayout {
  const h = def.zeilen.length;
  const w = def.zeilen[0]?.length ?? 0;
  const n = w * h;
  const keep = new Uint8Array(n);
  const ground: (string | null)[] = new Array<string | null>(n).fill(null);
  const object: (string | null)[] = new Array<string | null>(n).fill(null);
  const mark = new Int8Array(n).fill(NO_MARK);
  const data: string[] = new Array<string>(n).fill('');
  def.zeilen.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row.charAt(x);
      const i = y * w + x;
      if (ch === LAYOUT_KEEP) {
        keep[i] = 1;
        continue;
      }
      const cell = def.legende[ch];
      if (cell === undefined) throw new RangeError(`Place layout ${def.id}: "${ch}" is not in the legend`);
      ground[i] = cell.boden ?? null;
      object[i] = cell.objekt ?? null;
      if (cell.marke !== undefined) mark[i] = PLACE_MARKS.indexOf(cell.marke);
      data[i] = cell.daten ?? '';
    }
  });
  return { id: def.id, ortstyp: def.ortstyp, biom: def.biom, variante: def.variante ?? null, drehbar: def.drehbar, w, h, keep, ground, object, mark, data };
}

let compiled: ReadonlyMap<string, CompiledLayout> | null = null;

/** Every layout of the content, compiled once (by id, in content order). */
export function contentPlaceLayouts(): ReadonlyMap<string, CompiledLayout> {
  compiled ??= new Map(CONTENT.collection('placeLayouts').values().map((d) => [d.id, compileLayout(d)] as const));
  return compiled;
}

/** The layout of `id` (throws when the content has none: a placement names only content layouts). */
export function placeLayout(id: string): CompiledLayout {
  const l = contentPlaceLayouts().get(id);
  if (l === undefined) throw new RangeError(`Place layout "${id}" is not in the content`);
  return l;
}

/** Width and height of a layout after `rotation` [cells]. */
export function turnedSize(layout: Pick<CompiledLayout, 'w' | 'h'>, rotation: QuarterTurn): { readonly w: number; readonly h: number } {
  return rotation % 2 === 0 ? { w: layout.w, h: layout.h } : { w: layout.h, h: layout.w };
}

/**
 * The layout cell index under cell (u, v) of the turned rectangle (`turnedSize`): the inverse of mirror-then-turn. Pure
 * arithmetic, no allocation (the chunk generator calls it per tile).
 */
export function layoutCellAt(layout: Pick<CompiledLayout, 'w' | 'h'>, rotation: QuarterTurn, mirror: boolean, u: number, v: number): number {
  const { w, h } = layout;
  let x: number;
  let y: number;
  switch (rotation) {
    case 0:
      x = u;
      y = v;
      break;
    case 1:
      x = v;
      y = h - 1 - u;
      break;
    case 2:
      x = w - 1 - u;
      y = h - 1 - v;
      break;
    default:
      x = w - 1 - v;
      y = u;
      break;
  }
  if (mirror) x = w - 1 - x;
  return y * w + x;
}

/** The mark of a mark index (`PLACE_MARKS`). */
export function markOf(index: number): PlaceMark {
  const m = PLACE_MARKS[index];
  if (m === undefined) throw new RangeError(`Place mark index ${index} is out of range`);
  return m;
}
