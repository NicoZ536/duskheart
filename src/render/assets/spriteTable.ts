/**
 * The sprite table of the generated atlas manifest (M7-151; docs/RENDER.md §2): the frames, clips and sockets of all sprites
 * are held as a few typed-array columns instead of one object graph per sprite, and decoded per sprite the first time its
 * `frames`, `clips` or `sockets` are read.
 *
 * Why: the manifest held ≈ 55 000 frame records, 5 200 clips with their frame lists and 18 000 socket points as small
 * objects – 110 000 heap nodes, 3.5 MB – all promoted to old space during module evaluation, interleaved with the
 * temporaries of the other modules; V8's memory reducer later evacuated those holey pages in one long collection
 * (ADR-0315, M7-138). The columns live off the heap (typed-array backing stores); what the game decodes stays as long as
 * the table. Every frame is an object of its own, as in the JSON manifest before (M7-130): tests and tools tell a drawn
 * frame's sprite and index by the frame object, so neither two sprites (the body-shape variants of a garment share the
 * garment's rectangles) nor two frames of one sprite (a clip's repeated picture) share one. Clip frame sequences and
 * socket points are shared across sprites: one array or tuple per distinct sequence or point.
 *
 * `SpriteEntry` is both contracts at once: the generated module's `AtlasSprite` (`hoehe`, `emissiv`, `spiegelbar`,
 * `schatten`) and the renderer's (`heightHint`, `emissive`, `symmetric`, `sunShadow`), so `manifestFromGenerated` hands
 * the entries out as they are. `frames`, `clips` and `sockets` are own accessor properties (not prototype getters): a
 * spread copy of an entry (`{ ...sprite, clips }`) and `JSON.stringify` then see the decoded data like any field.
 */
import type { AnimationClip, ClipEvent } from '../anim/animation';
import type { SpriteFrameRef } from '../batch/spriteList';
import type { AtlasOccluderShape, AtlasSprite as RendererSprite, HeightHint } from './atlas';

/** Rectangle in pixels (atlas or cell coordinates, y down). */
export interface TableRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Sun shadow of a sprite: none, or its silhouette sheared at the foot `basisY`; `bounds` in cell coordinates. */
export type SunShadowSpec = { readonly kind: 'none' } | { readonly kind: 'silhouette'; readonly basisY: number; readonly bounds: TableRect };

/** A point in cell coordinates (px, y down). */
export type TablePoint = readonly [number, number];

/** The header of a sprite as the generated module holds it (JSON): everything but frames, clips and sockets. */
export interface SpriteHeader {
  readonly id: string;
  readonly group: string;
  readonly size: readonly [number, number];
  readonly anchor: TablePoint;
  readonly hitbox: TableRect | null;
  readonly occluder: AtlasOccluderShape;
  readonly schatten: SunShadowSpec;
  readonly hoehe: HeightHint;
  readonly emissiv: boolean;
  readonly material: number;
  readonly bounds: TableRect;
  readonly spiegelbar: boolean;
  readonly farben: number;
}

/** A decoded clip: the renderer's `AnimationClip` with its events always present (the generated contract's `AtlasClip`). */
export interface TableClip extends AnimationClip {
  readonly events: readonly ClipEvent[];
}

/** Ints per entry of the integer columns. */
export const SPAN_INTS = 6;
export const RECT_INTS = 6;
export const CLIP_INTS = 5;
export const SEQUENCE_INTS = 2;
export const EVENT_INTS = 2;
export const SOCKET_INTS = 2;
export const POINT_INTS = 2;

/** Offsets within a sprite's span. */
const SPAN_FRAME_START = 0;
const SPAN_FRAME_COUNT = 1;
const SPAN_CLIP_START = 2;
const SPAN_CLIP_COUNT = 3;
const SPAN_SOCKET_START = 4;
const SPAN_SOCKET_COUNT = 5;
/** Offsets within a clip record. */
const CLIP_NAME = 0;
const CLIP_SEQUENCE = 1;
const CLIP_LOOP = 2;
const CLIP_EVENT_START = 3;
const CLIP_EVENT_COUNT = 4;

/**
 * The columns of the table, in sprite order. Every sprite spans a run of `frames` (one rectangle index per frame), of
 * `clips` and of `sockets`; a socket track spans `frameCount` entries of `socketPoints` (one point index per frame).
 */
