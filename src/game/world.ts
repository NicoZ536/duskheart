/**
 * The world of a simulation (docs/ARCHITEKTUR.md "Simulation", "Aktive Zone", "Weltgenerierung";
 * docs/WORLD.md §2, §5, §6).
 *
 * `SimWorld` binds the world layer into the game simulation:
 * - the generated world (`GeneratedWorld`, a pure function of seed and size: handed in from the world
 *   worker, or generated in this thread through `worldFor`),
 * - the chunk store (`ChunkManager` over `generateChunk`): the presentation streams it around the
 *   camera, the active zone makes its chunks resident synchronously (`ensure`),
 * - the active zone around the focus (the player; until M3 the controlled entity on the surface)
 *   with the catch-up registry sealed against the simulation's systems,
 * - calendar, weather regions and temperature field.
 *
 * Materialisation is lazy and in two stages: `createSimulation` registers the systems and their
 * save participants, but builds nothing of the world.
 * - Plan stage (world plan, ≈ ⅓ of the generation time): weather regions and temperature field –
 *   at the first world tick, when the weather is saved or loaded, or when read.
 * - World stage (generated world): chunk store and active zone – when the zone gets a focus, when
 *   the zone is loaded with chunks, or when the presentation reads `generated`/`chunks`/`zone`.
 * This keeps simulations that never reach the world (short unit tests, command validation) free of
 * the generation cost. It never changes the state: plan and world are pure functions of the config
 * (the world stage reuses the plan of the plan stage), the weather automaton depends only on the
 * minutes it is advanced to (a weather system created at its first world tick equals one that existed
 * since tick 0), and a zone without focus has nothing active.
 *
 * Systems (in `createSimulation`'s order):
 * - `world-chunks` (first system, global): moves the zone to the focus at the start of every tick,
 *   releases the chunks it froze when nothing streams (`ChunkManager.trim`), save participant of the
 *   zone and `stateDigest` = digest of every chunk change (part of `hashState`).
 * - `calendar` (the `Calendar` itself, no hooks), `weather-regions` (world tick, save participant)
 *   and `temperature` (world tick, no state).
 */
import { Fnv1a64 } from '../engine/binary';
import { JobQueue, inThreadExecutor } from '../engine/workerBridge';
import { BALANCE, SEASON_IDS } from '../content/balance';
import { DAWN_MINUTE, MINUTES_PER_DAY, MINUTES_PER_HOUR } from '../engine/time';
import { Calendar } from '../world/calendar';
import { NO_WEATHER_REGION, TEMPERATURE_SYSTEM_ID, TemperatureField } from '../world/climate/temperature';
import { WEATHER_PARTICIPANT_ID, WEATHER_SAVE_VERSION, WeatherSystem } from '../world/climate/weather';
import { generateChunk } from '../world/gen/chunk';
import { cellAtTile } from '../world/gen/plan/grid';
import { WORLD_GEN_VERSION, type GeneratedWorld } from '../world/gen/world';
import type { ChunkSource } from '../world/collision/chunkSource';
import { tileToChunk, type Layer } from '../world/model/coords';
import { worldDimensions } from '../world/model/worldSize';
import { ActiveZone, WORLD_CHUNKS_PARTICIPANT_ID, WORLD_CHUNKS_SAVE_VERSION, worldChunksSnapshotSchema } from '../world/stream/activeZone';
import { TIME_SCOPE_GLOBAL, isTimeDependent, type CatchUpRegistry } from '../world/stream/catchUp';
import { ChunkManager } from '../world/stream/chunkManager';
import type { StreamConfig } from '../world/stream/config';
import { createChunkWorkerHandlers, type ChunkWorkerApi } from '../world/stream/worker';
import type { CommandOfType } from './commands';
import type { SaveParticipant } from './participant';
import type { CommandHandlers, SimConfig, SimSystem, Simulation } from './sim';
import { cachedWorld, planFor, rememberWorld, worldFor } from './worldCache';

