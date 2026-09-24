/**
 * Worker bridge upgrade (M2-02): typed events, protocol version, worker failures, the job queue
 * with per-frame budget and the in-thread fallback.
 */
import { describe, expect, it } from 'vitest';
import {
  JobQueue,
  RPC_VERSION,
  RpcError,
  connectWorker,
  createInProcessChannel,
  createJobExecutor,
  createRpcClient,
  createRpcServer,
  inThreadExecutor,
  rpcTransfer,
  workerExecutor,
  type InProcessPort,
  type RpcErrorEventLike,
  type RpcMessageEvent,
  type WorkerLike,
} from '../../../src/engine/workerBridge';

interface Progress {
  progress: { done: number; total: number };
  log: string;
}

interface CalcApi {
  square(x: number): number;
  slowSquare(x: number): Promise<number>;
  fill(size: number, value: number): ReturnType<typeof rpcTransfer<{ data: Uint8Array }>>;
  sum(data: Float32Array): number;
  boom(message: string): never;
  mutate(data: { list: number[] }): number;
}

/** Handlers that advance a manual clock by `costMs` per call (budget tests). */
function calcHandlers(clock: { ms: number }, costMs: number, calls: string[] = []): CalcApi {
  return {
    square(x) {
      calls.push(`square ${x}`);
      clock.ms += costMs;
      return x * x;
    },
    async slowSquare(x) {
      await Promise.resolve();
      return x * x;
    },
    fill(size, value) {
      const data = new Uint8Array(size).fill(value);
      return rpcTransfer({ data }, [data.buffer]);
    },
    sum(data) {
      let s = 0;
      for (const v of data) s += v;
      return s;
    },
    boom(message) {
      throw new RangeError(message);
    },
    mutate(data) {
      data.list.push(99);
      return data.list.length;
    },
  };
}

function inThreadQueue(budgetMs: number, costMs: number, calls: string[] = []): { q: JobQueue<CalcApi>; clock: { ms: number } } {
  const clock = { ms: 0 };
  return { q: new JobQueue(inThreadExecutor(calcHandlers(clock, costMs, calls)), { frameBudgetMs: budgetMs, now: () => clock.ms }), clock };
}

