/**
 * Embedding and occupancy of a vault (docs/SPIEL.md §19 "Generator" 2. and 3.; M7-10, M7-11): the grammar's graph laid into the
 * grid of 5 × 5 cells of 16 × 16 tiles inside the box on layer −1, then filled.
 *
 * - **Box:** `BALANCE.vaults.boxTiles` square, centred on the entrance; the start room (one cell) sits in the middle cell with its
 *   way up on the entrance tile (`START_ENTRANCE`).
 * - **Rooms:** from the start, breadth first along the graph's edges, each child takes a template of its role at a free cell
 *   position touching its parent (seeded choice among all that fit); the two rooms meet with the sockets of a touching cell pair –
 *   the doorway of the edge (both sockets open; a gate or a hidden wall lies on the parent's side). A graph that does not fit is
 *   tried again with another seed (`embedTries`), then the grammar draws the next graph (`attempt`).
 * - **Occupancy** from the template slots: the puzzle in the area of the `raetsel` slot (src/game/puzzles/layout.ts), traps on
 *   `falle` slots (striking along the longest free line), chests and key pedestals on `truhe`, guards on `waechter`, the mini-boss on
 *   `boss`, tablets on `tafel`, the ember shard on `splitter` – a missing slot falls back to a free floor tile near the room's middle.
 * - **Check:** every room reachable from the way up with all doors open, every part, chest, pedestal and guard on or beside a
 *   reachable tile (the tile-level half of "lösbar"; the graph level is the grammar's walk, src/world/gen/vaults/grammar.ts).
 * A pure function of seed, slot, entrance and content.
 */
import { hashCombine, hashString, normalizeSeed, Rng } from '../../../engine/rng';
import { PUZZLE_AREA, ROOM_CELL_TILES, START_ENTRANCE, type PuzzleVariantDef, type RoomSlotKind } from '../../../content/dungeons/schema';
import { puzzleLayout } from './puzzleLayout';
import { vaultGraph, type VaultGraphParams } from './grammar';
import { placedTemplate, socketTilesAt } from './raster';
import { T_FLOOR, T_SOCKET, T_WALL, T_ENTRANCE, type CompiledTemplate, type TilesetTemplates } from './templates';
import type { PlacedRoom, VaultChestPlan, VaultDoorPlan, VaultGraph, VaultGuardPlan, VaultPlan, VaultPuzzlePlan, VaultTrapPlan } from './types';
import type { QuarterTurn } from '../places/types';

/** What the embedding needs besides the graph parameters. */
export interface VaultPlanInput {
  readonly seed: number;
  readonly slot: number;
  readonly biome: string;
  readonly entrance: { readonly tx: number; readonly ty: number };
  readonly params: VaultGraphParams;
  readonly tileset: TilesetTemplates;
  readonly boxTiles: number;
  readonly gridCells: number;
  readonly embedTries: number;
  /** Graph attempts before the vault is given up (a slot without a plan). */
  readonly graphAttempts: number;
  /** A puzzle variant of the content by id. */
  readonly variant: (id: string) => PuzzleVariantDef | undefined;
}

const EMBED_SALT = hashString('gewoelbe.einbettung');
/** Directions as quarter turns (0 north, 1 east, 2 south, 3 west). */
const DX: readonly number[] = [0, 1, 0, -1];
const DY: readonly number[] = [-1, 0, 1, 0];
const SIDE_OF_DIR = ['n', 'o', 's', 'w'] as const;
const OPPOSITE = 2;
const DIRS = 4;

interface Placed {
  readonly node: number;
  readonly t: CompiledTemplate;
  readonly cx: number;
  readonly cy: number;
  readonly x0: number;
  readonly y0: number;
}

interface Opening {
  readonly a: number;
  readonly b: number;
  /** Parent side's socket tiles (where a gate or hidden wall stands), then the child's. */
  readonly parentTiles: [number, number][];
  readonly childTiles: [number, number][];
  readonly vertical: boolean;
}

