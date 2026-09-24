/**
 * World generation step 9 (M2-12, MASTERPROMPT §9.2.9): validation and repair.
 *
 * Reachability ("jede Region erreichbar, sonst Brücken, Furten, Rampen einfügen") is checked on the
 * plan cells with the walking rules of the surface (docs/ARCHITEKTUR.md collision, M3-09):
 * - a cell is walkable when it is land without a lake (lava pools keep a free rim, `worldContext.ts`);
 * - a step to a neighbour of the same level is free, one level down is a safe jump, one level up
 *   needs a ramp or stairs on that cell edge, two or more levels are a cliff;
 * - deep rivers (width ≥ `WATER.deepRiverWidth`: a deep channel) are barriers: a river cell can only
 *   be entered where a ford, a bridge or a road bridge crosses it; narrower rivers and streams are
 *   wadeable;
 * - offshore islets are reached by raft (T1, §25) and count as reachable.
 * From the start beach, cells are flooded with these rules. Every round of the repair looks at the
 * steps from the reached area into unreached cells and applies the one that opens the most cells: a
 * ford (river up to 3 tiles) or a bridge (wider) across a deep river, or a new ramp/stairs on a
 * one-level cliff; when no single step opens a cell (a bank cell at a river mouth that borders dry
 * land only through two deep-river cells), two crossings on neighbouring river cells. Repairs never
 * touch places or roads.
 *
 * The other checks (every beacon site with a boss arena, roads join every site, minimum resources per
 * tier) are collected by `collectProblems` into the world report; the resource re-scatter lives in
 * `resources.ts`.
 */
import { WATER_RIVER } from '../model/chunk';
import { cellAtTile, cellCenterX, cellCenterY, DX4, DY4, NEIGHBOURS_4, neighbour4, type PlanGrid } from './plan/grid';
import { MAIN_LANDMASS } from './plan/island';
import { HEIGHT, WATER } from './plan/params';
import { createTerrainSample, type PlanFord, type PlanRamp, type RampKind, type WorldPlan } from './plan/index';
import type { WorldSizePreset } from '../../content/balance';
import { hash2, hashToUnit } from '../../engine/rng';
import { BEACON_BIOMES, type CellInfo, type LocationPlacer, type LocationSlot } from './locations';
import type { RoadNetwork } from './roads';
import { genSeed, type ReservedSegment, type SurfaceContext } from './worldContext';

/** A bridge span across a river (repair or ruin). */
export interface Bridge {
  readonly id: number;
  /** `reparatur`: inserted by the validation; `ruine`: a Builder bridge ruin (place). */
  readonly kind: 'reparatur' | 'ruine';
  readonly river: number;
  /** Plan cell of the crossing vertex. */
  readonly cell: number;
  /** Span [tiles]: from bank to bank across the river. */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** Level of the river (and both banks) at the crossing. */
  readonly level: number;
}

export const VALIDATION = {
  /** Widest river crossed by an inserted ford [tiles]. Wider rivers get a bridge. */
  fordMaxWidth: 3,
  /** Bridge span beyond the river's half width on each side [tiles]. Lands on dry bank. */
  bridgeOverhangTiles: 2.5,
  /** Half width of a bridge deck [tiles]. 3 tiles, like a road. */
  bridgeHalfWidthTiles: 1.5,
  /** Most repair rounds [rounds]. Each round opens at least one cell; worlds need a handful. */
  maxRounds: 256,
  /** Candidate steps evaluated per round [candidates]. The largest gain among them wins. */
  maxCandidates: 96,
  /** Candidates are searched within this distance of an unreached cell [cells, Chebyshev]. A step there can open it. */
  nearCells: 2,
  /** Builder bridge ruins per world size [bridges] (§21 "Brückenruinen"): decayed but passable spans over deep rivers. */
  ruins: { small: 1, medium: 2, large: 3 } satisfies Record<WorldSizePreset, number>,
  /** Smallest distance of a ruin from any other river crossing (ford, bridge, road) [tiles]. Fords lie ≈ 110 tiles apart; a ruin sits between two of them. */
  ruinSpacingTiles: 40,
  /** River vertices skipped between two ruin candidates [vertices]. */
  ruinVertexStep: 4,
  /** Sample step along a bridge span for the bank check [tiles]. */
  spanStepTiles: 0.5,
} as const;

