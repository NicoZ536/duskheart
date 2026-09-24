/**
 * M2-GATE: the world host survives a world worker that fails before the world is there (script or
 * load error, a browser without module workers): the worker is dropped and the same generator runs in
 * this thread; the world is identical. Only if generation itself fails does the host report it
 * (`onError`, state `fehler`) – the title card then names the reason instead of standing still.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RpcErrorEventLike, RpcMessageEvent, WorkerLike } from '../../../src/engine/workerBridge';
import { WorldHost } from '../../../src/render/world/worldHost';
import { generateWorld, worldHash, type GeneratedWorld } from '../../../src/world/gen/world';

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
