/**
 * Calendar on top of `GameClock` (MASTERPROMPT §10, docs/WORLD.md §6, M2-24).
 *
 * - **Seasons:** spring → summer → autumn → winter, each `seasonLengthDays` long (default 7,
 *   selectable 3–14); day 1 is the first day of spring. Days change at midnight (`GameClock.day`).
 *   Changing the season length during a game keeps the current season and day of season (clamped
 *   to the new length) and records a segment, so every past day keeps its season.
 * - **Day and night:** the full-darkness night is centred on midnight and lasts 8 h in spring and
 *   autumn, 5 h in summer and 11 h in winter; a 2 h twilight blends into day on each side. The sun
 *   rises at the end of the morning twilight and sets at the start of the evening twilight, so a
 *   spring day runs 06:00–18:00 (dawn 04–06, dusk 18–20), summer 04:30–19:30, winter 07:30–16:30.
 *   The evening half of a night follows the evening's season, the morning half the next day's.
 * - **Moon:** 8-day cycle; a night belongs to the day on whose evening it starts (the phase changes
 *   at noon). Phase 0 is the new moon = **Finstermond**, phase 4 the full moon (brightest night).
 * - **Light:** ambient light 1,0 by day, 0,05–0,12 by night depending on the moon, 0,02 on a
 *   Finstermond (§12.1), smoothly blended through the twilight.
 * - **Shadows:** sun (by day) or moon (by night) as a shadow vector for the renderer's shadow pass
 *   (§6.1 pass 4): direction on screen (+x east, +y south), length per unit caster height and
 *   strength. The sun rises in the east, stands in the south at noon (shadows point north, short)
 *   and sets in the west.
 *
 * Game logic (day phase, daylight, moon, light levels) uses only + − × ÷ so it is bit-identical on
 * every device; only the shadow vectors, which feed nothing but rendering, use trigonometry.
 * The only saved state is the season length history (`save`, participant id `calendar`).
 */
import { z } from 'zod';
import { BALANCE, SEASON_IDS, type SeasonId } from '../content/balance';
import { smoothstep } from '../engine/math';
import { HOURS_PER_DAY, type GameClock } from '../engine/time';

// ---------------------------------------------------------------------------------------------
// Constants and tables
// ---------------------------------------------------------------------------------------------

/** Seasons in calendar order (ids match the foliage palette rows). */
export const SEASONS = SEASON_IDS;
/** One season. */
export type Season = SeasonId;
/** Number of seasons per year. */
export const SEASON_COUNT = SEASONS.length;

/** Phases of a day. */
export const DAY_PHASES = ['nacht', 'morgendaemmerung', 'tag', 'abenddaemmerung'] as const;
/** One day phase. */
export type DayPhase = (typeof DAY_PHASES)[number];

/** Hour at which a night's moon phase changes (the night belongs to the day of its evening). */
export const NOON_HOUR = HOURS_PER_DAY / 2;
/** Moon phase of the new moon (Finstermond). */
export const NEW_MOON_PHASE = 0;
/** Length of the moon cycle [days]. */
export const MOON_CYCLE_DAYS = BALANCE.calendar.moonCycleDays;
/** Moon phase of the full moon. */
export const FULL_MOON_PHASE = MOON_CYCLE_DAYS / 2;

const HALF_TURN_DEG = 180;
const DEG_TO_RAD = Math.PI / HALF_TURN_DEG;
/** First day of the calendar. */
const FIRST_DAY = 1;

/** Clock times of one season's day [hours after midnight]. */
export interface DayTimes {
  /** Full-darkness night length [h]. */
  readonly nightHours: number;
  /** Length of each twilight [h]. */
  readonly twilightHours: number;
  /** End of the night, start of the morning twilight. */
  readonly dawnStart: number;
  /** End of the morning twilight: sunrise, full daylight. */
  readonly sunrise: number;
  /** Start of the evening twilight: sunset. */
  readonly sunset: number;
  /** End of the evening twilight, start of the night. */
  readonly duskEnd: number;
  /** Hours between sunrise and sunset. */
  readonly dayHours: number;
}

