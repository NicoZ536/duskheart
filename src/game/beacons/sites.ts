/**
 * Where the beacons stand (docs/SPIEL.md §22 "`beacon.ignite` (E an der Marke `leuchtfeuer` der Stätte; ohne Ortsvorlage am
 * Slot-Mittelpunkt – so arbeitet F unabhängig von B)"; M7-35): the beacon of biome n stands at the mark `leuchtfeuer` of the
 * layout stamped on its site (`GeneratedWorld.placeLayouts`, strand B), else at the centre of the `leuchtfeuer` slot of its
 * biome. The world's regions (centroid and biome) come along for the healing (`BeaconsApi.healing`). Tests hand in sites on
 * drawn maps.
 */
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { PlacePlacement } from '../../world/gen/places/types';
import type { Simulation } from '../sim';

/** A beacon's place. */
export interface BeaconSite {
  readonly layer: Layer;
  /** Centre tile of the 3 × 3 beacon. */
  readonly tx: number;
  readonly ty: number;
  /** Centre [world px]. */
  readonly x: number;
  readonly y: number;
}

/** A region of the world for the healing: centre [tiles] and biome. */
export interface HealingRegion {
  readonly x: number;
  readonly y: number;
  readonly biome: string;
}

/** The sites and regions of a world. */
export interface BeaconWorld {
  /** Site per beacon biome (`null`: the world has none). */
  site(biome: string): BeaconSite | null;
  /** Regions by id (the plan's regions). */
  readonly regions: readonly HealingRegion[];
  /** Region of a surface tile, or −1. */
  regionAt(tx: number, ty: number): number;
}

/** Finds the world of the beacons, or null while the world is not there. */
export type BeaconWorldSource = (sim: Simulation) => BeaconWorld | null;

/** A site at tile (tx, ty) of `layer`. */
export function siteAt(layer: Layer, tx: number, ty: number): BeaconSite {
  return { layer, tx, ty, x: (tx + 1 / 2) * TILE_PX, y: (ty + 1 / 2) * TILE_PX };
}

/** The beacons of the generated world (built once per world object, only once the world is there). */
export function worldBeaconSource(): BeaconWorldSource {
  let cachedFor: object | null = null;
  let cached: BeaconWorld | null = null;
  return (sim) => {
    if (!sim.world.materialized) return null;
    const g = sim.world.generated;
    if (cachedFor === g && cached !== null) return cached;
    cachedFor = g;
    const layouts: readonly PlacePlacement[] | undefined = g.placeLayouts;
    const sites = new Map<string, BeaconSite>();
    for (const slot of g.locations) {
      if (slot.type !== 'leuchtfeuer') continue;
      const mark = layouts?.find((p) => p.slot === slot.id)?.markers.find((m) => m.mark === 'leuchtfeuer');
      sites.set(slot.variant, mark === undefined ? siteAt(0, slot.x, slot.y) : siteAt(0, mark.tx, mark.ty));
    }
    const regions = g.plan.regions.map((r) => ({ x: r.centroidX, y: r.centroidY, biome: r.biome }));
    const world = sim.world;
    cached = { site: (biome) => sites.get(biome) ?? null, regions, regionAt: (tx, ty) => world.regionAt(tx, ty) };
    return cached;
  };
}
