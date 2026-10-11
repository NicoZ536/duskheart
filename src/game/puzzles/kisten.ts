/**
 * Crates on pressure plates (MASTERPROMPT §21 "Kistenschieben auf Druckplatten"; docs/SPIEL.md §19 "Rätseltypen M7"; M7-12):
 * the pure rules of a `kisten` variant – an ASCII map (`#` wall, `.` floor, `o` plate, `$` crate, `*` crate on a plate, `@`
 * the entry, `R` the reset rune). E at a crate pushes it one tile away from the player (`vault.push`): into floor or a plate,
 * never into a wall or another crate. Solved when a crate stands on every plate. The solver is a breadth-first search over the
 * crate positions with the player's reachable region (the shortest push sequence; small maps, 2–3 crates).
 */
import type { PuzzleVariantDef } from '../../content/dungeons/schema';
import { kistenMap, kistenStep, PUSH_DIRECTIONS, type KistenMap } from '../../world/gen/vaults/puzzleLayout';
import type { PuzzleRules } from './types';

export { kistenMap, kistenStep, PUSH_DIRECTIONS, PUSH_DX, PUSH_DY, type KistenMap } from '../../world/gen/vaults/puzzleLayout';

export type KistenVariant = Extract<PuzzleVariantDef, { typ: 'kisten' }>;
const OPPOSITE = PUSH_DIRECTIONS / 2;
/** Crate cells (index `y × w + x` of the map), ascending. */
export interface KistenState {
  readonly crates: readonly number[];
}
/** Push the crate on cell `from` one cell towards `dir` (0 north, 1 east, 2 south, 3 west). */
export interface KistenAction {
  readonly from: number;
  readonly dir: number;
}

function sorted(cells: readonly number[]): number[] {
  return [...cells].sort((a, b) => a - b);
}

/** Whether `crates` may push the crate on `from` towards `dir` (target inside, no wall, no crate). */
export function kistenCanPush(m: KistenMap, crates: readonly number[], from: number, dir: number): boolean {
  if (!crates.includes(from)) return false;
  const to = kistenStep(m, from, dir);
  return to >= 0 && m.wall[to] === 0 && !crates.includes(to);
}

/** Cells the player reaches from `start` without passing walls or crates (flood fill). */
function reachable(m: KistenMap, crates: readonly number[], start: number): Uint8Array {
  const seen = new Uint8Array(m.w * m.h);
  if (start < 0 || m.wall[start] === 1 || crates.includes(start)) return seen;
  const queue = [start];
  seen[start] = 1;
  while (queue.length > 0) {
    const i = queue.pop() as number;
    for (let d = 0; d < PUSH_DIRECTIONS; d++) {
      const j = kistenStep(m, i, d);
      if (j < 0 || seen[j] === 1 || m.wall[j] === 1 || crates.includes(j)) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return seen;
}

function solvedCrates(m: KistenMap, crates: readonly number[]): boolean {
  for (const p of m.plates) if (!crates.includes(p)) return false;
  return true;
}

/** Breadth-first search over (crates, player region); the region is named by its smallest cell. */
function search(m: KistenMap): KistenAction[] | null {
  interface Node {
    readonly crates: readonly number[];
    readonly player: number;
    readonly parent: Node | null;
    readonly push: KistenAction | null;
  }
  const keyOf = (crates: readonly number[], region: Uint8Array): string => {
    let first = 0;
    while (first < region.length && region[first] === 0) first++;
    return `${crates.join(',')}|${first}`;
  };
  const start: Node = { crates: sorted(m.crates), player: m.entry, parent: null, push: null };
  const seen = new Set<string>([keyOf(start.crates, reachable(m, start.crates, start.player))]);
  const queue: Node[] = [start];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head] as Node;
    if (solvedCrates(m, node.crates)) {
      const out: KistenAction[] = [];
      for (let n: Node | null = node; n !== null && n.push !== null; n = n.parent) out.push(n.push);
      return out.reverse();
    }
    const region = reachable(m, node.crates, node.player);
    for (const c of node.crates) {
      for (let d = 0; d < PUSH_DIRECTIONS; d++) {
        const behind = kistenStep(m, c, (d + OPPOSITE) % PUSH_DIRECTIONS);
        if (behind < 0 || region[behind] === 0 || !kistenCanPush(m, node.crates, c, d)) continue;
        const to = kistenStep(m, c, d);
        const crates = sorted(node.crates.map((x) => (x === c ? to : x)));
        const key = keyOf(crates, reachable(m, crates, c));
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({ crates, player: c, parent: node, push: { from: c, dir: d } });
      }
    }
  }
  return null;
}

export const KISTEN_RULES: PuzzleRules<KistenVariant, KistenState, KistenAction> = {
  type: 'kisten',
  init: (v) => ({ crates: sorted(kistenMap(v).crates) }),
  act(v, state, action) {
    const m = kistenMap(v);
    if (!kistenCanPush(m, state.crates, action.from, action.dir)) return state;
    const to = kistenStep(m, action.from, action.dir);
    return { crates: sorted(state.crates.map((c) => (c === action.from ? to : c))) };
  },
  solved: (v, state) => solvedCrates(kistenMap(v), state.crates),
  solve: (v) => search(kistenMap(v)),
  encode: (state) => [...state.crates],
  decode(v, data) {
    const m = kistenMap(v);
    if (data.length !== m.crates.length) return KISTEN_RULES.init(v);
    const cells = sorted(data);
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k] as number;
      if (!Number.isInteger(c) || c < 0 || c >= m.w * m.h || m.wall[c] === 1 || (k > 0 && cells[k - 1] === c)) return KISTEN_RULES.init(v);
    }
    return { crates: cells };
  },
};
