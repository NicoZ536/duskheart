/**
 * Fear system (MASTERPROMPT §12.3, M3-23): the player's fear rises in the dark and in corrupted land and
 * with frights, falls in light, at fires, in cosy rooms, with music, companions and sleep
 * (`formulas.ts`), and acts through its stages:
 * - from 20 the HUD shows the fear eye, from 40 whispers and shadows at the screen edge
 *   (`fearStageChanged`, `fearStageEffects`);
 * - from 60 hallucinations creep out of the dark towards the player and the picture loses colour
 *   (`desaturation`); they dissolve in light, when struck (`strikeHallucination`), when they touch the
 *   player, when their time runs out or when fear falls below 60 again;
 * - from 80 hallucinations that reach the player hurt (a hit: `playerAfflicted`, eating stops, sleep ends);
 * - at 100 the Nachtmahr hunts the player (`nightmareSummoned`; `onNightmare` for the creature of M6)
 *   until the player stands in glaring light (> 0,9) or defeats it (`banishNightmare`).
 *
 * Inputs: light at the player (`FearEnvironment.lightAt`: the ambient light until the gameplay light map
 * of M3-21 replaces it with `useLight`), night, the warmth of fires (the vitals' heat of this tick), the
 * modifiers (asleep), surroundings providers (`addSurroundings`: corruption, rooms, music, companions),
 * the equipment's fear resistance and the conditions' own fear rate. A dead player's fear stands still;
 * the death system resets it. Global. Save participant `fear`.
 */
import { BALANCE } from '../../content/balance';
import type { FearStage } from '../../content/balance/fear';
import { NULL_ENTITY, isEntityHandle, type Entity } from '../../engine/ecs';
import { z } from 'zod';
import { TILE_PX, type Layer } from '../../world/model/coords';
import type { ConditionsSystem } from '../conditions/system';
import type { PlayerHarm } from '../conditions/harm';
import type { PlayerComponents } from '../player/components';
import type { SaveParticipant } from '../participant';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { PlayerInfluences } from '../survival/modifiers';
import type { Vitals } from '../survival/state';
import type { MotionSystem } from '../systems/motion';
import type { FearChangeReason, HallucinationEnd, NightmareEnd } from './events';
import { clampFear, createFearSurroundings, fearRatePerSecond, fearStage, fearStageEffects, frightAmount, hallucinationIntervalSeconds, type FearSurroundings } from './formulas';
import { copyFearState, createFearState, fearStateSchema, type FearState, type Hallucination } from './state';

/** Id of the fear system and its save participant. */
export const FEAR_SYSTEM_ID = 'fear';
/** Data version of the `fear` participant. */
export const FEAR_SAVE_VERSION = 1;
/** Random stream of the hallucinations (when and where they appear). */
export const FEAR_RNG_STREAM = 'fear';

const F = BALANCE.fear;
/** Light stage borders of the gameplay light map [0–1] (§12.1). */
const LIGHT = BALANCE.light.map.stages;
const H = F.hallucinations;
const TICK_HZ = BALANCE.time.tickHz;
/** Direction samples shorter than this are replaced by a fixed direction [unit length]. */
const MIN_DIRECTION = 0.001;
/** Share of the mean interval the shortest pause between two hallucinations lasts (the rest is drawn). */
const INTERVAL_JITTER_MIN = 0.5;

const fearSnapshotSchema = z
  .object({
    entity: z.number().int().refine((e) => e === NULL_ENTITY || isEntityHandle(e), { message: 'must be an entity handle or -1' }),
    fear: fearStateSchema,
  })
  .strict();

/** Light level at world px (x, y) on `layer` [0–1] (§12.1). */
export type LightSampler = (sim: Simulation, layer: Layer, x: number, y: number) => number;

/** What the fear system reads from the world. */
export interface FearEnvironment {
  /** Light level at a point. */
  readonly lightAt: LightSampler;
  /** Whether it is night (the dark rises fear on the surface only at night, §12.3). */
  night(sim: Simulation): boolean;
}

/** Adds what a system knows about the player's surroundings (corruption, room comfort, music, companion). */
export type FearSurroundingsProvider = (sim: Simulation, player: Entity, out: FearSurroundings) => void;

