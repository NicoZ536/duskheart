/**
 * State of the stations (MASTERPROMPT §15.1, §15.2; M4-03 … M4-06) and its save form (participant `stations`).
 *
 * - `placed`: every placed station – id, station id (changes with an upgrade), anchor tile (north-west tile of
 *   its footprint), layer and – when the building grid turned it – its footprint (`groesse`, else the station's)
 *   – and, for processing stations, their slots and batch:
 *   `eingang` (input), `brennstoff` (the fuel slot, a stack), `ausgang` (output); `glut` the heat left of the
 *   fuel piece burning now [work ticks] (`glutVoll` what that piece gave, 0 = none burning); `rezept`, `fortschritt`
 *   and `dauer` the batch in progress [ticks]; `laeuft` whether it worked in its last tick.
 * - `tempoBonus`: the bonus a processing station works with – the skill bonus of a station with a skill of its own
 *   (§23.2 "+0,5 % Wirkung je Stufe": Schmieden at the smelting furnace, taken from the player who loaded it last) plus
 *   the tempo of the workshop it stands in (§16.4 "+15 %"), both taken when it was loaded last; absent = none.
 * - `gesetzt`: the tick the player set it up (`station.place`) while that is within the full refund window
 *   (§16.6 "100 % zurück in den ersten 30 s"): taking it down then gives the item back whole, and once the window
 *   has passed it gives its building experience and the field goes; absent = settled (or placed without spending
 *   an item: a part of the build grid, tests).
 * - `gespiegelt`: set up mirrored (the build menu's F); absent = as drawn.
 * - `bis`: the tick the station is advanced to (exclusive: its state is the one at the start of tick `bis`).
 *   Stations in active chunks advance every tick, frozen ones catch up from `bis` when their chunk activates
 *   (docs/ARCHITEKTUR.md "Aktive Zone") – the timestamp of §15.1 "holen in entladenen Chunks per Zeitstempel auf".
 * - `nextId`: id of the next placed station (ids start at 1, never reused).
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { idSchema } from '../../content/schema/common';
import { STATION_SIDE_MAX, STATION_SLOTS_MAX } from '../../content/stations';
import type { Layer } from '../../world/model/coords';
import { copyStack } from '../inventory/snapshot';
import { itemStackSchema, type ItemStack } from '../items/stack';

/** Deepest world layer (docs/WORLD.md §1). */
const LAYER_MIN = -3;
/**
 * Largest skill bonus of a station [fraction]: a skill at its last level (§23.2, +0,5 % per level above the first) plus
 * the workshop's tempo (§16.4 "+15 %").
 */
const MAX_TEMPO_BONUS = (BALANCE.skills.maxLevel - BALANCE.skills.minLevel) * BALANCE.skills.bonusPerLevel + BALANCE.rooms.effects.workshopTempo;

/** Why a processing station stands still: nothing to work on, no fuel, the output is full. */
export const STATION_STOP_REASONS = ['eingang', 'brennstoff', 'ausgang'] as const;
/** One reason. */
export type StationStopReason = (typeof STATION_STOP_REASONS)[number];

/** Slots and batch of a processing station. */
export interface ProcessingState {
  readonly eingang: (ItemStack | null)[];
  brennstoff: ItemStack | null;
  readonly ausgang: (ItemStack | null)[];
  /** Heat left of the burning fuel piece [ticks of work]. */
  glut: number;
  /** Heat that piece gave [ticks of work]; 0 = no piece burning. */
  glutVoll: number;
  /** Recipe of the batch in progress, or `null`. */
  rezept: string | null;
  /** Ticks worked on the batch. */
  fortschritt: number;
  /** Ticks the batch takes (fixed when it began); 0 without a batch. */
  dauer: number;
  /** Whether the station worked in its last tick (the loop sound, the glow). */
  laeuft: boolean;
  /** Why it stands still (`null` while it works or has never run). */
  halt: StationStopReason | null;
}

/** A placed station. */
export interface PlacedStation {
  readonly id: number;
  /** Station id (= its item); an upgrade changes it. */
  station: string;
  readonly layer: Layer;
  /** Anchor tile: the north-west tile of the footprint. */
  readonly tx: number;
  readonly ty: number;
  /** Footprint [tiles] when it differs from the station's (turned by the building grid). */
  readonly groesse?: { readonly b: number; readonly t: number };
  /** Skill and workshop bonus its batches run with [fraction; batches take 1 + bonus times less] – absent: none. */
  tempoBonus?: number;
  /** Tick the player set it up, while within the full refund window (its building experience still due). */
  gesetzt?: number;
  /** Set up mirrored. */
  readonly gespiegelt?: true;
  /** Slots and batch of a processing station, `null` for hand stations. */
  proc: ProcessingState | null;
  /** Tick the station is advanced to (exclusive). */
  bis: number;
}

