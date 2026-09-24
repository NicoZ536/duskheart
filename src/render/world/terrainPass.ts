/**
 * World terrain renderer (M2-28): the streamed world chunks as static meshes (`terrainMesh.ts`) in
 * the G-buffer, one instanced draw call per visible chunk – typically 4, at most 6 on a 640 px wide
 * view (§30 "Draw-Calls typisch ≤ 150").
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
import type { Layer } from '../../world/model/coords';
import type { ChunkData } from '../../world/model/chunk';
import { terrainDefines } from './shading';
import type { ChunkSignatures } from './signature';
import type { WorldRenderTables } from './tables';
import { TerrainMeshBuilder, TERRAIN_INSTANCE_STRIDE, TERRAIN_LOCATION, TERRAIN_OFFSET } from './terrainMesh';
import { NEIGHBOUR_SLOTS, type ChunkLookup } from './window';

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
}

export class WorldTerrainRenderer implements RenderPass, GBufferDrawable {
  readonly name = 'welt-terrain';
  enabled = true;
  /** Meshes of the ring around the view built ahead per frame. */
  ringBuildsPerFrame = RING_BUILDS_PER_FRAME;
  readonly stats: TerrainStats = { builds: 0, buildsLastFrame: 0, buildMsLastFrame: 0, maxBuildMs: 0, drawn: 0, missing: 0, partial: 0, meshes: 0, instances: 0 };
  private setup: PassSetup | null = null;
  private program: ShaderProgram | null = null;
  private quad: GpuBuffer | null = null;
  private ownTextures: AtlasTextures | null = null;
  private atlas: AtlasData | null = null;
  private builder: TerrainMeshBuilder | null = null;
  private view: TerrainView | null = null;
  private readonly meshes = new Map<number, MeshEntry>();
  private readonly drawList: MeshEntry[] = [];
  private readonly neighbourSigs = new Float64Array(NEIGHBOUR_SLOTS);
  private frame = 0;
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
    }
    this.atlas = atlas;
    this.view = view;
  }

  /** Whether every visible chunk of the last frame was drawn with a mesh built from all its neighbours. */
  get complete(): boolean {
    return this.stats.missing === 0 && this.stats.partial === 0 && this.frame > 0;
  }

  init(setup: PassSetup): void {
    this.setup = setup;
    this.program = setup.shaders.program({ name: 'welt-terrain', vertex: 'world/terrain.vert', fragment: 'world/terrain.frag', defines: terrainDefines() });
    this.quad = setup.resources.add(new GpuBuffer(setup.gl, { label: 'welt-terrain-quad', target: 'vertex', usage: 'static', data: QUAD }));
  }

  resize(_size: FrameSize): void {
    // Draws into the renderer's G-buffer; nothing of its own depends on the frame size.
  }

  execute(ctx: RenderContext): void {
    this.frame++;
    this.drawList.length = 0;
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
          this.drawList.push(e);
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
    const e: MeshEntry = existing ?? { chunk, built: new Float64Array(NEIGHBOUR_SLOTS), count: 0, buffer: null, vao: null, seen: this.frame };
    if (existing === undefined) this.meshes.set(id, e);
    this.release(e);
    e.chunk = chunk;
    e.seen = this.frame;
    this.signaturesAround(view, chunk, e.built);
    const { count, data } = builder.build(chunk, view.chunks);
    e.count = count;
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
    this.drawList.length = 0;
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
    const prog = this.program;
    if (!this.enabled || prog === null || this.drawList.length === 0) return;
    const textures = this.textures(ctx);
    if (textures === null || !prog.use()) return;
    const gl = ctx.gl;
    const f = ctx.frame;
    gl.uniform2f(prog.uniform('uTargetSize'), f.width, f.height);
    gl.uniform1f(prog.uniform('uTime'), f.time);
    textures.albedo.bind(UNIT_ALBEDO);
    textures.normal.bind(UNIT_NORMAL);
    ctx.palette.texture.bind(UNIT_LUT);
    gl.uniform1i(prog.uniform('uAtlasAlbedo'), UNIT_ALBEDO);
    gl.uniform1i(prog.uniform('uAtlasNormal'), UNIT_NORMAL);
    gl.uniform1i(prog.uniform('uPaletteLut'), UNIT_LUT);
    const offsetLoc = prog.uniform('uChunkOffset');
    for (let i = 0; i < this.drawList.length; i++) {
      const e = this.drawList[i];
      if (e === undefined || e.vao === null || e.count === 0) continue;
      gl.uniform2f(offsetLoc, e.chunk.cx * CHUNK_PX - f.camera.originX, e.chunk.cy * CHUNK_PX - f.camera.originY);
      e.vao.bind();
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, QUAD_VERTICES, e.count);
      ctx.stats.drawCalls++;
      s.drawn++;
      s.instances += e.count;
    }
    gl.bindVertexArray(null);
  }

  dispose(setup: PassSetup): void {
    this.releaseAll();
    this.releaseTextures();
    if (this.quad !== null) setup.resources.remove(this.quad);
    if (this.program !== null) setup.shaders.release(this.program);
    this.quad = null;
    this.program = null;
    this.setup = null;
  }
}
