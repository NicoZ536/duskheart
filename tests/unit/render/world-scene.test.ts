/**
 * M2-28: world rendering integration – the terrain pass builds a chunk's mesh only on change (new
 * chunk, replaced chunk, content signature of the chunk or a neighbour) and releases meshes out of
 * range; the object layer (palette row rules, harvested frames, variants, y-sort layers, culling,
 * canopy fade in front of the focus); the showcase spots of the world scenes; keyboard panning; and
 * a world scene end to end (in-thread world, streaming, fake GL): ready, draw calls within §30, no
 * mesh build in a steady frame.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { AtlasData } from '../../../src/render/assets/atlas';
import { Renderer } from '../../../src/render/renderer';
import { RenderScene } from '../../../src/render/scene';
import { SHADERS } from '../../../src/render/shaderLib';
import { ShaderSourceStore } from '../../../src/render/gl/shaders';
import { PALETTE_HEX } from '../../../src/generated/palette';
import { DebugPanKeys, DEBUG_PAN_STEP } from '../../../src/render/world/debugCamera';
import { WorldObjectLayer, type ObjectView } from '../../../src/render/world/objects';
import { caveShowcase, surfaceShowcase } from '../../../src/render/world/showcase';
import { ChunkSignatures } from '../../../src/render/world/signature';
import { WorldRenderTables } from '../../../src/render/world/tables';
import { WORLD_TERRAIN_ORDER, WorldTerrainRenderer, type TerrainView } from '../../../src/render/world/terrainPass';
import { WORLD_SCENE_PRESET, WORLD_SCENE_SEED, WorldHost } from '../../../src/render/world/worldHost';
import { CANOPY_FADE, WORLD_SCENE_IDS, WorldScene } from '../../../src/render/world/worldScene';
import { RENDER_SCENE_IDS } from '../../../src/render/scenes/ids';
import { ChunkData } from '../../../src/world/model/chunk';
import type { Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { generateWorld, type GeneratedWorld } from '../../../src/world/gen/world';
import { layerPlanOf } from '../../../src/world/gen/underground/index';
import { createFakeGl } from './fakeGl';

const ids = contentWorldIdTables();
const T = (id: string): number => ids.terrain.runtimeId(id);
const B = (id: string): number => ids.biomes.runtimeId(id);
const O = (id: string): number => ids.objects.runtimeId(id);
const CS = 32;
const CHUNK_PX = 512;
const TILE = 16;

function gameAtlas(): AtlasData {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  const manifest = manifestFromGenerated(mod);
  const pixels = new Uint8Array(manifest.width * manifest.height * 4);
  return { manifest, albedo: { kind: 'pixels', pixels }, normal: { kind: 'pixels', pixels } };
}

function renderer(): Renderer {
  return new Renderer(createFakeGl().gl, { caps: { floatTargets: true, forcedRgba8: false, maxDrawBuffers: 8 }, sources: new ShaderSourceStore(SHADERS), errors: { report: () => undefined }, paletteHex: PALETTE_HEX });
}

/** Resident chunks of a test (grass meadow in Grünhain). */
class Chunks {
  readonly map = new Map<string, ChunkData>();

  get(layer: Layer, cx: number, cy: number): ChunkData | undefined {
    return this.map.get(`${layer}:${cx}:${cy}`);
  }

  add(cx: number, cy: number, fill?: (c: ChunkData) => void): ChunkData {
    const c = new ChunkData(0, cx, cy);
    c.ground.fill(T('gras'));
    c.biome.fill(B('gruenhain'));
    fill?.(c);
    this.map.set(`0:${cx}:${cy}`, c);
    return c;
  }
}

let atlas: AtlasData;
let tables: WorldRenderTables;

beforeAll(() => {
  atlas = gameAtlas();
  tables = new WorldRenderTables(atlas.manifest);
});

