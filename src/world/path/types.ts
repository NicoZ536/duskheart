/**
 * Path finding of the creatures (M6-16, §19.4, docs/SPIEL.md §12): the types shared by the pure search
 * (src/world/path/), its worker and the simulation's `PathService`.
 *
 * Determinism: a request takes a snapshot of the region it needs at the tick it is made; its result counts from
 * `readyTick = tick + BALANCE.ai.pathLatencyTicks` on. The worker computes it meanwhile; if it has not answered by
 * `readyTick`, the simulation computes the same pure function on the same snapshot itself. The answer therefore never
 * depends on the worker's timing.
 */
import type { Entity } from '../../engine/ecs';

/** How a body moves: walks (land), swims (water only or both), flies (over water and low obstacles). */
export const MOVER_CLASSES = ['land', 'schwimmer', 'amphibie', 'flieger'] as const;
/** One mover class. */
export type MoverClass = (typeof MOVER_CLASSES)[number];

/** A path request. */
export interface PathRequest {
  /** Who asks (for cancelling and budgets per body). */
  owner: Entity;
  layer: number;
  fromTx: number;
  fromTy: number;
  toTx: number;
  toTy: number;
  mover: MoverClass;
  /** Doors count as passable (they break or open them). */
  opensDoors: boolean;
  /** Tiles lit above this level are blocked (shadow brood: 0.5), or null. */
  avoidLightAbove: number | null;
  /** Search limit [nodes] (the hierarchical level counts portals). */
  maxNodes: number;
}

/** State of a path answer. */
export type PathStatus = 'found' | 'partial' | 'none';

/** A path answer: tiles from start to goal (start excluded) as packed (tx, ty) pairs. */
export interface PathResult {
  status: PathStatus;
  /** Tile coordinates, x0, y0, x1, y1, … (length = 2 × steps). */
  tiles: Int32Array;
  steps: number;
  /** Nodes expanded (budget statistics). */
  expanded: number;
}

/** A pending request. */
export interface PathTicket {
  readonly id: number;
  readonly owner: Entity;
  readonly readyTick: number;
}