/** Whether template `t` fits at cell (cx, cy) of a grid of `n` cells with occupancy `occ`. */
function fits(occ: Int16Array, n: number, t: CompiledTemplate, cx: number, cy: number): boolean {
  const b = t.def.zellen.b;
  const h = t.def.zellen.t;
  if (cx < 0 || cy < 0 || cx + b > n || cy + h > n) return false;
  for (let y = cy; y < cy + h; y++) for (let x = cx; x < cx + b; x++) if ((occ[y * n + x] as number) >= 0) return false;
  return true;
}

/** Touching cell pairs between a placed parent and a candidate child footprint: [parent cell x, y, direction from parent]. */
function touching(p: Placed, t: CompiledTemplate, cx: number, cy: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const pb = p.t.def.zellen.b;
  const pt = p.t.def.zellen.t;
  const cb = t.def.zellen.b;
  const ct = t.def.zellen.t;
  for (let y = p.cy; y < p.cy + pt; y++) {
    for (let x = p.cx; x < p.cx + pb; x++) {
      for (let d = 0; d < DIRS; d++) {
        const nx = x + (DX[d] as number);
        const ny = y + (DY[d] as number);
        if (nx >= cx && ny >= cy && nx < cx + cb && ny < cy + ct) {
          // Sockets on both sides at these cells.
          const ps = SIDE_OF_DIR[d] as 'n' | 'o' | 's' | 'w';
          const cs = SIDE_OF_DIR[(d + OPPOSITE) % DIRS] as 'n' | 'o' | 's' | 'w';
          const pz = d % 2 === 0 ? x - p.cx : y - p.cy;
          const cz = d % 2 === 0 ? nx - cx : ny - cy;
          if (p.t.hasSocket(ps, pz) && t.hasSocket(cs, cz)) out.push([x, y, d]);
        }
      }
    }
  }
  return out;
}

/** Lays the graph into the grid; null when it does not fit with this stream. */
function embed(g: VaultGraph, input: VaultPlanInput, rng: Rng, box: { x0: number; y0: number }): { placed: Placed[]; openings: Opening[] } | null {
  const n = input.gridCells;
  const occ = new Int16Array(n * n).fill(-1);
  const placed: (Placed | undefined)[] = new Array<Placed | undefined>(g.nodes.length);
  const mid = Math.floor(n / 2);
  const starts = input.tileset.byRole.get('start') ?? [];
  if (starts.length === 0) return null;
  const start = rng.pick(starts);
  const put = (node: number, t: CompiledTemplate, cx: number, cy: number): Placed => {
    const p: Placed = { node, t, cx, cy, x0: box.x0 + cx * ROOM_CELL_TILES, y0: box.y0 + cy * ROOM_CELL_TILES };
    for (let y = cy; y < cy + t.def.zellen.t; y++) for (let x = cx; x < cx + t.def.zellen.b; x++) occ[y * n + x] = node;
    placed[node] = p;
    return p;
  };
  put(g.start, start, mid, mid);
  const openings: Opening[] = [];
  const queue = [g.start];
  for (let head = 0; head < queue.length; head++) {
    const parent = queue[head] as number;
    const pp = placed[parent] as Placed;
    for (const e of g.edges) {
      if (e.a !== parent) continue;
      const child = g.nodes[e.b];
      if (child === undefined) return null;
      const options: { t: CompiledTemplate; cx: number; cy: number; touch: [number, number, number][] }[] = [];
      for (const t of input.tileset.byRole.get(child.role) ?? []) {
        for (let cy = 0; cy < n; cy++) {
          for (let cx = 0; cx < n; cx++) {
            if (!fits(occ, n, t, cx, cy)) continue;
            const touch = touching(pp, t, cx, cy);
            if (touch.length > 0) options.push({ t, cx, cy, touch });
          }
        }
      }
      if (options.length === 0) return null;
      const o = rng.pick(options);
      const cp = put(child.id, o.t, o.cx, o.cy);
      const [x, y, d] = rng.pick(o.touch);
      const ps = SIDE_OF_DIR[d] as 'n' | 'o' | 's' | 'w';
      const cs = SIDE_OF_DIR[(d + OPPOSITE) % DIRS] as 'n' | 'o' | 's' | 'w';
      const nx = x + (DX[d] as number);
      const ny = y + (DY[d] as number);
      openings.push({
        a: parent,
        b: child.id,
        parentTiles: socketTilesAt(pp, pp.t, ps, d % 2 === 0 ? x - pp.cx : y - pp.cy),
        childTiles: socketTilesAt(cp, cp.t, cs, d % 2 === 0 ? nx - cp.cx : ny - cp.cy),
        vertical: d % 2 === 1,
      });
      queue.push(child.id);
    }
  }
  if (placed.some((p) => p === undefined)) return null;
  return { placed: placed as Placed[], openings };
}

