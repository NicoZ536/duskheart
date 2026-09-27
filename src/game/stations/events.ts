/**
 * Events of the stations (MASTERPROMPT §2.7 "Jede Aktion hat visuelles und akustisches Feedback", §15.1,
 * §27; M4-03 … M4-06). The presentation maps them to sounds (the station's own `sounds` of src/content/stations.ts:
 * its body set up and taken down, the loop while it works, the finished batch; src/audio/baseSounds.ts), particles
 * (sparks and smoke at a working furnace) and notifications; the station screen reads the slots through the
 * session. Positions are the centre of the footprint [world px]. Catching up in frozen chunks is silent.
 *
 * - `stationPlaced` / `stationRemoved`: set up, taken down (the item or its materials into the bags).
 * - `stationOpened`: E on a station – the UI opens its screen.
 * - `stationLoaded` / `stationTaken`: pieces moved into / out of a slot area.
 * - `stationBatchStarted`: a processing station began a batch of `recipe` (`ticks` long).
 * - `stationProduced`: a batch is done, `count` × `item` lie in the output slots.
 * - `stationStopped`: a working processing station stands still – nothing left to work on (`eingang`), no
 *   fuel (`brennstoff`), output full (`ausgang`).
 * - `stationUpgraded`: an upgrade recipe turned the station into its next stage (Werkbank I → II).
 */
import type { StationArea } from './commands';
import type { StationStopReason } from './state';

/**
 * Why a station command was refused: no player, dead or asleep; the station is gone, the item no station, a campfire
 * (placed as a light); out of reach; the ground is blocked or taken, or the player stands there (`standingThere`); the
 * station is part of the build grid and comes down in build mode (`builtIn`); a crafting order is worked at it
 * (`inUse`: an upgrade in progress would otherwise find its station gone); the slot rules of processing stations
 * (no slots, wrong item, no fuel, fuel too weak, full, empty or invalid slot, full bags).
 */
export const STATION_REJECT_REASONS = [
  'noPlayer',
  'dead',
  'asleep',
  'unknownStation',
  'notAStation',
  'placedElsewhere',
  'outOfReach',
  'tileBlocked',
  'tileTaken',
  'standingThere',
  'builtIn',
  'inUse',
  'noSlots',
  'wrongItem',
  'notFuel',
  'weakFuel',
  'stationFull',
  'slotEmpty',
  'invalidSlot',
  'bagsFull',
] as const;
/** One rejection reason of the stations. */
export type StationRejectReason = (typeof STATION_REJECT_REASONS)[number];

/** Where a station stands (centre of its footprint). */
interface At {
  readonly layer: number;
  readonly x: number;
  readonly y: number;
}

export interface StationEventMap {
  stationPlaced: At & { readonly id: number; readonly station: string; readonly tx: number; readonly ty: number; readonly tick: number };
  stationRemoved: At & { readonly id: number; readonly station: string; readonly tick: number };
  stationOpened: { readonly id: number; readonly station: string; readonly tick: number };
  stationLoaded: At & { readonly id: number; readonly station: string; readonly bereich: StationArea; readonly item: string; readonly count: number; readonly tick: number };
  stationTaken: At & { readonly id: number; readonly station: string; readonly bereich: StationArea; readonly item: string; readonly count: number; readonly tick: number };
  stationBatchStarted: At & { readonly id: number; readonly station: string; readonly recipe: string; readonly ticks: number; readonly tick: number };
  stationProduced: At & { readonly id: number; readonly station: string; readonly recipe: string; readonly item: string; readonly count: number; readonly tick: number };
  stationStopped: At & { readonly id: number; readonly station: string; readonly reason: StationStopReason; readonly tick: number };
  stationUpgraded: At & { readonly id: number; readonly from: string; readonly to: string; readonly tick: number };
}

/** Event names of `StationEventMap`. */
export const STATION_EVENT_TYPES = [
  'stationPlaced',
  'stationRemoved',
  'stationOpened',
  'stationLoaded',
  'stationTaken',
  'stationBatchStarted',
  'stationProduced',
  'stationStopped',
  'stationUpgraded',
] as const satisfies ReadonlyArray<keyof StationEventMap>;
