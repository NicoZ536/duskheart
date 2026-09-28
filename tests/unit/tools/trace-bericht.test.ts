/**
 * Report of the longest main-thread tasks in the E2E frame tests (tests/e2e/trace.ts, M4-Gate): an outlier names
 * where its task was posted from and the trace events it spent its thread time on – a frame callback, a garbage
 * collection of V8 or of Blink (`cppgc`), or browser work without any nested event.
 */
import { describe, expect, it } from 'vitest';
import { FRAME_TRACE_CATEGORIES, longestTasks, type TraceEvent } from '../../e2e/trace';

const PID = 7;
const MAIN = 1;
const OTHER = 2;

/** A complete event on thread `tid` from `ts` for `dur` µs wall and `tdur` µs thread time. */
function x(name: string, ts: number, dur: number, tdur: number, tid = MAIN, args?: TraceEvent['args']): TraceEvent {
  return { name, ph: 'X', pid: PID, tid, ts, dur, tdur, ...(args === undefined ? {} : { args }) };
}

const task = (ts: number, dur: number, tdur: number, src: string, fn: string): TraceEvent => x('ThreadControllerImpl::RunTask', ts, dur, tdur, MAIN, { src_file: `third_party/blink/${src}`, src_func: fn });

const EVENTS: TraceEvent[] = [
  { name: 'thread_name', ph: 'M', pid: PID, tid: MAIN, ts: 0, args: { name: 'CrRendererMain' } },
  { name: 'thread_name', ph: 'M', pid: PID, tid: OTHER, ts: 0, args: { name: 'Compositor' } },
  // A frame: the game's callback.
  task(1000, 6000, 5000, 'proxy_impl.cc', 'ScheduledActionSendBeginMainFrame'),
  x('FireAnimationFrame', 1100, 5000, 4800),
  x('FunctionCall', 1200, 4800, 4700, MAIN, { data: { functionName: 'Game.frameCallback' } }),
  // A major collection.
  task(20_000, 12_000, 11_000, 'incremental-marking-job.cc', 'ScheduleTask'),
  x('MajorGC', 20_100, 11_800, 10_900),
  x('V8.GC_MC_EVACUATE', 20_200, 6000, 5500),
  // Blink's sweeping.
  task(40_000, 4000, 3900, 'sweeper.cc', 'IncrementalSweepTask'),
  x('CppGC.IncrementalSweep', 40_050, 3900, 3850),
  // A timer whose thread time lies before its script call: no event names it but the timer itself.
  task(60_000, 32_100, 18_500, 'dom_timer.cc', 'DOMTimer'),
  x('TimerFire', 60_010, 32_080, 18_450),
  x('FunctionCall', 92_000, 70, 68, MAIN, { data: { functionName: 'ping' } }),
  // Another thread's long task is not the page's main thread.
  x('ThreadControllerImpl::RunTask', 100_000, 50_000, 50_000, OTHER),
];

describe('longestTasks (E2E-Trace-Bericht)', () => {
  it('ordnet nach Thread-Zeit und nennt Herkunft und schwerste Ereignisse', () => {
    const report = longestTasks(EVENTS, 3);
    expect(report.map((t) => t.cpu)).toEqual([18.5, 11, 5]);
    expect(report[0]).toEqual({ cpu: 18.5, wall: 32.1, src: 'dom_timer.cc:DOMTimer', top: [['TimerFire', 18.5], ['FunctionCall:ping', 0.1]] });
    expect(report[1]?.src).toBe('incremental-marking-job.cc:ScheduleTask');
    expect(report[1]?.top.slice(0, 2)).toEqual([
      ['MajorGC', 10.9],
      ['V8.GC_MC_EVACUATE', 5.5],
    ]);
    expect(report[2]?.top).toEqual([
      ['FireAnimationFrame', 4.8],
      ['FunctionCall:Game.frameCallback', 4.7],
    ]);
  });

  it('beschränkt sich auf die Tasks, die `include` annimmt (das Fenster eines Laufs)', () => {
    const report = longestTasks(EVENTS, 5, (t) => t.ts >= 30_000 && t.ts < 70_000);
    expect(report.map((t) => t.src)).toEqual(['dom_timer.cc:DOMTimer', 'sweeper.cc:IncrementalSweepTask']);
    expect(report[1]?.top).toEqual([['CppGC.IncrementalSweep', 3.9]]);
  });

  it('die Frame-Tests zeichnen Blinks Speicherbereinigung mit auf', () => {
    expect(FRAME_TRACE_CATEGORIES).toEqual(['toplevel', 'devtools.timeline', 'cppgc']);
  });
});
