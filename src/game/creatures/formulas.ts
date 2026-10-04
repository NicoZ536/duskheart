/**
 * Pure formulas of the creatures (MASTERPROMPT §19.4, §12.4, §29, §D; docs/SPIEL.md §11; M6-13 … M6-15, M6-27, M6-30):
 * wind-up and damage by difficulty, sight by the light at the player, the cone of view, hearing under rain, the tier of
 * loot, weighted loot draws and carving yields, the time of day at any tick (catch-up), facings, turning, pack slots.
 * Tested directly (tests/unit/game/telegraph.test.ts, wahrnehmung.test.ts, loot.test.ts, ki.test.ts, rudel …).
 *
 * Determinism: every decision uses + − × ÷, `sqrt` and comparisons of vectors; the facing angle is `atan2` of a
 * movement (like the player's aim, docs/SPIEL.md §10) and never decides a hit on its own – the cone test is a dot product
 * against a precomputed cosine.
 */
import { BALANCE } from '../../content/balance';
import type { Difficulty } from '../../content/balance/death';
import { WINDUP_MAX_SECONDS, WINDUP_MIN_SECONDS, type CreatureActivity, type CreatureAttack, type LootTableDef } from '../../content/creatures/schema';
import type { Rng } from '../../engine/rng';
import { DAWN_MINUTE, HOURS_PER_DAY, MINUTES_PER_DAY } from '../../engine/time';
import { dayPhaseAt, type DayPhase, type Season } from '../../world/calendar';
import { lightStage } from '../../world/lightmap/stages';
import { FULL_TURN, degToRad, nearestFacing, secondsToTicks, wrapAngle } from '../combat/formulas';
import type { Facing } from '../player/state';

const TICK_HZ = BALANCE.time.tickHz;
const AI = BALANCE.ai;
const P = AI.perception;
const CR = BALANCE.creatures;

// ---------------------------------------------------------------------------------------------
// Telegraphs and damage (M6-15, §29)
// ---------------------------------------------------------------------------------------------

/**
 * Ticks from the start of a wind-up to the blow on difficulty `difficulty` (§19.4 "Ausholzeit 0,3–0,8 s
 * (Schwierigkeit skaliert)"): (wind-up + run-up) × the difficulty's factor, held within 0,3–0,8 s on every difficulty
 * (`WINDUP_MIN_SECONDS` … `WINDUP_MAX_SECONDS`) – Entspannt gives no slow attack more than 0,8 s, Unbarmherzig takes no
 * quick one below 0,3 s, the frame a player learns to read.
 */
export function windupTicks(attack: Pick<CreatureAttack, 'ausholzeit' | 'anlauf'>, difficulty: Difficulty): number {
  const scaled = (attack.ausholzeit + (attack.anlauf ?? 0)) * CR.difficulty.windupFactor[difficulty];
  const seconds = scaled < WINDUP_MIN_SECONDS ? WINDUP_MIN_SECONDS : scaled > WINDUP_MAX_SECONDS ? WINDUP_MAX_SECONDS : scaled;
  return Math.max(1, Math.round(seconds * TICK_HZ));
}

/** Ticks of the readable wind-up pose within `windupTicks` (the run-up follows it) on difficulty `difficulty`. */
export function windupPoseTicks(attack: Pick<CreatureAttack, 'ausholzeit' | 'anlauf'>, difficulty: Difficulty): number {
  const total = windupTicks(attack, difficulty);
  const share = attack.ausholzeit / (attack.ausholzeit + (attack.anlauf ?? 0));
  return Math.max(1, Math.min(total, Math.round(total * share)));
}

/** Damage of a creature's attack on difficulty `difficulty` [HP] (§29 "Gegnerschaden ×0,6 / ×1 / ×1,3 / ×1,5"). */
export function creatureDamage(base: number, difficulty: Difficulty): number {
  return base * CR.difficulty.damageFactor[difficulty];
}

// ---------------------------------------------------------------------------------------------
// Perception (M6-14)
// ---------------------------------------------------------------------------------------------

