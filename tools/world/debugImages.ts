/**
 * Debug images of the world plan (M2-04 … M2-09) → tools/out/world/:
 * - weltgen-regionen.png: island mask, Poisson regions (ring segments light), seeds and region graph
 *   (sea crossings dashed) for Klein, Mittel and Groß.
 * - weltgen-biomzuweisung.png: biome per region (docs/ART.md colour identity), tier numbers, start (S)
 *   and Nachtherz; thumbnails of further seeds.
 * - weltgen-hoehe.png: height levels 0–4 at tile resolution with cliff lines, ramps (yellow) and
 *   stairs (orange); zoom at full tile resolution.
 * - weltgen-wasser.png: sea, lakes, rivers, streams, springs (cyan) and fords (red); zoom on a river.
 * - weltgen-biome.png: tile biomes with domain-warped borders and dithered transition strips; zoom
 *   with strip weights.
 * - weltgen-orte.png, weltgen-dichte.png: places, roads, bridges (M2-11) and object density from the
 *   real chunks (M2-10), see tools/world/debugPlaces.ts.
 *
 * Usage: npx tsx tools/world/debugImages.ts [--seed <n>] [--size small|medium|large] [--only weltgen-orte,weltgen-dichte]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paletteIndex, flatPalette } from '../../assets-src/palette';
import { BIOMES } from '../../src/content/biomes';
import type { WorldSizePreset } from '../../src/content/balance';
import { hash2 } from '../../src/engine/rng';
import { TILE_FLAG_FORD, TILE_FLAG_RAMP, TILE_FLAG_STAIRS, WATER_DEPTH_DEEP, WATER_DEPTH_MASK, WATER_LAKE, WATER_RIVER, WATER_SEA, WATER_SPRING } from '../../src/world/model/chunk';
import { blueNoiseAt, createBlueNoiseTile } from '../../src/world/gen/sampling';
import {
  PLAN_BIOME_IDS,
  createBiomeSample,
  createBiomeSampler,
  createPlanSampler,
  createTerrainSample,
  generateWorldPlan,
  pickBiome,
  type WorldPlan,
} from '../../src/world/gen/plan';
import { generateWorld, type GeneratedWorld } from '../../src/world/gen/world';
import { drawText, textWidth } from '../lib/font';
import { densityImage, placesImage } from './debugPlaces';
import { RgbaImage, hexRgba, type Rgba } from '../lib/image';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'world');
const DEFAULT_SEED = 20260924;
const SIZES: readonly WorldSizePreset[] = ['small', 'medium', 'large'];
const SIZE_LABEL: Record<WorldSizePreset, string> = { small: 'KLEIN', medium: 'MITTEL', large: 'GROSS' };

const BG: Rgba = [24, 22, 30, 255];
const WHITE: Rgba = [255, 255, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];
const SEA_DEEP: Rgba = hexRgba('#10203f');
const SEA_SHALLOW: Rgba = hexRgba('#1f5680');
const LAKE: Rgba = hexRgba('#2e7f9e');
const RIVER: Rgba = hexRgba('#4fb0b8');
const STREAM: Rgba = hexRgba('#9ee0d6');
const RAMP: Rgba = hexRgba('#fbb938');
const STAIRS: Rgba = hexRgba('#f07c1f');
const FORD: Rgba = hexRgba('#d4471e');
const SPRING: Rgba = hexRgba('#f4fbff');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Debug colour of each biome: its first ground colour (docs/ART.md §5) not already taken by an earlier biome. */
const BIOME_COLOR: Rgba[] = (() => {
  const palette = flatPalette();
  const used = new Set<string>();
  return PLAN_BIOME_IDS.map((id) => {
    const biome = BIOMES.find((b) => b.id === id);
    const refs = biome === undefined ? [] : [...biome.colorIdentity.ground, ...biome.colorIdentity.accent];
    const ref = refs.find((r) => !used.has(r)) ?? refs[0] ?? 'stein.3';
    used.add(ref);
    return hexRgba(palette[paletteIndex(ref) - 1] as string);
  });
})();