/** Floor tile of a room nearest its middle that is free in `taken` (falls back when a slot kind is missing). */
function freeFloorNear(p: Placed, taken: Set<number>, w: number, box: { x0: number; y0: number }): { tx: number; ty: number } | null {
  const cx = p.t.w / 2;
  const cy = p.t.h / 2;
  let best: { tx: number; ty: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (let y = 1; y < p.t.h - 1; y++) {
    for (let x = 1; x < p.t.w - 1; x++) {
      const i = y * p.t.w + x;
      if (p.t.kind[i] !== T_FLOOR || p.t.object[i] !== null) continue;
      const tx = p.x0 + x;
      const ty = p.y0 + y;
      if (taken.has((ty - box.y0) * w + (tx - box.x0))) continue;
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < bestD) {
        bestD = d;
        best = { tx, ty };
      }
    }
  }
  return best;
}

/**
 * The plan of the vault in `input.slot`: graph, rooms, doorways, doors, puzzles, traps, chests, guards, tablets, shard and key
 * pedestals – or null when no graph embeds (the slot then has no vault).
 */
export function planVault(input: VaultPlanInput): VaultPlan | null {
  const size = input.boxTiles;
  const half = Math.floor(size / 2);
  const box = { x0: input.entrance.tx - half, y0: input.entrance.ty - half, w: size, h: size };
  // The start room's way up lies on the entrance: the middle cell's corner plus the template's entrance tile.
  const mid = Math.floor(input.gridCells / 2);
  if (box.x0 + mid * ROOM_CELL_TILES + START_ENTRANCE.tx !== input.entrance.tx || box.y0 + mid * ROOM_CELL_TILES + START_ENTRANCE.ty !== input.entrance.ty) {
    throw new RangeError(`planVault: the box of ${size} tiles does not centre the start room's way up on the entrance`);
  }
  for (let attempt = 0; attempt < input.graphAttempts; attempt++) {
    const g = vaultGraph(input.seed, input.slot, input.params, attempt);
    for (let k = 0; k < input.embedTries; k++) {
      const rng = new Rng(hashCombine(hashCombine(hashCombine(hashCombine(normalizeSeed(input.seed), EMBED_SALT), input.slot), attempt), k));
      const e = embed(g, input, rng, box);
      if (e === null) continue;
      const plan = occupy(g, e.placed, e.openings, input, rng, box, attempt);
      if (plan !== null && planReachable(plan)) return plan;
    }
  }
  return null;
}

