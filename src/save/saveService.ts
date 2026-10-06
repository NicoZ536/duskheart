/**
 * Main-thread side of saving (M7-57): the save worker (src/save/save.worker.ts) behind a typed RPC connection – or the same
 * writer in this thread where no module worker starts (Node, tests, browsers without module workers). A worker that fails
 * (script error, crash) fails its pending calls; the service then continues in this thread and reports once that the
 * writer lost its chunk bookkeeping (`takeLost`): the next capture hands it every changed chunk again
 * (`ChunkManager.forgetStorage`).
 */
import { connectWorker, RpcError, type WorkerConnection, type WorkerLike } from '../engine/workerBridge';
import { SaveError } from './registry';
import { createSaveWorkerHandlers, type SaveBeginRequest, type SaveWorkerApi, type SaveWriteRequest, type SaveWriteResult, type StoreAccess } from './writer';

export interface SaveServiceOptions {
  /** Spawns the save worker (browser); absent or throwing = the writer runs in this thread. */
  readonly spawnWorker?: () => WorkerLike;
  /** How the in-thread writer reaches the store (the fallback; tests use it alone). */
  readonly access: StoreAccess;
  /** Told once when the worker failed and the writer moved into this thread. */
  readonly onFallback?: (reason: string) => void;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Saves through the worker, or in this thread (see the module comment). */
export class SaveService {
  private connection: WorkerConnection<SaveWorkerApi> | null = null;
  private inThread: SaveWorkerApi | null = null;
  private lost = false;

  constructor(private readonly options: SaveServiceOptions) {
    try {
      const worker = options.spawnWorker?.() ?? null;
      if (worker !== null) this.connection = connectWorker<SaveWorkerApi>(worker);
    } catch (err) {
      this.fallBack(`Speicher-Worker nicht verfügbar: ${messageOf(err)}`);
    }
  }

  /** Whether saves run in the worker (false: in this thread). */
  get inWorker(): boolean {
    return this.connection !== null;
  }

  /** True once after the worker failed: the writer lost its chunk bookkeeping (hand it every changed chunk again). */
  takeLost(): boolean {
    const was = this.lost;
    this.lost = false;
    return was;
  }

  begin(request: SaveBeginRequest): Promise<number> {
    return this.call((api) => api.begin(request), (client) => client.call('begin', request));
  }

  write(request: SaveWriteRequest): Promise<SaveWriteResult> {
    return this.call((api) => api.write(request), (client) => client.call('write', request));
  }

  /** Ends the worker (the page leaves the game). */
  dispose(): void {
    this.connection?.terminate();
    this.connection = null;
  }

  private fallBack(reason: string): SaveWorkerApi {
    this.connection?.terminate();
    this.connection = null;
    if (this.inThread === null) {
      this.inThread = createSaveWorkerHandlers(this.options.access);
      this.options.onFallback?.(reason);
    }
    return this.inThread;
  }

  private async call<T>(local: (api: SaveWorkerApi) => Promise<T>, remote: (client: WorkerConnection<SaveWorkerApi>['client']) => Promise<T>): Promise<T> {
    const connection = this.connection;
    if (connection === null) return local(this.inThread ?? this.fallBack('kein Speicher-Worker'));
    try {
      return await remote(connection.client);
    } catch (err) {
      // A failed write of a working worker is the store's error: hand it on. A dead worker took the chunk bookkeeping with it:
      // this request carried only the changes since the last one, so it is not repeated here – the writer moves into this
      // thread and the next save hands it every changed chunk (`takeLost`).
      if (!isWorkerFailure(err)) throw err;
      this.lost = true;
      this.fallBack(`Speicher-Worker ausgefallen: ${messageOf(err)}`);
      throw new SaveError(`Speicher-Worker ausgefallen, der nächste Speicherstand schreibt alles neu: ${messageOf(err)}`);
    }
  }
}

/** Whether an RPC error says the worker itself failed (script error, undeserializable message) rather than a handler. */
function isWorkerFailure(err: unknown): boolean {
  return err instanceof RpcError && err.remoteName === 'WorkerError';
}