describe('Terrain-Pass: Meshes nur bei Änderung', () => {
  function setup(chunks: Chunks, inWorld?: (cx: number, cy: number) => boolean) {
    const r = renderer();
    const terrain = new WorldTerrainRenderer();
    r.passes.add(terrain, WORLD_TERRAIN_ORDER);
    const signatures = new ChunkSignatures();
    const view: TerrainView = inWorld === undefined ? { layer: 0, chunks, signatures } : { layer: 0, chunks, signatures, inWorld };
    terrain.setWorld(atlas, tables, view);
    const scene = new RenderScene();
    scene.ground.push(terrain);
    scene.atlas = atlas;
    const frame = (x: number, y: number): void => {
      signatures.beginFrame();
      scene.beginFrame(0);
      scene.camera.set(x, y);
      r.render(scene, 1920, 1080, 'sharp');
    };
    return { r, terrain, frame };
  }

  it('builds the visible chunks once, rebuilds after an edit (also next door), releases chunks out of range', () => {
    const chunks = new Chunks();
    for (let cy = -1; cy <= 4; cy++) for (let cx = -1; cx <= 4; cx++) chunks.add(cx, cy);
    const { r, terrain, frame } = setup(chunks, (cx, cy) => cx >= -1 && cx <= 4 && cy >= -1 && cy <= 4);
    // Camera on the corner of chunks (0,0)…(1,1): four chunks visible.
    frame(CHUNK_PX, CHUNK_PX);
    expect(terrain.stats.drawn).toBe(4);
    expect(terrain.stats.missing).toBe(0);
    expect(terrain.complete).toBe(true);
    const afterFirst = terrain.stats.builds;
    expect(afterFirst).toBeGreaterThanOrEqual(4);
    // Steady frames: no build beyond the ring's prefetch (one per frame until the ring is done).
    for (let i = 0; i < 20; i++) frame(CHUNK_PX, CHUNK_PX);
    const settled = terrain.stats.builds;
    frame(CHUNK_PX, CHUNK_PX);
    expect(terrain.stats.buildsLastFrame).toBe(0);
    expect(terrain.stats.builds).toBe(settled);
    // One draw call per visible chunk (§30).
    expect(r.stats.drawCalls).toBeLessThanOrEqual(30);
    // Editing a tile of chunk (2, 1) – outside the view – rebuilds the visible meshes whose 3×3 contains it: (1, 0) and (1, 1).
    (chunks.get(0, 2, 1) as ChunkData).ground[0] = T('sand');
    frame(CHUNK_PX, CHUNK_PX);
    expect(terrain.stats.buildsLastFrame).toBe(2);
    frame(CHUNK_PX, CHUNK_PX);
    expect(terrain.stats.buildsLastFrame).toBe(0);
    // A replaced chunk object (streamed out and in again) is rebuilt.
    chunks.add(0, 0);
    frame(CHUNK_PX, CHUNK_PX);
    expect(terrain.stats.buildsLastFrame).toBe(1);
    // Far away: the old meshes go.
    for (let i = 0; i < 3; i++) frame(CHUNK_PX * 4, CHUNK_PX * 4);
    expect(terrain.stats.meshes).toBeLessThanOrEqual(3 * 3 + 7);
    expect(r.resources.count).toBeGreaterThan(0);
  });

  it('reports holes and meshes with clamped borders until the chunks around them arrive', () => {
    // A world of two chunks side by side: (0, 0) and (1, 0).
    const chunks = new Chunks();
    chunks.add(0, 0);
    const inWorld = (cx: number, cy: number): boolean => cy === 0 && (cx === 0 || cx === 1);
    const { terrain, frame } = setup(chunks, inWorld);
    frame(CHUNK_PX / 2, CHUNK_PX / 2);
    expect(terrain.stats.drawn).toBe(1);
    expect(terrain.stats.partial).toBe(1);
    expect(terrain.complete).toBe(false);
    frame(CHUNK_PX, CHUNK_PX / 2);
    expect(terrain.stats.missing).toBe(1);
    chunks.add(1, 0);
    frame(CHUNK_PX, CHUNK_PX / 2);
    expect([terrain.stats.missing, terrain.stats.partial]).toEqual([0, 0]);
    expect(terrain.complete).toBe(true);
    // The arrival of (1, 0) also rebuilds (0, 0), whose border now continues into it.
    expect(terrain.stats.buildsLastFrame).toBe(2);
  });
});

