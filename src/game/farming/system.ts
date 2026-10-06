/**
 * Farming (docs/SPIEL.md §20, MASTERPROMPT §17; M7-19 … M7-23; system `farming`, place 33 of `SYSTEM_ORDER`).
 *
 * - **Plots** (`FarmStore`, src/game/farming/store.ts): the hoe makes a field (the gathering hook `onTilled`), a garden bed is
 *   a field without a hoe (build parts `beet_holz`, `beet_stein`, heard through the building's part listener); filling in,
 *   building over or taking the bed down drops the plot. Each plot keeps moisture and fertility (0–100, start
 *   `BALANCE.farming.startFertility`), its plant, stage, days in the stage, quality points, pest, harvests, the day of the last
 *   watering and the flags of its surroundings.
 * - **Actions** (src/game/farming/uses.ts: item uses of `player.useItem` and E targets): sowing a seed (`saat`), watering with
 *   the can (`ladungen`; filled at fresh water), fertilising (`duenger`; herb brew cures mildew), harvesting a ripe crop and
 *   clearing a dead one (`farm.harvest`), planting a sapling (`pflanzt`, a world object growing in its object state: the
 *   gathering system). A harvest gives the crop (quality 1–3 from the mean fertility it grew in and the Landwirtschaft level),
 *   its seeds, costs the plot `harvestFertilityLoss`; a crop that carries again falls back to its regrowth stage.
 * - **Days** at 06:00 (`plotDay`, src/game/farming/formulas.ts): moisture, frost, pests and growth from the climate log
 *   (src/game/farming/climateLog.ts) – in active chunks at the dawn (`dailyTick`), in frozen chunks for every dawn they missed
 *   when they wake (`catchUp`): the same function, the same hash draws, so a frozen field grows exactly like a watched one.
 *   Catching up is silent.
 * - **Surroundings** (greenhouse room, fence ring, water within `waterNearTiles`, a scarecrow within `scarecrowTiles`) are
 *   read only where rooms and buildings exist, in the active zone: the world tick refreshes the flags of the plots of active
 *   chunks after any change of the buildings or the tiles, a freezing chunk keeps them (buildings do not change while frozen).
 * - **Climate log**: listens to the weather from the first world tick on (`addPeriodListener`); tracks the regions that hold
 *   plots; drops the days no plot needs any more.
 * - Save participant `farming` (version 1): the plots per chunk, the climate log and whether it listens.
 */
import { z } from 'zod';
import { BALANCE } from '../../content/balance';
import { CROPS } from '../../content/farming/index';
import { ripeStage, type CropDef } from '../../content/farming/schema';
import type { ItemDef } from '../../content/schema/item';
import type { Calendar } from '../../world/calendar';
import type { WeatherSystem } from '../../world/climate/weather';
import { WATER_DEPTH_MASK, WATER_FROZEN, WATER_SEA, type ChunkData } from '../../world/model/chunk';
import { CHUNK_AREA, CHUNK_MASK, CHUNK_SHIFT, TILE_PX, packChunkId, type Layer } from '../../world/model/coords';
import { contentWorldIdTables } from '../../world/model/runtimeIds';
import type { CommandOfType } from '../commands';
import type { InventorySystem } from '../inventory/system';
import type { ItemCatalog } from '../items/catalog';
import { withSlot } from '../inventory/bags';
import { newStack, withCount, type ItemStack } from '../items/stack';
import type { SaveParticipant } from '../participant';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import { FarmClimateLog, climateLogSnapshotSchema, farmDayStart, type SeasonSource } from './climateLog';
import type { CropDeathCause, FarmRejectReason, PlotRemoveReason } from './events';
import { FARM_SALT, countIn, createPlotDayResult, farmRoll, firstDawnAfter, growthBase, harvestQuality, plotDay, plotGrow, type PlotDay, type PlotDayResult } from './formulas';
import { FarmChunk, FarmStore, PLOT, SURROUNDINGS, farmStoreSnapshotSchema } from './store';
import type { ClimateLog, FarmApi, FarmPlot } from './types';

/** Id of the farming system and its save participant. */
export const FARMING_SYSTEM_ID = 'farming';
/** Data version of the `farming` participant. */
export const FARMING_SAVE_VERSION = 1;

