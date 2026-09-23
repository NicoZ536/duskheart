/**
 * Chunk tile map (M1-13, docs/RENDER.md §3 `tilemap/`): the ground as static per-chunk meshes
 * (`chunkMesh.ts`) drawn into the G-buffer before the sprites – one instanced draw call per visible
 * chunk, however many tiles it holds.
 *
 * It is a render pass and a G-buffer drawable at once: as a pass (registered just before the
 * G-buffer pass) it gets its GPU resources from the pass setup – so a context loss restores them –
 * and rebuilds the meshes of changed chunks before the G-buffer is drawn; as the drawable in
 * `scene.ground` the G-buffer pass lets it draw after the clear. A mesh is rebuilt only when its
 * chunk's `version` changed, the tile set/atlas was replaced, or the chunk newly appeared; chunks
 * that left the list release their buffers.
 */
import { AtlasTextures, type AtlasData } from '../assets/atlas';
import { GpuBuffer } from '../gl/buffer';
import type { ShaderProgram } from '../gl/shaders';
import { VertexArray } from '../gl/vertexArray';
import { PASS_ORDER, type FrameSize, type PassSetup, type RenderContext, type RenderPass } from '../passes/registry';
import type { GBufferDrawable } from '../scene';
import { CHUNK_PX, TILE_PX, type GroundChunk } from './chunk';
import { buildChunkMesh, TILE_INSTANCE_STRIDE, TILE_LOCATION, TILE_OFFSET } from './chunkMesh';
import type { TileSet } from './tileSet';

/** Runs right before the G-buffer pass (mesh rebuilds happen outside the G-buffer's draw). */
export const TILEMAP_ORDER = PASS_ORDER.gbuffer - 1;

/** Quad corners as a triangle strip. */
const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
const QUAD_VERTICES = 4;
const CORNER_COMPONENTS = 2;
/** Texture units of the tile program. */
const UNIT_ALBEDO = 0;
const UNIT_NORMAL = 1;
const UNIT_LUT = 2;

interface ChunkMesh {
  readonly chunk: GroundChunk;
  version: number;
  /** Tile set generation the mesh was built with. */
  generation: number;
  count: number;
  buffer: GpuBuffer | null;
  vao: VertexArray | null;
}

export class TileMapRenderer implements RenderPass, GBufferDrawable {
  readonly name = 'tilemap';
  enabled = true;
  private setup: PassSetup | null = null;
  private program: ShaderProgram | null = null;
  private quad: GpuBuffer | null = null;
  private ownTextures: AtlasTextures | null = null;
  private atlas: AtlasData | null = null;
  private tileSet: TileSet | null = null;
  /** Bumped whenever tile set or atlas change: every mesh is stale then. */
  private generation = 0;
  private chunks: readonly GroundChunk[] = [];
  /** One mesh per listed chunk (a short list: the active zone holds a handful of chunks). */
  private readonly meshes: ChunkMesh[] = [];
  private builds = 0;
  private draws = 0;

  /** Meshes built so far (a changed chunk adds one, an unchanged frame none). */
  get rebuilds(): number {
    return this.builds;
  }

  /** Chunk draw calls of the last G-buffer draw. */
  get lastDrawCalls(): number {
    return this.draws;
  }

  /** Chunks that currently hold a mesh. */
  get meshCount(): number {
    return this.meshes.length;
  }

  /** Tiles (instances) of the mesh of `chunk`, -1 if it has none. */
  tilesOf(chunk: GroundChunk): number {
    return this.meshOf(chunk)?.count ?? -1;
  }

  private meshOf(chunk: GroundChunk): ChunkMesh | undefined {
    for (let i = 0; i < this.meshes.length; i++) if (this.meshes[i]?.chunk === chunk) return this.meshes[i];
    return undefined;
  }

  /** Sets the tile atlas and tile set (all meshes are rebuilt with the new frames). */
  setTiles(atlas: AtlasData, tileSet: TileSet): void {
    if (tileSet.manifest !== atlas.manifest) throw new Error('Kachelsatz und Atlas gehören nicht zusammen (anderes Manifest)');
    if (atlas === this.atlas && tileSet === this.tileSet) return;
    if (atlas !== this.atlas) this.releaseTextures();
    this.atlas = atlas;
    this.tileSet = tileSet;
    this.generation++;
  }

  /** The chunks to show (the active zone around the camera); the list is kept by reference. */
  setChunks(chunks: readonly GroundChunk[]): void {
    this.chunks = chunks;
  }

  init(setup: PassSetup): void {
    this.setup = setup;
    this.program = setup.shaders.program({ name: 'tilemap', vertex: 'tilemap.vert', fragment: 'tilemap.frag', defines: { DH_TILE_SIZE: TILE_PX.toFixed(1) } });
    this.quad = setup.resources.add(new GpuBuffer(setup.gl, { label: 'tilemap-quad', target: 'vertex', usage: 'static', data: QUAD }));
  }

  resize(_size: FrameSize): void {
    // Draws into the renderer's G-buffer; nothing of its own depends on the frame size.
  }

  execute(_ctx: RenderContext): void {
    this.sync();
  }

