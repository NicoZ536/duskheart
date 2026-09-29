/**
 * World terrain renderer (M2-28): the streamed world chunks as static meshes (`terrainMesh.ts`) in
 * the G-buffer, one instanced draw call per visible chunk – typically 4, at most 6 on a 640 px wide
 * view (§30 "Draw-Calls typisch ≤ 150") – over the chunk's rows that reach into the target only (a software
 * rasteriser pays for every instance, on screen or not: a view shows about a quarter of the four chunks it touches).
 *
 * Like the M1 tile map it is a render pass (registered right before the G-buffer pass, so its GPU
 * resources come from the pass setup and survive a context loss) and the G-buffer drawable of the
 * scene's ground. Each frame, before the G-buffer is drawn:
 * - the visible chunks come from the camera of the frame; a chunk's mesh is (re)built when it has
 *   none, when the chunk object was replaced (streamed out and in again), or when the content
 *   signature of the chunk or one of its eight neighbours changed (`signature.ts`) – digging a tile
 *   at a chunk border rebuilds both meshes, an unchanged frame builds nothing;
 * - chunks of the ring around the view are prepared ahead, at most `ringBuildsPerFrame` per frame,
 *   so panning finds their meshes ready; meshes of chunks beyond the ring are released.
 */
import { AtlasTextures, type AtlasData } from '../assets/atlas';
import { GpuBuffer } from '../gl/buffer';
import type { ShaderProgram } from '../gl/shaders';
import { VertexArray } from '../gl/vertexArray';
import { PASS_ORDER, type FrameSize, type PassSetup, type RenderContext, type RenderPass } from '../passes/registry';
import type { GBufferDrawable } from '../scene';
import { CHUNK_PX } from '../tilemap/chunk';
import { endRowInTarget, firstRowInTarget } from '../tilemap/chunkMesh';
import type { Layer } from '../../world/model/coords';
import type { ChunkData } from '../../world/model/chunk';
import { terrainDefines } from './shading';
import type { ChunkSignatures } from './signature';
import type { WorldRenderTables } from './tables';
import { TerrainMeshBuilder, TERRAIN_INSTANCE_STRIDE, TERRAIN_LOCATION, TERRAIN_OFFSET } from './terrainMesh';
import { NEIGHBOUR_SLOTS, type ChunkLookup } from './window';
import { bindInteraction } from '../surface/frame';
import { surfaceDefines } from '../surface/params';
import { BLOB_FRAMES, TERRAIN_FRAME_SLOTS } from './tables';
import { TERRAIN } from '../../content/terrain';

/** Runs right before the G-buffer pass (mesh builds happen outside its draw). */
export const WORLD_TERRAIN_ORDER = PASS_ORDER.gbuffer - 1;
/** Meshes of chunks around the view built ahead per frame (the visible ones are always built). */
export const RING_BUILDS_PER_FRAME = 1;

const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
const QUAD_VERTICES = 4;
const CORNER_COMPONENTS = 2;
const UNIT_ALBEDO = 0;
const UNIT_NORMAL = 1;
const UNIT_LUT = 2;
/** Interaction texture of the world surface (footprints, M5-19). */
const UNIT_INTERACTION = 3;
/** Ground whose painted full tiles the settling snow shows (M5-19). */
const SNOW_TERRAIN = 'schnee';
/** Full-tile variants of the snow the shader picks from. */
const SNOW_VARIANTS = 4;
/** Signature slot of a neighbour that is not resident. */
const ABSENT = -1;
/** Mesh key of a chunk: 12 bits per coordinate (a small integer – no boxed number per lookup; the layer is the view's). */
const KEY_BITS = 12;
const KEY_MASK = (1 << KEY_BITS) - 1;

/** What the terrain shows: the layer, where its chunks come from, their signatures. */
export interface TerrainView {
  readonly layer: Layer;
  readonly chunks: ChunkLookup;
  readonly signatures: ChunkSignatures;
  /** Whether chunk (cx, cy) exists (absent = every chunk; beyond the world edge nothing will stream in). */
  inWorld?(cx: number, cy: number): boolean;
}

interface MeshEntry {
  chunk: ChunkData;
  /** Signatures of the 3×3 chunks the mesh was built from (`ABSENT` = not resident). */
  readonly built: Float64Array;
  count: number;
  /** First instance of each chunk row, and `count` (`TerrainMeshData.rows`). */
  rows: Uint32Array | null;
  buffer: GpuBuffer | null;
  vao: VertexArray | null;
  /** Frame in which the entry was last inside the ring. */
  seen: number;
}

