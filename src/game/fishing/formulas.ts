/**
 * Pure rules of fishing (docs/SPIEL.md §20 "Angeln", MASTERPROMPT §14; M7-24): which fish fit a water, an hour, a weather and a
 * season, the weighted choice among them (bait), the wait for the bite, the fight on the line (tension held between 0 and 1,
 * the fish pulling, leaping and tiring), and the catch of a fish trap at a dawn.
 *
 * The bite and the fish come from hashes of (seed, cast tick) – a cast at the same tick bites the same, however the game was
 * saved –, the traps' catches from hashes of (seed, layer, tile, day) like the fields (§28 "Determinismus-Regeln"); only the
 * running fight draws from the stream `fishing` (§28 "fortlaufende Ströme … fishing (Drill)").
 */
import { BALANCE, type SeasonId } from '../../content/balance';
import { DAY_PHASES, type DayPhase, type FishRecord, type FishWater } from '../../content/fishing/schema';
import type { BaitBlock } from '../../content/schema/itemBlocks';
import type { WeatherStateId } from '../../content/weather';
import { hash3, hashCombine, hashToUnit } from '../../engine/rng';
import { dayTimes } from '../../world/calendar';

const B = BALANCE.fishing;

/** Hash salts of the per-cast and per-trap draws. */
export const FISH_SALT = { bite: 0x5f356495, fish: 0x2545f491, trap: 0x6c8e9cf5, trapFish: 0x1b56c4e9 } as const;

/** Leaps are given per minute (`FishDef.kampf.spruenge`), the fight steps in seconds. */
const SECONDS_PER_MINUTE = 60;
/** The cast tick's high half goes in as a second coordinate (a tick beyond 16 bits still changes the draw). */
const TICK_HIGH_SHIFT = 16;

/** A draw in [0, 1) of the cast at `castTick`, salted by `what`. */
export function castRoll(seed: number, castTick: number, what: number): number {
  return hashToUnit(hash3(castTick, castTick >>> TICK_HIGH_SHIFT, 0, hashCombine(seed, what)));
}

/** A draw in [0, 1) of the trap on tile (tx, ty) of `layer` on `day`, salted by `what`. */
export function trapRoll(seed: number, layer: number, tx: number, ty: number, day: number, what: number): number {
  return hashToUnit(hash3(tx, ty, day, hashCombine(hashCombine(seed, what), layer)));
}

/** The fish's phase of the day at `hour` (0–24) in `season`: dawn and dusk within `twilightHours` of sunrise and sunset. */
export function fishDayPhase(season: SeasonId, hour: number): DayPhase {
  const t = dayTimes(season);
  const w = B.twilightHours;
  if (Math.abs(hour - t.sunrise) <= w || Math.abs(hour - t.sunset) <= w) return 'daemmerung';
  if (hour > t.sunrise && hour < t.sunset) return 'tag';
  return 'nacht';
}

/** Where and when a cast goes. */
export interface FishConditions {
  readonly biome: string;
  readonly water: FishWater;
  readonly phase: DayPhase;
  readonly weather: WeatherStateId;
  readonly season: SeasonId;
}

/** Whether `fish` bites under `c` (rod: every condition; a trap ignores the hour and the weather: it fishes all day). */
export function fishFits(fish: FishRecord, c: FishConditions, trap: boolean): boolean {
  if (!fish.biome.includes(c.biome) || !fish.gewaesser.includes(c.water) || !fish.jahreszeiten.includes(c.season)) return false;
  if (trap) return fish.reuse;
  if (!fish.tageszeit.includes(c.phase)) return false;
  return fish.wetter === undefined || fish.wetter.includes(c.weather);
}

/** Whether `bait` (its id and block) is one `fish` prefers. */
export function prefersBait(fish: FishRecord, baitId: string, bait: BaitBlock | undefined): boolean {
  if (baitId === '') return false;
  return (fish.koeder?.includes(baitId) ?? false) || (bait?.fische?.includes(fish.id) ?? false);
}

/**
 * The fish of a cast or trap (§20 "Fischwahl gewichtet nach Biom, Gewässer, Tageszeit, Wetter, Jahreszeit, Köder"): among the
 * fish that fit, by weight – a preferred bait multiplies it by `baitPreference` –, from the draw `roll` in [0, 1); null when
 * none fits.
 */
export function chooseFish(fish: readonly FishRecord[], c: FishConditions, trap: boolean, baitId: string, bait: BaitBlock | undefined, roll: number): FishRecord | null {
  let total = 0;
  for (let i = 0; i < fish.length; i++) {
    const f = fish[i] as FishRecord;
    if (fishFits(f, c, trap)) total += f.gewicht * (prefersBait(f, baitId, bait) ? B.baitPreference : 1);
  }
  if (total <= 0) return null;
  let left = roll * total;
  let last: FishRecord | null = null;
  for (let i = 0; i < fish.length; i++) {
    const f = fish[i] as FishRecord;
    if (!fishFits(f, c, trap)) continue;
    last = f;
    left -= f.gewicht * (prefersBait(f, baitId, bait) ? B.baitPreference : 1);
    if (left < 0) return f;
  }
  return last;
}

