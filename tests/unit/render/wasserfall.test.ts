/**
 * Wasserfälle (M2-28, ADR-0025; M6-Gate-Bildprüfung `biom-gruenhain-tag`, `verderbnis-*`, `wolkenschatten*`: die Fallfläche las
 * sich als waagrechte Bänder ohne Fallstreifen, mitten darauf ein Seegrasbüschel, über der Lippe ein Grasrand – seit M2;
 * src/render/world/waterfall.ts, der Wasserfall-Zweig von shaders/world/terrain.frag, terrainMesh.ts):
 * - das fallende Wasser kommt aus seinem eigenen Muster, nie vom Seegrund der Wasserkachel: nur Stufen der Wasserrampe;
 * - senkrechte Fäden, ein oder zwei Pixel breit, in jeder Zeile mehrere Töne (kein waagrechtes Band), kein Einzelpixel;
 * - das Muster zieht mit der Zeit nach unten; an der Lippe der Kamm, am Fuß ausgefranster Schaum;
 * - die Lippe bleibt offen: die Wasserkachel über dem Wasserfall bekommt keinen Plateaurand, Landkacheln daneben schon;
 * - das Becken darunter spiegelt weder den Fall noch das Becken darüber (mit offener Lippe begann die Spiegelsuche nur neben
 *   den Ufern nah genug – dunkle Keile mit einer Lücke dazwischen); Wasser spiegelt kein Wasser;
 * - Shader und CPU-Spiegel rechnen dieselbe Formel mit denselben Konstanten.
 * Die Reproduktion vorher: der gedrehte Seegrund-Frame eines Motivs bringt Gras- und Steinindizes auf die Fallfläche.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SHADERS } from '../../../src/render/shaderLib';
import { rampIndex } from '../../../src/render/surface/params';
import { terrainDefines } from '../../../src/render/world/shading';
import { BLOB_FRAMES, TERRAIN_FRAME_SLOTS, WorldRenderTables } from '../../../src/render/world/tables';
import { decodeShade, SEABED_MOTIFS, TERRAIN_INSTANCE_STRIDE, TERRAIN_KIND, TERRAIN_OFFSET, TerrainMeshBuilder, type TerrainMeshData } from '../../../src/render/world/terrainMesh';
import { WATERFALL, waterfallDefines, waterfallIndex, waterfallStep } from '../../../src/render/world/waterfall';
import type { ChunkLookup } from '../../../src/render/world/window';
import { ChunkData, WATER_DEPTH_SHALLOW, WATER_RIVER } from '../../../src/world/model/chunk';
import type { Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { decodePng } from '../../../tools/lib/png';

const FRAG = SHADERS['world/terrain.frag'] ?? '';
const WATER_FRAG = SHADERS['water_surface.frag'] ?? '';
const FACE = 16;
const ids = contentWorldIdTables();
const T = (id: string): number => ids.terrain.runtimeId(id);
const B = (id: string): number => ids.biomes.runtimeId(id);
const CS = 32;

/** The face of a waterfall `w` columns wide from world column `x0`, `h` px high, at `t` (row-major ramp steps). */
function face(x0: number, w: number, h: number, t: number): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++) row.push(waterfallStep(x0 + x, y, h, t));
    rows.push(row);
  }
  return rows;
}

