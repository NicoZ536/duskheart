/**
 * World objects that are particle sources while in view (M7-123; MASTERPROMPT §6.2 "Emitter als Daten"; docs/SPIEL.md §18
 * "Naturwunder"): world objects have no clips – the geyser's steam column and the steam vents' wisps rise as particles. The
 * content binds an object to a source (`OBJECT_EMITTERS`, src/content/particles/orte.ts): its emitter and the point of the
 * births, `dx` px east of the object's anchor (the same anchor the object's sprite stands on, `objectAnchor`) and `hoehe` px
 * above it. The level the object stands on does not raise the source: like the sprite (whose `heightBase` only feeds its
 * light, src/render/batch/spriteList.ts), a plateau is drawn where its tiles lie, and a particle's height is drawn as a
 * screen offset (`ground.y − z`) – the level added to it lifted the puffs a wall's height over the plume (M7-123, shot r3).
 *
 * Each chunk's bound objects are found once per content signature (a few per chunk at most, typed arrays grown by doubling);
 * a frame walks the chunks around the view (`ObjectView`, the same rectangle as the objects) and pushes a source for every
 * bound object inside it – no allocation per frame, only whole numbers through calls. A source's stable number is its tile
 * (`SOURCE_ID_BASE`), so its puffs keep their random sequence from frame to frame.
 *
 * A binding with a rhythm (M7-141, `rhythmus`: the geyser) does not emit evenly: its cycle – rest, rise, eruption, decay –
 * sets the strength of its source and of its eruption's sources (`rhythmIn`). Where in its cycle an object stands is a pure
 * function of the presentation time (`RenderScene.time`) and its tile: the cycle length and the offset are drawn from the
 * tile's hash when the chunk's list is built, so two geysers of one field erupt at different times and a frozen picture
 * always shows the same phase. Nothing of it is simulation state. The strengths are fractions: they pass no call – `rhythmIn`
 * reads and writes a register (ADR-0274, ADR-0316) and the emit loop writes them into the source list itself.
 */
import { OBJECT_EMITTERS, type ObjectRhythm } from '../../content/particles/index';
import type { ChunkData } from '../../world/model/chunk';
import type { RenderScene } from '../scene';
import { particleEmitter } from '../particles/tables';
import { CHUNK_PX, CHUNK_TILES } from '../tilemap/chunk';
import { TILE_HASH, tileHashInto } from '../tilemap/tileSet';
import { objectAnchor, type ObjectView } from './objects';
import type { WorldRenderTables } from './tables';

/**
 * Stable numbers of the objects' sources: a base of their own in the high half (clear of the fires' hashes below 2^28, the
 * vaults' and beacons' bases), the tile in the low – unique within a view, and below 2^30, so a small integer goes through the
 * call (ADR-0167: no number boxed per frame).
 */
const SOURCE_ID_BASE = 0x3a000000;
const SOURCE_TILE_MASK = 0xff;
const SOURCE_ROW_SHIFT = 8;
/** Initial capacity of a chunk's source list (grows by doubling). */
const INITIAL_SOURCES = 4;
/** Margin around the view [px] within which a source still emits (its puffs drift into the view). */
const VIEW_MARGIN_PX = 48;
/** Salts of a rhythmic source's tile hash: its cycle length and its offset in the cycle. */
const SALT_PERIOD = 0x2f6b9d13;
const SALT_OFFSET = 0x5ac3e871;

/**
 * Columns of a binding's rhythm row (`ObjectEmitters.rhythm`, `RHYTHM_COLUMNS` per binding): share of the rate at rest, the
 * rise, the eruption, the decay and the ramp of the eruption's sources [s].
 */
export const RHYTHM_REST = 0;
export const RHYTHM_RISE = 1;
export const RHYTHM_ERUPTION = 2;
export const RHYTHM_DECAY = 3;
export const RHYTHM_RAMP = 4;
export const RHYTHM_COLUMNS = 5;

/** Slots of the rhythm register (`createRhythmRegister`): in – the second within the cycle and its length; out – the strengths. */
export const RHYTHM_AT = 0;
export const RHYTHM_PERIOD = 1;
/** Strength of the object's own source, 0…1. */
export const RHYTHM_SOURCE = 2;
/** Strength of the eruption's sources, 0…1 (0 outside the eruption). */
export const RHYTHM_BURST = 3;
const RHYTHM_SLOTS = 4;

/** A register of `rhythmIn`. */
export function createRhythmRegister(): Float64Array {
  return new Float64Array(RHYTHM_SLOTS);
}

