/**
 * Game clock (docs/ARCHITEKTUR.md "Zeit", MASTERPROMPT §3.3, §10).
 *
 * Time exists only as simulation ticks. `GameClock` counts ticks and derives the time of day:
 * - A game day lasts `dayLengthMinutes` real minutes (12/24/36/48, default 24 → 1 game hour =
 *   1 real minute = 3600 ticks at 60 Hz).
 * - The world starts at 06:00 of day 1. Days are numbered from 1 and change at midnight.
 * - `advance()` moves one tick forward and reports the slow hooks: the world tick (every
 *   `tickHz / worldTickHz` ticks, i.e. 1 Hz) and the daily tick (whenever 06:00 is crossed).
 *
 * The position within the day is stored separately from the total tick count, so the day length
 * can change during a game (§29 "Tageslänge" slider) without the time of day jumping.
 * Pause and time scale are handled by the loop (`FixedStepLoop`): no tick, no time.
 * Seasons, moon and weather are built on top of this clock in `src/world/calendar.ts`.
 */
import { z } from 'zod';

/** Selectable real minutes per game day (§10: 12/24/36/48). */
export const DAY_LENGTH_OPTIONS = [12, 24, 36, 48] as const;
/** A selectable day length in real minutes. */
export type DayLengthMinutes = (typeof DAY_LENGTH_OPTIONS)[number];

/** Game minutes per game hour. */
export const MINUTES_PER_HOUR = 60;
/** Game hours per game day. */
export const HOURS_PER_DAY = 24;
/** Game minutes per game day. */
export const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;
/** Real seconds per real minute (day lengths are given in real minutes). */
export const SECONDS_PER_MINUTE = 60;
/** Hour of the daily tick and of the world start (§3.3 "Tages-Tick um 06:00", start of day 1). */
export const DAWN_HOUR = 6;
/** Minute of day of the daily tick and of the world start (06:00). */
export const DAWN_MINUTE = DAWN_HOUR * MINUTES_PER_HOUR;
/** Game minutes from 06:00 to the following midnight. */
const DAWN_TO_MIDNIGHT_MINUTES = MINUTES_PER_DAY - DAWN_MINUTE;
/** Current `GameClockSnapshot` format version. */
export const CLOCK_SNAPSHOT_VERSION = 1;

/** Construction parameters (the simulation passes the values from `BALANCE.time`). */
export interface GameClockOptions {
  /** Simulation ticks per real second (60). Positive integer. */
  readonly tickHz: number;
  /** World ticks per real second (1). `tickHz` must be a whole multiple of it. */
  readonly worldTickHz: number;
  /** Real minutes per game day. */
  readonly dayLengthMinutes: DayLengthMinutes;
}

/** Slow hooks due after one `advance()`. */
export interface ClockAdvance {
  /** A world tick (1 Hz) is due. */
  readonly worldTick: boolean;
  /** 06:00 was reached: the daily tick is due. */
  readonly dailyTick: boolean;
}

/** Serialized clock state (plain JSON data). */
export interface GameClockSnapshot {
  readonly version: number;
  /** Total ticks since the world was created. */
  readonly tick: number;
  readonly dayLengthMinutes: DayLengthMinutes;
  /** Number of 06:00 crossings since the world was created. */
  readonly dawns: number;
  /** Ticks since the last 06:00 (0 ≤ dayTick < ticks per day). */
  readonly dayTick: number;
}

/** Pre-built results so `advance()` never allocates: index = worldTick | dailyTick << 1. */
const ADVANCE_RESULTS: readonly ClockAdvance[] = [
  Object.freeze({ worldTick: false, dailyTick: false }),
  Object.freeze({ worldTick: true, dailyTick: false }),
  Object.freeze({ worldTick: false, dailyTick: true }),
  Object.freeze({ worldTick: true, dailyTick: true }),
];
const DAILY_FLAG = 2;

const nonNegativeInt = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const dayLengthSchema = z.literal(DAY_LENGTH_OPTIONS);

/** zod schema of `GameClockSnapshot` (range of `dayTick` is checked against the day length). */
export const gameClockSnapshotSchema = z
  .object({
    version: z.literal(CLOCK_SNAPSHOT_VERSION),
    tick: nonNegativeInt,
    dayLengthMinutes: dayLengthSchema,
    dawns: nonNegativeInt,
    dayTick: nonNegativeInt,
  })
  .strict();

/** Whether `minutes` is one of the selectable day lengths. */
export function isDayLength(minutes: number): minutes is DayLengthMinutes {
  return (DAY_LENGTH_OPTIONS as readonly number[]).includes(minutes);
}

/** Ticks per game day for a day length and tick rate. */
export function ticksPerDayFor(dayLengthMinutes: DayLengthMinutes, tickHz: number): number {
  return dayLengthMinutes * SECONDS_PER_MINUTE * tickHz;
}

/** Tick counter with time of day, day number and the world/daily tick hooks. */
export class GameClock {
  /** Simulation ticks per real second. */
  readonly tickHz: number;
  /** Ticks between two world ticks. */
  readonly worldTickInterval: number;
  private tickCount = 0;
  private dawnCount = 0;
  private ticksSinceDawn = 0;
  private dayLength: DayLengthMinutes;
  private dayTicks: number;

