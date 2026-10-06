/**
 * Saved state of fast travel (participant `travel`, version 1; docs/SPIEL.md §27): the waystones standing in the world
 * (their number, place and name) and the next number. Lit beacons and burning hearths are travel points by their own
 * systems' state; only the waystones – placed parts of the build grid without state of their own – are kept here. A save
 * without the participant (versions 1–3) loads with none.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';

/** One waystone. */
export interface Waystone {
  readonly id: number;
  readonly layer: number;
  readonly tx: number;
  readonly ty: number;
  name: string;
}

/** The travel state. */
export interface TravelState {
  nextWaystone: number;
  readonly waystones: Waystone[];
}

/** A state without waystones. */
export function createTravelState(): TravelState {
  return { nextWaystone: 1, waystones: [] };
}

const waystoneSchema = z
  .object({ id: z.number().int().min(1), layer: z.number().int(), tx: z.number().int().min(0), ty: z.number().int().min(0), name: z.string().max(BALANCE.travel.nameMaxLength) })
  .strict();

/** The saved form: waystones with unique numbers below `nextWaystone` and unique tiles. */
export const travelSnapshotSchema = z
  .object({ nextWaystone: z.number().int().min(1), waystones: z.array(waystoneSchema) })
  .strict()
  .superRefine((s, ctx) => {
    const ids = s.waystones.map((w) => w.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['waystones'], message: 'waystone numbers are unique' });
    if (s.waystones.some((w) => w.id >= s.nextWaystone)) ctx.addIssue({ code: 'custom', path: ['nextWaystone'], message: 'nextWaystone lies above every waystone' });
    const tiles = s.waystones.map((w) => `${w.layer}:${w.tx}:${w.ty}`);
    if (new Set(tiles).size !== tiles.length) ctx.addIssue({ code: 'custom', path: ['waystones'], message: 'one waystone per tile' });
  });
/** The saved form of fast travel. */
export type TravelSnapshot = z.output<typeof travelSnapshotSchema>;

/** A deep copy (serialisation, restore). */
export function copyTravelState(s: Readonly<TravelState>): TravelState {
  return { nextWaystone: s.nextWaystone, waystones: s.waystones.map((w) => ({ ...w })) };
}
