/**
 * M1-13: chunk tile map – chunk versions, tile variants, the static per-chunk mesh and its
 * invalidation (a mesh is rebuilt only when its chunk changed), one draw call per visible chunk,
 * whole-pixel chunk offsets (no seams), and the debug scenes standing on it.
 */
import { describe, expect, it } from 'vitest';
import { atlasSprite, type AtlasData } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { sceneAtlas } from '../../../src/render/assets/sceneSprites';
import { DebugViews } from '../../../src/render/debugView';
import { GpuResourceRegistry } from '../../../src/render/gl/resources';
import { ShaderLibrary, ShaderSourceStore } from '../../../src/render/gl/shaders';
import { PASS_ORDER, PassRegistry, type PassSetup } from '../../../src/render/passes/registry';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { CHUNK_PX, CHUNK_TILES, chunkCoord, TileChunk, TILE_NONE, tileIndex, TILES_PER_CHUNK } from '../../../src/render/tilemap/chunk';
import { buildChunkMesh, TILE_FLAG_MIRROR, TILE_INSTANCE_STRIDE, TILE_OFFSET } from '../../../src/render/tilemap/chunkMesh';
import { sceneKitFor, TERRAIN } from '../../../src/render/tilemap/sceneKit';
import { TilemapProbeScene, TilemapScene } from '../../../src/render/tilemap/tilemapScene';
import { TILEMAP_ORDER, TileMapRenderer } from '../../../src/render/tilemap/tileMap';
import { tileHash01, TileSet, type TileVariant } from '../../../src/render/tilemap/tileSet';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { createFakeGl, type FakeGl } from './fakeGl';

const atlas = sceneAtlas();
const GRASS = 1;
const BARE = 2;
const tiles = new TileSet(atlas.manifest, [
  { id: GRASS, sprite: 'gras_boden', frames: [0, 1, 2], weights: [2, 1, 1], mirror: true },
  { id: BARE, sprite: 'gras_boden', frames: [5] },
]);

function frameOf(id: string, i: number) {
  const f = atlasSprite(atlas.manifest, id).frames[i];
  if (!f) throw new Error('frame');
  return f;
}

describe('TileChunk', () => {
  it('bumps its version only on real changes', () => {
    const c = new TileChunk(1, -2);
    expect(c.version).toBe(0);
    expect(c.set(3, 4, GRASS)).toBe(true);
    expect(c.version).toBe(1);
    expect(c.set(3, 4, GRASS)).toBe(false);
    expect(c.version).toBe(1);
    expect(c.groundAt(tileIndex(3, 4))).toBe(GRASS);
    c.fill(() => GRASS);
    expect(c.version).toBe(2);
    c.fill(() => GRASS);
    expect(c.version).toBe(2);
    expect(() => c.set(CHUNK_TILES, 0, GRASS)).toThrow(RangeError);
    expect(() => c.set(0, 0, -1)).toThrow(RangeError);
  });

  it('knows its place in the world grid', () => {
    expect(CHUNK_PX).toBe(512);
    expect(chunkCoord(0)).toBe(0);
    expect(chunkCoord(511.9)).toBe(0);
    expect(chunkCoord(512)).toBe(1);
    expect(chunkCoord(-1)).toBe(-1);
  });
});

describe('TileSet', () => {
  it('picks variants deterministically by world position, with weights and mirroring', () => {
    const v: TileVariant = { x: 0, y: 0, mirror: false };
    const counts = new Map<number, number>();
    let mirrored = 0;
    for (let wy = 0; wy < 64; wy++) {
      for (let wx = 0; wx < 64; wx++) {
        expect(tiles.resolve(GRASS, wx, wy, v)).toBe(true);
        const again: TileVariant = { x: 0, y: 0, mirror: false };
        tiles.resolve(GRASS, wx, wy, again);
        expect(again).toEqual(v);
        counts.set(v.x * 1000 + v.y, (counts.get(v.x * 1000 + v.y) ?? 0) + 1);
        if (v.mirror) mirrored++;
      }
    }
    const [a, b, c] = [0, 1, 2].map((i) => counts.get(frameOf('gras_boden', i).x * 1000 + frameOf('gras_boden', i).y) ?? 0);
    expect((a ?? 0) + (b ?? 0) + (c ?? 0)).toBe(64 * 64);
    // Weight 2:1:1 → about half the tiles show the first variant.
    expect((a ?? 0) / 4096).toBeGreaterThan(0.42);
    expect((a ?? 0) / 4096).toBeLessThan(0.58);
    expect(mirrored / 4096).toBeGreaterThan(0.4);
    expect(mirrored / 4096).toBeLessThan(0.6);
    expect(tileHash01(5, 7)).toBe(tileHash01(5, 7));
  });

  it('empty cells resolve to nothing, unknown ids and non-tile frames are errors', () => {
    const v: TileVariant = { x: 0, y: 0, mirror: false };
    expect(tiles.resolve(TILE_NONE, 0, 0, v)).toBe(false);
    expect(() => tiles.resolve(99, 0, 0, v)).toThrow(/nicht definiert/);
    expect(() => new TileSet(atlas.manifest, [{ id: 1, sprite: 'laubbaum' }])).toThrow(/statt 16×16/);
    expect(() => new TileSet(atlas.manifest, [{ id: 1, sprite: 'gras_boden' }, { id: 1, sprite: 'gras_boden' }])).toThrow(/doppelt/);
  });
});