/** Counters of the terrain renderer (`worldInfo`, tests, bench). */
export interface TerrainStats {
  /** Meshes built since the start. */
  builds: number;
  /** Meshes built in the last frame and their build time [ms]. */
  buildsLastFrame: number;
  buildMsLastFrame: number;
  /** Slowest single mesh build so far [ms]. */
  maxBuildMs: number;
  /** Chunks drawn in the last frame. */
  drawn: number;
  /** Visible chunks of the last frame that are not resident yet (holes in the picture). */
  missing: number;
  /** Visible chunks drawn with a mesh whose neighbours were not all resident (borders clamped until they arrive). */
  partial: number;
  /** Meshes held. */
  meshes: number;
  /** Instances drawn in the last frame. */
  instances: number;
  /** Instances of the drawn chunks left out in the last frame: their rows lie outside the target. */
  culled: number;
  /** The last frame drew with the weather variant of the shader (snowfall, wetness or puddles above 0). */
  weatherShader: boolean;
}

export class WorldTerrainRenderer implements RenderPass, GBufferDrawable {
  readonly name = 'welt-terrain';
  enabled = true;
  /** Meshes of the ring around the view built ahead per frame. */
  ringBuildsPerFrame = RING_BUILDS_PER_FRAME;
  readonly stats: TerrainStats = { builds: 0, buildsLastFrame: 0, buildMsLastFrame: 0, maxBuildMs: 0, drawn: 0, missing: 0, partial: 0, meshes: 0, instances: 0, culled: 0, weatherShader: false };
  private setup: PassSetup | null = null;
  /** The shader with settling snow, wet patches and puddles (`DH_SURFACE_WEATHER`), drawn while the weather has any. */
  private program: ShaderProgram | null = null;
  /**
   * The same shader without them, drawn while snowfall, wetness and puddle fill are all 0 – where they change no pixel
   * (terrain.frag). A software rasteriser runs every branch of a shader, taken or not: the E2E tests' frames are ≈ 45 ms
   * shorter with it (ADR M5-Integration).
   */
  private calmProgram: ShaderProgram | null = null;
  private quad: GpuBuffer | null = null;
  private ownTextures: AtlasTextures | null = null;
  private atlas: AtlasData | null = null;
  private builder: TerrainMeshBuilder | null = null;
  private view: TerrainView | null = null;
  private readonly meshes = new Map<number, MeshEntry>();
  /**
   * Meshes to draw this frame: the first `drawCount` entries. The array keeps its length between frames – emptying it
   * would drop its storage and the first push of the next frame allocate it anew (the frame path allocates nothing).
   */
  private readonly drawList: (MeshEntry | null)[] = [];
  private drawCount = 0;
  /** Per-chunk uniforms handed over as typed arrays (a double passed to a WebGL call is boxed on its way in). */
  private readonly frameUniform = new Float32Array(3);
  private readonly chunkUniform = new Float32Array(4);
  private readonly neighbourSigs = new Float64Array(NEIGHBOUR_SLOTS);
  private frame = 0;
  /** Atlas positions of the snow tileset's full tiles (x < 0: none) and their cumulative weights, per builder. */
  private readonly snowFrames = new Int32Array(SNOW_VARIANTS * 2).fill(-1);
  private readonly snowWeights = new Float32Array(SNOW_VARIANTS - 1);
  /** `uSurface` of the frame (snow, wetness, puddles, 0) as a typed array: no boxed number per frame. */
  private readonly surfaceUniform = new Float32Array(4);
  private readonly sweep = (e: MeshEntry, id: number): void => {
    if (e.seen === this.frame) return;
    this.release(e);
    this.meshes.delete(id);
  };

  /** Sets what to draw: atlas, its world tables and the chunk view (null = nothing). */
  setWorld(atlas: AtlasData | null, tables: WorldRenderTables | null, view: TerrainView | null): void {
    if (tables !== null && atlas !== null && tables.manifest !== atlas.manifest) throw new Error('Welt-Terrain: Tabellen und Atlas gehören nicht zusammen');
    if (atlas !== this.atlas) {
      this.releaseTextures();
      this.releaseAll();
    }
    if (this.builder === null || tables === null || this.builder.tables !== tables) {
      this.releaseAll();
      this.builder = tables === null ? null : new TerrainMeshBuilder(tables);
      this.resolveSnow(tables);
    }
    this.atlas = atlas;
    this.view = view;
  }

