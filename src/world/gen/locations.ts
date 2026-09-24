/**
 * World generation step 8, part 1 (M2-11, MASTERPROMPT §9.2.8, §20.2, §21): location slots – only
 * placement, the content of each place (names, loot, dungeons) comes with its milestone.
 *
 * Slot types (≥ 18 place types of §21 plus the key sites): the start beach, the six beacon sites
 * (one per boss biome, §8 "Je Biom ein Leuchtfeuer, bewacht vom Boss des Bioms") each with its boss
 * arena, the Nachtherz (finale site with the arena of the Verschlinger), Builder vaults (3–4 per
 * biome), lookout towers, farmsteads, wrecks, mines, camps of the Marked, shrines, natural wonders,
 * a trader's square, rescue sites, dig spots, cave labyrinths, meteorite craters, a hermit's hut,
 * bridge ruins, Builder graveyards, oases and the natural cave mouths of the underground.
 *
 * Rules (§9.2.8 "Abstand, Biom, Höhe, Erreichbarkeit"):
 * - Every slot is a disc of flat, dry land on one height level: a cell-level prefilter (the plan
 *   cells under the disc share one level, carry no water, ramp, ford or lava) and an exact
 *   tile-level check with the plan sampler (land, level, no water, no ramp/stairs/ford flag, no road).
 * - Spacing: discs keep a gap to every other disc, slots of one type keep their own minimum
 *   distance; biome, height and landmass rules per type (`LOCATION_RULES`).
 * - Reachability is established by the validation step (`validate.ts`), which runs after the key
 *   sites and roads and before the other places.
 *
 * Candidates are ordered by a seeded hash plus the type's preference (high ground for towers, cliff
 * feet for vaults and mines, the coast for wrecks, roads for the trader, remoteness for the hermit),
 * so the result is a pure function of the world.
 */
import type { WorldSizePreset } from '../../content/balance';
import { hash2, hashToUnit } from '../../engine/rng';
import { createTerrainSample, MAX_LEVEL, type TerrainSample } from './plan/index';
import { cellCenterX, cellCenterY, sampleBilinear, type PlanGrid } from './plan/grid';
import { MAIN_LANDMASS } from './plan/island';
import { deepRiverCells, genSeed, type Reservations, type ReservedDisc, type SurfaceContext } from './worldContext';

/** All slot types. */
export const LOCATION_TYPES = [
  'startstrand',
  'leuchtfeuer',
  'bossarena',
  'nachtherz',
  'gewoelbe',
  'aussichtsturm',
  'gehoeft',
  'wrack',
  'mine',
  'lager',
  'schrein',
  'naturwunder',
  'haendlerplatz',
  'rettungsort',
  'buddelstelle',
  'hoehlenlabyrinth',
  'meteoritenkrater',
  'eremitenhuette',
  'brueckenruine',
  'friedhof',
  'oase',
  'hoehleneingang',
] as const;
/** One slot type. */
export type LocationType = (typeof LOCATION_TYPES)[number];

/** A placed location slot. */
export interface LocationSlot {
  readonly id: number;
  readonly type: LocationType;
  /** Sub-kind: the biome of a beacon site and its arena, the wonder of a `naturwunder`, else ''. */
  readonly variant: string;
  /** Centre tile. */
  readonly x: number;
  readonly y: number;
  /** Radius of the reserved disc [tiles]. */
  readonly radius: number;
  /** Height level of the disc. */
  readonly level: number;
  /** Region of the centre. */
  readonly region: number;
  /** Biome of the centre region. */
  readonly biome: string;
  /** Progression tier of the centre region. */
  readonly tier: number;
  /** Landmass of the centre (0 main island). */
  readonly landmass: number;
  /** Paired slot (beacon site ↔ arena), cave link id of a cave mouth (underground plan), else −1. */
  readonly link: number;
}

/** Biomes with a boss and a beacon (§20.2 bosses 1–6, §8 "Je Biom ein Leuchtfeuer"), in beacon order. */
export const BEACON_BIOMES = ['gruenhain', 'nebelmoor', 'frostkamm', 'glutsand', 'aschenschlund', 'scherbenhain'] as const;

// ---------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------

