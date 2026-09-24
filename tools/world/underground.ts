/**
 * Debug images of the underground layers (M2-13): `tools/out/world/ebene-1.png`, `ebene-2.png`,
 * `ebene-3.png` (whole layer, 1 px per tile) plus `ebene-<n>-ausschnitt.png` (a 4× crop around the
 * busiest cavern) and a short statistic per layer (open share, lakes, veins, objects, generation
 * time per chunk).
 *
 * The underground is built like the game will: world plan of the seed → land extent → default
 * entrance candidates (`proposeEntranceCandidates`) → underground plan → every chunk of every layer.
 *
 * CLI: `tsx tools/world/underground.ts [--seed <n>] [--size small|medium|large]`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { WorldSizePreset } from '../../src/content/balance';
import { TILE_FLAG_PLACE, TILE_FLAG_RAMP, TILE_FLAG_STAIRS, WATER_DEPTH_DEEP, waterDepth, type ChunkData } from '../../src/world/model/chunk';
import { CHUNK_SIZE } from '../../src/world/model/coords';
import { contentWorldIdTables } from '../../src/world/model/runtimeIds';
import { worldDimensions } from '../../src/world/model/worldSize';
import { generateWorldPlan } from '../../src/world/gen/plan/index';
import {
  UNDERGROUND_LAYERS,
  createUndergroundPlan,
  generateUndergroundChunk,
  layerPlanOf,
  proposeEntranceCandidates,
  type UndergroundExtent,
  type UndergroundLayer,
  type UndergroundPlan,
} from '../../src/world/gen/underground/index';
import { RgbaImage, hexRgba, type Rgba } from '../lib/image';

const OUT_DIR = resolve('tools/out/world');
const DEFAULT_SEED = 20260924;
/** Crop edge [tiles] and scale [px per tile] of the detail image. */
const CROP_TILES = 160;
const CROP_SCALE = 4;

/** Colours of terrain ids (floors, rock, veins) – readable, not the game palette. */
const TERRAIN_COLOURS: Readonly<Record<string, string>> = {
  fels: '#3b3029',
  tiefenfels: '#2c3139',
  glutfels: '#2e1d1d',
  wurzelboden: '#7a5c3a',
  hoehlenboden: '#8a8276',
  lehm: '#b0784a',
  obsidianboden: '#4a3f5c',
  erde: '#6e5236',
  sand: '#c9ad6e',
  lava: '#ff7a1e',
  ader_kupfer: '#e07b36',
  ader_zinn: '#c2ced2',
  ader_salpeter: '#f4f1dc',
  ader_eisen: '#b0552c',
  ader_silber: '#e6ecf2',
  ader_gold: '#ffd23a',
  ader_klarquarz: '#b8f2ff',
  ader_edelstein: '#e0409a',
  ader_obsidian: '#8a62d0',
  ader_magmit: '#ff3a2a',
  ader_lumenit: '#7cffc8',
};
const WATER_SHALLOW = hexRgba('#5a9ccc');
const WATER_DEEP = hexRgba('#2b5a90');
const LINK_UP = hexRgba('#ffffff');
const LINK_DOWN = hexRgba('#ff4dff');
const PLACE = hexRgba('#f0c040');
const SEA_SHADE = 0.55;
/** Object colours by id prefix. */
const OBJECT_COLOURS: ReadonlyArray<readonly [string, Rgba]> = [
  ['pflanze_leuchtpilz', hexRgba('#5ff4ff')],
  ['pflanze_', hexRgba('#9ee06a')],
  ['busch_', hexRgba('#4f7a2a')],
  ['fels_', hexRgba('#a8a29a')],
  ['kristall_', hexRgba('#d6a8ff')],
  ['erz_', hexRgba('#ffb040')],
  ['deko_', hexRgba('#c8b890')],
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function shade(c: Rgba, f: number): Rgba {
  return [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f), c[3]];
}

interface LayerStats {
  open: number;
  tiles: number;
  lake: number;
  lava: number;
  veins: Map<string, number>;
  exposedVeins: Map<string, number>;
  objects: Map<string, number>;
  ms: number;
  chunks: number;
}

