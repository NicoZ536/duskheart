/**
 * The browser's own trace in E2E runs (ADR-0037, M4-Gate): Chromium's `toplevel` and `devtools.timeline`
 * categories, read after `browser.stopTracing()`. The page's own work is judged by the thread time (`tdur`) of the
 * tasks of its main thread – wall time also counts the time the thread waited for a core beside SwiftShader, so it is
 * reported, not judged.
 */

/** A trace event of Chromium's `toplevel` or `devtools.timeline` category (times in µs; `tdur` = thread time). */
export interface TraceEvent {
  readonly name: string;
  readonly ph: string;
  readonly pid: number;
  readonly tid: number;
  readonly ts: number;
  readonly dur?: number;
  readonly tdur?: number;
  readonly args?: { readonly name?: string; readonly data?: { readonly functionName?: string; readonly message?: string } };
}

/** `pid:tid` of the page's main threads in a trace. */
export function mainThreads(events: readonly TraceEvent[]): Set<string> {
  return new Set(events.filter((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map((e) => `${e.pid}:${e.tid}`));
}

/** The tasks of the page's main threads (`ThreadControllerImpl::RunTask`), in trace order. */
export function mainThreadTasks(events: readonly TraceEvent[]): TraceEvent[] {
  const threads = mainThreads(events);
  return events.filter((e) => e.ph === 'X' && e.name === 'ThreadControllerImpl::RunTask' && threads.has(`${e.pid}:${e.tid}`));
}

/** Thread time of a complete event [ms] (its wall time where the trace has no thread time). */
export function threadMs(e: TraceEvent): number {
  return (e.tdur ?? e.dur ?? 0) / 1000;
}

/** Time [µs] of the page's `console.timeStamp(message)` in the trace (`TimeStamp`), or `null`. */
export function timeStampAt(events: readonly TraceEvent[], message: string): number | null {
  return events.find((e) => e.name === 'TimeStamp' && e.args?.data?.message === message)?.ts ?? null;
}

/** Starts [µs] of the animation-frame callbacks (`FireAnimationFrame`) of the page's main threads, ascending. */
export function animationFrameStarts(events: readonly TraceEvent[]): number[] {
  const threads = mainThreads(events);
  return events
    .filter((e) => e.ph === 'X' && e.name === 'FireAnimationFrame' && threads.has(`${e.pid}:${e.tid}`))
    .map((e) => e.ts)
    .sort((a, b) => a - b);
}
