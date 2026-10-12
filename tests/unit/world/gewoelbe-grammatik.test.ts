/**
 * M7-10 acceptance "Gewölbe-Generator: Graph-Grammatik … `tests/unit/world/gewoelbe-grammatik.test.ts` (100 Seeds lösbar,
 * Schlüssel vor Schloss erreichbar)" and "Vielfalt ≥ 4 Rätseltypen" (docs/SPIEL.md §19 "Generator" 1. and 4.): the pure graph
 * level, no world generation. For 100 seeds and both parameter sets (ordinary vault, the Grünhain vault nearest the start):
 * 5–9 rooms, a tree from the start, exactly one end chamber behind at least one lock and one puzzle, every key reachable
 * without its own lock, the walk reaches the end without hidden walls and every room with them, hidden walls never lead to
 * anything the way needs, every vault holds at least `trapsMin` traps, the nearest vault shows ≥ 4 puzzle types; the same seed
 * gives the same graph. M7-97: at least `sideRoomsMin` side rooms; constructs only in chambers and lock rooms, trap spirits only
 * where traps are, mimics on side chests; over the 100 seeds constructs and trap spirits guard at least their share of the vaults
 * (`BALANCE.vaults.guardShareMin`); `mustHold` adds the kinds asked for without changing anything else of the graph.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { vaultGraph, walkVault, type VaultGraphParams } from '../../../src/world/gen/vaults/grammar';
import type { VaultGraph } from '../../../src/world/gen/vaults/types';

const V = BALANCE.vaults;
const TYPES = ['kisten', 'hebel', 'feuerschalen', 'verborgene_wand', 'glocken'];
const BASE: VaultGraphParams = {
  minRooms: V.minRooms,
  maxRooms: V.maxRooms,
  minPuzzleTypes: 1,
  puzzleTypes: TYPES,
  trapTypes: ['speerfalle', 'pfeilwerfer', 'rollstein', 'fallgrube', 'einsturzboden', 'pendelklinge'],
  hiddenWallChance: V.hiddenWallChance,
  puzzleVariants: Object.fromEntries(TYPES.map((t) => [t, [`${t}_1`, `${t}_2`, `${t}_3`]])),
  locksMin: V.locksMin,
  locksMax: V.locksMax,
  secondLockChance: V.secondLockChance,
  puzzlesMin: V.puzzlesMin,
  puzzlesMax: V.puzzlesMax,
  sideRoles: V.sideRoles,
  sideRoomsMin: V.sideRoomsMin,
  tier2Depth: V.tier2Depth,
  tier3Depth: V.tier3Depth,
  chamberChestChance: V.chamberChestChance,
  mimicChance: V.mimicChance,
  trapRoomTrapsMin: V.trapRoomTrapsMin,
  trapRoomTrapsMax: V.trapRoomTrapsMax,
  sideTrapChance: V.sideTrapChance,
  trapsMin: V.trapsMin,
  chamberGuardsMin: V.chamberGuardsMin,
  chamberGuardsMax: V.chamberGuardsMax,
  trapSpiritChance: V.trapSpiritChance,
  lockGuardChance: V.lockGuardChance,
  sideTrapSpiritChance: V.sideTrapSpiritChance,
  guards: { chamber: 'erbauer_konstrukt_1', trapRoom: 'fallengeist', boss: 'wurzelhueter', mimic: 'mimik_truhe' },
  mustHold: [],
  tablets: [{ id: 'tafel_01' }, { id: 'tafel_02', role: 'schatz' }],
  shard: true,
};
const NEAREST: VaultGraphParams = { ...BASE, minPuzzleTypes: V.nearestPuzzleTypes };
const SEEDS = Array.from({ length: 100 }, (_, i) => 0x51ed + i * 7919);

/** Whether the end is reached when every edge of `kind` is closed. */
function endWithout(g: VaultGraph, kind: string): boolean {
  const adj = new Map<number, number[]>();
  for (const e of g.edges) {
    if (e.kind === kind) continue;
    adj.set(e.a, [...(adj.get(e.a) ?? []), e.b]);
    adj.set(e.b, [...(adj.get(e.b) ?? []), e.a]);
  }
  const seen = new Set([g.start]);
  const stack = [g.start];
  while (stack.length > 0) {
    for (const n of adj.get(stack.pop() as number) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  return seen.has(g.end);
}

function checkGraph(g: VaultGraph, p: VaultGraphParams): void {
  expect(g.nodes.length).toBeGreaterThanOrEqual(p.minRooms);
  expect(g.nodes.length).toBeLessThanOrEqual(p.maxRooms);
  // A tree: one edge less than rooms, every room but the start has its parent edge.
  expect(g.edges.length).toBe(g.nodes.length - 1);
  expect(g.nodes.filter((n) => n.role === 'endkammer')).toHaveLength(1);
  expect(g.nodes[g.end]?.role).toBe('endkammer');
  expect(g.nodes[g.start]?.role).toBe('start');
  // The end lies behind at least one lock and one puzzle.
  expect(endWithout(g, 'schloss')).toBe(false);
  expect(endWithout(g, 'raetsel')).toBe(false);
  // Every key before its lock: the walk without hidden walls opens every lock and reaches the end.
  const walk = walkVault(g, false);
  expect(walk.reached[g.end]).toBe(true);
  const locks = g.edges.filter((e) => e.kind === 'schloss').map((e) => e.door);
  expect([...walk.opened].sort()).toEqual([...locks].sort());
  for (const lock of locks) {
    const keyRoom = g.nodes.find((n) => n.keyFor === lock);
    expect(keyRoom).toBeDefined();
    // The key's room is reached without the lock it opens.
    const closed: VaultGraph = { ...g, edges: g.edges.filter((e) => !(e.kind === 'schloss' && e.door === lock)) };
    expect(walkVault(closed, false).reached[keyRoom!.id]).toBe(true);
  }
  // Every room with hidden walls; hidden rooms hold nothing the way needs (no key, no puzzle, not the end).
  const all = walkVault(g, true);
  expect(all.reached.every((r) => r)).toBe(true);
  for (const e of g.edges.filter((x) => x.kind === 'verborgen')) {
    const leaf = g.nodes[e.b]!;
    expect(leaf.keyFor).toBe(-1);
    expect(leaf.puzzle).toBeNull();
    expect(leaf.id).not.toBe(g.end);
    expect(g.edges.some((x) => x.a === leaf.id)).toBe(false);
  }
  // Puzzles sit in the rooms whose exit is their door; every gate edge has a door id, open edges none.
  for (const e of g.edges) {
    if (e.kind === 'raetsel') expect(g.nodes[e.a]?.puzzle).not.toBeNull();
    expect(e.door >= 0).toBe(e.kind !== 'offen');
  }
  expect(g.nodes[g.end]?.guards).toContain('wurzelhueter');
  expect(g.nodes[g.end]?.chestTier).toBe(3);
  expect(g.nodes.filter((n) => n.shard)).toHaveLength(1);
  // Every vault tests the eye: at least `trapsMin` traps, only in rooms that may hold one.
  expect(g.nodes.reduce((sum, n) => sum + n.traps.length, 0)).toBeGreaterThanOrEqual(p.trapsMin);
  for (const n of g.nodes) if (n.traps.length > 0) expect(['falle', 'gang', 'kammer', 'schloss']).toContain(n.role);
  expect(g.nodes.filter((n) => n.tablet !== null).map((n) => n.tablet).sort()).toEqual(['tafel_01', 'tafel_02']);
  // M7-97: constructs guard chambers and lock rooms, trap spirits haunt rooms with traps, mimics stand on side chests.
  for (const n of g.nodes) {
    if (n.guards.includes('erbauer_konstrukt_1')) expect(['kammer', 'schloss']).toContain(n.role);
    if (n.guards.includes('fallengeist')) expect(n.traps.length).toBeGreaterThan(0);
    if (n.guards.includes('mimik_truhe')) {
      expect(['kammer', 'falle', 'schatz', 'gang']).toContain(n.role);
      expect(n.chestTier).toBeGreaterThan(0);
    }
  }
  // At least `sideRoomsMin` rooms off the main path.
  expect(g.nodes.filter((n) => ['kammer', 'falle', 'schatz', 'gang'].includes(n.role)).length).toBeGreaterThanOrEqual(p.sideRoomsMin);
}

/** Share of the graphs of `seeds` whose rooms hold guard `id` [0–1]. */
function share(graphs: readonly VaultGraph[], id: string): number {
  return graphs.filter((g) => g.nodes.some((n) => n.guards.includes(id))).length / graphs.length;
}

describe('Gewölbe-Grammatik (M7-10)', () => {
  it('100 seeds: every ordinary vault is solvable, keys before their locks, the end behind a lock and a puzzle', () => {
    let hidden = 0;
    let twoLocks = 0;
    for (const seed of SEEDS) {
      const g = vaultGraph(seed, seed % 37, BASE);
      checkGraph(g, BASE);
      const puzzles = g.nodes.filter((n) => n.puzzle !== null).length;
      expect(puzzles).toBeGreaterThanOrEqual(BASE.puzzlesMin);
      expect(puzzles).toBeLessThanOrEqual(BASE.puzzlesMax);
      if (g.edges.some((e) => e.kind === 'verborgen')) hidden++;
      if (g.edges.filter((e) => e.kind === 'schloss').length === 2) twoLocks++;
    }
    // The grammar uses its options: some vaults hide a room, some have two locks.
    expect(hidden).toBeGreaterThan(10);
    expect(twoLocks).toBeGreaterThan(10);
  });

  it('100 seeds: the vault nearest the start shows at least four puzzle types and is solvable', () => {
    for (const seed of SEEDS) {
      const g = vaultGraph(seed, 3, NEAREST);
      checkGraph(g, NEAREST);
      const types = new Set(g.nodes.filter((n) => n.puzzle !== null).map((n) => n.puzzle!.type));
      expect(types.size).toBeGreaterThanOrEqual(V.nearestPuzzleTypes);
    }
  });

  it('100 seeds (M7-97): constructs and trap spirits each guard at least their share of the vaults, the mini-boss every one', () => {
    for (const p of [BASE, NEAREST]) {
      const graphs = SEEDS.map((seed) => vaultGraph(seed, seed % 37, p));
      const min = V.guardShareMin;
      expect(share(graphs, 'wurzelhueter')).toBeGreaterThanOrEqual(min.boss);
      expect(share(graphs, 'erbauer_konstrukt_1')).toBeGreaterThanOrEqual(min.chamber);
      expect(share(graphs, 'fallengeist')).toBeGreaterThanOrEqual(min.trapRoom);
      // The mimic stays the rare surprise of a side chest (one chest in five); the world's variety rule sees to its share.
      expect(share(graphs, 'mimik_truhe')).toBeGreaterThan(0);
    }
  });

  it('mustHold (M7-97): every graph shows the kinds asked for, without another draw – rooms, gates, traps and tablets stay', () => {
    const ALL: VaultGraphParams = { ...BASE, mustHold: ['chamber', 'trapRoom', 'mimic'] };
    for (const seed of SEEDS) {
      const free = vaultGraph(seed, seed % 37, BASE);
      const held = vaultGraph(seed, seed % 37, ALL);
      checkGraph(held, ALL);
      for (const id of ['erbauer_konstrukt_1', 'fallengeist', 'mimik_truhe', 'wurzelhueter']) expect(held.nodes.some((n) => n.guards.includes(id)), `${seed} ${id}`).toBe(true);
      expect(held.edges).toEqual(free.edges);
      expect(held.nodes.map(({ guards: _g, chestTier: _c, ...rest }) => rest)).toEqual(free.nodes.map(({ guards: _g, chestTier: _c, ...rest }) => rest));
      // Only added: every guard of the free graph stays where it was.
      free.nodes.forEach((n, i) => {
        for (const id of n.guards) expect(held.nodes[i]?.guards).toContain(id);
      });
    }
  });

  it('is a pure function of seed, slot and attempt', () => {
    expect(vaultGraph(7, 11, BASE)).toEqual(vaultGraph(7, 11, BASE));
    expect(vaultGraph(7, 11, BASE)).not.toEqual(vaultGraph(7, 12, BASE));
    expect(vaultGraph(7, 11, BASE, 1)).not.toEqual(vaultGraph(7, 11, BASE, 0));
  });
});
