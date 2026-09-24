/**
 * World map debug images of all sizes (M2-15): `tools/out/world/weltkarte-klein.png`,
 * `weltkarte-mittel.png`, `weltkarte-gross.png`.
 *
 * Each world is generated like the game does it (the same `generateWorld` the world worker runs,
 * with its progress steps printed), then every surface chunk is generated and drawn: biomes with
 * transition strips (dithered), height levels (lighter = higher, dark cliff edges), sea, lakes,
 * rivers with fords and bridges, decayed roads, ramps and stairs, place discs and forests. On top:
 * the road polylines, a marker per place (legend on the right, beacons numbered 1–6, arenas as rings
 * linked to their site) and the cave mouths; below the legend the cave networks of the layers −1, −2,
 * −3 with their entrances (the surface's cave mouths) and shafts.
 *
 * CLI: `npx tsx tools/world/weltkarte.ts [--seed <n>] [--size small|medium|large]` (default: all sizes).
 * The screenshot tool renders the same maps as scenarios (`npm run shot -- weltkarte-klein
 * weltkarte-mittel weltkarte-gross` → `shots/latest/`, M2-15): drawing a map needs every chunk of the
 * world, so it runs here in Node with the game's own generator instead of in the browser.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorldSizePreset } from '../../src/content/balance';
import { LOCATION_TYPES } from '../../src/world/gen/locations';
import { PLAN_BIOME_IDS } from '../../src/world/gen/plan/index';
import { generateWorld, WORLD_GEN_STEPS, type GeneratedWorld } from '../../src/world/gen/world';
import { drawText } from '../lib/font';
import { RgbaImage } from '../lib/image';
import { BG, BIOME_COLOR, BLACK, LOCATION_STYLE, WHITE, drawFeatures, drawUnderground, label, renderSurface } from './mapDraw';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'world');
const DEFAULT_SEED = 20260924;
const SIZES: readonly WorldSizePreset[] = ['small', 'medium', 'large'];
const FILE: Record<WorldSizePreset, string> = { small: 'weltkarte-klein', medium: 'weltkarte-mittel', large: 'weltkarte-gross' };
const LABEL: Record<WorldSizePreset, string> = { small: 'KLEIN', medium: 'MITTEL', large: 'GROSS' };
/** Tiles per map pixel: Klein 1:1, the larger worlds 2:1 (maps of ≈ 1000 px). */
const STEP: Record<WorldSizePreset, number> = { small: 1, medium: 2, large: 2 };
/** Width of the legend panel [px]. */
const PANEL = 340;
/** Edge of one underground view [px] (two per row in the panel). */
const UNDERGROUND_PX = 160;
/** Map origin [px]. */
const MAP_X = 16;
const MAP_Y = 56;
/** Smallest image height [px] (legend and underground views). */
const MIN_HEIGHT = 1060;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Renders the surface chunk by chunk with a progress line. */
function surfaceWithProgress(world: GeneratedWorld): ReturnType<typeof renderSurface> {
  let last = -1;
  const out = renderSurface(world, STEP[world.preset], (row, rows) => {
    const pct = Math.floor((row / rows) * 10) * 10;
    if (pct === last) return;
    last = pct;
    process.stdout.write(`\r  Chunks ${pct} %   `);
  });
  process.stdout.write('\n');
  return out;
}