function render(plan: UndergroundPlan, layer: UndergroundLayer, extent: UndergroundExtent): { image: RgbaImage; stats: LayerStats; tileColour: (tx: number, ty: number) => Rgba } {
  const tables = contentWorldIdTables();
  const dim = worldDimensions(plan.preset);
  const n = dim.tiles;
  const colours = new Map<number, Rgba>();
  for (const [id, hex] of Object.entries(TERRAIN_COLOURS)) colours.set(tables.terrain.runtimeId(id), hexRgba(hex));
  const objColour = (id: string): Rgba => (OBJECT_COLOURS.find(([p]) => id.startsWith(p)) as readonly [string, Rgba])[1];
  const stats: LayerStats = { open: 0, tiles: n * n, lake: 0, lava: 0, veins: new Map(), exposedVeins: new Map(), objects: new Map(), ms: 0, chunks: 0 };
  const pixels = new Array<Rgba>(n * n);
  const solidAt = new Uint8Array(n * n);
  const lavaId = tables.terrain.runtimeId('lava');
  const chunks: ChunkData[] = [];
  for (let cy = 0; cy < dim.chunks; cy++) {
    for (let cx = 0; cx < dim.chunks; cx++) {
      const t0 = performance.now();
      const c = generateUndergroundChunk(plan, layer, cx, cy);
      stats.ms += performance.now() - t0;
      stats.chunks++;
      chunks.push(c);
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
        const tx = cx * CHUNK_SIZE + (i % CHUNK_SIZE);
        const ty = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
        solidAt[ty * n + tx] = c.solid[i] as number;
      }
    }
  }
  const land = (tx: number, ty: number): boolean => extent.mask[Math.floor(ty / extent.cellTiles) * extent.width + Math.floor(tx / extent.cellTiles)] === 1;
  for (const c of chunks) {
    for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
      const tx = c.cx * CHUNK_SIZE + (i % CHUNK_SIZE);
      const ty = c.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
      const solid = c.solid[i] as number;
      let col: Rgba;
      if (solid !== 0) {
        const id = tables.terrain.stringId(solid);
        col = colours.get(solid) as Rgba;
        if (id.startsWith('ader_')) {
          stats.veins.set(id, (stats.veins.get(id) ?? 0) + 1);
          const exposed = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].some(([dx, dy]) => {
            const x = tx + (dx as number);
            const y = ty + (dy as number);
            return x >= 0 && y >= 0 && x < n && y < n && solidAt[y * n + x] === 0;
          });
          if (exposed) stats.exposedVeins.set(id, (stats.exposedVeins.get(id) ?? 0) + 1);
        } else if (!land(tx, ty)) col = shade(col, SEA_SHADE);
      } else {
        stats.open++;
        const ground = c.ground[i] as number;
        const depth = waterDepth(c.water[i] as number);
        if (ground === lavaId) {
          stats.lava++;
          col = colours.get(lavaId) as Rgba;
        } else if (depth > 0) {
          stats.lake++;
          col = depth === WATER_DEPTH_DEEP ? WATER_DEEP : WATER_SHALLOW;
        } else col = colours.get(ground) as Rgba;
        const obj = c.object[i] as number;
        if (obj !== 0) {
          const id = tables.objects.stringId(obj);
          stats.objects.set(id, (stats.objects.get(id) ?? 0) + 1);
          col = objColour(id);
        }
        if (((c.flags[i] as number) & TILE_FLAG_PLACE) !== 0) col = [Math.round((col[0] + PLACE[0]) / 2), Math.round((col[1] + PLACE[1]) / 2), Math.round((col[2] + PLACE[2]) / 2), 255];
      }
      pixels[ty * n + tx] = col;
    }
  }
  // Links as 5 × 5 crosses on top.
  for (const c of chunks) {
    for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
      const f = c.flags[i] as number;
      if ((f & (TILE_FLAG_RAMP | TILE_FLAG_STAIRS)) === 0) continue;
      const tx = c.cx * CHUNK_SIZE + (i % CHUNK_SIZE);
      const ty = c.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
      const col = (f & TILE_FLAG_RAMP) !== 0 ? LINK_UP : LINK_DOWN;
      for (let d = -2; d <= 2; d++) {
        if (tx + d >= 0 && tx + d < n) pixels[ty * n + tx + d] = col;
        if (ty + d >= 0 && ty + d < n) pixels[(ty + d) * n + tx] = col;
      }
    }
  }
  const image = new RgbaImage(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) image.setPixel(x, y, pixels[y * n + x] as Rgba);
  return { image, stats, tileColour: (tx, ty) => pixels[ty * n + tx] as Rgba };
}