/** Wait from the float's landing to the bite [s]: between `biteMinSeconds` and `biteMaxSeconds` by `roll`, shortened by the bait. */
export function biteWaitSeconds(roll: number, baitBite: number): number {
  return (B.biteMinSeconds + (B.biteMaxSeconds - B.biteMinSeconds) * roll) / Math.max(1, baitBite);
}

/** Share of the fish's pull that reaches the rod on slack line: at most a leap's 1.6 × 0.5 × 0.8 < `slackTension`. */
const SLACK_PULL_SHARE = 0.5;

/** The fight on the line (a held record of the fishing system). */
export interface Fight {
  /** Line tension 0–1. */
  tension: number;
  /** Pull of the fish −1 … 1 (sign: the side it swims to; the rod bends with it). */
  pull: number;
  /** Seconds until the fish changes its pull. */
  pullLeft: number;
  /** Seconds the current leap lasts (0: none). */
  leapLeft: number;
  /** Seconds of fight at full strength left (its `ausdauer`; the fish tires as the fight goes on). */
  stamina: number;
  /** Distance of the fish from the shore [tiles]. */
  distance: number;
}

/** A fight at its start: the fish `distance` tiles out. */
export function startFight(f: Fight, fish: FishRecord, distance: number): Fight {
  f.tension = B.fight.startTension;
  f.pull = 0;
  f.pullLeft = 0;
  f.leapLeft = 0;
  f.stamina = fish.kampf.ausdauer;
  f.distance = distance;
  return f;
}

/** What one step of the fight ended in. */
export type FightOutcome = 'weiter' | 'gefangen' | 'gerissen' | 'entkommen' | 'sprung';

/** The pull the fish puts on the line now (0 … `kraft` × `leapFactor`). */
export function fishStrength(f: Fight, fish: FishRecord): number {
  const tired = f.stamina <= 0 ? B.reel.tiredPull : 1;
  const leap = f.leapLeft > 0 ? B.pull.leapFactor : 1;
  return fish.kampf.kraft * tired * leap * Math.abs(f.pull);
}

/**
 * One step of `dt` seconds (§20 "Fisch zieht (Kraft, Ausdauer, Sprünge je FishDef.kampf), Spannung 0–1 halten – reißt bei 1,
 * entkommt bei 0"): every `pullChangeSeconds` the fish pulls anew (direction and `pullMin` … 1 of its strength, from `draw`); it
 * leaps `spruenge` times a minute (twice the pull for `leapSeconds`). Reeling raises the tension by `reelTension` plus the
 * fish's pull and draws it in; slack line lowers the tension by `slackTension` and lets it swim off. After `ausdauer` seconds
 * the fish is tired and pulls with `tiredPull`. Returns `sprung` on the step a leap begins (the splash), else whether the fight goes on or how it ended.
 */
export function fightStep(f: Fight, fish: FishRecord, reeling: boolean, dt: number, draw: () => number): FightOutcome {
  const P = B.pull;
  f.pullLeft -= dt;
  if (f.pullLeft <= 0) {
    const side = draw() < 0.5 ? -1 : 1;
    f.pull = side * (P.pullMin + (1 - P.pullMin) * draw());
    f.pullLeft += P.pullChangeSeconds;
  }
  let leaped = false;
  if (f.leapLeft > 0) f.leapLeft = Math.max(0, f.leapLeft - dt);
  else if (fish.kampf.spruenge > 0 && draw() < (fish.kampf.spruenge / SECONDS_PER_MINUTE) * dt) {
    f.leapLeft = P.leapSeconds;
    leaped = true;
  }
  const s = fishStrength(f, fish);
  f.stamina = Math.max(0, f.stamina - dt);
  const T = B.fight;
  const R = B.reel;
  if (reeling) {
    f.tension += (T.reelTension + T.pullTension * s) * dt;
    f.distance -= Math.max(0, R.reelSpeed - R.swimAway * s) * dt;
  } else {
    // Slack line gives: only half the pull reaches the rod, the tension always falls.
    f.tension += (T.pullTension * s * SLACK_PULL_SHARE - T.slackTension) * dt;
    f.distance += R.swimAway * s * dt;
  }
  if (f.tension >= 1) {
    f.tension = 1;
    return 'gerissen';
  }
  if (f.tension <= 0) {
    f.tension = 0;
    return 'entkommen';
  }
  if (f.distance > R.maxDistanceTiles) return 'entkommen';
  if (f.distance <= 0) {
    f.distance = 0;
    return 'gefangen';
  }
  return leaped ? 'sprung' : 'weiter';
}

/** The fish phases in content order (re-exported for the tests). */
export const FISH_DAY_PHASES = DAY_PHASES;