export interface SpriteColumns {
  /** `SPAN_INTS` per sprite: frame start and count, clip start and count, socket start and count. */
  readonly spans: Int32Array;
  /** `RECT_INTS` per unique frame rectangle: x, y, w, h, ax, ay. */
  readonly rects: Int32Array;
  /** One index into `rects` per frame of every sprite. */
  readonly frames: Int32Array;
  readonly clipNames: readonly string[];
  /** `CLIP_INTS` per clip: name (index into `clipNames`), sequence, loop (0/1), event start and count. */
  readonly clips: Int32Array;
  /** Frames per second of every clip. */
  readonly clipFps: Float64Array;
  /** `SEQUENCE_INTS` per unique frame sequence: start and length in `clipFrames`. */
  readonly sequences: Int32Array;
  /** The frame sequences of the clips, concatenated. */
  readonly clipFrames: Int32Array;
  readonly eventNames: readonly string[];
  /** `EVENT_INTS` per clip event: clip position and name (index into `eventNames`). */
  readonly events: Int32Array;
  readonly socketNames: readonly string[];
  /** `SOCKET_INTS` per socket track: name (index into `socketNames`) and start in `socketPoints`. */
  readonly sockets: Int32Array;
  /** One index into `points` per frame of every socket track. */
  readonly socketPoints: Int32Array;
  /** `POINT_INTS` per unique socket point: x, y. */
  readonly points: Int32Array;
}

const NO_OCCLUDER: AtlasOccluderShape = Object.freeze({ kind: 'none' } as const);
const NO_SHADOW: SunShadowSpec = Object.freeze({ kind: 'none' } as const);
const NO_EVENTS: readonly ClipEvent[] = Object.freeze([]);

function framesOf(this: SpriteEntry): readonly SpriteFrameRef[] {
  return this.frameCache ?? this.decodeFrames();
}
function clipsOf(this: SpriteEntry): Readonly<Record<string, TableClip>> {
  return this.clipCache ?? this.decodeClips();
}
function socketsOf(this: SpriteEntry): Readonly<Record<string, readonly TablePoint[]>> {
  return this.socketCache ?? this.decodeSockets();
}
/** The three decoded views as own accessors of every entry (see the module comment). */
const LAZY_VIEWS: PropertyDescriptorMap = {
  frames: { get: framesOf, enumerable: true, configurable: false },
  clips: { get: clipsOf, enumerable: true, configurable: false },
  sockets: { get: socketsOf, enumerable: true, configurable: false },
};

/** One sprite of the table (see the module comment). */
export class SpriteEntry implements RendererSprite {
  readonly id: string;
  readonly group: string;
  readonly size: readonly [number, number];
  readonly anchor: TablePoint;
  readonly hitbox: TableRect | null;
  readonly occluder: AtlasOccluderShape;
  readonly schatten: SunShadowSpec;
  readonly hoehe: HeightHint;
  readonly emissiv: boolean;
  readonly material: number;
  readonly bounds: TableRect;
  readonly spiegelbar: boolean;
  readonly farben: number;
  /** The renderer's names of `hoehe`, `emissiv`, `spiegelbar` and `schatten`. */
  readonly heightHint: HeightHint;
  readonly emissive: boolean;
  readonly symmetric: boolean;
  readonly sunShadow: boolean;
  /** Decoded on first read (own accessors, `LAZY_VIEWS`). */
  declare readonly frames: readonly SpriteFrameRef[];
  declare readonly clips: Readonly<Record<string, TableClip>>;
  declare readonly sockets: Readonly<Record<string, readonly TablePoint[]>>;
  /** @internal */
  frameCache: readonly SpriteFrameRef[] | null = null;
  /** @internal */
  clipCache: Readonly<Record<string, TableClip>> | null = null;
  /** @internal */
  socketCache: Readonly<Record<string, readonly TablePoint[]>> | null = null;

  /** The table (not enumerable: a spread copy or `JSON.stringify` of an entry does not carry the whole table). */
  declare private readonly table: SpriteTable;

  constructor(
    table: SpriteTable,
    /** Position in the table (its span). */
    readonly index: number,
    h: SpriteHeader,
  ) {
    Object.defineProperty(this, 'table', { value: table, enumerable: false, writable: false, configurable: false });
    this.id = h.id;
    this.group = h.group;
    this.size = h.size;
    this.anchor = h.anchor;
    this.hitbox = h.hitbox;
    this.occluder = h.occluder.kind === 'none' ? NO_OCCLUDER : h.occluder;
    this.schatten = h.schatten.kind === 'none' ? NO_SHADOW : h.schatten;
    this.hoehe = h.hoehe;
    this.emissiv = h.emissiv;
    this.material = h.material;
    this.bounds = h.bounds;
    this.spiegelbar = h.spiegelbar;
    this.farben = h.farben;
    this.heightHint = h.hoehe;
    this.emissive = h.emissiv;
    this.symmetric = h.spiegelbar;
    this.sunShadow = h.schatten.kind === 'silhouette';
    Object.defineProperties(this, LAZY_VIEWS);
  }