/** The state of all placed stations. */
export interface StationsState {
  readonly placed: PlacedStation[];
  nextId: number;
}

/** No placed stations. */
export function createStationsState(): StationsState {
  return { placed: [], nextId: 1 };
}

/** Empty slots and no batch for a processing station with `eingang` input and `ausgang` output slots. */
export function emptyProcessing(eingang: number, ausgang: number): ProcessingState {
  return {
    eingang: Array.from({ length: eingang }, () => null),
    brennstoff: null,
    ausgang: Array.from({ length: ausgang }, () => null),
    glut: 0,
    glutVoll: 0,
    rezept: null,
    fortschritt: 0,
    dauer: 0,
    laeuft: false,
    halt: null,
  };
}

const slot = itemStackSchema.nullable();
const ticks = z.number().int().min(0);

/** Save form of a processing station. */
export const processingSnapshotSchema = z
  .object({
    eingang: z.array(slot).min(1).max(STATION_SLOTS_MAX),
    brennstoff: slot,
    ausgang: z.array(slot).min(1).max(STATION_SLOTS_MAX),
    glut: ticks,
    glutVoll: ticks,
    rezept: idSchema.nullable(),
    fortschritt: ticks,
    dauer: ticks,
    laeuft: z.boolean(),
    halt: z.enum(STATION_STOP_REASONS).nullable(),
  })
  .strict()
  .refine((p) => p.glut <= p.glutVoll, { message: 'heat left lies within the burning piece' })
  .refine((p) => (p.rezept === null ? p.fortschritt === 0 && p.dauer === 0 : p.dauer > 0 && p.fortschritt < p.dauer), { message: 'progress lies within the batch' });

/** Save form of the stations. */
export const stationsSnapshotSchema = z
  .object({
    placed: z.array(
      z
        .object({
          id: z.number().int().min(1),
          station: idSchema,
          layer: z.number().int().min(LAYER_MIN).max(0),
          tx: z.number().int().min(0),
          ty: z.number().int().min(0),
          groesse: z.object({ b: z.number().int().min(1).max(STATION_SIDE_MAX), t: z.number().int().min(1).max(STATION_SIDE_MAX) }).strict().optional(),
          tempoBonus: z.number().positive().max(MAX_TEMPO_BONUS).optional(),
          gesetzt: ticks.optional(),
          gespiegelt: z.literal(true).optional(),
          proc: processingSnapshotSchema.nullable(),
          bis: ticks,
        })
        .strict(),
    ),
    nextId: z.number().int().min(1),
  })
  .strict()
  .refine((s) => new Set(s.placed.map((p) => p.id)).size === s.placed.length, { message: 'station ids must be unique' })
  .refine((s) => s.placed.every((p) => p.id < s.nextId), { message: 'every id lies below nextId' });

/** Save form of the stations. */
export type StationsSnapshot = z.output<typeof stationsSnapshotSchema>;

function copyProcessing(p: ProcessingState): ProcessingState {
  return {
    eingang: p.eingang.map((s) => (s === null ? null : copyStack(s))),
    brennstoff: p.brennstoff === null ? null : copyStack(p.brennstoff),
    ausgang: p.ausgang.map((s) => (s === null ? null : copyStack(s))),
    glut: p.glut,
    glutVoll: p.glutVoll,
    rezept: p.rezept,
    fortschritt: p.fortschritt,
    dauer: p.dauer,
    laeuft: p.laeuft,
    halt: p.halt,
  };
}

/** A deep copy of `state` (the save form; also for tests comparing states). */
export function copyStationsState(state: StationsState): StationsState {
  return {
    placed: state.placed.map((p) => ({
      id: p.id,
      station: p.station,
      layer: p.layer,
      tx: p.tx,
      ty: p.ty,
      ...(p.groesse === undefined ? {} : { groesse: { b: p.groesse.b, t: p.groesse.t } }),
      ...(p.tempoBonus === undefined ? {} : { tempoBonus: p.tempoBonus }),
      ...(p.gesetzt === undefined ? {} : { gesetzt: p.gesetzt }),
      ...(p.gespiegelt === true ? { gespiegelt: true as const } : {}),
      proc: p.proc === null ? null : copyProcessing(p.proc),
      bis: p.bis,
    })),
    nextId: state.nextId,
  };
}