/** Draws the map; `genMs` null leaves the timings out (screenshots are deterministic, §31.5). */
function worldMap(world: GeneratedWorld, genMs: number | null): RgbaImage {
  const step = STEP[world.preset];
  const t0 = performance.now();
  const { img: surface, chunkMs, chunks } = surfaceWithProgress(world);
  const size = surface.width;
  const img = new RgbaImage(MAP_X + size + PANEL + 32, Math.max(MAP_Y + size + 16, MIN_HEIGHT));
  img.fillRect(0, 0, img.width, img.height, BG);
  img.drawScaled(MAP_X, MAP_Y, size, size, 1, (x, y) => {
    const i = (y * size + x) * 4;
    return [surface.data[i] as number, surface.data[i + 1] as number, surface.data[i + 2] as number, 255];
  });
  drawFeatures(img, world, MAP_X, MAP_Y, 1 / step);
  const r = world.report;
  label(img, 16, 8, `WELTKARTE ${LABEL[world.preset]} SEED ${world.seed}  ${world.plan.grid.tiles}X${world.plan.grid.tiles} TILES  ORTE ${r.locations.total}  STRASSEN ${Math.round(r.roads.lengthTiles)} TILES  VORKOMMEN ${r.resources.deposits}`);
  label(
    img,
    16,
    32,
    `${genMs === null ? `CHUNKS ${chunks}` : `WELT ${genMs.toFixed(0)} MS  CHUNKS ${chunks} IN ${(chunkMs / 1000).toFixed(1)} S (${(chunkMs / chunks).toFixed(2)} MS/CHUNK)`}  REPARATUREN ${r.repairs} (RAMPEN ${r.reachability.rampsAdded} FURTEN ${r.reachability.fordsAdded} BRUECKEN ${r.reachability.bridgesAdded} NACHGESTREUT ${r.resources.rescattered})  PROBLEME ${r.problems.length}`,
    1,
  );
  // Legend: biomes, places with counts.
  const lx = MAP_X + size + 24;
  let ly = MAP_Y;
  label(img, lx, ly, 'BIOME', 2);
  ly += 20;
  PLAN_BIOME_IDS.forEach((id, i) => {
    img.fillRect(lx, ly, 12, 10, BIOME_COLOR[i] ?? BG);
    drawText(img, lx + 18, ly + 2, id, WHITE, 1);
    ly += 14;
  });
  ly += 8;
  label(img, lx, ly, 'ORTE', 2);
  ly += 20;
  for (const type of LOCATION_TYPES) {
    const st = LOCATION_STYLE[type];
    const n = world.locations.filter((s) => s.type === type).length;
    img.fillRect(lx, ly, 12, 10, BLACK);
    img.fillRect(lx + 1, ly + 1, 10, 8, st.color);
    drawText(img, lx + 4, ly + 3, st.code, BLACK, 1);
    drawText(img, lx + 18, ly + 2, `${st.de} ${n}`, WHITE, 1);
    ly += 13;
  }
  // Underground views, two per row.
  ly += 10;
  label(img, lx, ly, 'UNTERGRUND: EINGANG LILA, SCHACHT HINAB GELB, VON OBEN WEISS', 1);
  ly += 14;
  const scale = UNDERGROUND_PX / world.plan.grid.tiles;
  ([-1, -2, -3] as const).forEach((layer, k) => {
    const x = lx + (k % 2) * (UNDERGROUND_PX + 8);
    const y = ly + Math.floor(k / 2) * (UNDERGROUND_PX + 20);
    drawText(img, x, y, `EBENE ${layer}`, WHITE, 1);
    drawUnderground(img, world, layer, x, y + 10, scale);
  });
  console.info(`  Karte gezeichnet in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  return img;
}

/** Screenshot scenarios of the world maps (`npm run shot`) and their world sizes. */
export const WORLD_MAP_SHOTS: Readonly<Record<string, WorldSizePreset>> = { 'weltkarte-klein': 'small', 'weltkarte-mittel': 'medium', 'weltkarte-gross': 'large' };

/** Seed of the world maps (the world of the debug scenes, docs/WORLD.md). */
export const WORLD_MAP_SEED = DEFAULT_SEED;

/** A drawn world map. */
export interface WorldMapImage {
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** Validation problems of the generated world (empty = none). */
  readonly problems: readonly string[];
}

/**
 * Generates the world of (seed, preset) like the game does and draws its map (progress on the
 * console); `timings` prints generation times into the header (the CLI; screenshots leave them out).
 */
export function renderWorldMap(preset: WorldSizePreset, seed: number = WORLD_MAP_SEED, timings = false): WorldMapImage {
  console.info(`${LABEL[preset]} (Seed ${seed})`);
  const t0 = performance.now();
  const world = generateWorld(seed, preset, (p) => console.info(`  [${p.index + 1}/${WORLD_GEN_STEPS.length}] ${p.step}`));
  const genMs = performance.now() - t0;
  console.info(`  Welt erzeugt in ${genMs.toFixed(0)} ms, Probleme: ${world.report.problems.length === 0 ? 'keine' : world.report.problems.join('; ')}`);
  const img = worldMap(world, timings ? genMs : null);
  return { png: img.toPng(6), width: img.width, height: img.height, problems: world.report.problems };
}

function main(): void {
  const seed = Number(arg('seed') ?? DEFAULT_SEED);
  const only = arg('size') as WorldSizePreset | undefined;
  if (only !== undefined && !SIZES.includes(only)) throw new Error(`--size must be one of ${SIZES.join(', ')}`);
  mkdirSync(OUT_DIR, { recursive: true });
  for (const preset of only !== undefined ? [only] : SIZES) {
    const map = renderWorldMap(preset, seed, true);
    const file = join(OUT_DIR, `${FILE[preset]}.png`);
    writeFileSync(file, map.png);
    console.info(`  ${file} (${map.width}×${map.height})`);
  }
}

// CLI only when run directly (the screenshot tool imports the renderer).
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
