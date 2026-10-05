/**
 * Wasserfälle (M2-28, ADR-0025; M6-Gate-Bildprüfung `biom-gruenhain-tag`, `verderbnis-*`, `wolkenschatten*`: die Fallfläche las
 * sich als waagrechte Bänder ohne Fallstreifen, mitten darauf ein Seegrasbüschel, über der Lippe ein Grasrand – seit M2;
 * src/render/world/waterfall.ts, der Wasserfall-Zweig von shaders/world/terrain.frag, terrainMesh.ts):
 * - das fallende Wasser kommt aus seinem eigenen Muster, nie vom Seegrund der Wasserkachel: nur Stufen der Wasserrampe;
 * - senkrechte Fäden, ein oder zwei Pixel breit, in jeder Zeile mehrere Töne (kein waagrechtes Band), kein Einzelpixel;
 * - das Muster zieht mit der Zeit nach unten; an der Lippe der Kamm, am Fuß ausgefranster Schaum;
 * - die Lippe bleibt offen: die Wasserkachel über dem Wasserfall bekommt keinen Plateaurand, Landkacheln daneben schon – und
 *   nur sie: eine Wasserkachel daneben, deren eigener Südnachbar nicht fällt (der Kopf eines Felspfeilers), behält Rand und
 *   Ecke (Runde 2, `gruenhain-tag`: Kappe, Kontur und Uferschaum des Pfeilers fehlten, eine verdeckte Spiegelung lag frei);
 * - an einem Wandende bleibt die Seitenfläche des Felsens neben dem fallenden Wasser, so breit wie der Seitenrand der Lippe
 *   darüber (Runde 2, `daemmerung-gruenhain-*`: ein Felskeil stand über dem Kamm, das Wasser fiel unter dem Fels hervor);
 * - das Becken darunter spiegelt den Fall wie den Fels daneben (Runde 2, `gruenhain-nacht`: ohne ihn lag unter dem Fall der
 *   Sternenhimmel als rechteckige Kerbe im dunklen Spiegelband der Klippe), nicht das Becken darüber; die Suche beginnt unter
 *   einem Fall an der Oberfläche (das Distanzfeld zählt den Fall als Wasser – sonst Keile mit einer Lücke);
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
import { BLOB_FRAMES, CLIFF_FRAMES, TERRAIN_FRAME_SLOTS, WorldRenderTables } from '../../../src/render/world/tables';
import { decodeShade, SEABED_MOTIFS, TERRAIN_FLAG, TERRAIN_INSTANCE_STRIDE, TERRAIN_KIND, TERRAIN_OFFSET, TerrainMeshBuilder, type TerrainMeshData } from '../../../src/render/world/terrainMesh';
import { WATERFALL, WATERFALL_END, waterfallDefines, waterfallEnds, waterfallIndex, waterfallOpen, waterfallStep } from '../../../src/render/world/waterfall';
import { blobIndex, KLIPPE_FRAME, KLIPPEN_GRUPPEN, NB, UEBERGANG, WAND_SPALTE, WAND_ZEILE, wandFrame } from '../../../src/world/autotile';
import type { ChunkLookup } from '../../../src/render/world/window';
import { ChunkData, TILE_FLAG_RAMP, WATER_DEPTH_SHALLOW, WATER_RIVER } from '../../../src/world/model/chunk';
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
  const search = WATER_FRAG.slice(WATER_FRAG.indexOf('vec4 objectReflection('), WATER_FRAG.indexOf('// Ice'));

  it('spiegelt den Fall wie den Fels daneben, nicht das Becken darüber (Runde 2 `gruenhain-nacht`: keine Sternenkerbe im Spiegelband)', () => {
    // A match on still water higher up – whose pixel in the scene copy is still its ground – gives no mirror; falling water
    // (tilted like a wall) is mirrored like the rock beside it. Checked at the match, after the exact-height test.
    expect(search).toContain('if (waterPixel(q) && length(gbufferNormal(g1).xy) <= DH_FALL_TILT) return vec4(0.0);');
    expect(search).not.toContain('if (waterPixel(q)) return vec4(0.0);');
    expect(search.indexOf('if (waterPixel(q) &&')).toBeGreaterThan(search.indexOf('if (abs(2.0 * h - d) > DH_REFLECT_TOLERANCE) continue;'));
    // The white water below the fall and the fall itself (drawn by the terrain) stay as they were.
    expect(WATER_FRAG).toContain('float fallFoam(ivec2 s) {');
    expect(WATER_FRAG).toContain('if (water && length(gbufferNormal(g1).xy) > DH_FALL_TILT) discard;');
  });

  it('unter einem Fall beginnt die Suche an der Oberfläche: das Distanzfeld zählt das fallende Wasser als Wasser', () => {
    // Without it the search began at the distance to the nearest bank – beyond the face's own mirror (a pool pixel D below
    // the foot mirrors the face pixel D high, 2·D above it): the sky showed under the fall, the rock's mirror beside it.
    expect(search).toContain('float start = max(1.0, floor(from));');
    expect(search).toContain('for (float k = DH_LEVEL_PX * 0.5; k < start && k <= DH_REFLECT_MAX * 0.5; k += DH_LEVEL_PX * 0.5) {');
    expect(search).toContain('if (waterPixel(c) && length(gbufferNormal(texelFetch(uNormal, glTexel(c), 0)).xy) > DH_FALL_TILT) {');
    expect(search).toContain('start = 1.0;');
    expect(search).toContain('for (float d = start; d <= DH_REFLECT_MAX;');
    // Every face is a level high at least: looked for every half level, no face between two looks is missed.
    for (let D = 0; D <= FACE; D++) {
      const looks: number[] = [];
      for (let k = 8; k <= 56; k += 8) looks.push(k);
      expect(looks.some((k) => k >= D + 1 && k <= D + FACE), `D ${D}`).toBe(true);
    }
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

/** Kind, flags, atlas frame and corners byte of every instance on tile (x, y) of the centre chunk, in draw order. */
function kindsAt(m: TerrainMeshData, x: number, y: number): { kind: number; ax: number; ay: number; flags: number; corners: number }[] {
  const u16 = new Uint16Array(m.data.buffer, m.data.byteOffset, m.data.byteLength / 2);
  const out: { kind: number; ax: number; ay: number; flags: number; corners: number }[] = [];
  for (let k = 0; k < m.count; k++) {
    const o = k * TERRAIN_INSTANCE_STRIDE;
    if (m.data[o] !== x || m.data[o + 1] !== y) continue;
    const shade = decodeShade(m.data.subarray(o + TERRAIN_OFFSET.shade, o + TERRAIN_OFFSET.shade + 4));
    out.push({ kind: shade.kind, ax: u16[(o + TERRAIN_OFFSET.rect) / 2] ?? 0, ay: u16[(o + TERRAIN_OFFSET.rect) / 2 + 1] ?? 0, flags: m.data[o + 3] ?? 0, corners: m.data[o + TERRAIN_OFFSET.shade + 2] ?? 0 });
  }
  return out;
}

