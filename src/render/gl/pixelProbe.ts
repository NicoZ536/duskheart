/**
 * Pixel probe of the rendered frame (`__dh.readPixel`, E2E tests; MASTERPROMPT §31.6).
 *
 * The drawing buffer is only valid in the task that rendered it (`preserveDrawingBuffer: false`),
 * so requests are served right after a frame. The read is asynchronous (WebGL2 pixel pack buffer +
 * fence): `readPixels` copies into a GPU buffer without stalling the pipeline, and the bytes are
 * fetched with `getBufferSubData` in a later frame once the fence has signalled.
 */

/** One pixel as `[r, g, b, a]`, each 0–255. */
export type Rgba = readonly [number, number, number, number];

interface Request {
  readonly x: number;
  readonly y: number;
  resolve(pixel: Rgba): void;
  reject(error: Error): void;
}

interface Batch {
  readonly requests: readonly Request[];
  readonly buffer: WebGLBuffer;
  readonly sync: WebGLSync;
}

/** Bytes of one RGBA8 pixel. */
const BYTES_PER_PIXEL = 4;

export class PixelProbe {
  private pending: Request[] = [];
  private readonly inFlight: Batch[] = [];

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /** Number of requests not yet answered. */
  get outstanding(): number {
    return this.pending.length + this.inFlight.reduce((n, b) => n + b.requests.length, 0);
  }

  /** Pixel (x, y) of the next rendered frame; canvas device pixels, origin top left. */
  request(x: number, y: number): Promise<Rgba> {
    return new Promise((resolve, reject) => this.pending.push({ x, y, resolve, reject }));
  }

  /**
   * Call right after a frame was drawn to the default framebuffer: answers finished reads and
   * starts reads for the requests collected since the last frame.
   */
  afterFrame(canvasWidth: number, canvasHeight: number): void {
    this.collect();
    if (this.pending.length === 0) return;
    const gl = this.gl;
    const requests = this.pending;
    this.pending = [];
    const valid: Request[] = [];
    for (const r of requests) {
      if (r.x >= canvasWidth || r.y >= canvasHeight) r.reject(new RangeError(`readPixel: (${r.x}, ${r.y}) liegt außerhalb der Leinwand ${canvasWidth}×${canvasHeight}`));
      else valid.push(r);
    }
    if (valid.length === 0) return;
    const buffer = gl.createBuffer();
    if (buffer === null) {
      for (const r of valid) r.reject(new Error('readPixel: kein Pixelpuffer verfügbar'));
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, valid.length * BYTES_PER_PIXEL, gl.STREAM_READ);
    valid.forEach((r, i) => gl.readPixels(r.x, canvasHeight - 1 - r.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, i * BYTES_PER_PIXEL));
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (sync === null) {
      gl.deleteBuffer(buffer);
      for (const r of valid) r.reject(new Error('readPixel: Fence konnte nicht angelegt werden'));
      return;
    }
    gl.flush();
    this.inFlight.push({ requests: valid, buffer, sync });
  }

  /** Rejects every outstanding request (context lost); GPU objects died with the context. */
  abort(reason: string): void {
    const error = new Error(`readPixel: ${reason}`);
    for (const r of this.pending) r.reject(error);
    for (const b of this.inFlight) for (const r of b.requests) r.reject(error);
    this.pending = [];
    this.inFlight.length = 0;
  }

  private collect(): void {
    const gl = this.gl;
    while (this.inFlight.length > 0) {
      const batch = this.inFlight[0] as Batch;
      const status = gl.clientWaitSync(batch.sync, 0, 0);
      if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) return;
      this.inFlight.shift();
      const bytes = new Uint8Array(batch.requests.length * BYTES_PER_PIXEL);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, batch.buffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, bytes);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteBuffer(batch.buffer);
      gl.deleteSync(batch.sync);
      batch.requests.forEach((r, i) => {
        const o = i * BYTES_PER_PIXEL;
        r.resolve([bytes[o] ?? 0, bytes[o + 1] ?? 0, bytes[o + 2] ?? 0, bytes[o + 3] ?? 0]);
      });
    }
  }
}