// ---------------------------------------------------------------------------------------------
// Reachability model
// ---------------------------------------------------------------------------------------------

/** Cell graph of the walking rules. */
export interface ReachModel {
  readonly grid: PlanGrid;
  /** Walkable cells (land, no lake; lava pools leave the cell edges free). */
  readonly walk: Uint8Array;
  readonly level: Uint8Array;
  readonly landmass: Int16Array;
  /** Deep river cells. */
  readonly barrier: Uint8Array;
  /** Barrier cells with a ford, bridge or road bridge. */
  readonly crossing: Uint8Array;
  /** Bit d: ramp/stairs to the neighbour in direction d. */
  readonly rampDir: Uint8Array;
}

/** Marks the barrier cells within `radius` tiles of (x, y) as crossings; returns the newly marked cells. */
function markCrossingDisc(m: ReachModel, x: number, y: number, radius: number): number[] {
  const { grid } = m;
  const out: number[] = [];
  const x0 = Math.max(0, Math.floor((x - radius) / grid.cellTiles));
  const y0 = Math.max(0, Math.floor((y - radius) / grid.cellTiles));
  const x1 = Math.min(grid.width - 1, Math.floor((x + radius) / grid.cellTiles));
  const y1 = Math.min(grid.height - 1, Math.floor((y + radius) / grid.cellTiles));
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const c = cy * grid.width + cx;
      if (m.barrier[c] === 1 && m.crossing[c] !== 1) {
        m.crossing[c] = 1;
        out.push(c);
      }
    }
  }
  return out;
}

/** Marks the barrier cells along a bridge span as crossings; returns the newly marked cells. */
function markCrossingSpan(m: ReachModel, b: Bridge): number[] {
  const out: number[] = [];
  const len = Math.sqrt((b.x1 - b.x0) * (b.x1 - b.x0) + (b.y1 - b.y0) * (b.y1 - b.y0));
  const steps = Math.max(1, Math.ceil(len));
  for (let i = 0; i <= steps; i++) {
    const c = cellAtTile(m.grid, b.x0 + ((b.x1 - b.x0) * i) / steps, b.y0 + ((b.y1 - b.y0) * i) / steps);
    if (m.barrier[c] === 1 && m.crossing[c] !== 1) {
      m.crossing[c] = 1;
      out.push(c);
    }
  }
  return out;
}

/** Builds the reachability model of a plan with its fords, bridges and road crossings. */
export function createReachModel(ctx: SurfaceContext, cells: CellInfo, roads: RoadNetwork | null, bridges: readonly Bridge[], rampDir: Uint8Array): ReachModel {
  const { plan, grid } = ctx;
  const model: ReachModel = {
    grid,
    walk: cells.passable,
    level: plan.level,
    landmass: plan.landmass,
    barrier: cells.deepRiver,
    crossing: new Uint8Array(grid.count),
    rampDir: rampDir.slice(),
  };
  for (const f of plan.fords) markCrossingDisc(model, f.x, f.y, WATER.fordRadiusTiles);
  for (const b of bridges) markCrossingSpan(model, b);
  if (roads !== null) for (const r of roads.roads) for (const c of r.cells) if (model.barrier[c] === 1) model.crossing[c] = 1;
  return model;
}

/** Whether a step from u to its neighbour v in direction d is allowed. */
export function canStep(m: ReachModel, u: number, v: number, d: number): boolean {
  if (m.walk[v] !== 1) return false;
  if (m.barrier[v] === 1 && m.crossing[v] !== 1) return false;
  const du = (m.level[v] as number) - (m.level[u] as number);
  if (du === 0 || du === -1) return true;
  if (du === 1) return (((m.rampDir[u] as number) >> d) & 1) === 1;
  return false;
}

/** Flood from `root` with the walking rules (1 = reached); islets count as reached (raft). */
export function reachFrom(m: ReachModel, root: number): Uint8Array {
  const { grid } = m;
  const reached = new Uint8Array(grid.count);
  const queue = new Int32Array(grid.count);
  let tail = 0;
  if (root >= 0 && m.walk[root] === 1) {
    reached[root] = 1;
    queue[tail++] = root;
  }
  for (let head = 0; head < tail; head++) {
    const u = queue[head] as number;
    for (let d = 0; d < NEIGHBOURS_4; d++) {
      const v = neighbour4(grid, u, d);
      if (v < 0 || reached[v] === 1 || !canStep(m, u, v, d)) continue;
      reached[v] = 1;
      queue[tail++] = v;
    }
  }
  for (let c = 0; c < grid.count; c++) if (m.walk[c] === 1 && m.landmass[c] !== MAIN_LANDMASS && (m.landmass[c] as number) >= 0) reached[c] = 1;
  return reached;
}