/** Occupancy of the embedded rooms (see module comment); null when a puzzle does not fit its room. */
function occupy(g: VaultGraph, placed: readonly Placed[], openings: readonly Opening[], input: VaultPlanInput, rng: Rng, box: { x0: number; y0: number; w: number; h: number }, attempt: number): VaultPlan | null {
  const w = box.w;
  const idx = (tx: number, ty: number): number => (ty - box.y0) * w + (tx - box.x0);
  // Floor of the box (rooms, open sockets) for the trap lines.
  const floor = new Uint8Array(box.w * box.h);
  for (const p of placed) {
    for (let y = 0; y < p.t.h; y++) {
      for (let x = 0; x < p.t.w; x++) {
        const k = p.t.kind[y * p.t.w + x] as number;
        if ((k === T_FLOOR || k === T_ENTRANCE) && p.t.blocking[y * p.t.w + x] === 0) floor[idx(p.x0 + x, p.y0 + y)] = 1;
      }
    }
  }
  for (const o of openings) for (const [tx, ty] of [...o.parentTiles, ...o.childTiles]) floor[idx(tx, ty)] = 1;
  const taken = new Set<number>();
  const take = (tx: number, ty: number): void => {
    taken.add(idx(tx, ty));
  };
  const slotOf = (p: Placed, kind: RoomSlotKind, k: number): { tx: number; ty: number } | null => {
    const list = p.t.slots.get(kind) ?? [];
    for (let j = 0; j < list.length; j++) {
      const s = list[(k + j) % list.length] as { tx: number; ty: number };
      const tx = p.x0 + s.tx;
      const ty = p.y0 + s.ty;
      if (!taken.has(idx(tx, ty))) return { tx, ty };
    }
    return null;
  };
  const rooms: PlacedRoom[] = placed.map((p) => ({ node: p.node, template: p.t.def.id, cellX: p.cx, cellY: p.cy, rotation: 0, x0: p.x0, y0: p.y0 }));

  // Puzzles first (their areas are reserved before anything else stands in the room).
  const puzzles: VaultPuzzlePlan[] = [];
  const puzzleOfNode = new Map<number, number>();
  for (const p of placed) {
    const node = g.nodes[p.node];
    if (node?.puzzle === null || node === undefined) continue;
    const v = input.variant(node.puzzle.variant);
    const anchor = (p.t.slots.get('raetsel') ?? [])[0];
    if (v === undefined || anchor === undefined) return null;
    const layout = puzzleLayout(v);
    const ax = p.x0 + anchor.tx;
    const ay = p.y0 + anchor.ty;
    for (let y = 0; y < PUZZLE_AREA.h; y++) for (let x = 0; x < PUZZLE_AREA.w; x++) take(ax + x, ay + y);
    for (const s of layout.solid) floor[idx(ax + s.x, ay + s.y)] = 0;
    for (const part of layout.parts) if (part.role !== 'kiste' && part.role !== 'platte' && part.role !== 'ursprung' && part.role !== 'ruecksetzer') floor[idx(ax + part.x, ay + part.y)] = 0;
    const id = puzzles.length;
    puzzleOfNode.set(p.node, id);
    puzzles.push({
      id,
      node: p.node,
      type: node.puzzle.type,
      variant: node.puzzle.variant,
      parts: layout.parts.map((part) => ({ role: part.role, tx: ax + part.x, ty: ay + part.y })),
      solid: layout.solid.map((s) => ({ tx: ax + s.x, ty: ay + s.y })),
    });
  }

  // Doors on the gated edges (the parent's side of the doorway).
  const doors: VaultDoorPlan[] = [];
  const openingOut = openings.map((o) => ({ a: o.a, b: o.b, tiles: [...o.parentTiles, ...o.childTiles].map(([tx, ty]) => ({ tx, ty })) }));
  for (const e of g.edges) {
    if (e.kind === 'offen') continue;
    const o = openings.find((x) => x.a === e.a && x.b === e.b);
    const first = o?.parentTiles[0];
    if (o === undefined || first === undefined) return null;
    doors.push({ id: e.door, tx: first[0], ty: first[1], kind: e.kind, puzzle: e.kind === 'raetsel' ? (puzzleOfNode.get(e.a) ?? -1) : -1, vertical: o.vertical });
    for (const [tx, ty] of o.parentTiles) take(tx, ty);
  }
  doors.sort((a, b) => a.id - b.id);

  const chests: VaultChestPlan[] = [];
  const guards: VaultGuardPlan[] = [];
  const traps: VaultTrapPlan[] = [];
  const tablets: { tablet: string; tx: number; ty: number }[] = [];
  const keys: { door: number; tx: number; ty: number }[] = [];
  let shard: { tx: number; ty: number } | null = null;
  const fallback = (p: Placed): { tx: number; ty: number } | null => freeFloorNear(p, taken, w, box);
  for (const p of placed) {
    const node = g.nodes[p.node];
    if (node === undefined) continue;
    // Key pedestal on the chest slot of a key room.
    if (node.keyFor >= 0) {
      const at = slotOf(p, 'truhe', 0) ?? fallback(p);
      if (at === null) return null;
      take(at.tx, at.ty);
      keys.push({ door: node.keyFor, ...at });
    }
    if (node.chestTier > 0) {
      const at = slotOf(p, 'truhe', 0) ?? fallback(p);
      if (at === null) return null;
      take(at.tx, at.ty);
      const mimic = node.guards.includes(input.params.guards.mimic ?? '');
      chests.push({ id: chests.length, tier: node.chestTier as Exclude<typeof node.chestTier, 0>, tx: at.tx, ty: at.ty, loot: `gewoelbe_${input.tileset.tileset.id}_${node.chestTier}`, mimic });
      if (mimic) guards.push({ creature: input.params.guards.mimic ?? '', tx: at.tx, ty: at.ty, boss: false });
      else floor[idx(at.tx, at.ty)] = 0;
    }
    let g2 = 0;
    for (const c of node.guards) {
      if (c === input.params.guards.mimic) continue;
      const boss = c === input.params.guards.boss;
      const at = (boss ? slotOf(p, 'boss', 0) : slotOf(p, 'waechter', g2++)) ?? fallback(p);
      if (at === null) return null;
      take(at.tx, at.ty);
      guards.push({ creature: c, tx: at.tx, ty: at.ty, boss });
    }
    if (node.tablet !== null) {
      const at = slotOf(p, 'tafel', 0) ?? fallback(p);
      if (at === null) return null;
      take(at.tx, at.ty);
      tablets.push({ tablet: node.tablet, ...at });
      floor[idx(at.tx, at.ty)] = 0;
    }
    if (node.shard) {
      const at = slotOf(p, 'splitter', 0) ?? slotOf(p, 'truhe', 1) ?? fallback(p);
      if (at === null) return null;
      take(at.tx, at.ty);
      shard = at;
    }
  }
  // Traps on the trap slots, striking along the longest free line.
  for (const p of placed) {
    const node = g.nodes[p.node];
    if (node === undefined) continue;
    let k = rng.int(0, Math.max(1, (p.t.slots.get('falle') ?? []).length));
    for (const type of node.traps) {
      // More traps than trap slots (a corridor's one slot, the vault's minimum topped up there): the free floor nearest the middle.
      const at = slotOf(p, 'falle', k++) ?? fallback(p);
      if (at === null) break;
      take(at.tx, at.ty);
      let dir = 0;
      let reach = -1;
      for (let d = 0; d < DIRS; d++) {
        let r = 0;
        while (r < box.w && floor[idx(at.tx + (DX[d] as number) * (r + 1), at.ty + (DY[d] as number) * (r + 1))] === 1) r++;
        if (r > reach) {
          reach = r;
          dir = d;
        }
      }
      traps.push({ id: traps.length, type, tx: at.tx, ty: at.ty, dir: dir as QuarterTurn, reach });
    }
  }
  return {
    slot: input.slot,
    biome: input.biome,
    tileset: input.tileset.tileset.id,
    box,
    entrance: input.entrance,
    graph: g,
    rooms,
    doors,
    puzzles,
    traps,
    chests,
    guards,
    tablets,
    shard,
    openings: openingOut,
    keys,
    attempt,
  };
}