export const LOCATIONS = {
  /** Gap kept between any two discs [tiles]. Places never merge into each other. */
  gapTiles: 6,
  /** Radius of a beacon site [tiles]. Room for the beacon, its plaza and a camp. */
  beaconRadius: 6,
  /** Radius of a boss arena [tiles]. ≈ 25 tiles across: room to dodge telegraphed attacks (§20.2). */
  arenaRadius: 12,
  /** Radius of the Nachtherz site (crater rim) [tiles]. */
  coreRadius: 8,
  /** Radius of the finale arena [tiles]. The Verschlinger fight is the largest (§20.2 no. 7). */
  finaleRadius: 15,
  /** Smaller radii tried when no region of a biome holds the full size [factor]. Mountain biomes have few large plateaus. */
  fallbackRadiusFactor: 0.75,
  /** Radius factor of the other places when no flat spot of the full size is left [factor]. Small worlds have few large flat spots in some biomes. */
  secondaryFallbackFactor: 0.5,
  /** Spacing factor between places of one type in the last fallback stage [factor]. A small biome may not hold the full count at the full spacing. */
  relaxedSpacingFactor: 0.5,
  /** Extra gap between a site and its arena beyond both radii [tiles]. A short approach path. */
  arenaGapTiles: 8,
  /** Additional ring of cells searched for the arena beyond the shortest distance [cells]. */
  arenaSearchCells: 4,
  /** Longest walk from a site to its arena on the same plateau [cells]. */
  arenaWalkCells: 16,
  /** Radius of the start beach [tiles]. */
  startRadius: 6,
  /** Farthest the start beach centre lies from the sea [tiles]. The player wakes up at the surf. */
  startCoastTiles: 14,
  /** Cells around the start region searched for the start beach [cells]. */
  startSearchCells: 4,
  /** Radius of a cave mouth [tiles]. A 5 × 5 clearing around the way down. */
  caveRadius: 2,
  /** Radius kept dry and level around a proposed cave entrance [tiles]. */
  caveCheckRadius: 2,
  /** Largest cell window radius precomputed for flatness [cells]. Enough for the finale arena (15 tiles). */
  maxWindowCells: 3,
  /** Weight of the type preference against the seeded random order [score]. */
  preferenceWeight: 1.5,
  /** Distance over which remoteness counts for the hermit [tiles]. */
  remoteTiles: 200,
  /** Cells around a candidate searched for the preference (cliffs, roads, lakes) [cells]. */
  preferenceCells: 2,
  /** Shortest distance of a beacon region from the start beach [tiles]. Beacon 1 after ~3 h (§23.1), not at the camp. */
  firstBeaconMinTiles: 160,
  /** Score factor of a beacon region closer to the start than that [factor]. Used only when no farther region fits. */
  nearStartFactor: 0.25,
} as const;

/** Preference of a slot type when ordering candidates. */
type Preference = 'keine' | 'hoch' | 'felsfuss' | 'kueste' | 'strasse' | 'abseits' | 'see';

/** Placement rule of a secondary slot type. */
interface LocationRule {
  /** Slots per world size; `perBiome` multiplies by the number of listed biomes. */
  readonly count: Readonly<Record<WorldSizePreset, number>>;
  /** Whether `count` is per listed biome (else per world). */
  readonly perBiome: boolean;
  /** Extra slot per biome for Mittel with this chance [fraction] (vaults: "3–4 pro Biom"). */
  readonly extraChance: number;
  /** Biomes the centre region may have. */
  readonly biomes: readonly string[];
  /** Variants (one slot each, cycling through `variantBiomes`). */
  readonly variants?: readonly { readonly id: string; readonly biome: string }[];
  readonly radius: number;
  /** Minimum distance between two slots of this type [tiles]. */
  readonly spacing: number;
  /** Lowest level of the disc. */
  readonly minLevel: number;
  /** Whether offshore islets are allowed. */
  readonly islets: boolean;
  readonly prefer: Preference;
  /** Largest distance of the centre from the sea [tiles], or 0 = any. */
  readonly coastTiles: number;
}

const ALL_BUT_CORE = ['gruenhain', 'salzkueste', 'nebelmoor', 'frostkamm', 'glutsand', 'aschenschlund', 'scherbenhain'] as const;

/**
 * Secondary slot types (§21), placed after the key sites and the roads in this order. Counts per
 * Klein / Mittel / Groß; radii in tiles (the disc is flat, dry and free of objects).
 */
