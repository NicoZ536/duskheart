/**
 * Saving the running game (MASTERPROMPT §28 "Autosave alle 3 min (inkrementell, nur geänderte Chunks, im Worker), beim
 * Schlafen, beim Verlassen und bei `visibilitychange`; atomar per Transaktion; die letzten 3 Autosaves rotierend";
 * docs/SPIEL.md §25 "Speicherslots"; M7-57).
 *
 * `Autosaver` is the page's saver of one session's world:
 * - **Capture** (`capture`, synchronous, between two ticks – the caller never calls it inside `Simulation.step`): the
 *   participants' snapshot and the chunk changes since the last capture (`collectChanges`, marked saved at once: the writer
 *   holds them now). Nothing else runs on the main thread – hash, packing, compression and the transaction are the save
 *   writer's (src/save/writer.ts, in the save worker).
 * - **Slots:** `save('main')` is the player's save; `save('auto')` writes the next rotating autosave (`nextAutosaveSlot`).
 * - **When:** `frame(ms, playing)` counts real play time; after `game.autosaveMinutes` of it an autosave runs. The page calls
 *   `save('auto')` on its own triggers too: falling asleep (`sleepStarted`), the tab hidden (`visibilitychange`), leaving
 *   (`pagehide`). Saves run one after another; a save asked for while one of its kind still waits is not queued twice.
 * The wall clock (`now`) and the interval come from the caller – nothing here reads globals.
 */
import type { Simulation } from '../game/sim';
import { contentWorldIdTables, serializeWorldIdTables } from '../world/model/runtimeIds';
import { WORLD_GEN_VERSION } from '../world/gen/world';
import type { ChunkChangeSet } from '../world/stream/chunkManager';
import { simulationRegistry } from './world';
import { MAIN_SLOT, nextAutosaveSlot, type SlotStamp } from './slots';
import type { SaveService } from './saveService';
import type { SaveWriteRequest, SaveWriteResult } from './writer';

/** Real milliseconds per minute of the autosave interval. */
const MS_PER_MINUTE = 60_000;

/** Which save: the player's own (`main`) or the next rotating autosave. */
export type SaveKind = 'main' | 'auto';

/** The world being saved: its id and the name shown in the menu. */
export interface SaveTarget {
  readonly worldId: string;
  readonly name: string;
}

export interface AutosaverOptions {
  readonly sim: Simulation;
  readonly service: Pick<SaveService, 'write' | 'takeLost'>;
  readonly target: SaveTarget;
  /** Wall clock [epoch ms] (`Date.now` in the browser). */
  readonly now: () => number;
  /** Build version (`__DH_VERSION__`). */
  readonly gameVersion: string;
  /** Interval of the autosave [minutes] (`settings.game.autosaveMinutes`, read each frame: a change applies at once). */
  readonly intervalMinutes: () => number;
  /** The slots the world already has (from the store), for the rotation. */
  readonly slots?: readonly SlotStamp[];
  /** Told after every save that succeeded / failed. */
  readonly onSaved?: (result: SaveWriteResult, kind: SaveKind) => void;
  readonly onError?: (error: Error, kind: SaveKind) => void;
  /** High-resolution clock [ms] (`performance.now`): measures the main thread's share of a save (`lastCaptureMs`). */
  readonly clock?: () => number;
}

/** The chunk store's side of a capture (the world materialised; absent: no chunk changed). */
interface ChunkChanges {
  collectChanges(): ChunkChangeSet;
  markSaved(set: ChunkChangeSet): void;
  forgetStorage(): void;
}

/** Saves one session's world (see the module comment). */
export class Autosaver {
  private playedMs = 0;
  private readonly stamps: SlotStamp[];
  private chain: Promise<unknown> = Promise.resolve();
  private readonly waiting = new Set<SaveKind>();
  /** Saves written and failed since the page started (debug and E2E). */
  savedCount = 0;
  failedCount = 0;
  /** Main-thread time of the last capture [ms] (0 without a `clock`): §28 asks that a save never blocks it a frame long. */
  lastCaptureMs = 0;

  constructor(private readonly options: AutosaverOptions) {
    this.stamps = [...(options.slots ?? [])];
  }

  /** Play time since the last save [ms]. */
  get sinceLastSave(): number {
    return this.playedMs;
  }

  /** The slot the next autosave writes. */
  nextAutoSlot(): string {
    return nextAutosaveSlot(this.stamps);
  }

  /** Counts `ms` of real time (only while the game runs); an autosave starts once the interval is reached. */
  frame(ms: number, playing: boolean): void {
    if (!playing || !(ms > 0)) return;
    this.playedMs += ms;
    if (this.playedMs >= this.options.intervalMinutes() * MS_PER_MINUTE) void this.save('auto');
  }

  /**
   * Captures the world now (between two ticks) and writes it into `main` or the next autosave, after the saves before it.
   * Resolves to the result, or null when a save of this kind was already waiting (it will carry the newer state) or failed.
   */
  save(kind: SaveKind): Promise<SaveWriteResult | null> {
    if (this.waiting.has(kind)) return Promise.resolve(null);
    // The interval counts from this save on, whether it succeeds or not (a failing store is not hammered every frame).
    this.playedMs = 0;
    const slot = kind === 'main' ? MAIN_SLOT : this.reserveAutoSlot();
    const clock = this.options.clock;
    const t0 = clock?.() ?? 0;
    const request = this.capture(slot);
    this.lastCaptureMs = clock === undefined ? 0 : clock() - t0;
    this.waiting.add(kind);
    const run = async (): Promise<SaveWriteResult | null> => {
      this.waiting.delete(kind);
      try {
        const result = await this.options.service.write(request);
        this.savedCount++;
        this.options.onSaved?.(result, kind);
        return result;
      } catch (err) {
        this.failedCount++;
        this.options.onError?.(err instanceof Error ? err : new Error(String(err)), kind);
        return null;
      }
    };
    const next = this.chain.then(run, run);
    this.chain = next;
    return next;
  }

  /** Everything written before resolves (leaving the game after its last save). */
  settled(): Promise<void> {
    return this.chain.then(() => undefined);
  }

  /** The next autosave slot, stamped now so two autosaves in a row take two slots. */
  private reserveAutoSlot(): string {
    const slot = nextAutosaveSlot(this.stamps);
    const at = this.options.now();
    const i = this.stamps.findIndex((s) => s.slot === slot);
    if (i >= 0) this.stamps.splice(i, 1);
    this.stamps.push({ slot, savedAt: at });
    return slot;
  }

  /** The save request of the world now (synchronous, between two ticks). */
  capture(slot: string): SaveWriteRequest {
    const { sim, target } = this.options;
    const snapshot = simulationRegistry(sim).serializeAll();
    const chunks: ChunkChanges | null = sim.world.materialized ? sim.world.chunks : null;
    // A writer that lost its bookkeeping (its worker failed) gets every changed chunk again.
    if (this.options.service.takeLost()) chunks?.forgetStorage();
    const set = chunks?.collectChanges() ?? null;
    if (set !== null) chunks?.markSaved(set);
    return {
      worldId: target.worldId,
      name: target.name,
      slot,
      now: this.options.now(),
      gameVersion: this.options.gameVersion,
      generatorVersion: WORLD_GEN_VERSION,
      config: sim.config,
      tick: sim.tick,
      day: sim.clock.day,
      ids: serializeWorldIdTables(contentWorldIdTables()),
      snapshot,
      changes: set?.writes ?? [],
    };
  }
}