/** Writes the rhythm `r` into row `row` of `table` (`RHYTHM_COLUMNS` per row). */
export function writeRhythmRow(table: Float64Array, row: number, r: ObjectRhythm): void {
  const o = row * RHYTHM_COLUMNS;
  table[o + RHYTHM_REST] = r.ruhe;
  table[o + RHYTHM_RISE] = r.anstieg;
  table[o + RHYTHM_ERUPTION] = r.ausbruch;
  table[o + RHYTHM_DECAY] = r.abklingen;
  table[o + RHYTHM_RAMP] = r.rampe;
}

/**
 * The strengths of a rhythmic source at second `reg[RHYTHM_AT]` of its cycle of `reg[RHYTHM_PERIOD]` seconds (rhythm row `row`
 * of `table`), into `reg[RHYTHM_SOURCE]` and `reg[RHYTHM_BURST]`. The cycle ends with the rise, the eruption and the decay; before
 * them the source rests at the share `ruhe`. Rising, its strength swells to full on a quadratic ease (the steam thickens
 * slowly, then fast); erupting it is full and the eruption's sources swell in over the ramp, hold and die out over the ramp at
 * the end; decaying it falls back to `ruhe` linearly. Register form: no fraction passes the call (ADR-0274).
 */
export function rhythmIn(table: Float64Array, row: number, reg: Float64Array): void {
  const o = row * RHYTHM_COLUMNS;
  const rest = table[o + RHYTHM_REST] as number;
  const rise = table[o + RHYTHM_RISE] as number;
  const eruption = table[o + RHYTHM_ERUPTION] as number;
  const decay = table[o + RHYTHM_DECAY] as number;
  const ramp = table[o + RHYTHM_RAMP] as number;
  const at = reg[RHYTHM_AT] as number;
  const riseFrom = (reg[RHYTHM_PERIOD] as number) - rise - eruption - decay;
  const eruptFrom = riseFrom + rise;
  const decayFrom = eruptFrom + eruption;
  let source = rest;
  let burst = 0;
  if (at >= decayFrom) {
    source = 1 - (1 - rest) * Math.min(1, (at - decayFrom) / decay);
  } else if (at >= eruptFrom) {
    source = 1;
    const e = at - eruptFrom;
    burst = ramp > 0 ? Math.min(1, e / ramp, (eruption - e) / ramp) : 1;
  } else if (at >= riseFrom) {
    const x = (at - riseFrom) / rise;
    source = rest + (1 - rest) * x * x;
  }
  reg[RHYTHM_SOURCE] = source;
  reg[RHYTHM_BURST] = burst > 0 ? burst : 0;
}

/**
 * Where in its cycle the rhythmic source on tile (tx, ty) stands: its cycle length, drawn between `periodMin` and
 * `periodMin + periodSpan` from the tile's hash, into `reg[RHYTHM_PERIOD]`; its offset in the cycle [s], drawn from the tile
 * with another salt, into `reg[RHYTHM_AT]` (the second of the cycle at presentation time 0). Whole numbers in, register out.
 */
export function rhythmPhaseIn(tx: number, ty: number, table: Float64Array, row: number, reg: Float64Array): void {
  const span = table[row * 2 + 1] as number;
  tileHashInto(tx, ty, SALT_PERIOD);
  const period = (table[row * 2] as number) + span * (TILE_HASH[0] as number);
  tileHashInto(tx, ty, SALT_OFFSET);
  reg[RHYTHM_PERIOD] = period;
  reg[RHYTHM_AT] = period * (TILE_HASH[0] as number);
}

/**
 * The strengths of rhythm `r` on tile (tx, ty) at presentation time `time` [s], with the second `at` within the cycle of
 * `period` seconds – the same cycle `ObjectEmitters.emit` follows. For the debug scenarios that pick a phase for their
 * picture and for tests; it allocates and is never called in a frame.
 */
export function rhythmStrengthsAt(r: ObjectRhythm, tx: number, ty: number, time: number): { source: number; burst: number; at: number; period: number } {
  const table = new Float64Array(RHYTHM_COLUMNS);
  writeRhythmRow(table, 0, r);
  const reg = createRhythmRegister();
  rhythmPhaseIn(tx, ty, Float64Array.of(r.periode.min, r.periode.max - r.periode.min), 0, reg);
  const period = reg[RHYTHM_PERIOD] as number;
  const at = (((time + (reg[RHYTHM_AT] as number)) % period) + period) % period;
  reg[RHYTHM_AT] = at;
  rhythmIn(table, 0, reg);
  return { source: reg[RHYTHM_SOURCE] as number, burst: reg[RHYTHM_BURST] as number, at, period };
}

/** `a` copied into a new array of `cap` entries (a chunk's list grows when it is built, never in a frame). */
function grown(a: Int32Array<ArrayBuffer>, cap: number): Int32Array<ArrayBuffer> {
  const b = new Int32Array(cap);
  b.set(a);
  return b;
}