function buildDayTimes(season: Season): DayTimes {
  const nightHours = BALANCE.calendar.nightHours[season];
  const twilightHours = BALANCE.calendar.twilightHours;
  const dayHours = HOURS_PER_DAY - nightHours - 2 * twilightHours;
  if (!(nightHours > 0) || !(twilightHours > 0) || !(dayHours > 0)) {
    throw new RangeError(`Calendar: night ${String(nightHours)} h + 2 × twilight ${String(twilightHours)} h must leave daylight in ${season}`);
  }
  const dawnStart = nightHours / 2;
  const duskEnd = HOURS_PER_DAY - nightHours / 2;
  return Object.freeze({ nightHours, twilightHours, dawnStart, sunrise: dawnStart + twilightHours, sunset: duskEnd - twilightHours, duskEnd, dayHours });
}

const DAY_TIMES: Readonly<Record<Season, DayTimes>> = Object.freeze({
  fruehling: buildDayTimes('fruehling'),
  sommer: buildDayTimes('sommer'),
  herbst: buildDayTimes('herbst'),
  winter: buildDayTimes('winter'),
});

if (!Number.isInteger(MOON_CYCLE_DAYS) || MOON_CYCLE_DAYS < 2 || MOON_CYCLE_DAYS % 2 !== 0) {
  throw new RangeError(`Calendar: moon cycle must be an even number of days ≥ 2, got ${String(MOON_CYCLE_DAYS)}`);
}

// ---------------------------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------------------------

/** Clock times of a season's day. */
export function dayTimes(season: Season): DayTimes {
  return DAY_TIMES[season];
}

/** Temperature offset of a season [°C] (§9.3). */
export function seasonTemperatureOffsetC(season: Season): number {
  return BALANCE.calendar.seasonTemperatureOffsetC[season];
}

/**
 * Daylight factor in [0, 1] at `hour` (0 ≤ hour < 24) of a day in `season`: 0 at night, 1 by day,
 * smooth (Hermite) blend through both twilights.
 */
export function daylightAt(season: Season, hour: number): number {
  const t = DAY_TIMES[season];
  if (hour < t.dawnStart || hour >= t.duskEnd) return 0;
  if (hour < t.sunrise) return smoothstep(t.dawnStart, t.sunrise, hour);
  if (hour <= t.sunset) return 1;
  return 1 - smoothstep(t.sunset, t.duskEnd, hour);
}

/** Phase of the day at `hour` of a day in `season`. */
export function dayPhaseAt(season: Season, hour: number): DayPhase {
  const t = DAY_TIMES[season];
  if (hour < t.dawnStart || hour >= t.duskEnd) return 'nacht';
  if (hour < t.sunrise) return 'morgendaemmerung';
  if (hour < t.sunset) return 'tag';
  return 'abenddaemmerung';
}

/** Night number of a moment: the day on whose evening the night starts (before noon: the previous day). */
export function nightOf(day: number, hour: number): number {
  return hour < NOON_HOUR ? day - 1 : day;
}

/** Moon phase 0…7 of a night (0 = Finstermond, 4 = full moon). Night 1 starts on the evening of day 1. */
export function moonPhaseOfNight(night: number): number {
  const p = (BALANCE.calendar.firstNightMoonPhase + night - FIRST_DAY) % MOON_CYCLE_DAYS;
  return p < 0 ? p + MOON_CYCLE_DAYS : p;
}

/** Lit fraction of the moon in [0, 1]: 0 at the new moon, 1 at the full moon, linear in between. */
export function moonIllumination(phase: number): number {
  return 1 - Math.abs(phase - FULL_MOON_PHASE) / FULL_MOON_PHASE;
}

