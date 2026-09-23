import { describe, expect, it } from 'vitest';
import {
  RpcError,
  createInProcessChannel,
  createRpcClient,
  createRpcServer,
  rpcTransfer,
  type RpcPort,
} from '../../../src/engine/workerBridge';

interface GenApi {
  add(a: number, b: number): number;
  greet(name: string): Promise<string>;
  makeChunk(size: number): ReturnType<typeof rpcTransfer<{ tiles: Uint16Array }>>;
  sum(data: Float32Array): number;
  fail(message: string): never;
  failString(): never;
}

function serve(port: RpcPort): { calls: string[]; dispose: () => void } {
  const calls: string[] = [];
  const server = createRpcServer<GenApi>(
    {
      add(a, b) {
        calls.push('add');
        return a + b;
      },
      async greet(name) {
        calls.push('greet');
        await Promise.resolve();
        return `hallo ${name}`;
      },
      makeChunk(size) {
        const tiles = new Uint16Array(size);
        for (let i = 0; i < size; i++) tiles[i] = i * 3;
        return rpcTransfer({ tiles }, [tiles.buffer]);
      },
      sum(data) {
        let s = 0;
        for (const v of data) s += v;
        return s;
      },
      fail(message) {
        const err = new RangeError(message);
        throw err;
      },
      failString() {
        throw 'plain failure';
      },
    },
    port,
  );
  return { calls, dispose: () => server.dispose() };
}