export const LOCATION_RULES: Readonly<Partial<Record<LocationType, LocationRule>>> = {
  /** §21 "Erbauer-Gewölbe: 3–4 pro Biom": the entrance at the foot of a hill; the Nachtherz holds the finale instead (ADR-0023). */
  gewoelbe: { count: { small: 3, medium: 3, large: 4 }, perBiome: true, extraChance: 0.5, biomes: ALL_BUT_CORE, radius: 5, spacing: 90, minLevel: 0, islets: false, prefer: 'felsfuss', coastTiles: 0 },
  /** §21/§25 "Aussichtstürme (decken große Kartenbereiche auf)": on high ground. */
  aussichtsturm: { count: { small: 4, medium: 6, large: 9 }, perBiome: false, extraChance: 0, biomes: ALL_BUT_CORE, radius: 3, spacing: 220, minLevel: 1, islets: false, prefer: 'hoch', coastTiles: 0 },
  /** "verlassene Gehöfte": farmland biomes. */
  gehoeft: { count: { small: 3, medium: 5, large: 7 }, perBiome: false, extraChance: 0, biomes: ['gruenhain', 'salzkueste', 'nebelmoor', 'frostkamm'], radius: 7, spacing: 160, minLevel: 0, islets: false, prefer: 'keine', coastTiles: 0 },
  /** "Wracks": on the beach, also of islets. */
  wrack: { count: { small: 3, medium: 4, large: 6 }, perBiome: false, extraChance: 0, biomes: ['salzkueste'], radius: 4, spacing: 140, minLevel: 0, islets: true, prefer: 'kueste', coastTiles: 12 },
  /** "verlassene Minen mit Lorenschienen": into the hills of the ore biomes. */
  mine: { count: { small: 2, medium: 4, large: 6 }, perBiome: false, extraChance: 0, biomes: ['gruenhain', 'frostkamm', 'glutsand'], radius: 4, spacing: 160, minLevel: 1, islets: false, prefer: 'felsfuss', coastTiles: 0 },
  /** "Lager der Gezeichneten". */
  lager: { count: { small: 3, medium: 5, large: 7 }, perBiome: false, extraChance: 0, biomes: ['gruenhain', 'nebelmoor', 'frostkamm', 'glutsand', 'aschenschlund'], radius: 6, spacing: 160, minLevel: 0, islets: false, prefer: 'keine', coastTiles: 0 },
  /** "Schreine (zeitweiliger Segen)". */
  schrein: { count: { small: 4, medium: 6, large: 9 }, perBiome: false, extraChance: 0, biomes: ALL_BUT_CORE, radius: 3, spacing: 160, minLevel: 0, islets: true, prefer: 'keine', coastTiles: 0 },
  /** "Naturwunder (Uraltbaum, Geysirfeld, Kristallbogen)": one of each. */
  naturwunder: {
    count: { small: 3, medium: 3, large: 3 },
    perBiome: false,
    extraChance: 0,
    biomes: ['gruenhain', 'aschenschlund', 'scherbenhain'],
    variants: [
      { id: 'uraltbaum', biome: 'gruenhain' },
      { id: 'geysirfeld', biome: 'aschenschlund' },
      { id: 'kristallbogen', biome: 'scherbenhain' },
    ],
    radius: 7,
    spacing: 200,
    minLevel: 0,
    islets: false,
    prefer: 'keine',
    coastTiles: 0,
  },
  /** "Händlerplatz": beside a Builder road in the early biomes. */
  haendlerplatz: { count: { small: 1, medium: 2, large: 3 }, perBiome: false, extraChance: 0, biomes: ['gruenhain', 'salzkueste', 'nebelmoor', 'frostkamm'], radius: 5, spacing: 300, minLevel: 0, islets: false, prefer: 'strasse', coastTiles: 0 },
  /** "Rettungsorte" (settlers to rescue, §22). */
  rettungsort: { count: { small: 3, medium: 4, large: 6 }, perBiome: false, extraChance: 0, biomes: ALL_BUT_CORE, radius: 5, spacing: 180, minLevel: 0, islets: false, prefer: 'keine', coastTiles: 0 },
  /** "Buddelstellen": small, anywhere, also on islets. */
  buddelstelle: { count: { small: 6, medium: 10, large: 15 }, perBiome: false, extraChance: 0, biomes: ALL_BUT_CORE, radius: 1, spacing: 90, minLevel: 0, islets: true, prefer: 'keine', coastTiles: 0 },
  /** "Höhlenlabyrinthe": entrances in rocky biomes. */
  hoehlenlabyrinth: { count: { small: 1, medium: 2, large: 3 }, perBiome: false, extraChance: 0, biomes: ['nebelmoor', 'frostkamm', 'glutsand', 'aschenschlund'], radius: 4, spacing: 250, minLevel: 0, islets: false, prefer: 'felsfuss', coastTiles: 0 },
  /** "Meteoritenkrater". */
  meteoritenkrater: { count: { small: 1, medium: 2, large: 2 }, perBiome: false, extraChance: 0, biomes: ['gruenhain', 'frostkamm', 'glutsand', 'scherbenhain'], radius: 8, spacing: 300, minLevel: 0, islets: false, prefer: 'keine', coastTiles: 0 },
  /** "Eremitenhütte": remote, far from roads and other places. */
  eremitenhuette: { count: { small: 1, medium: 2, large: 3 }, perBiome: false, extraChance: 0, biomes: ['gruenhain', 'nebelmoor', 'frostkamm', 'scherbenhain'], radius: 4, spacing: 300, minLevel: 0, islets: false, prefer: 'abseits', coastTiles: 0 },
  /** "Friedhöfe der Erbauer": beside the Builder roads. */
  friedhof: { count: { small: 1, medium: 2, large: 3 }, perBiome: false, extraChance: 0, biomes: ALL_BUT_CORE, radius: 6, spacing: 250, minLevel: 0, islets: false, prefer: 'strasse', coastTiles: 0 },
  /** "Oasen": in the Glutsand, at a lake where there is one. */
  oase: { count: { small: 1, medium: 2, large: 3 }, perBiome: false, extraChance: 0, biomes: ['glutsand'], radius: 6, spacing: 140, minLevel: 0, islets: false, prefer: 'see', coastTiles: 0 },
};

/** Secondary types in placement order. */
export const SECONDARY_TYPES: readonly LocationType[] = Object.keys(LOCATION_RULES) as LocationType[];

// ---------------------------------------------------------------------------------------------
// Cell data
// ---------------------------------------------------------------------------------------------

/** Per-cell data the placement steps share. */
export interface CellInfo {
  readonly grid: PlanGrid;
  /** Walkable land: land, no lake (lava pools leave a free rim). */
  readonly passable: Uint8Array;
  /** Land for places and roads: passable and no lava cell. */
  readonly walk: Uint8Array;
  /** Cells with a deep river (a barrier crossed only at fords and bridges). */
  readonly deepRiver: Uint8Array;
  /** 1 on the low and high cell of every ramp or stairs. */
  readonly rampCell: Uint8Array;
  /** 1 on cells within reach of a ford. */
  readonly fordCell: Uint8Array;
  /** Largest k ≤ `LOCATIONS.maxWindowCells` with a flat, dry, ramp-free (2k + 1)² window of one level (−1: the cell itself is not). */
  readonly flatK: Int8Array;
  /** Region biome per cell (`''` at sea). */
  readonly biome: readonly string[];
}