function workerQueue(maxInFlight: number, budgetMs = 1000): { q: JobQueue<CalcApi>; clock: { ms: number }; calls: string[] } {
  const clock = { ms: 0 };
  const calls: string[] = [];
  const [clientPort, serverPort] = createInProcessChannel();
  createRpcServer(calcHandlers(clock, 0, calls), serverPort);
  const client = createRpcClient<CalcApi>(clientPort);
  return { q: new JobQueue(workerExecutor(client), { frameBudgetMs: budgetMs, now: () => clock.ms, maxInFlight }), clock, calls };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** A `WorkerLike` over an in-process port: messages go through the port, error listeners are kept apart. */
function fakeWorker(port: InProcessPort): { worker: WorkerLike; errorListeners: Array<(e: RpcErrorEventLike) => void>; state: { terminated: boolean } } {
  const errorListeners: Array<(e: RpcErrorEventLike) => void> = [];
  const state = { terminated: false };
  const worker: WorkerLike = {
    postMessage: (m, t) => port.postMessage(m, t),
    addEventListener: ((type: string, l: (e: never) => void) => {
      if (type === 'message') port.addEventListener('message', l as (e: RpcMessageEvent) => void);
      else errorListeners.push(l as (e: RpcErrorEventLike) => void);
    }) as WorkerLike['addEventListener'],
    removeEventListener: ((type: string, l: (e: never) => void) => {
      if (type === 'message') port.removeEventListener('message', l as (e: RpcMessageEvent) => void);
      else errorListeners.splice(errorListeners.indexOf(l as (e: RpcErrorEventLike) => void), 1);
    }) as WorkerLike['removeEventListener'],
    terminate: () => {
      state.terminated = true;
    },
  };
  return { worker, errorListeners, state };
}

describe('typed events and protocol', () => {
  it('delivers typed server events to subscribers until they unsubscribe', async () => {
    const [clientPort, serverPort] = createInProcessChannel();
    const server = createRpcServer<{ ping(): number }, Progress>({ ping: () => 1 }, serverPort);
    const client = createRpcClient<{ ping(): number }, Progress>(clientPort);
    const got: string[] = [];
    const off = client.on('progress', (p) => got.push(`${p.done}/${p.total}`));
    client.on('log', (line) => got.push(line));
    server.emit('progress', { done: 1, total: 4 });
    server.emit('log', 'hallo');
    await flush();
    off();
    server.emit('progress', { done: 2, total: 4 });
    await flush();
    expect(got).toEqual(['1/4', 'hallo']);
    server.dispose();
    server.emit('log', 'nach dispose');
    await flush();
    expect(got).toHaveLength(2);
  });

  it('events can transfer buffers', async () => {
    const [clientPort, serverPort] = createInProcessChannel();
    const server = createRpcServer<Record<never, never>, { chunk: Uint8Array }>({}, serverPort);
    const client = createRpcClient<Record<never, never>, { chunk: Uint8Array }>(clientPort);
    const got: Uint8Array[] = [];
    client.on('chunk', (c) => got.push(c));
    const data = Uint8Array.of(1, 2, 3);
    server.emit('chunk', data, [data.buffer]);
    expect(data.byteLength).toBe(0);
    await flush();
    expect(Array.from(got[0] ?? [])).toEqual([1, 2, 3]);
  });

  it('rejects requests and responses of another protocol version', async () => {
    const [clientPort, serverPort] = createInProcessChannel();
    createRpcServer({ ping: () => 1 }, serverPort);
    const replies: unknown[] = [];
    clientPort.addEventListener('message', (ev: RpcMessageEvent) => replies.push(ev.data));
    clientPort.postMessage({ tag: 'dh-rpc', v: RPC_VERSION + 1, kind: 'req', id: 5, method: 'ping', args: [] }, []);
    await flush();
    expect(replies).toMatchObject([{ id: 5, ok: false, error: { name: 'RpcVersionError' } }]);

    const [a, b] = createInProcessChannel();
    const client = createRpcClient<{ ping(): number }>(a);
    b.addEventListener('message', (ev: RpcMessageEvent) => {
      const req = ev.data as { id: number };
      b.postMessage({ tag: 'dh-rpc', v: RPC_VERSION + 1, kind: 'res', id: req.id, ok: true, value: 1 }, []);
    });
    const err = await client.call('ping').catch((e: unknown) => e);
    expect((err as RpcError).remoteName).toBe('RpcVersionError');
  });

  it('abort() fails pending and later calls', async () => {
    const [clientPort] = createInProcessChannel();
    const client = createRpcClient<{ ping(): number }>(clientPort);
    const pending = client.call('ping');
    client.abort(new Error('weg'));
    await expect(pending).rejects.toThrow('weg');
    await expect(client.call('ping')).rejects.toThrow('weg');
    expect(client.pendingCount).toBe(0);
  });

  it('connectWorker fails pending calls when the worker reports an error and terminates it', async () => {
    const [clientPort] = createInProcessChannel();
    const { worker, errorListeners, state } = fakeWorker(clientPort);
    const conn = connectWorker<{ ping(): number }>(worker);
    const pending = conn.client.call('ping');
    expect(errorListeners).toHaveLength(2);
    for (const l of [...errorListeners]) l({ type: 'error', message: 'SyntaxError in worker' });
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).remoteName).toBe('WorkerError');
    expect((err as RpcError).message).toBe('SyntaxError in worker');
    conn.terminate();
    expect(state.terminated).toBe(true);
    expect(errorListeners).toHaveLength(0);
  });
});

