/**
 * Mandatory catch-up registry (docs/WORLD.md §5, docs/ARCHITEKTUR.md "Aktive Zone", MASTERPROMPT
 * §3.3 "Kein System darf voraussetzen, dass ferne Chunks tickten").
 *
 * Every time-dependent simulation system (one with `update`, `worldTick` or `dailyTick`) declares
 * how it relates to frozen chunks:
 * - chunk bound: it registers `catchUp(chunk, fromTick, toTick)`, which brings the system's state of
 *   a frozen chunk analytically from `fromTick` to `toTick` (growth counts crossed 06:00 borders,
 *   spoilage multiplies rate × duration, stations process whole batches …);
 * - global: it runs every tick regardless of chunks (clock, calendar, weather, event planning) and
 *   declares that with a reason.
 * `seal(systems)` checks the declarations against the simulation's system list and throws
 * `CatchUpCoverageError` naming every time-dependent system without either declaration, so a new
 * system cannot silently assume that far chunks kept ticking. After sealing, `run` calls the
 * handlers in the fixed system order.
 *
 * Systems may declare themselves (duck typing, no import of the game layer): a `catchUp` method
 * makes a system chunk bound, `timeScope: 'global'` makes it global; `CatchUpRegistry.fromSystems`
 * builds and seals the registry from such a list.
 *
 * Contract of a handler (checked by the integration tests of each system): it depends only on the
 * chunk state, the two ticks and global time series; catching up a → c equals a → b followed by
 * b → c; `fromTick === toTick` changes nothing (the registry skips the call).
 */
import type { ChunkData } from '../model/chunk';

/** Brings a system's state of `chunk` from `fromTick` to `toTick` (analytically, not tick by tick). */
export type CatchUpHandler = (chunk: ChunkData, fromTick: number, toTick: number) => void;

/** The parts of a simulation system the registry inspects (structural; any `SimSystem` fits). */
export interface TimedSystemLike {
  readonly id: string;
  readonly update?: unknown;
  readonly worldTick?: unknown;
  readonly dailyTick?: unknown;
  /** Chunk-bound systems implement the catch-up handler as a method. */
  readonly catchUp?: unknown;
  /** `'global'`: the system runs every tick regardless of chunks. */
  readonly timeScope?: unknown;
}

/** Declared scope of a time-dependent system. */
export const TIME_SCOPE_GLOBAL = 'global';

/** Whether a system has per-tick, world-tick or daily hooks. */
export function isTimeDependent(system: TimedSystemLike): boolean {
  return typeof system.update === 'function' || typeof system.worldTick === 'function' || typeof system.dailyTick === 'function';
}

/** The registry does not match the system list (missing, stale or contradictory declarations). */
export class CatchUpCoverageError extends Error {
  override readonly name = 'CatchUpCoverageError';

  constructor(
    /** Time-dependent systems without catch-up handler or global declaration. */
    readonly missing: readonly string[],
    /** Declarations for systems that are not in the list. */
    readonly stale: readonly string[],
  ) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`time-dependent systems without catch-up handler (register catchUp or declare them global): ${missing.join(', ')}`);
    if (stale.length > 0) parts.push(`declarations for unknown systems: ${stale.join(', ')}`);
    super(`Catch-up registry incomplete – ${parts.join('; ')}`);
  }
}

interface OrderedHandler {
  readonly id: string;
  readonly handler: CatchUpHandler;
}

/** Catch-up handlers of the chunk-bound systems plus the declared global systems. */
export class CatchUpRegistry {
  private readonly handlers = new Map<string, CatchUpHandler>();
  private readonly globals = new Map<string, string>();
  private ordered: readonly OrderedHandler[] | null = null;

