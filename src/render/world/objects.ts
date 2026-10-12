/**
 * World objects as y-sorted sprites (M2-28, MASTERPROMPT §6.1 pass 2 "y-sortierte Objekte"): every
 * tile's `object` becomes a sprite of the same id (docs/WORLD.md §7), standing centred on its
 * footprint, with the frame of the season (trees), of the harvested state (`abgeerntet`) or of a
 * per-tile variant (scatter), the palette row of its rule (season rows, or the tile's biome row for
 * shared scatter, ore and crystals), wind sway where its pixels are flagged for wind and its anchor
 * raised by the level it stands on. A felled tree (object state `STAGE_STUMP`, M3-11) shows its stump
 * sprite; up to two objects carry the interaction outline (`setHighlight`, §4.6, M3-10).
 *
 * Each chunk's object list is resolved once into typed arrays and rebuilt only when the chunk's
 * content signature or the season changes; a frame only walks the lists of the chunks around the
 * view and pushes the sprites inside it – no allocation per frame. Crowns in front of the focus
 * (the player) that cover it get the canopy fade: their canopy pixels dither out in the fade circle.
 *
 * The same lists carry the ground decor (M3-40, `groundDecor.ts`): the dune grass's tufts in clumps
 * across tile borders, flat on the ground, bent a little by the wind; since M7-61 also the Grünhain meadow's grass
 * clumps and flower patches and the Salzküste's flotsam, each rule in its biomes and seasons only.
 */
import { NO_REGROW_TICK, TILE_FLAG_CLIFF_EDGE, TILE_FLAG_PLACE, type ChunkData } from '../../world/model/chunk';
import { isSapling, isStump } from '../../game/gathering/objectState';
import type { Layer } from '../../world/model/coords';
import type { RenderScene } from '../scene';
import { CHUNK_PX, CHUNK_TILES, TILE_PX } from '../tilemap/chunk';
import { TILE_HASH, tileHashBit, tileHashInto } from '../tilemap/tileSet';
import type { ChunkSignatures } from './signature';
import type { ObjectDef, WorldRenderTables } from './tables';
import { cellsCovering, tuftsOfCell, type DecorTuft } from './groundDecor';
import { WATER_DEPTH_MASK } from '../../world/model/chunk';
import { WAND_PX_JE_STUFE } from '../../world/autotile';
import type { SpriteDesc, SpriteFrameRef } from '../batch/spriteList';
import { WORLD_OBJECTS } from '../../content/worldObjects';
import { SURFACE_PARAMS } from '../surface/params';

/** Anchor row of an object in its tile [px from the tile's top]: the foot stands on the tile's last pixel row. */
const ANCHOR_ROW = TILE_PX - 1;
/** Position jitter of objects inside their tile [px, ±x / up], so forests and scatter do not line up on the grid. */
export const OBJECT_JITTER = {
  blockingX: 3,
  blockingY: 2,
  looseX: 5,
  looseY: 5,
} as const;
/**
 * Hash salts of the per-tile choices (independent of each other and of the terrain variants). Single constants, not fields
 * of one object: a field above the small-integer range is a boxed double, read anew as a number object in V8's baseline
 * code (M7-115).
 */
const SALT_X = 0x68e31da4;
const SALT_Y = 0x1b56c4e9;
const SALT_VARIANT = 0x7f4a7c15;
const SALT_PHASE = 0x3c6ef372;
const SALT_MIRROR = 0x5851f42d;
const FULL_TURN = Math.PI * 2;
/** Initial capacity of a chunk's object list (grows by doubling). */
const INITIAL_OBJECTS = 256;
/** Initial capacity of a chunk's ground decor list (grows by doubling). */
const INITIAL_DECOR = 64;
/** Objects that can carry the interaction outline at once: the target in reach and the one under the cursor. */
export const HIGHLIGHT_SLOTS = 2;
/** Index of winter in `SEASON_IDS` (the season of bare trees). */
const WINTER = 3;
/** Kind of ground decor for its grass bend (`SURFACE_PARAMS.grass.bendByKind`): tufts are grass. */
const DECOR_BEND_KIND = 'pflanze';
/** Tile flags that keep wild ground decor away (`GroundDecorRule.wildOnly`, M7-61): a height step's rim, a place's area. */
const NOT_WILD_FLAGS = TILE_FLAG_CLIFF_EDGE | TILE_FLAG_PLACE;

