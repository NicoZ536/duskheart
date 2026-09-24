/**
 * M2-GATE: the world host survives a world worker that fails before the world is there (script or
 * load error, a browser without module workers): the worker is dropped and the same generator runs in
 * this thread; the world is identical. Only if generation itself fails does the host report it
 * (`onError`, state `fehler`) – the title card then names the reason instead of standing still.
 *
 * M3-41: a worker that fails *after* the world is there – it stops answering, or reports an error – is
 * given up once (one warning); every open and later chunk job runs in this thread; streaming goes on, no
 * chunk is missing or different, the host stays `bereit`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInProcessChannel, type InProcessPort, type RpcErrorEventLike, type RpcMessageEvent, type WorkerLike } from '../../../src/engine/workerBridge';
import { WorldHost, type FailoverTimers } from '../../../src/render/world/worldHost';
import { generateChunk } from '../../../src/world/gen/chunk';
import { serveWorldWorker } from '../../../src/world/gen/worker';
import { generateWorld, worldHash, type GeneratedWorld } from '../../../src/world/gen/world';
import { chunkHash } from '../../../src/world/model/chunk';
import type { Layer } from '../../../src/world/model/coords';

const SEED = 4711;

/** A worker whose script fails to load: every message is answered with an `error` event. */
class BrokenWorker implements WorkerLike {
  terminated = false;
  private readonly errorListeners = new Set<(event: RpcErrorEventLike) => void>();
  postMessage(): void {
    queueMicrotask(() => {
      for (const l of this.errorListeners) l({ type: 'error', message: 'Failed to fetch module script' });
    });
  }
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: ((event: RpcMessageEvent) => void) | ((event: RpcErrorEventLike) => void)): void {
    if (type === 'error') this.errorListeners.add(listener as (event: RpcErrorEventLike) => void);
  }
  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: ((event: RpcMessageEvent) => void) | ((event: RpcErrorEventLike) => void)): void {
    if (type === 'error') this.errorListeners.delete(listener as (event: RpcErrorEventLike) => void);
  }
  terminate(): void {
    this.terminated = true;
  }
}

/**
 * A world worker served in this process (the real handlers behind an in-memory port) that can fail after
 * the world is there: `silence()` swallows every later message (a worker that died without a word),
 * `crash()` reports an error event (a worker that threw).
 */
class FailingWorker implements WorkerLike {
  terminated = false;
  silent = false;
  readonly posted: string[] = [];
  private readonly main: InProcessPort;
  private readonly errorListeners = new Set<(event: RpcErrorEventLike) => void>();
  constructor() {
    const [main, inner] = createInProcessChannel();
    this.main = main;
    serveWorldWorker(inner);
  }
  postMessage(message: unknown, transfer: Transferable[]): void {
    const m = message as { method?: string };
    if (typeof m.method === 'string') this.posted.push(m.method);
    if (this.silent || this.terminated) return;
    this.main.postMessage(message, transfer);
  }
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: ((event: RpcMessageEvent) => void) | ((event: RpcErrorEventLike) => void)): void {
    if (type === 'message') this.main.addEventListener('message', listener as (event: RpcMessageEvent) => void);
    else if (type === 'error') this.errorListeners.add(listener as (event: RpcErrorEventLike) => void);
  }
  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: ((event: RpcMessageEvent) => void) | ((event: RpcErrorEventLike) => void)): void {
    if (type === 'message') this.main.removeEventListener('message', listener as (event: RpcMessageEvent) => void);
    else if (type === 'error') this.errorListeners.delete(listener as (event: RpcErrorEventLike) => void);
  }
  terminate(): void {
    this.terminated = true;
  }
  silence(): void {
    this.silent = true;
  }
  crash(): void {
    this.silent = true;
    for (const l of this.errorListeners) l({ type: 'error', message: 'Out of memory' });
  }
}

/** Watchdog timers the test fires by hand. */
class ManualTimers implements FailoverTimers {
  private next = 1;
  readonly pending = new Map<number, () => void>();
  set(fn: () => void, _ms: number): unknown {
    const id = this.next++;
    this.pending.set(id, fn);
    return id;
  }
  clear(handle: unknown): void {
    this.pending.delete(handle as number);
  }
  fireAll(): void {
    const fns = [...this.pending.values()];
    this.pending.clear();
    for (const fn of fns) fn();
  }
}

/** Streams around (cx, cy) until every chunk within `radius` is resident (or `frames` pass). */
async function streamAround(host: WorldHost, layer: Layer, cx: number, cy: number, radius: number, frames = 400): Promise<boolean> {
  const all = (): boolean => {
    for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) if (host.get(layer, x, y) === undefined) return false;
    return true;
  };
  for (let i = 0; i < frames && !all(); i++) {
    host.update(layer, cx, cy);
    for (let k = 0; k < 4; k++) await Promise.resolve();
  }
  host.update(layer, cx, cy);
  return all();
}

