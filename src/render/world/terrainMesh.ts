/**
 * Static terrain mesh of one world chunk (M2-28, MASTERPROMPT §6.1 pass 1, docs/RENDER.md §3
 * `tilemap/chunkMesh.ts`): one 16-byte instance per drawn 16×16 frame, built on the CPU only when
 * the chunk or a neighbour changed (`terrainPass.ts`) and kept on the GPU as a static buffer.
 *
 * Per tile, bottom to top (instances of one tile are consecutive, so the draw order stacks them):
 * 1. **Ground** after the transition rule of the autotiler (`Uebergaenge.ebenen`, docs/ART.md §3):
 *    the lowest terrain of the 3×3 neighbourhood as full tile, each higher one as blob overlay. Full
 *    tiles pick a weighted variant by tile hash (terrain content `tileset`); layers under the
 *    topmost full tile are hidden and skipped. Water tiles show `meeresgrund` (frozen water `eis`),
 *    whose frames carry the shallow bank towards the shore.
 * 2. **Cliffs** on the surface (`klippenFrames`): rim frames on plateau tiles, wall, ramp or stairs
 *    pieces 16 px per level on the tiles south of an edge, from `tileset_klippe_<gruppe>` of the
 *    plateau's biome. Where a river runs over the edge, the wall piece is a waterfall (the water
 *    frame, streaked and scrolled by the shader). Underground, solid rock stands in place: a rock
 *    tile over rock shows its (darkened) top with a rim, a rock tile over open floor its 16 px face –
 *    exactly the tiles the collision blocks.
 *
 * | Byte | Attribute (location) | Type | Content |
 * |---|---|---|---|
 * | 0 | aTile (1) | u8×4 → uvec4 | tile x, tile y in the chunk, palette row, flags (bit 0 mirror, bit 1 water) |
 * | 4 | aRect (2) | u16×2 → uvec2 | atlas x, y of the 16×16 frame |
 * | 8 | aShade (3) | u8×4 → uvec4 | level + kind, ambient occlusion edges, water depth corners, wall row |
 * | 12 | aBlend (4) | u8×4 → uvec4 | palette row of the neighbouring biome, neighbours with that row (AO bit order), 0, 0 |
 *
 * `aShade` is the height field the shader shades from (tiles have flat normals): the level gives the
 * G-buffer height (16 px per level), wall pieces get a south-facing normal and a height falling from
 * the edge to the foot, tiles at the foot or beside higher ground get ambient occlusion towards those
 * edges (palette ramp steps, Bayer-dithered), water gets darker with its distance to the shore.
 * `aBlend` dissolves the biome border: where a neighbour carries another biome row (the dithered
 * transition strips of the world, WORLD.md §2), pixels near that edge take its row with a Bayer-
 * dithered probability – no tile-sized colour squares between two tints of the same ground.
 */
import { WATER_DEPTH_DEEP, WATER_DEPTH_MASK, WATER_FROZEN, TILE_FLAG_RAMP, TILE_FLAG_STAIRS } from '../../world/model/chunk';
import {
  BLOB_VOLL,
  MAX_HOEHENSTUFE,
  blobIndex,
  KLIPPE_FRAME,
  klippenFrames,
  RICHTUNGEN,
  UEBERGANG,
  VERSATZ,
  WAND_SPALTE,
  WAND_VARIANTE_ANTEIL,
  WAND_ZEILE,
  wandAn,
  wandFrame,
  type KachelEbene,
  type KlippenUmgebung,
} from '../../world/autotile';
import { CHUNK_TILES } from '../tilemap/chunk';
import { tileHash01 } from '../tilemap/tileSet';
import { BLOB_FRAMES, CLIFF_FRAMES, MAX_VARIANTS, TERRAIN_FRAME_SLOTS, type WorldRenderTables } from './tables';
import { ChunkWindow, WINDOW_H, WINDOW_MARGIN, WINDOW_W, type ChunkLookup } from './window';
import type { ChunkData } from '../../world/model/chunk';

