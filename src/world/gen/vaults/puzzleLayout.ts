/**
 * How a puzzle stands in its room (docs/SPIEL.md §19 "Einbettung", "Belegung"; M7-12, M7-13): the parts of a variant inside the
 * puzzle area of a `raetsel` slot (`PUZZLE_AREA`, 10 × 8 tiles; a free ring of floor around it keeps the room's doors
 * connected) – a pure function of the variant, shared by the world generator (it stamps the walls and lists the parts in the
 * vault's plan), the puzzle rules (src/game/puzzles/, the `kisten` map) and the tests.
 *
 * - `kisten`: the map at the area's corner (`ursprung`); its walls are Builder stone, crates, plates and the reset rune parts.
 * - `hebel`, `feuerschalen`, `glocken`: a row of levers, bowls or bells across the middle of the area (two tiles apart, each
 *   on its pedestal), the mural or inscription (`hinweis`) above them.
 * - `verborgene_wand`: a niche across the top of the area behind a wall with cracked segments (`risswand`, two tiles apart);
 *   the real ones open into the niche.
 * Part roles count in order: the i-th `hebel` is lever i of the variant.
 */
import { KISTEN_CHARS, PUZZLE_AREA, type PuzzleVariantDef } from '../../../content/dungeons/schema';

/** A `kisten` variant of the content. */
export type KistenVariantDef = Extract<PuzzleVariantDef, { typ: 'kisten' }>;

/** A parsed map. */
export interface KistenMap {
  readonly w: number;
  readonly h: number;
  /** 1 = wall. */
  readonly wall: Uint8Array;
  /** 1 = plate. */
  readonly plate: Uint8Array;
  readonly crates: readonly number[];
  readonly entry: number;
  /** Cell of the reset rune, or −1. */
  readonly reset: number;
  readonly plates: readonly number[];
}

/** x, y offsets of the four push directions (north, east, south, west). */
export const PUSH_DX: readonly number[] = [0, 1, 0, -1];
export const PUSH_DY: readonly number[] = [-1, 0, 1, 0];
/** Number of push directions; the opposite of `d` is `(d + 2) % PUSH_DIRECTIONS`. */
export const PUSH_DIRECTIONS = PUSH_DX.length;

const parsed = new WeakMap<KistenVariantDef, KistenMap>();

/** The map of a variant (parsed once). */
export function kistenMap(v: KistenVariantDef): KistenMap {
  const cached = parsed.get(v);
  if (cached !== undefined) return cached;
  const h = v.karte.length;
  const w = v.karte[0]?.length ?? 0;
  const wall = new Uint8Array(w * h);
  const plate = new Uint8Array(w * h);
  const crates: number[] = [];
  const plates: number[] = [];
  let entry = -1;
  let reset = -1;
  v.karte.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const ch = row.charAt(x);
      if (ch === KISTEN_CHARS.wall) wall[i] = 1;
      if (ch === KISTEN_CHARS.plate || ch === KISTEN_CHARS.crateOnPlate) {
        plate[i] = 1;
        plates.push(i);
      }
      if (ch === KISTEN_CHARS.crate || ch === KISTEN_CHARS.crateOnPlate) crates.push(i);
      if (ch === KISTEN_CHARS.entry) entry = i;
      if (ch === KISTEN_CHARS.reset) reset = i;
    }
  });
  const map: KistenMap = { w, h, wall, plate, crates, entry, reset, plates };
  parsed.set(v, map);
  return map;
}

/** The cell `dir` of cell `i`, or −1 outside the map. */
export function kistenStep(m: KistenMap, i: number, dir: number): number {
  const x = (i % m.w) + (PUSH_DX[dir] as number);
  const y = Math.floor(i / m.w) + (PUSH_DY[dir] as number);
  return x < 0 || y < 0 || x >= m.w || y >= m.h ? -1 : y * m.w + x;
}



export const PUZZLE_PART_ROLES = ['ursprung', 'kiste', 'platte', 'ruecksetzer', 'hebel', 'schale', 'glocke', 'risswand', 'hinweis'] as const;
export type PuzzlePartRole = (typeof PUZZLE_PART_ROLES)[number];

