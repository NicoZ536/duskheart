/**
 * The generator's step `orte`, part 2 (docs/SPIEL.md §18 "Aufbau im Weltgenerator", ADR-0207; M7-07): one layout of the
 * content per location slot – a pure function of the world seed, the slot and the content.
 *
 * - **Candidates** of a slot: the layouts of its type (`ortstyp`) and biome whose `variante` is absent or the slot's
 *   variant, and that fit (below). A slot without a candidate stays the free disc of M2 – no marker, no discovery, no half
 *   place (docs/SPIEL.md §18).
 * - **Choice** from `hash(seed, slot, 'ortsvorlage')`: the candidate, then – for a `drehbar` layout – the quarter turn and
 *   the mirroring. The same seed always builds the same places; adding a slot type or a biome's layouts later changes only
 *   those slots.
 * - **Fit:** every cell that does not keep the generated tile lies in the slot's disc (`dx² + dy² ≤ r²` around the centre,
 *   the disc the placement checked flat, dry and free). A **bridge ruin** is the exception: its slot is the span over the
 *   river, so its layout – the bridge head with broken pillars – stands on the bank at one end of the span (chosen by the
 *   hash), turned so that its north faces the bridge; its rectangle is reserved like a disc (`extraPlaceDiscs`), so caves,
 *   deposits and the scatter keep out of it.
 * - **Stamping rule** (`StampTest`, shared with the chunk generator, `stampRight`): a cell is stamped only on dry land of the
 *   slot's level without ramp, stairs or ford, without lava and outside bridges and cave mouths; on a road (they lead into
 *   the beacon sites) only its mark stays, the road keeps its ground and stays free. A mark on a cell that is left alone is
 *   dropped.
 */
import { hashCombine, hashString, hashToUnit } from '../../../engine/rng';
import type { LocationSlot } from '../locations';
import type { Bridge } from '../validate';
import type { ReservedDisc } from '../worldContext';
import { layoutCellAt, markOf, NO_MARK, turnedSize, type CompiledLayout } from './layouts';
import { STAMP_NONE } from './stamp';
import type { PlaceMarker, PlacePlacement, QuarterTurn } from './types';

/** Salt of the layout choice. */
const CHOICE_SALT = hashString('ortsvorlage');
/** Salts of the turn and mirror draws (independent of the choice). */
const TURN_SALT = hashString('ortsvorlage.drehung');
const MIRROR_SALT = hashString('ortsvorlage.spiegel');
const END_SALT = hashString('ortsvorlage.brueckenkopf');
/** The slot type whose layout stands at a bridge head instead of in its disc. */
const BRIDGE_RUIN = 'brueckenruine';
/** Share of the largest fitting layout's cells a candidate needs [0–1]: the small variants are fallbacks. */
const LARGE_SHARE = 0.5;
/** Quarter turns. */
const TURNS: readonly QuarterTurn[] = [0, 1, 2, 3];

/** What a place on `level` may do to the generated tile (tx, ty): `STAMP_NONE`, `STAMP_MARK` or `STAMP_ALL` (stamp.ts). */
export type StampTest = (tx: number, ty: number, level: number) => number;

/** Uniform [0, 1) draw of a slot for a salt. */
function draw(seed: number, slot: number, salt: number): number {
  return hashToUnit(hashCombine(hashCombine(seed >>> 0, salt), slot));
}

/** Whether every non-keeping cell of the turned layout lies in the disc of `radius` around the rectangle's centre cell. */
export function layoutFitsDisc(layout: CompiledLayout, rotation: QuarterTurn, mirror: boolean, radius: number): boolean {
  const { w, h } = turnedSize(layout, rotation);
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const r2 = radius * radius;
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      if (layout.keep[layoutCellAt(layout, rotation, mirror, u, v)] === 1) continue;
      const dx = u - cx;
      const dy = v - cy;
      if (dx * dx + dy * dy > r2) return false;
    }
  }
  return true;
}

