/**
 * The browser's own trace in E2E runs (ADR-0037, M4-Gate): Chromium's `toplevel` and `devtools.timeline`
 * categories (the frame tests add `cppgc`), read after `browser.stopTracing()`. The page's own work is judged by the
 * thread time (`tdur`) of the tasks of its main thread – wall time also counts the time the thread waited for a core
 * beside SwiftShader, so it is reported, not judged.
 */

/**
 * Trace categories of the frame tests (`fluessiges-laufen`, `worker-streaming`): `toplevel` (every task of the main
 * thread, with where it was posted from), `devtools.timeline` (frame callbacks, script calls, style and layout, V8's
 * collections) and `cppgc` (Blink's own garbage collector, whose sweeping runs in tasks of the main thread – without
 * it such a task shows no nested event at all).
 */
export const FRAME_TRACE_CATEGORIES: readonly string[] = ['toplevel', 'devtools.timeline', 'cppgc'];

/** A trace event of Chromium's `toplevel`, `devtools.timeline` or `cppgc` category (times in µs; `tdur` = thread time). */
export interface TraceEvent {
  readonly name: string;
  readonly ph: string;
  readonly pid: number;
  readonly tid: number;
  readonly ts: number;
  readonly dur?: number;
  readonly tdur?: number;
  readonly args?: {
    readonly name?: string;
    readonly data?: { readonly functionName?: string; readonly message?: string };
    /** Where a task was posted from (`ThreadControllerImpl::RunTask` of the `toplevel` category). */
    readonly src_file?: string;
    readonly src_func?: string;
  };
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

/** Report of one main-thread task: thread and wall time [ms], where it was posted from and what it spent its time on. */
export interface TaskReport {
  readonly cpu: number;
  readonly wall: number;
  /** Posting location of the task (`file:function` of the Chromium source, e.g. `dom_timer.cc:DOMTimer`). */
  readonly src: string;
  /** The heaviest trace events nested in the task: name (for script calls with the function), summed thread time [ms]. */
  readonly top: ReadonlyArray<readonly [string, number]>;
}

/** Longest function or file names kept in a report. */
const SRC_CHARS = 60;

/**
 * Reported, not judged: the `count` main-thread tasks with the longest thread time – of those `include` accepts (all
 * by default) – and what they spent it on: per task its thread and wall time, where it was posted from, and the six
 * heaviest trace events nested in it (name, for script calls the function, summed thread time; nested events count in
 * each level). Names whatever carries a task that nears the 25-ms line (M4-Gate): a frame callback of the page, a
 * garbage collection, style and layout, or work the browser posted.
 */
export function longestTasks(events: readonly TraceEvent[], count: number, include: (task: TraceEvent) => boolean = () => true): TaskReport[] {
  const threads = mainThreads(events);
  const onMain = events.filter((e) => e.ph === 'X' && threads.has(`${e.pid}:${e.tid}`));
  const tasks = onMain.filter((e) => e.name === 'ThreadControllerImpl::RunTask' && include(e)).sort((a, b) => (b.tdur ?? 0) - (a.tdur ?? 0));
  return tasks.slice(0, count).map((t) => {
    const end = t.ts + (t.dur ?? 0);
    const sums = new Map<string, number>();
    for (const e of onMain) {
      if (e === t || e.pid !== t.pid || e.tid !== t.tid || e.ts < t.ts || e.ts + (e.dur ?? 0) > end) continue;
      const fn = e.args?.data?.functionName;
      const key = fn !== undefined && fn !== '' ? `${e.name}:${fn}` : e.name;
      sums.set(key, (sums.get(key) ?? 0) + (e.tdur ?? e.dur ?? 0) / 1000);
    }
    const top = [...sums].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, ms]) => [k, Math.round(ms * 10) / 10] as const);
    const file = (t.args?.src_file ?? '?').split('/').pop() ?? '?';
    const src = `${file.slice(0, SRC_CHARS)}:${(t.args?.src_func ?? '?').slice(0, SRC_CHARS)}`;
    return { cpu: Math.round((t.tdur ?? 0) / 100) / 10, wall: Math.round((t.dur ?? 0) / 100) / 10, src, top };
  });
}