describe('buildChunkMesh', () => {
  it('emits one 8-byte instance per non-empty tile: position, palette row, flags, atlas frame', () => {
    const c = new TileChunk(0, 0);
    c.set(0, 0, BARE, 3);
    c.set(31, 31, BARE);
    c.set(5, 2, GRASS);
    const { count, data } = buildChunkMesh(c, tiles);
    expect(count).toBe(3);
    expect(data.byteLength).toBe(3 * TILE_INSTANCE_STRIDE);
    const u16 = new Uint16Array(data.buffer);
    const bare = frameOf('gras_boden', 5);
    expect(Array.from(data.subarray(0, 4))).toEqual([0, 0, 3, 0]);
    expect([u16[TILE_OFFSET.rect / 2], u16[TILE_OFFSET.rect / 2 + 1]]).toEqual([bare.x, bare.y]);
    expect(Array.from(data.subarray(TILE_INSTANCE_STRIDE, TILE_INSTANCE_STRIDE + 2))).toEqual([5, 2]);
    expect((data[TILE_INSTANCE_STRIDE + 3] ?? 0) & ~TILE_FLAG_MIRROR).toBe(0);
    expect(Array.from(data.subarray(2 * TILE_INSTANCE_STRIDE, 2 * TILE_INSTANCE_STRIDE + 3))).toEqual([31, 31, 0]);
    const full = new TileChunk(0, 0);
    full.fill(() => GRASS);
    expect(buildChunkMesh(full, tiles).count).toBe(TILES_PER_CHUNK);
  });

  it('neighbouring chunks agree along their border (variants depend on world tiles only)', () => {
    const right = new TileChunk(1, 0);
    right.fill(() => GRASS);
    const u16 = new Uint16Array(buildChunkMesh(right, tiles).data.buffer);
    for (const ty of [0, 7, 31]) {
      const v: TileVariant = { x: 0, y: 0, mirror: false };
      tiles.resolve(GRASS, CHUNK_TILES, ty, v);
      const w = (tileIndex(0, ty) * TILE_INSTANCE_STRIDE + TILE_OFFSET.rect) / 2;
      expect([u16[w], u16[w + 1]]).toEqual([v.x, v.y]);
    }
  });
});

function passSetup(fake: FakeGl): PassSetup {
  const resources = new GpuResourceRegistry();
  const shaders = new ShaderLibrary(fake.gl, resources, new ShaderSourceStore(SHADERS), {}, { report: () => undefined });
  return { gl: fake.gl, resources, shaders, caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, debugViews: new DebugViews() };
}