/**
 * Whether tile `i` of `chunk` is wild, level, dry ground (`GroundDecorRule.wildOnly`, M7-61): no cliff edge, no place area,
 * and its neighbours inside the chunk on its level and without water – a tuft reaches a few pixels to each side and would
 * hang over a rim, onto a wall or into the shore's foam. Neighbours beyond the chunk are not read (the list is built from the
 * chunk alone); the cliff edge flag marks the upper side of every step there.
 */
function wildGroundAt(chunk: ChunkData, i: number): boolean {
  if (((chunk.flags[i] as number) & NOT_WILD_FLAGS) !== 0) return false;
  const tx = i % CHUNK_TILES;
  const ty = (i - tx) / CHUNK_TILES;
  const level = chunk.height[i] as number;
  for (let y = Math.max(0, ty - 1); y <= Math.min(CHUNK_TILES - 1, ty + 1); y++) {
    for (let x = Math.max(0, tx - 1); x <= Math.min(CHUNK_TILES - 1, tx + 1); x++) {
      const j = y * CHUNK_TILES + x;
      if (chunk.height[j] !== level || ((chunk.water[j] as number) & WATER_DEPTH_MASK) !== 0) return false;
    }
  }
  return true;
}

/**
 * Whether any tile of `chunk` carries `terrain` in one of `biomes` (null: any biome) – the ground a decor rule can stand
 * on (M7-61). Without it the rule's cells need not be drawn: the meadow and beach rules hash a chunk's 25–64 cells and
 * their tufts only to drop them all where the chunk has no Grünhain grass or Salzküste sand (every chunk of the other
 * biomes; measured 0.3–0.8 ms more per chunk list without the check).
 */
function groundOfRuleIn(chunk: ChunkData, terrain: number, biomes: Uint8Array | null): boolean {
  const ground = chunk.ground;
  for (let i = 0; i < ground.length; i++) {
    if (ground[i] === terrain && (biomes === null || biomes[chunk.biome[i] as number] === 1)) return true;
  }
  return false;
}

/**
 * Breath of an emissive plant (M5-23, glowing mushrooms): extra emission at `time` for phase `phase` (0…1) in hard
 * steps – rising and falling over `SURFACE_PARAMS.glow.periodSeconds`, never a smooth ramp.
 */
export function glowBreath(time: number, phase: number): number {
  const g = SURFACE_PARAMS.glow;
  const p = time / g.periodSeconds + phase;
  const wave = 0.5 - 0.5 * Math.cos((p - Math.floor(p)) * Math.PI * 2);
  return (Math.round(wave * g.steps) / g.steps) * g.boost;
}

/**
 * Anchor of the object `def` on tile (tx, ty) [world px]: centred on its footprint, jittered by the
 * tile hash (the same spot every frame and for every view of it, e.g. the falling tree of M3-11) – a place's
 * built pieces (walls, towers, chests; `jitter` false, M7-07) stand exactly on their tiles.
 */
export function objectAnchor(def: Pick<ObjectDef, 'blocking' | 'footprintW' | 'jitter'>, tx: number, ty: number, out: { x: number; y: number }): { x: number; y: number } {
  const jx = !def.jitter ? 0 : def.blocking ? OBJECT_JITTER.blockingX : OBJECT_JITTER.looseX;
  const jy = !def.jitter ? 0 : def.blocking ? OBJECT_JITTER.blockingY : OBJECT_JITTER.looseY;
  // The tile hash through its register: no fractional number returned by a call (M7-115).
  tileHashInto(tx, ty, SALT_X);
  out.x = tx * TILE_PX + (def.footprintW * TILE_PX) / 2 + Math.round(((TILE_HASH[0] as number) * 2 - 1) * jx);
  tileHashInto(tx, ty, SALT_Y);
  out.y = ty * TILE_PX + ANCHOR_ROW - Math.round((TILE_HASH[0] as number) * jy);
  return out;
}