/** Resolves once the host left the generating state. */
async function settled(host: WorldHost): Promise<void> {
  for (let i = 0; i < 1000 && host.state === 'erzeugt'; i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WorldHost: Ausfall des Welt-Workers', () => {
  it('erzeugt die Welt im Hauptthread, wenn der Worker vor der Welt ausfällt – dieselbe Welt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = new BrokenWorker();
    const steps: string[] = [];
    let ready: GeneratedWorld | null = null;
    const errors: string[] = [];
    const host = new WorldHost({
      seed: SEED,
      preset: 'small',
      spawnWorker: () => broken,
      now: () => performance.now(),
      onProgress: (p) => steps.push(p.step),
      onReady: (w) => (ready = w),
      onError: (m) => errors.push(m),
    });
    host.start();
    await settled(host);
    expect(host.state).toBe('bereit');
    expect(host.mode).toBe('inThread');
    expect(broken.terminated).toBe(true);
    expect(errors).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/Welt-Worker ausgefallen.*Failed to fetch module script/);
    // Progress came from the in-thread run (the worker reported nothing).
    expect(steps.length).toBe(8);
    const world = host.world as GeneratedWorld;
    expect(ready).toBe(world);
    expect(worldHash(world)).toBe(worldHash(generateWorld(SEED, 'small')));
    // The chunk loads run in this thread too: the camera chunk streams in.
    for (let i = 0; i < 200 && host.get(0, 3, 3) === undefined; i++) {
      host.update(0, 3, 3);
      await Promise.resolve();
    }
    expect(host.get(0, 3, 3)?.key).toBe('0:3:3');
    host.dispose();
  }, 30_000);

  it('meldet einen Fehler der Erzeugung einmal über onError (Zustand fehler) statt still zu stehen', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const errors: string[] = [];
    const host = new WorldHost({
      seed: SEED,
      preset: 'small',
      now: () => performance.now(),
      adopt: () => {
        throw new Error('the world does not belong to the simulation');
      },
      onError: (m) => errors.push(m),
    });
    host.start();
    await settled(host);
    expect(host.state).toBe('fehler');
    expect(host.error).toBe('the world does not belong to the simulation');
    expect(errors).toEqual(['the world does not belong to the simulation']);
    expect(err).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('erzeugt nach dispose() nichts mehr', async () => {
    let ready = false;
    const host = new WorldHost({ seed: SEED, preset: 'small', now: () => performance.now(), onReady: () => (ready = true) });
    host.start();
    host.dispose();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ready).toBe(false);
    expect(host.state).toBe('leer');
    expect(host.world).toBeNull();
  });
});

describe('WorldHost: Ausfall des Welt-Workers während der Sitzung (M3-41)', () => {
  for (const how of ['verstummt', 'meldet einen Fehler'] as const) {
    it(`der Worker ${how} nach „bereit“: die Chunks laden im Hauptthread weiter, keine Kachel fehlt, der Zustand bleibt bereit`, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const worker = new FailingWorker();
      const timers = new ManualTimers();
      const errors: string[] = [];
      const host = new WorldHost({ seed: SEED, preset: 'small', spawnWorker: () => worker, now: () => performance.now(), timers, onError: (m) => errors.push(m) });
      host.start();
      await settled(host);
      expect(host.state).toBe('bereit');
      expect(host.mode).toBe('worker');
      // Streaming through the worker.
      expect(await streamAround(host, 0, 6, 6, 1)).toBe(true);
      expect(worker.posted.filter((m) => m === 'load').length).toBeGreaterThan(0);
      const loadsBefore = worker.posted.filter((m) => m === 'load').length;
      // The worker fails; the camera moves on to chunks nobody loaded yet.
      if (how === 'verstummt') worker.silence();
      else worker.crash();
      for (let i = 0; i < 5; i++) {
        host.update(0, 14, 14);
        await Promise.resolve();
      }
      if (how === 'verstummt') {
        // The loads went to the worker and got no answer – until the watchdog gives it up.
        expect(worker.posted.filter((m) => m === 'load').length).toBeGreaterThan(loadsBefore);
        expect(host.mode).toBe('worker');
        timers.fireAll();
      }
      expect(await streamAround(host, 0, 14, 14, 2)).toBe(true);
      expect(host.state).toBe('bereit');
      expect(host.mode).toBe('inThread');
      expect(host.workerFailure).toMatch(how === 'verstummt' ? /keine Antwort/ : /Out of memory/);
      expect(worker.terminated).toBe(true);
      expect(errors).toEqual([]);
      expect(error).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/Welt-Worker ausgefallen, Chunks laden ab jetzt im Hauptthread/);
      // Every chunk is the generator's chunk: nothing missing, nothing different.
      const world = host.world as GeneratedWorld;
      for (let y = 12; y <= 16; y++) for (let x = 12; x <= 16; x++) expect(chunkHash(host.get(0, x, y) as never), `${x},${y}`).toBe(chunkHash(generateChunk(world, 0, x, y)));
      // Later loads run here too (the worker stays gone).
      const posted = worker.posted.length;
      expect(await streamAround(host, 0, 20, 8, 1)).toBe(true);
      expect(worker.posted.length).toBe(posted);
      expect(host.terminateWorker()).toBe(false);
      host.dispose();
    }, 60_000);
  }

  it('terminateWorker (Debug, E2E) beendet den Worker ohne Nachricht – der Wächter merkt es beim nächsten Chunk', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const worker = new FailingWorker();
    const timers = new ManualTimers();
    const host = new WorldHost({ seed: SEED, preset: 'small', spawnWorker: () => worker, now: () => performance.now(), timers });
    host.start();
    await settled(host);
    expect(await streamAround(host, 0, 6, 6, 0)).toBe(true);
    expect(host.terminateWorker()).toBe(true);
    expect(worker.terminated).toBe(true);
    for (let i = 0; i < 5; i++) {
      host.update(0, 9, 9);
      await Promise.resolve();
    }
    expect(timers.pending.size).toBeGreaterThan(0);
    timers.fireAll();
    expect(await streamAround(host, 0, 9, 9, 1)).toBe(true);
    expect(host.mode).toBe('inThread');
    expect(warn).toHaveBeenCalledTimes(1);
    host.dispose();
  }, 60_000);
});