/** `a` copied into a new array of `cap` entries. */
function grownFloat(a: Float64Array<ArrayBuffer>, cap: number): Float64Array<ArrayBuffer> {
  const b = new Float64Array(cap);
  b.set(a);
  return b;
}

/**
 * The bound objects of one chunk: point of the births [world px] and height, binding, stable number – whole numbers –, and for
 * a rhythmic binding its cycle length and its offset in the cycle [s] (drawn from the tile when the list is built).
 */
class ChunkSources {
  signature = -1;
  count = 0;
  x: Int32Array<ArrayBuffer> = new Int32Array(INITIAL_SOURCES);
  y: Int32Array<ArrayBuffer> = new Int32Array(INITIAL_SOURCES);
  z: Int32Array<ArrayBuffer> = new Int32Array(INITIAL_SOURCES);
  binding: Int32Array<ArrayBuffer> = new Int32Array(INITIAL_SOURCES);
  id: Int32Array<ArrayBuffer> = new Int32Array(INITIAL_SOURCES);
  period: Float64Array<ArrayBuffer> = new Float64Array(INITIAL_SOURCES);
  offset: Float64Array<ArrayBuffer> = new Float64Array(INITIAL_SOURCES);

  /** Adds a source; its cycle (period and offset) is written by the caller into slot `count − 1` (fractions pass no call). */
  push(x: number, y: number, z: number, binding: number, id: number): void {
    if (this.count === this.x.length) {
      const cap = this.x.length * 2;
      this.x = grown(this.x, cap);
      this.y = grown(this.y, cap);
      this.z = grown(this.z, cap);
      this.binding = grown(this.binding, cap);
      this.id = grown(this.id, cap);
      this.period = grownFloat(this.period, cap);
      this.offset = grownFloat(this.offset, cap);
    }
    const k = this.count++;
    this.x[k] = x;
    this.y[k] = y;
    this.z[k] = z;
    this.binding[k] = binding;
    this.id[k] = id;
    this.period[k] = 0;
    this.offset[k] = 0;
  }
}

/** What a frame pushed. */
export interface ObjectEmitterStats {
  sources: number;
}

export class ObjectEmitters {
  /** Per runtime object id: index into the bindings + 1 (0: the object emits nothing). */
  private readonly bindingOf: Uint8Array;
  private readonly presets: Int32Array;
  private readonly dx: Int32Array;
  private readonly height: Int32Array;
  /** Per binding: 1 when it has a rhythm (M7-141). */
  private readonly rhythmic: Uint8Array;
  /** Per binding: its rhythm row (`RHYTHM_COLUMNS`) and its cycle's shortest length and spread [s] (two columns). */
  private readonly rhythm: Float64Array;
  private readonly cycle: Float64Array;
  /** Per binding: the first of its eruption's sources in `bursts`, and how many. */
  private readonly burstFrom: Int32Array;
  private readonly burstCount: Int32Array;
  /** The eruptions' sources (preset indices), binding after binding. */
  private readonly bursts: Int32Array;
  /** The register of `rhythmIn` and `rhythmPhaseIn` (held: no fraction passes a call). */
  private readonly reg = createRhythmRegister();
  private readonly lists = new WeakMap<ChunkData, ChunkSources>();
  private readonly anchor = { x: 0, y: 0 };
  readonly stats: ObjectEmitterStats = { sources: 0 };

  constructor(private readonly tables: WorldRenderTables) {
    const n = OBJECT_EMITTERS.length;
    this.bindingOf = new Uint8Array(tables.objects.length);
    this.presets = new Int32Array(n);
    this.dx = new Int32Array(n);
    this.height = new Int32Array(n);
    this.rhythmic = new Uint8Array(n);
    this.rhythm = new Float64Array(n * RHYTHM_COLUMNS);
    this.cycle = new Float64Array(n * 2);
    this.burstFrom = new Int32Array(n);
    this.burstCount = new Int32Array(n);
    this.bursts = new Int32Array(OBJECT_EMITTERS.reduce((sum, b) => sum + (b.rhythmus?.ausbruchEmitter.length ?? 0), 0));
    let burst = 0;
    OBJECT_EMITTERS.forEach((b, k) => {
      this.presets[k] = particleEmitter(b.emitter);
      this.dx[k] = b.dx;
      this.height[k] = b.hoehe;
      const r = b.rhythmus;
      if (r === undefined) return;
      this.rhythmic[k] = 1;
      writeRhythmRow(this.rhythm, k, r);
      this.cycle[k * 2] = r.periode.min;
      this.cycle[k * 2 + 1] = r.periode.max - r.periode.min;
      this.burstFrom[k] = burst;
      this.burstCount[k] = r.ausbruchEmitter.length;
      for (const id of r.ausbruchEmitter) this.bursts[burst++] = particleEmitter(id);
    });
    tables.objects.forEach((def, id) => {
      if (def === null) return;
      const k = OBJECT_EMITTERS.findIndex((b) => b.objekt === def.id);
      if (k >= 0) this.bindingOf[id] = k + 1;
    });
  }

