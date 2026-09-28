/**
 * The time of one frame until the GPU has finished it, for the first-start benchmark (M5-26) – without a read-back:
 * a synchronous `readPixels` stalls the pipeline and Chrome warns about it on the console ("GPU stall due to
 * ReadPixels"). Instead a fence goes into the command stream after the frame; from the next task on it is polled
 * (a WebGL sync object's status changes only between tasks) – without pause while the time is near the budget
 * (`AUTO_PRESET.spinMs`), then every `slowPollMs`, and given up after `gpuTimeoutMs` (the frame counts with that time).
 * One frame at a time: while a fence is out, later frames are not measured.
 */
import { AUTO_PRESET } from './params';

export type AutoPresetTiming = Pick<typeof AUTO_PRESET, 'spinMs' | 'slowPollMs' | 'gpuTimeoutMs'>;

/** How the next poll is scheduled: at once in the next task, or after `ms`. */
export interface PollScheduler {
  soon(run: () => void): void;
  later(run: () => void, ms: number): void;
}

/** The fences of a WebGL2 context (the part of `WebGL2RenderingContext` the wait uses). */
export type FenceContext = Pick<WebGL2RenderingContext, 'fenceSync' | 'getSyncParameter' | 'deleteSync' | 'flush' | 'isContextLost' | 'SYNC_GPU_COMMANDS_COMPLETE' | 'SYNC_STATUS' | 'SIGNALED'>;

/** The page's scheduler: a message channel for the next task (no 4-ms clamp of nested timeouts), timeouts beyond. */
export function browserPollScheduler(): PollScheduler {
  const channel = new MessageChannel();
  const queue: Array<() => void> = [];
  channel.port1.onmessage = () => queue.shift()?.();
  return {
    soon(run) {
      queue.push(run);
      channel.port2.postMessage(0);
    },
    later(run, ms) {
      setTimeout(run, ms);
    },
  };
}

export class GpuFrameWait {
  private pending: WebGLSync | null = null;

  constructor(
    private readonly gl: FenceContext,
    private readonly scheduler: PollScheduler,
    private readonly now: () => number,
    private readonly timing: AutoPresetTiming = AUTO_PRESET,
  ) {}

  /** Whether a frame is being waited for (the next frame is then not measured). */
  get busy(): boolean {
    return this.pending !== null;
  }

  /**
   * After the frame that began at `startedMs`: waits for its GPU work and calls `done` with the time from its start
   * [ms]. Returns false (nothing measured) while another frame is waited for or when the context has no fence.
   */
  measure(startedMs: number, done: (frameMs: number) => void): boolean {
    if (this.pending !== null) return false;
    const gl = this.gl;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (sync === null) return false;
    gl.flush();
    this.pending = sync;
    const poll = (): void => {
      if (this.pending !== sync) return;
      const lost = gl.isContextLost();
      const signalled = !lost && gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.SIGNALED;
      const elapsed = this.now() - startedMs;
      if (!lost && !signalled && elapsed < this.timing.gpuTimeoutMs) {
        if (elapsed < this.timing.spinMs) this.scheduler.soon(poll);
        else this.scheduler.later(poll, this.timing.slowPollMs);
        return;
      }
      this.pending = null;
      if (!lost) gl.deleteSync(sync);
      if (!lost) done(signalled ? elapsed : this.timing.gpuTimeoutMs);
    };
    this.scheduler.soon(poll);
    return true;
  }

  /** Forgets the frame waited for (context lost: its fence died with the context). */
  cancel(): void {
    this.pending = null;
  }
}