  /** The snow tileset's full tiles in `tables` (the settling snow shows them, M5-19). */
  private resolveSnow(tables: WorldRenderTables | null): void {
    this.snowFrames.fill(-1);
    this.snowWeights.fill(1);
    if (tables === null) return;
    const id = tables.ids.terrain.ids().indexOf(SNOW_TERRAIN) + 1;
    if (id <= 0 || tables.hasTileset[id] !== 1) return;
    const n = tables.variantCount[id] as number;
    for (let v = 0; v < SNOW_VARIANTS; v++) {
      const slot = id * TERRAIN_FRAME_SLOTS + BLOB_FRAMES + Math.min(v, n - 1);
      this.snowFrames[v * 2] = tables.terrainFrameX[slot] as number;
      this.snowFrames[v * 2 + 1] = tables.terrainFrameY[slot] as number;
    }
    const weights = TERRAIN.find((t) => t.id === SNOW_TERRAIN)?.tileset?.variantWeights ?? [1];
    const total = weights.reduce((a, b) => a + b, 0);
    let sum = 0;
    for (let v = 0; v < SNOW_VARIANTS - 1; v++) {
      sum += weights[v] ?? 0;
      this.snowWeights[v] = v < n - 1 ? sum / total : 1;
    }
  }

  /** Whether every visible chunk of the last frame was drawn with a mesh built from all its neighbours. */
  get complete(): boolean {
    return this.stats.missing === 0 && this.stats.partial === 0 && this.frame > 0;
  }

  init(setup: PassSetup): void {
    this.setup = setup;
    const defines = { ...terrainDefines(), ...surfaceDefines() };
    this.program = setup.shaders.program({ name: 'welt-terrain', vertex: 'world/terrain.vert', fragment: 'world/terrain.frag', defines: { ...defines, DH_SURFACE_WEATHER: '1' } });
    this.calmProgram = setup.shaders.program({ name: 'welt-terrain-ruhig', vertex: 'world/terrain.vert', fragment: 'world/terrain.frag', defines });
    this.quad = setup.resources.add(new GpuBuffer(setup.gl, { label: 'welt-terrain-quad', target: 'vertex', usage: 'static', data: QUAD }));
  }

  resize(_size: FrameSize): void {
    // Draws into the renderer's G-buffer; nothing of its own depends on the frame size.
  }

  execute(ctx: RenderContext): void {
    this.frame++;
    this.clearDrawList();
    const s = this.stats;
    s.buildsLastFrame = 0;
    s.buildMsLastFrame = 0;
    s.missing = 0;
    s.partial = 0;
    const view = this.view;
    if (!this.enabled || view === null || this.builder === null || this.setup === null) return;
    const f = ctx.frame;
    const cx0 = Math.floor(f.camera.originX / CHUNK_PX);
    const cy0 = Math.floor(f.camera.originY / CHUNK_PX);
    const cx1 = Math.floor((f.camera.originX + f.width - 1) / CHUNK_PX);
    const cy1 = Math.floor((f.camera.originY + f.height - 1) / CHUNK_PX);
    let ringBudget = this.ringBuildsPerFrame;
    for (let cy = cy0 - 1; cy <= cy1 + 1; cy++) {
      for (let cx = cx0 - 1; cx <= cx1 + 1; cx++) {
        const visible = cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1;
        const chunk = view.chunks.get(view.layer, cx, cy);
        if (chunk === undefined) {
          if (visible) s.missing++;
          continue;
        }
        const id = ((cy & KEY_MASK) << KEY_BITS) | (cx & KEY_MASK);
        let e = this.meshes.get(id);
        if (e !== undefined) e.seen = this.frame;
        // Meshes of the ring are checked when they become visible; missing ones are built ahead.
        const stale = e === undefined || e.chunk !== chunk || (visible && this.changed(e, view, chunk));
        if (stale && (visible || ringBudget > 0)) {
          if (!visible) ringBudget--;
          e = this.build(e, id, chunk, view);
        }
        if (visible && e !== undefined && e.chunk === chunk) {
          if (this.drawCount < this.drawList.length) this.drawList[this.drawCount] = e;
          else this.drawList.push(e);
          this.drawCount++;
          if (this.builtWithout(e, view)) s.partial++;
        }
      }
    }
    this.meshes.forEach(this.sweep);
    s.meshes = this.meshes.size;
  }