/**
 * Whether a cell must be reached: walkable main-island land that is not a deep-river cell (the
 * river cells themselves are water; their banks are reached from the neighbouring cells).
 */
export function mustReach(m: ReachModel, c: number): boolean {
  return m.walk[c] === 1 && m.landmass[c] === MAIN_LANDMASS && m.barrier[c] !== 1;
}

/** Cells that must be reached (`mustReach`) but are not in `reached`. */
export function unreachableCount(m: ReachModel, reached: Uint8Array): number {
  let n = 0;
  for (let c = 0; c < m.grid.count; c++) if (mustReach(m, c) && reached[c] !== 1) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------

/** Result of the reachability repair. */
export interface ReachRepair {
  /** Ramps and stairs inserted (appended to the plan). */
  readonly ramps: readonly PlanRamp[];
  /** Fords inserted (appended to the plan). */
  readonly fords: readonly PlanFord[];
  /** Bridges inserted. */
  readonly bridges: readonly Bridge[];
  /** Unreachable walkable main-island cells before and after. */
  readonly unreachableBefore: number;
  readonly unreachableAfter: number;
  /** Repair rounds used. */
  readonly rounds: number;
}

/** Tile rectangle of a ramp on the edge from `low` in direction `dir` (same geometry as the plan's ramps). */
export function rampRect(grid: PlanGrid, low: number, dir: number): { x: number; y: number; w: number; h: number } {
  const cx = low % grid.width;
  const cy = Math.floor(low / grid.width);
  const t = grid.cellTiles;
  const halfDepth = HEIGHT.rampDepthTiles / 2;
  const side = (t - HEIGHT.rampWidthTiles) / 2;
  const dx = DX4[dir] as number;
  const dy = DY4[dir] as number;
  if (dx !== 0) {
    const edgeX = (dx > 0 ? cx + 1 : cx) * t;
    return { x: edgeX - halfDepth, y: cy * t + side, w: HEIGHT.rampDepthTiles, h: HEIGHT.rampWidthTiles };
  }
  const edgeY = (dy > 0 ? cy + 1 : cy) * t;
  return { x: cx * t + side, y: edgeY - halfDepth, w: HEIGHT.rampWidthTiles, h: HEIGHT.rampDepthTiles };
}

/** Nearest vertex of any river inside cell `c` to its centre: [river, vertex] or null. */
function nearestRiverVertex(plan: WorldPlan, c: number): [number, number] | null {
  const { grid } = plan;
  const x = cellCenterX(grid, c);
  const y = cellCenterY(grid, c);
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const r of plan.rivers) {
    for (let i = 0; i < r.xs.length; i++) {
      const vx = r.xs[i] as number;
      const vy = r.ys[i] as number;
      if (cellAtTile(grid, vx, vy) !== c) continue;
      const d = (vx - x) * (vx - x) + (vy - y) * (vy - y);
      if (d < bestD) {
        bestD = d;
        best = [r.id, i];
      }
    }
  }
  return best;
}

/** A bridge perpendicular to river `river` at vertex `i`. */
export function bridgeAt(plan: WorldPlan, river: number, i: number, id: number, kind: Bridge['kind']): Bridge {
  const r = plan.rivers[river];
  if (r === undefined) throw new RangeError(`bridgeAt: no river ${river}`);
  const n = r.xs.length;
  const a = Math.max(0, i - 1);
  const b = Math.min(n - 1, i + 1);
  let tx = (r.xs[b] as number) - (r.xs[a] as number);
  let ty = (r.ys[b] as number) - (r.ys[a] as number);
  const len = Math.sqrt(tx * tx + ty * ty);
  if (len > 0) {
    tx /= len;
    ty /= len;
  } else {
    tx = 1;
    ty = 0;
  }
  const half = (r.width[i] as number) / 2 + VALIDATION.bridgeOverhangTiles;
  const x = r.xs[i] as number;
  const y = r.ys[i] as number;
  return { id, kind, river, cell: cellAtTile(plan.grid, x, y), x0: x + ty * half, y0: y - tx * half, x1: x - ty * half, y1: y + tx * half, level: r.level[i] as number };
}