/** Precomputes the per-cell data of a context. */
export function createCellInfo(ctx: SurfaceContext): CellInfo {
  const { plan, grid } = ctx;
  const walk = new Uint8Array(grid.count);
  const passable = new Uint8Array(grid.count);
  const deepRiver = deepRiverCells(plan);
  const rampCell = new Uint8Array(grid.count);
  const fordCell = new Uint8Array(grid.count);
  for (const r of plan.ramps) {
    rampCell[r.low] = 1;
    rampCell[r.high] = 1;
  }
  for (const f of plan.fords) fordCell[f.cell] = 1;
  const biome: string[] = [];
  for (let c = 0; c < grid.count; c++) {
    passable[c] = plan.land[c] === 1 && (plan.lake[c] as number) < 0 ? 1 : 0;
    walk[c] = passable[c] === 1 && ctx.lavaCell[c] === 0 ? 1 : 0;
    const r = plan.region[c] as number;
    biome.push(r >= 0 ? (plan.regions[r]?.biome ?? '') : '');
  }
  const flat = (c: number): boolean => walk[c] === 1 && plan.riverCell[c] === 0 && deepRiver[c] === 0 && rampCell[c] === 0 && fordCell[c] === 0;
  const flatK = new Int8Array(grid.count).fill(-1);
  for (let c = 0; c < grid.count; c++) {
    if (!flat(c)) continue;
    const cx = c % grid.width;
    const cy = Math.floor(c / grid.width);
    const lv = plan.level[c] as number;
    let k = 0;
    for (; k < LOCATIONS.maxWindowCells; k++) {
      const r = k + 1;
      let ok = cx - r >= 0 && cy - r >= 0 && cx + r < grid.width && cy + r < grid.height;
      for (let y = cy - r; y <= cy + r && ok; y++) {
        for (let x = cx - r; x <= cx + r && ok; x++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
          const n = y * grid.width + x;
          ok = flat(n) && plan.level[n] === lv;
        }
      }
      if (!ok) break;
    }
    flatK[c] = k;
  }
  return { grid, passable, walk, deepRiver, rampCell, fordCell, flatK, biome };
}

/** Cell window radius a disc of `radius` tiles centred on a cell centre needs [cells]. */
export function windowCellsFor(grid: PlanGrid, radius: number): number {
  const half = grid.cellTiles / 2;
  return radius <= half ? 0 : Math.ceil((radius - half) / grid.cellTiles);
}

// ---------------------------------------------------------------------------------------------
// Placement state
// ---------------------------------------------------------------------------------------------

/** Mutable placement state of one world. */
export class LocationPlacer {
  readonly slots: LocationSlot[] = [];
  private readonly sample: TerrainSample = createTerrainSample();

  constructor(
    readonly ctx: SurfaceContext,
    readonly cells: CellInfo,
    /** Roads and bridges already placed (tile corridors the discs must avoid), or null. */
    private reservations: Reservations | null,
    /** Slots placed before (ids must be 0 … n − 1). */
    initial: readonly LocationSlot[] = [],
  ) {
    this.slots.push(...initial);
  }

  /** Replaces the feature reservations the discs must avoid. */
  setReservations(res: Reservations | null): void {
    this.reservations = res;
  }

  /** Whether a disc keeps the gap to every placed slot and the spacing to slots of its type. */
  spaced(type: LocationType, x: number, y: number, radius: number, sameSpacing: number): boolean {
    for (const s of this.slots) {
      const dx = s.x - x;
      const dy = s.y - y;
      const d2 = dx * dx + dy * dy;
      const gap = s.radius + radius + LOCATIONS.gapTiles;
      if (d2 < gap * gap) return false;
      if (s.type === type && d2 < sameSpacing * sameSpacing) return false;
    }
    return true;
  }

  /** Exact tile check: every tile of the disc is dry land on `level` without ramp/ford flags, lava or reserved features. */
  discFits(x: number, y: number, radius: number, level: number): boolean {
    const { ctx } = this;
    const r = Math.floor(radius);
    const r2 = radius * radius;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= ctx.grid.tiles || ty >= ctx.grid.tiles) return false;
        const s = ctx.terrain.sample(tx, ty, this.sample);
        if (!s.land || s.level !== level || s.water !== 0 || s.flags !== 0) return false;
        if (ctx.lavaAt(tx, ty)) return false;
        if (this.reservations !== null && this.reservations.at(tx, ty, level) !== 0) return false;
      }
    }
    return true;
  }

  /** Adds a slot and returns it. */
  add(type: LocationType, variant: string, x: number, y: number, radius: number, level: number, link = -1): LocationSlot {
    const { plan, grid } = this.ctx;
    const cell = Math.floor(y / grid.cellTiles) * grid.width + Math.floor(x / grid.cellTiles);
    const region = plan.region[cell] as number;
    const info = plan.regions[region];
    const slot: LocationSlot = {
      id: this.slots.length,
      type,
      variant,
      x,
      y,
      radius,
      level,
      region,
      biome: info?.biome ?? '',
      tier: info?.tier ?? 0,
      landmass: plan.landmass[cell] as number,
      link,
    };
    this.slots.push(slot);
    return slot;
  }

  /** Re-links two slots (site ↔ arena). */
  link(a: number, b: number): void {
    const sa = this.slots[a] as LocationSlot;
    const sb = this.slots[b] as LocationSlot;
    this.slots[a] = { ...sa, link: b };
    this.slots[b] = { ...sb, link: a };
  }
}

