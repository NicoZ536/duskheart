/**
 * Falling water of the waterfalls (M2-28, ADR-0025; M6 gate picture review: the falling face read as horizontal bands of
 * dark navy without fall streaks, a seabed motif – a tuft of seagrass – stood in the middle of it, present since M2). A
 * river that runs over a cliff edge falls down the wall piece below it (src/render/world/terrainMesh.ts `TERRAIN_KIND.
 * waterfall`); the terrain shader draws it from this pattern alone, not from the water tile's frame (whose seabed – plain
 * deep ground, hollows, stones, seagrass – lies under still water):
 *
 * - the body in the light blue of aerated water (`wasser.3`, lighter than the pool's deep blue);
 * - vertical threads, one or two pixels wide: light ones (`wasser.4`, sometimes a bright head `wasser.5` at their leading
 *   end) and fewer dark ones (`wasser.2`), each column with its own period and length – no two columns in step, never a
 *   row of one colour;
 * - the whole pattern scrolls down `speedPxPerSecond` in whole pixels;
 * - at the lip the crest where the water curls over the edge (`wasser.5` with a few `wasser.4`), a light row below it;
 * - at the foot the foam where it hits the pool, its top ragged column by column (the water pass adds the white water in
 *   the pool below, `fallFoam`);
 * - at a wall end the rock's side face beside it (`WATERFALL_END`, `waterfallOpen`): the water falls only as wide as the
 *   open lip above it, whose bank – the side rim of the plateau tile – runs on down as the side face of the wall's end, as
 *   beside every rock wall (M6 gate round 2 `gruenhain-tag`, `daemmerung-gruenhain-*`: the face fell a full tile wide, a
 *   rock wedge of the bank stood over its crest – the water fell from under the rock).
 *
 * This module is the CPU mirror of `waterfallStep` in shaders/world/terrain.frag – the same formula and constants
 * (`waterfallDefines`) – so tests can check it. Ramp steps count in the `wasser` ramp (0 darkest … 5 lightest); the biome's
 * palette row tints them like every water pixel.
 */
import { KLIPPE_FRAME, UEBERGANG, WAND_SPALTE, WAND_ZEILE, wandFrame } from '../../world/autotile';
import { cellHash } from '../surface/rules';
import { rampIndex } from '../surface/params';
import { TILE_PX } from '../tilemap/chunk';

/** Parameters of the falling water (px, px/s, shares 0…1, ramp steps of `wasser`). */
export const WATERFALL = {
  /** Fall speed [px/s]: the pattern moves down in whole pixels (a 16 px face in two thirds of a second). */
  speedPxPerSecond: 24,
  /** Ramp step of the body: aerated water is lighter than the pool's deep blue (`wasser.2` under the lake's water). */
  bodyStep: 3,
  /** Ramp steps of the light threads, of their bright heads and of the dark threads. */
  lightStep: 4,
  headStep: 5,
  darkStep: 2,
  /** Share of column pairs that fall as one thread two pixels wide (the rest falls column by column). */
  pairShare: 0.35,
  /** Share of threads that carry light streaks, and of threads that carry dark ones (the rest is plain body). */
  lightShare: 0.5,
  darkShare: 0.25,
  /** Period [px] (from, to) of a light thread's streaks and their length [px] (from, to). */
  lightPeriodPx: [10, 18] as const,
  lightLengthPx: [4, 8] as const,
  /** Share of light threads whose streaks end in a bright head (the leading pixel). */
  headShare: 0.4,
  /** Period [px] (from, to) of a dark thread's streaks and their length [px] (from, to). */
  darkPeriodPx: [12, 20] as const,
  darkLengthPx: [3, 6] as const,
  /** Share of the crest's pixels in the brightest step (the rest one step darker): a crest with a little texture. */
  crestShare: 0.75,
  /** Rows of the lip [px]: the crest row, then light rows. */
  lipPx: 2,
  /** Height of the foam at the foot [px] (from, to), per column. */
  footPx: [3, 6] as const,
  /** Salt of the pattern's hashes (another field than the surface effects'). */
  salt: 401,
  /**
   * Width of the rock's side face at a wall end per pixel row of the tile [px] – the art of every cliff group
   * (assets-src/sprites/terrain/_klippe.ts `SEITE_VERLAUF`: runs of 3 px, 6 px at the top like the side rim of the
   * plateau tile above): the falling water keeps clear of it.
   */
  sidePx: [6, 6, 6, 6, 5, 5, 5, 6, 6, 6, 7, 7, 7, 6, 6, 6] as readonly number[],
} as const;