function main(): void {
  const seed = Number(arg('seed') ?? DEFAULT_SEED);
  const preset = (arg('size') ?? 'medium') as WorldSizePreset;
  mkdirSync(OUT_DIR, { recursive: true });
  const t0 = performance.now();
  const world = generateWorldPlan(seed, preset);
  const extent: UndergroundExtent = { cellTiles: world.grid.cellTiles, width: world.grid.width, height: world.grid.height, mask: world.land };
  const candidates = proposeEntranceCandidates(seed, preset, extent);
  const t1 = performance.now();
  const plan = createUndergroundPlan({ seed, preset, entranceCandidates: candidates, extent });
  const t2 = performance.now();
  console.info(`Weltplan ${(t1 - t0).toFixed(0)} ms, Untergrund-Plan ${(t2 - t1).toFixed(0)} ms; ${candidates.length} Kandidaten → ${plan.links.filter((l) => l.kind === 'eingang').length} Eingänge, ${plan.links.filter((l) => l.kind === 'schacht').length} Schächte, ${plan.slots.length} Orts-Slots`);
  for (const layer of UNDERGROUND_LAYERS) {
    const lp = layerPlanOf(plan, layer);
    const { image, stats, tileColour } = render(plan, layer, extent);
    const name = `ebene${layer}`;
    writeFileSync(join(OUT_DIR, `${name}.png`), image.toPng());
    // Crop around the cavern with the most neighbours (lakes and specials preferred).
    let best = 0;
    let bestScore = -1;
    lp.nodes.forEach((node, i) => {
      if (node.role !== 'kaverne') return;
      const near = lp.nodes.filter((o) => Math.abs(o.x - node.x) < CROP_TILES / 2 && Math.abs(o.y - node.y) < CROP_TILES / 2);
      const score = near.length + near.filter((o) => o.feature !== 'keine').length * 2;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    const centre = lp.nodes[best];
    if (centre !== undefined) {
      const cx0 = Math.max(0, Math.min(plan.tiles - CROP_TILES, Math.floor(centre.x - CROP_TILES / 2)));
      const cy0 = Math.max(0, Math.min(plan.tiles - CROP_TILES, Math.floor(centre.y - CROP_TILES / 2)));
      const crop = new RgbaImage(CROP_TILES * CROP_SCALE, CROP_TILES * CROP_SCALE);
      crop.drawScaled(0, 0, CROP_TILES, CROP_TILES, CROP_SCALE, (x, y) => tileColour(cx0 + x, cy0 + y));
      writeFileSync(join(OUT_DIR, `${name}-ausschnitt.png`), crop.toPng());
      console.info(`  Ausschnitt ${name}: Tiles ${cx0}…${cx0 + CROP_TILES - 1} × ${cy0}…${cy0 + CROP_TILES - 1}`);
    }
    const pct = (v: number): string => `${((100 * v) / stats.tiles).toFixed(2)} %`;
    const features = new Map<string, number>();
    for (const node of lp.nodes) features.set(node.feature, (features.get(node.feature) ?? 0) + 1);
    console.info(`Ebene ${layer}: ${stats.chunks} Chunks, ${(stats.ms / stats.chunks).toFixed(2)} ms/Chunk; offen ${pct(stats.open)}, Wasser ${pct(stats.lake)}, Lava ${pct(stats.lava)}`);
    console.info(`  Systeme ${lp.systems.length}, Knoten ${lp.nodes.length} (${[...features].map(([k, v]) => `${k} ${v}`).join(', ')}), Gänge ${lp.tunnels.length}, Primitive ${lp.primCount}`);
    console.info(`  Adern: ${[...stats.veins].map(([k, v]) => `${k} ${v} (frei ${stats.exposedVeins.get(k) ?? 0})`).join(', ')}`);
    console.info(`  Objekte: ${[...stats.objects].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
}

main();