/** Bridge spans as reserved segments. */
export function bridgeSegments(bridges: readonly Bridge[]): ReservedSegment[] {
  return bridges.map((b) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, half: VALIDATION.bridgeHalfWidthTiles, levelMin: b.level, levelMax: b.level }));
}

type Candidate = { readonly kind: 'crossing'; readonly v: number } | { readonly kind: 'ramp'; readonly u: number; readonly v: number; readonly d: number };

/** Cells that must be reached (`mustReach`) newly reached from `v` (already entered) over unreached cells. */
function gainFrom(m: ReachModel, reached: Uint8Array, v: number, mark: Int32Array, stamp: number, queue: Int32Array): number {
  let tail = 0;
  let gain = 0;
  mark[v] = stamp;
  queue[tail++] = v;
  for (let head = 0; head < tail; head++) {
    if (mustReach(m, queue[head] as number)) gain++;
    const u = queue[head] as number;
    for (let d = 0; d < NEIGHBOURS_4; d++) {
      const w = neighbour4(m.grid, u, d);
      if (w < 0 || reached[w] === 1 || mark[w] === stamp || !canStep(m, u, w, d)) continue;
      mark[w] = stamp;
      queue[tail++] = w;
    }
  }
  return gain;
}

/** A ford or bridge across the river in barrier cell `v` (nearest vertex), or null. */
type CrossingPlan = { readonly kind: 'ford'; readonly ford: PlanFord } | { readonly kind: 'bridge'; readonly bridge: Bridge };

function crossingFor(plan: WorldPlan, v: number, bridgeId: number): CrossingPlan | null {
  const rv = nearestRiverVertex(plan, v);
  if (rv === null) return null;
  const [river, i] = rv;
  const r = plan.rivers[river] as (typeof plan.rivers)[number];
  if ((r.width[i] as number) <= VALIDATION.fordMaxWidth) return { kind: 'ford', ford: { river, cell: v, vertex: i, x: r.xs[i] as number, y: r.ys[i] as number, level: r.level[i] as number } };
  return { kind: 'bridge', bridge: bridgeAt(plan, river, i, bridgeId, 'reparatur') };
}

/** Applies a crossing to the model; returns the newly marked cells (for reverting a trial). */
function applyCrossing(m: ReachModel, cp: CrossingPlan, v: number): number[] {
  const marked = cp.kind === 'ford' ? markCrossingDisc(m, cp.ford.x, cp.ford.y, WATER.fordRadiusTiles) : markCrossingSpan(m, cp.bridge);
  if (m.crossing[v] !== 1) {
    m.crossing[v] = 1;
    marked.push(v);
  }
  return marked;
}

/**
 * Makes every walkable main-island cell reachable from `root` (see module comment). `avoid` marks
 * cells repairs must not touch (places, roads). Mutates `model` (crossings, ramp bits).
 */