/**
 * Ends of a waterfall's wall piece that are rock (bits in the corners byte of its instance, terrainMesh.ts): the wall ends
 * there – the lip above has a side rim, the plateau beside it is lower – and the rock wall piece under the waterfall shows
 * its side face.
 */
export const WATERFALL_END = { left: 1, right: 2 } as const;

/** Column of each wall frame of the cliff tilesets (`KLIPPE_FRAME.wand` … and `wandVariante`, a middle piece), else −1. */
const WALL_COLUMN: ReadonlyMap<number, number> = new Map(
  Object.values(WAND_ZEILE).flatMap((zeile) => [
    ...Object.values(WAND_SPALTE).map((spalte) => [wandFrame(UEBERGANG.keiner, zeile, spalte), spalte] as const),
    [KLIPPE_FRAME.wandVariante + zeile, WAND_SPALTE.mitte] as const,
  ]),
);

/** The rock ends (`WATERFALL_END` bits) of the wall frame `frame` a waterfall replaces (0: a middle piece, no end). */
export function waterfallEnds(frame: number): number {
  const spalte = WALL_COLUMN.get(frame);
  if (spalte === WAND_SPALTE.links) return WATERFALL_END.left;
  if (spalte === WAND_SPALTE.rechts) return WATERFALL_END.right;
  if (spalte === WAND_SPALTE.einzeln) return WATERFALL_END.left | WATERFALL_END.right;
  return 0;
}

/**
 * Whether pixel (x, y) of a waterfall tile (0…15 in the tile) is falling water with the rock ends `ends`, or the side face
 * of the rock beside it (`waterfallOpen` of terrain.frag).
 */
export function waterfallOpen(x: number, y: number, ends: number): boolean {
  const side = WATERFALL.sidePx[y] ?? 0;
  if ((ends & WATERFALL_END.left) !== 0 && x < side) return false;
  if ((ends & WATERFALL_END.right) !== 0 && x >= TILE_PX - side) return false;
  return true;
}

/** Hash rows of a thread: pairing, kind, period, length, phase, head; dark: period, length, phase; crest; foot. */
const H = { pair: 0, kind: 1, lightPeriod: 2, lightLength: 3, lightPhase: 4, head: 5, darkPeriod: 6, darkLength: 7, darkPhase: 8, crest: 9, foot: 10 } as const;

/** A whole number from..to (inclusive) picked by `h` ∈ [0, 1). */
function span(range: readonly [number, number], h: number): number {
  return range[0] + Math.floor(h * (range[1] - range[0] + 1));
}

/** `a` modulo `b` (b > 0) for negative `a` too. */
function wrap(a: number, b: number): number {
  return a - b * Math.floor(a / b);
}

/** Whether `v` lies in the streaks of a thread: period, length and phase from its hash rows. */
function streak(lane: number, v: number, period: readonly [number, number], length: readonly [number, number], rows: readonly [number, number, number]): number {
  const W = WATERFALL;
  const per = span(period, cellHash(lane, rows[0], W.salt));
  const len = span(length, cellHash(lane, rows[1], W.salt));
  const m = wrap(v + Math.floor(cellHash(lane, rows[2], W.salt) * per), per);
  return m < len ? (m === len - 1 ? 2 : 1) : 0;
}

