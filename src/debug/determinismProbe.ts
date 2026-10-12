/**
 * Determinism across JS engines (M7-76, ADR-0210; docs/ARCHITEKTUR.md "Determinismus über JS-Engines"): the same pure
 * code runs in Node (the tests) and in the page (`__dh.call('determinismProbe', …)`), and tests/e2e/determinismus.spec.ts
 * compares the bits.
 *
 * - `portableMathDigest`: the portable functions of `src/engine/portableMath.ts` over a fixed stream of arguments (angles
 *   up to `PORTABLE_TRIG_MAX`, every exponent of a double for the logarithm, the whole range of e^x, 2^x and x^y), their
 *   results' bits folded into one FNV-1a digest per function.
 * - `engineMathDigest`: the same arguments through the engine's own `Math` functions – the control that shows which of
 *   them differ between the engines (the reason for the portable ones; not part of the simulation).
 * - `simFormulaDigest`: the simulation's own formulas that called engine trigonometry or powers before M7-76.
 * - `determinismRun`: a headless simulation of the fixture world (seed 3, Klein) driven by a fixed command stream: the
 *   player at dusk with a sword in god mode, a wolf pack (hunting, circling, biting), a Speier (spitting), fear (its
 *   hallucinations), the player's blows in eight directions while walking a fixed round, the Lumen rain and lightning –
 *   facings, cones, arcs, rings, drop scatter, the XP table: every former `Math.sin`/`Math.cos`/`**` of the simulation.
 *   The state hash every `checkpointTicks` and at the end.
 *
 * Only whole numbers go into the commands (no engine math decides them), so the stream is the same everywhere.
 */
import { pcos, pexp, pexp2, plog, ppow, psin, PORTABLE_TRIG_MAX, sinCosIn, createSinCosRegister, SIN_COS_COS, SIN_COS_SIN } from '../engine/portableMath';
import { SEASON_IDS } from '../content/balance';
import { coneCosine, lightConeInner, lightConeOuter, lightFlicker } from '../engine/lightFalloff';
import { v2FromAngle, v2Rotate, vec2 } from '../engine/math';
import { fallbackBurnTiles } from '../game/bosses/arena';
import { circleCentre } from '../game/bosses/formulas';
import { blockCovers } from '../game/combat/formulas';
import type { GameCommand } from '../game/commands';
import { inSightCone } from '../game/creatures/formulas';
import { landingSpot } from '../game/drops/formulas';
import { xpToNextLevel } from '../game/skills/formulas';
import { pointAround } from '../game/worldevents/formulas';
import { createShadowVector, sunShadowAt } from '../world/calendar';
import { parseGameCommand } from '../game/commands';
import type { InventorySystem } from '../game/inventory/system';
import type { PlayerSystem } from '../game/player/system';
import { createSimulation } from '../game/setup';
import type { Simulation } from '../game/sim';

/** The probe's argument stream: xorshift32 (whole numbers only, the same in every engine). */
class ArgStream {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  /** Next 32 random bits. */
  u32(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s;
  }
  /** Uniform in [0, 1) from 53 bits. */
  unit(): number {
    return ((this.u32() >>> 5) * 67108864 + (this.u32() >>> 6)) / 9007199254740992;
  }
}

/** FNV-1a over the bits of doubles. */
class BitDigest {
  private h = 0x811c9dc5;
  private readonly cell = new Float64Array(1);
  private readonly bytes = new Uint8Array(this.cell.buffer);
  add(v: number): void {
    this.cell[0] = v;
    for (let j = 0; j < 8; j++) {
      this.h ^= this.bytes[j] as number;
      this.h = Math.imul(this.h, 0x01000193);
    }
  }
  hex(): string {
    return (this.h >>> 0).toString(16).padStart(8, '0');
  }
}

/** The argument kinds of the digests. */
interface MathArgs {
  /** Angles over the whole portable range, half of them within ±8π. */
  readonly angle: number;
  /** A positive double of any exponent (random bits). */
  readonly positive: number;
  /** An exponent of e^x over its finite range. */
  readonly exp: number;
  /** An exponent of 2^x. */
  readonly exp2: number;
  /** Base and exponent of x^y. */
  readonly base: number;
  readonly power: number;
}

