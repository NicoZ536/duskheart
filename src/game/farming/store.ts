/**
 * The FarmStore (docs/SPIEL.md §20 "Daten je Kachel im FarmStore je Chunk-Adresse (gepackte Spalten, §28)"): the plots of one
 * chunk as typed columns over its 1 024 tiles – moisture, fertility, crop, stage, days in the stage, quality points, pest and
 * its days, harvests, the day of the last watering and a byte of flags (plot, garden bed, greenhouse, enclosure, water near,
 * scarecrow near, dead, pecked by crows). A chunk with plots costs ≈ 12 KiB, whether resident or not; chunks without plots
 * have no entry. Plain data: the farming system decides, this file only stores and serialises.
 */
import { z } from 'zod';
import { CHUNK_AREA, isLayer, packChunkId, unpackChunkId, type ChunkCoord, type Layer } from '../../world/model/coords';
import { PESTS, type FarmPlot, type Pest } from './types';

/** Flag bits of a plot. */
export const PLOT = {
  /** The tile is a plot (hoed field or garden bed). */
  present: 1,
  /** A garden bed (build part), not a hoed field. */
  beet: 2,
  /** In a greenhouse room (refreshed in active chunks, kept while frozen). */
  sheltered: 4,
  /** Inside a fence ring (no hares). */
  enclosed: 8,
  /** Open fresh water within reach (moisture stays up). */
  waterNear: 16,
  /** A scarecrow within reach (no crows). */
  scarecrow: 32,
  /** The plant on it is dead (wilted). */
  dead: 64,
  /** Crows pecked at the ripe crop: half the yield. */
  pecked: 128,
} as const;
/** The flags refreshed from the surroundings (rooms, fences, water, scarecrows). */
export const SURROUNDINGS = PLOT.sheltered | PLOT.enclosed | PLOT.waterNear | PLOT.scarecrow;

/** The plots of one chunk. */
export class FarmChunk {
  readonly flags = new Uint8Array(CHUNK_AREA);
  readonly moisture = new Uint8Array(CHUNK_AREA);
  readonly fertility = new Uint8Array(CHUNK_AREA);
  /** Crop index + 1 (0 = none). */
  readonly crop = new Uint8Array(CHUNK_AREA);
  readonly stage = new Uint8Array(CHUNK_AREA);
  readonly daysInStage = new Uint8Array(CHUNK_AREA);
  readonly qualityPoints = new Uint16Array(CHUNK_AREA);
  /** Index into `PESTS`. */
  readonly pest = new Uint8Array(CHUNK_AREA);
  /** Days the current pest (mildew) or death has lasted. */
  readonly pestDays = new Uint8Array(CHUNK_AREA);
  readonly harvests = new Uint8Array(CHUNK_AREA);
  readonly lastWateredDay = new Int32Array(CHUNK_AREA);
  /** Plots in this chunk. */
  count = 0;
  /** Tick up to which the chunk's days were processed (its last dawn, or the end of its catch-up). */
  processedTick = 0;

  constructor(
    readonly layer: Layer,
    readonly cx: number,
    readonly cy: number,
  ) {}

  has(i: number): boolean {
    return ((this.flags[i] as number) & PLOT.present) !== 0;
  }

  /** Creates the plot at tile index `i` (fresh: no crop). */
  create(i: number, fertility: number, moisture: number, beet: boolean, day: number): void {
    if (!this.has(i)) this.count++;
    this.flags[i] = PLOT.present | (beet ? PLOT.beet : 0);
    this.moisture[i] = moisture;
    this.fertility[i] = fertility;
    this.clearCrop(i);
    this.lastWateredDay[i] = day;
  }

  /** Empties the plot of its plant (it stays a plot). */
  clearCrop(i: number): void {
    this.crop[i] = 0;
    this.stage[i] = 0;
    this.daysInStage[i] = 0;
    this.qualityPoints[i] = 0;
    this.pest[i] = 0;
    this.pestDays[i] = 0;
    this.harvests[i] = 0;
    this.flags[i] = (this.flags[i] as number) & ~(PLOT.dead | PLOT.pecked);
  }

