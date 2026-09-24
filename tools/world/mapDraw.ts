/**
 * Drawing helpers for the world debug images (tools/world/debugImages.ts, tools/world/weltkarte.ts):
 * biome colours (docs/ART.md colour identity), location markers, roads, the surface map rendered
 * from real chunks and small views of the cave network. Tools only – the game draws its map in M5.
 */
import { flatPalette, paletteIndex } from '../../assets-src/palette';
import { BIOMES } from '../../src/content/biomes';
import { TILE_FLAG_BRIDGE, TILE_FLAG_CLIFF_EDGE, TILE_FLAG_FORD, TILE_FLAG_PLACE, TILE_FLAG_RAMP, TILE_FLAG_ROAD, TILE_FLAG_STAIRS, WATER_DEPTH_DEEP, WATER_DEPTH_MASK, WATER_LAKE, WATER_RIVER, WATER_SEA } from '../../src/world/model/chunk';
import { CHUNK_SIZE } from '../../src/world/model/coords';
import { contentWorldIdTables } from '../../src/world/model/runtimeIds';
import { PLAN_BIOME_IDS } from '../../src/world/gen/plan/index';
import { generateChunk } from '../../src/world/gen/chunk';
import type { LocationType } from '../../src/world/gen/locations';
import type { GeneratedWorld } from '../../src/world/gen/world';
import { layerPlanOf, type UndergroundLayer } from '../../src/world/gen/underground/index';
import { drawText, textWidth } from '../lib/font';
import { RgbaImage, hexRgba, type Rgba } from '../lib/image';

export const BG: Rgba = [24, 22, 30, 255];
export const WHITE: Rgba = [255, 255, 255, 255];
export const BLACK: Rgba = [0, 0, 0, 255];
export const SEA_DEEP: Rgba = hexRgba('#10203f');
export const SEA_SHALLOW: Rgba = hexRgba('#1f5680');
export const LAKE: Rgba = hexRgba('#2e7f9e');
export const RIVER: Rgba = hexRgba('#4fb0b8');
export const ROAD: Rgba = hexRgba('#e8d5a3');
export const BRIDGE: Rgba = hexRgba('#8a5a35');
export const FORD: Rgba = hexRgba('#d4471e');
export const RAMP: Rgba = hexRgba('#fbb938');
export const LAVA: Rgba = hexRgba('#ff5a1f');

/** Debug colour of each biome: its first ground colour (docs/ART.md §5) not already taken by an earlier biome. */
export const BIOME_COLOR: readonly Rgba[] = (() => {
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

export function shade(c: Rgba, f: number): Rgba {
  const k = (v: number): number => Math.max(0, Math.min(255, Math.round(v * f)));
  return [k(c[0]), k(c[1]), k(c[2]), 255];
}

export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t), 255];
}

export function line(img: RgbaImage, x0: number, y0: number, x1: number, y1: number, c: Rgba, dash = 0): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= steps; i++) {
    if (dash > 0 && Math.floor(i / dash) % 2 === 1) continue;
    img.setPixel(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, c);
  }
}

export function disc(img: RgbaImage, x: number, y: number, r: number, c: Rgba): void {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) img.setPixel(x + dx, y + dy, c);
}

export function ring(img: RgbaImage, x: number, y: number, r: number, c: Rgba): void {
  const steps = Math.max(8, Math.ceil(r * 7));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    img.setPixel(x + Math.cos(a) * r, y + Math.sin(a) * r, c);
  }
}

export function label(img: RgbaImage, x: number, y: number, text: string, scale = 2, fg: Rgba = WHITE, bg: Rgba = BG): void {
  const w = textWidth(text, scale);
  img.fillRect(x - 2, y - 2, w + 4, 5 * scale + 4, bg);
  drawText(img, x, y, text, fg, scale);
}