describe('Objekt-Schicht', () => {
  function view(chunks: Chunks, signatures: ChunkSignatures, x: number, y: number): ObjectView {
    return { layer: 0, chunks, signatures, left: x - 320, right: x + 320, top: y - 150, bottom: y + 250, fadeX: x, fadeY: y, fadeRadius: CANOPY_FADE.radius };
  }

  it('turns objects into sprites: footprint centre, season frame and row, biome row for scatter, harvested frame, ground layer for flat scatter', () => {
    const chunks = new Chunks();
    const c = chunks.add(0, 0, (ch) => {
      ch.setObject(10 * CS + 10, O('baum_eiche'));
      ch.setObject(12 * CS + 4, O('deko_moos'));
      ch.biome[12 * CS + 4] = B('nebelmoor');
      ch.setObject(20 * CS + 20, O('busch_beeren'));
      ch.height[20 * CS + 20] = 2;
    });
    const layer = new WorldObjectLayer(tables);
    layer.season = 3;
    const sigs = new ChunkSignatures();
    sigs.beginFrame();
    const scene = new RenderScene();
    scene.beginFrame(0);
    expect(layer.emit(scene, view(chunks, sigs, 256, 256))).toBe(3);
    const list = layer.listOf(c, sigs);
    const k = Array.from(list.def.subarray(0, list.count)).indexOf(O('baum_eiche'));
    const oak = tables.objects[O('baum_eiche')];
    // The oak stands on two tiles: centred on their shared edge, jittered by a few px.
    expect(Math.abs((list.x[k] ?? 0) - (10 * TILE + TILE))).toBeLessThanOrEqual(3);
    expect(list.frame[k]).toBe(oak?.seasonFrames[3]);
    expect(atlas.manifest.paletteRows[list.row[k] ?? 0]?.name).toBe('winter');
    const moss = Array.from(list.def.subarray(0, list.count)).indexOf(O('deko_moos'));
    expect(atlas.manifest.paletteRows[list.row[moss] ?? 0]?.name).toBe('biom_nebelmoor');
    const bush = Array.from(list.def.subarray(0, list.count)).indexOf(O('busch_beeren'));
    expect(list.base[bush]).toBe(2 * 16);
    // Harvest the bush: its list is rebuilt with the harvested frame.
    c.setObjectState(20 * CS + 20, 1, 0, 5000);
    sigs.beginFrame();
    const again = layer.listOf(c, sigs);
    expect(again.frame[bush]).toBe(tables.objects[O('busch_beeren')]?.harvestedFrame);
    // Layers: flat scatter under the y-sorted objects.
    expect(tables.objects[O('deko_moos')]?.layer).toBe('ground');
    expect(tables.objects[O('baum_eiche')]?.layer).toBe('objects');
  });

  it('culls to the view and fades only crowns in front of the focus', () => {
    const chunks = new Chunks();
    chunks.add(0, 0, (ch) => {
      // A tree just south of the focus (in front), one north of it (behind), one far away.
      ch.setObject(12 * CS + 10, O('baum_buche'));
      ch.setObject(6 * CS + 10, O('baum_buche'));
      ch.setObject(12 * CS + 30, O('baum_buche'));
    });
    const layer = new WorldObjectLayer(tables);
    const sigs = new ChunkSignatures();
    sigs.beginFrame();
    const scene = new RenderScene();
    scene.beginFrame(0);
    const focusX = 10 * TILE + 8;
    const focusY = 11 * TILE;
    const v = view(chunks, sigs, focusX, focusY);
    v.right = focusX + 100;
    expect(layer.emit(scene, v)).toBe(2);
    expect(layer.stats.faded).toBe(1);
  });

  it('keeps scatter variants and jitter stable per tile', () => {
    const chunks = new Chunks();
    const c = chunks.add(0, 0, (ch) => {
      for (let i = 0; i < 40; i++) ch.setObject(i * 17, O('deko_steinchen'));
    });
    const sigs = new ChunkSignatures();
    sigs.beginFrame();
    const a = new WorldObjectLayer(tables).listOf(c, sigs);
    const b = new WorldObjectLayer(tables).listOf(c, sigs);
    expect(Array.from(a.frame.subarray(0, a.count))).toEqual(Array.from(b.frame.subarray(0, b.count)));
    expect(Array.from(a.x.subarray(0, a.count))).toEqual(Array.from(b.x.subarray(0, b.count)));
    expect(new Set(a.frame.subarray(0, a.count)).size).toBeGreaterThan(1);
  });
});