/**
 * Ramp step (0…5 of `wasser`) of the falling water at world column `x`, `y` whole px below the lip of a face `height` px
 * high, at `seconds` (`waterfallStep` of terrain.frag).
 */
export function waterfallStep(x: number, y: number, height: number, seconds: number): number {
  const W = WATERFALL;
  const v = y - Math.floor(seconds * W.speedPxPerSecond);
  // A thread is one column or a pair of columns falling together.
  const lane = cellHash(x >> 1, H.pair, W.salt) < W.pairShare ? (x >> 1) * 2 : x;
  const kind = cellHash(lane, H.kind, W.salt);
  let s: number = W.bodyStep;
  if (kind < W.lightShare) {
    const k = streak(lane, v, W.lightPeriodPx, W.lightLengthPx, [H.lightPeriod, H.lightLength, H.lightPhase]);
    if (k === 2 && cellHash(lane, H.head, W.salt) < W.headShare) s = W.headStep;
    else if (k > 0) s = W.lightStep;
  } else if (kind < W.lightShare + W.darkShare) {
    if (streak(lane, v, W.darkPeriodPx, W.darkLengthPx, [H.darkPeriod, H.darkLength, H.darkPhase]) > 0) s = W.darkStep;
  }
  if (y === 0) s = cellHash(x, H.crest, W.salt) < W.crestShare ? W.headStep : W.lightStep;
  else if (y < W.lipPx) s = Math.max(s, W.lightStep);
  const foot = span(W.footPx, cellHash(x, H.foot, W.salt));
  if (y >= height - foot) s = y === height - foot ? W.lightStep : W.headStep;
  return s;
}

/** Palette index of ramp step `step` of the falling water. */
export function waterfallIndex(step: number): number {
  return rampIndex('wasser', step);
}

function glslFloat(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

function glslRange(r: readonly [number, number]): string {
  return `ivec2(${r[0]}, ${r[1]})`;
}

/** `#define`s of the falling water for the terrain program (terrain.frag `waterfallStep`). */
export function waterfallDefines(): Readonly<Record<string, string>> {
  const W = WATERFALL;
  return {
    DH_WATERFALL_SPEED: glslFloat(W.speedPxPerSecond),
    DH_WATERFALL_RAMP: `${rampIndex('wasser', 0)}`,
    DH_WATERFALL_BODY: `${W.bodyStep}`,
    DH_WATERFALL_LIGHT: `${W.lightStep}`,
    DH_WATERFALL_HEAD: `${W.headStep}`,
    DH_WATERFALL_DARK: `${W.darkStep}`,
    DH_WATERFALL_PAIR_SHARE: glslFloat(W.pairShare),
    DH_WATERFALL_LIGHT_SHARE: glslFloat(W.lightShare),
    DH_WATERFALL_DARK_SHARE: glslFloat(W.darkShare),
    DH_WATERFALL_LIGHT_PERIOD: glslRange(W.lightPeriodPx),
    DH_WATERFALL_LIGHT_LENGTH: glslRange(W.lightLengthPx),
    DH_WATERFALL_HEAD_SHARE: glslFloat(W.headShare),
    DH_WATERFALL_DARK_PERIOD: glslRange(W.darkPeriodPx),
    DH_WATERFALL_DARK_LENGTH: glslRange(W.darkLengthPx),
    DH_WATERFALL_CREST_SHARE: glslFloat(W.crestShare),
    DH_WATERFALL_LIP_PX: `${W.lipPx}`,
    DH_WATERFALL_FOOT: glslRange(W.footPx),
    DH_WATERFALL_SALT: `${W.salt}u`,
    DH_WATERFALL_SIDE: `int[${W.sidePx.length}](${W.sidePx.join(', ')})`,
    DH_WATERFALL_END_LEFT: `${WATERFALL_END.left}u`,
    DH_WATERFALL_END_RIGHT: `${WATERFALL_END.right}u`,
  };
}