/** Centre tile of a cell. */
function centreTile(grid: PlanGrid, c: number): [number, number] {
  return [Math.floor(cellCenterX(grid, c)), Math.floor(cellCenterY(grid, c))];
}

/** Seeded order key of a cell for a named purpose. */
function orderKey(salt: number, c: number): number {
  return hashToUnit(hash2(c, 0, salt));
}

// ---------------------------------------------------------------------------------------------
// Key sites: start beach, Nachtherz, beacon sites with arenas
// ---------------------------------------------------------------------------------------------

/** Result of the key site placement. */
export interface KeySiteResult {
  /** Types (with variant) that could not be placed. */
  readonly missing: readonly string[];
}

/** Places the start beach, the Nachtherz with the finale arena and the six beacon sites with their arenas. */
export function placeKeySites(placer: LocationPlacer): KeySiteResult {
  const missing: string[] = [];
  if (!placeStartBeach(placer)) missing.push('startstrand');
  const { plan } = placer.ctx;
  const core = plan.regions[plan.core];
  if (core === undefined || !placeSiteWithArena(placer, 'nachtherz', '', [plan.core], LOCATIONS.coreRadius, LOCATIONS.finaleRadius)) missing.push('nachtherz');
  const start = placer.slots.find((s) => s.type === 'startstrand');
  for (const biome of BEACON_BIOMES) {
    const regions = beaconRegions(placer.ctx, biome, start);
    if (!placeSiteWithArena(placer, 'leuchtfeuer', biome, regions, LOCATIONS.beaconRadius, LOCATIONS.arenaRadius)) missing.push(`leuchtfeuer:${biome}`);
  }
  return { missing };
}

/** Regions of a beacon biome in preference order: main island, not the start region, larger and farther from the start first. */
function beaconRegions(ctx: SurfaceContext, biome: string, start: LocationSlot | undefined): number[] {
  const { plan } = ctx;
  const salt = genSeed(plan.seed, `leuchtfeuer.${biome}`);
  const minD2 = LOCATIONS.firstBeaconMinTiles * LOCATIONS.firstBeaconMinTiles;
  const list = plan.regions.filter((r) => r.biome === biome && r.landmass === MAIN_LANDMASS && r.id !== plan.start);
  const score = (r: (typeof list)[number]): number => {
    let s = r.cells * (1 + orderKey(salt, r.id));
    if (start !== undefined) {
      const dx = r.centroidX - start.x;
      const dy = r.centroidY - start.y;
      if (dx * dx + dy * dy < minD2) s *= LOCATIONS.nearStartFactor;
    }
    return s;
  };
  return list.sort((a, b) => score(b) - score(a) || a.id - b.id).map((r) => r.id);
}