/** Called when the Nachtmahr begins to hunt the player (the creature of M6 spawns here). */
export type NightmareListener = (sim: Simulation, player: Entity) => void;

/** Dependencies of the fear system. */
export interface FearSystemDeps {
  readonly components: PlayerComponents;
  readonly influences: PlayerInfluences;
  readonly motion: MotionSystem;
  readonly conditions: ConditionsSystem;
  readonly harm: PlayerHarm;
  readonly environment: FearEnvironment;
  /** Fear resistance of the worn equipment [0–1] (default none). */
  readonly resistance?: () => number;
}

export class FearSystem implements SimSystem {
  readonly id = FEAR_SYSTEM_ID;
  readonly timeScope = 'global';
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  private readonly components: PlayerComponents;
  private readonly influences: PlayerInfluences;
  private readonly motion: MotionSystem;
  private readonly conditions: ConditionsSystem;
  private readonly harm: PlayerHarm;
  private readonly environment: FearEnvironment;
  private readonly resistance: () => number;
  private light: LightSampler;
  private readonly providers: FearSurroundingsProvider[] = [];
  private readonly nightmareListeners: NightmareListener[] = [];
  private readonly surroundings = createFearSurroundings();
  private owner: Entity = NULL_ENTITY;
  private stateValue: FearState = createFearState();