  /** Signatures of the 3×3 chunks around `chunk` into `out`. */
  private signaturesAround(view: TerrainView, chunk: ChunkData, out: Float64Array): void {
    for (let i = 0; i < NEIGHBOUR_SLOTS; i++) {
      const n = view.chunks.get(view.layer, chunk.cx + (i % 3) - 1, chunk.cy + Math.floor(i / 3) - 1);
      out[i] = n === undefined ? ABSENT : view.signatures.of(n);
    }
  }

  /** Whether the mesh was built while a neighbour inside the world was not resident. */
  private builtWithout(e: MeshEntry, view: TerrainView): boolean {
    for (let i = 0; i < NEIGHBOUR_SLOTS; i++) {
      if (e.built[i] !== ABSENT) continue;
      if (view.inWorld === undefined || view.inWorld(e.chunk.cx + (i % 3) - 1, e.chunk.cy + Math.floor(i / 3) - 1)) return true;
    }
    return false;
  }

  private changed(e: MeshEntry, view: TerrainView, chunk: ChunkData): boolean {
    const sigs = this.neighbourSigs;
    this.signaturesAround(view, chunk, sigs);
    for (let i = 0; i < NEIGHBOUR_SLOTS; i++) if (sigs[i] !== e.built[i]) return true;
    return false;
  }

  private build(existing: MeshEntry | undefined, id: number, chunk: ChunkData, view: TerrainView): MeshEntry {
    const setup = this.setup as PassSetup;
    const builder = this.builder as TerrainMeshBuilder;
    const t0 = performance.now();
    const e: MeshEntry = existing ?? { chunk, built: new Float64Array(NEIGHBOUR_SLOTS), count: 0, rows: null, buffer: null, vao: null, seen: this.frame };
    if (existing === undefined) this.meshes.set(id, e);
    this.release(e);
    e.chunk = chunk;
    e.seen = this.frame;
    this.signaturesAround(view, chunk, e.built);
    const { count, data, rows } = builder.build(chunk, view.chunks);
    e.count = count;
    e.rows = rows;
    if (count > 0 && this.quad !== null) {
      const label = `welt-terrain-${chunk.key}`;
      const buffer = setup.resources.add(new GpuBuffer(setup.gl, { label, target: 'vertex', usage: 'static', data }));
      const inst = { buffer, stride: TERRAIN_INSTANCE_STRIDE, divisor: 1, integer: true } as const;
      e.buffer = buffer;
      e.vao = setup.resources.add(
        new VertexArray(setup.gl, {
          label,
          attributes: [
            { location: TERRAIN_LOCATION.corner, buffer: this.quad, components: CORNER_COMPONENTS, type: 'f32', stride: 0, offset: 0 },
            { ...inst, location: TERRAIN_LOCATION.tile, components: 4, type: 'u8', offset: TERRAIN_OFFSET.tile },
            { ...inst, location: TERRAIN_LOCATION.rect, components: 2, type: 'u16', offset: TERRAIN_OFFSET.rect },
            { ...inst, location: TERRAIN_LOCATION.shade, components: 4, type: 'u8', offset: TERRAIN_OFFSET.shade },
            { ...inst, location: TERRAIN_LOCATION.blend, components: 4, type: 'u8', offset: TERRAIN_OFFSET.blend },
          ],
        }),
      );
    }
    const ms = performance.now() - t0;
    const s = this.stats;
    s.builds++;
    s.buildsLastFrame++;
    s.buildMsLastFrame += ms;
    s.maxBuildMs = Math.max(s.maxBuildMs, ms);
    return e;
  }

  private release(e: MeshEntry): void {
    const setup = this.setup;
    if (setup !== null) {
      if (e.vao !== null) setup.resources.remove(e.vao);
      if (e.buffer !== null) setup.resources.remove(e.buffer);
    }
    e.vao = null;
    e.buffer = null;
    e.count = 0;
  }

  private releaseAll(): void {
    this.meshes.forEach((e) => this.release(e));
    this.meshes.clear();
    this.clearDrawList();
  }

  /** Empties the draw list without giving up its storage (no mesh stays referenced from it). */
  private clearDrawList(): void {
    for (let i = 0; i < this.drawCount; i++) this.drawList[i] = null;
    this.drawCount = 0;
  }

