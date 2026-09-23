/** GPU buffers (vertex, index) as registry-managed resources. */
import type { GpuResource } from './resources';

export type BufferTarget = 'vertex' | 'index';
/** `static`: uploaded once and retained for restores; `dynamic`/`stream`: refilled by the owner every frame. */
export type BufferUsage = 'static' | 'dynamic' | 'stream';

export interface GpuBufferOptions {
  readonly label: string;
  readonly target: BufferTarget;
  readonly usage: BufferUsage;
  /** Static content (retained). */
  readonly data?: ArrayBufferView;
  /** Initial capacity in bytes for dynamic buffers. */
  readonly byteLength?: number;
}

export class GpuBuffer implements GpuResource {
  readonly kind = 'buffer';
  readonly label: string;
  readonly target: BufferTarget;
  readonly usage: BufferUsage;
  private handleValue: WebGLBuffer | null = null;
  private capacity: number;
  private readonly data: ArrayBufferView | null;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    options: GpuBufferOptions,
  ) {
    this.label = options.label;
    this.target = options.target;
    this.usage = options.usage;
    this.data = options.data ?? null;
    this.capacity = this.data?.byteLength ?? Math.max(0, options.byteLength ?? 0);
  }

  get handle(): WebGLBuffer | null {
    return this.handleValue;
  }

  /** Allocated size in bytes. */
  get byteLength(): number {
    return this.capacity;
  }

  private glTarget(): number {
    return this.target === 'index' ? this.gl.ELEMENT_ARRAY_BUFFER : this.gl.ARRAY_BUFFER;
  }

  private glUsage(): number {
    const gl = this.gl;
    return this.usage === 'static' ? gl.STATIC_DRAW : this.usage === 'dynamic' ? gl.DYNAMIC_DRAW : gl.STREAM_DRAW;
  }

  create(): void {
    const gl = this.gl;
    this.handleValue = gl.createBuffer();
    if (this.handleValue === null) return;
    const target = this.bindForWrite();
    if (this.data !== null) gl.bufferData(target, this.data, this.glUsage());
    else gl.bufferData(target, this.capacity, this.glUsage());
    this.unbind(target);
  }

  /**
   * Binds the buffer on its own target for writing. WebGL2 never lets a buffer switch between
   * ELEMENT_ARRAY_BUFFER and the other targets, and the element binding belongs to the bound vertex
   * array – so index buffers are written with no vertex array bound (callers rebind theirs).
   */
  private bindForWrite(): number {
    const gl = this.gl;
    const target = this.glTarget();
    if (target === gl.ELEMENT_ARRAY_BUFFER) gl.bindVertexArray(null);
    gl.bindBuffer(target, this.handleValue);
    return target;
  }

  private unbind(target: number): void {
    this.gl.bindBuffer(target, null);
  }

  /**
   * Makes room for `bytes` (dynamic buffers). Grows to the next power of two, so a slowly rising
   * sprite count reallocates only a few times. Returns true when the buffer was reallocated.
   */
  ensureCapacity(bytes: number): boolean {
    if (bytes <= this.capacity) return false;
    let next = Math.max(1, this.capacity);
    while (next < bytes) next *= 2;
    this.capacity = next;
    if (this.handleValue === null) return true;
    const target = this.bindForWrite();
    this.gl.bufferData(target, this.capacity, this.glUsage());
    this.unbind(target);
    return true;
  }

  /**
   * Uploads `length` elements of `src` starting at element `srcOffset` to byte `dstByteOffset`
   * (the WebGL2 overload without subarray views, so no allocation per frame).
   */
  upload(src: ArrayBufferView & ArrayLike<number>, srcOffset: number, length: number, dstByteOffset = 0): void {
    if (this.handleValue === null || length === 0) return;
    const target = this.bindForWrite();
    this.gl.bufferSubData(target, dstByteOffset, src, srcOffset, length);
    this.unbind(target);
  }

  /** Orphans the storage (a fresh allocation for streaming, so the GPU need not wait for the last frame). */
  orphan(): void {
    if (this.handleValue === null) return;
    const target = this.bindForWrite();
    this.gl.bufferData(target, this.capacity, this.glUsage());
    this.unbind(target);
  }

  release(): void {
    if (this.handleValue !== null) this.gl.deleteBuffer(this.handleValue);
    this.handleValue = null;
  }

  forget(): void {
    this.handleValue = null;
  }

  bytes(): number {
    return this.capacity;
  }
}