const F = BALANCE.farming;
/** Biome a tile without one counts as (drawn test worlds): the reference biome of every tint (docs/ART.md §5). */
const FALLBACK_BIOME = 'gruenhain';
/** The skill whose level sets the quality of harvests (§23.2 "Landwirtschaft & Tierzucht"). */
export const FARMING_SKILL = 'landwirtschaft';
/** Crop ids in content order: the farm store keeps index + 1. */
const CROP_IDS: readonly string[] = CROPS.map((c) => c.id);
const CROP_INDEX: ReadonlyMap<string, number> = new Map(CROP_IDS.map((id, i) => [id, i + 1]));

/** Where the plots live: the resident chunks, the active zone, the weather regions and the automaton. */
export interface FarmWorld {
  /** The resident chunk at (layer, cx, cy), or undefined. */
  chunk(layer: Layer, cx: number, cy: number): ChunkData | undefined;
  /** Chunks of the active zone (stable order). */
  activeChunks(): readonly ChunkData[];
  /** Weather region of a surface tile (−1: none). */
  regionAt(tx: number, ty: number): number;
  /** The weather automaton the climate log listens to, or null (tests feed the log). */
  weather(): WeatherSystem | null;
}

/** What surrounds a plot (read in the active zone only). */
export interface FarmSurroundings {
  /** The plot stands in a room of type `gewaechshaus`. */
  greenhouseAt(sim: Simulation, layer: Layer, tx: number, ty: number): boolean;
  /** The plot lies inside a ring of fences, walls and gates (no roof needed). */
  enclosedAt(sim: Simulation, layer: Layer, tx: number, ty: number): boolean;
  /** A scarecrow stands within `radius` tiles. */
  scarecrowNear(layer: Layer, tx: number, ty: number, radius: number): boolean;
}

/** The player's skill as far as farming reads and raises it (bound after the life systems). */
export interface FarmSkills {
  level(id: string): number;
  award(sim: Simulation, sourceId: string): unknown;
}

/** Puts a stack into the world at (x, y) on `layer` (the drop system). */
export type FarmSpill = (sim: Simulation, stack: ItemStack, layer: Layer, x: number, y: number) => void;

/** Dependencies of the farming system. */
export interface FarmingDeps {
  readonly world: FarmWorld;
  readonly calendar: Pick<Calendar, 'seasonOfDay' | 'clock'>;
  readonly inventory: InventorySystem;
  readonly catalog: ItemCatalog;
  readonly spill: FarmSpill;
  readonly surroundings?: FarmSurroundings;
}

const snapshotSchema = z
  .object({
    plots: farmStoreSnapshotSchema,
    climate: climateLogSnapshotSchema,
    listening: z.boolean(),
  })
  .strict();

/** A fresh farm plot record (for `plotAt`). */
export function createFarmPlot(): FarmPlot {
  return { layer: 0, tx: 0, ty: 0, moisture: 0, fertility: 0, crop: '', stage: 0, daysInStage: 0, qualityPoints: 0, pest: 'keine', lastWateredDay: 0, harvests: 0, sheltered: false, dead: false };
}