export interface PuzzlePart {
  readonly role: PuzzlePartRole;
  /** Area-local tile. */
  readonly x: number;
  readonly y: number;
}
export interface PuzzleLayout {
  readonly parts: readonly PuzzlePart[];
  /** Area-local tiles that become Builder stone (the map's walls, the niche's frame). */
  readonly solid: readonly { readonly x: number; readonly y: number }[];
}

/** Row of the levers, bowls and bells; row of the mural or inscription [area tiles]. */
const PART_ROW = 5;
const HINT_ROW = 1;
/** Spacing of the parts in a row [tiles]: a free tile between two pedestals. */
const PART_SPACING = 2;
/** Rows of the hidden-wall niche: the back wall, the niche, the cracked wall. */
const NICHE_BACK = 0;
const NICHE_ROW = 1;
const NICHE_FRONT = 2;

/** First column of a row of `n` parts centred in the area. */
function rowStart(n: number): number {
  return Math.floor((PUZZLE_AREA.w - (PART_SPACING * (n - 1) + 1)) / 2);
}

function row(role: PuzzlePartRole, n: number): PuzzlePart[] {
  const x0 = rowStart(n);
  const out: PuzzlePart[] = [{ role: 'hinweis', x: Math.floor(PUZZLE_AREA.w / 2) - 1, y: HINT_ROW }];
  for (let i = 0; i < n; i++) out.push({ role, x: x0 + PART_SPACING * i, y: PART_ROW });
  return out;
}

/** The parts and walls of a variant inside its area. */
export function puzzleLayout(v: PuzzleVariantDef): PuzzleLayout {
  switch (v.typ) {
    case 'kisten': {
      const m = kistenMap(v);
      const parts: PuzzlePart[] = [{ role: 'ursprung', x: 0, y: 0 }];
      const solid: { x: number; y: number }[] = [];
      for (let i = 0; i < m.w * m.h; i++) {
        const x = i % m.w;
        const y = Math.floor(i / m.w);
        if (m.wall[i] === 1) solid.push({ x, y });
      }
      for (const c of m.crates) parts.push({ role: 'kiste', x: c % m.w, y: Math.floor(c / m.w) });
      for (const p of m.plates) parts.push({ role: 'platte', x: p % m.w, y: Math.floor(p / m.w) });
      if (m.reset >= 0) parts.push({ role: 'ruecksetzer', x: m.reset % m.w, y: Math.floor(m.reset / m.w) });
      return { parts, solid };
    }
    case 'hebel':
      return { parts: row('hebel', v.hebel), solid: [] };
    case 'feuerschalen':
      return { parts: row('schale', v.schalen), solid: [] };
    case 'glocken':
      return { parts: row('glocke', v.glocken), solid: [] };
    case 'verborgene_wand': {
      const x0 = rowStart(v.waende);
      const segments = new Set<number>();
      const parts: PuzzlePart[] = [];
      for (let i = 0; i < v.waende; i++) {
        segments.add(x0 + PART_SPACING * i);
        parts.push({ role: 'risswand', x: x0 + PART_SPACING * i, y: NICHE_FRONT });
      }
      const solid: { x: number; y: number }[] = [];
      for (let x = 0; x < PUZZLE_AREA.w; x++) {
        solid.push({ x, y: NICHE_BACK });
        if (!segments.has(x)) solid.push({ x, y: NICHE_FRONT });
      }
      solid.push({ x: 0, y: NICHE_ROW }, { x: PUZZLE_AREA.w - 1, y: NICHE_ROW });
      return { parts, solid };
    }
  }
}

/** The ordinal of `part` among the parts of its role (lever 0, 1, …). */
export function partOrdinal(layout: readonly { readonly role: string }[], index: number): number {
  const role = layout[index]?.role;
  let n = 0;
  for (let k = 0; k < index; k++) if (layout[k]?.role === role) n++;
  return n;
}