const POSITIVE_BITS = new DataView(new ArrayBuffer(8));
const EXP_SPAN = 1450;
const EXP_LOW = -745;
const EXP2_SPAN = 2040;
const EXP2_LOW = -1020;
const POW_BASE_MAX = 1000;
const POW_EXPONENT_SPAN = 16;
const SMALL_ANGLE = 8 * Math.PI;

function nextArgs(s: ArgStream): MathArgs {
  const wide = s.u32() & 1;
  const angle = (s.unit() * 2 - 1) * (wide === 1 ? PORTABLE_TRIG_MAX : SMALL_ANGLE);
  // A positive finite double from random bits: exponent field 1 … 2046.
  POSITIVE_BITS.setUint32(0, (((s.u32() % 2046) + 1) << 20) | (s.u32() & 0xfffff));
  POSITIVE_BITS.setUint32(4, s.u32());
  const positive = POSITIVE_BITS.getFloat64(0);
  const exp = EXP_LOW + s.unit() * EXP_SPAN;
  const exp2 = EXP2_LOW + s.unit() * EXP2_SPAN;
  const base = s.unit() * POW_BASE_MAX;
  // Every fourth exponent whole (the squaring path), the others fractional.
  const raw = (s.unit() - 0.5) * POW_EXPONENT_SPAN;
  const power = (s.u32() & 3) === 0 ? Math.round(raw) : raw;
  return { angle, positive, exp, exp2, base, power };
}

/** Digests of the portable functions over `count` argument sets (hex FNV-1a per function). */
export function portableMathDigest(count: number): Record<string, string> {
  const s = new ArgStream(0x5eed);
  const d = { sin: new BitDigest(), cos: new BitDigest(), sinCos: new BitDigest(), log: new BitDigest(), exp: new BitDigest(), exp2: new BitDigest(), pow: new BitDigest() };
  const r = createSinCosRegister();
  for (let i = 0; i < count; i++) {
    const a = nextArgs(s);
    d.sin.add(psin(a.angle));
    d.cos.add(pcos(a.angle));
    r[0] = a.angle;
    sinCosIn(r);
    d.sinCos.add(r[SIN_COS_SIN] as number);
    d.sinCos.add(r[SIN_COS_COS] as number);
    d.log.add(plog(a.positive));
    d.exp.add(pexp(a.exp));
    d.exp2.add(pexp2(a.exp2));
    d.pow.add(ppow(a.base, a.power));
  }
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.hex()]));
}

/** Digests of the engine's own `Math` functions over the same arguments (the control). */
export function engineMathDigest(count: number): Record<string, string> {
  const s = new ArgStream(0x5eed);
  const d = { sin: new BitDigest(), cos: new BitDigest(), tan: new BitDigest(), atan2: new BitDigest(), hypot: new BitDigest(), log: new BitDigest(), exp: new BitDigest(), pow: new BitDigest(), sqrt: new BitDigest() };
  for (let i = 0; i < count; i++) {
    const a = nextArgs(s);
    d.sin.add(Math.sin(a.angle));
    d.cos.add(Math.cos(a.angle));
    d.tan.add(Math.tan(a.angle));
    d.atan2.add(Math.atan2(a.angle, a.exp));
    d.hypot.add(Math.hypot(a.angle, a.exp));
    d.log.add(Math.log(a.positive));
    d.exp.add(Math.exp(a.exp));
    d.pow.add(Math.pow(a.base, a.power));
    d.sqrt.add(Math.sqrt(a.positive));
  }
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.hex()]));
}

/** World coordinates of the formula digest [px]: half the calls at the origin (no addition absorbs a last bit). */
const WORLD_PX = 8192;
const DROP_DISTANCE_PX = 64;
const CIRCLES = 6;
const BOSS_DIAMETER_PX = 40;
const STRIKE_RANGE: readonly number[] = [0, 30];
const BURN_RING_TILES = 12;
const FLICKER_SECONDS = 3600;
const HOURS = 24;
const ARC_DEG = 360;
const SKILL_LEVELS = 99;

/**
 * Digest of the simulation's own formulas that used engine trigonometry or powers before M7-76 (drop landing spots, the
 * world events' points, boss circles and arena rings, block and sight cones, the sun's shadow vector, light cones and
 * flicker, angle vectors, the XP table) over `count` argument sets – one FNV-1a over all their results' bits.
 */