  /** Whether any object of the content emits (without, `emit` has nothing to do). */
  get bound(): boolean {
    return OBJECT_EMITTERS.length > 0;
  }

  /** The sources of `chunk` (rebuilt when its content signature changed). */
  sourcesOf(chunk: ChunkData, signature: number): ChunkSources {
    let list = this.lists.get(chunk);
    if (list === undefined) {
      list = new ChunkSources();
      this.lists.set(chunk, list);
    }
    if (list.signature !== signature) {
      this.build(chunk, list);
      list.signature = signature;
    }
    return list;
  }

  private build(chunk: ChunkData, out: ChunkSources): void {
    out.count = 0;
    const x0 = chunk.cx * CHUNK_TILES;
    const y0 = chunk.cy * CHUNK_TILES;
    for (let i = 0; i < chunk.object.length; i++) {
      const id = chunk.object[i] as number;
      if (id === 0) continue;
      const b = this.bindingOf[id] as number;
      if (b === 0) continue;
      const def = this.tables.objects[id];
      if (def === undefined || def === null) continue;
      const tx = x0 + (i % CHUNK_TILES);
      const ty = y0 + Math.floor(i / CHUNK_TILES);
      objectAnchor(def, tx, ty, this.anchor);
      out.push(this.anchor.x + (this.dx[b - 1] as number), this.anchor.y, this.height[b - 1] as number, b - 1, SOURCE_ID_BASE + (((ty & SOURCE_TILE_MASK) << SOURCE_ROW_SHIFT) | (tx & SOURCE_TILE_MASK)));
      if (this.rhythmic[b - 1] === 1) {
        rhythmPhaseIn(tx, ty, this.cycle, b - 1, this.reg);
        out.period[out.count - 1] = this.reg[RHYTHM_PERIOD] as number;
        out.offset[out.count - 1] = this.reg[RHYTHM_AT] as number;
      }
    }
  }

  /** Pushes a source for every bound object around `view` into `scene.particles.emitters`; returns how many. */
  emit(scene: RenderScene, view: ObjectView): number {
    this.stats.sources = 0;
    if (!this.bound) return 0;
    const left = view.left - VIEW_MARGIN_PX;
    const right = view.right + VIEW_MARGIN_PX;
    const top = view.top - VIEW_MARGIN_PX;
    const bottom = view.bottom + VIEW_MARGIN_PX;
    const cx0 = Math.floor(left / CHUNK_PX);
    const cx1 = Math.floor(right / CHUNK_PX);
    const cy0 = Math.floor(top / CHUNK_PX);
    const cy1 = Math.floor(bottom / CHUNK_PX);
    const emitters = scene.particles.emitters;
    const time = scene.time;
    const reg = this.reg;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = view.chunks.get(view.layer, cx, cy);
        if (chunk === undefined) continue;
        const list = this.sourcesOf(chunk, view.signatures.of(chunk));
        for (let k = 0; k < list.count; k++) {
          const x = list.x[k] as number;
          const y = list.y[k] as number;
          if (x < left || x > right || y < top || y > bottom) continue;
          const b = list.binding[k] as number;
          const z = list.z[k] as number;
          const id = list.id[k] as number;
          // Pushed at full strength; a rhythm writes its strength into the list's slot (a fraction passes no call).
          emitters.push(this.presets[b] as number, x, y, z, 1, id);
          this.stats.sources++;
          if (this.rhythmic[b] === 0) continue;
          const period = list.period[k] as number;
          const at = (time + (list.offset[k] as number)) % period;
          reg[RHYTHM_AT] = at < 0 ? at + period : at;
          reg[RHYTHM_PERIOD] = period;
          rhythmIn(this.rhythm, b, reg);
          emitters.strength[emitters.count - 1] = reg[RHYTHM_SOURCE] as number;
          if (!((reg[RHYTHM_BURST] as number) > 0)) continue;
          const from = this.burstFrom[b] as number;
          const to = from + (this.burstCount[b] as number);
          for (let j = from; j < to; j++) {
            emitters.push(this.bursts[j] as number, x, y, z, 1, id);
            emitters.strength[emitters.count - 1] = reg[RHYTHM_BURST] as number;
            this.stats.sources++;
          }
        }
      }
    }
    return this.stats.sources;
  }
}