describe('JobQueue in-thread (Node fallback)', () => {
  it('runs jobs by priority, ties in submission order', () => {
    const calls: string[] = [];
    const { q } = inThreadQueue(1000, 0, calls);
    const results: number[] = [];
    for (const [x, p] of [
      [1, 5],
      [2, 1],
      [3, 5],
      [4, 0],
      [5, 1],
    ] as const) {
      q.submit('square', [x], { priority: p, onDone: (r) => results.push(r) });
    }
    q.frame();
    expect(calls).toEqual(['square 4', 'square 2', 'square 5', 'square 1', 'square 3']);
    expect(results).toEqual([16, 4, 25, 1, 9]);
    expect(q.idle).toBe(true);
  });

  it('keeps each frame within the budget and always makes progress', () => {
    const { q } = inThreadQueue(8, 3);
    let done = 0;
    for (let i = 0; i < 10; i++) q.submit('square', [i], { onDone: () => done++ });
    const perFrame: number[] = [];
    while (!q.idle) {
      const s = q.frame();
      perFrame.push(s.started);
      expect(s.elapsedMs).toBeLessThanOrEqual(8 + 3);
    }
    expect(perFrame).toEqual([3, 3, 3, 1]);
    expect(done).toBe(10);
    // A single job larger than the budget still runs (one per frame).
    const slow = inThreadQueue(1, 5);
    for (let i = 0; i < 3; i++) slow.q.submit('square', [i], { onDone: () => undefined });
    expect([slow.q.frame().started, slow.q.frame().started, slow.q.frame().started]).toEqual([1, 1, 1]);
  });

  it('cancels and re-prioritizes queued jobs', () => {
    const calls: string[] = [];
    const { q } = inThreadQueue(1000, 0, calls);
    const a = q.submit('square', [1], { priority: 1, onDone: () => undefined });
    const b = q.submit('square', [2], { priority: 2, onDone: () => undefined });
    const c = q.submit('square', [3], { priority: 3, onDone: () => undefined });
    expect(q.cancel(b)).toBe(true);
    expect(q.setPriority(c, 0)).toBe(true);
    expect(q.queued).toBe(2);
    q.frame();
    expect(calls).toEqual(['square 3', 'square 1']);
    expect([a.state, b.state, c.state]).toEqual(['done', 'cancelled', 'done']);
    expect(q.cancel(a)).toBe(false);
    expect(q.setPriority(a, 5)).toBe(false);
  });

  it('copies arguments and results like a message port (no aliasing, transfer detaches)', () => {
    const { q } = inThreadQueue(1000, 0);
    const list = [1, 2];
    let length = 0;
    q.submit('mutate', [{ list }], { onDone: (n) => (length = n) });
    const data = new Float32Array([1, 2.5]);
    let total = 0;
    q.submit('sum', [data], { transfer: [data.buffer], onDone: (s) => (total = s) });
    let filled: Uint8Array | null = null;
    q.submit('fill', [4, 7], { onDone: (r) => (filled = r.data) });
    q.frame();
    expect(length).toBe(3);
    expect(list).toEqual([1, 2]);
    expect(total).toBe(3.5);
    expect(data.byteLength).toBe(0);
    expect(Array.from(filled ?? [])).toEqual([7, 7, 7, 7]);
  });

  it('reports failures as RpcError through onError, or rethrows without handler', () => {
    const { q } = inThreadQueue(1000, 0);
    const errors: Error[] = [];
    q.submit('boom', ['kaputt'], { onDone: () => undefined, onError: (e) => errors.push(e) });
    q.frame();
    expect(errors[0]).toBeInstanceOf(RpcError);
    expect((errors[0] as RpcError).remoteName).toBe('RangeError');
    q.submit('boom', ['laut'], { onDone: () => undefined });
    expect(() => q.frame()).toThrow('laut');
    const unknownMethod = new JobQueue(inThreadExecutor({} as CalcApi), { frameBudgetMs: 1, now: () => 0 });
    const got: Error[] = [];
    unknownMethod.submit('square', [2], { onDone: () => undefined, onError: (e) => got.push(e) });
    unknownMethod.frame();
    expect((got[0] as RpcError).remoteName).toBe('RpcMethodError');
  });

  it('handles async in-thread handlers as running jobs', async () => {
    const { q } = inThreadQueue(1000, 0);
    let r = 0;
    q.submit('slowSquare', [6], { onDone: (v) => (r = v) });
    q.frame();
    expect(q.inFlight).toBe(1);
    await q.drain(10);
    expect(r).toBe(36);
  });

  it('dispose cancels everything and refuses new jobs', () => {
    const { q } = inThreadQueue(1000, 0);
    const job = q.submit('square', [2], { onDone: () => undefined });
    q.dispose();
    expect(job.state).toBe('cancelled');
    expect(q.frame().started).toBe(0);
    expect(() => q.submit('square', [1], { onDone: () => undefined })).toThrow('disposed');
  });

  it('validates its options', () => {
    const exec = inThreadExecutor(calcHandlers({ ms: 0 }, 0));
    expect(() => new JobQueue(exec, { frameBudgetMs: -1, now: () => 0 })).toThrow(RangeError);
    expect(() => new JobQueue(exec, { frameBudgetMs: 1, now: () => 0, maxInFlight: 0 })).toThrow(RangeError);
    const q = new JobQueue(exec, { frameBudgetMs: 1, now: () => 0 });
    expect(() => q.submit('square', [1], { priority: Number.NaN, onDone: () => undefined })).toThrow(RangeError);
  });
});