/** Marker style per location type: code letter(s) and colour. */
export const LOCATION_STYLE: Readonly<Record<LocationType, { readonly code: string; readonly color: Rgba; readonly de: string }>> = {
  startstrand: { code: 'S', color: hexRgba('#ffffff'), de: 'STARTSTRAND' },
  leuchtfeuer: { code: 'L', color: hexRgba('#ffd23f'), de: 'LEUCHTFEUER' },
  bossarena: { code: 'A', color: hexRgba('#ff5e3a'), de: 'BOSS-ARENA' },
  nachtherz: { code: 'N', color: hexRgba('#c77dff'), de: 'NACHTHERZ' },
  gewoelbe: { code: 'G', color: hexRgba('#9ad1d4'), de: 'GEWOELBE' },
  aussichtsturm: { code: 'T', color: hexRgba('#f4f1de'), de: 'AUSSICHTSTURM' },
  gehoeft: { code: 'F', color: hexRgba('#e07a5f'), de: 'GEHOEFT' },
  wrack: { code: 'W', color: hexRgba('#a0785a'), de: 'WRACK' },
  mine: { code: 'M', color: hexRgba('#8d99ae'), de: 'MINE' },
  lager: { code: 'X', color: hexRgba('#d90429'), de: 'LAGER DER GEZEICHNETEN' },
  schrein: { code: '+', color: hexRgba('#80ffdb'), de: 'SCHREIN' },
  naturwunder: { code: '*', color: hexRgba('#b8f2e6'), de: 'NATURWUNDER' },
  haendlerplatz: { code: 'P', color: hexRgba('#ffb703'), de: 'HAENDLERPLATZ' },
  rettungsort: { code: 'R', color: hexRgba('#90be6d'), de: 'RETTUNGSORT' },
  buddelstelle: { code: '·', color: hexRgba('#cdb4db'), de: 'BUDDELSTELLE' },
  hoehlenlabyrinth: { code: 'Y', color: hexRgba('#6d6875'), de: 'HOEHLENLABYRINTH' },
  meteoritenkrater: { code: 'K', color: hexRgba('#f72585'), de: 'METEORITENKRATER' },
  eremitenhuette: { code: 'E', color: hexRgba('#bc6c25'), de: 'EREMITENHUETTE' },
  brueckenruine: { code: 'B', color: hexRgba('#8a5a35'), de: 'BRUECKENRUINE' },
  friedhof: { code: 'D', color: hexRgba('#adb5bd'), de: 'FRIEDHOF' },
  oase: { code: 'O', color: hexRgba('#06d6a0'), de: 'OASE' },
  hoehleneingang: { code: 'H', color: hexRgba('#3a0ca3'), de: 'HOEHLENEINGANG' },
};

/** Draws roads (polylines), bridges and location markers of a world at `scale` pixels per tile. */
export function drawFeatures(img: RgbaImage, world: GeneratedWorld, ox: number, oy: number, scale: number, markers = true): void {
  for (const r of world.roads.roads) {
    for (let i = 0; i + 1 < r.xs.length; i++) line(img, ox + (r.xs[i] as number) * scale, oy + (r.ys[i] as number) * scale, ox + (r.xs[i + 1] as number) * scale, oy + (r.ys[i + 1] as number) * scale, ROAD);
  }
  for (const b of world.bridges) line(img, ox + b.x0 * scale, oy + b.y0 * scale, ox + b.x1 * scale, oy + b.y1 * scale, BRIDGE);
  if (!markers) return;
  // Site ↔ arena links.
  for (const s of world.locations) {
    if ((s.type === 'leuchtfeuer' || s.type === 'nachtherz') && s.link >= 0) {
      const a = world.locations[s.link];
      if (a !== undefined) line(img, ox + s.x * scale, oy + s.y * scale, ox + a.x * scale, oy + a.y * scale, LOCATION_STYLE.bossarena.color, 2);
    }
  }
  for (const s of world.locations) {
    const st = LOCATION_STYLE[s.type];
    const x = ox + s.x * scale;
    const y = oy + s.y * scale;
    const r = Math.max(1, s.radius * scale);
    if (s.type === 'bossarena') {
      ring(img, x, y, r, st.color);
      ring(img, x, y, r + 1, BLACK);
      continue;
    }
    const big = s.type === 'leuchtfeuer' || s.type === 'nachtherz' || s.type === 'startstrand';
    const k = big ? 2 : 1;
    const text = s.type === 'leuchtfeuer' ? String(world.locations.filter((q) => q.type === 'leuchtfeuer').indexOf(s) + 1) : st.code;
    const w = textWidth(text, k);
    img.fillRect(x - w / 2 - 2, y - (5 * k) / 2 - 2, w + 4, 5 * k + 4, BLACK);
    img.fillRect(x - w / 2 - 1, y - (5 * k) / 2 - 1, w + 2, 5 * k + 2, st.color);
    drawText(img, Math.round(x - w / 2), Math.round(y - (5 * k) / 2), text, BLACK, k);
  }
}

/** Lookup tables of the content ids for `tileColor`. */
export interface ColorTables {
  /** Plan biome index per biome runtime id. */
  readonly biomeIndexOf: Uint8Array;
  /** 1 per tree object runtime id. */
  readonly treeIds: Uint8Array;
  /** Runtime id of the lava ground. */
  readonly lava: number;
}

