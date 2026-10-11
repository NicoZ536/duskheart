/**
 * Progress of a trigger for the presentation (docs/SPIEL.md §30 "Aufgaben-Tracker – sampleQuests"; M7-41, M7-42): how far a
 * quest step or an achievement is – "2/3 Bäume", "18/25 Kreaturen". A countable trigger has a goal: an event with `anzahl`
 * (its armed counter), a statistic (its value against `mindestens`), possession (the pieces carried against `anzahl`), a place
 * type (discovered against `anzahl`). Everything else (a state, a time, a combination) has none (`need` 0): the HUD shows the
 * step without a bar. Reads the bound trigger world; writes into a held record (no allocation).
 */
import type { Trigger } from '../../content/schema/trigger';
import type { ArmedTrigger, TriggerWorld } from './types';

/** A trigger's progress: `count` of `need` (`need` 0: not countable). */
export interface TriggerProgress {
  count: number;
  need: number;
}

/** A fresh progress record. */
export function createTriggerProgress(): TriggerProgress {
  return { count: 0, need: 0 };
}

/** Fills `out` with the progress of `trigger` (armed as `armed`, or not yet armed: `null`) in `world`; returns it. */
export function triggerProgress(trigger: Trigger, armed: Pick<ArmedTrigger, 'count'> | null, world: TriggerWorld, out: TriggerProgress): TriggerProgress {
  switch (trigger.art) {
    case 'ereignis':
      out.need = trigger.anzahl ?? 1;
      out.count = armed === null ? 0 : Math.min(armed.count, out.need);
      return out;
    case 'statistik':
      out.need = trigger.mindestens;
      out.count = Math.min(world.statValue(trigger.statistik, trigger.schluessel), out.need);
      return out;
    case 'besitz':
      out.need = trigger.anzahl;
      out.count = Math.min(world.carried(trigger.item), out.need);
      return out;
    case 'ort':
      out.need = trigger.anzahl ?? 1;
      out.count = Math.min(world.placesDiscovered(trigger.ortstyp), out.need);
      return out;
    default:
      out.need = 0;
      out.count = 0;
      return out;
  }
}