  /** Builds and seals a registry from systems that declare `catchUp` or `timeScope: 'global'` themselves. */
  static fromSystems(systems: readonly TimedSystemLike[]): CatchUpRegistry {
    const registry = new CatchUpRegistry();
    for (const system of systems) {
      const global = system.timeScope === TIME_SCOPE_GLOBAL;
      if (typeof system.catchUp === 'function') {
        if (global) throw new TypeError(`System "${system.id}" declares timeScope 'global' and a catchUp handler; it must be one or the other`);
        const method = system.catchUp as (this: unknown, chunk: ChunkData, fromTick: number, toTick: number) => void;
        registry.register(system.id, (chunk, fromTick, toTick) => method.call(system, chunk, fromTick, toTick));
      } else if (global) {
        registry.declareGlobal(system.id, 'declared by the system (timeScope: global)');
      } else if (system.timeScope !== undefined) {
        throw new TypeError(`System "${system.id}": unknown timeScope ${String(system.timeScope)}`);
      }
    }
    return registry.seal(systems);
  }

  /** Whether `seal` succeeded (handlers can run). */
  get sealed(): boolean {
    return this.ordered !== null;
  }

  /** Registers the catch-up handler of a chunk-bound system. */
  register(systemId: string, handler: CatchUpHandler): this {
    this.assertOpen(systemId);
    if (typeof handler !== 'function') throw new TypeError(`Catch-up handler of "${systemId}" must be a function`);
    this.handlers.set(systemId, handler);
    return this;
  }

  /** Declares a system global: it keeps running for the whole world and needs no catch-up. */
  declareGlobal(systemId: string, reason: string): this {
    this.assertOpen(systemId);
    if (reason.trim() === '') throw new TypeError(`Global declaration of "${systemId}" needs a reason`);
    this.globals.set(systemId, reason);
    return this;
  }

  /**
   * Checks the declarations against `systems` (the simulation's system list) and fixes the handler
   * order to the system order. Throws `CatchUpCoverageError` for time-dependent systems without a
   * declaration and for declarations of systems that are not in the list.
   */
  seal(systems: readonly TimedSystemLike[]): this {
    if (this.ordered !== null) throw new Error('Catch-up registry is already sealed');
    const ids = new Set(systems.map((s) => s.id));
    const missing = systems.filter((s) => isTimeDependent(s) && !this.handlers.has(s.id) && !this.globals.has(s.id)).map((s) => s.id);
    const stale = [...this.handlers.keys(), ...this.globals.keys()].filter((id) => !ids.has(id)).sort();
    if (missing.length > 0 || stale.length > 0) throw new CatchUpCoverageError(missing, stale);
    this.ordered = Object.freeze(systems.filter((s) => this.handlers.has(s.id)).map((s) => ({ id: s.id, handler: this.handlers.get(s.id) as CatchUpHandler })));
    return this;
  }

  /** Ids of the chunk-bound systems in run order (after `seal`: system order). */
  chunkSystemIds(): string[] {
    return this.ordered !== null ? this.ordered.map((h) => h.id) : [...this.handlers.keys()];
  }

  /** Ids of the declared global systems with their reasons. */
  globalSystems(): ReadonlyMap<string, string> {
    return this.globals;
  }

  /**
   * Catches `chunk` up from `fromTick` to `toTick`: every chunk-bound handler in system order.
   * Equal ticks change nothing; `toTick < fromTick` is an error (time never runs backwards).
   */
  run(chunk: ChunkData, fromTick: number, toTick: number): void {
    const ordered = this.ordered;
    if (ordered === null) throw new Error('Catch-up registry must be sealed against the system list before chunks are caught up');
    if (!Number.isSafeInteger(fromTick) || !Number.isSafeInteger(toTick) || fromTick < 0) throw new RangeError(`Catch-up of ${chunk.key}: ticks must be integers ≥ 0, got ${String(fromTick)} → ${String(toTick)}`);
    if (toTick < fromTick) throw new RangeError(`Catch-up of ${chunk.key}: toTick ${toTick} lies before fromTick ${fromTick}`);
    if (toTick === fromTick) return;
    for (let i = 0; i < ordered.length; i++) (ordered[i] as OrderedHandler).handler(chunk, fromTick, toTick);
  }

  private assertOpen(systemId: string): void {
    if (this.ordered !== null) throw new Error(`Catch-up registry is sealed; "${systemId}" must be declared before seal()`);
    if (this.handlers.has(systemId) || this.globals.has(systemId)) throw new Error(`Catch-up registry: "${systemId}" is already declared`);
  }
}