  constructor(options: GameClockOptions) {
    const { tickHz, worldTickHz, dayLengthMinutes } = options;
    if (!Number.isInteger(tickHz) || tickHz < 1) throw new RangeError(`GameClock: tickHz must be an integer ≥ 1, got ${String(tickHz)}`);
    if (!(worldTickHz > 0) || !Number.isInteger(tickHz / worldTickHz)) {
      throw new RangeError(`GameClock: tickHz (${tickHz}) must be a whole multiple of worldTickHz (${String(worldTickHz)})`);
    }
    if (!isDayLength(dayLengthMinutes)) throw new RangeError(`GameClock: day length must be one of ${DAY_LENGTH_OPTIONS.join('/')}, got ${String(dayLengthMinutes)}`);
    this.tickHz = tickHz;
    this.worldTickInterval = tickHz / worldTickHz;
    this.dayLength = dayLengthMinutes;
    this.dayTicks = ticksPerDayFor(dayLengthMinutes, tickHz);
  }

  /** Total ticks since the world was created. */
  get tick(): number {
    return this.tickCount;
  }

  /** Real minutes per game day. */
  get dayLengthMinutes(): DayLengthMinutes {
    return this.dayLength;
  }

  /** Ticks per game day. */
  get ticksPerDay(): number {
    return this.dayTicks;
  }

  /** Ticks per game hour (3600 at a 24 minute day). */
  get ticksPerGameHour(): number {
    return this.dayTicks / HOURS_PER_DAY;
  }

  /** Ticks per game minute (60 at a 24 minute day). */
  get ticksPerGameMinute(): number {
    return this.dayTicks / MINUTES_PER_DAY;
  }

  /** Ticks since the last 06:00. */
  get dayTick(): number {
    return this.ticksSinceDawn;
  }

  /** Number of 06:00 crossings (= daily ticks) since the world was created. */
  get dawns(): number {
    return this.dawnCount;
  }

  /** Whole game minute of the day, 0–1439 (0 = midnight). */
  get minuteOfDay(): number {
    return (DAWN_MINUTE + Math.floor((this.ticksSinceDawn * MINUTES_PER_DAY) / this.dayTicks)) % MINUTES_PER_DAY;
  }

  /** Game hour, 0–23. */
  get hour(): number {
    return Math.floor(this.minuteOfDay / MINUTES_PER_HOUR);
  }

  /** Game minute within the hour, 0–59. */
  get minute(): number {
    return this.minuteOfDay % MINUTES_PER_HOUR;
  }

  /** Day number starting at 1; changes at midnight. */
  get day(): number {
    const pastMidnight = this.ticksSinceDawn * MINUTES_PER_DAY >= DAWN_TO_MIDNIGHT_MINUTES * this.dayTicks;
    return this.dawnCount + 1 + (pastMidnight ? 1 : 0);
  }

  /** Continuous position in the day in [0, 1): 0 = midnight, 0.25 = 06:00, 0.5 = noon. */
  get dayFraction(): number {
    const scale = MINUTES_PER_DAY * this.dayTicks;
    return ((DAWN_MINUTE * this.dayTicks + this.ticksSinceDawn * MINUTES_PER_DAY) % scale) / scale;
  }

  /** Moves one tick forward. The returned object is shared and immutable. */
  advance(): ClockAdvance {
    this.tickCount++;
    this.ticksSinceDawn++;
    let daily = 0;
    if (this.ticksSinceDawn >= this.dayTicks) {
      this.ticksSinceDawn -= this.dayTicks;
      this.dawnCount++;
      daily = DAILY_FLAG;
    }
    const world = this.tickCount % this.worldTickInterval === 0 ? 1 : 0;
    return ADVANCE_RESULTS[world | daily] as ClockAdvance;
  }

  /**
   * Sets the total tick count and derives the time of day from it as if the current day length had
   * applied since the world was created (fresh worlds, debug jumps). Saves restore the exact state
   * with `deserialize` instead.
   */
  setTick(tick: number): void {
    if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError(`GameClock: tick must be an integer ≥ 0, got ${String(tick)}`);
    this.tickCount = tick;
    this.dawnCount = Math.floor(tick / this.dayTicks);
    this.ticksSinceDawn = tick % this.dayTicks;
  }

  /** Changes the day length and keeps the current time of day (rounded down to a whole tick). */
  setDayLength(minutes: DayLengthMinutes): void {
    if (!isDayLength(minutes)) throw new RangeError(`GameClock: day length must be one of ${DAY_LENGTH_OPTIONS.join('/')}, got ${String(minutes)}`);
    const next = ticksPerDayFor(minutes, this.tickHz);
    this.ticksSinceDawn = Math.floor((this.ticksSinceDawn * next) / this.dayTicks);
    this.dayLength = minutes;
    this.dayTicks = next;
  }

  /** Plain JSON snapshot of the clock state. */
  serialize(): GameClockSnapshot {
    return {
      version: CLOCK_SNAPSHOT_VERSION,
      tick: this.tickCount,
      dayLengthMinutes: this.dayLength,
      dawns: this.dawnCount,
      dayTick: this.ticksSinceDawn,
    };
  }

  /** Restores a snapshot from `serialize()`. Throws on malformed data and leaves the clock unchanged. */
  deserialize(data: unknown): void {
    const parsed = gameClockSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`GameClock snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    const s = parsed.data;
    const dayTicks = ticksPerDayFor(s.dayLengthMinutes, this.tickHz);
    if (s.dayTick >= dayTicks) throw new TypeError(`GameClock snapshot invalid: dayTick ${s.dayTick} ≥ ticks per day ${dayTicks}`);
    this.tickCount = s.tick;
    this.dawnCount = s.dawns;
    this.ticksSinceDawn = s.dayTick;
    this.dayLength = s.dayLengthMinutes;
    this.dayTicks = dayTicks;
  }
}