export function simFormulaDigest(count: number): string {
  const s = new ArgStream(0xf0f0);
  const d = new BitDigest();
  const p = { x: 0, y: 0 };
  const shadow = createShadowVector();
  const v = vec2(0, 0);
  for (let i = 0; i < count; i++) {
    const origin = (s.u32() & 1) === 0;
    const x = origin ? 0 : s.unit() * WORLD_PX;
    const y = origin ? 0 : s.unit() * WORLD_PX;
    const angle = (s.unit() * 2 - 1) * Math.PI;
    const a = s.unit();
    const b = s.unit();
    landingSpot(x, y, angle, b * DROP_DISTANCE_PX, p);
    d.add(p.x);
    d.add(p.y);
    pointAround(x, y, STRIKE_RANGE, a, b, p);
    d.add(p.x);
    d.add(p.y);
    circleCentre(x, y, 1 + (s.u32() % (CIRCLES - 1)), CIRCLES, BOSS_DIAMETER_PX, p);
    d.add(p.x);
    d.add(p.y);
    const dx = (s.unit() - 0.5) * DROP_DISTANCE_PX;
    const dy = (s.unit() - 0.5) * DROP_DISTANCE_PX;
    d.add(blockCovers(angle, dx, dy, a * ARC_DEG) ? 1 : 0);
    d.add(inSightCone(angle, dx, dy) ? 1 : 0);
    sunShadowAt(SEASON_IDS[s.u32() % SEASON_IDS.length] as (typeof SEASON_IDS)[number], a * HOURS, shadow);
    d.add(shadow.dirX);
    d.add(shadow.dirY);
    d.add(shadow.length);
    d.add(shadow.strength);
    d.add(shadow.elevationDeg);
    d.add(lightConeOuter(a * 2 * Math.PI));
    d.add(lightConeInner(a * 2 * Math.PI));
    d.add(coneCosine(dx, dy, angle));
    d.add(lightFlicker(a, b, s.unit() * FLICKER_SECONDS));
    v2FromAngle(v, angle, b);
    d.add(v.x);
    d.add(v.y);
    v2Rotate(v, v, a);
    d.add(v.x);
    d.add(v.y);
  }
  for (const t of fallbackBurnTiles(0, 0, BURN_RING_TILES)) {
    d.add(t.tx);
    d.add(t.ty);
  }
  for (let level = 1; level <= SKILL_LEVELS; level++) d.add(xpToNextLevel(level));
  return d.hex();
}

/** The fixture world (tools/save/fixture.ts `FIXTURE_WORLD`): small, the start beach behind the player. */
export const PROBE_WORLD = { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } as const;
const TILE = 16;
const SETTLE_TICKS = 30;
/** Ticks of one walking leg and of one blow cycle (on, then off). */
const LEG_TICKS = 120;
const BLOW_ON_TICKS = 10;
const BLOW_CYCLE_TICKS = 18;
/** Aim offsets [px] of the eight blow directions (whole numbers: no engine math decides a command). */
const AIMS: ReadonlyArray<readonly [number, number]> = [
  [48, 0],
  [34, 34],
  [0, 48],
  [-34, 34],
  [-48, 0],
  [-34, -34],
  [0, -48],
  [34, -34],
];
/** The walking round: steps per leg. */
const LEGS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
  [0, 0],
];
const LIGHTNING_EVERY_TICKS = 300;

/** Result of `determinismRun`. */
export interface DeterminismRun {
  readonly tick: number;
  /** `Simulation.hashState()` after every `checkpointTicks` of the scripted part and at its end. */
  readonly hashes: readonly string[];
  /** Events of the scripted part per type (what the run exercised: blows, bites, deaths, drops, shots …). */
  readonly events: Readonly<Record<string, number>>;
}

function sys<T>(sim: Simulation, id: string): T {
  return sim.system(id) as unknown as T;
}

