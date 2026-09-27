/**
 * Debug query of a room (M4-15 … M4-18; `__dh.call('room', tx?, ty?, layer?)`): what the rooms system derives for a
 * tile – enclosure, interior, size, roof, type, climate, contents and comfort – read only, for E2E tests and the
 * console (the build mode shows the same through its room overlay, src/render/game/overlays.ts). Rooms have no state
 * of their own (derived from the buildings and the terrain, ADR-0038), so reading one never changes the simulation.
 */
import type { RoomsSystem } from '../game/rooms/system';
import type { Simulation } from '../game/sim';
import { isLayer, type Layer } from '../world/model/coords';

/** A room as `__dh.call('room')` reports it. */
export interface DebugRoom {
  readonly layer: Layer;
  /** Smallest tile key of the region (stable while it is unchanged). */
  readonly id: number;
  /** Enclosed interior: at least 90 % under a roof. */
  readonly interior: boolean;
  readonly size: number;
  readonly roofed: number;
  /** Room type id (src/content/roomTypes.ts), or null. */
  readonly type: string | null;
  /** Room temperature, outside air and the heat of the sources inside [°C]; insulation [0–1]. */
  readonly temperatureC: number;
  readonly outsideC: number;
  readonly sourcesC: number;
  readonly insulation: number;
  /** Lights in the room (lamps, burning torches and fires). */
  readonly lights: number;
  /** Furniture per category (own furniture, wall furniture, stations and lights of other systems). */
  readonly furniture: Readonly<Record<string, number>>;
  /** Comfort 0–20. */
  readonly comfort: number;
}

/**
 * The room at tile (tx, ty) of `layer` (default 0, the surface), or – without coordinates – the room the player
 * stands in; null outdoors, on walls and without a player.
 */
export function describeRoom(sim: Simulation, tx?: unknown, ty?: unknown, layer?: unknown): DebugRoom | null {
  const rooms = sim.system('rooms') as RoomsSystem;
  if (tx !== undefined || ty !== undefined) {
    if (!Number.isInteger(tx) || !Number.isInteger(ty)) throw new TypeError('room erwartet ganze Kacheln (tx, ty)');
    if (layer !== undefined && !isLayer(layer)) throw new TypeError(`room: Ebene ${String(layer)} gibt es nicht (0, −1, −2, −3)`);
  }
  const at = tx === undefined ? rooms.playerRoom(sim) : rooms.roomAt(sim, (layer as Layer | undefined) ?? 0, tx as number, ty as number);
  if (at === null) return null;
  const r = at.region;
  return {
    layer: r.layer,
    id: r.id,
    interior: r.interior,
    size: r.size,
    roofed: r.roofed,
    type: at.type?.id ?? null,
    temperatureC: at.temperatureC,
    outsideC: at.outsideC,
    sourcesC: at.sourcesC,
    insulation: at.insulation,
    lights: at.contents.lights,
    furniture: { ...at.contents.furniture },
    comfort: at.comfort.total,
  };
}