/** Whether a moon phase is the Finstermond (new moon, §10). */
export function isFinstermondPhase(phase: number): boolean {
  return phase === NEW_MOON_PHASE;
}

/** Ambient light of a surface night with this moon phase (§12.1: 0,05–0,12, Finstermond 0,02). */
export function nightAmbientLight(phase: number): number {
  const c = BALANCE.calendar;
  if (isFinstermondPhase(phase)) return c.finstermondAmbientLight;
  const thinnest = moonIllumination(NEW_MOON_PHASE + 1);
  return c.nightAmbientMin + ((c.nightAmbientMax - c.nightAmbientMin) * (moonIllumination(phase) - thinnest)) / (1 - thinnest);
}

/** Surface ambient light for a daylight factor and the moon phase of the current night. */
export function ambientLightAt(daylight: number, phase: number): number {
  const night = nightAmbientLight(phase);
  return night + (BALANCE.calendar.dayAmbientLight - night) * daylight;
}

/** A shadow-casting light (sun or moon) as seen by the shadow pass. */
export interface ShadowVector {
  /** Unit direction in which shadows fall on screen (+x east, +y south). */
  dirX: number;
  dirY: number;
  /** Shadow length per unit caster height (cot elevation, capped). */
  length: number;
  /** Shadow opacity 0–1 (0 below the horizon). */
  strength: number;
  /** Elevation of the light [degrees]; ≤ 0 below the horizon. */
  elevationDeg: number;
}

/** A zeroed shadow vector (allocate once, pass to the `…ShadowAt` functions every frame). */
export function createShadowVector(): ShadowVector {
  return { dirX: 0, dirY: -1, length: 0, strength: 0, elevationDeg: 0 };
}

/** Fills `out` for a light that crosses the sky from east (progress 0) over south (0,5) to west (1). */
function arcShadow(progress: number, peakElevationDeg: number, maxStrength: number, out: ShadowVector): ShadowVector {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  const azimuth = Math.PI * p;
  // Light direction on the ground: east (1, 0) → south (0, 1) → west (−1, 0); shadows point away.
  out.dirX = -Math.cos(azimuth);
  out.dirY = -Math.sin(azimuth);
  const elevation = progress > 0 && progress < 1 ? peakElevationDeg * Math.sin(azimuth) : 0;
  out.elevationDeg = elevation;
  const c = BALANCE.calendar;
  out.length = elevation > 0 ? Math.min(c.maxShadowLength, 1 / Math.tan(elevation * DEG_TO_RAD)) : c.maxShadowLength;
  out.strength = maxStrength * smoothstep(0, c.shadowFadeElevationDeg, elevation);
  return out;
}

/** Sun shadow at `hour` of a day in `season` (strength 0 outside sunrise…sunset). */
export function sunShadowAt(season: Season, hour: number, out: ShadowVector): ShadowVector {
  const t = DAY_TIMES[season];
  return arcShadow((hour - t.sunrise) / t.dayHours, BALANCE.calendar.noonSunElevationDeg[season], 1, out);
}

/**
 * Moon shadow during a night. The moon rises at the end of the evening twilight (`eveningSeason`)
 * and sets at the start of the next morning twilight (`morningSeason`); `hoursSinceEveningMidnight`
 * counts from the midnight before the evening (evening hours 12–24, following morning 24–36).
 */
export function moonShadowAt(eveningSeason: Season, morningSeason: Season, hoursSinceEveningMidnight: number, phase: number, out: ShadowVector): ShadowVector {
  const rise = DAY_TIMES[eveningSeason].duskEnd;
  const set = HOURS_PER_DAY + DAY_TIMES[morningSeason].dawnStart;
  const c = BALANCE.calendar;
  return arcShadow((hoursSinceEveningMidnight - rise) / (set - rise), c.moonMaxElevationDeg, c.moonShadowStrength * moonIllumination(phase), out);
}

