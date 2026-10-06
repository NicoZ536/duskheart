/**
 * Where a boss fights (docs/SPIEL.md §22 "je Boss eine Instanz in seiner Arena (Slot `bossarena` mit `variant` = Biom, über
 * `link` mit der Leuchtfeuer-Stätte verbunden …)"; M7-32): the geometry of an arena – layer, centre and radius of the slot's
 * disc, where the boss stands, the side of the beacon site (respawn "before the arena"), the tiles that burn in a rage.
 *
 * `worldArenaSource` reads it from the generated world: the `bossarena` slot of the boss's biome, its linked beacon site, and
 * the marks of the layout strand B stamps there (`altar` = the boss's place, `siegel` = burning patches, `eingang` = the way
 * in); without a stamped layout the slot's disc and a ring of burning patches of its own (`BALANCE.bosses.burnRingShare`).
 * Tests hand in arenas on drawn maps. The world is read only once it exists (the simulation never builds it for a boss).
 */
import { BALANCE } from '../../content/balance';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { LocationSlot } from '../../world/gen/locations';
import type { PlacePlacement } from '../../world/gen/places/types';
import type { Simulation } from '../sim';

const B = BALANCE.bosses;

/** A tile of an arena. */
export interface ArenaTile {
  readonly tx: number;
  readonly ty: number;
}

/** The geometry of one boss's arena. */
export interface ArenaGeometry {
  readonly layer: Layer;
  /** Centre of the disc [tile]. */
  readonly cx: number;
  readonly cy: number;
  /** Radius of the disc [tiles]. */
  readonly radiusTiles: number;
  /** Where the boss stands [world px]: the layout's `altar`, else the disc's centre. */
  readonly bossX: number;
  readonly bossY: number;
  /** Unit vector from the centre towards the way in (the beacon site), for the respawn spot "before the arena". */
  readonly outX: number;
  readonly outY: number;
  /** Tiles that burn when the boss sets the arena alight (`arena_brennt`). */
  readonly burnTiles: readonly ArenaTile[];
}

/** Finds the arena of the boss of biome `biome`, or null (no slot, or the world is not there yet). */
export type ArenaSource = (sim: Simulation, biome: string) => ArenaGeometry | null;

/** The fallback ring of burning patches of an arena of radius `radiusTiles` around tile (cx, cy). */
export function fallbackBurnTiles(cx: number, cy: number, radiusTiles: number): ArenaTile[] {
  const ringR = radiusTiles * B.burnRingShare;
  const count = Math.max(1, Math.floor((2 * Math.PI * ringR) / B.burnSpacingTiles));
  const out: ArenaTile[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < count; k++) {
    const a = (2 * Math.PI * k) / count;
    const tx = Math.round(cx + Math.cos(a) * ringR);
    const ty = Math.round(cy + Math.sin(a) * ringR);
    const key = `${tx}:${ty}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ tx, ty });
  }
  return out;
}

/** The arena of a slot (with its layout's marks, if one was stamped) and its linked site. */
export function arenaOfSlot(slot: LocationSlot, site: LocationSlot | undefined, placement: PlacePlacement | undefined): ArenaGeometry {
  let bossX = (slot.x + 1 / 2) * TILE_PX;
  let bossY = (slot.y + 1 / 2) * TILE_PX;
  const burn: ArenaTile[] = [];
  let inX = Number.NaN;
  let inY = Number.NaN;
  for (const m of placement?.markers ?? []) {
    if (m.mark === 'altar') {
      bossX = (m.tx + 1 / 2) * TILE_PX;
      bossY = (m.ty + 1 / 2) * TILE_PX;
    } else if (m.mark === 'siegel') burn.push({ tx: m.tx, ty: m.ty });
    else if (m.mark === 'eingang') {
      inX = m.tx;
      inY = m.ty;
    }
  }
  let ox = 0;
  let oy = 1;
  const toX = Number.isNaN(inX) ? site?.x : inX;
  const toY = Number.isNaN(inY) ? site?.y : inY;
  if (toX !== undefined && toY !== undefined) {
    const dx = toX - slot.x;
    const dy = toY - slot.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 0) {
      ox = dx / d;
      oy = dy / d;
    }
  }
  return {
    layer: 0,
    cx: slot.x,
    cy: slot.y,
    radiusTiles: slot.radius,
    bossX,
    bossY,
    outX: ox,
    outY: oy,
    burnTiles: burn.length > 0 ? burn : fallbackBurnTiles(slot.x, slot.y, slot.radius),
  };
}

/** The arenas of the generated world (cached per world object; read only once the world is there). */
export function worldArenaSource(): ArenaSource {
  let cachedFor: object | null = null;
  const byBiome = new Map<string, ArenaGeometry | null>();
  return (sim, biome) => {
    if (!sim.world.materialized) return null;
    const world = sim.world.generated;
    if (cachedFor !== world) {
      cachedFor = world;
      byBiome.clear();
    }
    const known = byBiome.get(biome);
    if (known !== undefined) return known;
    const slot = world.locations.find((s) => s.type === 'bossarena' && s.variant === biome);
    let arena: ArenaGeometry | null = null;
    if (slot !== undefined) {
      const site = slot.link >= 0 ? world.locations.find((s) => s.id === slot.link) : undefined;
      const layouts: readonly PlacePlacement[] | undefined = world.placeLayouts;
      arena = arenaOfSlot(slot, site, layouts?.find((p) => p.slot === slot.id));
    }
    byBiome.set(biome, arena);
    return arena;
  };
}
