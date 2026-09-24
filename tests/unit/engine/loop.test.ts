import { describe, expect, it } from 'vitest';
import { FixedStepLoop, MAX_TIME_SCALE, animationFrameClock, type FixedStepLoopOptions } from '../../../src/engine/loop';
import { BALANCE } from '../../../src/content/balance';

interface Harness {
  loop: FixedStepLoop;
  ticks: number[];
  alphas: number[];
  frameSeconds: number[];
  scheduled: Array<() => void>;
  cancelled: unknown[];
  clock: { now: number };
}

function harness(extra: Partial<FixedStepLoopOptions> = {}): Harness {
  const h: Omit<Harness, 'loop'> = { ticks: [], alphas: [], frameSeconds: [], scheduled: [], cancelled: [], clock: { now: 0 } };
  let handle = 0;
  const loop = new FixedStepLoop({
    now: () => h.clock.now,
    schedule: (cb) => {
      h.scheduled.push(cb);
      return ++handle;
    },
    cancel: (hd) => h.cancelled.push(hd),
    update: (_dt, tick) => h.ticks.push(tick),
    render: (alpha, frameSeconds) => {
      h.alphas.push(alpha);
      h.frameSeconds.push(frameSeconds);
    },
    ...extra,
  });
  return { ...h, loop };
}