  constructor(deps: FearSystemDeps) {
    this.components = deps.components;
    this.influences = deps.influences;
    this.motion = deps.motion;
    this.conditions = deps.conditions;
    this.harm = deps.harm;
    this.environment = deps.environment;
    this.light = deps.environment.lightAt;
    this.resistance = deps.resistance ?? ((): number => 0);
    this.commands = {
      'fear.set': (sim, cmd, tick) => {
        const e = this.playerOf(sim);
        if (e === NULL_ENTITY) {
          sim.events.push('commandRejected', { type: cmd.type, reason: 'noPlayer', tick });
          return;
        }
        this.setValue(sim, e, cmd.value);
      },
    };
    this.save = {
      id: FEAR_SYSTEM_ID,
      version: FEAR_SAVE_VERSION,
      serialize: () => ({ entity: this.owner, fear: copyFearState(this.stateValue) }),
      deserialize: (data) => {
        const parsed = fearSnapshotSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`fear snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        const f = parsed.data.fear;
        if (f.value > F.max) throw new TypeError(`fear snapshot invalid: fear ${f.value} above ${F.max}`);
        if (f.stage !== fearStage(f.value)) throw new TypeError(`fear snapshot invalid: stage ${f.stage} does not match fear ${f.value}`);
        this.owner = parsed.data.entity;
        this.stateValue = copyFearState(f);
      },
    };
  }

  /** The player's fear state (read-only for callers). */
  get state(): Readonly<FearState> {
    return this.stateValue;
  }

  /** The Nachtmahr hunts the player: a threat that forbids sleep (§11.5). */
  get pursued(): boolean {
    return this.stateValue.pursued;
  }

  /** Replaces the light sampler (the gameplay light map of M3-21). */
  useLight(sampler: LightSampler): void {
    this.light = sampler;
  }

  /** Adds a provider of the player's surroundings (corruption, rooms, music, companions). */
  addSurroundings(provider: FearSurroundingsProvider): void {
    this.providers.push(provider);
  }

  /** Adds a listener for the Nachtmahr's appearance (the creature, M6). */
  onNightmare(listener: NightmareListener): void {
    this.nightmareListeners.push(listener);
  }

  /** A sudden fright of `amount` [points] (§12.3: sighting +10, bad food +5, a settler's death +20), lowered by the fear resistance. */
  spike(sim: Simulation, amount: number, reason: FearChangeReason): void {
    const e = this.playerOf(sim);
    if (e === NULL_ENTITY || !(amount > 0)) return;
    this.change(sim, e, frightAmount(amount, this.resistance()), reason);
  }

  /** Calms fear by `amount` [points] (§12.3 comfort food −10 … −25). */
  soothe(sim: Simulation, amount: number, reason: FearChangeReason): void {
    const e = this.playerOf(sim);
    if (e === NULL_ENTITY || !(amount > 0)) return;
    this.change(sim, e, -amount, reason);
  }

  /** A hallucination was struck: it dissolves (§12.3 "verschwinden bei Treffer"). Returns whether it existed. */
  strikeHallucination(sim: Simulation, id: number): boolean {
    const i = this.stateValue.hallucinations.findIndex((h) => h.id === id);
    if (i < 0) return false;
    this.vanish(sim, i, 'treffer');
    return true;
  }

  /** Ends the Nachtmahr's pursuit (defeated in combat, M6). */
  banishNightmare(sim: Simulation, reason: NightmareEnd): void {
    const s = this.stateValue;
    if (!s.pursued) return;
    s.pursued = false;
    sim.events.push('nightmareEnded', { entity: this.owner, reason, tick: sim.eventTick });
  }

  /** Death: fear is gone, hallucinations dissolve, the Nachtmahr leaves (§11.6 – the respawned player starts calm). */
  reset(sim: Simulation): void {
    const e = this.playerOf(sim);
    this.banishNightmare(sim, 'tod');
    while (this.stateValue.hallucinations.length > 0) this.vanish(sim, 0, 'mut');
    if (e !== NULL_ENTITY) this.setValue(sim, e, 0);
    this.stateValue.nextHallucinationTicks = 0;
  }

  update(sim: Simulation, dt: number): void {
    const e = this.playerOf(sim);
    if (e === NULL_ENTITY) return;
    const v = this.components.vitals.get(e);
    const body = this.components.body.get(e);
    const row = this.motion.position.indexOf(e);
    if (v === undefined || body === undefined || row < 0 || v.health <= 0) return;
    const x = this.motion.position.columns.x[row] as number;
    const y = this.motion.position.columns.y[row] as number;
    const layer = body.layer;
    const mods = this.influences.ensureFresh(sim, e);
    const s = this.surroundings;
    s.light = this.light(sim, layer, x, y);
    s.night = this.environment.night(sim);
    s.underground = layer < 0;
    s.corruption = false;
    s.atFire = v.heatC > 0;
    s.roomComfort = 0;
    s.music = false;
    s.companion = false;
    s.sleeping = mods.sleeping;
    for (let i = 0; i < this.providers.length; i++) (this.providers[i] as FearSurroundingsProvider)(sim, e, s);
    const secondsPerGameHour = sim.clock.ticksPerGameHour / TICK_HZ;
    const rate = fearRatePerSecond(s, this.resistance(), this.conditions.effects().fearPerSecond, secondsPerGameHour);
    this.setValue(sim, e, this.stateValue.value + rate * dt);
    this.nightmare(sim, e, s.light);
    this.hallucinations(sim, e, v, layer, x, y, dt, s.sleeping);
  }

  // -------------------------------------------------------------------------------------------

  /** The Nachtmahr begins at 100 and gives up in glaring light. */
  private nightmare(sim: Simulation, e: Entity, light: number): void {
    const s = this.stateValue;
    if (!s.pursued && s.value >= F.stages.nightmareAt) {
      s.pursued = true;
      sim.events.push('nightmareSummoned', { entity: e, tick: sim.eventTick });
      for (const l of this.nightmareListeners) l(sim, e);
    } else if (s.pursued && light > LIGHT.glaringAbove) this.banishNightmare(sim, 'licht');
  }

  /** Moves, dissolves and spawns the hallucinations of this tick. */
  private hallucinations(sim: Simulation, e: Entity, v: Vitals, layer: Layer, px: number, py: number, dt: number, sleeping: boolean): void {
    const s = this.stateValue;
    const interval = sleeping ? null : hallucinationIntervalSeconds(s.stage);
    if (interval === null) {
      while (s.hallucinations.length > 0) this.vanish(sim, 0, 'mut');
      s.nextHallucinationTicks = 0;
      return;
    }
    const step = H.speedTilesPerSecond * TILE_PX * dt;
    const reach = H.reachTiles * TILE_PX;
    const life = H.lifetimeSeconds * TICK_HZ;
    for (let i = 0; i < s.hallucinations.length; ) {
      const h = s.hallucinations[i] as Hallucination;
      h.ageTicks++;
      if (h.layer !== layer || h.ageTicks >= life) {
        this.vanish(sim, i, 'zeit');
        continue;
      }
      if (this.light(sim, layer, h.x, h.y) >= LIGHT.brightFrom) {
        this.vanish(sim, i, 'licht');
        continue;
      }
      const dx = px - h.x;
      const dy = py - h.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= reach) {
        if (h.harmful) this.strike(sim, e, v);
        this.vanish(sim, i, h.harmful ? 'angriff' : 'beruehrt');
        continue;
      }
      const move = step < dist ? step : dist;
      h.x += (dx / dist) * move;
      h.y += (dy / dist) * move;
      i++;
    }
    if (s.nextHallucinationTicks === 0) s.nextHallucinationTicks = this.drawPause(sim, interval);
    else if (--s.nextHallucinationTicks === 0) {
      if (s.hallucinations.length < H.max) this.spawn(sim, e, layer, px, py);
      s.nextHallucinationTicks = this.drawPause(sim, interval);
    }
  }

  /** A pause of 0,5 … 1,5 × the mean interval [ticks, ≥ 1]. */
  private drawPause(sim: Simulation, intervalSeconds: number): number {
    const factor = INTERVAL_JITTER_MIN + sim.rng.stream(FEAR_RNG_STREAM).next();
    return Math.max(1, Math.round(intervalSeconds * factor * TICK_HZ));
  }

  /** A new hallucination on the spawn ring around (px, py). */
  private spawn(sim: Simulation, e: Entity, layer: Layer, px: number, py: number): void {
    const rng = sim.rng.stream(FEAR_RNG_STREAM);
    let ux = rng.float(-1, 1);
    let uy = rng.float(-1, 1);
    let len = Math.sqrt(ux * ux + uy * uy);
    if (len < MIN_DIRECTION) {
      ux = 1;
      uy = 0;
      len = 1;
    }
    const dist = rng.float(H.spawnMinTiles, H.spawnMaxTiles) * TILE_PX;
    const s = this.stateValue;
    const h: Hallucination = { id: s.nextHallucinationId++, x: px + (ux / len) * dist, y: py + (uy / len) * dist, layer, harmful: fearStageEffects(s.stage).harmful, ageTicks: 0 };
    s.hallucinations.push(h);
    sim.events.push('hallucinationAppeared', { entity: e, id: h.id, x: h.x, y: h.y, harmful: h.harmful, tick: sim.eventTick });
  }

  /** A harmful hallucination reached the player: a hit (§12.3 "ab 80 … echten Schaden"); none in god mode. */
  private strike(sim: Simulation, e: Entity, v: Vitals): void {
    if (this.harm.spared) return;
    const amount = this.harm.hurt(v, H.damage);
    this.harm.markHit(sim, 'trugbild', v.health <= 0);
    if (amount > 0) sim.events.push('playerAfflicted', { entity: e, source: 'trugbild', id: 'trugbild', amount, health: v.health, lethal: v.health <= 0, tick: sim.eventTick });
  }

  private vanish(sim: Simulation, index: number, reason: HallucinationEnd): void {
    const h = this.stateValue.hallucinations[index] as Hallucination;
    this.stateValue.hallucinations.splice(index, 1);
    sim.events.push('hallucinationVanished', { entity: this.owner, id: h.id, reason, tick: sim.eventTick });
  }

  /** Changes fear by `delta` and reports it (`fearChanged`: the change that took effect within 0–100). */
  private change(sim: Simulation, e: Entity, delta: number, reason: FearChangeReason): void {
    const before = this.stateValue.value;
    const target = before + delta;
    this.setValue(sim, e, target);
    const after = this.stateValue.value;
    sim.events.push('fearChanged', { entity: e, amount: after === target ? delta : after - before, reason, value: after, tick: sim.eventTick });
  }

  /** Sets fear (clamped) and reports a stage change. */
  private setValue(sim: Simulation, e: Entity, value: number): void {
    const s = this.stateValue;
    s.value = clampFear(value);
    const stage: FearStage = fearStage(s.value);
    if (stage !== s.stage) {
      const previous = s.stage;
      s.stage = stage;
      sim.events.push('fearStageChanged', { entity: e, stage, previous, value: s.value, tick: sim.eventTick });
    }
  }

  /** The player, resetting fear when a new player entity took over. */
  private playerOf(sim: Simulation): Entity {
    const e = sim.player;
    if (e !== this.owner) {
      this.owner = e;
      this.stateValue = createFearState();
    }
    return e;
  }
}
