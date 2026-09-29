/**
 * Frames in flight on a software rasteriser (M5 integration; MASTERPROMPT §30, §31.3). Chrome lets a page queue about
 * ten frames of WebGL work for SwiftShader, the CPU rasteriser of the headless browser that runs the E2E tests and the
 * screenshots: what the page draws appears seconds later (a fence behind a frame of the night camp signals after 3–5 s
 * at 0.4 s per frame), and every read-back – the pixel probe of `__dh.readPixel`, the first-start benchmark – waits for
 * the whole queue. The pacer puts a fence behind every frame it lets through and lets the next one be drawn only while
 * fewer than `maxInFlight` are unfinished; the page's frame callback keeps running (input, simulation ticks, UI) and
 * simply draws nothing in between. The rasteriser stays busy – the next frame is always queued before the last one is
 * done – while the picture and its read-backs are at most `maxInFlight` frames behind. A fence that has not signalled
 * after `timeoutMs` counts as done: a driver that never signals cannot stop the picture.
 *
 * On a GPU the swap chain bounds the queue already: the renderer uses the pacer only on a software rasteriser
 * (`PassProfiler.softwareRenderer`), so a GPU's frame path gets no fence and no sync object per frame. The render
 * benchmark (`benchRender`) measures that frame path and switches the pacer off meanwhile (`RenderRuntime.setFramePacing`):
 * on SwiftShader the pending fences cost the page's GL calls waits for the GPU process that no player's frame has.
 */

/** The fences of a WebGL2 context the pacer uses. */
export type PacerContext = Pick<WebGL2RenderingContext, 'fenceSync' | 'getSyncParameter' | 'deleteSync' | 'SYNC_GPU_COMMANDS_COMPLETE' | 'SYNC_STATUS' | 'SIGNALED'>;

export class FramePacer {
  /** Fences of the unfinished frames, oldest at `head` (a ring of `maxInFlight`). */
  private readonly fences: Array<WebGLSync | null>;
  /** When each of them was queued [ms]. */
  private readonly queuedAt: Float64Array;
  private head = 0;
  private count = 0;
  /** Frames not drawn because the queue was full (statistics, tests). */
  held = 0;

  constructor(
    private readonly gl: PacerContext,
    readonly maxInFlight: number,
    readonly timeoutMs: number,
  ) {
    if (!Number.isInteger(maxInFlight) || maxInFlight < 1) throw new RangeError(`FramePacer: maxInFlight muss eine ganze Zahl ≥ 1 sein, nicht ${String(maxInFlight)}`);
    this.fences = Array.from({ length: maxInFlight }, () => null);
    this.queuedAt = new Float64Array(maxInFlight);
  }

  /** Frames queued and not yet finished. */
  get inFlight(): number {
    return this.count;
  }

  /** Whether a frame may be drawn at `nowMs`: retires the finished frames first; false while the queue is full. */
  mayDraw(nowMs: number): boolean {
    const gl = this.gl;
    while (this.count > 0) {
      const i = this.head;
      const fence = this.fences[i] ?? null;
      const done = fence === null || gl.getSyncParameter(fence, gl.SYNC_STATUS) === gl.SIGNALED || nowMs - (this.queuedAt[i] as number) >= this.timeoutMs;
      if (!done) break;
      if (fence !== null) gl.deleteSync(fence);
      this.fences[i] = null;
      this.head = (i + 1) % this.maxInFlight;
      this.count--;
    }
    if (this.count < this.maxInFlight) return true;
    this.held++;
    return false;
  }

  /** After a drawn frame at `nowMs`: its fence joins the queue (a context without fences counts it as done at once). */
  drawn(nowMs: number): void {
    if (this.count >= this.maxInFlight) return;
    const gl = this.gl;
    const i = (this.head + this.count) % this.maxInFlight;
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (fence === null) return;
    this.fences[i] = fence;
    this.queuedAt[i] = nowMs;
    this.count++;
  }

  /** Pacing switched off (`RenderRuntime.setFramePacing`): the fences in flight are deleted, nothing is counted any more. */
  clear(): void {
    for (let k = 0; k < this.count; k++) {
      const fence = this.fences[(this.head + k) % this.maxInFlight] ?? null;
      if (fence !== null) this.gl.deleteSync(fence);
    }
    this.reset();
  }

  /** Context lost: the fences died with it, nothing is in flight. */
  reset(): void {
    this.fences.fill(null);
    this.head = 0;
    this.count = 0;
  }
}