/** Colour of one surface tile of a generated chunk. */
export function tileColor(chunk: ReturnType<typeof generateChunk>, i: number, tables: ColorTables): Rgba {
  const { biomeIndexOf, treeIds } = tables;
  const water = chunk.water[i] as number;
  const flags = chunk.flags[i] as number;
  const depth = water & WATER_DEPTH_MASK;
  if ((water & WATER_SEA) !== 0) return depth === WATER_DEPTH_DEEP ? SEA_DEEP : SEA_SHALLOW;
  if ((flags & TILE_FLAG_BRIDGE) !== 0) return BRIDGE;
  if ((flags & TILE_FLAG_FORD) !== 0) return FORD;
  if ((water & WATER_LAKE) !== 0) return depth === WATER_DEPTH_DEEP ? shade(LAKE, 0.8) : LAKE;
  if ((water & WATER_RIVER) !== 0) return depth === WATER_DEPTH_DEEP ? shade(RIVER, 0.75) : RIVER;
  if (chunk.ground[i] === tables.lava) return LAVA;
  if ((flags & TILE_FLAG_ROAD) !== 0) return ROAD;
  if ((flags & (TILE_FLAG_RAMP | TILE_FLAG_STAIRS)) !== 0 && (flags & TILE_FLAG_PLACE) === 0) return RAMP;
  const level = chunk.height[i] as number;
  let c = BIOME_COLOR[biomeIndexOf[chunk.biome[i] as number] as number] ?? WHITE;
  c = shade(c, 0.82 + 0.09 * level);
  if (treeIds[chunk.object[i] as number] === 1) c = shade(c, 0.72);
  if ((flags & TILE_FLAG_CLIFF_EDGE) !== 0) c = shade(c, 0.55);
  if ((flags & TILE_FLAG_PLACE) !== 0) c = mix(c, WHITE, 0.35);
  return c;
}

/** Builds the lookup tables of `tileColor`. */
export function colorTables(): ColorTables {
  const t = contentWorldIdTables();
  const biomeIndexOf = new Uint8Array(t.biomes.size + 1);
  PLAN_BIOME_IDS.forEach((id, i) => {
    biomeIndexOf[t.biomes.runtimeId(id)] = i;
  });
  const treeIds = new Uint8Array(t.objects.size + 1);
  for (const id of t.objects.ids()) if (id.startsWith('baum_')) treeIds[t.objects.runtimeId(id)] = 1;
  return { biomeIndexOf, treeIds, lava: t.terrain.runtimeId('lava') };
}

/**
 * The surface of a world from its real chunks, one pixel per `step` tiles (every chunk is generated
 * once). Returns the image and the generation time of all chunks [ms].
 */
export function renderSurface(world: GeneratedWorld, step: number, onRow?: (row: number, rows: number) => void): { img: RgbaImage; chunkMs: number; chunks: number } {
  const tiles = world.plan.grid.tiles;
  const size = Math.floor(tiles / step);
  const img = new RgbaImage(size, size);
  const tables = colorTables();
  const n = tiles / CHUNK_SIZE;
  let chunkMs = 0;
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const t0 = performance.now();
      const chunk = generateChunk(world, 0, cx, cy);
      chunkMs += performance.now() - t0;
      for (let ly = 0; ly < CHUNK_SIZE; ly += step) {
        for (let lx = 0; lx < CHUNK_SIZE; lx += step) img.setPixel((cx * CHUNK_SIZE + lx) / step, (cy * CHUNK_SIZE + ly) / step, tileColor(chunk, ly * CHUNK_SIZE + lx, tables));
      }
    }
    onRow?.(cy + 1, n);
  }
  return { img, chunkMs, chunks: n * n };
}

/** Cave network of an underground layer (tunnels, caverns, entrances and shafts) at `scale` px per tile. */
export function drawUnderground(img: RgbaImage, world: GeneratedWorld, layer: UndergroundLayer, ox: number, oy: number, scale: number): void {
  const tiles = world.plan.grid.tiles;
  img.fillRect(ox, oy, tiles * scale, tiles * scale, hexRgba('#15131b'));
  // Land outline for orientation.
  const g = world.plan.grid;
  for (let c = 0; c < g.count; c++) {
    if (world.plan.land[c] !== 1) continue;
    img.fillRect(ox + (c % g.width) * g.cellTiles * scale, oy + Math.floor(c / g.width) * g.cellTiles * scale, Math.max(1, g.cellTiles * scale), Math.max(1, g.cellTiles * scale), hexRgba('#262233'));
  }
  const lp = layerPlanOf(world.underground, layer);
  const colours: Record<number, Rgba> = { [-1]: hexRgba('#8d6e4b'), [-2]: hexRgba('#5f7ea8'), [-3]: hexRgba('#c8553d') };
  const col = colours[layer] ?? WHITE;
  for (const t of lp.tunnels) {
    for (let i = 0; i + 3 < t.points.length; i += 2) line(img, ox + (t.points[i] as number) * scale, oy + (t.points[i + 1] as number) * scale, ox + (t.points[i + 2] as number) * scale, oy + (t.points[i + 3] as number) * scale, col);
  }
  for (const n of lp.nodes) disc(img, ox + n.x * scale, oy + n.y * scale, Math.max(1, Math.round(n.coreRadius * scale)), col);
  for (const l of world.underground.links) {
    if (l.lower === layer) disc(img, ox + l.tx * scale, oy + l.ty * scale, 2, l.kind === 'eingang' ? LOCATION_STYLE.hoehleneingang.color : WHITE);
    if (l.upper === layer) disc(img, ox + l.tx * scale, oy + l.ty * scale, 2, RAMP);
  }
}