/** Atlas position of frame `frame` of the cliff tileset of Grünhain. */
function cliffFrame(tables: WorldRenderTables, frame: number): { ax: number; ay: number } {
  const g = tables.biomeCliff[B('gruenhain')] as number;
  return { ax: tables.cliffFrameX[g * CLIFF_FRAMES + frame] as number, ay: tables.cliffFrameY[g * CLIFF_FRAMES + frame] as number };
}

/** Rim frame (`KLIPPE_FRAME.kante`) of a plateau tile whose neighbours `lower` lie lower. */
function rim(lower: number): number {
  return KLIPPE_FRAME.kante + blobIndex(0xff & ~lower);
}

/**
 * The bend of the river of `gruenhain-tag` (world tiles 359–363 × 573–576 of the debug scenes' seed): an upper river (level 1)
 * runs east–west along row 19 and turns south at columns 25–26; at column 24 it falls (24, 20) into the lower river
 * (level 0, rows ≥ 20, columns 20–24); west of its lip (23, 19) the plateau already ended a row higher (rock wall, lower
 * water). The east bank of the fall is the west rim of the upper river at column 25 – a narrow rock pillar.
 */
function bend(): Fixture {
  return new Fixture((tx, ty, c, i) => {
    if ((ty < 19 && tx >= 20) || (ty === 19 && tx >= 24) || (ty >= 20 && ty <= 22 && tx >= 25)) c.height[i] = 1;
    const upper = (ty === 19 && tx >= 24 && tx <= 27) || (ty >= 20 && ty <= 22 && tx >= 25 && tx <= 26);
    const lower = ty >= 19 && ty <= 24 && tx >= 20 && tx <= 24 && !(ty === 19 && tx === 24);
    if (upper || lower) c.water[i] = WATER_RIVER | WATER_DEPTH_SHALLOW;
  });
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
    // A fall three tiles wide: the lips beside each other open towards the falls diagonally below them too (no rim corner
    // in the middle of the river), the middle of the face is no wall end.
    expect(kindsAt(m, 24, 19).some((k) => k.kind === TERRAIN_KIND.rim && k.ax === cliffFrame(tables, rim(NB.SW)).ax && k.ay === cliffFrame(tables, rim(NB.SW)).ay)).toBe(false);
    expect(kindsAt(m, 25, 20).find((k) => k.kind === TERRAIN_KIND.waterfall)?.corners).toBe(0);
    expect(kindsAt(m, 25, 20).some((k) => k.kind === TERRAIN_KIND.wall)).toBe(false);
  });

  it('nur steile Wände öffnen die Lippe: neben einer Rampe bleibt die Innenecke als Ufer zwischen Wasser und Rampe', () => {
    const f = new Fixture((tx, ty, c, i) => {
      if (ty < 20 && tx >= 20) c.height[i] = 1;
      if (tx >= 24 && tx <= 26 && ty >= 12 && ty < 26) c.water[i] = WATER_RIVER | WATER_DEPTH_SHALLOW;
      // The bank west of the river leads down by a ramp (the flag on its edge tile).
      if (tx === 23 && ty === 19) c.flags[i] = (c.flags[i] as number) | TILE_FLAG_RAMP;
    });
    const m = new TerrainMeshBuilder(tables).build(f.centre(), f);
    expect(kindsAt(m, 23, 20).some((k) => k.kind === TERRAIN_KIND.ramp)).toBe(true);
    const corner = cliffFrame(tables, rim(NB.SW));
    expect(kindsAt(m, 24, 19).some((k) => k.kind === TERRAIN_KIND.rim && k.ax === corner.ax && k.ay === corner.ay)).toBe(true);
  });

  it('nur die Lippe öffnet sich: der Kopf des Felspfeilers neben dem Fall behält seinen Rand samt Ecke zum Fall (gruenhain-tag)', () => {
    const m = new TerrainMeshBuilder(tables).build(bend().centre(), bend());
    expect(kindsAt(m, 24, 20).some((k) => k.kind === TERRAIN_KIND.waterfall)).toBe(true);
    // The lip: open towards the fall, its bank to the lower west (side rim), nothing across the water.
    const lip = kindsAt(m, 24, 19).filter((k) => k.kind === TERRAIN_KIND.rim);
    expect(lip).toEqual([expect.objectContaining(cliffFrame(tables, rim(NB.W | NB.SW)))]);
    // Above the pillar: water whose own south neighbour does not fall – the fall lies diagonally below it. Its inner corner
    // towards the fall stays: the cap on the pillar's head, which the pillar's west rim (25, 20) runs on from.
    const head = kindsAt(m, 25, 19).filter((k) => k.kind === TERRAIN_KIND.rim);
    expect(head).toEqual([expect.objectContaining(cliffFrame(tables, rim(NB.SW)))]);
    expect(kindsAt(m, 25, 20).filter((k) => k.kind === TERRAIN_KIND.rim)).toEqual([expect.objectContaining(cliffFrame(tables, rim(NB.W | NB.SW | NB.NW)))]);
  });

  it('am Wandende bleibt die Seitenfläche des Felsens neben dem fallenden Wasser: erst das Felsstück, darüber der Fall', () => {
    const m = new TerrainMeshBuilder(tables).build(bend().centre(), bend());
    // The fall is the west end of its wall (west of it lower water, east higher land): the rock end piece first, then the
    // waterfall with its rock end in the corners byte.
    const fall = kindsAt(m, 24, 20).filter((k) => k.kind === TERRAIN_KIND.wall || k.kind === TERRAIN_KIND.waterfall);
    const end = wandFrame(UEBERGANG.keiner, WAND_ZEILE.einzeln, WAND_SPALTE.links);
    expect(fall).toEqual([
      expect.objectContaining({ kind: TERRAIN_KIND.wall, ...cliffFrame(tables, end), flags: 0, corners: 0 }),
      expect.objectContaining({ kind: TERRAIN_KIND.waterfall, flags: TERRAIN_FLAG.water, corners: WATERFALL_END.left }),
    ]);
  });
});

