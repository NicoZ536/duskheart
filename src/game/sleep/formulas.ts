/**
 * Sleep as pure functions (MASTERPROMPT §11.5, M3-24; tests/unit/game/schlaf.test.ts).
 *
 * - Allowed from 19:00 until the morning (06:00), or at any hour with exhaustion above 60; never with an
 *   enemy within 20 tiles (checked by the system through its threat providers).
 * - A sleep that begins outside the night (because of exhaustion) is a nap: it ends when exhaustion
 *   reaches 0. Every sleep ends at 06:00. Time runs ×30 while asleep.
 * - Exhaustion falls by 100 in 8 game hours in a bed, at half that rate on a grass bed or in a sleeping bag.
 * - "Ausgeruht" after a completed sleep in a bed: 8 min + 1 min per comfort point (§11.5), ×1,5 in a
 *   bedroom (§16.4).
 */
import { BALANCE } from '../../content/balance';
import type { SleepPlaceRules } from '../../content/balance/sleep';
import { STAT_MAX } from '../survival/formulas';

const S = BALANCE.sleep;

/** Kinds of sleeping places (item ids, `BALANCE.sleep.places`). */
export type SleepPlaceKind = keyof typeof S.places;
/** Every kind of sleeping place. */
export const SLEEP_PLACE_KINDS = Object.keys(S.places) as SleepPlaceKind[];

/** Rules of a sleeping place kind. */
export function sleepPlaceRules(kind: SleepPlaceKind): SleepPlaceRules {
  return S.places[kind];
}

/** Whether `id` names a kind of sleeping place. */
export function isSleepPlaceKind(id: string): id is SleepPlaceKind {
  return Object.hasOwn(S.places, id);
}

/** Whether the hour lies in the sleeping night: from 19:00 until 06:00. */
export function isSleepingHour(hour: number): boolean {
  return hour >= S.fromHour || hour < S.wakeHour;
}

/** Whether time and exhaustion allow sleeping (§11.5 "ab 19:00 oder bei Erschöpfung > 60"). */
export function sleepAllowed(hour: number, exhaustion: number): boolean {
  return isSleepingHour(hour) || exhaustion > S.exhaustionAbove;
}

/** Whether a sleep begun at `hour` is a nap (outside the night: it ends when exhaustion reaches 0). */
export function isNap(hour: number): boolean {
  return !isSleepingHour(hour);
}

/** Exhaustion recovered per simulated second [points/s] on a place with `recovery`; `secondsPerGameHour` of the world's clock. */
export function exhaustionRecoveryPerSecond(recovery: number, secondsPerGameHour: number): number {
  return (STAT_MAX * recovery) / (S.fullRecoveryGameHours * secondsPerGameHour);
}

/** Duration of "Ausgeruht" [s]: 8 min + 1 min per comfort point, ×1,5 in a bedroom. */
export function restedSeconds(comfort: number, bedroom: boolean): number {
  const r = S.rested;
  const c = comfort > 0 ? comfort : 0;
  return (r.baseSeconds + r.perComfortSeconds * c) * (bedroom ? r.bedroomFactor : 1);
}

/** Speed of time [factor]: ×30 while asleep (§11.5). */
export function sleepTimeScale(asleep: boolean): number {
  return asleep ? S.timeScale : 1;
}
