/**
 * Vertex array objects: the attribute layout is kept as data so it can be re-specified after a
 * context restore, and instance attributes can be re-pointed at a sub-range of the instance buffer
 * (WebGL2 has no base instance; the sprite batcher draws one layer range per call).
 */
import type { GpuBuffer } from './buffer';
import type { GpuResource } from './resources';

export type AttribType = 'f32' | 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32';

export interface VertexAttrib {
  /** `layout(location = …)` in the shader. */
  readonly location: number;
  readonly buffer: GpuBuffer;
  readonly components: 1 | 2 | 3 | 4;
  readonly type: AttribType;
  /** Integer attribute (`vertexAttribIPointer`, GLSL `ivec`/`uvec`). */
  readonly integer?: boolean;
  /** Fixed-point normalisation for float attributes of integer type. */
  readonly normalized?: boolean;
  readonly stride: number;
  readonly offset: number;
  /** 0 = per vertex, 1 = per instance. */
  readonly divisor?: number;
}

export interface VertexArrayOptions {
  readonly label: string;
  readonly attributes: readonly VertexAttrib[];
  readonly indices?: GpuBuffer;
}

export function glAttribType(gl: WebGL2RenderingContext, type: AttribType): number {
  switch (type) {
    case 'f32':
      return gl.FLOAT;
    case 'u8':
      return gl.UNSIGNED_BYTE;
    case 'i8':
      return gl.BYTE;
    case 'u16':
      return gl.UNSIGNED_SHORT;
    case 'i16':
      return gl.SHORT;
    case 'u32':
      return gl.UNSIGNED_INT;
    case 'i32':
      return gl.INT;
  }
}

export class VertexArray implements GpuResource {
  readonly kind = 'vertexArray';
  readonly label: string;
  private vao: WebGLVertexArrayObject | null = null;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly options: VertexArrayOptions,
  ) {
    this.label = options.label;
  }

  get handle(): WebGLVertexArrayObject | null {
    return this.vao;
  }

  create(): void {
    const gl = this.gl;
    this.vao = gl.createVertexArray();
    if (this.vao === null) return;
    gl.bindVertexArray(this.vao);
    for (const a of this.options.attributes) {
      gl.enableVertexAttribArray(a.location);
      this.point(a, 0);
      gl.vertexAttribDivisor(a.location, a.divisor ?? 0);
    }
    if (this.options.indices) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.options.indices.handle);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /** Specifies one attribute pointer, shifted by `extraOffset` bytes (VAO must be bound). */
  private point(a: VertexAttrib, extraOffset: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, a.buffer.handle);
    const type = glAttribType(gl, a.type);
    if (a.integer) gl.vertexAttribIPointer(a.location, a.components, type, a.stride, a.offset + extraOffset);
    else gl.vertexAttribPointer(a.location, a.components, type, a.normalized ?? false, a.stride, a.offset + extraOffset);
  }

  bind(): void {
    this.gl.bindVertexArray(this.vao);
  }

  /**
   * Re-points every attribute with `divisor > 0` so that instance 0 reads from `firstInstance`
   * (the VAO must be bound). Replaces the missing `baseInstance` of WebGL2.
   */
  setInstanceOffset(firstInstance: number): void {
    const attrs = this.options.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i];
      if (a !== undefined && (a.divisor ?? 0) > 0) this.point(a, firstInstance * a.stride);
    }
  }

  release(): void {
    if (this.vao !== null) this.gl.deleteVertexArray(this.vao);
    this.vao = null;
  }

  forget(): void {
    this.vao = null;
  }

  bytes(): number {
    return 0;
  }
}
