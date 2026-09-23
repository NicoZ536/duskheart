/**
 * Typed RPC over worker message ports (docs/ARCHITEKTUR.md "Welt": generation in a worker via the
 * worker bridge, same functions synchronously in Node).
 *
 * - `createRpcServer(handlers, port)`: answers requests by calling `handlers[method](...args)`.
 * - `createRpcClient<Api>(port)`: `client.call('method', ...args)` returns a promise.
 * - Transferables: clients pass them with `callTransfer`; handlers return `rpcTransfer(value, list)`.
 * - Errors thrown by handlers reject the client promise with an `RpcError` carrying name, message
 *   and remote stack.
 * - `createInProcessChannel()`: two connected in-memory ports (Node tests, fallback without
 *   workers) with structured clone semantics.
 */

/** Minimal message event shape used by the bridge. */
export interface RpcMessageEvent {
  readonly data: unknown;
}

/** Minimal `MessagePort`/`Worker`-like interface. */
export interface RpcPort {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: RpcMessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: RpcMessageEvent) => void): void;
  /** `MessagePort` needs `start()` when listeners are attached with `addEventListener`. */
  start?(): void;
}

/** Any function usable as RPC method. */
export type RpcMethod = (...args: never[]) => unknown;
/** Shape constraint of an RPC API (works with interfaces and type aliases). */
export type RpcApiOf<Api> = { [K in keyof Api]: RpcMethod };

/** Tag that marks bridge messages (other traffic on the same port is ignored). */
const RPC_TAG = 'dh-rpc';
/** Protocol version; bumped when the message shape changes. */
const RPC_VERSION = 1;

interface RpcRequest {
  readonly tag: typeof RPC_TAG;
  readonly v: number;
  readonly kind: 'req';
  readonly id: number;
  readonly method: string;
  readonly args: readonly unknown[];
}

interface RpcErrorData {
  readonly name: string;
  readonly message: string;
  readonly stack: string;
}

interface RpcResponse {
  readonly tag: typeof RPC_TAG;
  readonly v: number;
  readonly kind: 'res';
  readonly id: number;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: RpcErrorData;
}

/** A handler result that should be posted with a transfer list. */
export class RpcTransfer<T> {
  constructor(
    readonly value: T,
    readonly transfer: Transferable[],
  ) {}
}

/** Wraps a handler result so `transfer` (e.g. typed array buffers) is moved, not copied. */
export function rpcTransfer<T>(value: T, transfer: Transferable[]): RpcTransfer<T> {
  return new RpcTransfer(value, transfer);
}

/** Result type the client sees for a handler return type. */
export type RpcResult<R> = Awaited<R> extends RpcTransfer<infer V> ? V : Awaited<R>;

/** Error raised on the client when a remote handler fails. */
export class RpcError extends Error {
  /** `name` of the remote error. */
  readonly remoteName: string;
  /** Stack of the remote error (may be empty). */
  readonly remoteStack: string;

