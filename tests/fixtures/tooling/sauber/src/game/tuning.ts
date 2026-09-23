/** Named module constants and self-explanatory numbers are allowed in system code. */
const CRIT_MULTIPLIER = 1.75;
const FLAT_BONUS = 13;

export function critDamage(base: number): number {
  return base * CRIT_MULTIPLIER + FLAT_BONUS;
}

export function halve(value: number): number {
  return value * 0.5;
}

export function percent(fraction: number): number {
  return fraction * 100;
}

export enum Facing {
  Down = 0,
  Left = 3,
  Right = 7,
}

export type HotbarSlot = 1 | 2 | 3 | 4;

export class Cooldown {
  readonly lengthTicks = 45;
  remaining = 12;

  reset(ticks = 30): void {
    this.remaining = ticks;
  }
}

export function lastOfFive(values: readonly number[]): number | undefined {
  return values[4];
}

/** Text and regex mentioning banned APIs are data, not calls. */
export const RANDOM_CALL = /Math\.random\(/;
export const describeClock = (tick: number): string => `performance.now() ${tick} Date.now()`;