/** Sight factor of the light at the player (§19.4 "Sichtweite abhängig vom Licht am Spieler"). */
export function lightSightFactor(level: number): number {
  return P.lightFactor[lightStage(level)];
}

/**
 * Sight range [tiles] of a profile's `sight` (full light) for a player standing in light `level`, carrying a burning light
 * (`ownLight`: ×2, §12.2 "Wer leuchtet, wird … doppelt so weit gesehen") under weather with `haze` and `precipitation`
 * (§19.4 "Wetter senkt Sichtweite": fog, heavy rain).
 */
export function sightRangeTiles(sight: number, level: number, ownLight: boolean, haze: number, precipitation: number): number {
  return sightRangeOf(sight, sightFactors(level, ownLight, haze, precipitation, SIGHT_SCRATCH));
}

/**
 * The factors of the senses that are the same for every creature in a tick (M6-16d: the creature system fills them once per
 * tick and multiplies per creature): of a sight range besides the profile's sight (`sightRangeOf`) – light at the player,
 * the player's own light, weather – and of a hearing radius (`hearingRainFactor`). A class, so its fields keep their number
 * representation of their own (a held record of an object literal shares its hidden class with every literal of the same
 * keys).
 */
export class SenseFactors {
  // NaN until filled: fractional from the start, the fields keep one representation (see `TurnDirection`).
  light = Number.NaN;
  own = Number.NaN;
  weather = Number.NaN;
  hearing = Number.NaN;
}

const SIGHT_SCRATCH = new SenseFactors();

/** Fills `out` with the factors of `sightRangeTiles` for a player in light `level` (see there). */
export function sightFactors(level: number, ownLight: boolean, haze: number, precipitation: number, out: SenseFactors): SenseFactors {
  const weather = (1 - haze * P.hazeSightLoss) * (1 - Math.max(0, precipitation - P.heavyRainFrom) * P.heavyRainSightLoss);
  out.light = lightSightFactor(level);
  out.own = ownLight ? P.ownLightFactor : 1;
  out.weather = Math.max(0, weather);
  return out;
}

/**
 * The sense factors of a tick for a player and the weather: `sightFactors` and `hearingRainFactor` (the creature system once
 * per tick: the records cross the call, no number – a fractional number passed to a call V8 does not inline is boxed, M6-16d).
 */
export function senseFactorsOf(player: { readonly light: number; readonly lit: boolean }, weather: { readonly haze: number; readonly precipitation: number }, out: SenseFactors): SenseFactors {
  sightFactors(player.light, player.lit, weather.haze, weather.precipitation, out);
  out.hearing = hearingRainFactor(weather.precipitation);
  return out;
}

/** Sight range [tiles] of a profile's `sight` under the factors `f` (`sightRangeTiles` = this of `sightFactors`). */
export function sightRangeOf(sight: number, f: SenseFactors): number {
  return sight * f.light * f.own * f.weather;
}

/** Cosine of half the sight cone (§19.4 "Sichtkegel 120°"). */
export const SIGHT_CONE_COS = Math.cos(degToRad(P.coneDeg / 2));

/** Whether a body at offset (dx, dy) lies in the cone of a creature facing `facing` [rad] (a dot product, no trigonometry per body). */
export function inSightCone(facing: number, dx: number, dy: number, cosHalf: number = SIGHT_CONE_COS): boolean {
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return true;
  return Math.cos(facing) * dx + Math.sin(facing) * dy >= cosHalf * len;
}

/**
 * `inSightCone` of a body facing `body.facing` for the offset (`dir.x`, `dir.y`) and the cone of §19.4 – for the creature's
 * tick, the same arithmetic without a number crossing the call (M6-16d, see `turnBodyTowards`).
 */
export function inSightConeOf(body: { readonly facing: number }, dir: TurnDirection): boolean {
  const dx = dir.x;
  const dy = dir.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return true;
  return Math.cos(body.facing) * dx + Math.sin(body.facing) * dy >= SIGHT_CONE_COS * len;
}

