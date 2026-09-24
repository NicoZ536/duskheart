/**
 * M2-29 debug overlays of the game view (src/render/debugOverlay.ts, src/render/world/overlays.ts):
 * the pooled overlay list, the chunk overlay (state per chunk, a label in every visible chunk), the
 * collision overlay (exactly the tiles `CollisionGrid` blocks, ramps marked) and the temperature field
 * (a band colour per tile, labels every eight tiles) – on a hand-made world of four chunks.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { GameClock } from '../../../src/engine/time';
import { DebugOverlayList } from '../../../src/render/debugOverlay';
import { TEMPERATURE_BANDS, WorldOverlays, temperatureBand, temperatureLabel, type OverlayWorld } from '../../../src/render/world/overlays';
import { Calendar } from '../../../src/world/calendar';
import { TemperatureField } from '../../../src/world/climate';
import { ChunkData, TILE_FLAG_RAMP, WATER_DEPTH_DEEP } from '../../../src/world/model/chunk';
import type { Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';

const ids = contentWorldIdTables();
const CHUNK_PX = 512;
const TILE = 16;

/** Four chunks at (0,0) active, (1,0) frozen; (0,1) loading, (1,1) missing (not resident). */
function world(temperature: TemperatureField | null): OverlayWorld & { chunks: Map<string, ChunkData> } {
  const chunks = new Map<string, ChunkData>();
  for (const [cx, cy] of [
    [0, 0],
    [1, 0],
  ] as const) {
    const c = new ChunkData(0, cx, cy);
    c.ground.fill(ids.terrain.runtimeId('gras'));
    c.biome.fill(ids.biomes.runtimeId('gruenhain'));
    chunks.set(`${cx}:${cy}`, c);
  }
  const a = chunks.get('0:0') as ChunkData;
  a.solid[5 * 32 + 5] = ids.terrain.runtimeId('fels');
  a.water[6 * 32 + 6] = WATER_DEPTH_DEEP;
  a.flags[7 * 32 + 7] = TILE_FLAG_RAMP;
  return {
    chunks,
    layer: 0,
    worldTiles: 1024,
    temperature,
    get: (layer: Layer, cx: number, cy: number) => (layer === 0 ? chunks.get(`${cx}:${cy}`) : undefined),
    isLoading: (_l, cx, cy) => cx === 0 && cy === 1,
    isActive: (_l, cx, cy) => cx === 0 && cy === 0,
  };
}

function field(chunks: Map<string, ChunkData>): TemperatureField {
  const clock = new GameClock({ tickHz: BALANCE.time.tickHz, worldTickHz: BALANCE.time.worldTickHz, dayLengthMinutes: 24 });
  return new TemperatureField({ calendar: new Calendar(clock), chunks: { get: (layer, cx, cy) => (layer === 0 ? chunks.get(`${cx}:${cy}`) : undefined) } });
}

describe('Debug-Overlays der Spielansicht', () => {
  it('the overlay list reuses its entries (no allocation in a steady frame)', () => {
    const list = new DebugOverlayList();
    list.rect(1, 2, 3, 4, 0xff0000ff);
    list.label(5, 6, 'x', 0xffffffff);
    const first = list.entry(0);
    list.clear();
    list.rect(7, 8, 9, 10, 0x00ff00ff);
    expect(list.entry(0)).toBe(first);
    expect(list.count).toBe(1);
    expect(list.entry(0)).toMatchObject({ kind: 'rect', x: 7, y: 8, width: 9, height: 10 });
    expect(list.entry(1)).toBeUndefined();
  });

  it('temperature bands run from cold to hot and labels are cached strings', () => {
    expect(temperatureBand(-100)).toBe(0);
    expect(temperatureBand(1000)).toBe(TEMPERATURE_BANDS.colors.length - 1);
    for (let c = -40; c < 60; c++) expect(temperatureBand(c + 1)).toBeGreaterThanOrEqual(temperatureBand(c));
    expect(temperatureLabel(15.6)).toBe('16°');
    expect(temperatureLabel(-4.4)).toBe('-4°');
    expect(temperatureLabel(15.6)).toBe(temperatureLabel(16.2));
  });

  it('chunks: every chunk in view is tinted and bordered by its state and named in its visible corner', () => {
    const w = world(null);
    const o = new WorldOverlays();
    o.enabled.chunks = true;
    const list = new DebugOverlayList();
    // The view straddles the four chunks' shared corner.
    o.fill(list, { left: CHUNK_PX - 240, right: CHUNK_PX + 240, top: CHUNK_PX - 135, bottom: CHUNK_PX + 135 }, w);
    expect(o.stats.chunks).toBe(4);
    const labels = [...Array(list.count).keys()].map((i) => list.entry(i)).filter((e) => e?.kind === 'label');
    expect(labels.map((e) => e?.text).sort()).toEqual(['0:0', '0:1', '1:0', '1:1']);
    // The label of chunk 0:0 sits in the view, not at the chunk's corner far outside.
    const l00 = labels.find((e) => e?.text === '0:0');
    expect(l00?.x).toBeGreaterThanOrEqual(CHUNK_PX - 240);
    // Four different state colours for the four tints.
    const tints = [...Array(list.count).keys()].map((i) => list.entry(i)).filter((e) => e?.kind === 'rect' && e.width === CHUNK_PX && e.height === CHUNK_PX);
    expect(new Set(tints.map((e) => e?.color)).size).toBe(4);
  });

  it('collision: exactly the blocking tiles, ramps as markers', () => {
    const w = world(null);
    const o = new WorldOverlays();
    o.enabled.kollision = true;
    const list = new DebugOverlayList();
    o.fill(list, { left: 0, right: 16 * TILE, top: 0, bottom: 16 * TILE }, w);
    // Solid rock and deep water in the window; nothing else blocks on the meadow.
    expect(o.stats.collisionTiles).toBe(2);
    const rects = [...Array(list.count).keys()].map((i) => list.entry(i));
    expect(rects.some((e) => e?.x === 5 * TILE && e.y === 5 * TILE && e.width === TILE)).toBe(true);
    expect(rects.some((e) => e?.x === 6 * TILE && e.y === 6 * TILE && e.width === TILE)).toBe(true);
    // The ramp tile: a smaller marker inside it.
    expect(rects.some((e) => e !== undefined && e.x > 7 * TILE && e.x < 8 * TILE && e.width < TILE)).toBe(true);
  });

  it('temperature: one band rect per visible tile of the resident chunks, a label every eight tiles', () => {
    const w = world(null);
    const t = field(w.chunks);
    const withField: OverlayWorld = { ...w, temperature: t };
    const o = new WorldOverlays();
    o.enabled.temperatur = true;
    const list = new DebugOverlayList();
    o.fill(list, { left: 0, right: 480, top: 0, bottom: 270 }, withField);
    expect(o.stats.temperatureTiles).toBe(30 * 17);
    const labels = [...Array(list.count).keys()].map((i) => list.entry(i)).filter((e) => e?.kind === 'label');
    // Label tiles at 4, 12, 20, 28 across and 4, 12 down.
    expect(labels).toHaveLength(4 * 2);
    expect(labels[0]?.text).toBe(temperatureLabel(t.temperatureAt(0, 4, 4)));
    // Nothing at all while every overlay is off.
    const off = new WorldOverlays();
    const empty = new DebugOverlayList();
    off.fill(empty, { left: 0, right: 480, top: 0, bottom: 270 }, withField);
    expect(empty.count).toBe(0);
  });
});