/** Job queue of the chunk streaming over the generated world. */
export type ChunkJobs = JobQueue<ChunkWorkerApi<GeneratedWorld>>;

/** How a simulation gets its world. */
export interface SimWorldOptions {
  /** A world generated elsewhere (browser: `requestWorld` in the world worker); must match seed and size of the config. */
  readonly world?: GeneratedWorld;
  /**
   * Builds the job queue of the chunk streaming (browser: `createJobExecutor` with the world worker and
   * `performance.now` as clock). Default: an in-thread queue without clock – the simulation layers may
   * not read wall-clock time (docs/ARCHITEKTUR.md "Determinismus"), so it has no frame budget; that
   * is enough for simulations that only `ensure` chunks (headless, tests, tools).
   */
  readonly chunkJobs?: (world: GeneratedWorld) => ChunkJobs;
  /** Overrides of the streaming and active zone radii (`BALANCE.stream`). */
  readonly stream?: Partial<StreamConfig>;
}

/** Where the player is: layer and world tile. */
export interface WorldFocus {
  layer: Layer;
  tx: number;
  ty: number;
}

/** Writes the current focus into `out`; `false` when there is none (no player). Must not allocate. */
export type WorldFocusSource = (out: WorldFocus) => boolean;

/** Plan stage: what needs only the world plan (its regions). */
interface PlanStage {
  readonly weather: WeatherSystem;
  readonly temperature: TemperatureField;
  readonly regionAt: (tx: number, ty: number) => number;
}

/** World stage: what needs the generated world. */
interface WorldStage {
  readonly generated: GeneratedWorld;
  readonly chunks: ChunkManager<GeneratedWorld>;
  readonly zone: ActiveZone;
}

/** Digest of a world without chunk changes (equals `ChunkManager.contentHash()` of an untouched world). */
const UNCHANGED_WORLD_DIGEST = new Fnv1a64().hex();

/** Clock of the default in-thread chunk queue (no wall-clock time in the simulation layers). */
const NO_CLOCK = (): number => 0;

/** Throws when a handed-in world does not belong to the config. */
function assertWorldMatches(world: GeneratedWorld, config: SimConfig): void {
  if (world.seed !== config.seed || world.preset !== config.worldSize || world.version !== WORLD_GEN_VERSION) {
    throw new RangeError(
      `SimWorld: the world (seed ${world.seed}, ${world.preset}, generator ${world.version}) does not belong to the simulation (seed ${config.seed}, ${config.worldSize}, generator ${WORLD_GEN_VERSION})`,
    );
  }
}

/** The in-thread chunk queue used when no `chunkJobs` factory is given. */
function inThreadChunkJobs(): ChunkJobs {
  return new JobQueue(inThreadExecutor(createChunkWorkerHandlers(generateChunk)), { frameBudgetMs: BALANCE.stream.jobFrameBudgetMs, now: NO_CLOCK });
}

/** The world of one simulation (see module comment). */
export class SimWorld {
  /** The calendar (global, needs no world). */
  readonly calendar: Calendar;
  private readonly sim: Simulation;
  private readonly options: SimWorldOptions;
  private provided: GeneratedWorld | null = null;
  private planStage: PlanStage | null = null;
  private runtime: WorldStage | null = null;
  private registry: CatchUpRegistry | null = null;
  /** Systems the registry was sealed against (later ones are checked in `stepZone`). */
  private sealedSystems = 0;
  private focusSource: WorldFocusSource | null = null;
  private readonly focus: WorldFocus = { layer: 0, tx: 0, ty: 0 };

  constructor(sim: Simulation, options: SimWorldOptions = {}) {
    this.sim = sim;
    this.options = options;
    this.calendar = new Calendar(sim.clock);
    if (options.world !== undefined) this.provide(options.world);
  }

  /** Whether the world stage is built (generated world, chunks, zone). */
  get materialized(): boolean {
    return this.runtime !== null;
  }