describe('workerBridge over an in-process channel', () => {
  it('calls sync and async handlers with typed results', async () => {
    const [clientPort, serverPort] = createInProcessChannel();
    serve(serverPort);
    const client = createRpcClient<GenApi>(clientPort);
    const [sum, greeting] = await Promise.all([client.call('add', 2, 3), client.call('greet', 'Welt')]);
    expect(sum).toBe(5);
    expect(greeting).toBe('hallo Welt');
    expect(client.pendingCount).toBe(0);
  });

  it('matches concurrent responses by request id', async () => {
    const [clientPort, serverPort] = createInProcessChannel();
    serve(serverPort);
    const client = createRpcClient<GenApi>(clientPort);
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => client.call('add', i, 1000)));
    expect(results).toEqual(Array.from({ length: 50 }, (_, i) => i + 1000));
  });

  it('transfers buffers in both directions', async () => {
    const [clientPort, serverPort] = createInProcessChannel();
    serve(serverPort);
    const client = createRpcClient<GenApi>(clientPort);
    const chunk = await client.call('makeChunk', 1024);
    expect(chunk.tiles).toBeInstanceOf(Uint16Array);
    expect(chunk.tiles.length).toBe(1024);
    expect(chunk.tiles[10]).toBe(30);

    const data = new Float32Array([1, 2, 3.5]);
    const total = await client.callTransfer('sum', [data.buffer], data);
    expect(total).toBe(6.5);
    // The buffer was moved, not copied: the sender's view is detached.
    expect(data.byteLength).toBe(0);
  });

  it('copies arguments without transfer (structured clone)', async () => {
    const [clientPort, serverPort] = createInProcessChannel();
    serve(serverPort);
    const client = createRpcClient<GenApi>(clientPort);
    const data = new Float32Array([4, 5]);
    expect(await client.call('sum', data)).toBe(9);
    expect(data.length).toBe(2);
  });

  it('propagates errors, unknown methods and non-Error throws', async () => {
    const [clientPort, serverPort] = createInProcessChannel();
    serve(serverPort);
    const client = createRpcClient<GenApi>(clientPort);
    const err = await client.call('fail', 'kaputt').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).message).toBe('kaputt');
    expect((err as RpcError).remoteName).toBe('RangeError');
    expect((err as RpcError).remoteStack).toContain('kaputt');
    const plain = await client.call('failString').catch((e: unknown) => e);
    expect((plain as RpcError).message).toBe('plain failure');
    const unknownClient = createRpcClient<{ missing(): void }>(clientPort);
    const missing = await unknownClient.call('missing').catch((e: unknown) => e);
    expect((missing as RpcError).remoteName).toBe('RpcMethodError');
  });

  it('does not dispatch inherited properties as methods', async () => {
    const [clientPort, serverPort] = createInProcessChannel();
    serve(serverPort);
    const client = createRpcClient<{ toString(): string }>(clientPort);
    await expect(client.call('toString')).rejects.toBeInstanceOf(RpcError);
  });

  it('reports uncloneable results instead of hanging', async () => {
    const [clientPort, serverPort] = createInProcessChannel();
    createRpcServer({ bad: () => ({ fn: () => 1 }) }, serverPort);
    const client = createRpcClient<{ bad(): { fn: () => number } }>(clientPort);
    await expect(client.call('bad')).rejects.toBeInstanceOf(RpcError);
  });

  it('dispose rejects pending calls and stops the server', async () => {
    const [clientPort, serverPort] = createInProcessChannel();
    const server = serve(serverPort);
    const client = createRpcClient<GenApi>(clientPort);
    const pending = client.call('add', 1, 1);
    client.dispose();
    await expect(pending).rejects.toThrow('disposed');
    await expect(client.call('add', 1, 1)).rejects.toThrow('disposed');

    server.dispose();
    const second = createRpcClient<GenApi>(clientPort);
    const never = second.call('add', 1, 2);
    let settled = false;
    void never.then(
      () => (settled = true),
      () => (settled = true),
    );
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(settled).toBe(false);
    expect(second.pendingCount).toBe(1);
    second.dispose();
    await expect(never).rejects.toThrow('disposed');
  });

  it('a disposed server does not answer requests that were already in flight', async () => {
    const [clientPort, serverPort] = createInProcessChannel();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const server = createRpcServer({ slow: async () => (await gate, 7) }, serverPort);
    const client = createRpcClient<{ slow(): Promise<number> }>(clientPort);
    const inFlight = client.call('slow');
    let settled = false;
    void inFlight.then(
      () => (settled = true),
      () => (settled = true),
    );
    for (let i = 0; i < 5; i++) await Promise.resolve();
    server.dispose();
    release();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(settled).toBe(false);
    client.dispose();
    await expect(inFlight).rejects.toThrow('disposed');
  });

  it('a closed port during the error fallback does not raise an unhandled rejection', async () => {
    let posts = 0;
    const listeners: Array<(ev: { data: unknown }) => void> = [];
    const brokenPort: RpcPort = {
      postMessage: () => {
        posts++;
        throw new Error('port closed');
      },
      addEventListener: (_type, l) => listeners.push(l),
      removeEventListener: () => undefined,
    };
    createRpcServer({ add: (a: number, b: number) => a + b }, brokenPort);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      for (const l of listeners) l({ data: { tag: 'dh-rpc', v: 1, kind: 'req', id: 1, method: 'add', args: [1, 2] } });
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(posts).toBe(2); // the reply and the error fallback both failed quietly
    expect(unhandled).toEqual([]);
  });

  it('ignores foreign messages on the same port', async () => {
    const [clientPort, serverPort] = createInProcessChannel();
    serve(serverPort);
    const client = createRpcClient<GenApi>(clientPort);
    clientPort.postMessage({ hello: 'world' }, []);
    serverPort.postMessage('noise', []);
    expect(await client.call('add', 20, 22)).toBe(42);
  });

  it('closed ports stop delivering', async () => {
    const [a, b] = createInProcessChannel();
    const got: unknown[] = [];
    b.addEventListener('message', (ev) => got.push(ev.data));
    a.postMessage(1, []);
    await Promise.resolve();
    a.close();
    a.postMessage(2, []);
    await Promise.resolve();
    expect(got).toEqual([1]);
  });

  it('works over a real MessageChannel', async () => {
    const channel = new MessageChannel();
    const serverPort: RpcPort = channel.port2;
    const clientPort: RpcPort = channel.port1;
    const server = serve(serverPort);
    const client = createRpcClient<GenApi>(clientPort);
    expect(await client.call('add', 40, 2)).toBe(42);
    const chunk = await client.call('makeChunk', 8);
    expect(Array.from(chunk.tiles)).toEqual([0, 3, 6, 9, 12, 15, 18, 21]);
    client.dispose();
    server.dispose();
    channel.port1.close();
    channel.port2.close();
  });
});
