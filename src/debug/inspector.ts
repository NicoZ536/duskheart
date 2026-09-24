/**
 * Entity inspector (MASTERPROMPT §31.6 "Entitäts-Inspektor"; M3-35): a click on the game view in debug
 * mode picks the entity under the pointer and lists its components as the ECS holds them – every
 * registered store the entity is in, with each field and its value. Read only: the inspector never
 * writes the simulation.
 *
 * - **Picking** (`pickEntity`): entities with a place (their `position`, or the `x`/`y` of a component such
 *   as a drop's) whose figure box contains the world point – a figure stands on its anchor (the feet), so
 *   the box reaches `PICK_BOX.up` px above it and a little to the sides and below; the nearest to the
 *   box's centre wins. Entities on another layer than the view
 *   (a `layer` field in one of their components, e.g. the player's or a drop's) are skipped.
 * - **Description** (`describeEntity`): per component a list of fields: the columns of a column store,
 *   the fields of a sparse set's value (nested values as short JSON); numbers rounded for reading.
 */
import { ColumnStore, entityGeneration, entityIndex, SparseSet, type Ecs, type Entity } from '../engine/ecs';

/** Figure box around an anchor [px]: sideways, above the feet, below them. */
export const PICK_BOX = { side: 10, up: 26, down: 6 } as const;
/** Decimals of numbers in the inspector. */
const DECIMALS = 2;
/** Longest value text before it is cut [characters]. */
export const MAX_VALUE_CHARS = 72;

/** One component of an entity: its name and fields. */
export interface InspectedComponent {
  readonly name: string;
  readonly fields: ReadonlyArray<readonly [string, string]>;
}

/** What the inspector shows of an entity. */
export interface InspectedEntity {
  readonly entity: Entity;
  readonly index: number;
  readonly generation: number;
  readonly components: readonly InspectedComponent[];
}

/** A value as the inspector prints it. */
export function formatValue(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(DECIMALS)));
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean' || v === null || v === undefined) return String(v);
  const text = JSON.stringify(v, (_k, x: unknown) => (typeof x === 'number' && !Number.isInteger(x) ? Number(x.toFixed(DECIMALS)) : x));
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS - 1)}…` : text;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The layer an entity lives on, from the first of its components with a numeric `layer` field (else 0). */
export function entityLayer(ecs: Ecs, e: Entity): number {
  for (const name of ecs.componentNames()) {
    const store = ecs.component(name);
    if (!(store instanceof SparseSet) || !store.has(e)) continue;
    const value: unknown = store.get(e);
    if (isRecord(value) && typeof value['layer'] === 'number') return value['layer'];
  }
  return 0;
}

/**
 * Where entity `e` stands [world px]: its `position`, else the `x`/`y` fields of one of its components (a
 * drop keeps its position in its own state); null for an entity without a place.
 */
export function entityPoint(ecs: Ecs, e: Entity, out: { x: number; y: number }): { x: number; y: number } | null {
  const pos = ecs.component('position');
  if (pos instanceof ColumnStore && pos.has(e)) {
    out.x = pos.get(e, 'x');
    out.y = pos.get(e, 'y');
    return out;
  }
  for (const name of ecs.componentNames()) {
    const store = ecs.component(name);
    if (!(store instanceof SparseSet) || !store.has(e)) continue;
    const value: unknown = store.get(e);
    if (isRecord(value) && typeof value['x'] === 'number' && typeof value['y'] === 'number') {
      out.x = value['x'];
      out.y = value['y'];
      return out;
    }
  }
  return null;
}

/** The entity whose figure box contains world point (x, y) on `layer`, nearest first; null if none. */
export function pickEntity(ecs: Ecs, x: number, y: number, layer: number): Entity | null {
  const seen = new Set<Entity>();
  for (const name of ecs.componentNames()) {
    const store = ecs.component(name);
    if (store instanceof ColumnStore || store instanceof SparseSet) for (let i = 0; i < store.size; i++) seen.add(store.entityAt(i));
  }
  let best: Entity | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  const at = { x: 0, y: 0 };
  for (const e of seen) {
    if (!ecs.alive(e) || entityPoint(ecs, e, at) === null) continue;
    if (Math.abs(x - at.x) > PICK_BOX.side || y < at.y - PICK_BOX.up || y > at.y + PICK_BOX.down) continue;
    if (entityLayer(ecs, e) !== layer) continue;
    const d = Math.hypot(x - at.x, y - (at.y - PICK_BOX.up / 2));
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** The components of `e` (null when it is not alive). */
export function describeEntity(ecs: Ecs, e: Entity): InspectedEntity | null {
  if (!ecs.alive(e)) return null;
  const components: InspectedComponent[] = [];
  for (const name of ecs.componentNames()) {
    const store = ecs.component(name);
    if (store === undefined) continue;
    if (store instanceof ColumnStore) {
      if (!store.has(e)) continue;
      components.push({ name, fields: store.columnNames.map((c) => [c, formatValue(store.get(e, c))] as const) });
    } else if (store instanceof SparseSet) {
      if (!store.has(e)) continue;
      const value: unknown = store.get(e);
      components.push({ name, fields: isRecord(value) ? Object.entries(value).map(([k, v]) => [k, formatValue(v)] as const) : [[name, formatValue(value)] as const] });
    }
  }
  return { entity: e, index: entityIndex(e), generation: entityGeneration(e), components };
}