  /** Whether the plan stage is built (plan, weather, temperature). */
  get planned(): boolean {
    return this.planStage !== null;
  }

  /** The generated world (materialises it). */
  get generated(): GeneratedWorld {
    return this.materialize().generated;
  }

  /** The chunk store (materialises the world). */
  get chunks(): ChunkManager<GeneratedWorld> {
    return this.materialize().chunks;
  }

  /** The active zone (materialises the world). */
  get zone(): ActiveZone {
    return this.materialize().zone;
  }

  /** The weather of the surface regions (builds the plan stage). */
  get weather(): WeatherSystem {
    return this.plans().weather;
  }

  /** The temperature field (builds the plan stage; lava heat reads the resident chunks). */
  get temperature(): TemperatureField {
    return this.plans().temperature;
  }

  /** Weather region of a surface tile (plan region of its cell; `NO_WEATHER_REGION` = −1 at sea). Builds the plan stage. */
  regionAt(tx: number, ty: number): number {
    return this.plans().regionAt(tx, ty);
  }

  /** The sealed catch-up registry of the simulation's systems. */
  get catchUp(): CatchUpRegistry {
    if (this.registry === null) throw new Error('SimWorld: the catch-up registry is sealed by createSimulation');
    return this.registry;
  }

  /**
   * Hands in the generated world before it is needed (e.g. once the world worker delivered it).
   * Throws if the world does not match the config or another world is already in use.
   */
  provide(world: GeneratedWorld): void {
    assertWorldMatches(world, this.sim.config);
    if (this.runtime !== null && this.runtime.generated !== world) throw new Error('SimWorld: the world is already materialised; provide it before the simulation needs it');
    this.provided = world;
    rememberWorld(world);
  }

  /** Seals the world against the simulation's systems (called once by `createSimulation`). */
  seal(registry: CatchUpRegistry): void {
    if (this.registry !== null) throw new Error('SimWorld: already sealed');
    if (!registry.sealed) throw new Error('SimWorld: the catch-up registry must be sealed against the system list');
    this.registry = registry;
    this.sealedSystems = this.sim.systems.length;
  }

  /** Sets where the player is (the zone follows it; no focus = nothing active). */
  setFocus(source: WorldFocusSource): void {
    this.focusSource = source;
  }

  /**
   * Moves the active zone to the focus (first system of every tick). Without focus an active zone is
   * frozen. Chunks the zone froze are released unless the camera still streams them.
   */
  stepZone(): void {
    this.checkLateSystems();
    const source = this.focusSource;
    const f = this.focus;
    if (source === null || !source(f)) {
      const rt = this.runtime;
      if (rt !== null && (rt.zone.size > 0 || rt.zone.resuming > 0)) {
        rt.zone.freezeAll();
        rt.chunks.trim();
      }
      return;
    }
    const rt = this.materialize();
    if (rt.zone.update(f.layer, tileToChunk(f.tx), tileToChunk(f.ty)) > 0) rt.chunks.trim();
  }

  /**
   * Jumps the time `ticks` forward (debug time commands, M2-29): the active zone is frozen first, so
   * its chunks catch up analytically from now to the new time when the zone activates them again in
   * this tick (`world-chunks` runs right after the commands); then the clock jumps (`skipTicks`).
   */
  jump(ticks: number): void {
    if (ticks <= 0) return;
    const rt = this.runtime;
    if (rt !== null && (rt.zone.size > 0 || rt.zone.resuming > 0)) rt.zone.freezeAll();
    this.sim.skipTicks(ticks);
  }