  private releaseTextures(): void {
    if (this.ownTextures !== null && this.setup !== null) this.ownTextures.release(this.setup.resources);
    this.ownTextures = null;
  }

  private textures(ctx: RenderContext): AtlasTextures | null {
    const atlas = this.atlas;
    if (atlas === null || this.setup === null) return null;
    if (ctx.atlas !== null && ctx.atlas.data === atlas) return ctx.atlas;
    this.ownTextures ??= new AtlasTextures(this.setup.resources, this.setup.gl, atlas, `welt-terrain-atlas-${atlas.manifest.sourceHash}`);
    return this.ownTextures;
  }

  drawGBuffer(ctx: RenderContext): void {
    const s = this.stats;
    s.drawn = 0;
    s.instances = 0;
    s.culled = 0;
    // World surface: snow cover, wetness, puddles – the weather variant of the shader only while one of them is above 0.
    const surface = ctx.scene.surface;
    const u = this.surfaceUniform;
    u[0] = surface.snow;
    u[1] = surface.wetness;
    u[2] = surface.puddles;
    const weather = u[0] > 0 || u[1] > 0 || u[2] > 0;
    s.weatherShader = weather;
    const prog = weather ? this.program : this.calmProgram;
    if (!this.enabled || prog === null || this.drawCount === 0) return;
    const textures = this.textures(ctx);
    if (textures === null || !prog.use()) return;
    const gl = ctx.gl;
    const f = ctx.frame;
    const fu = this.frameUniform;
    fu[0] = f.width;
    fu[1] = f.height;
    fu[2] = f.time;
    gl.uniform2fv(prog.uniform('uTargetSize'), fu, 0, 2);
    gl.uniform1fv(prog.uniform('uTime'), fu, 2, 1);
    textures.albedo.bind(UNIT_ALBEDO);
    textures.normal.bind(UNIT_NORMAL);
    ctx.palette.texture.bind(UNIT_LUT);
    gl.uniform1i(prog.uniform('uAtlasAlbedo'), UNIT_ALBEDO);
    gl.uniform1i(prog.uniform('uAtlasNormal'), UNIT_NORMAL);
    gl.uniform1i(prog.uniform('uPaletteLut'), UNIT_LUT);
    // World surface: snow cover, wetness, puddles, the footprints of the interaction texture, the painted snow.
    gl.uniform4fv(prog.uniform('uSurface'), u);
    bindInteraction(ctx, prog, UNIT_INTERACTION);
    gl.uniform4iv(prog.uniform('uSnowFrames'), this.snowFrames);
    gl.uniform3fv(prog.uniform('uSnowWeights'), this.snowWeights);
    const offsetLoc = prog.uniform('uChunkOffset');
    const worldLoc = prog.uniform('uChunkWorld');
    const cu = this.chunkUniform;
    for (let i = 0; i < this.drawCount; i++) {
      const e = this.drawList[i];
      if (e === undefined || e === null || e.vao === null || e.rows === null || e.count === 0) continue;
      cu[2] = e.chunk.cx * CHUNK_PX;
      cu[3] = e.chunk.cy * CHUNK_PX;
      cu[0] = cu[2] - f.camera.originX;
      cu[1] = cu[3] - f.camera.originY;
      // Only the rows reaching into the target (the instances are row-major, each on its own tile).
      const top = cu[1] as number;
      const first = e.rows[firstRowInTarget(top)] as number;
      const end = e.rows[endRowInTarget(top, f.height)] as number;
      if (end <= first) {
        s.culled += e.count;
        continue;
      }
      gl.uniform2fv(offsetLoc, cu, 0, 2);
      gl.uniform2fv(worldLoc, cu, 2, 2);
      e.vao.bind();
      e.vao.setInstanceOffset(first);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, QUAD_VERTICES, end - first);
      ctx.stats.drawCalls++;
      s.drawn++;
      s.instances += end - first;
      s.culled += e.count - (end - first);
    }
    gl.bindVertexArray(null);
  }

  dispose(setup: PassSetup): void {
    this.releaseAll();
    this.releaseTextures();
    if (this.quad !== null) setup.resources.remove(this.quad);
    if (this.program !== null) setup.shaders.release(this.program);
    if (this.calmProgram !== null) setup.shaders.release(this.calmProgram);
    this.quad = null;
    this.program = null;
    this.calmProgram = null;
    this.setup = null;
  }
}