function shade(c: Rgba, f: number): Rgba {
  const k = (v: number): number => Math.max(0, Math.min(255, Math.round(v * f)));
  return [k(c[0]), k(c[1]), k(c[2]), 255];
}

function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t), 255];
}

function line(img: RgbaImage, x0: number, y0: number, x1: number, y1: number, c: Rgba, dash = 0): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= steps; i++) {
    if (dash > 0 && Math.floor(i / dash) % 2 === 1) continue;
    img.setPixel(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, c);
  }
}

function disc(img: RgbaImage, x: number, y: number, r: number, c: Rgba): void {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) img.setPixel(x + dx, y + dy, c);
}

function label(img: RgbaImage, x: number, y: number, text: string, scale = 2): void {
  const w = textWidth(text, scale);
  img.fillRect(x - 2, y - 2, w + 4, 5 * scale + 4, BG);
  drawText(img, x, y, text, WHITE, scale);
}

function regionColor(plan: WorldPlan, r: number): Rgba {
  const h = hash2(r, plan.seed, plan.regions.length);
  const base: Rgba = [70 + (h & 127), 70 + ((h >>> 8) & 127), 70 + ((h >>> 16) & 127), 255];
  return plan.regions[r]?.kind === 'band' ? mix(base, WHITE, 0.55) : base;
}

/** Island, regions and region graph at cell resolution. */
function drawRegions(img: RgbaImage, plan: WorldPlan, ox: number, oy: number, scale: number): void {
  const { grid } = plan;
  img.drawScaled(ox, oy, grid.width, grid.height, scale, (x, y) => {
    const c = y * grid.width + x;
    const r = plan.region[c] as number;
    if (r < 0) return SEA_DEEP;
    const col = regionColor(plan, r);
    const east = x + 1 < grid.width ? (plan.region[c + 1] as number) : r;
    const south = y + 1 < grid.height ? (plan.region[c + grid.width] as number) : r;
    return (east >= 0 && east !== r) || (south >= 0 && south !== r) ? shade(col, 0.6) : col;
  });
  const px = (t: number): number => (t / grid.cellTiles) * scale;
  for (const e of plan.edges) {
    const a = plan.regions[e.a];
    const b = plan.regions[e.b];
    if (a === undefined || b === undefined) continue;
    line(img, ox + px(a.centroidX), oy + px(a.centroidY), ox + px(b.centroidX), oy + px(b.centroidY), e.crossing ? RIVER : shade(WHITE, 0.25), e.crossing ? 3 : 0);
  }
  for (const r of plan.regions) disc(img, ox + px(r.seedX), oy + px(r.seedY), 1, BLACK);
}

function regionsImage(seed: number): RgbaImage {
  const plans = SIZES.map((s) => generateWorldPlan(seed, s));
  const target = 512;
  const gap = 16;
  const img = new RgbaImage(plans.length * (target + gap) + gap, target + 60);
  img.fillRect(0, 0, img.width, img.height, BG);
  plans.forEach((plan, i) => {
    const scale = Math.floor(target / plan.grid.width);
    const ox = gap + i * (target + gap);
    drawRegions(img, plan, ox, 40, scale);
    const bands = plan.regions.filter((r) => r.kind === 'band').length;
    label(img, ox, 8, `${SIZE_LABEL[plan.preset]} ${plan.regions.length} REGIONEN (${bands} KUESTE)`);
  });
  return img;
}