  /** Whether a view has been decoded yet (tests and heap evidence). */
  get decoded(): { readonly frames: boolean; readonly clips: boolean; readonly sockets: boolean } {
    return { frames: this.frameCache !== null, clips: this.clipCache !== null, sockets: this.socketCache !== null };
  }

  /** @internal */
  decodeFrames(): readonly SpriteFrameRef[] {
    const t = this.table;
    const c = t.columns;
    const s = this.index * SPAN_INTS;
    const start = c.spans[s + SPAN_FRAME_START] as number;
    const count = c.spans[s + SPAN_FRAME_COUNT] as number;
    const out: SpriteFrameRef[] = [];
    // One object per frame (see the module comment).
    for (let k = 0; k < count; k++) out.push(t.rect(c.frames[start + k] as number));
    t.decodedRects += count;
    this.frameCache = out;
    return out;
  }

  /** @internal */
  decodeClips(): Readonly<Record<string, TableClip>> {
    const t = this.table;
    const c = t.columns;
    const s = this.index * SPAN_INTS;
    const start = c.spans[s + SPAN_CLIP_START] as number;
    const count = c.spans[s + SPAN_CLIP_COUNT] as number;
    const out: Record<string, TableClip> = {};
    for (let k = 0; k < count; k++) {
      const clip = start + k;
      const o = clip * CLIP_INTS;
      const name = c.clipNames[c.clips[o + CLIP_NAME] as number] as string;
      const eventCount = c.clips[o + CLIP_EVENT_COUNT] as number;
      out[name] = {
        name,
        frames: t.sequence(c.clips[o + CLIP_SEQUENCE] as number),
        fps: c.clipFps[clip] as number,
        loop: c.clips[o + CLIP_LOOP] === 1,
        events: eventCount === 0 ? NO_EVENTS : t.events(c.clips[o + CLIP_EVENT_START] as number, eventCount),
      };
    }
    this.clipCache = out;
    return out;
  }

  /** @internal */
  decodeSockets(): Readonly<Record<string, readonly TablePoint[]>> {
    const t = this.table;
    const c = t.columns;
    const s = this.index * SPAN_INTS;
    const frameCount = c.spans[s + SPAN_FRAME_COUNT] as number;
    const start = c.spans[s + SPAN_SOCKET_START] as number;
    const count = c.spans[s + SPAN_SOCKET_COUNT] as number;
    const out: Record<string, readonly TablePoint[]> = {};
    for (let k = 0; k < count; k++) {
      const o = (start + k) * SOCKET_INTS;
      const pointStart = c.sockets[o + 1] as number;
      const track: TablePoint[] = [];
      for (let f = 0; f < frameCount; f++) track.push(t.point(c.socketPoints[pointStart + f] as number));
      out[c.socketNames[c.sockets[o] as number] as string] = track;
    }
    this.socketCache = out;
    return out;
  }
}

function fail(what: string): never {
  throw new Error(`Sprite-Tabelle des Atlas-Manifests passt nicht zu sich selbst (docs/RENDER.md §2): ${what}`);
}

/** The table: its entries by id and the interned decoded parts. */
export class SpriteTable {
  /** Entries by sprite id, in header order (a plain object: the module's `SPRITES`). */
  readonly sprites: Readonly<Record<string, SpriteEntry>>;
  /** The entries in header order. */
  readonly entries: readonly SpriteEntry[];
  readonly count: number;
  /** Frame objects decoded so far (heap evidence, M7-151). */
  decodedRects = 0;
  private readonly sequenceCache: (readonly number[] | undefined)[];
  private readonly pointCache: (TablePoint | undefined)[];