describe('FixedStepLoop', () => {
  it('runs exact tick counts for 60 Hz frames', () => {
    const h = harness();
    h.loop.advance(0);
    for (let i = 1; i <= 60; i++) h.loop.advance((i * 1000) / 60);
    expect(h.ticks.length).toBe(60);
    expect(h.ticks).toEqual(Array.from({ length: 60 }, (_, i) => i));
    expect(h.loop.tick).toBe(60);
    expect(h.loop.stats.frames).toBe(61);
  });

  it('runs two ticks per 30 Hz frame and half a tick per 120 Hz frame', () => {
    const h30 = harness();
    h30.loop.advance(0);
    for (let i = 1; i <= 30; i++) h30.loop.advance((i * 1000) / 30);
    expect(h30.ticks.length).toBe(60);

    const h120 = harness();
    h120.loop.advance(0);
    const perFrame: number[] = [];
    for (let i = 1; i <= 120; i++) {
      const before = h120.ticks.length;
      h120.loop.advance((i * 1000) / 120);
      perFrame.push(h120.ticks.length - before);
    }
    expect(h120.ticks.length).toBe(60);
    expect(perFrame.every((n) => n === 0 || n === 1)).toBe(true);
  });

  it.each([30, 60, 120, 144, 165])('simulated %i Hz display: exactly 60 simulation ticks per second, alpha ∈ [0, 1)', (hz) => {
    const h = harness();
    h.loop.advance(0);
    const seconds = 10;
    for (let i = 1; i <= hz * seconds; i++) h.loop.advance((i * 1000) / hz);
    expect(h.ticks.length).toBe(60 * seconds);
    for (const a of h.alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
    // Steady frame rates never hit the catch-up cap.
    expect(h.loop.stats.droppedFrames).toBe(0);
  });

  it('passes the fixed step length and frame time', () => {
    let step = 0;
    const h = harness({ update: (dt) => (step = dt) });
    h.loop.advance(1000);
    h.loop.advance(1025);
    expect(step).toBeCloseTo(1 / 60, 12);
    expect(h.frameSeconds).toEqual([0, 0.025]);
    expect(h.loop.stats.lastFrameMs).toBe(25);
  });

  it('keeps alpha in [0, 1) and matches the accumulator', () => {
    const h = harness();
    h.loop.advance(0);
    h.loop.advance(25); // 1 tick + 8.333 ms
    expect(h.ticks.length).toBe(1);
    expect(h.alphas[1]).toBeCloseTo((25 - 1000 / 60) / (1000 / 60), 9);
    let t = 25;
    for (let i = 0; i < 500; i++) {
      t += 3 + ((i * 7) % 23);
      h.loop.advance(t);
    }
    for (const a of h.alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('caps catch-up steps and counts dropped time', () => {
    const h = harness({ maxCatchUp: 5 });
    h.loop.advance(0);
    h.loop.advance(1000); // 60 steps due
    expect(h.ticks.length).toBe(5);
    expect(h.loop.stats.lastSteps).toBe(5);
    expect(h.loop.stats.droppedFrames).toBe(1);
    expect(h.loop.stats.droppedMs).toBeCloseTo(1000 - 5 * (1000 / 60), 6);
    // The next normal frame runs normally again.
    h.loop.advance(1000 + 1000 / 60);
    expect(h.ticks.length).toBe(6);
  });

  it('does not run an extra tick after a capped frame (remainder rounding)', () => {
    // 500 ms and 2000 ms leave `acc % stepMs` = "one step minus rounding noise" in binary floating
    // point; that remainder must be dropped, not carried into the next frame as a whole tick.
    for (const hitch of [500, 2000, 333.3333333333333, 1000, 3000]) {
      const h = harness({ maxCatchUp: 5 });
      h.loop.advance(0);
      h.loop.advance(hitch);
      expect(h.ticks.length).toBe(5);
      for (let i = 1; i <= 60; i++) {
        const before = h.ticks.length;
        h.loop.advance(hitch + (i * 1000) / 60);
        expect(h.ticks.length - before).toBe(1);
      }
      for (const a of h.alphas) expect(a).toBeLessThan(1);
    }
  });

  it('pause freezes the simulation but keeps rendering; resume does not catch up', () => {
    const h = harness();
    h.loop.advance(0);
    h.loop.advance(10);
    const alphaBefore = h.loop.alpha;
    h.loop.pause();
    expect(h.loop.paused).toBe(true);
    for (let i = 1; i <= 100; i++) h.loop.advance(10 + i * 16);
    expect(h.ticks.length).toBe(0);
    expect(h.alphas.length).toBe(102);
    expect(h.alphas.slice(2).every((a) => a === alphaBefore)).toBe(true);
    h.loop.resume();
    h.loop.advance(10 + 100 * 16 + 1000 / 60);
    expect(h.ticks.length).toBe(1);
  });

  it('pause reasons are independent: ending one pause does not cancel another', () => {
    const h = harness();
    h.loop.advance(0);
    h.loop.pause('debug');
    h.loop.pause('hidden');
    expect(h.loop.pausedFor('debug')).toBe(true);
    h.loop.resume('hidden');
    expect(h.loop.paused).toBe(true);
    for (let i = 1; i <= 30; i++) h.loop.advance((i * 1000) / 60);
    expect(h.ticks.length).toBe(0);
    h.loop.resume('debug');
    expect(h.loop.paused).toBe(false);
    h.loop.advance(31 * (1000 / 60));
    expect(h.ticks.length).toBe(1);
    // Resuming a reason that is not active is a no-op.
    h.loop.resume('menu');
    expect(h.loop.paused).toBe(false);
  });

  it('beginFrame runs once per frame before the steps, also while paused', () => {
    const order: string[] = [];
    const h = harness({
      beginFrame: (s) => order.push(`begin:${s.toFixed(3)}`),
      update: () => order.push('update'),
      render: () => order.push('render'),
    });
    h.loop.advance(0);
    h.loop.advance(1000 / 30);
    h.loop.pause();
    h.loop.advance(2000 / 30);
    expect(order).toEqual(['begin:0.000', 'render', 'begin:0.033', 'update', 'update', 'render', 'begin:0.033', 'render']);
  });

  it('time scale slows down and speeds up the simulation', () => {
    const half = harness();
    half.loop.setTimeScale(0.5);
    half.loop.advance(0);
    for (let i = 1; i <= 60; i++) half.loop.advance((i * 1000) / 60);
    expect(half.ticks.length).toBe(30);

    const fast = harness();
    fast.loop.setTimeScale(8);
    fast.loop.advance(0);
    for (let i = 1; i <= 60; i++) fast.loop.advance((i * 1000) / 60);
    expect(fast.ticks.length).toBe(480);

    const frozen = harness();
    frozen.loop.setTimeScale(0);
    frozen.loop.advance(0);
    frozen.loop.advance(1000);
    expect(frozen.ticks.length).toBe(0);

    expect(() => half.loop.setTimeScale(-1)).toThrow(RangeError);
    expect(() => half.loop.setTimeScale(MAX_TIME_SCALE + 1)).toThrow(RangeError);
    expect(() => half.loop.setTimeScale(Number.NaN)).toThrow(RangeError);
  });

  it('sleep runs time ×30 (§11.5): the scale is accepted and the catch-up cap grows with it', () => {
    const scale = BALANCE.sleep.timeScale;
    expect(scale).toBeLessThanOrEqual(MAX_TIME_SCALE);
    const h = harness();
    h.loop.setTimeScale(scale);
    h.loop.advance(0);
    for (let i = 1; i <= 60; i++) h.loop.advance((i * 1000) / 60);
    expect(h.ticks.length).toBe(60 * scale);
    expect(h.loop.stats.droppedMs).toBe(0);
  });

  it('start/stop drive the injected scheduler', () => {
    const h = harness();
    h.clock.now = 500;
    h.loop.start();
    h.loop.start();
    expect(h.loop.running).toBe(true);
    expect(h.scheduled.length).toBe(1);
    h.clock.now = 500 + 1000 / 60;
    (h.scheduled.shift() as () => void)();
    expect(h.ticks.length).toBe(1);
    expect(h.scheduled.length).toBe(1);
    h.loop.stop();
    expect(h.loop.running).toBe(false);
    expect(h.cancelled).toEqual([2]);
    // A stale callback after stop does nothing.
    (h.scheduled.shift() as () => void)();
    expect(h.ticks.length).toBe(1);
    // Restarting does not simulate the stopped period.
    h.clock.now = 10_000;
    h.loop.start();
    h.clock.now = 10_000 + 1000 / 60;
    (h.scheduled.shift() as () => void)();
    expect(h.ticks.length).toBe(2);
  });

  it('a throwing update stops the loop cleanly so start() can restart it', () => {
    let fail = true;
    const h = harness({
      update: (_dt, tick) => {
        if (fail) throw new Error('boom');
        h.ticks.push(tick);
      },
    });
    h.clock.now = 0;
    h.loop.start();
    h.clock.now = 1000 / 60;
    expect(() => (h.scheduled.shift() as () => void)()).toThrow('boom');
    expect(h.loop.running).toBe(false);
    expect(h.scheduled.length).toBe(0);
    fail = false;
    h.clock.now = 5000;
    h.loop.start();
    expect(h.loop.running).toBe(true);
    h.clock.now = 5000 + 1000 / 60;
    (h.scheduled.shift() as () => void)();
    // Tick 0 never completed, so it runs again; its accumulated step is kept (like `stop()`).
    expect(h.ticks).toEqual([0, 1]);
    expect(h.scheduled.length).toBe(1);
  });

  it('reports rolling frame statistics', () => {
    const h = harness();
    h.loop.advance(0);
    h.loop.advance(10);
    h.loop.advance(30);
    const s = h.loop.stats;
    expect(s.frames).toBe(3);
    expect(s.avgFrameMs).toBeCloseTo(10, 9);
    expect(s.ticks).toBe(1);
  });

  it('setTick, resetAccumulator and option validation', () => {
    const h = harness();
    h.loop.setTick(1000);
    h.loop.advance(0);
    h.loop.advance(20);
    expect(h.ticks).toEqual([1000]);
    h.loop.resetAccumulator();
    expect(h.loop.alpha).toBe(0);
    expect(() => h.loop.setTick(-1)).toThrow(RangeError);
    expect(() => harness({ stepHz: 0 })).toThrow(RangeError);
    expect(() => harness({ maxCatchUp: 0 })).toThrow(RangeError);
    const h30 = harness({ stepHz: 30 });
    expect(h30.loop.stepMs).toBeCloseTo(1000 / 30, 12);
  });

  it('animationFrameClock adapts a browser-like host', () => {
    const calls: string[] = [];
    const clock = animationFrameClock({
      performance: { now: () => 123 },
      requestAnimationFrame: (cb) => {
        calls.push('raf');
        cb(0);
        return 7;
      },
      cancelAnimationFrame: (id) => calls.push(`cancel${id}`),
    });
    expect(clock.now()).toBe(123);
    let ran = false;
    const handle = clock.schedule(() => {
      ran = true;
    });
    expect(ran).toBe(true);
    clock.cancel(handle);
    expect(calls).toEqual(['raf', 'cancel7']);
  });
});