/** Biome per region at cell resolution with tiers, start and Nachtherz. */
function drawBiomeAssignment(img: RgbaImage, plan: WorldPlan, ox: number, oy: number, scale: number, labels: boolean): void {
  const { grid } = plan;
  img.drawScaled(ox, oy, grid.width, grid.height, scale, (x, y) => {
    const c = y * grid.width + x;
    const r = plan.region[c] as number;
    if (r < 0) return SEA_DEEP;
    const col = BIOME_COLOR[PLAN_BIOME_IDS.indexOf(plan.regions[r]?.biome ?? '')] ?? WHITE;
    const east = x + 1 < grid.width ? (plan.region[c + 1] as number) : r;
    const south = y + 1 < grid.height ? (plan.region[c + grid.width] as number) : r;
    return (east >= 0 && east !== r) || (south >= 0 && south !== r) ? shade(col, 0.7) : col;
  });
  if (!labels) return;
  const px = (t: number): number => (t / grid.cellTiles) * scale;
  for (const r of plan.regions) {
    const x = ox + px(r.centroidX) - 3;
    const y = oy + px(r.centroidY) - 5;
    const text = r.id === plan.start ? 'S' : String(r.tier);
    img.fillRect(x - 1, y - 1, 8, 12, r.id === plan.start || r.id === plan.core ? hexRgba('#d4471e') : BLACK);
    drawText(img, x, y, text, WHITE, 2);
  }
}

function biomeAssignmentImage(seed: number, preset: WorldSizePreset): RgbaImage {
  const plan = generateWorldPlan(seed, preset);
  const scale = Math.floor(768 / plan.grid.width);
  const main = plan.grid.width * scale;
  const thumbs = [seed + 1, seed + 2, seed + 3].map((s) => generateWorldPlan(s, preset));
  const tScale = Math.max(1, Math.floor(256 / plan.grid.width));
  const tSize = plan.grid.width * tScale;
  const img = new RgbaImage(main + tSize + 48, Math.max(main, 3 * (tSize + 24)) + 48 + 24 * 8);
  img.fillRect(0, 0, img.width, img.height, BG);
  label(img, 16, 8, `BIOMZUWEISUNG SEED ${seed} ${SIZE_LABEL[preset]}`);
  drawBiomeAssignment(img, plan, 16, 36, scale, true);
  thumbs.forEach((p, i) => {
    const y = 36 + i * (tSize + 24);
    label(img, main + 32, y - 2, `SEED ${p.seed}`, 1);
    drawBiomeAssignment(img, p, main + 32, y + 8, tScale, false);
  });
  // Legend with region counts.
  let ly = main + 52;
  PLAN_BIOME_IDS.forEach((id, i) => {
    const count = plan.regions.filter((r) => r.biome === id).length;
    img.fillRect(16, ly, 16, 16, BIOME_COLOR[i] as Rgba);
    label(img, 40, ly + 3, `${id} ${count}`);
    ly += 22;
  });
  return img;
}

/** Hypsometric colour of a level. */
const LEVEL_COLOR: readonly Rgba[] = ['#78ad45', '#4b8c3c', '#93694f', '#7e8393', '#d2e7f2'].map(hexRgba);

