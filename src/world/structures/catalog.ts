/**
 * Build parts as the simulation uses them (MASTERPROMPT §16.1–§16.4; M4-11, M4-12): the content records
 * (src/content/buildParts.ts) resolved against their material (`BALANCE.building.materials`) into hit points,
 * flammability, insulation and roof reach, with the collision, room and support rules of their kind and a
 * runtime id for the packed cells of the structure layers (src/world/structures/cells.ts).
 *
 * Runtime ids: the part ids sorted in code unit order, numbered from 1 (0 = empty cell) – like the world's id
 * tables (docs/ARCHITEKTUR.md "Laufzeit-IDs"). Saves store the string ids of their cells, so new parts never
 * break an old save (src/world/structures/snapshot.ts).
 *
 * Stations (src/game/stations, `station.place`) and lights (torch, camp fire, src/game/light) are placed by their
 * own systems, which keep their state with them; they are no build parts. The building system keeps its parts off
 * their tiles through occupancy providers, the rooms count them through furniture sources (src/game/rooms).
 *
 * Systems and tests build a `PartCatalog` from any records (`createPartCatalog`), so fixture furniture (kettles,
 * troughs, garden beds of later milestones) runs through the same code.
 */
import { BALANCE } from '../../content/balance';
import type { BuildMaterial } from '../../content/balance/building';
import { DECORATION_CATEGORIES, OPENABLE_KINDS, PART_KIND_LAYER, ROOM_CLOSING_KINDS, SUPPORT_KINDS, type BuildLayer, type BuildPartDef, type FurnitureCategory, type PartKind } from '../../content/buildParts';
import { CONTENT } from '../../content/index';
import { BLOCK_HAZARD, BLOCK_OBJECT, BLOCK_SOLID, OVERLAY_DECK } from '../collision/tiles';
import { BUILD_LAYER_INDEX, MAX_PART_RUNTIME_ID } from './cells';

const B = BALANCE.building;

/** A build part resolved for the simulation. */
export interface PartDef {
  /** Part id = the placed item. */
  readonly id: string;
  /** Runtime id in the packed cells (1 …). */
  readonly rid: number;
  readonly kind: PartKind;
  readonly layer: BuildLayer;
  /** Index of `layer` in the cell arrays. */
  readonly layerIndex: number;
  readonly material: BuildMaterial;
  /** Footprint when not rotated [tiles]. */
  readonly w: number;
  readonly h: number;
  /** Hit points of a fresh part [HP]. */
  readonly hp: number;
  /** Flammability [0–1]. */
  readonly flammability: number;
  /** Insulation when closed [0–1] (walls, doors, gates, windows, roofs; 0 for the rest). */
  readonly insulation: number;
  /** Insulation when open [0–1] (doors and gates). */
  readonly insulationOpen: number;
  /** Farthest distance to a support (roofs) [tiles]. */
  readonly roofReach: number;
  readonly closesRoom: boolean;
  readonly supports: boolean;
  readonly openable: boolean;
  /** Collision category bits when closed (`BLOCK_*`) plus `OVERLAY_DECK` for pile floors. */
  readonly blocks: number;
  /** Collision bits when open. */
  readonly blocksOpen: number;
  /** Furniture category, or `null`. */
  readonly category: FurnitureCategory | null;
  /** Counts as decoration (§16.4 "Deko"). */
  readonly decoration: boolean;
  /** Kind of sleeping place (beds), or `null`. */
  readonly sleepKind: string | null;
  /** Rank of its material when upgrading in place (`BALANCE.building.materials.*.upgradeRank`). */
  readonly materialRank: number;
  /** Tier of its item (§13.2 T0–T7; 0 for a part without item in the content). */
  readonly tier: number;
  /** Finish within material and tier (`ausbau`, default 0). */
  readonly finish: number;
}

/**
 * Whether `next` may replace `old` in place (§16.6 "Aufwerten an Ort und Stelle (Holz → Stein)"): a part of the same
 * kind, footprint and furniture category that is better – a higher material rank, else (same rank) a higher item
 * tier, else (same tier) a higher finish. So a wooden wall gives way to stone, a door to the reinforced door, a glass
 * window to stained glass, a chest to the trunk – never the other way round, and never a chair to a chest.
 */
export function isUpgrade(old: PartDef, next: PartDef): boolean {
  if (old.id === next.id || old.kind !== next.kind || old.w !== next.w || old.h !== next.h || old.category !== next.category) return false;
  if (next.materialRank !== old.materialRank) return next.materialRank > old.materialRank;
  if (next.tier !== old.tier) return next.tier > old.tier;
  return next.finish > old.finish;
}

/** Tier of the item a part places (§13.2), or `undefined` when it has none. */
export type PartTierLookup = (id: string) => number | undefined;

/** Unknown part or an inconsistent catalog. */
export class PartCatalogError extends Error {
  override readonly name = 'PartCatalogError';
}