export const TERRAIN_INSTANCE_STRIDE = 16;
/** Byte offsets of the instance attributes. */
export const TERRAIN_OFFSET = { tile: 0, rect: 4, shade: 8, blend: 12 } as const;
/** Attribute locations (`layout(location = …)` in terrain.vert). */
export const TERRAIN_LOCATION = { corner: 0, tile: 1, rect: 2, shade: 3, blend: 4 } as const;
/** Instance flags (aTile.w). */
export const TERRAIN_FLAG = { mirror: 1, water: 2 } as const;
/** What an instance is (aShade.x bits 3–6). */
export const TERRAIN_KIND = { ground: 0, rim: 1, wall: 2, ramp: 3, stairs: 4, rockTop: 5, waterfall: 6 } as const;
/** aShade.x: level in bits 0–2, kind from bit 3. */
export const LEVEL_MASK = 0b111;
export const KIND_SHIFT = 3;
/** Ambient occlusion bits (aShade.y): the neighbour on that side stands higher (wall, plateau, rock). */
export const AO_BIT = { n: 1, e: 2, s: 4, w: 8, ne: 16, se: 32, sw: 64, nw: 128 } as const;
/** aShade.z: water depth 0…3 at the corners NW (bits 0–1), NE (2–3), SW (4–5), SE (6–7). */
export const CORNER_BITS = 2;
export const MAX_WATER_DEPTH = 3;
/** aShade.w: wall row (1 = under the edge) in bits 0–2, wall height in levels in bits 3–5. */
export const WALL_ROW_MASK = 0b111;
export const WALL_HEIGHT_SHIFT = 3;
/** Rock top underground: its level (a rock mass is one level high). */
export const ROCK_LEVEL = 1;

/** Wall code of the window: row | height << 3 | art << 6 (0 = no wall). */
const WALL_ART_SHIFT = 6;
const WALL_HEIGHT_MASK = 0b111;
/** Salt of the cliff variant hash (independent of the ground variant). */
const CLIFF_HASH_SALT = 0x5bd1e995;
const MIRROR_HASH_SALT = 0x2c1b3c6d;
const UINT32 = 2 ** 32;
/** Instances a chunk may need before the scratch grows (ground + overlays + cliffs). */
const INITIAL_INSTANCES = CHUNK_TILES * CHUNK_TILES * 2;
/** Window index offset of each neighbour in `RICHTUNGEN` order (the tiles 0…31 and their ring lie inside the window margins). */
const NEIGHBOUR_DELTA: Int32Array = Int32Array.from(RICHTUNGEN, (r) => VERSATZ[r][1] * WINDOW_W + VERSATZ[r][0]);
const ROW = WINDOW_W;
/** Blend mask bit per neighbour in `RICHTUNGEN` order (the AO bit layout: N, E, S, W, then NE, SE, SW, NW). */
const BLEND_BIT: readonly number[] = RICHTUNGEN.map((r) => AO_BIT[r.toLowerCase() as keyof typeof AO_BIT]);
/** Water that is not frozen. */
const WATER_OPEN = (water: number): boolean => (water & WATER_DEPTH_MASK) !== 0 && (water & WATER_FROZEN) === 0;

/** A built mesh: `count` instances in `data` (exactly `count × TERRAIN_INSTANCE_STRIDE` bytes). */
export interface TerrainMeshData {
  readonly count: number;
  readonly data: Uint8Array;
}

/** Cliff environment of the window for the autotiler (offsets relative to the tile `(x, y)`). */
class WindowCliffs implements KlippenUmgebung {
  x = 0;
  y = 0;

  constructor(
    private readonly level: Uint8Array,
    private readonly flags: Uint8Array,
  ) {}

  hoehe(dx: number, dy: number): number {
    return this.level[ChunkWindow.clamped(this.x + dx, this.y + dy)] as number;
  }

  uebergang(dx: number, dy: number): number {
    const f = this.flags[ChunkWindow.clamped(this.x + dx, this.y + dy)] as number;
    return (f & TILE_FLAG_RAMP) !== 0 ? UEBERGANG.rampe : (f & TILE_FLAG_STAIRS) !== 0 ? UEBERGANG.treppe : UEBERGANG.keiner;
  }
}

/** Builds terrain meshes; one builder serves every chunk (scratch arrays are reused). */
export class TerrainMeshBuilder {
  readonly window = new ChunkWindow();
  private readonly terrain = new Uint8Array(WINDOW_W * WINDOW_H);
  private readonly level = new Uint8Array(WINDOW_W * WINDOW_H);
  private readonly wall = new Uint8Array(WINDOW_W * WINDOW_H);
  private readonly depth = new Uint8Array(WINDOW_W * WINDOW_H);
  private readonly rock = new Uint8Array(WINDOW_W * WINDOW_H);
  private readonly cliffs = new WindowCliffs(this.level, this.window.flags);
  private readonly layers: KachelEbene[] = [];
  private readonly neighbours = new Int32Array(RICHTUNGEN.length);
  private readonly frames: number[] = [];
  private scratch = new Uint8Array(INITIAL_INSTANCES * TERRAIN_INSTANCE_STRIDE);
  private scratch16 = new Uint16Array(this.scratch.buffer);
  private count = 0;
  private underground = false;
  /** Biome blend of the tile being emitted (written into every instance of the tile). */
  private blendRow = 0;
  private blendMask = 0;