/** Cells of a layout that do not keep the generated tile (its size for the choice). */
function stampedCells(l: CompiledLayout): number {
  let n = 0;
  for (let i = 0; i < l.keep.length; i++) if (l.keep[i] === 0) n++;
  return n;
}

/**
 * The layouts a slot may take, in content order: its type, biome and variant, fitting its disc – and of those only the
 * large ones (at least `LARGE_SHARE` of the largest fitting): a small variant stands only where the full one does not fit
 * (a slot that got the fallback radius of a crowded region).
 */
export function placeCandidates(slot: LocationSlot, layouts: Iterable<CompiledLayout>): CompiledLayout[] {
  const fitting: CompiledLayout[] = [];
  for (const l of layouts) {
    if (l.ortstyp !== slot.type || l.biom !== slot.biome) continue;
    if (l.variante !== null && l.variante !== slot.variant) continue;
    if (slot.type !== BRIDGE_RUIN && !layoutFitsDisc(l, 0, false, slot.radius)) continue;
    fitting.push(l);
  }
  let largest = 0;
  for (const l of fitting) largest = Math.max(largest, stampedCells(l));
  return fitting.filter((l) => stampedCells(l) >= LARGE_SHARE * largest);
}

/** The bridge of a bridge ruin slot (the ruin bridge whose span's midpoint is the slot's centre), or undefined. */
function ruinBridge(slot: LocationSlot, bridges: readonly Bridge[]): Bridge | undefined {
  return bridges.find((b) => b.kind === 'ruine' && Math.floor((b.x0 + b.x1) / 2) === slot.x && Math.floor((b.y0 + b.y1) / 2) === slot.y);
}

/** Centre tile and turn of a bridge head at end `first` (x0, y0) or the other end of the span, its north towards the river. */
function bridgeHead(bridge: Bridge, layout: CompiledLayout, first: boolean): { readonly x: number; readonly y: number; readonly rotation: QuarterTurn } {
  const ex = first ? bridge.x0 : bridge.x1;
  const ey = first ? bridge.y0 : bridge.y1;
  // Direction from the end towards the river (the span's midpoint): the layout's north points there.
  const dx = (bridge.x0 + bridge.x1) / 2 - ex;
  const dy = (bridge.y0 + bridge.y1) / 2 - ey;
  let rotation: QuarterTurn;
  if (Math.abs(dx) > Math.abs(dy)) rotation = dx > 0 ? 1 : 3;
  else rotation = dy < 0 ? 0 : 2;
  const { w, h } = turnedSize(layout, rotation);
  // Half the rectangle's depth beyond the end, along the turn's axis away from the river: the head's front row lies at the end.
  const back = Math.floor((rotation % 2 === 0 ? h : w) / 2) + 1;
  const ax = rotation === 1 ? -1 : rotation === 3 ? 1 : 0;
  const ay = rotation === 0 ? 1 : rotation === 2 ? -1 : 0;
  return { x: Math.floor(ex) + ax * back, y: Math.floor(ey) + ay * back, rotation };
}

/** Cells of the turned layout at (x0, y0) that keep no generated tile and are stamped. */
function stampedCellsAt(layout: CompiledLayout, rotation: QuarterTurn, x0: number, y0: number, level: number, stamp: StampTest): number {
  const { w, h } = turnedSize(layout, rotation);
  let n = 0;
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) if (layout.keep[layoutCellAt(layout, rotation, false, u, v)] === 0 && stamp(x0 + u, y0 + v, level) !== STAMP_NONE) n++;
  return n;
}