  /** Removes the plot at tile index `i`. */
  remove(i: number): void {
    if (!this.has(i)) return;
    this.flags[i] = 0;
    this.clearCrop(i);
    this.moisture[i] = 0;
    this.fertility[i] = 0;
    this.lastWateredDay[i] = 0;
    this.count--;
  }

  flag(i: number, bit: number): boolean {
    return ((this.flags[i] as number) & bit) !== 0;
  }

  setFlag(i: number, bit: number, on: boolean): void {
    this.flags[i] = on ? (this.flags[i] as number) | bit : (this.flags[i] as number) & ~bit;
  }

  pestOf(i: number): Pest {
    return PESTS[this.pest[i] as number] as Pest;
  }
}

/** Largest value of a byte column and of the 16-bit quality points column (the typed arrays of `FarmChunk`). */
const BYTE_MAX = 0xff;
const WORD_MAX = 0xffff;
/** Moisture and fertility run from 0 to 100 (docs/SPIEL.md §20). */
const PERCENT_MAX = 100;

/** One saved plot: `[tile index, flags, moisture, fertility, crop id or '', stage, days in stage, quality points, pest, pest days, harvests, last watered day]`. */
const plotSchema = z.tuple([
  z.number().int().min(0).max(CHUNK_AREA - 1),
  z.number().int().min(1).max(BYTE_MAX),
  z.number().int().min(0).max(PERCENT_MAX),
  z.number().int().min(0).max(PERCENT_MAX),
  z.string(),
  z.number().int().min(0).max(BYTE_MAX),
  z.number().int().min(0).max(BYTE_MAX),
  z.number().int().min(0).max(WORD_MAX),
  z.enum(PESTS),
  z.number().int().min(0).max(BYTE_MAX),
  z.number().int().min(0).max(BYTE_MAX),
  z.number().int(),
]);
export const farmStoreSnapshotSchema = z.array(
  z
    .object({
      layer: z.number().int().refine(isLayer, { message: 'unknown layer' }),
      cx: z.number().int().min(0),
      cy: z.number().int().min(0),
      processedTick: z.number().int().min(0),
      plots: z.array(plotSchema).min(1),
    })
    .strict(),
);
export type FarmStoreSnapshot = z.output<typeof farmStoreSnapshotSchema>;

/** The plots of every chunk, by packed chunk id. */
export class FarmStore {
  private readonly chunks = new Map<number, FarmChunk>();
  private readonly coord: ChunkCoord = { layer: 0, cx: 0, cy: 0 };

  get size(): number {
    return this.chunks.size;
  }

  /** The farm chunk of packed chunk id `id`, or undefined. */
  get(id: number): FarmChunk | undefined {
    return this.chunks.get(id);
  }

  /** The farm chunk at (layer, cx, cy), created when `create`. */
  at(layer: Layer, cx: number, cy: number, create: boolean): FarmChunk | undefined {
    const id = packChunkId(layer, cx, cy);
    let c = this.chunks.get(id);
    if (c === undefined && create) {
      c = new FarmChunk(layer, cx, cy);
      this.chunks.set(id, c);
    }
    return c;
  }

  /** Drops the farm chunk `id` when it holds no plot any more. */
  dropIfEmpty(id: number): void {
    const c = this.chunks.get(id);
    if (c !== undefined && c.count === 0) this.chunks.delete(id);
  }

  values(): IterableIterator<FarmChunk> {
    return this.chunks.values();
  }

  /** Packed ids in ascending order (stable processing order). */
  ids(): number[] {
    return [...this.chunks.keys()].sort((a, b) => a - b);
  }