  constructor(readonly tables: WorldRenderTables) {}

  /** Builds the mesh of `chunk` with its neighbours from `lookup` (see `ChunkWindow`). */
  build(chunk: ChunkData, lookup: ChunkLookup): TerrainMeshData {
    this.window.fill(chunk, lookup);
    this.underground = chunk.layer !== 0;
    this.derive();
    this.count = 0;
    const x0 = chunk.cx * CHUNK_TILES;
    const y0 = chunk.cy * CHUNK_TILES;
    for (let y = 0; y < CHUNK_TILES; y++) for (let x = 0; x < CHUNK_TILES; x++) this.emitTile(x, y, x0 + x, y0 + y);
    return { count: this.count, data: this.scratch.slice(0, this.count * TERRAIN_INSTANCE_STRIDE) };
  }

  // --- derived window fields --------------------------------------------------------------------

  private derive(): void {
    const w = this.window;
    const t = this.tables;
    for (let i = 0; i < WINDOW_W * WINDOW_H; i++) {
      const water = w.water[i] as number;
      const open = WATER_OPEN(water);
      this.terrain[i] = (water & WATER_DEPTH_MASK) === 0 ? (w.ground[i] as number) : open ? t.waterTerrain : t.iceTerrain;
      this.level[i] = this.underground ? 0 : (w.height[i] as number);
      this.rock[i] = this.underground && (w.solid[i] as number) !== 0 ? 1 : 0;
      this.depth[i] = open ? ((water & WATER_DEPTH_MASK) === WATER_DEPTH_DEEP ? 2 : 1) : 0;
    }
    this.shoreDistance();
    this.wall.fill(0);
    if (this.underground) return;
    const c = this.cliffs;
    for (let y = -1; y <= CHUNK_TILES; y++) {
      for (let x = -1; x <= CHUNK_TILES; x++) {
        // A wall needs higher ground within the rows above (at most one row per level).
        const at = ChunkWindow.index(x, y);
        const own = this.level[at] as number;
        let higher = false;
        for (let k = 1; k <= MAX_HOEHENSTUFE && !higher; k++) higher = (this.level[at - k * ROW] as number) > own;
        if (!higher) continue;
        c.x = x;
        c.y = y;
        const s = wandAn(c);
        if (s !== null) this.wall[ChunkWindow.index(x, y)] = s.stufe | (s.stufen << WALL_HEIGHT_SHIFT) | (s.art << WALL_ART_SHIFT);
      }
    }
  }

  /** Whether the tile's 3×3 neighbourhood has one level, no wall and (with `terrain`) one terrain. */
  private uniform(x: number, y: number, terrain: boolean): boolean {
    const i = ChunkWindow.index(x, y);
    const level = this.level[i] as number;
    const t = this.terrain[i] as number;
    for (let k = 0; k < NEIGHBOUR_DELTA.length; k++) {
      const j = i + (NEIGHBOUR_DELTA[k] as number);
      if (this.level[j] !== level || this.wall[j] !== 0 || this.rock[j] !== 0) return false;
      if (terrain && this.terrain[j] !== t) return false;
    }
    return this.wall[i] === 0 && this.rock[i] === 0;
  }

  /** Water depth 1…3 grows with the distance to the shore (Chebyshev, three rings), at least the tile's own depth. */
  private shoreDistance(): void {
    const d = this.depth;
    for (let pass = 1; pass < MAX_WATER_DEPTH; pass++) {
      for (let y = -WINDOW_MARGIN.north; y < CHUNK_TILES + WINDOW_MARGIN.south; y++) {
        for (let x = -WINDOW_MARGIN.west; x < CHUNK_TILES + WINDOW_MARGIN.east; x++) {
          const i = ChunkWindow.index(x, y);
          const own = d[i] as number;
          if (own === 0 || own > pass) continue;
          let deeper = true;
          for (let k = 0; k < RICHTUNGEN.length && deeper; k++) {
            const [dx, dy] = VERSATZ[RICHTUNGEN[k] ?? 'N'];
            if ((d[ChunkWindow.clamped(x + dx, y + dy)] as number) < pass) deeper = false;
          }
          if (deeper) d[i] = pass + 1;
        }
      }
    }
  }

