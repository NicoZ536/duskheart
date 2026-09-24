/**
 * Debug images of world generation steps 7–8 (M2-10, M2-11), used by tools/world/debugImages.ts:
 * - weltgen-orte.png: biome map with the Builder roads, bridges, every place (marker per type,
 *   beacons numbered, arenas as rings, cave mouths) and a count table per type.
 * - weltgen-dichte.png: object density per chunk from the real chunks (trees, rocks, deposits,
 *   plants and scatter) plus a tile-level zoom around a beacon site with every object.
 */
import { contentWorldIdTables } from '../../src/world/model/runtimeIds';
import { CHUNK_SIZE } from '../../src/world/model/coords';
import { TILE_FLAG_BRIDGE, TILE_FLAG_CLIFF_EDGE, TILE_FLAG_PLACE, TILE_FLAG_RAMP, TILE_FLAG_ROAD, TILE_FLAG_STAIRS, WATER_DEPTH_DEEP, WATER_DEPTH_MASK, WATER_LAKE, WATER_RIVER, WATER_SEA } from '../../src/world/model/chunk';
import { PLAN_BIOME_IDS } from '../../src/world/gen/plan/index';
import { generateChunk } from '../../src/world/gen/chunk';
import { LOCATION_TYPES } from '../../src/world/gen/locations';
import type { GeneratedWorld } from '../../src/world/gen/world';
import { drawText } from '../lib/font';
import { RgbaImage, hexRgba, type Rgba } from '../lib/image';
import { BG, BIOME_COLOR, BRIDGE, LAKE, LOCATION_STYLE, RAMP, RIVER, ROAD, SEA_DEEP, SEA_SHALLOW, WHITE, drawFeatures, label, mix, shade } from './mapDraw';

const SIZE_LABEL: Record<string, string> = { small: 'KLEIN', medium: 'MITTEL', large: 'GROSS' };

/** Places, roads and bridges over the region biomes (plan cells). */
export function placesImage(world: GeneratedWorld): RgbaImage {
  const { plan } = world;
  const g = plan.grid;
  const scale = Math.max(1, Math.floor(832 / g.width));
  const size = g.width * scale;
  const img = new RgbaImage(size + 360, size + 64);
  img.fillRect(0, 0, img.width, img.height, BG);
  const ox = 16;
  const oy = 48;
  img.drawScaled(ox, oy, g.width, g.height, scale, (x, y) => {
    const c = y * g.width + x;
    const r = plan.region[c] as number;
    if (r < 0) return SEA_DEEP;
    if ((plan.lake[c] as number) >= 0) return LAKE;
    const col = BIOME_COLOR[PLAN_BIOME_IDS.indexOf(plan.regions[r]?.biome ?? '')] ?? WHITE;
    return shade(col, 0.8 + 0.08 * (plan.level[c] as number));
  });
  // Rivers (thin), then roads, bridges and places.
  const px = scale / g.cellTiles;
  for (const r of plan.rivers) {
    for (let i = 0; i + 1 < r.xs.length; i++) {
      const x0 = ox + (r.xs[i] as number) * px;
      const y0 = oy + (r.ys[i] as number) * px;
      img.setPixel(x0, y0, RIVER);
    }
  }
  drawFeatures(img, world, ox, oy, px);
  const rep = world.report;
  label(img, 16, 8, `ORTE UND STRASSEN ${SIZE_LABEL[world.preset] ?? ''} SEED ${world.seed}: ${world.locations.length} ORTE, ${rep.roads.count} STRASSEN (${Math.round(rep.roads.lengthTiles)} TILES), ${world.bridges.length} BRUECKEN`);
  let ly = oy;
  const lx = ox + size + 20;
  label(img, lx, ly, 'TYP        ANZAHL', 2);
  ly += 22;
  for (const type of LOCATION_TYPES) {
    const st = LOCATION_STYLE[type];
    const n = world.locations.filter((s) => s.type === type).length;
    img.fillRect(lx, ly, 14, 12, [0, 0, 0, 255]);
    img.fillRect(lx + 1, ly + 1, 12, 10, st.color);
    drawText(img, lx + 5, ly + 3, st.code, [0, 0, 0, 255], 1);
    drawText(img, lx + 22, ly + 3, `${st.de}: ${n}`, WHITE, 1);
    ly += 16;
  }
  ly += 10;
  const lines = [
    `REPARATUREN: ${rep.repairs}`,
    `  RAMPEN ${rep.reachability.rampsAdded}  FURTEN ${rep.reachability.fordsAdded}  BRUECKEN ${rep.reachability.bridgesAdded}`,
    `  NACHGESTREUT ${rep.resources.rescattered}`,
    `UNERREICHBAR VORHER ${rep.reachability.unreachableBefore} NACHHER ${rep.reachability.unreachableAfter}`,
    `STRASSENNETZ VERBUNDEN: ${rep.roads.connected ? 'JA' : 'NEIN'}`,
    `PROBLEME: ${rep.problems.length}`,
  ];
  for (const l of lines) {
    drawText(img, lx, ly, l, WHITE, 1);
    ly += 10;
  }
  return img;
}