  /** Fills `out` with the plot at tile `i` of `c`, crop id from `cropIds`. */
  read(c: FarmChunk, i: number, tx: number, ty: number, cropIds: readonly string[], out: FarmPlot): void {
    out.layer = c.layer;
    out.tx = tx;
    out.ty = ty;
    out.moisture = c.moisture[i] as number;
    out.fertility = c.fertility[i] as number;
    const crop = c.crop[i] as number;
    out.crop = crop === 0 ? '' : (cropIds[crop - 1] as string);
    out.stage = c.stage[i] as number;
    out.daysInStage = c.daysInStage[i] as number;
    out.qualityPoints = c.qualityPoints[i] as number;
    out.pest = c.pestOf(i);
    out.lastWateredDay = c.lastWateredDay[i] as number;
    out.harvests = c.harvests[i] as number;
    out.sheltered = c.flag(i, PLOT.sheltered);
    out.dead = c.flag(i, PLOT.dead);
  }

  serialize(cropIds: readonly string[]): FarmStoreSnapshot {
    const out: FarmStoreSnapshot = [];
    for (const id of this.ids()) {
      const c = this.chunks.get(id) as FarmChunk;
      if (c.count === 0) continue;
      const plots: FarmStoreSnapshot[number]['plots'] = [];
      for (let i = 0; i < CHUNK_AREA; i++) {
        if (!c.has(i)) continue;
        const crop = c.crop[i] as number;
        plots.push([
          i,
          c.flags[i] as number,
          c.moisture[i] as number,
          c.fertility[i] as number,
          crop === 0 ? '' : (cropIds[crop - 1] as string),
          c.stage[i] as number,
          c.daysInStage[i] as number,
          c.qualityPoints[i] as number,
          c.pestOf(i),
          c.pestDays[i] as number,
          c.harvests[i] as number,
          c.lastWateredDay[i] as number,
        ]);
      }
      out.push({ layer: c.layer, cx: c.cx, cy: c.cy, processedTick: c.processedTick, plots });
    }
    return out;
  }

  /**
   * Replaces every chunk; `cropIndex` maps a crop id to its index + 1 (throws on unknown crops), `ripeOf` gives the ripe stage
   * of a crop index (a stage beyond it, or a stage without a crop, is refused).
   */
  restore(data: FarmStoreSnapshot, cropIndex: (id: string) => number, ripeOf: (index: number) => number): void {
    this.chunks.clear();
    for (const ch of data) {
      unpackChunkId(packChunkId(ch.layer as Layer, ch.cx, ch.cy), this.coord);
      const c = new FarmChunk(ch.layer as Layer, ch.cx, ch.cy);
      c.processedTick = ch.processedTick;
      for (const [i, flags, moisture, fertility, crop, stage, days, qp, pest, pestDays, harvests, watered] of ch.plots) {
        if (c.has(i)) throw new TypeError(`farming snapshot invalid: two plots on tile ${i} of chunk ${ch.layer}:${ch.cx}:${ch.cy}`);
        if ((flags & PLOT.present) === 0) throw new TypeError(`farming snapshot invalid: plot ${i} without its present flag`);
        const index = crop === '' ? 0 : cropIndex(crop);
        if (stage > (index === 0 ? 0 : ripeOf(index))) throw new TypeError(`farming snapshot invalid: stage ${stage} of "${crop}" on tile ${i}`);
        c.count++;
        c.flags[i] = flags;
        c.moisture[i] = moisture;
        c.fertility[i] = fertility;
        c.crop[i] = index;
        c.stage[i] = stage;
        c.daysInStage[i] = days;
        c.qualityPoints[i] = qp;
        c.pest[i] = PESTS.indexOf(pest);
        c.pestDays[i] = pestDays;
        c.harvests[i] = harvests;
        c.lastWateredDay[i] = watered;
      }
      this.chunks.set(packChunkId(c.layer, c.cx, c.cy), c);
    }
  }
}