  // --- per tile ---------------------------------------------------------------------------------

  private emitTile(x: number, y: number, tx: number, ty: number): void {
    const w = this.window;
    const t = this.tables;
    const i = ChunkWindow.index(x, y);
    const biome = w.biome[i] as number;
    const row = t.biomeRow[biome] ?? 0;
    const level = this.level[i] as number;
    const rock = this.rock[i] === 1;
    const rockTop = rock && this.rock[i + ROW] === 1;
    const wall = this.wall[i] as number;
    const flat = this.uniform(x, y, false);
    const ao = rock || wall !== 0 || flat ? 0 : this.occlusion(x, y, level);
    const corners = this.terrain[i] === t.waterTerrain ? this.waterCorners(x, y) : 0;
    this.biomeBlend(i, row);
    const groundKind = rockTop ? TERRAIN_KIND.rockTop : TERRAIN_KIND.ground;
    const groundLevel = rockTop ? ROCK_LEVEL : level;
    this.emitGround(x, y, tx, ty, row, groundKind, groundLevel, ao, corners);
    const group = t.biomeCliff[biome] ?? 0;
    if (this.underground) {
      if (rockTop) this.emitRockRim(x, y, row, group);
      else if (rock) this.emitRockFace(x, y, tx, ty, row, group);
      return;
    }
    // Cliff pieces only where levels meet or a ramp/stairs flag opens an edge.
    if (flat && ((w.flags[i] as number) & (TILE_FLAG_RAMP | TILE_FLAG_STAIRS)) === 0) return;
    const c = this.cliffs;
    c.x = x;
    c.y = y;
    const n = klippenFrames(c, tileHash01(tx, ty, CLIFF_HASH_SALT), this.frames);
    for (let k = 0; k < n; k++) {
      const f = this.frames[k] ?? 0;
      let kind: number = TERRAIN_KIND.rim;
      let wallRow = 0;
      let cliffGroup = group;
      if (wall !== 0 && k === 0) {
        const art = wall >> WALL_ART_SHIFT;
        kind = art === UEBERGANG.rampe ? TERRAIN_KIND.ramp : art === UEBERGANG.treppe ? TERRAIN_KIND.stairs : TERRAIN_KIND.wall;
        wallRow = wall & ((1 << WALL_ART_SHIFT) - 1);
        // The wall shows the rock of the plateau it belongs to.
        const edge = i - (wall & WALL_ROW_MASK) * ROW;
        cliffGroup = t.biomeCliff[w.biome[edge] as number] ?? group;
        // A river running over the edge falls down the wall: water instead of rock.
        if (kind === TERRAIN_KIND.wall && this.terrain[edge] === t.waterTerrain && this.terrain[i] === t.waterTerrain) {
          const slot = t.waterTerrain * TERRAIN_FRAME_SLOTS + BLOB_FRAMES + this.variant(t.waterTerrain, tx, ty);
          this.push(x, y, row, TERRAIN_FLAG.water, t.terrainFrameX[slot] as number, t.terrainFrameY[slot] as number, level, TERRAIN_KIND.waterfall, 0, 0, wallRow);
          continue;
        }
      }
      this.push(x, y, row, 0, t.cliffFrameX[cliffGroup * CLIFF_FRAMES + f] as number, t.cliffFrameY[cliffGroup * CLIFF_FRAMES + f] as number, level, kind, 0, 0, wallRow);
    }
  }