/** The view rectangle objects are pushed for [world px] and the canopy fade circle around the focus. */
export interface ObjectView {
  readonly layer: Layer;
  readonly chunks: { get(layer: Layer, cx: number, cy: number): ChunkData | undefined };
  readonly signatures: ChunkSignatures;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Canopy fade: focus (world px) and radius (0 = off). */
  fadeX: number;
  fadeY: number;
  fadeRadius: number;
}

class ChunkObjects {
  count = 0;
  signature = -1;
  season = -1;
  x: Float32Array = new Float32Array(INITIAL_OBJECTS);
  y: Float32Array = new Float32Array(INITIAL_OBJECTS);
  base: Float32Array = new Float32Array(INITIAL_OBJECTS);
  phase: Float32Array = new Float32Array(INITIAL_OBJECTS);
  def: Uint16Array = new Uint16Array(INITIAL_OBJECTS);
  frame: Uint16Array = new Uint16Array(INITIAL_OBJECTS);
  row: Uint8Array = new Uint8Array(INITIAL_OBJECTS);
  mirror: Uint8Array = new Uint8Array(INITIAL_OBJECTS);
  /** Local tile index of the anchor (outline). */
  index: Uint16Array = new Uint16Array(INITIAL_OBJECTS);
  /** 1 = a felled tree: its stump is drawn; 2 = a planted tree still growing: its sapling is drawn (M7-23). */
  stump: Uint8Array = new Uint8Array(INITIAL_OBJECTS);
  /** Biome runtime id of the tile (palette rows of other seasons during a change, M5-19). */
  biome: Uint8Array = new Uint8Array(INITIAL_OBJECTS);
  /** 1 = the frame is the season's (not harvested, no scatter variant): it changes with the season. */
  seasonal: Uint8Array = new Uint8Array(INITIAL_OBJECTS);
  /** Ground decor (M3-40): anchor [world px], rule (`tables.decorDefs`), sprite frame, palette row, wind phase. */
  decorCount = 0;
  decorX: Float32Array = new Float32Array(INITIAL_DECOR);
  decorY: Float32Array = new Float32Array(INITIAL_DECOR);
  decorBase: Float32Array = new Float32Array(INITIAL_DECOR);
  decorPhase: Float32Array = new Float32Array(INITIAL_DECOR);
  decorDef: Uint8Array = new Uint8Array(INITIAL_DECOR);
  decorFrame: Uint16Array = new Uint16Array(INITIAL_DECOR);
  decorRow: Uint8Array = new Uint8Array(INITIAL_DECOR);
  decorMirror: Uint8Array = new Uint8Array(INITIAL_DECOR);

  /** Room for one more decor entry. */
  growDecor(): void {
    if (this.decorCount < this.decorX.length) return;
    const cap = this.decorX.length * 2;
    const f = (a: Float32Array): Float32Array => {
      const b = new Float32Array(cap);
      b.set(a);
      return b;
    };
    this.decorX = f(this.decorX);
    this.decorY = f(this.decorY);
    this.decorBase = f(this.decorBase);
    this.decorPhase = f(this.decorPhase);
    const u8 = (a: Uint8Array): Uint8Array => {
      const b = new Uint8Array(cap);
      b.set(a);
      return b;
    };
    this.decorDef = u8(this.decorDef);
    this.decorRow = u8(this.decorRow);
    this.decorMirror = u8(this.decorMirror);
    const frame = new Uint16Array(cap);
    frame.set(this.decorFrame);
    this.decorFrame = frame;
  }