/** The placement of `layout` with its north-west corner at (x0, y0): marks with world tiles, on stamped cells only. */
export function placementOf(slot: LocationSlot, layout: CompiledLayout, rotation: QuarterTurn, mirror: boolean, x0: number, y0: number, stamp: StampTest): PlacePlacement {
  const { w, h } = turnedSize(layout, rotation);
  const markers: PlaceMarker[] = [];
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const i = layoutCellAt(layout, rotation, mirror, u, v);
      const m = layout.mark[i] as number;
      if (m === NO_MARK || layout.keep[i] === 1) continue;
      const tx = x0 + u;
      const ty = y0 + v;
      if (stamp(tx, ty, slot.level) === STAMP_NONE) continue;
      markers.push({ mark: markOf(m), tx, ty, data: layout.data[i] ?? '' });
    }
  }
  return { slot: slot.id, type: slot.type, layout: layout.id, rotation, mirror, x0, y0, width: w, height: h, markers };
}

/**
 * Chooses the layout of every slot that has candidates (see module comment); slot order. `bridges` are the world's bridges
 * (the bridge ruin slots find their span there), `stamp` the stamping rule over the generated tiles.
 */
export function selectPlaceLayouts(seed: number, slots: readonly LocationSlot[], layouts: Iterable<CompiledLayout>, bridges: readonly Bridge[], stamp: StampTest): PlacePlacement[] {
  const all = [...layouts];
  const out: PlacePlacement[] = [];
  for (const slot of slots) {
    const candidates = placeCandidates(slot, all);
    if (candidates.length === 0) continue;
    const layout = candidates[Math.min(candidates.length - 1, Math.floor(draw(seed, slot.id, CHOICE_SALT) * candidates.length))] as CompiledLayout;
    if (slot.type === BRIDGE_RUIN) {
      const bridge = ruinBridge(slot, bridges);
      if (bridge === undefined) continue;
      // The bank whose head keeps more of its marks, then more of its cells (a bank may rise behind the river); a tie by hash.
      const heads = [true, false].map((first) => {
        const head = bridgeHead(bridge, layout, first);
        const { w, h } = turnedSize(layout, head.rotation);
        const x0 = head.x - Math.floor(w / 2);
        const y0 = head.y - Math.floor(h / 2);
        return { placement: placementOf(slot, layout, head.rotation, false, x0, y0, stamp), cells: stampedCellsAt(layout, head.rotation, x0, y0, slot.level, stamp) };
      });
      const [a, b] = heads as [(typeof heads)[number], (typeof heads)[number]];
      const order = a.placement.markers.length - b.placement.markers.length || a.cells - b.cells;
      out.push((order > 0 || (order === 0 && draw(seed, slot.id, END_SALT) < 0.5) ? a : b).placement);
      continue;
    }
    let rotation: QuarterTurn = 0;
    let mirror = false;
    if (layout.drehbar) {
      // Only the turns that still fit the disc (a long layout may fit only lying or standing).
      const turns = TURNS.filter((t) => layoutFitsDisc(layout, t, false, slot.radius));
      rotation = turns[Math.min(turns.length - 1, Math.floor(draw(seed, slot.id, TURN_SALT) * turns.length))] ?? 0;
      mirror = draw(seed, slot.id, MIRROR_SALT) < 0.5;
    }
    const { w, h } = turnedSize(layout, rotation);
    out.push(placementOf(slot, layout, rotation, mirror, slot.x - Math.floor(w / 2), slot.y - Math.floor(h / 2), stamp));
  }
  return out;
}

/**
 * Discs that reserve the rectangles of places standing outside their slot's disc (bridge heads): the later steps (cave
 * mouths, deposits) and the chunk generator's scatter keep out of them, and their tiles carry `TILE_FLAG_PLACE`.
 */
export function extraPlaceDiscs(placements: readonly PlacePlacement[]): ReservedDisc[] {
  const out: ReservedDisc[] = [];
  for (const p of placements) {
    if (p.type !== BRIDGE_RUIN) continue;
    const half = Math.max(p.width, p.height) / 2;
    out.push({ x: p.x0 + Math.floor(p.width / 2), y: p.y0 + Math.floor(p.height / 2), radius: Math.ceil(half * Math.SQRT2), cave: false });
  }
  return out;
}