export function repairReachability(ctx: SurfaceContext, cells: CellInfo, model: ReachModel, root: number, avoid: Uint8Array, firstBridgeId: number): ReachRepair {
  const { plan, grid } = ctx;
  const ramps: PlanRamp[] = [];
  const fords: PlanFord[] = [];
  const bridges: Bridge[] = [];
  const mark = new Int32Array(grid.count);
  const queue = new Int32Array(grid.count);
  const near = new Uint8Array(grid.count);
  const sample = createTerrainSample();
  const rejected = new Set<string>();
  let stamp = 0;
  let reached = reachFrom(model, root);
  const before = unreachableCount(model, reached);
  let rounds = 0;
  const rampTilesDry = (low: number, d: number): boolean => {
    const rect = rampRect(grid, low, d);
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const s = ctx.terrain.sample(x, y, sample);
        if (!s.land || s.water !== 0 || s.flags !== 0) return false;
      }
    }
    return true;
  };
  /** The pair of crossings (candidate cell, then a deep-river neighbour of it) that opens the most cells, or null. */
  const bestCrossingPair = (candidates: readonly Candidate[]): [CrossingPlan, number][] | null => {
    let best: [CrossingPlan, number][] | null = null;
    let bestGain = 0;
    for (const cand of candidates) {
      if (cand.kind !== 'crossing') continue;
      const firstId = firstBridgeId + bridges.length;
      const first = crossingFor(plan, cand.v, firstId);
      if (first === null) continue;
      const marked = applyCrossing(model, first, cand.v);
      for (let d = 0; d < NEIGHBOURS_4; d++) {
        const w = neighbour4(grid, cand.v, d);
        if (w < 0 || model.barrier[w] !== 1 || model.crossing[w] === 1 || reached[w] === 1) continue;
        const second = crossingFor(plan, w, first.kind === 'bridge' ? firstId + 1 : firstId);
        if (second === null) continue;
        const marked2 = applyCrossing(model, second, w);
        stamp++;
        const gain = gainFrom(model, reached, cand.v, mark, stamp, queue);
        for (const c of marked2) model.crossing[c] = 0;
        if (gain > bestGain) {
          bestGain = gain;
          best = [
            [first, cand.v],
            [second, w],
          ];
        }
      }
      for (const c of marked) model.crossing[c] = 0;
    }
    return best;
  };
  for (; rounds < VALIDATION.maxRounds; rounds++) {
    // Cells near the unreached ones: only steps there can open them.
    near.fill(0);
    let targets = 0;
    for (let c = 0; c < grid.count; c++) {
      if (!mustReach(model, c) || reached[c] === 1) continue;
      targets++;
      const cx = c % grid.width;
      const cy = Math.floor(c / grid.width);
      const r = VALIDATION.nearCells;
      for (let y = Math.max(0, cy - r); y <= Math.min(grid.height - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(grid.width - 1, cx + r); x++) near[y * grid.width + x] = 1;
    }
    if (targets === 0) break;
    // Candidate steps from the reached area into unreached cells.
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    for (let u = 0; u < grid.count && candidates.length < VALIDATION.maxCandidates; u++) {
      if (reached[u] !== 1 || model.walk[u] !== 1 || model.landmass[u] !== MAIN_LANDMASS) continue;
      for (let d = 0; d < NEIGHBOURS_4; d++) {
        const v = neighbour4(grid, u, d);
        if (v < 0 || near[v] !== 1 || reached[v] === 1 || model.walk[v] !== 1 || model.landmass[v] !== MAIN_LANDMASS) continue;
        const lu = model.level[u] as number;
        const lv = model.level[v] as number;
        if (model.barrier[v] === 1 && model.crossing[v] !== 1 && (lv === lu || lv === lu - 1)) {
          const key = `c${v}`;
          if (!seen.has(key) && !rejected.has(key)) {
            seen.add(key);
            candidates.push({ kind: 'crossing', v });
          }
        } else if (lv === lu + 1 && model.barrier[u] !== 1 && model.barrier[v] !== 1 && plan.riverCell[u] === 0 && plan.riverCell[v] === 0 && avoid[u] !== 1 && avoid[v] !== 1 && cells.rampCell[u] === 0 && cells.rampCell[v] === 0) {
          const key = `r${u}:${d}`;
          if (!seen.has(key) && !rejected.has(key)) {
            seen.add(key);
            candidates.push({ kind: 'ramp', u, v, d });
          }
        }
      }
    }
    if (candidates.length === 0) break;
    // Largest gain wins (ties: scan order); crossings are tried with their real span.
    let best: Candidate | null = null;
    let bestPlan: CrossingPlan | null = null;
    let bestGain = 0;
    for (const cand of candidates) {
      stamp++;
      let gain: number;
      if (cand.kind === 'crossing') {
        const cp = crossingFor(plan, cand.v, firstBridgeId + bridges.length);
        if (cp === null) {
          rejected.add(`c${cand.v}`);
          continue;
        }
        const marked = applyCrossing(model, cp, cand.v);
        gain = gainFrom(model, reached, cand.v, mark, stamp, queue);
        for (const c of marked) model.crossing[c] = 0;
        if (gain > bestGain) bestPlan = cp;
      } else {
        gain = gainFrom(model, reached, cand.v, mark, stamp, queue);
      }
      if (gain > bestGain) {
        bestGain = gain;
        best = cand;
      }
    }
    if (best === null) {
      // No single step opens a cell: a bank cell at a river mouth or bend may border dry land only
      // through two deep-river cells in a row. Try two crossings on neighbouring river cells.
      const pair = bestCrossingPair(candidates);
      if (pair === null) break;
      for (const [cp, v] of pair) {
        if (cp.kind === 'ford') fords.push(cp.ford);
        else bridges.push(cp.bridge);
        applyCrossing(model, cp, v);
      }
      reached = reachFrom(model, root);
      continue;
    }
    if (best.kind === 'crossing') {
      const cp = bestPlan as CrossingPlan;
      if (cp.kind === 'ford') fords.push(cp.ford);
      else bridges.push(cp.bridge);
      applyCrossing(model, cp, best.v);
    } else {
      if (!rampTilesDry(best.u, best.d)) {
        rejected.add(`r${best.u}:${best.d}`);
        continue;
      }
      const biome = cells.biome[best.v] as string;
      const kind: RampKind = (HEIGHT.stairBiomes as readonly string[]).includes(biome) ? 'treppe' : 'rampe';
      ramps.push({ kind, low: best.u, high: best.v, level: model.level[best.u] as number, dir: best.d, ...rampRect(grid, best.u, best.d) });
      model.rampDir[best.u] = (model.rampDir[best.u] as number) | (1 << best.d);
      model.rampDir[best.v] = (model.rampDir[best.v] as number) | (1 << ((best.d + 2) % NEIGHBOURS_4));
    }
    reached = reachFrom(model, root);
  }
  return { ramps, fords, bridges, unreachableBefore: before, unreachableAfter: unreachableCount(model, reached), rounds };
}