  reserve(n: number): void {
    if (n <= this.x.length) return;
    let cap = this.x.length;
    while (cap < n) cap *= 2;
    const f = (a: Float32Array): Float32Array => {
      const b = new Float32Array(cap);
      b.set(a);
      return b;
    };
    this.x = f(this.x);
    this.y = f(this.y);
    this.base = f(this.base);
    this.phase = f(this.phase);
    const u16 = (a: Uint16Array): Uint16Array => {
      const b = new Uint16Array(cap);
      b.set(a);
      return b;
    };
    this.def = u16(this.def);
    this.frame = u16(this.frame);
    this.index = u16(this.index);
    const u8 = (a: Uint8Array): Uint8Array => {
      const b = new Uint8Array(cap);
      b.set(a);
      return b;
    };
    this.row = u8(this.row);
    this.mirror = u8(this.mirror);
    this.stump = u8(this.stump);
    this.biome = u8(this.biome);
    this.seasonal = u8(this.seasonal);
  }
}

/** Counters of the object layer (`worldInfo`, tests). */
export interface ObjectStats {
  /** Sprites pushed in the last frame. */
  pushed: number;
  /** Object lists (re)built since the start. */
  builds: number;
  /** Objects within the pushed rectangle whose crown fades around the focus. */
  faded: number;
  /** Ground decor sprites pushed in the last frame (M3-40). */
  decor: number;
}

export class WorldObjectLayer {
  readonly stats: ObjectStats = { pushed: 0, builds: 0, faded: 0, decor: 0 };
  private readonly lists = new WeakMap<ChunkData, ChunkObjects>();
  /** Season index (`SEASON_IDS`) the lists show. */
  season = 1;
  /** Outlined objects: packed chunk id and anchor index per slot (−1 = free). */
  private readonly highlightChunk = new Float64Array(HIGHLIGHT_SLOTS).fill(-1);
  private readonly highlightIndex = new Int32Array(HIGHLIGHT_SLOTS).fill(-1);
  private readonly anchor = { x: 0, y: 0 };
  private readonly tufts: DecorTuft[] = [];
  private readonly cells = { gx0: 0, gy0: 0, gx1: 0, gy1: 0 };
  /** Grass bend per object runtime id (`SURFACE_PARAMS.grass.bendByKind` of its kind) and whether it glows. */
  private readonly bendOf: Float32Array;
  private readonly glows: Uint8Array;

  constructor(readonly tables: WorldRenderTables) {
    this.bendOf = new Float32Array(tables.objects.length);
    this.glows = new Uint8Array(tables.objects.length);
    tables.objects.forEach((def, i) => {
      if (def === null) return;
      const kind = WORLD_OBJECTS.find((o) => o.id === def.id)?.kind ?? '';
      this.bendOf[i] = def.wind > 0 ? (SURFACE_PARAMS.grass.bendByKind[kind] ?? 0) : 0;
      this.glows[i] = def.sprite.emissive ? 1 : 0;
    });
  }

  /** Outlines the object anchored at (tx, ty) in highlight `slot` (chunk id and local index from the anchor tile); −1 clears it. */
  setHighlight(slot: number, chunkId: number, index: number): void {
    if (slot < 0 || slot >= HIGHLIGHT_SLOTS) throw new RangeError(`Objekt-Umriss: Platz ${slot} gibt es nicht`);
    this.highlightChunk[slot] = chunkId;
    this.highlightIndex[slot] = index;
  }

  /** The object list of `chunk`, rebuilt if its content or the season changed. */
  listOf(chunk: ChunkData, signatures: ChunkSignatures): ChunkObjects {
    let list = this.lists.get(chunk);
    if (list === undefined) {
      list = new ChunkObjects();
      this.lists.set(chunk, list);
    }
    const sig = signatures.of(chunk);
    if (list.signature !== sig || list.season !== this.season) {
      this.build(chunk, list);
      list.signature = sig;
      list.season = this.season;
    }
    return list;
  }