  /** Rebuilds stale meshes and drops those of chunks no longer listed; returns the number rebuilt. */
  sync(): number {
    const setup = this.setup;
    const tiles = this.tileSet;
    if (setup === null || tiles === null) return 0;
    let rebuilt = 0;
    // Drop meshes of chunks that left the list (swap-remove: no allocation per frame).
    for (let i = this.meshes.length - 1; i >= 0; i--) {
      const mesh = this.meshes[i];
      if (mesh === undefined || this.chunks.includes(mesh.chunk)) continue;
      this.releaseMesh(mesh);
      const last = this.meshes.pop();
      if (last !== undefined && i < this.meshes.length) this.meshes[i] = last;
    }
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      if (chunk === undefined) continue;
      let mesh = this.meshOf(chunk);
      if (mesh !== undefined && mesh.version === chunk.version && mesh.generation === this.generation) continue;
      if (mesh === undefined) {
        mesh = { chunk, version: -1, generation: -1, count: 0, buffer: null, vao: null };
        this.meshes.push(mesh);
      }
      this.build(setup, tiles, mesh);
      rebuilt++;
    }
    return rebuilt;
  }

  private build(setup: PassSetup, tiles: TileSet, mesh: ChunkMesh): void {
    this.releaseMesh(mesh);
    const { count, data } = buildChunkMesh(mesh.chunk, tiles);
    mesh.version = mesh.chunk.version;
    mesh.generation = this.generation;
    mesh.count = count;
    this.builds++;
    if (count === 0 || this.quad === null) return;
    const label = `tilemap-${mesh.chunk.cx},${mesh.chunk.cy}`;
    const buffer = setup.resources.add(new GpuBuffer(setup.gl, { label, target: 'vertex', usage: 'static', data }));
    const inst = { buffer, stride: TILE_INSTANCE_STRIDE, divisor: 1, integer: true } as const;
    mesh.buffer = buffer;
    mesh.vao = setup.resources.add(
      new VertexArray(setup.gl, {
        label,
        attributes: [
          { location: TILE_LOCATION.corner, buffer: this.quad, components: CORNER_COMPONENTS, type: 'f32', stride: 0, offset: 0 },
          { ...inst, location: TILE_LOCATION.tile, components: 4, type: 'u8', offset: TILE_OFFSET.tile },
          { ...inst, location: TILE_LOCATION.rect, components: 2, type: 'u16', offset: TILE_OFFSET.rect },
        ],
      }),
    );
  }

  private releaseMesh(mesh: ChunkMesh): void {
    const setup = this.setup;
    if (setup === null) return;
    if (mesh.vao !== null) setup.resources.remove(mesh.vao);
    if (mesh.buffer !== null) setup.resources.remove(mesh.buffer);
    mesh.vao = null;
    mesh.buffer = null;
  }

  private releaseTextures(): void {
    if (this.ownTextures !== null && this.setup !== null) this.ownTextures.release(this.setup.resources);
    this.ownTextures = null;
  }

  /** The atlas textures: the frame's sprite atlas when it is the same, else the map's own copy. */
  private textures(ctx: RenderContext): AtlasTextures | null {
    const atlas = this.atlas;
    if (atlas === null || this.setup === null) return null;
    if (ctx.atlas !== null && ctx.atlas.data === atlas) return ctx.atlas;
    this.ownTextures ??= new AtlasTextures(this.setup.resources, this.setup.gl, atlas, `tilemap-atlas-${atlas.manifest.sourceHash}`);
    return this.ownTextures;
  }

  drawGBuffer(ctx: RenderContext): void {
    this.draws = 0;
    if (!this.enabled) return;
    this.sync();
    const prog = this.program;
    const textures = this.textures(ctx);
    if (prog === null || textures === null || this.meshes.length === 0 || !prog.use()) return;
    const gl = ctx.gl;
    const f = ctx.frame;
    gl.uniform2f(prog.uniform('uTargetSize'), f.width, f.height);
    textures.albedo.bind(UNIT_ALBEDO);
    textures.normal.bind(UNIT_NORMAL);
    ctx.palette.texture.bind(UNIT_LUT);
    gl.uniform1i(prog.uniform('uAtlasAlbedo'), UNIT_ALBEDO);
    gl.uniform1i(prog.uniform('uAtlasNormal'), UNIT_NORMAL);
    gl.uniform1i(prog.uniform('uPaletteLut'), UNIT_LUT);
    const offsetLoc = prog.uniform('uChunkOffset');
    const left = f.camera.originX;
    const top = f.camera.originY;
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i];
      if (mesh === undefined || mesh.vao === null || mesh.count === 0) continue;
      const x = mesh.chunk.cx * CHUNK_PX - left;
      const y = mesh.chunk.cy * CHUNK_PX - top;
      // Chunks outside the target cost nothing: skip them.
      if (x >= f.width || y >= f.height || x + CHUNK_PX <= 0 || y + CHUNK_PX <= 0) continue;
      gl.uniform2f(offsetLoc, x, y);
      mesh.vao.bind();
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, QUAD_VERTICES, mesh.count);
      ctx.stats.drawCalls++;
      this.draws++;
    }
    gl.bindVertexArray(null);
  }

  dispose(setup: PassSetup): void {
    for (const mesh of this.meshes) this.releaseMesh(mesh);
    this.meshes.length = 0;
    this.releaseTextures();
    if (this.quad !== null) setup.resources.remove(this.quad);
    if (this.program !== null) setup.shaders.release(this.program);
    this.quad = null;
    this.program = null;
    this.setup = null;
  }
}
