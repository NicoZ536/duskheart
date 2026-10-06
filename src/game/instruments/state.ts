/**
 * Saved state of making music and of the net (participant `instruments`, version 1; docs/SPIEL.md §27 "spielt gerade
 * (Instrument, Lied, Start-Tick)"):
 *
 * - `spielt`: the music being played – instrument, song, start tick and the slot it is played from – or null.
 * - `gespielt`: how many times the player began to play (the songs take turns).
 * - `netzZuege`: swings of the net so far (the cricket draw, src/game/instruments/formulas.ts).
 * - `schwaerme`: fireflies taken from each swarm per night (by the swarm's serial number, at most
 *   `BALANCE.instruments.maxRememberedSwarms`, the oldest night first out).
 */
import { z } from 'zod';
import { slotRefSchema } from '../inventory/commands';
import type { SlotRef } from '../items/slots';

export interface Playing {
  readonly instrument: string;
  readonly lied: string;
  readonly startTick: number;
  readonly from: SlotRef;
}

export interface SwarmCatch {
  readonly serial: number;
  readonly nacht: number;
  gefangen: number;
}

export interface InstrumentsState {
  spielt: Playing | null;
  gespielt: number;
  netzZuege: number;
  schwaerme: SwarmCatch[];
}

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const instrumentsStateSchema = z
  .object({
    spielt: z.object({ instrument: z.string().min(1), lied: z.string().min(1), startTick: count, from: slotRefSchema }).strict().nullable(),
    gespielt: count,
    netzZuege: count,
    schwaerme: z.array(z.object({ serial: count, nacht: z.number().int(), gefangen: count }).strict()),
  })
  .strict();

/** The state of a world nobody played music in. */
export function createInstrumentsState(): InstrumentsState {
  return { spielt: null, gespielt: 0, netzZuege: 0, schwaerme: [] };
}

/** A deep copy (the snapshot owns its data). */
export function copyInstrumentsState(s: InstrumentsState): InstrumentsState {
  return {
    spielt: s.spielt === null ? null : { ...s.spielt, from: { ...s.spielt.from } },
    gespielt: s.gespielt,
    netzZuege: s.netzZuege,
    schwaerme: s.schwaerme.map((w) => ({ ...w })),
  };
}