/** Start beach: dry level-0 disc near the sea in front of the start region. */
function placeStartBeach(placer: LocationPlacer): boolean {
  const { ctx, cells } = placer;
  const { plan, grid } = ctx;
  const startRegion = plan.regions[plan.start];
  if (startRegion === undefined) return false;
  // Cells within a few cells of the start region.
  const near = new Uint8Array(grid.count);
  for (let c = 0; c < grid.count; c++) {
    if (plan.region[c] !== plan.start) continue;
    const cx = c % grid.width;
    const cy = Math.floor(c / grid.width);
    const r = LOCATIONS.startSearchCells;
    for (let y = Math.max(0, cy - r); y <= Math.min(grid.height - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(grid.width - 1, cx + r); x++) near[y * grid.width + x] = 1;
  }
  const k = windowCellsFor(grid, LOCATIONS.startRadius);
  const candidates: { c: number; score: number }[] = [];
  for (let c = 0; c < grid.count; c++) {
    if (near[c] !== 1 || (cells.flatK[c] as number) < k || plan.landmass[c] !== MAIN_LANDMASS || plan.level[c] !== 0) continue;
    const coast = plan.coastDistance[c] as number;
    if (coast > LOCATIONS.startCoastTiles) continue;
    // South first, then close to the start region.
    const dx = cellCenterX(grid, c) - startRegion.centroidX;
    const dy = cellCenterY(grid, c) - startRegion.centroidY;
    candidates.push({ c, score: dy / grid.tiles - Math.sqrt(dx * dx + dy * dy) / grid.tiles });
  }
  candidates.sort((a, b) => b.score - a.score || a.c - b.c);
  for (const { c } of candidates) {
    const [x, y] = centreTile(grid, c);
    // The disc stays on land; the surf is next to it.
    const coast = sampleBilinear(grid, plan.coastDistance, x + 0.5, y + 0.5);
    if (coast > LOCATIONS.startCoastTiles || coast < LOCATIONS.startRadius) continue;
    if (!placer.spaced('startstrand', x, y, LOCATIONS.startRadius, 0)) continue;
    if (!placer.discFits(x, y, LOCATIONS.startRadius, 0)) continue;
    placer.add('startstrand', '', x, y, LOCATIONS.startRadius, 0);
    return true;
  }
  return false;
}

/** Cells of level `level` reachable from `from` over flat same-level land within `maxSteps` (breadth first, bounded). */
function sameLevelWalk(ctx: SurfaceContext, cells: CellInfo, from: number, to: number, maxSteps: number): boolean {
  const { plan, grid } = ctx;
  const lv = plan.level[from] as number;
  const seen = new Map<number, number>([[from, 0]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head] as number;
    const d = seen.get(c) as number;
    if (c === to) return true;
    if (d >= maxSteps) continue;
    const cx = c % grid.width;
    const cy = Math.floor(c / grid.width);
    for (const [nx, ny] of [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ] as const) {
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      const n = ny * grid.width + nx;
      if (seen.has(n) || cells.walk[n] !== 1 || plan.level[n] !== lv || plan.riverCell[n] === 1) continue;
      seen.set(n, d + 1);
      queue.push(n);
    }
  }
  return false;
}

/**
 * A site with its arena: the site on a flat disc in one of `regions` (central cells first), the
 * arena a short walk away on the same plateau in a region of the same biome. Tries the full radii,
 * then smaller ones.
 */
function placeSiteWithArena(placer: LocationPlacer, type: 'leuchtfeuer' | 'nachtherz', variant: string, regions: readonly number[], siteRadius: number, arenaRadius: number): boolean {
  for (const factor of [1, LOCATIONS.fallbackRadiusFactor]) {
    const sr = Math.floor(siteRadius * factor);
    const ar = Math.floor(arenaRadius * factor);
    for (const region of regions) if (trySiteInRegion(placer, type, variant, region, sr, ar)) return true;
  }
  return false;
}

function trySiteInRegion(placer: LocationPlacer, type: 'leuchtfeuer' | 'nachtherz', variant: string, region: number, sr: number, ar: number): boolean {
  const { ctx, cells } = placer;
  const { plan, grid } = ctx;
  const info = plan.regions[region];
  if (info === undefined) return false;
  const kSite = windowCellsFor(grid, sr);
  const kArena = windowCellsFor(grid, ar);
  const salt = genSeed(plan.seed, `ort.${type}.${variant}`);
  const sites: { c: number; score: number }[] = [];
  for (let c = 0; c < grid.count; c++) {
    if (plan.region[c] !== region || (cells.flatK[c] as number) < kSite) continue;
    const dx = cellCenterX(grid, c) - info.centroidX;
    const dy = cellCenterY(grid, c) - info.centroidY;
    sites.push({ c, score: -Math.sqrt(dx * dx + dy * dy) / grid.cellTiles + orderKey(salt, c) * LOCATIONS.preferenceWeight });
  }
  sites.sort((a, b) => b.score - a.score || a.c - b.c);
  const minCells = Math.ceil((sr + ar + LOCATIONS.arenaGapTiles) / grid.cellTiles);
  const maxCells = minCells + LOCATIONS.arenaSearchCells;
  for (const { c } of sites) {
    const [x, y] = centreTile(grid, c);
    const level = plan.level[c] as number;
    if (!placer.spaced(type, x, y, sr, 0) || !placer.discFits(x, y, sr, level)) continue;
    // Arena candidates on a ring around the site.
    const cx = c % grid.width;
    const cy = Math.floor(c / grid.width);
    const arenas: { a: number; score: number }[] = [];
    for (let ay = cy - maxCells; ay <= cy + maxCells; ay++) {
      for (let ax = cx - maxCells; ax <= cx + maxCells; ax++) {
        if (ax < 0 || ay < 0 || ax >= grid.width || ay >= grid.height) continue;
        const d = Math.max(Math.abs(ax - cx), Math.abs(ay - cy));
        if (d < minCells) continue;
        const a = ay * grid.width + ax;
        if ((cells.flatK[a] as number) < kArena || plan.level[a] !== level || cells.biome[a] !== info.biome || plan.landmass[a] !== info.landmass) continue;
        arenas.push({ a, score: -d + orderKey(salt, a) });
      }
    }
    arenas.sort((p, q) => q.score - p.score || p.a - q.a);
    for (const { a } of arenas) {
      const [axT, ayT] = centreTile(grid, a);
      const gap = sr + ar + LOCATIONS.arenaGapTiles;
      if ((axT - x) * (axT - x) + (ayT - y) * (ayT - y) < gap * gap) continue;
      if (!placer.spaced('bossarena', axT, ayT, ar, 0)) continue;
      if (!sameLevelWalk(ctx, cells, c, a, LOCATIONS.arenaWalkCells)) continue;
      if (!placer.discFits(axT, ayT, ar, level)) continue;
      const site = placer.add(type, variant, x, y, sr, level);
      const arena = placer.add('bossarena', type === 'nachtherz' ? 'nachtherz' : variant, axT, ayT, ar, level);
      placer.link(site.id, arena.id);
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Secondary places
// ---------------------------------------------------------------------------------------------

/** Result of the secondary placement. */
export interface SecondaryResult {
  /** Per type: wanted and placed count. */
  readonly counts: Readonly<Partial<Record<LocationType, { readonly wanted: number; readonly placed: number }>>>;
}

/** Preference score of a candidate cell [0, 1]. */
function preference(ctx: SurfaceContext, roadCell: Uint8Array, slots: readonly LocationSlot[], c: number, prefer: Preference): number {
  const { plan, grid } = ctx;
  const cx = c % grid.width;
  const cy = Math.floor(c / grid.width);
  const lv = plan.level[c] as number;
  const r = LOCATIONS.preferenceCells;
  const around = (test: (n: number) => boolean): boolean => {
    for (let y = Math.max(0, cy - r); y <= Math.min(grid.height - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(grid.width - 1, cx + r); x++) if (test(y * grid.width + x)) return true;
    }
    return false;
  };
  switch (prefer) {
    case 'hoch': {
      let higher = false;
      around((n) => {
        if ((plan.level[n] as number) > lv) higher = true;
        return higher;
      });
      return higher ? 0 : (lv + 1) / (MAX_LEVEL + 1);
    }
    case 'felsfuss':
      return around((n) => plan.land[n] === 1 && (plan.level[n] as number) > lv) ? 1 : 0;
    case 'kueste':
      return 1 - Math.min(1, Math.max(0, plan.coastDistance[c] as number) / grid.cellTiles / 2);
    case 'strasse':
      return around((n) => roadCell[n] === 1) ? 1 : 0;
    case 'see':
      return around((n) => (plan.lake[n] as number) >= 0) ? 1 : 0;
    case 'abseits': {
      const x = cellCenterX(grid, c);
      const y = cellCenterY(grid, c);
      let best: number = LOCATIONS.remoteTiles;
      for (const s of slots) best = Math.min(best, Math.sqrt((s.x - x) * (s.x - x) + (s.y - y) * (s.y - y)));
      return (around((n) => roadCell[n] === 1) ? 0 : 1) * (best / LOCATIONS.remoteTiles);
    }
    case 'keine':
      return 0;
  }
}

/** Number of slots wanted for a rule in a world size. */
function wantedCount(ctx: SurfaceContext, preset: WorldSizePreset, type: LocationType, rule: LocationRule): number {
  if (rule.variants !== undefined) return rule.variants.length;
  if (!rule.perBiome) return rule.count[preset];
  let n = 0;
  rule.biomes.forEach((b) => {
    n += rule.count[preset];
    if (preset === 'medium' && hashToUnit(hash2(rule.biomes.indexOf(b), 1, genSeed(ctx.plan.seed, `ort.${type}.extra`))) < rule.extraChance) n++;
  });
  return n;
}

/** Candidate cells of a rule among `biomes` for a disc of `radius`, best first. */
function candidateCells(placer: LocationPlacer, rule: LocationRule, radius: number, biomes: readonly string[], roadCell: Uint8Array, salt: number): Int32Array {
  const { ctx, cells } = placer;
  const { plan, grid } = ctx;
  const k = windowCellsFor(grid, radius);
  const list: { c: number; score: number }[] = [];
  for (let c = 0; c < grid.count; c++) {
    if ((cells.flatK[c] as number) < k || roadCell[c] === 1) continue;
    if (!biomes.includes(cells.biome[c] as string)) continue;
    const lm = plan.landmass[c] as number;
    if (lm !== MAIN_LANDMASS && !rule.islets) continue;
    if ((plan.level[c] as number) < rule.minLevel) continue;
    if (rule.coastTiles > 0 && (plan.coastDistance[c] as number) > rule.coastTiles) continue;
    const pref = preference(ctx, roadCell, placer.slots, c, rule.prefer);
    list.push({ c, score: orderKey(salt, c) + LOCATIONS.preferenceWeight * pref });
  }
  list.sort((a, b) => b.score - a.score || a.c - b.c);
  return Int32Array.from(list.map((e) => e.c));
}

/** Fallback stages of a slot queue: full size, smaller disc, smaller disc at relaxed spacing. */
const SLOT_STAGES = 3;

/**
 * Candidates of one slot kind: the full radius and spacing first; when those run out, a smaller disc
 * (`LOCATIONS.secondaryFallbackFactor`) – small worlds have few large flat spots in some biomes –
 * and finally the smaller disc at a relaxed spacing (`LOCATIONS.relaxedSpacingFactor`), for biomes
 * too small to hold every place of a type at the full spacing.
 */
class SlotQueue {
  private list: Int32Array;
  private cursor = 0;
  private stage = 0;
  private radius: number;
  private spacing: number;

  constructor(
    private readonly placer: LocationPlacer,
    private readonly type: LocationType,
    private readonly rule: LocationRule,
    private readonly variant: string,
    private readonly biomes: readonly string[],
    private readonly roadCell: Uint8Array,
    private readonly salt: number,
  ) {
    this.radius = rule.radius;
    this.spacing = rule.spacing;
    this.list = candidateCells(placer, rule, this.radius, biomes, roadCell, salt);
  }

  /** Places the next slot; false when no candidate is left. */
  next(): boolean {
    const { plan, grid } = this.placer.ctx;
    for (;;) {
      for (; this.cursor < this.list.length; this.cursor++) {
        const c = this.list[this.cursor] as number;
        const [x, y] = centreTile(grid, c);
        const level = plan.level[c] as number;
        if (!this.placer.spaced(this.type, x, y, this.radius, this.spacing)) continue;
        if (!this.placer.discFits(x, y, this.radius, level)) continue;
        this.placer.add(this.type, this.variant, x, y, this.radius, level);
        this.cursor++;
        return true;
      }
      this.stage++;
      if (this.stage >= SLOT_STAGES) return false;
      const smaller = Math.max(1, Math.floor(this.rule.radius * LOCATIONS.secondaryFallbackFactor));
      if (this.stage === SLOT_STAGES - 1) this.spacing = Math.floor(this.rule.spacing * LOCATIONS.relaxedSpacingFactor);
      if (smaller !== this.radius) this.list = candidateCells(this.placer, this.rule, smaller, this.biomes, this.roadCell, this.salt);
      this.radius = smaller;
      this.cursor = 0;
    }
  }
}

/** Places every secondary type of `LOCATION_RULES` (roads must already be reserved on the placer). */
export function placeSecondary(placer: LocationPlacer, preset: WorldSizePreset, roadCell: Uint8Array): SecondaryResult {
  const counts: Partial<Record<LocationType, { wanted: number; placed: number }>> = {};
  for (const type of SECONDARY_TYPES) {
    const rule = LOCATION_RULES[type] as LocationRule;
    const wanted = wantedCount(placer.ctx, preset, type, rule);
    const salt = genSeed(placer.ctx.plan.seed, `ort.${type}`);
    let placed = 0;
    if (rule.variants !== undefined) {
      for (const v of rule.variants) if (new SlotQueue(placer, type, rule, v.id, [v.biome], roadCell, salt).next()) placed++;
    } else if (rule.perBiome) {
      // Round-robin over the biomes so every biome gets its share first.
      const queues = rule.biomes.map((b) => new SlotQueue(placer, type, rule, '', [b], roadCell, salt));
      const alive = queues.map(() => true);
      while (placed < wanted && alive.some((a) => a)) {
        for (let b = 0; b < queues.length && placed < wanted; b++) {
          if (!alive[b]) continue;
          if ((queues[b] as SlotQueue).next()) placed++;
          else alive[b] = false;
        }
      }
    } else {
      const queue = new SlotQueue(placer, type, rule, '', rule.biomes, roadCell, salt);
      while (placed < wanted && queue.next()) placed++;
    }
    counts[type] = { wanted, placed };
  }
  return { counts };
}

// ---------------------------------------------------------------------------------------------
// Cave mouths
// ---------------------------------------------------------------------------------------------

/** A tile position. */
export interface TilePos {
  readonly tx: number;
  readonly ty: number;
}

/**
 * Filters proposed cave entrance tiles by the surface rules: dry land of one level around the
 * mouth, not on a ramp, road or bridge, away from other places, on a reachable cell.
 */
export function filterCaveCandidates(placer: LocationPlacer, candidates: readonly TilePos[], reachable: (tx: number, ty: number) => boolean): TilePos[] {
  const out: TilePos[] = [];
  const { ctx } = placer;
  const s = createTerrainSample();
  for (const p of candidates) {
    const t = ctx.terrain.sample(p.tx, p.ty, s);
    if (!t.land || !reachable(p.tx, p.ty)) continue;
    if (!placer.spaced('hoehleneingang', p.tx, p.ty, LOCATIONS.caveRadius, 0)) continue;
    if (!placer.discFits(p.tx, p.ty, LOCATIONS.caveCheckRadius, t.level)) continue;
    out.push({ tx: p.tx, ty: p.ty });
  }
  return out;
}

/** Adds a cave mouth slot per accepted entrance (link id = the underground link). */
export function placeCaveMouths(placer: LocationPlacer, entrances: readonly { readonly id: number; readonly tx: number; readonly ty: number }[]): number {
  const s = createTerrainSample();
  let placed = 0;
  for (const e of entrances) {
    const t = placer.ctx.terrain.sample(e.tx, e.ty, s);
    placer.add('hoehleneingang', '', e.tx, e.ty, LOCATIONS.caveRadius, t.level, e.id);
    placed++;
  }
  return placed;
}

/** Reserved discs of the slots (cave mouths lead down at their centre). */
export function slotDiscs(slots: readonly LocationSlot[]): ReservedDisc[] {
  return slots.map((s) => ({ x: s.x, y: s.y, radius: s.radius, cave: s.type === 'hoehleneingang' }));
}

/** Plan cells overlapped by slot discs (1) – blocked for road and ramp repairs. */
export function slotCellMask(grid: PlanGrid, slots: readonly LocationSlot[]): Uint8Array {
  const mask = new Uint8Array(grid.count);
  for (const s of slots) {
    const x0 = Math.max(0, Math.floor((s.x - s.radius) / grid.cellTiles));
    const y0 = Math.max(0, Math.floor((s.y - s.radius) / grid.cellTiles));
    const x1 = Math.min(grid.width - 1, Math.floor((s.x + s.radius) / grid.cellTiles));
    const y1 = Math.min(grid.height - 1, Math.floor((s.y + s.radius) / grid.cellTiles));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mask[y * grid.width + x] = 1;
  }
  return mask;
}