// ---------------------------------------------------------------------------------------------
// Season segments and snapshot
// ---------------------------------------------------------------------------------------------

/** From `fromDay` on, seasons last `lengthDays`; on `fromDay` it is day `dayOfSeason` of absolute season `season`. */
export interface SeasonSegment {
  readonly fromDay: number;
  readonly lengthDays: number;
  /** Seasons since the first spring (0 = first spring, 4 = second spring …). */
  readonly season: number;
  readonly dayOfSeason: number;
}

/** Position of a day in the calendar. */
export interface SeasonDay {
  day: number;
  season: Season;
  /** 0 spring … 3 winter. */
  seasonIndex: number;
  /** Seasons since the first spring. */
  absoluteSeason: number;
  /** 1…seasonLengthDays. */
  dayOfSeason: number;
  /** 1…4 × seasonLengthDays (with the season length that applies on this day). */
  dayOfYear: number;
  /** Year number starting at 1. */
  year: number;
  /** Season length that applies on this day. */
  seasonLengthDays: number;
}

/** Data format version of the calendar save participant. */
export const CALENDAR_SAVE_VERSION = 1;
/** Participant id of the calendar (roundtrip test `tests/unit/save/roundtrip/calendar.test.ts`). */
export const CALENDAR_PARTICIPANT_ID = 'calendar';

const seasonLengthSchema = z.number().int().min(BALANCE.calendar.minSeasonLengthDays).max(BALANCE.calendar.maxSeasonLengthDays);
const segmentSchema = z
  .object({
    fromDay: z.number().int().min(FIRST_DAY).max(Number.MAX_SAFE_INTEGER),
    lengthDays: seasonLengthSchema,
    season: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    dayOfSeason: z.number().int().min(1),
  })
  .strict()
  .refine((s) => s.dayOfSeason <= s.lengthDays, { message: 'dayOfSeason exceeds the season length', path: ['dayOfSeason'] });

/** zod schema of the calendar snapshot. */
export const calendarSnapshotSchema = z
  .object({ segments: z.array(segmentSchema).min(1) })
  .strict()
  .refine((s) => s.segments[0]?.fromDay === FIRST_DAY && s.segments[0].season === 0 && s.segments[0].dayOfSeason === 1, {
    message: 'the first segment must start on day 1 with the first day of spring',
    path: ['segments', 0],
  })
  .refine((s) => s.segments.every((seg, i) => i === 0 || seg.fromDay > (s.segments[i - 1] as SeasonSegment).fromDay), {
    message: 'segments must start on strictly increasing days',
    path: ['segments'],
  });

/** Saved calendar state. */
export type CalendarSnapshot = z.output<typeof calendarSnapshotSchema>;

/** Save participant of the calendar (structurally a `SaveParticipant` of src/save). */
export interface CalendarSaveParticipant {
  readonly id: string;
  readonly version: number;
  serialize(): CalendarSnapshot;
  deserialize(data: unknown): void;
}

/** Throws unless `days` is a selectable season length (§10: 3–14). */
export function assertSeasonLength(days: number): void {
  if (!seasonLengthSchema.safeParse(days).success) {
    throw new RangeError(`Calendar: season length must be an integer in ${BALANCE.calendar.minSeasonLengthDays}…${BALANCE.calendar.maxSeasonLengthDays} days, got ${String(days)}`);
  }
}

function emptySeasonDay(): SeasonDay {
  return { day: FIRST_DAY, season: 'fruehling', seasonIndex: 0, absoluteSeason: 0, dayOfSeason: 1, dayOfYear: 1, year: 1, seasonLengthDays: BALANCE.calendar.defaultSeasonLengthDays };
}