/** Plays the probe's fixed command stream for `ticks` ticks after the set-up; see the module comment. */
export function determinismRun(ticks: number, checkpointTicks: number): DeterminismRun {
  if (!Number.isSafeInteger(ticks) || ticks < 1 || !Number.isSafeInteger(checkpointTicks) || checkpointTicks < 1) throw new RangeError('determinismRun: ticks and checkpointTicks must be whole numbers ≥ 1');
  const sim = createSimulation(PROBE_WORLD);
  const events: Record<string, number> = {};
  let counting = false;
  const step = (commands: readonly GameCommand[] = [], n = 1): void => {
    for (let i = 0; i < n; i++) {
      sim.step(i === 0 ? commands.map((c) => parseGameCommand(c)) : undefined);
      sim.events.drain((...event) => {
        if (counting) events[event[0]] = (events[event[0]] ?? 0) + 1;
      });
    }
  };
  step([{ type: 'player.spawn' }], SETTLE_TICKS);
  const player = sys<PlayerSystem>(sim, 'player');
  const at = { x: 0, y: 0 };
  if (!player.position(sim, at)) throw new Error('determinismRun: kein Spieler');
  const tx = Math.floor(at.x / TILE);
  const ty = Math.floor(at.y / TILE);
  const tileCentre = (dx: number, dy: number): { x: number; y: number } => ({ x: (tx + dx) * TILE + TILE / 2, y: (ty + dy) * TILE + TILE / 2 });
  step([{ type: 'setTime', hour: 19, minute: 0 }, { type: 'debug.god', on: true }]);
  step([{ type: 'inventory.give', item: 'bronzeschwert', count: 1 }]);
  const inventory = sys<InventorySystem>(sim, 'inventory');
  const index = inventory.state.schnellleiste.findIndex((slot) => slot?.item === 'bronzeschwert');
  if (index < 0) throw new Error('determinismRun: das Schwert liegt nicht in der Schnellleiste');
  step([{ type: 'player.selectHotbar', index }]);
  step([
    { type: 'creature.spawn', creature: 'wolf', count: 3, ...tileCentre(-5, -10), layer: 0 },
    { type: 'creature.spawn', creature: 'speier', count: 1, ...tileCentre(4, -8), layer: 0 },
    { type: 'fear.set', value: 80 },
    { type: 'worldEvent.start', event: 'lumenregen' },
  ]);
  const hashes: string[] = [];
  counting = true;
  for (let t = 0; t < ticks; t++) {
    const commands: GameCommand[] = [];
    if (t % LEG_TICKS === 0) {
      const leg = LEGS[(t / LEG_TICKS) % LEGS.length] as readonly [number, number];
      commands.push({ type: 'player.move', dx: leg[0], dy: leg[1] });
    }
    const phase = t % BLOW_CYCLE_TICKS;
    if (phase === 0) {
      player.position(sim, at);
      const aim = AIMS[Math.floor(t / BLOW_CYCLE_TICKS) % AIMS.length] as readonly [number, number];
      commands.push({ type: 'player.aim', x: Math.round(at.x) + aim[0], y: Math.round(at.y) + aim[1] }, { type: 'combat.attack', on: true });
    } else if (phase === BLOW_ON_TICKS) commands.push({ type: 'combat.attack', on: false });
    if (t % LIGHTNING_EVERY_TICKS === LIGHTNING_EVERY_TICKS - 1) commands.push({ type: 'lightning.strike' });
    step(commands);
    if ((t + 1) % checkpointTicks === 0 || t === ticks - 1) hashes.push(sim.hashState());
  }
  return { tick: sim.tick, hashes, events };
}

/** Largest probe sizes a page call accepts (a run of 36 000 ticks is ten game minutes at 60 Hz). */
const MAX_PROBE_TICKS = 36_000;
const MAX_MATH_ARGS = 2_000_000;

function wholeIn(name: string, v: unknown, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v > max) throw new TypeError(`determinismProbe: ${name} muss eine ganze Zahl 1 … ${max} sein`);
  return v;
}

/**
 * `__dh.call` extensions of the probe (src/debug/boot.tsx): `determinismRun(ticks, checkpointTicks)` and
 * `mathDigest(count)` (portable and engine digests) – the page's side of tests/e2e/determinismus.spec.ts.
 */
export function determinismExtensions(): Record<string, (...args: never[]) => unknown> {
  return {
    determinismRun: (ticks: unknown, checkpointTicks: unknown) => determinismRun(wholeIn('ticks', ticks, MAX_PROBE_TICKS), wholeIn('checkpointTicks', checkpointTicks, MAX_PROBE_TICKS)),
    mathDigest: (count: unknown) => {
      const n = wholeIn('count', count, MAX_MATH_ARGS);
      return { portable: portableMathDigest(n), engine: engineMathDigest(n), formulas: simFormulaDigest(n) };
    },
  };
}