describe('Schauplätze und Debug-Kamera', () => {
  let world: GeneratedWorld;
  beforeAll(() => {
    world = generateWorld(WORLD_SCENE_SEED, WORLD_SCENE_PRESET);
  });

  it('picks a deterministic window inside each biome and the grove of layer −1', () => {
    const grid = world.plan.grid;
    for (const biome of ['gruenhain', 'frostkamm', 'glutsand']) {
      const spot = surfaceShowcase(world, biome);
      expect(surfaceShowcase(world, biome)).toEqual(spot);
      const cell = Math.floor(spot.ty / grid.cellTiles) * grid.width + Math.floor(spot.tx / grid.cellTiles);
      const region = world.plan.region[cell] as number;
      expect(world.plan.regions[region]?.biome, biome).toBe(biome);
    }
    const cave = caveShowcase(world, -1);
    const grove = layerPlanOf(world.underground, -1).nodes.find((n) => n.feature === 'pilzhain');
    expect(grove).toBeDefined();
    expect(cave).toEqual({ tx: Math.round(grove?.x ?? 0), ty: Math.round(grove?.y ?? 0) });
    expect(() => caveShowcase(world, 0)).toThrow(RangeError);
  });

  it('pans with the arrow keys (Shift faster) while attached', () => {
    const listeners = new Map<string, (e: Event) => void>();
    const target = {
      addEventListener: (type: string, fn: (e: Event) => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    const keys = new DebugPanKeys();
    keys.attach(target);
    const out: [number, number] = [0, 0];
    expect(keys.step(out)).toEqual([0, 0]);
    listeners.get('keydown')?.({ key: 'ArrowRight', shiftKey: false } as unknown as Event);
    listeners.get('keydown')?.({ key: 'ArrowUp', shiftKey: false } as unknown as Event);
    expect(keys.step(out)).toEqual([DEBUG_PAN_STEP.normal, -DEBUG_PAN_STEP.normal]);
    listeners.get('keydown')?.({ key: 'ArrowRight', shiftKey: true } as unknown as Event);
    expect(keys.step(out)).toEqual([DEBUG_PAN_STEP.fast, -DEBUG_PAN_STEP.fast]);
    listeners.get('keyup')?.({ key: 'ArrowUp', shiftKey: false } as unknown as Event);
    expect(keys.step(out)).toEqual([DEBUG_PAN_STEP.normal, 0]);
    keys.detach();
    expect(listeners.size).toBe(0);
    expect(keys.step(out)).toEqual([0, 0]);
  });
});

describe('Welt-Szene (Node, Fake-GL, Welt im Hauptthread)', () => {
  it('lists the world scenes as render scenes', () => {
    for (const id of WORLD_SCENE_IDS) expect(RENDER_SCENE_IDS).toContain(id);
  });

  it('streams the showcase, gets ready, stays within the draw call budget and builds nothing in a steady frame', async () => {
    const r = renderer();
    const host = new WorldHost({ seed: WORLD_SCENE_SEED, preset: WORLD_SCENE_PRESET, now: () => performance.now() });
    const source = new WorldScene('frostkamm-tag', () => atlas, host);
    source.activate(r);
    const scene = new RenderScene();
    const frame = (): void => {
      scene.beginFrame(1);
      source.fill(scene, 1);
      r.render(scene, 1920, 1080, 'sharp');
    };
    for (let i = 0; i < 600 && !source.ready(); i++) {
      frame();
      await Promise.resolve();
    }
    expect(host.state).toBe('bereit');
    expect(source.ready()).toBe(true);
    const info = source.info();
    expect(info.figure).not.toBeNull();
    expect(info.terrain.missing).toBe(0);
    expect(info.terrain.drawn).toBeGreaterThanOrEqual(1);
    expect(scene.sprites.count).toBeGreaterThan(10);
    // §30: draw calls typically ≤ 150.
    expect(r.stats.drawCalls).toBeLessThanOrEqual(150);
    for (let i = 0; i < 30; i++) frame();
    frame();
    expect(source.info().terrain.buildsLastFrame).toBe(0);
    expect(source.info().objects.pushed).toBeGreaterThan(0);
    // The debug camera moves the streaming focus: a chunk east, the new column streams in.
    const [x0, y0] = source.camera;
    source.moveTo(x0 + CHUNK_PX, y0);
    for (let i = 0; i < 400 && !(source.info().terrain.missing === 0 && source.info().loading === 0); i++) {
      frame();
      await Promise.resolve();
    }
    expect(source.info().terrain.missing).toBe(0);
    source.deactivate(r);
    host.dispose();
  }, 60_000);
});
