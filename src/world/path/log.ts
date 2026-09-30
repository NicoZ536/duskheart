/**
 * Debug data of the path finding (M6-17, M6-35 overlay `pfade`, §31.6): the last path each owner received, kept by
 * the `PathService` while its debug switch is on. The overlay itself belongs to the presentation; it reads here and
 * never writes. Not simulation state: nothing of it is saved or hashed.
 */
import type { Entity } from '../../engine/ecs';
import type { Layer } from '../model/coords';
import { grow } from './grid';
import type { PathResult, PathStatus } from './types';

/** The last path of one owner. */
export interface PathDebugPath {
  readonly owner: Entity;
  readonly layer: Layer;
  /** Tick the path was delivered. */
  readonly tick: number;
  readonly fromTx: number;
  readonly fromTy: number;
  readonly toTx: number;
  readonly toTy: number;
  readonly status: PathStatus;
  readonly steps: number;
  /** Tile pairs x0, y0, x1, y1, … (the first `2 × steps` entries count). */
  readonly tiles: Int32Array;
  /** Nodes the search expanded. */
  readonly expanded: number;
  /** Whether the worker answered in time (else the simulation computed it). */
  readonly byWorker: boolean;
}

class DebugRecord implements PathDebugPath {
  owner: Entity = 0;
  layer: Layer = 0;
  tick = 0;
  fromTx = 0;
  fromTy = 0;
  toTx = 0;
  toTy = 0;
  status: PathStatus = 'none';
  steps = 0;
  tiles = new Int32Array(0);
  expanded = 0;
  byWorker = false;
}

/** Last paths per owner, at most `capacity` owners (the least recently updated one gives way). */
export class PathDebugLog {
  private readonly records: DebugRecord[] = [];
  private readonly used: number[] = [];
  private clock = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError(`PathDebugLog: capacity must be a positive integer, got ${String(capacity)}`);
  }

  /** Keeps a delivered path. */
  record(owner: Entity, layer: Layer, tick: number, fromTx: number, fromTy: number, toTx: number, toTy: number, result: PathResult, byWorker: boolean): void {
    let at = -1;
    let oldest = 0;
    for (let i = 0; i < this.records.length; i++) {
      if ((this.records[i] as DebugRecord).owner === owner) {
        at = i;
        break;
      }
      if ((this.used[i] as number) < (this.used[oldest] as number)) oldest = i;
    }
    if (at < 0) {
      if (this.records.length < this.capacity) {
        at = this.records.length;
        this.records.push(new DebugRecord());
        this.used.push(0);
      } else {
        at = oldest;
      }
    }
    const r = this.records[at] as DebugRecord;
    this.used[at] = ++this.clock;
    r.owner = owner;
    r.layer = layer;
    r.tick = tick;
    r.fromTx = fromTx;
    r.fromTy = fromTy;
    r.toTx = toTx;
    r.toTy = toTy;
    r.status = result.status;
    r.steps = result.steps;
    r.expanded = result.expanded;
    r.byWorker = byWorker;
    if (r.tiles.length < result.steps * 2) r.tiles = new Int32Array(grow(r.tiles.length, result.steps * 2));
    for (let i = 0; i < result.steps * 2; i++) r.tiles[i] = result.tiles[i] as number;
  }

  /** Visits every kept path (in no particular order). */
  forEach(visit: (path: PathDebugPath) => void): void {
    for (let i = 0; i < this.records.length; i++) visit(this.records[i] as DebugRecord);
  }

  /** The last path of `owner`, if kept. */
  pathOf(owner: Entity): PathDebugPath | undefined {
    for (let i = 0; i < this.records.length; i++) if ((this.records[i] as DebugRecord).owner === owner) return this.records[i];
    return undefined;
  }

  /** Number of kept paths. */
  get size(): number {
    return this.records.length;
  }

  /** Forgets every path. */
  clear(): void {
    this.records.length = 0;
    this.used.length = 0;
  }
}