/** Radius [tiles] at which a creature with `hearing` hears a noise of radius `radius` under `precipitation` (§19.4 "Regen dämpft"). */
export function hearingRadiusTiles(radius: number, hearing: number, precipitation: number): number {
  return radius * hearing * hearingRainFactor(precipitation);
}

/** The factor rain puts on every hearing radius (`hearingRadiusTiles` = radius × hearing × this; the same for all creatures in a tick). */
export function hearingRainFactor(precipitation: number): number {
  return 1 - Math.min(1, Math.max(0, precipitation)) * P.rainHearingLoss;
}

// ---------------------------------------------------------------------------------------------
// Time (catch-up, activity)
// ---------------------------------------------------------------------------------------------

/** What the clock showed at a tick. */
export interface ClockAt {
  /** Day number (from 1, changes at midnight). */
  day: number;
  /** Continuous hour [0, 24). */
  hour: number;
}

/**
 * The day and hour at tick `tick`, derived from the clock now (`nowTick`, `dayTick` = ticks since the last 06:00, `dawns`,
 * `ticksPerDay`): exact while the day length stayed the same in between (catch-up of frozen chunks, docs/ARCHITEKTUR.md
 * "Aufholen" – the regrowth of animals uses the table of the hour it happens in).
 */
export function clockAt(nowTick: number, dayTick: number, dawns: number, ticksPerDay: number, tick: number, out: ClockAt): ClockAt {
  const sinceDawn = dayTick + (tick - nowTick);
  const extra = Math.floor(sinceDawn / ticksPerDay);
  const inDay = sinceDawn - extra * ticksPerDay;
  const d = dawns + extra;
  const minutesAfterDawn = (inDay * MINUTES_PER_DAY) / ticksPerDay;
  const minuteOfDay = (DAWN_MINUTE + minutesAfterDawn) % MINUTES_PER_DAY;
  out.hour = (minuteOfDay / MINUTES_PER_DAY) * HOURS_PER_DAY;
  out.day = d + 1 + (DAWN_MINUTE + minutesAfterDawn >= MINUTES_PER_DAY ? 1 : 0);
  return out;
}

/** The activity phase of a day phase (both twilights are dusk). */
export function activityOf(phase: DayPhase): CreatureActivity {
  return phase === 'tag' ? 'tag' : phase === 'nacht' ? 'nacht' : 'daemmerung';
}

/** Whether a creature active in `aktiv` is awake in `phase`. */
export function awakeIn(aktiv: readonly CreatureActivity[], phase: DayPhase): boolean {
  return aktiv.includes(activityOf(phase));
}

/** The day phase of `season` at `hour` (re-exported for the creature system's catch-up). */
export function phaseAt(season: Season, hour: number): DayPhase {
  return dayPhaseAt(season, hour);
}

// ---------------------------------------------------------------------------------------------
// Loot (M6-30)
// ---------------------------------------------------------------------------------------------

/** A piece of loot: item and count. */
export interface LootDrop {
  item: string;
  count: number;
}

/** The tier loot is drawn at: the creature's own, or the biome's where it is higher (§13.2, `BALANCE.spawn.biomeTier`). */
export function effectiveTier(creatureTier: number, biome: string | null): number {
  const b = biome === null ? undefined : BALANCE.spawn.biomeTier[biome];
  return b === undefined ? creatureTier : Math.max(creatureTier, b);
}

/** Uniform integer in [min, max]. */
function inRange(rng: Rng, range: readonly [number, number]): number {
  return range[0] === range[1] ? range[0] : rng.int(range[0], range[1] + 1);
}

/**
 * The loot of a defeat (§14, M6-30 "gewichtet, geseedet, stufenabhängig"): `ziehungen` draws (a count in its range), each
 * a weighted pick among the entries available at `tier` (`stufeAb` ≤ tier) with a count in its range; the same item
 * drawn twice adds up. Appends to `out` and returns it.
 */