function heightImage(plan: WorldPlan): RgbaImage {
  const sampler = createPlanSampler(plan);
  const s = createTerrainSample();
  const tiles = plan.grid.tiles;
  const step = Math.max(1, Math.round(tiles / 768));
  const size = Math.floor(tiles / step);
  const zoomTiles = 160;
  const zoomScale = 4;
  const img = new RgbaImage(size + zoomTiles * zoomScale + 48, Math.max(size, zoomTiles * zoomScale) + 60);
  img.fillRect(0, 0, img.width, img.height, BG);
  label(img, 16, 8, `HOEHE 0-4 ${SIZE_LABEL[plan.preset]} SEED ${plan.seed} RAMPEN ${plan.ramps.filter((r) => r.kind === 'rampe').length} TREPPEN ${plan.ramps.filter((r) => r.kind === 'treppe').length}`);
  const levelAt = (tx: number, ty: number): number => {
    sampler.sample(tx, ty, s);
    return s.land ? s.level : -1;
  };
  const colorAt = (tx: number, ty: number): Rgba => {
    sampler.sample(tx, ty, s);
    if (!s.land) return s.water & WATER_DEPTH_DEEP ? SEA_DEEP : SEA_SHALLOW;
    if (s.flags & TILE_FLAG_STAIRS) return STAIRS;
    if (s.flags & TILE_FLAG_RAMP) return RAMP;
    if (s.water & (WATER_LAKE | WATER_RIVER)) return mix(LEVEL_COLOR[s.level] as Rgba, LAKE, 0.6);
    const lv = s.level;
    let col = LEVEL_COLOR[lv] as Rgba;
    // Cliff line: a lower tile below or to the right.
    const down = levelAt(tx, ty + step);
    const right = levelAt(tx + step, ty);
    if ((down >= 0 && down < lv) || (right >= 0 && right < lv)) col = shade(col, 0.45);
    return col;
  };
  img.drawScaled(16, 40, size, size, 1, (x, y) => colorAt(x * step, y * step));
  // Zoom: the densest ramp area.
  const target = plan.ramps.reduce(
    (best, r) => {
      const n = plan.ramps.filter((q) => Math.abs(q.x - r.x) < zoomTiles / 2 && Math.abs(q.y - r.y) < zoomTiles / 2).length;
      return n > best.n ? { n, x: r.x, y: r.y } : best;
    },
    { n: -1, x: tiles / 2, y: tiles / 2 },
  );
  const zx = Math.max(0, Math.min(tiles - zoomTiles, Math.round(target.x - zoomTiles / 2)));
  const zy = Math.max(0, Math.min(tiles - zoomTiles, Math.round(target.y - zoomTiles / 2)));
  const zox = size + 32;
  img.strokeRect(16 + zx / step - 1, 40 + zy / step - 1, zoomTiles / step + 2, zoomTiles / step + 2, WHITE);
  label(img, zox, 24, `ZOOM ${zoomTiles}X${zoomTiles} TILES`, 1);
  const zoomColor = (tx: number, ty: number): Rgba => {
    sampler.sample(tx, ty, s);
    if (!s.land) return s.water & WATER_DEPTH_DEEP ? SEA_DEEP : SEA_SHALLOW;
    if (s.flags & TILE_FLAG_STAIRS) return STAIRS;
    if (s.flags & TILE_FLAG_RAMP) return RAMP;
    if (s.water & (WATER_LAKE | WATER_RIVER)) return mix(LEVEL_COLOR[s.level] as Rgba, LAKE, 0.6);
    const lv = s.level;
    const down = levelAt(tx, ty + 1);
    const right = levelAt(tx + 1, ty);
    const col = LEVEL_COLOR[lv] as Rgba;
    return (down >= 0 && down < lv) || (right >= 0 && right < lv) ? shade(col, 0.45) : col;
  };
  img.drawScaled(zox, 40, zoomTiles, zoomTiles, zoomScale, (x, y) => zoomColor(zx + x, zy + y));
  // Level legend.
  LEVEL_COLOR.forEach((c, i) => {
    img.fillRect(zox + i * 70, 40 + zoomTiles * zoomScale + 8, 14, 14, c);
    label(img, zox + i * 70 + 18, 40 + zoomTiles * zoomScale + 10, `L${i}`, 1);
  });
  return img;
}