describe('Fallendes Wasser (waterfall.ts)', () => {
  it('nur Stufen der Wasserrampe: kein Seegrund, kein Seegras, kein Stein auf der Fallfläche', () => {
    const steps = new Set<number>();
    for (const t of [0, 0.37, 1.2, 9.81]) for (const row of face(-300, 600, FACE, t)) for (const s of row) steps.add(s);
    expect([...steps].sort()).toEqual([WATERFALL.darkStep, WATERFALL.bodyStep, WATERFALL.lightStep, WATERFALL.headStep].sort());
    for (const s of steps) expect(waterfallIndex(s)).toBe(rampIndex('wasser', s));
  });

  it('senkrechte Fäden: jede Zeile zwischen Lippe und Fuß zeigt mehrere Töne, die Streifen laufen senkrecht', () => {
    const h = 64;
    let vertical = 0;
    let horizontal = 0;
    let blocks = 0;
    let plainBlocks = 0;
    for (const t of [0, 0.5]) {
      const f = face(1000, 200, h, t);
      for (let y = WATERFALL.lipPx; y < h - WATERFALL.footPx[1]; y++) {
        const row = f[y] as number[];
        expect(new Set(row).size, `Zeile ${y}`).toBeGreaterThanOrEqual(3);
        // No band: a block of one colour a tile (16 px) wide and three rows high stays rare (calm water between threads).
        if (y + 2 < h - WATERFALL.footPx[1]) {
          for (let x = 0; x + 16 <= row.length; x++) {
            blocks++;
            if (new Set([row, f[y + 1] as number[], f[y + 2] as number[]].flatMap((r) => r.slice(x, x + 16))).size === 1) plainBlocks++;
          }
        }
        for (let x = 0; x + 1 < row.length; x++) {
          const s = row[x] as number;
          if (s === WATERFALL.bodyStep) continue;
          if ((f[y + 1] as number[])[x] === s) vertical++;
          if (row[x + 1] === s) horizontal++;
        }
      }
    }
    expect(vertical).toBeGreaterThan(horizontal * 2);
    expect(plainBlocks / blocks).toBeLessThan(0.02);
  });

  it('kein Einzelpixel: jeder helle oder dunkle Pixel hängt an seinem Faden', () => {
    const h = 48;
    for (const t of [0, 0.29, 3.1]) {
      const f = face(-77, 160, h, t);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < 159; x++) {
          const s = (f[y] as number[])[x] as number;
          if (s === WATERFALL.bodyStep) continue;
          let touch = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx !== 0 || dy !== 0) && (f[y + dy] as number[])[x + dx] !== WATERFALL.bodyStep) touch++;
          expect(touch, `(${x}, ${y}) t ${t}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('zieht mit der Zeit nach unten: eine Sekunde später steht das Muster speedPxPerSecond Pixel tiefer', () => {
    const h = 200;
    const d = WATERFALL.speedPxPerSecond;
    for (let x = -40; x < 40; x++) {
      for (let y = 10; y < 120; y++) expect(waterfallStep(x, y + d, h, 1), `(${x}, ${y})`).toBe(waterfallStep(x, y, h, 0));
    }
    // Between two whole pixels it stands still (no sub-pixel smear).
    expect(face(0, 64, FACE, 0.01)).toEqual(face(0, 64, FACE, 0));
  });

  it('an der Lippe der Kamm, am Fuß ausgefranster Schaum', () => {
    const f = face(500, 128, FACE, 0.7);
    for (const s of f[0] as number[]) expect(s).toBeGreaterThanOrEqual(WATERFALL.lightStep);
    // The crest: mostly the brightest step, a few one darker.
    const crest = (f[0] as number[]).filter((s) => s === WATERFALL.headStep).length / 128;
    expect(crest).toBeGreaterThan(WATERFALL.crestShare - 0.15);
    expect(crest).toBeLessThan(1);
    for (let y = 0; y < WATERFALL.lipPx; y++) for (const s of f[y] as number[]) expect(s).toBeGreaterThanOrEqual(WATERFALL.lightStep);
    for (const s of f[FACE - 1] as number[]) expect(s).toBe(WATERFALL.headStep);
    // The foam's top differs from column to column.
    const tops = new Set<number>();
    for (let x = 0; x < 128; x++) {
      let y = FACE - 1;
      while (y > 0 && (f[y - 1] as number[])[x] === WATERFALL.headStep) y--;
      tops.add(y);
    }
    expect(tops.size).toBeGreaterThanOrEqual(3);
  });
});

describe('Das Becken darunter (water_surface.frag)', () => {
  it('spiegelt weder den Fall noch das Becken darüber: Wasser spiegelt kein Wasser, der Himmel zeigt sich', () => {
    // The mirror search (objectReflection): a match on water – falling water, or water higher up whose pixel in the scene
    // copy is still its ground – gives no mirror.
    const search = WATER_FRAG.slice(WATER_FRAG.indexOf('vec4 objectReflection('), WATER_FRAG.indexOf('// Ice'));
    expect(search).toContain('if (waterPixel(q)) return vec4(0.0);');
    // It is checked at the match, after the exact-height test (one more fetch per mirrored pixel, not per step).
    expect(search.indexOf('if (waterPixel(q))')).toBeGreaterThan(search.indexOf('if (abs(2.0 * h - d) > DH_REFLECT_TOLERANCE) continue;'));
    // The white water below the fall and the fall itself (drawn by the terrain) stay as they were.
    expect(WATER_FRAG).toContain('float fallFoam(ivec2 s) {');
    expect(WATER_FRAG).toContain('if (water && length(gbufferNormal(g1).xy) > DH_FALL_TILT) discard;');
  });
});

describe('Shader und CPU-Spiegel', () => {
  it('der Wasserfall-Zweig rechnet dieselbe Formel mit den Konstanten von waterfallDefines, ohne den Frame der Wasserkachel', () => {
    expect(FRAG).toContain('if (kind == KIND_WATERFALL) index = DH_WATERFALL_RAMP + waterfallStep(int(floor(world.x)), fallY, fallHeight, uTime);');
    expect(FRAG).toContain('int v = y - int(floor(seconds * DH_WATERFALL_SPEED));');
    expect(FRAG).toContain('int lane = cellHash(ivec2(x >> 1, 0), DH_WATERFALL_SALT) < DH_WATERFALL_PAIR_SHARE ? (x >> 1) * 2 : x;');
    expect(FRAG).toContain('waterfallStreak(lane, v, DH_WATERFALL_LIGHT_PERIOD, DH_WATERFALL_LIGHT_LENGTH, ivec3(2, 3, 4))');
    expect(FRAG).toContain('waterfallStreak(lane, v, DH_WATERFALL_DARK_PERIOD, DH_WATERFALL_DARK_LENGTH, ivec3(6, 7, 8))');
    expect(FRAG).toContain('return m < len ? (m == len - 1 ? 2 : 1) : 0;');
    expect(FRAG).toContain('if (y >= height - foot) s = y == height - foot ? DH_WATERFALL_LIGHT : DH_WATERFALL_HEAD;');
    expect(FRAG).toContain('fallY = int(floor(below));');
    // The water frame is no longer turned on its side and scrolled: its seabed never reaches the fall.
    expect(FRAG).not.toMatch(/src = ivec2\(\(pi\.y - fall\)/);
    expect(FRAG).not.toContain('DH_FOAM_LIP_PX');
    const used = new Set([...FRAG.matchAll(/DH_WATERFALL_[A-Z_]+/g)].map((m) => m[0]));
    const defines = terrainDefines();
    const own = waterfallDefines();
    for (const d of used) {
      expect(own[d], d).toBeDefined();
      expect(defines[d], d).toBe(own[d]);
    }
    expect(Number(own['DH_WATERFALL_SPEED'])).toBe(WATERFALL.speedPxPerSecond);
    expect(own['DH_WATERFALL_RAMP']).toBe(`${rampIndex('wasser', 0)}`);
    expect(own['DH_WATERFALL_LIGHT_PERIOD']).toBe(`ivec2(${WATERFALL.lightPeriodPx[0]}, ${WATERFALL.lightPeriodPx[1]})`);
  });
});

/** A 3×3 block of surface chunks around (0, 0) filled by `tile(tx, ty, chunk, i)` (Grünhain grass). */
class Fixture implements ChunkLookup {
  readonly chunks = new Map<string, ChunkData>();

  constructor(fill: (tx: number, ty: number, c: ChunkData, i: number) => void) {
    for (let cy = -1; cy <= 1; cy++) {
      for (let cx = -1; cx <= 1; cx++) {
        const c = new ChunkData(0, cx, cy);
        for (let i = 0; i < CS * CS; i++) {
          c.ground[i] = T('gras');
          c.biome[i] = B('gruenhain');
          fill(cx * CS + (i % CS), cy * CS + Math.floor(i / CS), c, i);
        }
        this.chunks.set(`${cx},${cy}`, c);
      }
    }
  }

  get(layer: Layer, cx: number, cy: number): ChunkData | undefined {
    return layer === 0 ? this.chunks.get(`${cx},${cy}`) : undefined;
  }

  centre(): ChunkData {
    return this.chunks.get('0,0') as ChunkData;
  }
}

/** Kind, flags and atlas frame of every instance on tile (x, y) of the centre chunk. */
function kindsAt(m: TerrainMeshData, x: number, y: number): { kind: number; ax: number; ay: number }[] {
  const u16 = new Uint16Array(m.data.buffer, m.data.byteOffset, m.data.byteLength / 2);
  const out: { kind: number; ax: number; ay: number }[] = [];
  for (let k = 0; k < m.count; k++) {
    const o = k * TERRAIN_INSTANCE_STRIDE;
    if (m.data[o] !== x || m.data[o + 1] !== y) continue;
    const shade = decodeShade(m.data.subarray(o + TERRAIN_OFFSET.shade, o + TERRAIN_OFFSET.shade + 4));
    out.push({ kind: shade.kind, ax: u16[(o + TERRAIN_OFFSET.rect) / 2] ?? 0, ay: u16[(o + TERRAIN_OFFSET.rect) / 2 + 1] ?? 0 });
  }
  return out;
}

describe('Offene Lippe (terrainMesh.ts)', () => {
  let tables: WorldRenderTables;
  beforeAll(() => {
    const mod = generatedAtlasModule();
    if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
    tables = new WorldRenderTables(manifestFromGenerated(mod));
  });

  it('die Wasserkachel über dem Wasserfall hat keinen Plateaurand, die Landkacheln an derselben Kante schon', () => {
    // A plateau (rows < 20, columns ≥ 20) with a river three tiles wide (columns 24–26) running south over its edge.
    const f = new Fixture((tx, ty, c, i) => {
      if (ty < 20 && tx >= 20) c.height[i] = 1;
      if (tx >= 24 && tx <= 26 && ty >= 12 && ty < 26) c.water[i] = WATER_RIVER | WATER_DEPTH_SHALLOW;
    });
    const m = new TerrainMeshBuilder(tables).build(f.centre(), f);
    for (const x of [24, 25, 26]) {
      expect(kindsAt(m, x, 20).some((k) => k.kind === TERRAIN_KIND.waterfall), `Wasserfall ${x}`).toBe(true);
    }
    // The middle of the river: no rim across its lip.
    expect(kindsAt(m, 25, 19).some((k) => k.kind === TERRAIN_KIND.rim)).toBe(false);
    // The land beside the river keeps its edge.
    expect(kindsAt(m, 22, 19).some((k) => k.kind === TERRAIN_KIND.rim)).toBe(true);
    expect(kindsAt(m, 28, 19).some((k) => k.kind === TERRAIN_KIND.rim)).toBe(true);
  });
});

describe('Vorher: der gedrehte Seegrund-Frame (Reproduktion)', () => {
  it('ein Motiv des Meeresgrunds brachte Gras- und Steinpixel auf die Fallfläche', () => {
    const mod = generatedAtlasModule();
    if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
    const tables = new WorldRenderTables(manifestFromGenerated(mod));
    const albedo = decodePng(readFileSync(join(process.cwd(), 'public', mod.ATLAS.albedoUrl)));
    const water = rampIndex('wasser', 0);
    const foreign = new Set<number>();
    for (const v of SEABED_MOTIFS.variants) {
      const slot = tables.waterTerrain * TERRAIN_FRAME_SLOTS + BLOB_FRAMES + v;
      const fx = tables.terrainFrameX[slot] as number;
      const fy = tables.terrainFrameY[slot] as number;
      // The old branch: the frame turned on its side (src = (y − fall, x)), every pixel of it on the face.
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const i = ((fy + x) * albedo.width + fx + y) * 4;
          const index = albedo.rgba[i] as number;
          if (index < water || index > water + 5) foreign.add(index);
        }
      }
    }
    expect(foreign.size).toBeGreaterThan(0);
    expect([...foreign].some((i) => i >= rampIndex('gras', 0) && i <= rampIndex('gras', 5))).toBe(true);
  });
});