// ---------------------------------------------------------------------------------------------
// Final checks
// ---------------------------------------------------------------------------------------------

/** Outcome of the structural checks. */
export interface StructureCheck {
  /** Main-island regions without a reached cell. */
  readonly unreachableRegions: readonly number[];
  /** Regions only reachable by raft (offshore islets). */
  readonly raftRegions: readonly number[];
  /** Slots whose centre cell is not reached. */
  readonly unreachableSlots: readonly number[];
  /** Beacon biomes without a site, sites without an arena. */
  readonly missingSites: readonly string[];
  readonly sitesWithoutArena: readonly number[];
  /** Whether the roads join every site. */
  readonly roadsConnected: boolean;
}

/** Runs the structural checks of a finished world. */
export function checkStructure(plan: WorldPlan, model: ReachModel, root: number, slots: readonly LocationSlot[], roads: RoadNetwork): StructureCheck {
  const { grid } = plan;
  const reached = reachFrom(model, root);
  const regionReached = new Uint8Array(plan.regions.length);
  for (let c = 0; c < grid.count; c++) {
    const r = plan.region[c] as number;
    if (r >= 0 && reached[c] === 1 && plan.landmass[c] === MAIN_LANDMASS) regionReached[r] = 1;
  }
  const unreachableRegions: number[] = [];
  const raftRegions: number[] = [];
  for (const r of plan.regions) {
    if (r.landmass !== MAIN_LANDMASS) raftRegions.push(r.id);
    else if (regionReached[r.id] !== 1) unreachableRegions.push(r.id);
  }
  const unreachableSlots: number[] = [];
  for (const s of slots) {
    const c = cellAtTile(grid, s.x + 0.5, s.y + 0.5);
    if (reached[c] !== 1) unreachableSlots.push(s.id);
  }
  const missingSites: string[] = [];
  for (const b of BEACON_BIOMES) if (!slots.some((s) => s.type === 'leuchtfeuer' && s.variant === b)) missingSites.push(`leuchtfeuer:${b}`);
  if (!slots.some((s) => s.type === 'nachtherz')) missingSites.push('nachtherz');
  const sitesWithoutArena = slots.filter((s) => (s.type === 'leuchtfeuer' || s.type === 'nachtherz') && slots[s.link]?.type !== 'bossarena').map((s) => s.id);
  return { unreachableRegions, raftRegions, unreachableSlots, missingSites, sitesWithoutArena, roadsConnected: roads.connected };
}

// ---------------------------------------------------------------------------------------------
// Bridge ruins
// ---------------------------------------------------------------------------------------------