describe('TileMapRenderer', () => {
  function setupMap() {
    const fake = createFakeGl();
    const setup = passSetup(fake);
    const passes = new PassRegistry(setup);
    const map = new TileMapRenderer();
    passes.add(map, TILEMAP_ORDER);
    const chunks = [new TileChunk(0, 0), new TileChunk(1, 0), new TileChunk(0, 1), new TileChunk(1, 1)];
    for (const c of chunks) c.fill(() => GRASS);
    map.setTiles(atlas, tiles);
    map.setChunks(chunks);
    return { fake, setup, passes, map, chunks };
  }

  it('runs right before the G-buffer pass', () => {
    expect(TILEMAP_ORDER).toBeLessThan(PASS_ORDER.gbuffer);
    expect(setupMap().passes.list().map((p) => p.name)).toEqual(['tilemap']);
  });

  it('builds each chunk mesh once and rebuilds only the chunk that changed', () => {
    const { map, chunks } = setupMap();
    expect(map.sync()).toBe(4);
    expect(map.sync()).toBe(0);
    expect(map.rebuilds).toBe(4);
    chunks[2]?.set(10, 10, BARE);
    chunks[2]?.set(11, 10, BARE);
    expect(map.sync()).toBe(1);
    expect(map.rebuilds).toBe(5);
    chunks[2]?.set(11, 10, BARE);
    expect(map.sync()).toBe(0);
    chunks[0]?.set(0, 0, TILE_NONE);
    expect(map.sync()).toBe(1);
    expect(map.tilesOf(chunks[0] ?? new TileChunk(9, 9))).toBe(TILES_PER_CHUNK - 1);
  });

  it('releases the meshes of chunks that leave the list and rebuilds all for a new tile set', () => {
    const { map, chunks, setup } = setupMap();
    map.sync();
    const withAll = setup.resources.count;
    map.setChunks(chunks.slice(0, 2));
    expect(map.sync()).toBe(0);
    expect(map.meshCount).toBe(2);
    // Each dropped chunk frees its instance buffer and vertex array.
    expect(setup.resources.count).toBe(withAll - 4);
    map.setTiles(atlas, new TileSet(atlas.manifest, [{ id: GRASS, sprite: 'gras_boden', frames: [4] }]));
    expect(map.sync()).toBe(2);
    const copy: AtlasData = { ...atlas, manifest: { ...atlas.manifest } };
    expect(() => map.setTiles(copy, tiles)).toThrow(/gehören nicht zusammen/);
  });

  it('draws one instanced call per visible chunk at whole-pixel offsets, inside the G-buffer pass', () => {
    const fake = createFakeGl();
    const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
    const map = new TileMapRenderer();
    r.passes.add(map, TILEMAP_ORDER);
    const chunks = [new TileChunk(0, 0), new TileChunk(1, 0), new TileChunk(0, 1), new TileChunk(1, 1)];
    for (const c of chunks) c.fill(() => GRASS);
    map.setTiles(atlas, tiles);
    map.setChunks(chunks);
    const scene = new RenderScene();
    scene.ground.push(map);
    // Camera on the corner of the four chunks (on a fractional position): all four are drawn.
    scene.camera.set(CHUNK_PX + 0.37, CHUNK_PX - 0.61);
    fake.calls.length = 0;
    r.render(scene, 960, 540, 'sharp');
    const draws = fake.calls.filter((c) => c.name === 'drawArraysInstanced');
    expect(draws.map((c) => c.args[3])).toEqual([1024, 1024, 1024, 1024]);
    expect(map.lastDrawCalls).toBe(4);
    // The chunk offset set right before each chunk's draw is a whole pixel (the camera fraction goes to the presentation).
    fake.calls.forEach((c, i) => {
      if (c.name !== 'drawArraysInstanced') return;
      const offset = fake.calls.slice(0, i).reverse().find((d) => d.name === 'uniform2f');
      expect(Number.isInteger(offset?.args[1]) && Number.isInteger(offset?.args[2]), String(offset?.args)).toBe(true);
    });
    expect(map.rebuilds).toBe(4);
    // Well inside chunk (0, 0) only that one is drawn; switched off, none.
    scene.camera.set(256, 256);
    r.render(scene, 960, 540, 'sharp');
    expect(map.lastDrawCalls).toBe(1);
    expect(map.rebuilds).toBe(4);
    r.passes.setEnabled('tilemap', false);
    r.render(scene, 960, 540, 'sharp');
    expect(map.lastDrawCalls).toBe(0);
  });

  it('gives its GPU resources back when removed', () => {
    const { passes, setup, map } = setupMap();
    map.sync();
    expect(setup.resources.count).toBeGreaterThan(0);
    passes.remove('tilemap');
    expect(setup.resources.count).toBe(0);
  });
});

describe('tile map scenes', () => {
  function gameAtlasData(): AtlasData | null {
    const mod = generatedAtlasModule();
    if (mod === null) return null;
    const empty = { kind: 'pixels', pixels: new Uint8Array(0) } as const;
    return { manifest: manifestFromGenerated(mod), albedo: empty, normal: empty };
  }

  it('the kit uses the game atlas (roads) and falls back to the scene atlas (meadow only)', () => {
    const game = gameAtlasData();
    if (game !== null) {
      const kit = sceneKitFor(game);
      expect(kit?.roads).toBe(true);
      expect(kit?.tiles.has(TERRAIN.dirt)).toBe(true);
      expect(kit?.probeTiles.variants(TERRAIN.grass)).toBe(1);
    }
    const fallback = sceneKitFor(atlas);
    expect(fallback?.roads).toBe(false);
    expect(fallback?.tiles.has(TERRAIN.grass)).toBe(true);
  });

  it('a scene adds its tile map while active and restores the environment it found', () => {
    const fake = createFakeGl();
    const r = new Renderer(fake.gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
    const scene = new RenderScene();
    const src = new TilemapScene(() => atlas);
    src.activate(r);
    expect(r.passes.get('tilemap')).toBeDefined();
    scene.env.ambientIntensity = 0.3;
    scene.beginFrame(0.5);
    src.fill(scene, 0.5);
    expect(src.ready()).toBe(true);
    expect(scene.ground).toHaveLength(1);
    expect(scene.env.ambientIntensity).toBe(1);
    expect(src.terrainChunks).toHaveLength(4);
    r.render(scene, 1920, 1080, 'sharp');
    src.deactivate(r);
    expect(r.passes.get('tilemap')).toBeUndefined();
    expect(scene.ground).toHaveLength(0);
    expect(scene.env.ambientIntensity).toBe(0.3);
  });

  it('is not ready while the game atlas loads', () => {
    const src = new TilemapProbeScene(() => null);
    const scene = new RenderScene();
    src.fill(scene, 0);
    // Without a generated atlas module the scene atlas stands in at once.
    expect(src.ready()).toBe(generatedAtlasModule() === null);
  });
});