  /**
   * Checks the columns' extents against the headers in constant time (the contract of every value is checked where the
   * module is built, `checkGeneratedAtlasModule`) and builds one entry per header. Nothing of the columns is decoded here.
   */
  constructor(
    headers: readonly SpriteHeader[],
    readonly columns: SpriteColumns,
  ) {
    const c = columns;
    const n = headers.length;
    if (c.spans.length !== n * SPAN_INTS) fail(`${n} Sprites, aber ${c.spans.length / SPAN_INTS} Spannen`);
    if (c.rects.length % RECT_INTS !== 0) fail(`Rechteck-Spalte mit ${c.rects.length} Zahlen (kein Vielfaches von ${RECT_INTS})`);
    if (c.clips.length % CLIP_INTS !== 0 || c.clips.length / CLIP_INTS !== c.clipFps.length) fail(`Clip-Spalte mit ${c.clips.length} Zahlen für ${c.clipFps.length} Bildraten`);
    if (c.sequences.length % SEQUENCE_INTS !== 0) fail(`Sequenz-Spalte mit ${c.sequences.length} Zahlen`);
    if (c.events.length % EVENT_INTS !== 0) fail(`Ereignis-Spalte mit ${c.events.length} Zahlen`);
    if (c.sockets.length % SOCKET_INTS !== 0) fail(`Sockel-Spalte mit ${c.sockets.length} Zahlen`);
    if (c.points.length % POINT_INTS !== 0) fail(`Punkt-Spalte mit ${c.points.length} Zahlen`);
    const last = (n - 1) * SPAN_INTS;
    const frameEnd = n === 0 ? 0 : (c.spans[last + SPAN_FRAME_START] as number) + (c.spans[last + SPAN_FRAME_COUNT] as number);
    const clipEnd = n === 0 ? 0 : (c.spans[last + SPAN_CLIP_START] as number) + (c.spans[last + SPAN_CLIP_COUNT] as number);
    const socketEnd = n === 0 ? 0 : (c.spans[last + SPAN_SOCKET_START] as number) + (c.spans[last + SPAN_SOCKET_COUNT] as number);
    if (frameEnd !== c.frames.length) fail(`die Spannen enden bei Frame ${frameEnd}, die Frame-Spalte hat ${c.frames.length}`);
    if (clipEnd !== c.clipFps.length) fail(`die Spannen enden bei Clip ${clipEnd}, die Clip-Spalte hat ${c.clipFps.length}`);
    if (socketEnd !== c.sockets.length / SOCKET_INTS) fail(`die Spannen enden bei Sockel ${socketEnd}, die Sockel-Spalte hat ${c.sockets.length / SOCKET_INTS}`);
    this.count = n;
    this.sequenceCache = new Array<readonly number[] | undefined>(c.sequences.length / SEQUENCE_INTS);
    this.pointCache = new Array<TablePoint | undefined>(c.points.length / POINT_INTS);
    const sprites: Record<string, SpriteEntry> = {};
    const entries: SpriteEntry[] = [];
    for (let i = 0; i < n; i++) {
      const h = headers[i] as SpriteHeader;
      if (Object.hasOwn(sprites, h.id)) fail(`Sprite ${h.id} doppelt`);
      const e = new SpriteEntry(this, i, h);
      sprites[h.id] = e;
      entries.push(e);
    }
    this.sprites = sprites;
    this.entries = entries;
  }

  /** A new frame object of rectangle `r` of the column. */
  rect(r: number): SpriteFrameRef {
    const c = this.columns.rects;
    const o = r * RECT_INTS;
    return { x: c[o] as number, y: c[o + 1] as number, w: c[o + 2] as number, h: c[o + 3] as number, ax: c[o + 4] as number, ay: c[o + 5] as number };
  }

  /** Frame sequence `s` of the column (one array per sequence, however many clips play it). */
  sequence(s: number): readonly number[] {
    const known = this.sequenceCache[s];
    if (known !== undefined) return known;
    const c = this.columns;
    const o = s * SEQUENCE_INTS;
    const start = c.sequences[o] as number;
    const length = c.sequences[o + 1] as number;
    const frames: number[] = [];
    for (let k = 0; k < length; k++) frames.push(c.clipFrames[start + k] as number);
    this.sequenceCache[s] = frames;
    return frames;
  }

  /** Socket point `p` of the column (one tuple per point, however many frames and tracks share it). */
  point(p: number): TablePoint {
    const known = this.pointCache[p];
    if (known !== undefined) return known;
    const c = this.columns.points;
    const o = p * POINT_INTS;
    const point: TablePoint = [c[o] as number, c[o + 1] as number];
    this.pointCache[p] = point;
    return point;
  }

  /** The `count` events from `start` of the column, as a clip's event list. */
  events(start: number, count: number): readonly ClipEvent[] {
    const c = this.columns;
    const out: ClipEvent[] = [];
    for (let k = 0; k < count; k++) {
      const o = (start + k) * EVENT_INTS;
      out.push({ frame: c.events[o] as number, name: c.eventNames[c.events[o + 1] as number] as string });
    }
    return out;
  }

  /** How much of the table has been decoded (heap evidence, M7-151). */
  decodedCounts(): { readonly sprites: number; readonly frames: number; readonly clips: number; readonly sockets: number; readonly rects: number; readonly sequences: number; readonly points: number } {
    let frames = 0;
    let clips = 0;
    let sockets = 0;
    let sprites = 0;
    for (const e of this.entries) {
      const d = e.decoded;
      if (d.frames || d.clips || d.sockets) sprites++;
      if (d.frames) frames++;
      if (d.clips) clips++;
      if (d.sockets) sockets++;
    }
    const filled = (cache: readonly unknown[]): number => {
      let n = 0;
      for (let i = 0; i < cache.length; i++) if (cache[i] !== undefined) n++;
      return n;
    };
    return { sprites, frames, clips, sockets, rects: this.decodedRects, sequences: filled(this.sequenceCache), points: filled(this.pointCache) };
  }
}