  /** Ticks until the clock next shows `hour:minute` (a full day when it shows it now). */
  ticksUntilTimeOfDay(hour: number, minute: number): number {
    const clock = this.sim.clock;
    const perMinute = clock.ticksPerGameMinute;
    const target = ((((hour * MINUTES_PER_HOUR + minute - DAWN_MINUTE) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY) * perMinute;
    const ahead = (target - clock.dayTick + clock.ticksPerDay) % clock.ticksPerDay;
    return ahead === 0 ? clock.ticksPerDay : ahead;
  }

  /** Ticks until 06:00 of the first day of the next `season` (at most two years ahead). */
  ticksUntilSeason(season: CommandOfType<'setSeason'>['season']): number {
    const clock = this.sim.clock;
    const cal = this.calendar;
    const searchDays = 2 * SEASON_IDS.length * BALANCE.calendar.maxSeasonLengthDays;
    for (let d = clock.dawns + 2; d <= clock.dawns + 1 + searchDays; d++) {
      const sd = cal.seasonDayOf(d);
      if (sd.season !== season || sd.dayOfSeason !== 1) continue;
      // 06:00 of day d is the (d − 1)-th dawn.
      const ticks = (d - 1 - clock.dawns) * clock.ticksPerDay - clock.dayTick;
      if (ticks > 0) return ticks;
    }
    throw new Error(`SimWorld: no start of season ${season} within ${searchDays} days`);
  }

  /** Digest of every chunk change against the generated world (independent of residency). */
  contentDigest(): string {
    return this.runtime === null ? UNCHANGED_WORLD_DIGEST : this.runtime.chunks.contentHash();
  }

  /** Save participant `world-chunks` (the zone's frozen ticks and active set). */
  zoneParticipant(): SaveParticipant {
    return {
      id: WORLD_CHUNKS_PARTICIPANT_ID,
      version: WORLD_CHUNKS_SAVE_VERSION,
      // A world that was never materialised has no frozen or active chunk.
      serialize: () => (this.runtime === null ? { frozen: [], active: [] } : this.runtime.zone.save.serialize()),
      deserialize: (data: unknown) => {
        if (this.runtime === null) {
          const parsed = worldChunksSnapshotSchema.safeParse(data);
          if (parsed.success && parsed.data.frozen.length === 0 && parsed.data.active.length === 0) return;
        }
        this.materialize().zone.save.deserialize(data);
      },
    };
  }

  /** Save participant `weather-regions` (builds the plan stage: the regions come from the plan). */
  weatherParticipant(): SaveParticipant {
    return {
      id: WEATHER_PARTICIPANT_ID,
      version: WEATHER_SAVE_VERSION,
      serialize: () => this.plans().weather.save.serialize(),
      deserialize: (data: unknown) => this.plans().weather.save.deserialize(data),
    };
  }

  /** Time-dependent systems added after sealing would escape the catch-up coverage. */
  private checkLateSystems(): void {
    const systems = this.sim.systems;
    if (systems.length === this.sealedSystems) return;
    for (let i = this.sealedSystems; i < systems.length; i++) {
      const s = systems[i] as SimSystem;
      if (isTimeDependent(s) && s.timeScope !== TIME_SCOPE_GLOBAL) {
        throw new Error(`System "${s.id}" was added after createSimulation sealed the catch-up registry; chunk-bound and undeclared time-dependent systems are registered in createSimulation`);
      }
    }
    this.sealedSystems = systems.length;
  }

  private plans(): PlanStage {
    if (this.planStage !== null) return this.planStage;
    const config = this.sim.config;
    const world = this.provided ?? this.runtime?.generated ?? cachedWorld(config.seed, config.worldSize);
    // Regions are fixed in step 1; the generated world only adds ramps and fords to its plan.
    const plan = world?.plan ?? planFor(config.seed, config.worldSize);
    const weather = new WeatherSystem(
      this.calendar,
      config.seed,
      plan.regions.map((r) => r.biome),
    );
    // Weather region of a tile = plan region of its cell (−1 at sea = no weather region).
    const regionAt = (tx: number, ty: number): number => plan.region[cellAtTile(plan.grid, tx + 0.5, ty + 0.5)] as number;
    // Lava heat reads resident chunks once the world stage exists; before, no chunk is resident.
    const chunks: ChunkSource = { get: (layer, cx, cy) => this.runtime?.chunks.get(layer, cx, cy) };
    const temperature = new TemperatureField({ calendar: this.calendar, weather, chunks, regionAt });
    this.planStage = { weather, temperature, regionAt };
    return this.planStage;
  }

  private materialize(): WorldStage {
    if (this.runtime !== null) return this.runtime;
    const registry = this.catchUp;
    const config = this.sim.config;
    const generated = this.provided ?? worldFor(config.seed, config.worldSize);
    const chunks = new ChunkManager({
      plan: generated,
      generate: generateChunk,
      jobs: this.options.chunkJobs?.(generated) ?? inThreadChunkJobs(),
      world: worldDimensions(generated.preset),
      config: this.options.stream,
    });
    const zone = new ActiveZone({ chunks, catchUp: registry, tick: () => this.sim.clock.tick, config: this.options.stream });
    this.runtime = { generated, chunks, zone };
    return this.runtime;
  }
}

/**
 * First system of every tick: moves the active zone (global; it decides which chunks tick). Owns the
 * debug time jumps (`setTime`, `advanceTime`, `setSeason`), which freeze and re-activate the zone.
 */
export class WorldChunksSystem implements SimSystem {
  readonly id = WORLD_CHUNKS_PARTICIPANT_ID;
  readonly timeScope = TIME_SCOPE_GLOBAL;
  readonly save: SaveParticipant;
  readonly commands: CommandHandlers;

  constructor(private readonly world: SimWorld) {
    this.save = world.zoneParticipant();
    this.commands = {
      setTime: (_sim, cmd) => world.jump(world.ticksUntilTimeOfDay(cmd.hour, cmd.minute)),
      advanceTime: (sim, cmd) => world.jump(cmd.minutes * sim.clock.ticksPerGameMinute),
      setSeason: (_sim, cmd) => world.jump(world.ticksUntilSeason(cmd.season)),
    };
  }

  update(): void {
    this.world.stepZone();
  }

  stateDigest(): string {
    return this.world.contentDigest();
  }
}

/** The weather automaton of the surface regions (global, world tick); owns the debug command `setWeather`. */
export class WeatherRegionsSystem implements SimSystem {
  readonly id = WEATHER_PARTICIPANT_ID;
  readonly timeScope = TIME_SCOPE_GLOBAL;
  readonly save: SaveParticipant;
  readonly commands: CommandHandlers;

  constructor(private readonly world: SimWorld) {
    this.save = world.weatherParticipant();
    this.commands = { setWeather: (sim, cmd, tick) => this.force(sim, cmd, tick) };
  }

  /** Forces the weather of the region of (tx, ty), or of every region; a tile at sea has no region. */
  private force(sim: Simulation, cmd: CommandOfType<'setWeather'>, tick: number): void {
    const tiles = worldDimensions(sim.config.worldSize).tiles;
    if (cmd.tx === undefined || cmd.ty === undefined) {
      // −1: every region (`WeatherSystem.force`).
      this.world.weather.force(-1, cmd.state);
      return;
    }
    if (cmd.tx < 0 || cmd.ty < 0 || cmd.tx >= tiles || cmd.ty >= tiles) {
      sim.events.push('commandRejected', { type: cmd.type, reason: 'outOfBounds', tick });
      return;
    }
    const region = this.world.regionAt(cmd.tx, cmd.ty);
    if (region === NO_WEATHER_REGION) {
      sim.events.push('commandRejected', { type: cmd.type, reason: 'noWeatherRegion', tick });
      return;
    }
    this.world.weather.force(region, cmd.state);
  }

  worldTick(): void {
    this.world.weather.worldTick();
  }
}

/** The temperature field (global, samples its time terms on the world tick; no state of its own). */
export class TemperatureSystem implements SimSystem {
  readonly id = TEMPERATURE_SYSTEM_ID;
  readonly timeScope = TIME_SCOPE_GLOBAL;

  constructor(private readonly world: SimWorld) {}

  worldTick(): void {
    this.world.temperature.worldTick();
  }
}