/** Whether every point of a span is river water or dry land on the bridge's level, with dry ends. */
function spanFits(ctx: SurfaceContext, b: Bridge): boolean {
  const s = createTerrainSample();
  const len = Math.sqrt((b.x1 - b.x0) * (b.x1 - b.x0) + (b.y1 - b.y0) * (b.y1 - b.y0));
  const steps = Math.max(2, Math.ceil(len / VALIDATION.spanStepTiles));
  let water = false;
  for (let i = 0; i <= steps; i++) {
    const x = b.x0 + ((b.x1 - b.x0) * i) / steps;
    const y = b.y0 + ((b.y1 - b.y0) * i) / steps;
    const t = ctx.terrain.sample(Math.floor(x), Math.floor(y), s);
    if (!t.land || t.level !== b.level || (t.water !== 0 && (t.water & WATER_RIVER) === 0)) return false;
    if ((i === 0 || i === steps) && t.water !== 0) return false;
    if (t.water !== 0) water = true;
  }
  return water;
}

/**
 * Builder bridge ruins (§21 "Brückenruinen"): decayed, still passable bridges over rivers (deep
 * stretches first) far from every other crossing, each with a `brueckenruine` slot on its span.
 * `model` (with the roads and bridges so far) and `root` check that the slot is reachable over the
 * new span; accepted spans stay marked in `model`. Returns the new bridges.
 */
export function placeBridgeRuins(ctx: SurfaceContext, placer: LocationPlacer, preset: WorldSizePreset, bridges: readonly Bridge[], roads: RoadNetwork, firstId: number, model: ReachModel, root: number): Bridge[] {
  const { plan } = ctx;
  const crossings: [number, number][] = [...plan.fords.map((f) => [f.x, f.y] as [number, number]), ...bridges.map((b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] as [number, number]), ...roads.crossings.map((c) => [c.x, c.y] as [number, number])];
  const salt = genSeed(plan.seed, 'brueckenruinen');
  const candidates: { river: number; i: number; key: number }[] = [];
  for (const r of plan.rivers) {
    if (r.kind !== 'fluss') continue;
    for (let i = 1; i + 1 < r.xs.length; i += VALIDATION.ruinVertexStep) {
      // Deep stretches first (there the ruin is a real shortcut), then the wadeable ones.
      const deep = (r.width[i] as number) >= WATER.deepRiverWidth ? 0 : 1;
      candidates.push({ river: r.id, i, key: deep + hashToUnit(hash2(r.id, i, salt)) });
    }
  }
  candidates.sort((a, b) => a.key - b.key || a.river - b.river || a.i - b.i);
  const out: Bridge[] = [];
  const spacing2 = VALIDATION.ruinSpacingTiles * VALIDATION.ruinSpacingTiles;
  const wanted = VALIDATION.ruins[preset];
  for (const c of candidates) {
    if (out.length >= wanted) break;
    const b = bridgeAt(plan, c.river, c.i, firstId + out.length, 'ruine');
    const mx = (b.x0 + b.x1) / 2;
    const my = (b.y0 + b.y1) / 2;
    if (crossings.some(([x, y]) => (x - mx) * (x - mx) + (y - my) * (y - my) < spacing2)) continue;
    const half = Math.sqrt((b.x1 - b.x0) * (b.x1 - b.x0) + (b.y1 - b.y0) * (b.y1 - b.y0)) / 2;
    const cx = Math.floor(mx);
    const cy = Math.floor(my);
    if (plan.landmass[cellAtTile(plan.grid, mx, my)] !== MAIN_LANDMASS) continue;
    // Both ends on walkable cells (not a lake or the sea at a river mouth).
    if (placer.cells.passable[cellAtTile(plan.grid, b.x0, b.y0)] !== 1 || placer.cells.passable[cellAtTile(plan.grid, b.x1, b.y1)] !== 1) continue;
    if (!placer.spaced('brueckenruine', cx, cy, Math.ceil(half), 0) || !spanFits(ctx, b)) continue;
    // Reachable over the span (a bank cell lower than the river, e.g. below a step, would not be).
    const marked = markCrossingSpan(model, b);
    if (reachFrom(model, root)[cellAtTile(plan.grid, cx + 0.5, cy + 0.5)] !== 1) {
      for (const c of marked) model.crossing[c] = 0;
      continue;
    }
    out.push(b);
    crossings.push([mx, my]);
    placer.add('brueckenruine', '', cx, cy, Math.ceil(half), b.level);
  }
  return out;
}