  private build(chunk: ChunkData, out: ChunkObjects): void {
    const t = this.tables;
    let n = 0;
    for (let i = 0; i < chunk.object.length; i++) if ((chunk.object[i] as number) !== 0) n++;
    out.reserve(n);
    n = 0;
    const x0 = chunk.cx * CHUNK_TILES;
    const y0 = chunk.cy * CHUNK_TILES;
    for (let i = 0; i < chunk.object.length; i++) {
      const id = chunk.object[i] as number;
      if (id === 0) continue;
      const def = t.objects[id];
      if (def === undefined || def === null) throw new Error(`Welt-Darstellung: Laufzeit-Objekt ${id} in Chunk ${chunk.key} ist unbekannt`);
      const tx = x0 + (i % CHUNK_TILES);
      const ty = y0 + Math.floor(i / CHUNK_TILES);
      objectAnchor(def, tx, ty, this.anchor);
      out.x[n] = this.anchor.x;
      out.y[n] = this.anchor.y;
      out.index[n] = i;
      const state = chunk.objectState.get(i);
      out.stump[n] = def.stump !== null && isStump(state) ? 1 : def.sapling !== null && state !== undefined && isSapling(state.growth) ? 2 : 0;
      out.base[n] = (chunk.layer === 0 ? (chunk.height[i] as number) : 0) * WAND_PX_JE_STUFE;
      tileHashInto(tx, ty, SALT_PHASE);
      out.phase[n] = (TILE_HASH[0] as number) * FULL_TURN;
      out.def[n] = id;
      out.frame[n] = this.frameOf(def, chunk, i, tx, ty);
      out.row[n] = t.objectRow(def, this.season, chunk.biome[i] as number);
      out.biome[n] = chunk.biome[i] as number;
      out.seasonal[n] = out.stump[n] === 0 && this.frameIsSeasonal(def, chunk, i) ? 1 : 0;
      out.mirror[n] = def.mirror && tileHashBit(tx, ty, SALT_MIRROR) === 1 ? 1 : 0;
      n++;
    }
    out.count = n;
    this.buildDecor(chunk, out);
    this.stats.builds++;
  }

  /**
   * The ground decor of `chunk` (M3-40): the tufts of every cluster whose anchor lies in the chunk and on its rule's ground,
   * in the rule's biomes and seasons (M7-61).
   */
  private buildDecor(chunk: ChunkData, out: ChunkObjects): void {
    out.decorCount = 0;
    const t = this.tables;
    if (chunk.layer !== 0 || t.decorDefs.length === 0) return;
    const x0 = chunk.cx * CHUNK_PX;
    const y0 = chunk.cy * CHUNK_PX;
    for (let r = 0; r < t.decorDefs.length; r++) {
      const def = t.decorDefs[r];
      if (def === undefined) continue;
      // Out of its season the rule shows nothing (M7-61: no meadow flowers in autumn and winter); the lists are rebuilt
      // when the season changes.
      if (this.season >= 0 && (def.seasonMask & (1 << this.season)) === 0) continue;
      const biomes = def.biomes;
      const wildOnly = def.rule.wildOnly === true;
      const terrain = t.ids.terrain.runtimeId(def.rule.terrain);
      if (!groundOfRuleIn(chunk, terrain, biomes)) continue;
      const c = this.cells;
      cellsCovering(def.rule, x0, y0, x0 + CHUNK_PX, y0 + CHUNK_PX, c);
      for (let gy = c.gy0; gy <= c.gy1; gy++) {
        for (let gx = c.gx0; gx <= c.gx1; gx++) {
          const n = tuftsOfCell(def.rule, gx, gy, this.tufts);
          for (let k = 0; k < n; k++) {
            const tuft = this.tufts[k] as DecorTuft;
            const lx = tuft.x - x0;
            const ly = tuft.y - y0;
            // The tuft belongs to the chunk its anchor lies in, and stands only on its own dry, free ground.
            if (lx < 0 || ly < 0 || lx >= CHUNK_PX || ly >= CHUNK_PX) continue;
            const i = Math.floor(ly / TILE_PX) * CHUNK_TILES + Math.floor(lx / TILE_PX);
            if (chunk.ground[i] !== terrain || ((chunk.water[i] as number) & WATER_DEPTH_MASK) !== 0 || chunk.object[i] !== 0) continue;
            // Only in the rule's biomes (M7-61): the tile's own biome, so a transition strip mixes the decor like its ground.
            if (biomes !== null && biomes[chunk.biome[i] as number] !== 1) continue;
            if (wildOnly && !wildGroundAt(chunk, i)) continue;
            out.growDecor();
            const d = out.decorCount++;
            out.decorX[d] = tuft.x;
            out.decorY[d] = tuft.y;
            out.decorBase[d] = (chunk.height[i] as number) * WAND_PX_JE_STUFE;
            // The tuft's whole pixel as small integers into the hash calls (its fields may hold doubles; ToInt32 inside the
            // hash makes them the same numbers – M7-115).
            const hx = tuft.x | 0;
            const hy = tuft.y | 0;
            tileHashInto(hx, hy, SALT_PHASE);
            out.decorPhase[d] = (TILE_HASH[0] as number) * FULL_TURN;
            out.decorDef[d] = r;
            out.decorFrame[d] = def.frames[tuft.size] ?? 0;
            out.decorRow[d] = t.biomeRow[chunk.biome[i] as number] ?? 0;
            out.decorMirror[d] = def.sprite.symmetric && tileHashBit(hx, hy, SALT_MIRROR) === 1 ? 1 : 0;
          }
        }
      }
    }
  }