  constructor(data: RpcErrorData) {
    super(data.message);
    this.name = 'RpcError';
    this.remoteName = data.name;
    this.remoteStack = data.stack;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isRequest(data: unknown): data is RpcRequest {
  return (
    isRecord(data) &&
    data['tag'] === RPC_TAG &&
    data['kind'] === 'req' &&
    typeof data['id'] === 'number' &&
    typeof data['method'] === 'string' &&
    Array.isArray(data['args'])
  );
}

function isResponse(data: unknown): data is RpcResponse {
  return isRecord(data) && data['tag'] === RPC_TAG && data['kind'] === 'res' && typeof data['id'] === 'number' && typeof data['ok'] === 'boolean';
}

function toErrorData(err: unknown): RpcErrorData {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack ?? '' };
  return { name: 'Error', message: String(err), stack: '' };
}

/** Handle of a running server. */
export interface RpcServer {
  /** Stops answering requests. */
  dispose(): void;
}

/**
 * Serves `handlers` on `port`. Handlers may be sync or async; returning `rpcTransfer(...)` moves
 * the listed transferables. Unknown methods and thrown errors are reported to the caller.
 */
export function createRpcServer<Api extends RpcApiOf<Api>>(handlers: Api, port: RpcPort): RpcServer {
  const table = handlers as Record<string, unknown>;
  let disposed = false;
  const reply = (msg: RpcResponse, transfer: Transferable[]): void => {
    // Requests still in flight when the server is disposed are not answered.
    if (disposed) return;
    try {
      port.postMessage(msg, transfer);
    } catch (err) {
      // The value was not cloneable: report that instead of leaving the caller hanging.
      try {
        port.postMessage({ tag: RPC_TAG, v: RPC_VERSION, kind: 'res', id: msg.id, ok: false, error: toErrorData(err) } satisfies RpcResponse, []);
      } catch {
        // The port itself is unusable (closed); nobody is left to notify.
      }
    }
  };
  const listener = (event: RpcMessageEvent): void => {
    const req = event.data;
    if (disposed || !isRequest(req)) return;
    const fn = Object.prototype.hasOwnProperty.call(table, req.method) ? table[req.method] : undefined;
    if (typeof fn !== 'function') {
      reply({ tag: RPC_TAG, v: RPC_VERSION, kind: 'res', id: req.id, ok: false, error: { name: 'RpcMethodError', message: `Unknown RPC method "${req.method}"`, stack: '' } }, []);
      return;
    }
    Promise.resolve()
      .then(() => (fn as (...args: unknown[]) => unknown).apply(handlers, req.args as unknown[]))
      .then(
        (result) => {
          if (result instanceof RpcTransfer) reply({ tag: RPC_TAG, v: RPC_VERSION, kind: 'res', id: req.id, ok: true, value: result.value }, result.transfer);
          else reply({ tag: RPC_TAG, v: RPC_VERSION, kind: 'res', id: req.id, ok: true, value: result }, []);
        },
        (err: unknown) => reply({ tag: RPC_TAG, v: RPC_VERSION, kind: 'res', id: req.id, ok: false, error: toErrorData(err) }, []),
      );
  };
  port.addEventListener('message', listener);
  port.start?.();
  return {
    dispose() {
      disposed = true;
      port.removeEventListener('message', listener);
    },
  };
}

/** Client side of an RPC API. */
export interface RpcClient<Api extends RpcApiOf<Api>> {
  /** Calls `method` remotely; arguments are structured-cloned. */
  call<K extends keyof Api & string>(method: K, ...args: Parameters<Api[K]>): Promise<RpcResult<ReturnType<Api[K]>>>;
  /** Like `call`, but moves `transfer` (e.g. `ArrayBuffer`s inside `args`) instead of copying. */
  callTransfer<K extends keyof Api & string>(
    method: K,
    transfer: Transferable[],
    ...args: Parameters<Api[K]>
  ): Promise<RpcResult<ReturnType<Api[K]>>>;
  /** Number of calls awaiting a response. */
  readonly pendingCount: number;
  /** Detaches from the port and rejects all pending calls. */
  dispose(): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

/** Creates a typed client for the server on the other end of `port`. */
export function createRpcClient<Api extends RpcApiOf<Api>>(port: RpcPort): RpcClient<Api> {
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let disposed = false;
  const listener = (event: RpcMessageEvent): void => {
    const res = event.data;
    if (!isResponse(res)) return;
    const p = pending.get(res.id);
    if (p === undefined) return;
    pending.delete(res.id);
    if (res.ok) p.resolve(res.value);
    else p.reject(new RpcError(res.error ?? { name: 'Error', message: 'Unknown RPC failure', stack: '' }));
  };
  port.addEventListener('message', listener);
  port.start?.();

  const send = (method: string, args: readonly unknown[], transfer: Transferable[]): Promise<unknown> => {
    if (disposed) return Promise.reject(new Error('RPC client is disposed'));
    const id = nextId++;
    const req: RpcRequest = { tag: RPC_TAG, v: RPC_VERSION, kind: 'req', id, method, args };
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        port.postMessage(req, transfer);
      } catch (err) {
        pending.delete(id);
        reject(err);
      }
    });
  };

  return {
    call(method, ...args) {
      return send(method, args, []) as Promise<never>;
    },
    callTransfer(method, transfer, ...args) {
      return send(method, args, transfer) as Promise<never>;
    },
    get pendingCount() {
      return pending.size;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      port.removeEventListener('message', listener);
      const err = new Error('RPC client disposed');
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    },
  };
}

/** In-memory port pair endpoint (see `createInProcessChannel`). */
export class InProcessPort implements RpcPort {
  private readonly listeners = new Set<(event: RpcMessageEvent) => void>();
  private peer: InProcessPort | null = null;
  private closed = false;

  /** Connects two ports (used by `createInProcessChannel`). */
  static pair(a: InProcessPort, b: InProcessPort): void {
    a.peer = b;
    b.peer = a;
  }

  /** Delivers a structured clone of `message` to the peer asynchronously (microtask). */
  postMessage(message: unknown, transfer: Transferable[] = []): void {
    if (this.closed) return;
    const peer = this.peer;
    if (peer === null) throw new Error('InProcessPort is not connected');
    // structuredClone detaches transferred buffers exactly like a real MessagePort.
    const data: unknown = structuredClone(message, { transfer });
    queueMicrotask(() => peer.dispatch(data));
  }

  private dispatch(data: unknown): void {
    if (this.closed) return;
    const event: RpcMessageEvent = { data };
    for (const l of [...this.listeners]) l(event);
  }

  addEventListener(_type: 'message', listener: (event: RpcMessageEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: RpcMessageEvent) => void): void {
    this.listeners.delete(listener);
  }

  /** Stops delivery in both directions. */
  close(): void {
    this.closed = true;
    if (this.peer !== null && !this.peer.closed) this.peer.close();
    this.listeners.clear();
  }
}

/** Two connected in-memory ports: what one posts, the other receives. */
export function createInProcessChannel(): [InProcessPort, InProcessPort] {
  const a = new InProcessPort();
  const b = new InProcessPort();
  InProcessPort.pair(a, b);
  return [a, b];
}