  private emitGround(x: number, y: number, tx: number, ty: number, row: number, kind: number, level: number, ao: number, corners: number): void {
    const t = this.tables;
    const i = ChunkWindow.index(x, y);
    const mitte = this.terrain[i] as number;
    if (t.hasTileset[mitte] !== 1) return;
    let same = true;
    for (let k = 0; k < NEIGHBOUR_DELTA.length; k++) {
      const nb = this.terrain[i + (NEIGHBOUR_DELTA[k] as number)] as number;
      this.neighbours[k] = nb;
      if (nb !== mitte) same = false;
    }
    let n = 1;
    if (same) {
      // Inside one terrain: a single full tile (the common case, no transition table needed).
      const only = this.layers[0];
      if (only === undefined) this.layers[0] = { terrain: mitte, blob: BLOB_VOLL };
      else {
        only.terrain = mitte;
        only.blob = BLOB_VOLL;
      }
    } else n = t.transitions.ebenen(mitte, this.neighbours, this.layers);
    let start = 0;
    for (let e = 0; e < n; e++) if (this.layers[e]?.blob === BLOB_VOLL) start = e;
    for (let e = start; e < n; e++) {
      const layer = this.layers[e];
      if (layer === undefined) continue;
      const terrain = layer.terrain;
      let frame = layer.blob;
      let mirror = false;
      if (layer.blob === BLOB_VOLL) {
        frame = BLOB_FRAMES + this.variant(terrain, tx, ty);
        mirror = t.variantMirror[terrain] === 1 && (Math.floor(tileHash01(tx, ty, MIRROR_HASH_SALT) * UINT32) & 1) === 1;
      }
      const water = terrain === t.waterTerrain;
      const flags = (mirror ? TERRAIN_FLAG.mirror : 0) | (water ? TERRAIN_FLAG.water : 0);
      const slot = terrain * TERRAIN_FRAME_SLOTS + frame;
      this.push(x, y, row, flags, t.terrainFrameX[slot] as number, t.terrainFrameY[slot] as number, level, kind, ao, water ? corners : 0, 0);
    }
  }

  /** Weighted full-tile variant of `terrain` at world tile (tx, ty). */
  private variant(terrain: number, tx: number, ty: number): number {
    const t = this.tables;
    const n = t.variantCount[terrain] as number;
    const h = tileHash01(tx, ty);
    let v = 0;
    while (v < n - 1 && h >= (t.variantCumulative[terrain * MAX_VARIANTS + v] as number)) v++;
    return v;
  }

  /** Rim of a rock top: open towards every neighbour that is not rock top itself. */
  private emitRockRim(x: number, y: number, row: number, group: number): void {
    let mask = 0;
    const i = ChunkWindow.index(x, y);
    for (let k = 0; k < NEIGHBOUR_DELTA.length; k++) {
      const j = i + (NEIGHBOUR_DELTA[k] as number);
      if (this.rock[j] === 1 && this.rock[j + ROW] === 1) mask |= 1 << k;
    }
    const blob = blobIndex(mask);
    if (blob === BLOB_VOLL) return;
    const f = KLIPPE_FRAME.kante + blob;
    const t = this.tables;
    this.push(x, y, row, 0, t.cliffFrameX[group * CLIFF_FRAMES + f] as number, t.cliffFrameY[group * CLIFF_FRAMES + f] as number, ROCK_LEVEL, TERRAIN_KIND.rim, 0, 0, 0);
  }

  /** The 16 px face of a rock tile over open floor; ends where the rock mass ends. */
  private emitRockFace(x: number, y: number, tx: number, ty: number, row: number, group: number): void {
    const i = ChunkWindow.index(x, y);
    const left = this.rock[i - 1] === 1;
    const right = this.rock[i + 1] === 1;
    const spalte = left && right ? WAND_SPALTE.mitte : left ? WAND_SPALTE.rechts : right ? WAND_SPALTE.links : WAND_SPALTE.einzeln;
    const zeile = WAND_ZEILE.einzeln;
    const f = spalte === WAND_SPALTE.mitte && tileHash01(tx, ty, CLIFF_HASH_SALT) < WAND_VARIANTE_ANTEIL ? KLIPPE_FRAME.wandVariante + zeile : wandFrame(UEBERGANG.keiner, zeile, spalte);
    const t = this.tables;
    this.push(x, y, row, 0, t.cliffFrameX[group * CLIFF_FRAMES + f] as number, t.cliffFrameY[group * CLIFF_FRAMES + f] as number, 0, TERRAIN_KIND.wall, 0, 0, 1 | (1 << WALL_HEIGHT_SHIFT));
  }

  /** The neighbouring biome row the tile blends into and the neighbours that carry it. */
  private biomeBlend(i: number, row: number): void {
    const w = this.window;
    const t = this.tables;
    let other = -1;
    let mask = 0;
    for (let k = 0; k < NEIGHBOUR_DELTA.length; k++) {
      const r = t.biomeRow[w.biome[i + (NEIGHBOUR_DELTA[k] as number)] as number] ?? 0;
      if (r === row) continue;
      if (other < 0) other = r;
      if (r === other) mask |= BLEND_BIT[k] as number;
    }
    this.blendRow = other < 0 ? row : other;
    this.blendMask = mask;
  }