function waterImage(plan: WorldPlan): RgbaImage {
  const sampler = createPlanSampler(plan);
  const s = createTerrainSample();
  const tiles = plan.grid.tiles;
  const step = Math.max(1, Math.round(tiles / 768));
  const size = Math.floor(tiles / step);
  const zoomTiles = 128;
  const zoomScale = 5;
  const img = new RgbaImage(size + zoomTiles * zoomScale + 48, Math.max(size, zoomTiles * zoomScale) + 60);
  img.fillRect(0, 0, img.width, img.height, BG);
  const rivers = plan.rivers.filter((r) => r.kind === 'fluss').length;
  label(img, 16, 8, `WASSER ${SIZE_LABEL[plan.preset]} FLUESSE ${rivers} BAECHE ${plan.rivers.length - rivers} SEEN ${plan.lakes.length} FURTEN ${plan.fords.length}`);
  const land = (lv: number): Rgba => mix(hexRgba('#cbc9c3'), hexRgba('#5f6377'), lv / 4);
  const colorAt = (tx: number, ty: number): Rgba => {
    sampler.sample(tx, ty, s);
    if (s.water & WATER_SEA) return (s.water & WATER_DEPTH_MASK) === WATER_DEPTH_DEEP ? SEA_DEEP : SEA_SHALLOW;
    if (s.water & WATER_LAKE) return (s.water & WATER_DEPTH_MASK) === WATER_DEPTH_DEEP ? shade(LAKE, 0.75) : LAKE;
    if (s.water & WATER_SPRING) return SPRING;
    if (s.flags & TILE_FLAG_FORD) return FORD;
    if (s.water & WATER_RIVER) return (s.water & WATER_DEPTH_MASK) === WATER_DEPTH_DEEP ? shade(RIVER, 0.7) : RIVER;
    return land(s.level);
  };
  // Overview: rivers are thinner than a pixel at this scale, so draw the polylines on top.
  img.drawScaled(16, 40, size, size, 1, (x, y) => colorAt(x * step, y * step));
  for (const r of plan.rivers) {
    for (let i = 0; i + 1 < r.xs.length; i++) {
      line(img, 16 + (r.xs[i] as number) / step, 40 + (r.ys[i] as number) / step, 16 + (r.xs[i + 1] as number) / step, 40 + (r.ys[i + 1] as number) / step, r.kind === 'bach' ? STREAM : RIVER);
    }
  }
  for (const r of plan.rivers) if (r.fromLake < 0) disc(img, 16 + (r.xs[0] as number) / step, 40 + (r.ys[0] as number) / step, 2, SPRING);
  for (const f of plan.fords) disc(img, 16 + f.x / step, 40 + f.y / step, 2, FORD);
  // Zoom on the widest river near its mouth.
  const widest = [...plan.rivers].sort((a, b) => (b.width[b.width.length - 1] as number) - (a.width[a.width.length - 1] as number))[0];
  const fx = widest ? (widest.xs[Math.floor(widest.xs.length * 0.7)] as number) : tiles / 2;
  const fy = widest ? (widest.ys[Math.floor(widest.ys.length * 0.7)] as number) : tiles / 2;
  const zx = Math.max(0, Math.min(tiles - zoomTiles, Math.round(fx - zoomTiles / 2)));
  const zy = Math.max(0, Math.min(tiles - zoomTiles, Math.round(fy - zoomTiles / 2)));
  const zox = size + 32;
  img.strokeRect(16 + zx / step - 1, 40 + zy / step - 1, zoomTiles / step + 2, zoomTiles / step + 2, WHITE);
  label(img, zox, 24, `ZOOM ${zoomTiles}X${zoomTiles} TILES`, 1);
  img.drawScaled(zox, 40, zoomTiles, zoomTiles, zoomScale, (x, y) => colorAt(zx + x, zy + y));
  return img;
}