/**
 * Tile-level check of a plan: with every door open, every room's floor is reached from the way up, and every part, chest, key,
 * shard, tablet and guard stands on or beside a reached tile.
 */
export function planReachable(plan: VaultPlan): boolean {
  const { x0, y0, w, h } = plan.box;
  const walk = new Uint8Array(w * h);
  const idx = (tx: number, ty: number): number => (tx < x0 || ty < y0 || tx >= x0 + w || ty >= y0 + h ? -1 : (ty - y0) * w + (tx - x0));
  for (const r of plan.rooms) {
    const t = placedTemplateOf(plan, r.template);
    for (let y = 0; y < t.h; y++) {
      for (let x = 0; x < t.w; x++) {
        const k = t.kind[y * t.w + x] as number;
        if (k !== T_WALL && k !== T_SOCKET && t.blocking[y * t.w + x] === 0) walk[idx(r.x0 + x, r.y0 + y)] = 1;
      }
    }
  }
  for (const o of plan.openings) for (const s of o.tiles) walk[idx(s.tx, s.ty)] = 1;
  for (const p of plan.puzzles) {
    for (const s of p.solid) walk[idx(s.tx, s.ty)] = 0;
    for (const part of p.parts) if (part.role === 'hebel' || part.role === 'schale' || part.role === 'glocke' || part.role === 'hinweis' || part.role === 'risswand') walk[idx(part.tx, part.ty)] = 0;
  }
  for (const c of plan.chests) if (!c.mimic) walk[idx(c.tx, c.ty)] = 0;
  for (const t of plan.tablets) walk[idx(t.tx, t.ty)] = 0;
  for (const k of plan.keys) walk[idx(k.tx, k.ty)] = 0;
  if (plan.shard !== null) walk[idx(plan.shard.tx, plan.shard.ty)] = 0;
  const start = idx(plan.entrance.tx, plan.entrance.ty);
  if (start < 0 || walk[start] === 0) return false;
  const seen = new Uint8Array(w * h);
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const x = i % w;
    const y = Math.floor(i / w);
    for (let d = 0; d < DIRS; d++) {
      const nx = x + (DX[d] as number);
      const ny = y + (DY[d] as number);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (seen[j] === 1 || walk[j] === 0) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  const reachedOrBeside = (tx: number, ty: number): boolean => {
    const i = idx(tx, ty);
    if (i >= 0 && seen[i] === 1) return true;
    for (let d = 0; d < DIRS; d++) {
      const j = idx(tx + (DX[d] as number), ty + (DY[d] as number));
      if (j >= 0 && seen[j] === 1) return true;
    }
    return false;
  };
  // Every room's floor is reached (its middle-most floor tile at least).
  for (const r of plan.rooms) {
    const t = placedTemplateOf(plan, r.template);
    let any = false;
    for (let y = 0; y < t.h && !any; y++) for (let x = 0; x < t.w && !any; x++) if (seen[idx(r.x0 + x, r.y0 + y)] === 1) any = true;
    if (!any) return false;
  }
  for (const p of plan.puzzles) for (const part of p.parts) if (part.role !== 'kiste' && part.role !== 'platte' && part.role !== 'ursprung' && !reachedOrBeside(part.tx, part.ty)) return false;
  for (const c of plan.chests) if (!reachedOrBeside(c.tx, c.ty)) return false;
  for (const k of plan.keys) if (!reachedOrBeside(k.tx, k.ty)) return false;
  for (const t of plan.tablets) if (!reachedOrBeside(t.tx, t.ty)) return false;
  for (const g of plan.guards) if (!reachedOrBeside(g.tx, g.ty)) return false;
  if (plan.shard !== null && !reachedOrBeside(plan.shard.tx, plan.shard.ty)) return false;
  return true;
}

function placedTemplateOf(plan: VaultPlan, id: string): CompiledTemplate {
  return placedTemplate(plan.tileset, id);
}