describe('Wandenden (waterfall.ts, terrain.frag)', () => {
  it('die Felsenden je Wandspalte: links, rechts, beide, keins in der Mitte', () => {
    for (const zeile of Object.values(WAND_ZEILE)) {
      expect(waterfallEnds(wandFrame(UEBERGANG.keiner, zeile, WAND_SPALTE.links))).toBe(WATERFALL_END.left);
      expect(waterfallEnds(wandFrame(UEBERGANG.keiner, zeile, WAND_SPALTE.rechts))).toBe(WATERFALL_END.right);
      expect(waterfallEnds(wandFrame(UEBERGANG.keiner, zeile, WAND_SPALTE.einzeln))).toBe(WATERFALL_END.left | WATERFALL_END.right);
      expect(waterfallEnds(wandFrame(UEBERGANG.keiner, zeile, WAND_SPALTE.mitte))).toBe(0);
      expect(waterfallEnds(KLIPPE_FRAME.wandVariante + zeile)).toBe(0);
    }
  });

  it('das Wasser fällt neben der Seitenfläche: links die ersten sidePx Spalten Fels, rechts die letzten, dazwischen Wasser', () => {
    for (let y = 0; y < 16; y++) {
      const side = WATERFALL.sidePx[y] as number;
      for (let x = 0; x < 16; x++) {
        expect(waterfallOpen(x, y, 0), `${x},${y}`).toBe(true);
        expect(waterfallOpen(x, y, WATERFALL_END.left), `${x},${y}`).toBe(x >= side);
        expect(waterfallOpen(x, y, WATERFALL_END.right), `${x},${y}`).toBe(x < 16 - side);
        expect(waterfallOpen(x, y, WATERFALL_END.left | WATERFALL_END.right), `${x},${y}`).toBe(x >= side && x < 16 - side);
      }
    }
    // The shader asks the same table and discards the falling water there (the rock piece under it shows).
    expect(FRAG).toContain('const int WATERFALL_SIDE[16] = DH_WATERFALL_SIDE;');
    expect(FRAG).toContain('if (!waterfallOpen(pi, vShade.z)) discard;');
    expect(FRAG).toContain('if ((ends & DH_WATERFALL_END_LEFT) != 0u && p.x < side) return false;');
    expect(FRAG).toContain('if ((ends & DH_WATERFALL_END_RIGHT) != 0u && p.x >= int(DH_TILE_SIZE) - side) return false;');
    expect(waterfallDefines()['DH_WATERFALL_SIDE']).toBe(`int[16](${WATERFALL.sidePx.join(', ')})`);
  });

  it('sidePx ist die Seitenfläche der Wandenden im Atlas, in jeder Klippengruppe (assets-src/sprites/terrain/_klippe.ts)', () => {
    const mod = generatedAtlasModule();
    if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
    const tables = new WorldRenderTables(manifestFromGenerated(mod));
    const albedo = decodePng(readFileSync(join(process.cwd(), 'public', mod.ATLAS.albedoUrl)));
    const px = (g: number, f: number, x: number, y: number): number => {
      const i = (((tables.cliffFrameY[g * CLIFF_FRAMES + f] as number) + y) * albedo.width + (tables.cliffFrameX[g * CLIFF_FRAMES + f] as number) + x) * 4;
      return (albedo.rgba[i + 3] as number) < 128 ? -1 : (albedo.rgba[i] as number);
    };
    // Rows without a foot (the foot's rubble covers both): how far an end piece differs from the middle piece of its row –
    // the side face, a pixel less where its colour meets the same colour of the front, a pixel more where the clean-up of
    // the art (`bereinige`) touched the front beside it. The commonest width of every row is the table's, none is wider by
    // more than that pixel.
    const widths = Array.from({ length: 16 }, () => [] as number[]);
    for (let g = 0; g < KLIPPEN_GRUPPEN.length; g++) {
      for (const zeile of [WAND_ZEILE.oben, WAND_ZEILE.mitte]) {
        const mitte = wandFrame(UEBERGANG.keiner, zeile, WAND_SPALTE.mitte);
        for (let y = 0; y < 16; y++) {
          let left = 16;
          while (left > 0 && px(g, wandFrame(UEBERGANG.keiner, zeile, WAND_SPALTE.links), left - 1, y) === px(g, mitte, left - 1, y)) left--;
          let right = 16;
          while (right > 0 && px(g, wandFrame(UEBERGANG.keiner, zeile, WAND_SPALTE.rechts), 16 - right, y) === px(g, mitte, 16 - right, y)) right--;
          widths[y]?.push(left, right);
        }
      }
    }
    const commonest = widths.map((w) => {
      const count = new Map<number, number>();
      for (const v of w) count.set(v, (count.get(v) ?? 0) + 1);
      return [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
    });
    expect(commonest).toEqual([...WATERFALL.sidePx]);
    widths.forEach((w, y) => expect(Math.max(...w), `y ${y}`).toBeLessThanOrEqual((WATERFALL.sidePx[y] as number) + 1));
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