/** Collision bits of a kind: closed and open. */
function collisionOf(kind: PartKind, blocking: boolean): { closed: number; open: number } {
  switch (kind) {
    case 'wand':
      return { closed: BLOCK_SOLID, open: BLOCK_SOLID };
    case 'tuer':
    case 'tor':
      return { closed: BLOCK_SOLID, open: 0 };
    case 'fenster':
    case 'saeule':
    case 'zaun':
      return { closed: BLOCK_OBJECT, open: BLOCK_OBJECT };
    case 'steg':
      return { closed: OVERLAY_DECK, open: OVERLAY_DECK };
    case 'falltuer':
      return { closed: 0, open: BLOCK_HAZARD };
    case 'moebel':
      return blocking ? { closed: BLOCK_OBJECT, open: BLOCK_OBJECT } : { closed: 0, open: 0 };
    default:
      return { closed: 0, open: 0 };
  }
}

/** Insulation of a part (closed, open). */
function insulationOf(p: BuildPartDef, materialInsulation: number): { closed: number; open: number } {
  switch (p.art) {
    case 'wand':
    case 'dach':
      return { closed: materialInsulation, open: materialInsulation };
    case 'tuer':
    case 'tor':
      return { closed: materialInsulation * B.doorInsulation[p.art], open: materialInsulation * B.openDoorInsulation };
    case 'fenster': {
      const own = p.daemmung ?? materialInsulation;
      return { closed: own, open: own };
    }
    default:
      return { closed: 0, open: 0 };
  }
}

/** Resolves one record. */
function resolve(p: BuildPartDef, rid: number, tierOf: PartTierLookup): PartDef {
  const m = B.materials[p.material];
  const collision = collisionOf(p.art, p.blockiert ?? true);
  const insulation = insulationOf(p, m.insulation);
  const layer = PART_KIND_LAYER[p.art];
  return Object.freeze({
    id: p.id,
    rid,
    kind: p.art,
    layer,
    layerIndex: BUILD_LAYER_INDEX[layer],
    material: p.material,
    w: p.groesse?.b ?? 1,
    h: p.groesse?.t ?? 1,
    hp: Math.max(1, Math.round(m.wallHp * B.hpFactor[p.art] * (p.hpFaktor ?? 1))),
    flammability: m.flammability,
    insulation: insulation.closed,
    insulationOpen: insulation.open,
    roofReach: m.roofReach,
    closesRoom: ROOM_CLOSING_KINDS.includes(p.art),
    supports: SUPPORT_KINDS.includes(p.art),
    openable: OPENABLE_KINDS.includes(p.art),
    blocks: collision.closed,
    blocksOpen: collision.open,
    category: p.kategorie ?? null,
    decoration: p.kategorie !== undefined && DECORATION_CATEGORIES.includes(p.kategorie),
    sleepKind: p.schlafplatz ?? null,
    materialRank: m.upgradeRank,
    tier: tierOf(p.id) ?? 0,
    finish: p.ausbau ?? 0,
  });
}

/** Tiers of the game's items (the part items of the content). */
function contentTier(id: string): number | undefined {
  return CONTENT.collection('items').find(id)?.stufe;
}

/** Build parts by id and runtime id. */
export class PartCatalog {
  private readonly byId = new Map<string, PartDef>();
  private readonly byRid: Array<PartDef | undefined> = [undefined];
  /** Parts in runtime id order. */
  readonly parts: readonly PartDef[];

  /** `tierOf`: tier of each part's item (default: the game's items). */
  constructor(records: readonly BuildPartDef[], tierOf: PartTierLookup = contentTier) {
    const sorted = [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (sorted.length > MAX_PART_RUNTIME_ID) throw new PartCatalogError(`Part catalog: ${sorted.length} parts, at most ${MAX_PART_RUNTIME_ID} fit a structure cell`);
    const parts: PartDef[] = [];
    for (const record of sorted) {
      if (this.byId.has(record.id)) throw new PartCatalogError(`Part catalog: duplicate part "${record.id}"`);
      const def = resolve(record, parts.length + 1, tierOf);
      this.byId.set(def.id, def);
      this.byRid.push(def);
      parts.push(def);
    }
    this.parts = Object.freeze(parts);
  }

  /** The part `id`; throws `PartCatalogError` if it does not exist. */
  get(id: string): PartDef {
    const p = this.byId.get(id);
    if (p === undefined) throw new PartCatalogError(`Unknown build part "${id}" (${this.parts.length} parts)`);
    return p;
  }

  /** The part `id`, or `undefined`. */
  find(id: string): PartDef | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** The part with runtime id `rid`, or `undefined` (0 and unknown ids). */
  byRuntimeId(rid: number): PartDef | undefined {
    return this.byRid[rid];
  }

  /** Part ids in runtime id order. */
  ids(): string[] {
    return this.parts.map((p) => p.id);
  }
}

let contentCatalog: PartCatalog | null = null;

/** The catalog of the game's build parts, built on first use. */
export function contentPartCatalog(): PartCatalog {
  contentCatalog ??= new PartCatalog(CONTENT.collection('buildParts').values());
  return contentCatalog;
}

/** A catalog of the given records (tests: fixture furniture). */
export function createPartCatalog(records: readonly BuildPartDef[]): PartCatalog {
  return new PartCatalog(records);
}
