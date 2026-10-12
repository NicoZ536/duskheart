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
 */
import { OBJECT_EMITTERS } from '../../content/particles/index';
import type { ChunkData } from '../../world/model/chunk';
import type { RenderScene } from '../scene';
import { particleEmitter } from '../particles/tables';
import { CHUNK_PX, CHUNK_TILES } from '../tilemap/chunk';
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

/** `a` copied into a new array of `cap` entries (a chunk's list grows when it is built, never in a frame). */
function grown(a: Int32Array<ArrayBuffer>, cap: number): Int32Array<ArrayBuffer> {
  const b = new Int32Array(cap);
  b.set(a);
  return b;
}

/** The bound objects of one chunk: point of the births [world px] and height, source row, stable number – whole numbers. */
class ChunkSources {
  signature = -1;
  count = 0;
  x: Int32Array<ArrayBuffer> = new Int32Array(INITIAL_SOURCES);
  y: Int32Array<ArrayBuffer> = new Int32Array(INITIAL_SOURCES);
  z: Int32Array<ArrayBuffer> = new Int32Array(INITIAL_SOURCES);
  preset: Int32Array<ArrayBuffer> = new Int32Array(INITIAL_SOURCES);
  id: Int32Array<ArrayBuffer> = new Int32Array(INITIAL_SOURCES);

  push(x: number, y: number, z: number, preset: number, id: number): void {
    if (this.count === this.x.length) {
      const cap = this.x.length * 2;
      this.x = grown(this.x, cap);
      this.y = grown(this.y, cap);
      this.z = grown(this.z, cap);
      this.preset = grown(this.preset, cap);
      this.id = grown(this.id, cap);
    }
    const k = this.count++;
    this.x[k] = x;
    this.y[k] = y;
    this.z[k] = z;
    this.preset[k] = preset;
    this.id[k] = id;
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
  private readonly lists = new WeakMap<ChunkData, ChunkSources>();
  private readonly anchor = { x: 0, y: 0 };
  readonly stats: ObjectEmitterStats = { sources: 0 };

  constructor(private readonly tables: WorldRenderTables) {
    this.bindingOf = new Uint8Array(tables.objects.length);
    this.presets = new Int32Array(OBJECT_EMITTERS.length);
    this.dx = new Int32Array(OBJECT_EMITTERS.length);
    this.height = new Int32Array(OBJECT_EMITTERS.length);
    OBJECT_EMITTERS.forEach((b, k) => {
      this.presets[k] = particleEmitter(b.emitter);
      this.dx[k] = b.dx;
      this.height[k] = b.hoehe;
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
      out.push(
        this.anchor.x + (this.dx[b - 1] as number),
        this.anchor.y,
        this.height[b - 1] as number,
        this.presets[b - 1] as number,
        SOURCE_ID_BASE + (((ty & SOURCE_TILE_MASK) << SOURCE_ROW_SHIFT) | (tx & SOURCE_TILE_MASK)),
      );
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
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = view.chunks.get(view.layer, cx, cy);
        if (chunk === undefined) continue;
        const list = this.sourcesOf(chunk, view.signatures.of(chunk));
        for (let k = 0; k < list.count; k++) {
          const x = list.x[k] as number;
          const y = list.y[k] as number;
          if (x < left || x > right || y < top || y > bottom) continue;
          emitters.push(list.preset[k] as number, x, y, list.z[k] as number, 1, list.id[k] as number);
          this.stats.sources++;
        }
      }
    }
    return this.stats.sources;
  }
}