  /** Whether the tile at window index `i` shades its neighbour on `level` (wall, higher ground, rock). */
  private occludes(i: number, level: number): boolean {
    if (this.underground) return this.rock[i] === 1;
    const wall = this.wall[i] as number;
    if (wall !== 0 && wall >> WALL_ART_SHIFT === UEBERGANG.keiner) return true;
    return (this.level[i] as number) > level;
  }

  private occlusion(x: number, y: number, level: number): number {
    const i = ChunkWindow.index(x, y);
    let bits = 0;
    if (this.occludes(i - ROW, level)) bits |= AO_BIT.n;
    if (this.occludes(i + 1, level)) bits |= AO_BIT.e;
    if (this.occludes(i + ROW, level)) bits |= AO_BIT.s;
    if (this.occludes(i - 1, level)) bits |= AO_BIT.w;
    if (this.occludes(i - ROW + 1, level)) bits |= AO_BIT.ne;
    if (this.occludes(i + ROW + 1, level)) bits |= AO_BIT.se;
    if (this.occludes(i + ROW - 1, level)) bits |= AO_BIT.sw;
    if (this.occludes(i - ROW - 1, level)) bits |= AO_BIT.nw;
    return bits;
  }

  /** Water depth at the four corners of tile (x, y): mean of the four tiles sharing each corner. */
  private waterCorners(x: number, y: number): number {
    const d = this.depth;
    const i = ChunkWindow.index(x, y);
    const c = d[i] as number;
    const n = d[i - ROW] as number;
    const s = d[i + ROW] as number;
    const e = d[i + 1] as number;
    const w = d[i - 1] as number;
    const corner = (a: number, b: number, diag: number): number => Math.min(MAX_WATER_DEPTH, Math.round((c + a + b + diag) / 4));
    const nw = corner(n, w, d[i - ROW - 1] as number);
    const ne = corner(n, e, d[i - ROW + 1] as number);
    const sw = corner(s, w, d[i + ROW - 1] as number);
    const se = corner(s, e, d[i + ROW + 1] as number);
    return nw | (ne << CORNER_BITS) | (sw << (2 * CORNER_BITS)) | (se << (3 * CORNER_BITS));
  }

  private push(x: number, y: number, row: number, flags: number, ax: number, ay: number, level: number, kind: number, ao: number, corners: number, wallRow: number): void {
    if ((this.count + 1) * TERRAIN_INSTANCE_STRIDE > this.scratch.length) {
      const grown = new Uint8Array(this.scratch.length * 2);
      grown.set(this.scratch);
      this.scratch = grown;
      this.scratch16 = new Uint16Array(grown.buffer);
    }
    const o = this.count * TERRAIN_INSTANCE_STRIDE;
    const b = this.scratch;
    b[o] = x;
    b[o + 1] = y;
    b[o + 2] = row;
    b[o + 3] = flags;
    const h = (o + TERRAIN_OFFSET.rect) / Uint16Array.BYTES_PER_ELEMENT;
    this.scratch16[h] = ax;
    this.scratch16[h + 1] = ay;
    b[o + TERRAIN_OFFSET.shade] = (level & LEVEL_MASK) | (kind << KIND_SHIFT);
    b[o + TERRAIN_OFFSET.shade + 1] = ao;
    b[o + TERRAIN_OFFSET.shade + 2] = corners;
    b[o + TERRAIN_OFFSET.shade + 3] = wallRow;
    b[o + TERRAIN_OFFSET.blend] = this.blendRow;
    b[o + TERRAIN_OFFSET.blend + 1] = this.blendMask;
    b[o + TERRAIN_OFFSET.blend + 2] = 0;
    b[o + TERRAIN_OFFSET.blend + 3] = 0;
    this.count++;
  }
}

/** Decoded shade bytes of one instance (tests, debug). */
export function decodeShade(shade: ArrayLike<number>): { level: number; kind: number; ao: number; corners: [number, number, number, number]; wallRow: number; wallHeight: number } {
  const x = shade[0] ?? 0;
  const z = shade[2] ?? 0;
  const w = shade[3] ?? 0;
  const m = (1 << CORNER_BITS) - 1;
  return {
    level: x & LEVEL_MASK,
    kind: x >> KIND_SHIFT,
    ao: shade[1] ?? 0,
    corners: [z & m, (z >> CORNER_BITS) & m, (z >> (2 * CORNER_BITS)) & m, (z >> (3 * CORNER_BITS)) & m],
    wallRow: w & WALL_ROW_MASK,
    wallHeight: (w >> WALL_HEIGHT_SHIFT) & WALL_HEIGHT_MASK,
  };
}