/** Ground colours of the zoom (terrain ids, readable, not the game palette). */
const GROUND_COLOR: Readonly<Record<string, string>> = {
  gras: '#5d9c3e',
  erde: '#8a6a45',
  sand: '#e2cf8e',
  schnee: '#e9f1f6',
  asche: '#4a4550',
  kristallboden: '#6fa3b8',
  moorschlamm: '#4e5a3f',
  torf: '#5a4630',
  meeresgrund: '#1f5680',
  strasse: '#cfc3a8',
  eis: '#bfe3f2',
  lava: '#ff6a1f',
};

/** Object colours of the zoom by kind. */
const OBJECT_COLOR: Readonly<Record<string, Rgba>> = {
  baum: hexRgba('#1f4d24'),
  fels: hexRgba('#8d8d8d'),
  busch: hexRgba('#c0392b'),
  pflanze: hexRgba('#f7e27d'),
  erz: hexRgba('#ff7b00'),
  kristall: hexRgba('#b388ff'),
  deko: hexRgba('#ffffff'),
};

/** Object density per chunk and a tile zoom. */
export function densityImage(world: GeneratedWorld): RgbaImage {
  const t = contentWorldIdTables();
  const kindOf = new Uint8Array(t.objects.size + 1);
  const KINDS = ['baum', 'fels', 'vorkommen', 'pflanze', 'deko'] as const;
  const depositSet = new Set(world.resources.objects);
  for (const id of t.objects.ids()) {
    const rid = t.objects.runtimeId(id);
    const kind = id.split('_')[0] as string;
    kindOf[rid] = depositSet.has(id) ? 3 : kind === 'baum' ? 1 : kind === 'fels' ? 2 : kind === 'pflanze' ? 4 : 5;
  }
  const n = world.plan.grid.tiles / CHUNK_SIZE;
  const counts = KINDS.map(() => new Float64Array(n * n));
  let t0 = performance.now();
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const chunk = generateChunk(world, 0, cx, cy);
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
        const k = kindOf[chunk.object[i] as number] as number;
        if (k === 0) continue;
        const arr = counts[k - 1] as Float64Array;
        arr[cy * n + cx] = (arr[cy * n + cx] as number) + 1;
      }
    }
  }
  const chunkMs = performance.now() - t0;
  const cell = Math.max(3, Math.floor(300 / n));
  const panel = n * cell;
  const zoomTiles = 96;
  const zoomScale = 6;
  const img = new RgbaImage(2 * (panel + 16) + zoomTiles * zoomScale + 48, Math.max(3 * (panel + 36), zoomTiles * zoomScale + 60) + 48);
  img.fillRect(0, 0, img.width, img.height, BG);
  label(img, 16, 8, `OBJEKTDICHTE JE CHUNK ${SIZE_LABEL[world.preset] ?? ''} SEED ${world.seed} (${n * n} CHUNKS IN ${(chunkMs / 1000).toFixed(1)} S)`);
  const titles = ['BAEUME', 'FELSEN', 'VORKOMMEN (ERZ KRISTALL BUSCH KRAUT OBST)', 'PFLANZEN', 'STREUDEKO'];
  const heat = (v: number): Rgba => {
    const stops: Rgba[] = [hexRgba('#10203f'), hexRgba('#2a9d8f'), hexRgba('#e9c46a'), hexRgba('#e76f51'), hexRgba('#ffffff')];
    const f = Math.max(0, Math.min(0.999, v)) * (stops.length - 1);
    const i = Math.floor(f);
    return mix(stops[i] as Rgba, stops[i + 1] as Rgba, f - i);
  };
  KINDS.forEach((_, k) => {
    const arr = counts[k] as Float64Array;
    let max = 0;
    for (const v of arr) max = Math.max(max, v);
    const px = 16 + (k % 2) * (panel + 16);
    const py = 40 + Math.floor(k / 2) * (panel + 36);
    drawText(img, px, py, `${titles[k] ?? ''} MAX ${max}/CHUNK`, WHITE, 1);
    img.drawScaled(px, py + 10, n, n, cell, (x, y) => {
      const c = world.plan.grid.width * Math.floor((y * CHUNK_SIZE + 16) / world.plan.grid.cellTiles) + Math.floor((x * CHUNK_SIZE + 16) / world.plan.grid.cellTiles);
      if (world.plan.land[c] !== 1 && (arr[y * n + x] as number) === 0) return SEA_DEEP;
      return heat(max > 0 ? (arr[y * n + x] as number) / max : 0);
    });
  });
  // Zoom around the first beacon site.
  const site = world.locations.find((s) => s.type === 'leuchtfeuer') ?? world.locations[0];
  const zx0 = Math.max(0, Math.min(world.plan.grid.tiles - zoomTiles, (site?.x ?? 0) - zoomTiles / 2));
  const zy0 = Math.max(0, Math.min(world.plan.grid.tiles - zoomTiles, (site?.y ?? 0) - zoomTiles / 2));
  const zox = 2 * (panel + 16) + 32;
  const zoy = 52;
  label(img, zox, 28, `ZOOM ${zoomTiles}X${zoomTiles} TILES UM LEUCHTFEUER 1 (${site?.variant ?? ''})`, 1);
  const groundColor = new Map<number, Rgba>();
  for (const [id, hex] of Object.entries(GROUND_COLOR)) groundColor.set(t.terrain.runtimeId(id), hexRgba(hex));
  t0 = performance.now();
  const cache = new Map<string, ReturnType<typeof generateChunk>>();
  const chunkAt = (tx: number, ty: number): ReturnType<typeof generateChunk> => {
    const key = `${Math.floor(tx / CHUNK_SIZE)}:${Math.floor(ty / CHUNK_SIZE)}`;
    let c = cache.get(key);
    if (c === undefined) {
      c = generateChunk(world, 0, Math.floor(tx / CHUNK_SIZE), Math.floor(ty / CHUNK_SIZE));
      cache.set(key, c);
    }
    return c;
  };
  for (let y = 0; y < zoomTiles; y++) {
    for (let x = 0; x < zoomTiles; x++) {
      const tx = zx0 + x;
      const ty = zy0 + y;
      const c = chunkAt(tx, ty);
      const i = (ty % CHUNK_SIZE) * CHUNK_SIZE + (tx % CHUNK_SIZE);
      const water = c.water[i] as number;
      const flags = c.flags[i] as number;
      let col: Rgba = groundColor.get(c.ground[i] as number) ?? WHITE;
      if ((water & WATER_SEA) !== 0) col = (water & WATER_DEPTH_MASK) === WATER_DEPTH_DEEP ? SEA_DEEP : SEA_SHALLOW;
      else if ((water & (WATER_RIVER | WATER_LAKE)) !== 0) col = (water & WATER_DEPTH_MASK) === WATER_DEPTH_DEEP ? shade(RIVER, 0.7) : RIVER;
      col = shade(col, 0.85 + 0.07 * (c.height[i] as number));
      if ((flags & TILE_FLAG_ROAD) !== 0) col = ROAD;
      if ((flags & TILE_FLAG_BRIDGE) !== 0) col = BRIDGE;
      if ((flags & (TILE_FLAG_RAMP | TILE_FLAG_STAIRS)) !== 0) col = mix(col, RAMP, 0.6);
      if ((flags & TILE_FLAG_CLIFF_EDGE) !== 0) col = shade(col, 0.5);
      const bx = zox + x * zoomScale;
      const by = zoy + y * zoomScale;
      img.fillRect(bx, by, zoomScale, zoomScale, col);
      if ((flags & TILE_FLAG_PLACE) !== 0) img.fillRect(bx, by, zoomScale, 1, mix(col, WHITE, 0.7));
      const o = c.object[i] as number;
      if (o !== 0) {
        const id = t.objects.stringId(o);
        const oc = OBJECT_COLOR[id.split('_')[0] as string] ?? WHITE;
        const inset = id.startsWith('deko_') ? 2 : 1;
        img.fillRect(bx + inset, by + inset, zoomScale - 2 * inset, zoomScale - 2 * inset, depositSet.has(id) ? mix(oc, WHITE, 0.15) : oc);
      }
    }
  }
  // Legend of the zoom.
  let lx = zox;
  const ly = zoy + zoomTiles * zoomScale + 8;
  for (const [kind, c] of Object.entries(OBJECT_COLOR)) {
    img.fillRect(lx, ly, 10, 10, c);
    drawText(img, lx + 14, ly + 2, kind, WHITE, 1);
    lx += 70;
  }
  return img;
}