describe('JobQueue over a worker port', () => {
  it('holds at most maxInFlight jobs in the worker and delivers only inside frame()', async () => {
    const { q, calls } = workerQueue(2);
    const results: number[] = [];
    for (let i = 1; i <= 5; i++) q.submit('square', [i], { priority: i, onDone: (r) => results.push(r) });
    const first = q.frame();
    expect(first.started).toBe(2);
    expect(q.inFlight).toBe(2);
    await flush();
    expect(calls).toEqual(['square 1', 'square 2']);
    // Results arrived, but callbacks wait for the next frame.
    expect(results).toEqual([]);
    expect(q.ready).toBe(2);
    const second = q.frame();
    expect(second.delivered).toBe(2);
    expect(second.started).toBe(2);
    await q.drain(20);
    expect(results).toEqual([1, 4, 9, 16, 25]);
  });

  it('spreads deliveries over frames according to the budget', async () => {
    const { q, clock } = workerQueue(8, 2);
    let delivered = 0;
    for (let i = 0; i < 8; i++) {
      q.submit('square', [i], {
        onDone: () => {
          delivered++;
          clock.ms += 1;
        },
      });
    }
    q.frame();
    await flush();
    expect(q.ready).toBe(8);
    const perFrame: number[] = [];
    while (q.ready > 0) perFrame.push(q.frame().delivered);
    expect(perFrame).toEqual([2, 2, 2, 2]);
    expect(delivered).toBe(8);
  });

  it('drops results of jobs cancelled while running', async () => {
    const { q } = workerQueue(4);
    const results: number[] = [];
    const a = q.submit('square', [3], { onDone: (r) => results.push(r) });
    q.submit('square', [4], { onDone: (r) => results.push(r) });
    q.frame();
    expect(q.cancel(a)).toBe(true);
    await q.drain(10);
    expect(results).toEqual([16]);
    expect(a.state).toBe('cancelled');
  });

  it('transfers result buffers from the worker', async () => {
    const { q } = workerQueue(1);
    let got: Uint8Array | null = null;
    q.submit('fill', [16, 3], { onDone: (r) => (got = r.data) });
    await q.drain(10);
    expect(Array.from(got ?? [])).toEqual(new Array<number>(16).fill(3));
  });

  it('reports remote failures and a broken worker', async () => {
    const { q } = workerQueue(2);
    const errors: string[] = [];
    q.submit('boom', ['fern'], { onDone: () => undefined, onError: (e) => errors.push(`${(e as RpcError).remoteName}: ${e.message}`) });
    await q.drain(10);
    expect(errors).toEqual(['RangeError: fern']);

    const [clientPort] = createInProcessChannel();
    const client = createRpcClient<CalcApi>(clientPort);
    const dead = new JobQueue(workerExecutor(client), { frameBudgetMs: 1, now: () => 0 });
    const failures: Error[] = [];
    dead.submit('square', [1], { onDone: () => undefined, onError: (e) => failures.push(e) });
    dead.frame();
    client.abort(new RpcError({ name: 'WorkerError', message: 'crashed', stack: '' }));
    await dead.drain(10);
    expect(failures.map((e) => e.message)).toEqual(['crashed']);
  });
});

describe('createJobExecutor', () => {
  it('falls back to the in-thread executor without a worker (Node)', () => {
    const clock = { ms: 0 };
    const handle = createJobExecutor<CalcApi>({ handlers: () => calcHandlers(clock, 0) });
    expect(handle.mode).toBe('inThread');
    const q = new JobQueue(handle.executor, { frameBudgetMs: 1, now: () => 0 });
    let r = 0;
    q.submit('square', [9], { onDone: (v) => (r = v) });
    q.frame();
    expect(r).toBe(81);
    handle.dispose();
  });

  it('falls back and reports why when spawning fails', () => {
    const reasons: unknown[] = [];
    const handle = createJobExecutor<CalcApi>({
      spawn: () => {
        throw new Error('Module workers not supported');
      },
      handlers: () => calcHandlers({ ms: 0 }, 0),
      onFallback: (e) => reasons.push(e),
    });
    expect(handle.mode).toBe('inThread');
    expect((reasons[0] as Error).message).toBe('Module workers not supported');
  });

  it('uses a spawned worker when available', async () => {
    const [clientPort, serverPort] = createInProcessChannel();
    createRpcServer(calcHandlers({ ms: 0 }, 0), serverPort);
    const { worker, state } = fakeWorker(clientPort);
    let handlersCreated = false;
    const handle = createJobExecutor<CalcApi>({
      spawn: () => worker,
      handlers: () => {
        handlersCreated = true;
        return calcHandlers({ ms: 0 }, 0);
      },
    });
    expect(handle.mode).toBe('worker');
    expect(handlersCreated).toBe(false);
    const q = new JobQueue(handle.executor, { frameBudgetMs: 1, now: () => 0 });
    let r = 0;
    q.submit('square', [7], { onDone: (v) => (r = v) });
    await q.drain(10);
    expect(r).toBe(49);
    handle.dispose();
    expect(state.terminated).toBe(true);
  });
});