function biomeImage(plan: WorldPlan): RgbaImage {
  const sampler = createBiomeSampler(plan);
  const terrain = createPlanSampler(plan);
  const b = createBiomeSample();
  const t = createTerrainSample();
  const blue = createBlueNoiseTile(plan.seed);
  const tiles = plan.grid.tiles;
  const step = Math.max(1, Math.round(tiles / 768));
  const size = Math.floor(tiles / step);
  const zoomTiles = 128;
  const zoomScale = 5;
  const img = new RgbaImage(size + zoomTiles * zoomScale + 48, Math.max(size, zoomTiles * zoomScale) + 60);
  img.fillRect(0, 0, img.width, img.height, BG);
  label(img, 16, 8, `BIOME MIT UEBERGANGSSTREIFEN ${SIZE_LABEL[plan.preset]} SEED ${plan.seed}`);
  const colorAt = (tx: number, ty: number, strips: boolean): Rgba => {
    terrain.sample(tx, ty, t);
    if (!t.land) return (t.water & WATER_DEPTH_MASK) === WATER_DEPTH_DEEP ? SEA_DEEP : SEA_SHALLOW;
    sampler.sample(tx, ty, b);
    const biome = pickBiome(b, blueNoiseAt(blue, tx, ty));
    const col = BIOME_COLOR[biome] as Rgba;
    return strips && b.blend > 0 ? shade(col, 0.8 + 0.2 * (1 - 2 * b.blend)) : col;
  };
  img.drawScaled(16, 40, size, size, 1, (x, y) => colorAt(x * step, y * step, false));
  // Zoom on a Grünhain–Frostkamm strip (the taiga of §9.2.6), else on any strip.
  const green = PLAN_BIOME_IDS.indexOf('gruenhain');
  const frost = PLAN_BIOME_IDS.indexOf('frostkamm');
  const taiga: [number, number][] = [];
  const anyStrip: [number, number][] = [];
  for (let y = 0; y < tiles; y += step * 4) {
    for (let x = 0; x < tiles; x += step * 4) {
      sampler.sample(x, y, b);
      if (b.blend <= 0) continue;
      anyStrip.push([x, y]);
      if ((b.primary === green && b.secondary === frost) || (b.primary === frost && b.secondary === green)) taiga.push([x, y]);
    }
  }
  const pick = (taiga.length > 0 ? taiga : anyStrip)[Math.floor((taiga.length > 0 ? taiga : anyStrip).length / 2)] ?? [tiles / 2, tiles / 2];
  const [cx, cy] = pick;
  const zx = Math.max(0, Math.min(tiles - zoomTiles, Math.round(cx - zoomTiles / 2)));
  const zy = Math.max(0, Math.min(tiles - zoomTiles, Math.round(cy - zoomTiles / 2)));
  const zox = size + 32;
  img.strokeRect(16 + zx / step - 1, 40 + zy / step - 1, zoomTiles / step + 2, zoomTiles / step + 2, WHITE);
  label(img, zox, 24, `ZOOM ${zoomTiles}X${zoomTiles} TILES ${taiga.length > 0 ? 'GRUENHAIN-FROSTKAMM (TAIGA)' : 'STREIFEN'}, STREIFEN ABGEDUNKELT`, 1);
  img.drawScaled(zox, 40, zoomTiles, zoomTiles, zoomScale, (x, y) => colorAt(zx + x, zy + y, true));
  return img;
}

function main(): void {
  const seed = Number(arg('seed') ?? DEFAULT_SEED);
  const size = (arg('size') ?? 'medium') as WorldSizePreset;
  if (!SIZES.includes(size)) throw new Error(`--size must be one of ${SIZES.join(', ')}`);
  const only = arg('only')?.split(',');
  mkdirSync(OUT_DIR, { recursive: true });
  let planCache: WorldPlan | null = null;
  const plan = (): WorldPlan => (planCache ??= generateWorldPlan(seed, size));
  let worldCache: GeneratedWorld | null = null;
  const world = (): GeneratedWorld => (worldCache ??= generateWorld(seed, size));
  const images: [string, () => RgbaImage][] = [
    ['weltgen-regionen', () => regionsImage(seed)],
    ['weltgen-biomzuweisung', () => biomeAssignmentImage(seed, size)],
    ['weltgen-hoehe', () => heightImage(plan())],
    ['weltgen-wasser', () => waterImage(plan())],
    ['weltgen-biome', () => biomeImage(plan())],
    ['weltgen-orte', () => placesImage(world())],
    ['weltgen-dichte', () => densityImage(world())],
  ];
  for (const [name, make] of images) {
    if (only !== undefined && !only.includes(name)) continue;
    const img = make();
    const file = join(OUT_DIR, `${name}.png`);
    writeFileSync(file, img.toPng(6));
    console.info(`${file} (${img.width}×${img.height})`);
  }
}

main();