/** Calendar position of `day` under a segment list (first segment starts on day 1). */
function seasonDayIn(segments: readonly SeasonSegment[], day: number, out: SeasonDay): SeasonDay {
  if (!Number.isSafeInteger(day) || day < FIRST_DAY) throw new RangeError(`Calendar: day must be an integer ≥ ${FIRST_DAY}, got ${String(day)}`);
  let seg = segments[0] as SeasonSegment;
  for (let i = segments.length - 1; i > 0; i--) {
    const s = segments[i] as SeasonSegment;
    if (s.fromDay <= day) {
      seg = s;
      break;
    }
  }
  const offset = day - seg.fromDay + seg.dayOfSeason - 1;
  const within = offset % seg.lengthDays;
  const absoluteSeason = seg.season + (offset - within) / seg.lengthDays;
  const seasonIndex = absoluteSeason % SEASON_COUNT;
  out.day = day;
  out.seasonIndex = seasonIndex;
  out.season = SEASONS[seasonIndex] as Season;
  out.absoluteSeason = absoluteSeason;
  out.dayOfSeason = within + 1;
  out.dayOfYear = seasonIndex * seg.lengthDays + within + 1;
  out.year = (absoluteSeason - seasonIndex) / SEASON_COUNT + 1;
  out.seasonLengthDays = seg.lengthDays;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------------------------

/**
 * The world calendar. Global (not chunk bound, docs/ARCHITEKTUR.md "Aktive Zone"): everything is
 * derived from the clock on demand, so it never needs a tick. Getters reuse internal scratch data
 * and do not allocate; `sun`/`moon`/`shadow` write into caller-owned vectors.
 */
export class Calendar {
  /** System id (the calendar is registered as a simulation system for its save participant). */
  readonly id = CALENDAR_PARTICIPANT_ID;
  /** Save participant: season length history. */
  readonly save: CalendarSaveParticipant;
  private segments: SeasonSegment[];
  private readonly scratch = emptySeasonDay();
  private readonly shadowScratch = createShadowVector();

  constructor(
    readonly clock: GameClock,
    seasonLengthDays: number = BALANCE.calendar.defaultSeasonLengthDays,
  ) {
    assertSeasonLength(seasonLengthDays);
    this.segments = [{ fromDay: FIRST_DAY, lengthDays: seasonLengthDays, season: 0, dayOfSeason: 1 }];
    this.save = {
      id: CALENDAR_PARTICIPANT_ID,
      version: CALENDAR_SAVE_VERSION,
      serialize: () => ({ segments: this.segments.map((s) => ({ ...s })) }),
      deserialize: (data: unknown) => {
        const parsed = calendarSnapshotSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`Calendar snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
        this.segments = parsed.data.segments.map((s) => ({ ...s }));
      },
    };
  }

  // --- season length ---------------------------------------------------------------------------

  /** Season length that applies today [days]. */
  get seasonLengthDays(): number {
    return this.seasonDayOf(this.clock.day, this.scratch).seasonLengthDays;
  }

  /** Recorded season length changes (first entry: day 1). */
  seasonSegments(): readonly SeasonSegment[] {
    return this.segments;
  }

  /**
   * Changes the season length from today on (§29 "Jahreszeitenlänge"). The current season and day of
   * season stay (clamped to the new length); days before today keep their season.
   */
  setSeasonLength(days: number): void {
    assertSeasonLength(days);
    const today = this.clock.day;
    // Position of today as it was before any change made today (changing twice a day loses nothing).
    const kept = this.segments.filter((s) => s.fromDay < today);
    const now = kept.length === 0 ? emptySeasonDay() : seasonDayIn(kept, today, emptySeasonDay());
    const previous = kept[kept.length - 1];
    if (previous === undefined || previous.lengthDays !== days) {
      kept.push({ fromDay: today, lengthDays: days, season: now.absoluteSeason, dayOfSeason: Math.min(now.dayOfSeason, days) });
    }
    this.segments = kept;
  }

  // --- date ----------------------------------------------------------------------------------------

  /** Calendar position of any day ≥ 1 (writes into `out`). */
  seasonDayOf(day: number, out: SeasonDay = emptySeasonDay()): SeasonDay {
    return seasonDayIn(this.segments, day, out);
  }

  /** Season of any day ≥ 1. */
  seasonOfDay(day: number): Season {
    return this.seasonDayOf(day, this.scratch).season;
  }

  /** Today's calendar position (shared scratch object: copy fields you keep). */
  get today(): Readonly<SeasonDay> {
    return this.seasonDayOf(this.clock.day, this.scratch);
  }

  /** Current day (from 1, changes at midnight). */
  get day(): number {
    return this.clock.day;
  }

  /** Current season. */
  get season(): Season {
    return this.today.season;
  }

  /** Day within the current season, from 1. */
  get dayOfSeason(): number {
    return this.today.dayOfSeason;
  }

  /** Day within the year, from 1. */
  get dayOfYear(): number {
    return this.today.dayOfYear;
  }

  /** Year, from 1. */
  get year(): number {
    return this.today.year;
  }

  // --- time of day ---------------------------------------------------------------------------------

  /** Continuous hour of the day in [0, 24). */
  get hour(): number {
    return this.clock.dayFraction * HOURS_PER_DAY;
  }

  /** Clock times of today's season. */
  get dayTimes(): DayTimes {
    return DAY_TIMES[this.season];
  }

  /** Daylight factor 0–1 now. */
  get daylight(): number {
    return daylightAt(this.season, this.hour);
  }

  /** Phase of the day now. */
  get dayPhase(): DayPhase {
    return dayPhaseAt(this.season, this.hour);
  }

  // --- moon ----------------------------------------------------------------------------------------

  /**
   * Number of the current night = the day on whose evening it starts: before noon the night that is
   * ending, from noon on the coming one. The world starts at 06:00 of day 1, so its first morning
   * already counts as night 1 (there is no night 0).
   */
  get night(): number {
    return Math.max(FIRST_DAY, nightOf(this.clock.day, this.hour));
  }

  /** Moon phase of the current night, 0…7. */
  get moonPhase(): number {
    return moonPhaseOfNight(this.night);
  }

  /** Lit fraction of the moon tonight. */
  get moonIllumination(): number {
    return moonIllumination(this.moonPhase);
  }

  /** Whether tonight is a Finstermond (new moon). */
  get isFinstermond(): boolean {
    return isFinstermondPhase(this.moonPhase);
  }

  /** Whether tonight is a full moon. */
  get isFullMoon(): boolean {
    return this.moonPhase === FULL_MOON_PHASE;
  }

  /** Surface ambient light now (§12.1; weather is applied by the weather system). */
  get ambientLight(): number {
    return ambientLightAt(this.daylight, this.moonPhase);
  }

  // --- shadows -------------------------------------------------------------------------------------

  /** Sun shadow now. */
  sun(out: ShadowVector): ShadowVector {
    return sunShadowAt(this.season, this.hour, out);
  }

  /** Moon shadow now (strength 0 by day and around the Finstermond). */
  moon(out: ShadowVector): ShadowVector {
    const hour = this.hour;
    const night = this.night;
    // Hours since the midnight before the night's evening (the first morning lies before night 1: no moon).
    const since = hour + (this.clock.day - night) * HOURS_PER_DAY;
    return moonShadowAt(this.seasonOfDay(night), this.seasonOfDay(night + 1), since, moonPhaseOfNight(night), out);
  }

  /** The dominant shadow caster now: the sun while it is up, otherwise the moon. */
  shadow(out: ShadowVector): ShadowVector {
    this.sun(out);
    if (out.strength > 0) return out;
    const moon = this.moon(this.shadowScratch);
    if (moon.strength > 0) {
      out.dirX = moon.dirX;
      out.dirY = moon.dirY;
      out.length = moon.length;
      out.strength = moon.strength;
      out.elevationDeg = moon.elevationDeg;
    }
    return out;
  }
}