export function drawLoot(table: LootTableDef, tier: number, rng: Rng, out: LootDrop[] = []): LootDrop[] {
  const entries = table.beute.filter((e) => (e.stufeAb ?? 0) <= tier);
  if (entries.length === 0) return out;
  const draws = inRange(rng, table.ziehungen);
  for (let d = 0; d < draws; d++) {
    const e = rng.weighted(entries, (x) => x.gewicht);
    const count = inRange(rng, e.anzahl);
    const have = out.find((o) => o.item === e.item);
    if (have === undefined) out.push({ item: e.item, count });
    else have.count += count;
  }
  return out;
}

/** The yield of carving a carcass (§14 "Jagen & Zerlegen"): each entry with its own chance and count. Appends to `out`. */
export function carveYield(table: LootTableDef, rng: Rng, out: LootDrop[] = []): LootDrop[] {
  for (const e of table.zerlegen) {
    if (rng.next() >= e.chance) continue;
    out.push({ item: e.item, count: inRange(rng, e.anzahl) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Facing and movement
// ---------------------------------------------------------------------------------------------

/** Sprite facing of an angle [rad] (four directions, the nearest). */
export function facingOfAngle(angle: number): Facing {
  return nearestFacing(angle);
}

/** Turns `current` towards `target` by at most `maxStep` [rad]; result in (−π, π]. */
export function turnTowards(current: number, target: number, maxStep: number): number {
  const d = wrapAngle(target - current);
  if (d > maxStep) return wrapAngle(current + maxStep);
  if (d < -maxStep) return wrapAngle(current - maxStep);
  return wrapAngle(target);
}

/**
 * Turns `body.facing` by at most `TURN_PER_TICK` towards the direction (`dir.x`, `dir.y`) – `turnTowards` for the
 * creature's tick (M6-16d), the same arithmetic step by step. No number crosses a call, neither into this function nor out
 * of it (`wrapAngle` is written out): a fractional number passed to or returned from a call V8 does not inline is boxed,
 * and in a creature's tick V8's inlining budget often runs out before the small helpers. A zero direction leaves the facing.
 */
export function turnBodyTowards(body: { facing: number }, dir: TurnDirection): void {
  if (dir.x === 0 && dir.y === 0) return;
  const current = body.facing;
  const target = Math.atan2(dir.y, dir.x);
  // d = wrapAngle(target − current)
  let d = (target - current) % FULL_TURN;
  if (d <= -Math.PI) d += FULL_TURN;
  else if (d > Math.PI) d -= FULL_TURN;
  // wrapAngle of the turned facing (`turnTowards`)
  let to = (d > TURN_PER_TICK ? current + TURN_PER_TICK : d < -TURN_PER_TICK ? current - TURN_PER_TICK : target) % FULL_TURN;
  if (to <= -Math.PI) to += FULL_TURN;
  else if (to > Math.PI) to -= FULL_TURN;
  body.facing = to;
}

/**
 * The direction a body turns towards (`turnBodyTowards`). A class with fields that are fractional from the start (NaN until
 * written): a field that starts as a whole number changes its hidden class at its first fraction, and every new instance –
 * each simulation makes its own – starts with the old one, which throws V8's optimised code away (M6-16d).
 */
export class TurnDirection {
  x = Number.NaN;
  y = Number.NaN;
}

/** Largest turn per tick [rad] (`BALANCE.creatures.movement.turnRadPerSecond`). */
export const TURN_PER_TICK = CR.movement.turnRadPerSecond / TICK_HZ;

// ---------------------------------------------------------------------------------------------
// Pack tactics (M6-18)
// ---------------------------------------------------------------------------------------------

/**
 * Angle of slot `slot` of `slots` around a target [rad] (§19.4 "Rudel umkreisen und flankieren"): the slots spread evenly
 * over the full circle starting at `base` – the direction from the target back to the pack's first member –, so two
 * wolves stand opposite each other, three at 120°, four at 90°.
 */
export function packSlotAngle(slot: number, slots: number, base: number): number {
  return wrapAngle(base + (slot * Math.PI * 2) / Math.max(1, slots));
}

/** Largest angle between bodies around a centre [rad, 0 … 2π]: the spread of a pack round its target. */
export function angularSpread(angles: readonly number[]): number {
  if (angles.length < 2) return 0;
  const sorted = angles.map((a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b);
  let largestGap = 0;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i] as number;
    const b = i + 1 < sorted.length ? (sorted[i + 1] as number) : (sorted[0] as number) + Math.PI * 2;
    largestGap = Math.max(largestGap, b - a);
  }
  return Math.PI * 2 - largestGap;
}

// ---------------------------------------------------------------------------------------------
// Population (M6-27)
// ---------------------------------------------------------------------------------------------

/** Ticks between two animals growing back in a chunk. */
export function regrowIntervalTicks(ticksPerGameHour: number): number {
  return Math.max(1, Math.round(BALANCE.spawn.wildlife.regrowGameHours * ticksPerGameHour));
}

/** Health a frozen creature regains over `ticks` [HP] (`BALANCE.creatures.healPerGameHour`), never above `max`. */
export function healedHealth(health: number, max: number, ticks: number, ticksPerGameHour: number): number {
  return Math.min(max, health + max * CR.healPerGameHour * (ticks / ticksPerGameHour));
}

/** How many shadow brood may live around the player (§12.4 "Dichte nach Biomstufe, Mondphase und Schwierigkeit"). */
export function shadowBroodMax(tier: number, finstermond: boolean, difficulty: Difficulty): number {
  const S = BALANCE.spawn.shadowBrood;
  const byTier = S.maxAliveByTier[Math.max(0, Math.min(S.maxAliveByTier.length - 1, tier))] as number;
  return Math.round(byTier * (finstermond ? S.finstermondFactor : 1) * S.difficultyFactor[difficulty]);
}

// ---------------------------------------------------------------------------------------------
// The grab (§20.1 "Kriecher (hält fest)", M6-26)
// ---------------------------------------------------------------------------------------------

/** Ticks of the recovery after a blow (`BALANCE.creatures.attack.recoverySeconds`, at least one). */
export const RECOVERY_TICKS = secondsToTicks(CR.attack.recoverySeconds, 1);

/**
 * Ticks a grab holds the player at most (`festhalten.sekunden`): always longer than a recovery, so a creature's recovery
 * that lasts this long (or longer – a hitstop stretches it) is its hold – the hold needs no state of its own (it is saved
 * with the attack's ticks).
 */
export function grabHoldTicks(grab: { readonly sekunden: number }): number {
  return Math.max(RECOVERY_TICKS + 1, secondsToTicks(grab.sekunden));
}

/** Whether a creature in state `s` with the attacks `attacks` holds the player at `tick` (its grab's hold runs). */
export function holdingPlayer(s: { readonly attack: number; readonly attackPhase: string; readonly attackTick: number; readonly attackEndTick: number }, attacks: readonly CreatureAttack[], tick: number): boolean {
  if (s.attackPhase !== 'erholen' || tick >= s.attackEndTick) return false;
  const grab = attacks[s.attack]?.festhalten;
  return grab !== undefined && s.attackEndTick - s.attackTick >= grabHoldTicks(grab);
}

/** Whether a grab's bite falls on `ticksIn` ticks into its hold: `bisse` bites, one in the middle of each equal slice of it. */
export function grabBiteDue(grab: { readonly sekunden: number; readonly bisse: number }, ticksIn: number): boolean {
  const slice = grabHoldTicks(grab) / grab.bisse;
  const k = Math.floor(ticksIn / slice);
  return ticksIn > 0 && k < grab.bisse && ticksIn === Math.floor((k + 1 / 2) * slice);
}

/** Damage of one bite of a grab [HP] on Normal: the damage per second over the hold, split into its bites. */
export function grabBiteDamage(grab: { readonly sekunden: number; readonly schadenProSekunde: number; readonly bisse: number }): number {
  return (grab.schadenProSekunde * grab.sekunden) / grab.bisse;
}