  /** Whether the object's frame is its season's (it changes with the season, M5-19). */
  private frameIsSeasonal(def: ObjectDef, chunk: ChunkData, i: number): boolean {
    const state = chunk.objectState.get(i);
    if (state !== undefined && state.regrowAtTick !== NO_REGROW_TICK && def.harvestedFrame >= 0) return false;
    return def.variants <= 1;
  }

  private frameOf(def: ObjectDef, chunk: ChunkData, i: number, tx: number, ty: number): number {
    const state = chunk.objectState.get(i);
    if (state !== undefined && state.regrowAtTick !== NO_REGROW_TICK && def.harvestedFrame >= 0) return def.harvestedFrame;
    if (def.variants > 1) {
      tileHashInto(tx, ty, SALT_VARIANT);
      return Math.min(def.variants - 1, Math.floor((TILE_HASH[0] as number) * def.variants));
    }
    return def.seasonFrames[this.season] ?? 0;
  }

  /** Pushes the objects inside `view` (plus their sprite extents) into `scene.sprites`; returns the count. */
  emit(scene: RenderScene, view: ObjectView): number {
    const t = this.tables;
    const s = this.stats;
    s.pushed = 0;
    s.faded = 0;
    s.decor = 0;
    const d = scene.sprite;
    const cx0 = Math.floor(view.left / CHUNK_PX);
    const cx1 = Math.floor(view.right / CHUNK_PX);
    const cy0 = Math.floor(view.top / CHUNK_PX);
    const cy1 = Math.floor(view.bottom / CHUNK_PX);
    const fadeR = view.fadeRadius;
    const surface = scene.surface;
    const outdoors = view.layer === 0;
    const time = scene.time;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = view.chunks.get(view.layer, cx, cy);
        if (chunk === undefined) continue;
        const list = this.listOf(chunk, view.signatures);
        const h0 = this.highlightChunk[0] === chunk.id ? (this.highlightIndex[0] as number) : -1;
        const h1 = this.highlightChunk[1] === chunk.id ? (this.highlightIndex[1] as number) : -1;
        for (let k = 0; k < list.count; k++) {
          const def = t.objects[list.def[k] as number];
          if (def === undefined || def === null) continue;
          const x = list.x[k] as number;
          const y = list.y[k] as number;
          if (x + def.halfWidth < view.left || x - def.halfWidth > view.right || y < view.top || y - def.top > view.bottom) continue;
          const stump = list.stump[k] === 1 && def.stump !== null ? def.stump : list.stump[k] === 2 && def.sapling !== null ? def.sapling : null;
          const frame = (stump === null ? def.sprite.frames[list.frame[k] as number] : stump.frames[0]) as SpriteFrameRef;
          d.reset();
          d.frame = frame;
          d.x = x;
          d.y = y;
          d.layer = def.layer;
          d.paletteRow = list.row[k] as number;
          d.mirror = list.mirror[k] === 1;
          d.heightBase = list.base[k] as number;
          d.windAmplitude = stump === null || list.stump[k] === 2 ? def.wind : 0;
          d.windPhase = list.phase[k] as number;
          d.outline = list.index[k] === h0 || list.index[k] === h1;
          // World surface: snow and rain on outdoor objects, grass bent by figures, glowing plants breathing.
          d.weathered = outdoors;
          d.bend = stump === null ? (this.bendOf[list.def[k] as number] as number) : 0;
          if (this.glows[list.def[k] as number] === 1) d.emissiveBoost = glowBreath(time, (list.phase[k] as number) / FULL_TURN);
          if (stump === null && def.canopy && fadeR > 0 && y > view.fadeY && Math.abs(x - view.fadeX) < def.halfWidth + fadeR && y - def.top < view.fadeY + fadeR) {
            d.canopyFade = true;
            s.faded++;
          }
          if (stump === null && surface.seasonTo >= 0) s.pushed += this.pushSeasonChange(scene, d, def, list, k, surface.seasonFrom, surface.seasonTo, surface.seasonProgress);
          else {
            scene.sprites.push(d);
            s.pushed++;
          }
        }
        for (let k = 0; k < list.decorCount; k++) {
          const def = t.decorDefs[list.decorDef[k] as number];
          if (def === undefined) continue;
          const x = list.decorX[k] as number;
          const y = list.decorY[k] as number;
          if (x + def.halfWidth < view.left || x - def.halfWidth > view.right || y < view.top || y - def.top > view.bottom) continue;
          d.reset();
          d.frame = def.sprite.frames[list.decorFrame[k] as number] as SpriteFrameRef;
          d.x = x;
          d.y = y;
          d.layer = 'ground';
          d.paletteRow = list.decorRow[k] as number;
          d.mirror = list.decorMirror[k] === 1;
          d.heightBase = list.decorBase[k] as number;
          d.windAmplitude = def.rule.wind;
          d.windPhase = list.decorPhase[k] as number;
          d.weathered = outdoors;
          d.bend = SURFACE_PARAMS.grass.bendByKind[DECOR_BEND_KIND] ?? 0;
          scene.sprites.push(d);
          s.pushed++;
          s.decor++;
        }
      }
    }
    return s.pushed;
  }

  /**
   * An object during a change of seasons (M5-19; `d` holds everything but frame and rows): with one frame for both
   * seasons its leaves turn to the new palette row pixel by pixel; when the frames differ (a deciduous tree and its
   * bare winter frame) the bare frame stands below and the leafy one on top sheds (or grows) its canopy pixels.
   * Returns the sprites pushed.
   */
  private pushSeasonChange(scene: RenderScene, d: SpriteDesc, def: ObjectDef, list: ChunkObjects, k: number, from: number, to: number, progress: number): number {
    const t = this.tables;
    const biome = list.biome[k] as number;
    const seasonal = list.seasonal[k] === 1;
    const own = list.frame[k] as number;
    const frameFrom = seasonal ? (def.seasonFrames[from] ?? own) : own;
    const frameTo = seasonal ? (def.seasonFrames[to] ?? own) : own;
    const rowFrom = t.objectRow(def, from, biome);
    const rowTo = t.objectRow(def, to, biome);
    if (frameFrom === frameTo) {
      d.frame = def.sprite.frames[frameFrom] as SpriteFrameRef;
      d.paletteRow = rowFrom;
      if (rowTo !== rowFrom) {
        d.paletteRow2 = rowTo;
        d.rowBlend = progress;
      }
      scene.sprites.push(d);
      return 1;
    }
    // Bare below, leafy on top: into winter the leaves fall, out of it they bud.
    const growing = from === WINTER;
    const baseFrame = growing ? frameFrom : frameTo;
    const baseRow = growing ? rowFrom : rowTo;
    d.frame = def.sprite.frames[baseFrame] as SpriteFrameRef;
    d.paletteRow = baseRow;
    scene.sprites.push(d);
    d.frame = def.sprite.frames[growing ? frameTo : frameFrom] as SpriteFrameRef;
    d.paletteRow = growing ? rowTo : rowFrom;
    d.shed = true;
    d.rowBlend = growing ? 1 - progress : progress;
    scene.sprites.push(d);
    return 2;
  }
}