/** Index of tile (tx, ty) in its chunk. */
function localIndex(tx: number, ty: number): number {
  return ((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK);
}

/** The crop of farm-store index `index` (index + 1), or null. */
function cropOf(index: number): CropDef | null {
  return index === 0 ? null : (CROPS[index - 1] ?? null);
}

export class FarmingSystem implements SimSystem, FarmApi {
  readonly id = FARMING_SYSTEM_ID;
  readonly save: SaveParticipant;
  readonly commands: CommandHandlers;
  readonly store = new FarmStore();
  readonly log: FarmClimateLog;
  private readonly world: FarmWorld;
  private readonly calendar: Pick<Calendar, 'seasonOfDay' | 'clock'>;
  private readonly inventory: InventorySystem;
  private readonly catalog: ItemCatalog;
  private readonly spill: FarmSpill;
  private surroundings: FarmSurroundings | null;
  private skills: FarmSkills | null = null;
  /** The climate log listens to the weather (from the first world tick on, saved). */
  private listening = false;
  /** The surroundings of the active plots must be read again (buildings or tiles changed, plots came). */
  private surroundingsDirty = true;
  private readonly seed: number;
  private readonly biomes = contentWorldIdTables().biomes;
  private readonly dayResult: PlotDayResult = createPlotDayResult();
  private readonly day: { -readonly [K in keyof PlotDay]: PlotDay[K] } = { seed: 0, day: 0, season: 'fruehling', rain: false, minC: 0, maxC: 0, rainStreak: 0 };

  constructor(sim: Simulation, deps: FarmingDeps) {
    this.world = deps.world;
    this.calendar = deps.calendar;
    this.inventory = deps.inventory;
    this.catalog = deps.catalog;
    this.spill = deps.spill;
    this.surroundings = deps.surroundings ?? null;
    this.seed = sim.config.seed;
    const seasons: SeasonSource = { seasonOfDay: (d) => deps.calendar.seasonOfDay(d) };
    this.log = new FarmClimateLog(seasons);
    this.commands = {
      'farm.plant': (s, cmd) => {
        const reason = this.plantCommand(s, cmd);
        if (reason !== null) s.events.push('commandRejected', { type: cmd.type, reason, tick: s.eventTick });
      },
      'farm.harvest': (s, cmd, tick) => {
        const reason = this.harvestCommand(s, cmd, tick);
        if (reason !== null) s.events.push('commandRejected', { type: cmd.type, reason, tick });
      },
      'farm.grow': (s, cmd) => this.grow(s, cmd.tage),
    };
    this.save = {
      id: FARMING_SYSTEM_ID,
      version: FARMING_SAVE_VERSION,
      // Saves before M7 (versions 1–3) have no fields: they start empty, listening from the first world tick (§27).
      migrations: [{ from: 0, migrate: () => ({ plots: [], climate: { regions: [] }, listening: false }) }],
      serialize: () => ({ plots: this.store.serialize(CROP_IDS), climate: this.log.serialize(), listening: this.listening }),
      deserialize: (data: unknown) => {
        const parsed = snapshotSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`farming snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
        this.store.restore(parsed.data.plots, (id) => {
          const index = CROP_INDEX.get(id);
          if (index === undefined) throw new TypeError(`farming snapshot invalid: unknown crop "${id}"`);
          return index;
        }, (index) => ripeStage(cropOf(index) as CropDef));
        this.log.restore(parsed.data.climate);
        this.listening = parsed.data.listening;
        if (this.listening) this.attachWeather();
        this.surroundingsDirty = true;
      },
    };
  }

  /** The climate log (FarmApi; strand E reads it for the rain collectors). */
  get climate(): ClimateLog {
    return this.log;
  }

  /** Binds the surroundings (rooms, fences, scarecrows) once they exist. */
  useSurroundings(surroundings: FarmSurroundings): void {
    this.surroundings = surroundings;
    this.surroundingsDirty = true;
  }

  /** Binds the skills (quality from the Landwirtschaft level, experience of sowing and harvesting). */
  useSkills(skills: FarmSkills): void {
    this.skills = skills;
  }

  /** The buildings or tiles changed: the active plots read their surroundings again at the next world tick. */
  surroundingsChanged(): void {
    this.surroundingsDirty = true;
  }

  // -------------------------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------------------------

  /** Fills `out` with the plot at tile (tx, ty) of `layer`; false when there is none. */
  plotAt(layer: Layer, tx: number, ty: number, out: FarmPlot): boolean {
    const c = this.store.at(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT, false);
    if (c === undefined) return false;
    const i = localIndex(tx, ty);
    if (!c.has(i)) return false;
    this.store.read(c, i, tx, ty, CROP_IDS, out);
    return true;
  }

  /**
   * Calls `visit` with every plot, chunk by chunk in ascending packed id and tile by tile (the reference save's facts, tests;
   * not a frame path: `out` is one held record, refilled for each plot).
   */
  forEachPlot(out: FarmPlot, visit: (plot: Readonly<FarmPlot>) => void): void {
    for (const id of this.store.ids()) {
      const c = this.store.get(id);
      if (c === undefined) continue;
      const x0 = c.cx << CHUNK_SHIFT;
      const y0 = c.cy << CHUNK_SHIFT;
      for (let i = 0; i < CHUNK_AREA; i++) {
        if (!c.has(i)) continue;
        this.store.read(c, i, x0 + (i & CHUNK_MASK), y0 + (i >> CHUNK_SHIFT), CROP_IDS, out);
        visit(out);
      }
    }
  }

  /** The farm chunk at (layer, cx, cy) for the renderer, or undefined (read it, do not change it). */
  chunkAt(layer: Layer, cx: number, cy: number): FarmChunk | undefined {
    return this.store.at(layer, cx, cy, false);
  }

  /** Whether tile (tx, ty) of `layer` is a plot. */
  isPlot(layer: Layer, tx: number, ty: number): boolean {
    return this.store.at(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT, false)?.has(localIndex(tx, ty)) ?? false;
  }

  /** The crop of a farm-store crop index (index + 1; renderer), or null. */
  cropAt(index: number): CropDef | null {
    return cropOf(index);
  }

  // -------------------------------------------------------------------------------------------
  // Plots coming and going
  // -------------------------------------------------------------------------------------------

  /**
   * The hoe tilled tile (tx, ty) (`tilled`), or it was filled in or dug deeper (`!tilled`) – the gathering hook `onTilled`.
   * Hoeing now and then turns up an earthworm (§20 "regenwurm aus graben:erde"), dropped on the tile.
   */
  tilled(sim: Simulation, layer: Layer, tx: number, ty: number, tilled: boolean): void {
    if (!tilled) {
      this.removePlot(sim, layer, tx, ty, 'zugeschuettet');
      return;
    }
    this.createPlot(sim, layer, tx, ty, false);
    if (farmRoll(this.seed, layer, tx, ty, sim.eventTick, FARM_SALT.worm) < F.wormChance) {
      sim.events.push('wormFound', { layer, tx, ty, tick: sim.eventTick });
      this.spill(sim, newStack(this.catalog.get(WORM_ITEM), 1), layer, tx * TILE_PX + TILE_PX / 2, ty * TILE_PX + TILE_PX / 2);
    }
  }

  /**
   * A part was placed: a garden bed (furniture category `beet`, 1 × 1: `beet_holz`, `beet_stein`) becomes a plot on its
   * anchor tile, anything else on the ground of a plot builds it over.
   */
  partPlaced(sim: Simulation, bed: boolean, layer: Layer, tx: number, ty: number, w: number, h: number): void {
    if (bed) {
      this.createPlot(sim, layer, tx, ty, true);
      return;
    }
    const reach = Math.max(w, h);
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) this.coveredBy(sim, layer, tx + dx, ty + dy);
  }

  /** A part was taken down: a garden bed's plot goes with it. */
  partRemoved(sim: Simulation, bed: boolean, layer: Layer, tx: number, ty: number): void {
    if (bed) this.removePlot(sim, layer, tx, ty, 'abgebaut');
  }

  /** The plot of tile (tx, ty) is built over when a part other than its own bed now stands on its ground (the building's `occupied` asks). */
  private coveredBy(sim: Simulation, layer: Layer, tx: number, ty: number): void {
    const c = this.store.at(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT, false);
    if (c === undefined) return;
    const i = localIndex(tx, ty);
    if (!c.has(i) || c.flag(i, PLOT.beet)) return;
    if (this.groundTaken !== null && this.groundTaken(layer, tx, ty)) this.removePlot(sim, layer, tx, ty, 'ueberbaut');
  }

  /** Whether something built stands on the ground of tile (tx, ty) (the building system; bound in `useGround`). */
  private groundTaken: ((layer: Layer, tx: number, ty: number) => boolean) | null = null;

  /** Binds what tells a plot's ground is built over (a floor, wall or piece of furniture that is not a garden bed). */
  useGround(taken: (layer: Layer, tx: number, ty: number) => boolean): void {
    this.groundTaken = taken;
  }

  private createPlot(sim: Simulation, layer: Layer, tx: number, ty: number, beet: boolean): void {
    const c = this.store.at(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT, true) as FarmChunk;
    if (c.count === 0) c.processedTick = sim.tick;
    const i = localIndex(tx, ty);
    c.create(i, F.startFertility, F.startMoisture, beet, sim.clock.day);
    if (layer === 0) this.log.track(this.world.regionAt(tx, ty));
    this.surroundingsDirty = true;
    sim.events.push('plotCreated', { layer, tx, ty, beet, tick: sim.eventTick });
  }

  private removePlot(sim: Simulation, layer: Layer, tx: number, ty: number, reason: PlotRemoveReason): void {
    const c = this.store.at(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT, false);
    if (c === undefined) return;
    const i = localIndex(tx, ty);
    if (!c.has(i)) return;
    c.remove(i);
    this.store.dropIfEmpty(packChunkId(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT));
    sim.events.push('plotRemoved', { layer, tx, ty, reason, tick: sim.eventTick });
  }

  // -------------------------------------------------------------------------------------------
  // Actions (src/game/farming/uses.ts)
  // -------------------------------------------------------------------------------------------

  /** Why seed `def` cannot be sown on tile (tx, ty) now, or null. */
  sowProblem(layer: Layer, tx: number, ty: number, def: ItemDef): FarmRejectReason | null {
    const c = this.store.at(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT, false);
    const i = localIndex(tx, ty);
    if (c === undefined || !c.has(i)) return 'noPlot';
    if ((c.crop[i] as number) !== 0) return 'plotOccupied';
    if (def.saat === undefined || !CROP_INDEX.has(def.saat.pflanze)) return 'cannotPlant';
    return null;
  }

  /** Sows seed `def` on the plot of tile (tx, ty); the caller took the piece. */
  sow(sim: Simulation, layer: Layer, tx: number, ty: number, def: ItemDef): void {
    const c = this.store.at(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT, false) as FarmChunk;
    const i = localIndex(tx, ty);
    const crop = (def.saat as { pflanze: string }).pflanze;
    c.clearCrop(i);
    c.crop[i] = CROP_INDEX.get(crop) as number;
    sim.events.push('cropPlanted', { layer, tx, ty, crop, tick: sim.eventTick });
    this.skills?.award(sim, F.experience.planted);
  }

  /** `farm.plant`: sow the seed in the hand on the plot of (tx, ty) within reach; one piece is used up. */
  private plantCommand(sim: Simulation, cmd: CommandOfType<'farm.plant'>): FarmRejectReason | 'noPlayer' | 'outOfReach' | 'notUsable' | null {
    const layer = this.reach === null ? null : this.reach(sim, cmd.tx, cmd.ty);
    if (layer === null) return this.reach === null ? 'noPlayer' : 'outOfReach';
    const stack = this.inventory.selected();
    if (stack === null) return 'notUsable';
    const def = this.catalog.get(stack.item);
    if (def.saat === undefined) return 'notUsable';
    const problem = this.sowProblem(layer, cmd.tx, cmd.ty, def);
    if (problem !== null) return problem;
    const state = this.inventory.state;
    this.inventory.bags.replace(withSlot(state, { bereich: 'schnellleiste', index: state.auswahl }, stack.count > 1 ? withCount(stack, stack.count - 1) : null));
    sim.events.push('inventoryChanged', { change: 'remove', tick: sim.eventTick });
    this.sow(sim, layer, cmd.tx, cmd.ty, def);
    return null;
  }

  /** Why the can of `stack` cannot water the plot of tile (tx, ty) now, or null. */
  waterProblem(layer: Layer, tx: number, ty: number, stack: ItemStack): FarmRejectReason | null {
    const c = this.store.at(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT, false);
    const i = localIndex(tx, ty);
    if (c === undefined || !c.has(i)) return 'noPlot';
    if (canCharges(stack) <= 0) return 'canEmpty';
    if ((c.moisture[i] as number) >= F.wetMoisture) return 'soilWet';
    return null;
  }

  /** Waters the plot of tile (tx, ty) to `wetMoisture`; returns the can with one charge less. */
  water(sim: Simulation, layer: Layer, tx: number, ty: number, stack: ItemStack): ItemStack {
    const c = this.store.at(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT, false) as FarmChunk;
    const i = localIndex(tx, ty);
    c.moisture[i] = F.wetMoisture;
    c.lastWateredDay[i] = sim.clock.day;
    sim.events.push('plotWatered', { layer, tx, ty, item: stack.item, tick: sim.eventTick });
    return withCharges(stack, canCharges(stack) - 1);
  }

  /** Why fertiliser `def` cannot go on the plot of tile (tx, ty) now, or null (herb brew needs mildew or soil to feed). */
  fertilizeProblem(layer: Layer, tx: number, ty: number, def: ItemDef): FarmRejectReason | null {
    const c = this.store.at(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT, false);
    const i = localIndex(tx, ty);
    if (c === undefined || !c.has(i)) return 'noPlot';
    const d = def.duenger;
    if (d === undefined) return 'cannotPlant';
    if (d.heilt === 'mehltau' && c.pestOf(i) !== 'mehltau' && (c.fertility[i] as number) >= 100) return 'noMildew';
    return null;
  }

  /** Spreads fertiliser `def` on the plot of tile (tx, ty) (the caller took the piece). */
  fertilize(sim: Simulation, layer: Layer, tx: number, ty: number, def: ItemDef): void {
    const c = this.store.at(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT, false) as FarmChunk;
    const i = localIndex(tx, ty);
    const d = def.duenger as NonNullable<ItemDef['duenger']>;
    c.fertility[i] = Math.min(100, (c.fertility[i] as number) + d.fruchtbarkeit);
    sim.events.push('plotFertilized', { layer, tx, ty, item: def.id, tick: sim.eventTick });
    if (d.heilt === 'mehltau' && c.pestOf(i) === 'mehltau') {
      c.pest[i] = 0;
      c.pestDays[i] = 0;
      sim.events.push('pestCured', { layer, tx, ty, art: 'mehltau', tick: sim.eventTick });
    }
  }

  /** What E on the plot of tile (tx, ty) would do: harvest (ripe), clear (dead), or why not (null: no plot, nothing on it). */
  harvestState(layer: Layer, tx: number, ty: number): 'ernten' | 'raeumen' | 'unreif' | null {
    const c = this.store.at(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT, false);
    const i = localIndex(tx, ty);
    if (c === undefined || !c.has(i)) return null;
    const crop = cropOf(c.crop[i] as number);
    if (crop === null) return null;
    if (c.flag(i, PLOT.dead)) return 'raeumen';
    return (c.stage[i] as number) >= ripeStage(crop) ? 'ernten' : 'unreif';
  }

  /** `farm.harvest`: harvest the ripe crop or clear the dead plant on the plot of (tx, ty) within reach. */
  private harvestCommand(sim: Simulation, cmd: CommandOfType<'farm.harvest'>, tick: number): FarmRejectReason | 'noPlayer' | 'outOfReach' | null {
    const layer = this.reach === null ? null : this.reach(sim, cmd.tx, cmd.ty);
    if (layer === null) return this.reach === null ? 'noPlayer' : 'outOfReach';
    const state = this.harvestState(layer, cmd.tx, cmd.ty);
    if (state === null) return 'noPlot';
    if (state === 'unreif') return 'notRipe';
    if (state === 'raeumen') this.clearDead(sim, layer, cmd.tx, cmd.ty, tick);
    else this.harvest(sim, layer, cmd.tx, cmd.ty, tick);
    return null;
  }

  /** Where the player may act from (layer of the player when tile (tx, ty) is within reach, else null; bound in `useReach`). */
  private reach: ((sim: Simulation, tx: number, ty: number) => Layer | null) | null = null;

  /** Binds the player's reach (the uses check it before they act). */
  useReach(reach: (sim: Simulation, tx: number, ty: number) => Layer | null): void {
    this.reach = reach;
  }

  /** Harvests the ripe crop on tile (tx, ty) into the bags (the rest at the plot). */
  harvest(sim: Simulation, layer: Layer, tx: number, ty: number, tick: number): void {
    const c = this.store.at(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT, false) as FarmChunk;
    const i = localIndex(tx, ty);
    const crop = cropOf(c.crop[i] as number) as CropDef;
    const day = sim.clock.day;
    const harvests = c.harvests[i] as number;
    const steps = (c.stage[i] as number) - growthBase(crop, harvests);
    const mean = steps > 0 ? (c.qualityPoints[i] as number) / steps : (c.fertility[i] as number);
    const level = this.skills?.level(FARMING_SKILL) ?? 1;
    // One harvest per plot and day at most (regrowth takes days): day and harvest count make the draws unique.
    const quality = harvestQuality(mean, level, farmRoll(this.seed, layer, tx, ty, day, FARM_SALT.quality + harvests));
    let count = countIn(crop.ertrag, farmRoll(this.seed, layer, tx, ty, day, FARM_SALT.yield + harvests));
    if (c.flag(i, PLOT.pecked)) count = Math.ceil(count / 2);
    const seeds = countIn(crop.saatErtrag, farmRoll(this.seed, layer, tx, ty, day, FARM_SALT.seeds + harvests));
    const x = tx * TILE_PX + TILE_PX / 2;
    const y = ty * TILE_PX + TILE_PX / 2;
    if (count > 0) this.give(sim, newStack(this.catalog.get(crop.id), count, { qualitaet: quality }), layer, x, y);
    if (seeds > 0) this.give(sim, newStack(this.catalog.get(crop.saat), seeds), layer, x, y);
    c.fertility[i] = Math.max(0, (c.fertility[i] as number) - F.harvestFertilityLoss);
    const done = harvests + 1;
    const again = crop.nachwuchs !== undefined && done < crop.nachwuchs.ernten;
    if (again) {
      c.stage[i] = (crop.nachwuchs as { stufe: number }).stufe;
      c.daysInStage[i] = 0;
      c.qualityPoints[i] = 0;
      c.harvests[i] = done;
      c.pest[i] = 0;
      c.setFlag(i, PLOT.pecked, false);
    } else c.clearCrop(i);
    sim.events.push('cropHarvested', { layer, tx, ty, crop: crop.id, qualitaet: quality, anzahl: count, tick });
    this.skills?.award(sim, F.experience.harvested);
  }

  /** Clears the dead plant from tile (tx, ty). */
  clearDead(sim: Simulation, layer: Layer, tx: number, ty: number, tick: number): void {
    const c = this.store.at(layer, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT, false) as FarmChunk;
    const i = localIndex(tx, ty);
    const crop = cropOf(c.crop[i] as number);
    c.clearCrop(i);
    if (crop !== null) sim.events.push('cropCleared', { layer, tx, ty, crop: crop.id, tick });
  }

  private give(sim: Simulation, stack: ItemStack, layer: Layer, x: number, y: number): void {
    const { rest } = this.inventory.giveStack(sim, stack);
    if (rest > 0) this.spill(sim, { ...stack, count: rest }, layer, x, y);
  }

  /** `farm.grow` (debug): every plot of the active zone grows `days` good days. */
  private grow(sim: Simulation, days: number): void {
    const chunks = this.world.activeChunks();
    for (let k = 0; k < chunks.length; k++) {
      const chunk = chunks[k] as ChunkData;
      const c = this.store.get(chunk.id);
      if (c === undefined) continue;
      for (let i = 0; i < CHUNK_AREA; i++) {
        if (!c.has(i)) continue;
        const crop = cropOf(c.crop[i] as number);
        if (crop === null || !plotGrow(c, i, crop, days)) continue;
        const tx = (chunk.cx << CHUNK_SHIFT) + (i & CHUNK_MASK);
        const ty = (chunk.cy << CHUNK_SHIFT) + (i >> CHUNK_SHIFT);
        if ((c.stage[i] as number) >= ripeStage(crop)) sim.events.push('cropRipe', { layer: chunk.layer, tx, ty, crop: crop.id, tick: sim.eventTick });
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Ticks
  // -------------------------------------------------------------------------------------------

  /** The first world tick starts the climate log; changed surroundings are read again for the active plots. */
  worldTick(sim: Simulation): void {
    if (!this.listening) {
      this.listening = true;
      this.attachWeather();
    }
    if (this.surroundingsDirty) this.refreshSurroundings(sim);
  }

  /** The dawn of day `day`: the plots of the active chunks live the day that ended (farm day `day − 1`). */
  dailyTick(sim: Simulation, day: number): void {
    if (this.store.size === 0) return;
    this.log.ensureUntil(sim, farmDayStart(day));
    const chunks = this.world.activeChunks();
    for (let k = 0; k < chunks.length; k++) {
      const chunk = chunks[k] as ChunkData;
      const c = this.store.get(chunk.id);
      if (c === undefined) continue;
      this.liveDay(sim, chunk, c, day - 1);
      c.processedTick = sim.clock.tick;
    }
    this.prune();
  }

  /** A frozen chunk catches up: its plots live every farm day whose dawn passed in (fromTick, toTick], in order. */
  catchUp(chunk: ChunkData, fromTick: number, toTick: number): void {
    const c = this.store.get(chunk.id);
    if (c === undefined) return;
    const perDay = this.calendar.clock.ticksPerDay;
    const first = firstDawnAfter(fromTick, perDay);
    const last = Math.floor(toTick / perDay);
    if (last >= first) {
      this.log.advance(farmDayStart(last + 1));
      for (let dawn = first; dawn <= last; dawn++) this.liveDay(null, chunk, c, dawn);
    }
    c.processedTick = toTick;
  }

  /** Every plot of `c` (resident `chunk`) lives farm day `day`; events only with `sim` (an active chunk). */
  private liveDay(sim: Simulation | null, chunk: ChunkData, c: FarmChunk, day: number): void {
    const d = this.day;
    d.seed = this.seed;
    d.day = day;
    d.season = this.calendar.seasonOfDay(day);
    const x0 = chunk.cx << CHUNK_SHIFT;
    const y0 = chunk.cy << CHUNK_SHIFT;
    const out = this.dayResult;
    for (let i = 0; i < CHUNK_AREA; i++) {
      if (!c.has(i)) continue;
      const tx = x0 + (i & CHUNK_MASK);
      const ty = y0 + (i >> CHUNK_SHIFT);
      this.dayOf(chunk, i, tx, ty, day, d);
      const crop = cropOf(c.crop[i] as number);
      plotDay(c, i, tx, ty, crop, d, out);
      if (sim !== null && crop !== null) this.tell(sim, chunk.layer, tx, ty, crop, out);
    }
  }

  /** The weather and warmth of farm day `day` on tile (tx, ty) into `d`. */
  private dayOf(chunk: ChunkData, i: number, tx: number, ty: number, day: number, d: { rain: boolean; minC: number; maxC: number; rainStreak: number }): void {
    const region = chunk.layer === 0 ? this.world.regionAt(tx, ty) : -1;
    const biomeId = chunk.biome[i] as number;
    const biome = biomeId === 0 ? FALLBACK_BIOME : this.biomes.stringId(biomeId);
    const level = chunk.layer === 0 ? (chunk.height[i] as number) : 0;
    const climate = region < 0 ? undefined : this.log.day(region, day);
    d.rain = climate?.rain ?? false;
    d.minC = this.log.minTemperatureC(region, biome, level, day);
    d.maxC = this.log.maxTemperatureC(region, biome, level, day);
    d.rainStreak = region < 0 ? 0 : this.log.rainStreak(region, day, F.pests.mildewRainDays);
  }

  private tell(sim: Simulation, layer: Layer, tx: number, ty: number, crop: CropDef, r: PlotDayResult): void {
    const tick = sim.eventTick;
    switch (r.outcome) {
      case 'reif':
        sim.events.push('cropRipe', { layer, tx, ty, crop: crop.id, tick });
        break;
      case 'gestorben':
      case 'gefressen':
        sim.events.push('cropDied', { layer, tx, ty, crop: crop.id, grund: r.cause as CropDeathCause, tick });
        break;
      case 'schaedling':
        if (r.pest !== null) sim.events.push('pestAppeared', { layer, tx, ty, art: r.pest, tick });
        break;
      default:
        break;
    }
  }

  /** Drops climate days no plot needs any more: before the oldest processed day, less the mildew streak and a spare day. */
  private prune(): void {
    const perDay = this.calendar.clock.ticksPerDay;
    let oldest = Number.POSITIVE_INFINITY;
    for (const c of this.store.values()) oldest = Math.min(oldest, Math.floor(c.processedTick / perDay));
    if (!Number.isFinite(oldest)) return;
    this.log.prune(farmDayStart(oldest - F.pests.mildewRainDays - F.climateSpareDays));
  }

  private attachWeather(): void {
    const w = this.world.weather();
    if (w !== null) this.log.listen(w);
  }

  /** Reads greenhouse, fence ring, water and scarecrow for every plot of the active chunks. */
  private refreshSurroundings(sim: Simulation): void {
    const s = this.surroundings;
    const chunks = this.world.activeChunks();
    for (let k = 0; k < chunks.length; k++) {
      const chunk = chunks[k] as ChunkData;
      const c = this.store.get(chunk.id);
      if (c === undefined) continue;
      const x0 = chunk.cx << CHUNK_SHIFT;
      const y0 = chunk.cy << CHUNK_SHIFT;
      for (let i = 0; i < CHUNK_AREA; i++) {
        if (!c.has(i)) continue;
        const tx = x0 + (i & CHUNK_MASK);
        const ty = y0 + (i >> CHUNK_SHIFT);
        let bits = 0;
        if (s !== null && s.greenhouseAt(sim, chunk.layer, tx, ty)) bits |= PLOT.sheltered;
        if (s !== null && s.enclosedAt(sim, chunk.layer, tx, ty)) bits |= PLOT.enclosed;
        if (s !== null && s.scarecrowNear(chunk.layer, tx, ty, F.pests.scarecrowTiles)) bits |= PLOT.scarecrow;
        if (this.freshWaterNear(chunk.layer, tx, ty)) bits |= PLOT.waterNear;
        c.flags[i] = ((c.flags[i] as number) & ~SURROUNDINGS) | bits;
      }
    }
    this.surroundingsDirty = false;
  }

  /** Whether open fresh water (river, lake, spring, a water ditch – not the sea, not ice) lies within `waterNearTiles`. */
  freshWaterNear(layer: Layer, tx: number, ty: number): boolean {
    const r = F.waterNearTiles;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx === 0 && dy === 0) continue;
        const x = tx + dx;
        const y = ty + dy;
        const chunk = this.world.chunk(layer, x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
        if (chunk === undefined) continue;
        const w = chunk.water[localIndex(x, y)] as number;
        if ((w & WATER_DEPTH_MASK) !== 0 && (w & (WATER_FROZEN | WATER_SEA)) === 0) return true;
      }
    }
    return false;
  }
}

/** The earthworm a hoed tile may turn up (src/content/items/fang.ts). */
export const WORM_ITEM = 'regenwurm';

/** Charges of water in a watering can stack (`daten.ladungen`, 0 without). */
export function canCharges(stack: ItemStack): number {
  const v = stack.daten?.['ladungen'];
  return typeof v === 'number' ? v : 0;
}

/** The can `stack` holding `charges` charges. */
export function withCharges(stack: ItemStack, charges: number): ItemStack {
  const daten = { ...(stack.daten ?? {}), ladungen: charges };
  return { ...stack, daten };
}
