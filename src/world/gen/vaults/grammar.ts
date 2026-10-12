/**
 * The graph grammar of a Builder vault (MASTERPROMPT §21 "Generiert per Graph-Grammatik (Start → Räume, Schlüssel und
 * Schlösser, Rätsel → Endkammer mit Mini-Boss)"; docs/SPIEL.md §19 "Generator" 1.; M7-10): a pure function of the world seed,
 * the slot and the parameters – no world, no content (the step `gewoelbe` hands in the content's ids).
 *
 * Rules:
 * - **Main path** start → gate rooms → end chamber. Each gate room's exit is a gate: a puzzle door (`raetsel`, the room holds
 *   the puzzle) or a lock (`schloss`). `puzzles` puzzle gates and `locks` lock gates in a seeded order; the start's exit is
 *   open. So the end chamber lies behind every gate – at least one lock and one puzzle (§19 "genau eine Endkammer hinter
 *   mindestens einem Schloss und einem Rätsel").
 * - **Keys:** each lock's key lies in a key room (`schluessel`) hanging off the main path at or before the lock's gate room –
 *   reachable from the start without its own lock (and behind earlier gates only).
 * - **Side rooms** (`kammer`, `falle`, `schatz`, `gang`) fill up to 5–9 rooms, open edges off any room but the end chamber,
 *   at most three children per room (a cell has four sides); at least `sideRoomsMin` of them (M7-97: a vault of gates and keys
 *   alone had no chamber for a construct, no trap room for a trap spirit) – a second lock and extra puzzles give way first,
 *   the puzzle types a vault must show (`minPuzzleTypes`) never.
 * - **Hidden walls:** sometimes a secret treasure room behind a cracked wall (edge `verborgen`) – a leaf with nothing the way
 *   needs (never on the only path to a key, a puzzle or the end).
 * - **Variety:** `minPuzzleTypes` ≥ 4 (the Grünhain vault nearest the start beach, §32) gives that many puzzles of different
 *   types; otherwise 1–3 puzzles of types drawn freely.
 * - **Occupancy** of the graph: chest tier by depth (the end chest tier 3), traps in trap rooms and sometimes in chambers and
 *   corridors, guards (constructs in chambers and sometimes before a locked door, a trap spirit in trap rooms and sometimes
 *   where a corridor, chamber or lock room holds a trap, the mini-boss in the end chamber, mimics among the chests – M7-97 mixes
 *   constructs and trap spirits into the gates' rooms, so each kind meets the player in a share of the vaults,
 *   `BALANCE.vaults.guardShareMin`), the tablets and the ember shard of this vault.
 */
import { hashCombine, hashString, normalizeSeed, Rng } from '../../../engine/rng';
import type { VaultRole } from '../../../content/dungeons/schema';
import type { ChestTier, VaultEdge, VaultEdgeKind, VaultGraph, VaultGrammarParams, VaultNode } from './types';

/** Occupancy parameters of the grammar (the content's ids and the balance; the step `gewoelbe` fills them). */
export interface VaultOccupancy {
  /** Variant ids per puzzle type; absent = `<typ>_1`. */
  readonly puzzleVariants?: Readonly<Record<string, readonly string[]>>;
  readonly locksMin: number;
  readonly locksMax: number;
  readonly secondLockChance: number;
  readonly puzzlesMin: number;
  readonly puzzlesMax: number;
  readonly sideRoles: Readonly<Record<'kammer' | 'falle' | 'schatz' | 'gang', number>>;
  /** Fewest side rooms off the main path [rooms]; a second lock, then extra puzzles give way – the side rooms before `minPuzzleTypes`. */
  readonly sideRoomsMin: number;
  readonly tier2Depth: number;
  readonly tier3Depth: number;
  readonly chamberChestChance: number;
  readonly mimicChance: number;
  readonly trapRoomTrapsMin: number;
  readonly trapRoomTrapsMax: number;
  readonly sideTrapChance: number;
  /** Fewest traps of a vault (topped up in trap rooms, corridors, chambers and lock rooms). */
  readonly trapsMin: number;
  readonly chamberGuardsMin: number;
  readonly chamberGuardsMax: number;
  readonly trapSpiritChance: number;
  /** Chance that a construct guards a lock room (before its locked door) [0–1]. */
  readonly lockGuardChance: number;
  /** Chance that a trap spirit haunts a corridor, chamber or lock room holding a trap [0–1]. */
  readonly sideTrapSpiritChance: number;
  /** Creature ids: chamber guard, trap spirit, the end chamber's mini-boss, the mimic (null: none). */
  readonly guards: { readonly chamber: string | null; readonly trapRoom: string | null; readonly boss: string | null; readonly mimic: string | null };
  /**
   * Kinds of guard this vault must show (M7-97, the world's variety rule of src/world/gen/vaults/plan.ts; usually none): where
   * the draws left one out, a construct stands before the first locked door, a trap spirit by the most trapped room's traps and
   * a mimic in the deepest side chest (a side room without one gets a chest). No draw is added: without it the graph is the same.
   */
  readonly mustHold: readonly VaultGuardKind[];
  /** Tablet ids this vault holds, each with the room role it prefers (absent: any room but the start). */
  readonly tablets: readonly { readonly id: string; readonly role?: VaultRole }[];
  /** Whether this vault holds one of the world's ember shards. */
  readonly shard: boolean;
}

/** The kinds of guard besides the mini-boss (keys of `VaultOccupancy.guards`): construct, trap spirit, mimic. */
export const VAULT_GUARD_KINDS = ['chamber', 'trapRoom', 'mimic'] as const;
/** One of them. */
export type VaultGuardKind = (typeof VAULT_GUARD_KINDS)[number];

/** The parameters a full graph needs: the grammar's and the occupancy's. */
export type VaultGraphParams = VaultGrammarParams & VaultOccupancy;

/** Salt of a vault's graph stream (another `attempt` gives another graph: the embedding may ask again). */
const GRAPH_SALT = hashString('gewoelbe.graph');
/** Most children of one room: a cell has four sides, one leads back. */
const MAX_CHILDREN = 3;
/** Rooms that may hold a trap (the start, the gate rooms of puzzles, key and treasure rooms and the end chamber do not). */
const TRAP_ROLES: ReadonlySet<VaultRole> = new Set<VaultRole>(['falle', 'gang', 'kammer', 'schloss']);
/** The mimic's chest stands as a chest: a mimic is a guard of its room. */
const SIDE_ROLES = ['kammer', 'falle', 'schatz', 'gang'] as const;

interface DraftNode {
  id: number;
  role: VaultRole;
  parent: number;
  keyFor: number;
  puzzle: { type: string; variant: string } | null;
  traps: string[];
  chestTier: ChestTier;
  guards: string[];
  tablet: string | null;
  shard: boolean;
  children: number;
  hidden: boolean;
}

/** The seeded stream of a vault's graph. */
export function vaultGraphRng(seed: number, slot: number, attempt = 0): Rng {
  return new Rng(hashCombine(hashCombine(hashCombine(normalizeSeed(seed), GRAPH_SALT), slot), attempt));
}

function weightedRole(rng: Rng, w: VaultOccupancy['sideRoles']): (typeof SIDE_ROLES)[number] {
  const weights = SIDE_ROLES.map((r) => w[r]);
  return SIDE_ROLES[rng.weightedIndex(weights)] ?? 'kammer';
}

/** Chest tiers (§21 "Truhen nach Stufe"). */
const TIER_LOW: Exclude<ChestTier, 0> = 1;
const TIER_MID: Exclude<ChestTier, 0> = 2;
const TIER_HIGH: Exclude<ChestTier, 0> = 3;

function tierOf(depth: number, p: VaultOccupancy): Exclude<ChestTier, 0> {
  return depth >= p.tier3Depth ? TIER_HIGH : depth >= p.tier2Depth ? TIER_MID : TIER_LOW;
}

/**
 * The graph of the vault in `slot` (attempt 0 first; the embedding asks the next attempt when a graph does not fit the grid).
 * Node 0 is the start; `end` the end chamber.
 */
export function vaultGraph(seed: number, slot: number, p: VaultGraphParams, attempt = 0): VaultGraph {
  const rng = vaultGraphRng(seed, slot, attempt);
  const types = [...p.puzzleTypes];
  // Puzzles: the nearest Grünhain vault shows the breadth (`minPuzzleTypes` > 1), the others draw 1–3.
  const wantTypes = p.minPuzzleTypes > 1 ? p.minPuzzleTypes : 0;
  let puzzles = wantTypes > 0 ? wantTypes : rng.int(p.puzzlesMin, p.puzzlesMax + 1);
  let locks = p.locksMin + (p.locksMax > p.locksMin && rng.bool(p.secondLockChance) ? 1 : 0);
  // Start, gate rooms, end, a key room per lock and the fewest side rooms must fit into `maxRooms`: a second lock gives way
  // first, then puzzles – never below the puzzle types asked for (`minPuzzleTypes`); the side rooms give way last.
  while (2 + puzzles + 2 * locks + p.sideRoomsMin > p.maxRooms && locks > 1) locks--;
  while (2 + puzzles + 2 * locks + p.sideRoomsMin > p.maxRooms && puzzles > Math.max(1, wantTypes)) puzzles--;
  const required = 2 + puzzles + 2 * locks;
  const sideMin = Math.max(0, Math.min(p.sideRoomsMin, p.maxRooms - required));
  const rooms = Math.max(required + sideMin, Math.min(p.maxRooms, p.minRooms + rng.int(0, p.maxRooms - p.minRooms + 1)));

  // Puzzle types: different ones while there are, then again from the start of the shuffled list.
  rng.shuffle(types);
  const puzzleOf = (k: number): { type: string; variant: string } => {
    const type = types[k % Math.max(1, types.length)] ?? 'hebel';
    const variants = p.puzzleVariants?.[type] ?? [`${type}_1`];
    return { type, variant: variants[rng.int(0, variants.length)] ?? `${type}_1` };
  };
  // Gate order along the main path.
  const gates: ('raetsel' | 'schloss')[] = [...Array<'raetsel'>(puzzles).fill('raetsel'), ...Array<'schloss'>(locks).fill('schloss')];
  rng.shuffle(gates);

  const nodes: DraftNode[] = [];
  const edges: { a: number; b: number; kind: VaultEdgeKind }[] = [];
  const add = (role: VaultRole, parent: number, kind: VaultEdgeKind): DraftNode => {
    const n: DraftNode = { id: nodes.length, role, parent, keyFor: -1, puzzle: null, traps: [], chestTier: 0, guards: [], tablet: null, shard: false, children: 0, hidden: kind === 'verborgen' };
    nodes.push(n);
    if (parent >= 0) {
      edges.push({ a: parent, b: n.id, kind });
      (nodes[parent] as DraftNode).children++;
    }
    return n;
  };
  add('start', -1, 'offen');
  const main: number[] = [0];
  let puzzleIndex = 0;
  let prevKind: VaultEdgeKind = 'offen';
  for (const g of gates) {
    const room = add(g, main[main.length - 1] as number, prevKind);
    if (g === 'raetsel') room.puzzle = puzzleOf(puzzleIndex++);
    main.push(room.id);
    prevKind = g;
  }
  const end = add('endkammer', main[main.length - 1] as number, prevKind);
  main.push(end.id);

  // Doors: one id per gate edge in edge order (the lock's key names it).
  let doorId = 0;
  const doorOf = edges.map((e) => (e.kind === 'offen' ? -1 : doorId++));
  // Keys: before their lock (a main room at or before the gate room, with room for one more child).
  edges.forEach((e, k) => {
    if (e.kind !== 'schloss') return;
    const gateIndex = main.indexOf(e.a);
    const hosts = main.slice(0, gateIndex + 1).filter((id) => (nodes[id] as DraftNode).children < MAX_CHILDREN);
    const host = hosts.length === 0 ? e.a : rng.pick(hosts);
    add('schluessel', host, 'offen').keyFor = doorOf[k] as number;
  });
  // Side rooms off any room but the end chamber.
  while (nodes.length < rooms) {
    const hosts = nodes.filter((n) => n.id !== end.id && n.children < MAX_CHILDREN && !n.hidden).map((n) => n.id);
    if (hosts.length === 0) break;
    add(weightedRole(rng, p.sideRoles), rng.pick(hosts), 'offen');
  }
  // A secret treasure room behind a cracked wall (a leaf: nothing the way needs lies there).
  if (nodes.length < p.maxRooms && rng.bool(p.hiddenWallChance)) {
    const hosts = nodes.filter((n) => n.id !== end.id && n.children < MAX_CHILDREN && !n.hidden).map((n) => n.id);
    if (hosts.length > 0) add('schatz', rng.pick(hosts), 'verborgen');
  }
  // Door ids again: the hidden edge gets one too.
  doorId = 0;
  const doors = edges.map((e) => (e.kind === 'offen' ? -1 : doorId++));

  // Depth from the start (tree: parent's depth + 1).
  const depth = nodes.map(() => 0);
  for (const n of nodes) if (n.parent >= 0) depth[n.id] = (depth[n.parent] as number) + 1;

  // Occupancy: chests, traps, guards.
  for (const n of nodes) {
    const d = depth[n.id] as number;
    switch (n.role) {
      case 'endkammer':
        n.chestTier = TIER_HIGH;
        if (p.guards.boss !== null) n.guards.push(p.guards.boss);
        break;
      case 'schatz':
        n.chestTier = tierOf(d, p);
        if (p.guards.mimic !== null && rng.bool(p.mimicChance)) n.guards.push(p.guards.mimic);
        break;
      case 'kammer':
        if (rng.bool(p.chamberChestChance)) {
          n.chestTier = tierOf(d, p);
          if (p.guards.mimic !== null && rng.bool(p.mimicChance)) n.guards.push(p.guards.mimic);
        }
        if (p.guards.chamber !== null) for (let k = rng.int(p.chamberGuardsMin, p.chamberGuardsMax + 1); k > 0; k--) n.guards.push(p.guards.chamber);
        if (p.trapTypes.length > 0 && rng.bool(p.sideTrapChance)) n.traps.push(rng.pick(p.trapTypes));
        break;
      case 'falle':
        if (p.trapTypes.length > 0) for (let k = rng.int(p.trapRoomTrapsMin, p.trapRoomTrapsMax + 1); k > 0; k--) n.traps.push(rng.pick(p.trapTypes));
        if (p.guards.trapRoom !== null && rng.bool(p.trapSpiritChance)) n.guards.push(p.guards.trapRoom);
        break;
      case 'schloss':
        if (p.guards.chamber !== null && rng.bool(p.lockGuardChance)) n.guards.push(p.guards.chamber);
        if (p.trapTypes.length > 0 && rng.bool(p.sideTrapChance)) n.traps.push(rng.pick(p.trapTypes));
        break;
      case 'gang':
        if (p.trapTypes.length > 0 && rng.bool(p.sideTrapChance)) n.traps.push(rng.pick(p.trapTypes));
        break;
      default:
        break;
    }
  }
  // Every vault has at least `trapsMin` traps: the room (that may hold one) with the fewest gets the next, in a shuffled order –
  // a corridor's or chamber's template has one trap slot, a trap room's several.
  const trapHosts = nodes.filter((n) => TRAP_ROLES.has(n.role));
  rng.shuffle(trapHosts);
  let trapCount = nodes.reduce((sum, n) => sum + n.traps.length, 0);
  for (; p.trapTypes.length > 0 && trapHosts.length > 0 && trapCount < p.trapsMin; trapCount++) {
    const host = trapHosts.reduce((a, b) => (b.traps.length < a.traps.length ? b : a));
    host.traps.push(rng.pick(p.trapTypes));
  }
  // Trap spirits beyond the trap rooms: where a corridor, chamber or lock room holds a trap (in node order).
  if (p.guards.trapRoom !== null) for (const n of nodes) if (n.role !== 'falle' && n.traps.length > 0 && rng.bool(p.sideTrapSpiritChance)) n.guards.push(p.guards.trapRoom);
  // The kinds of guard this vault must show (the world's variety rule; no draw).
  for (const kind of p.mustHold) holdGuard(nodes, depth, kind, p);
  // Tablets: in a room of the preferred role, else any room but the start; one tablet per room while there are rooms.
  for (const t of p.tablets) {
    const free = nodes.filter((n) => n.tablet === null && n.id !== 0);
    const pick = free.filter((n) => t.role === undefined || n.role === t.role);
    const host = (pick.length > 0 ? pick : free).sort((a, b) => a.id - b.id);
    if (host.length > 0) rng.pick(host).tablet = t.id;
  }
  // The ember shard: in the deepest treasure room, else the end chamber.
  if (p.shard) {
    const treasure = nodes.filter((n) => n.role === 'schatz').sort((a, b) => (depth[b.id] as number) - (depth[a.id] as number) || a.id - b.id)[0];
    (treasure ?? end).shard = true;
  }

  const outNodes: VaultNode[] = nodes.map((n) => ({
    id: n.id,
    role: n.role,
    depth: depth[n.id] as number,
    keyFor: n.keyFor,
    puzzle: n.puzzle,
    traps: n.traps,
    chestTier: n.chestTier,
    guards: n.guards,
    tablet: n.tablet,
    shard: n.shard,
  }));
  const outEdges: VaultEdge[] = edges.map((e, k) => ({ a: e.a, b: e.b, kind: e.kind, door: doors[k] as number }));
  return { nodes: outNodes, edges: outEdges, start: 0, end: end.id };
}

/** Order of the side rooms that may take a mimic: one with a chest, then a chamber or treasure room (its slot holds a chest), then any. */
function mimicRank(n: DraftNode): number {
  if (n.chestTier > 0) return 0;
  return n.role === 'kammer' || n.role === 'schatz' ? 1 : 2;
}

/**
 * Puts a guard of `kind` into the graph unless one is there (see `VaultOccupancy.mustHold`): a construct into the first lock
 * room (every vault has one; else a chamber), a trap spirit into the room with the most traps (every vault has `trapsMin`), a
 * mimic into the side room of `mimicRank` 0, 1, 2, the deepest first (the side rooms are `sideRoomsMin` at least); a room
 * without a chest gets one of its depth's tier.
 */
function holdGuard(nodes: DraftNode[], depth: readonly number[], kind: VaultGuardKind, p: VaultOccupancy): void {
  const id = p.guards[kind];
  if (id === null || nodes.some((n) => n.guards.includes(id))) return;
  let host: DraftNode | undefined;
  if (kind === 'chamber') host = nodes.find((n) => n.role === 'schloss') ?? nodes.find((n) => n.role === 'kammer');
  else if (kind === 'trapRoom') host = nodes.filter((n) => n.traps.length > 0).sort((a, b) => b.traps.length - a.traps.length || a.id - b.id)[0];
  else {
    host = nodes
      .filter((n) => (SIDE_ROLES as readonly VaultRole[]).includes(n.role))
      .sort((a, b) => mimicRank(a) - mimicRank(b) || (depth[b.id] as number) - (depth[a.id] as number) || a.id - b.id)[0];
    if (host !== undefined && host.chestTier === 0) host.chestTier = tierOf(depth[host.id] as number, p);
  }
  host?.guards.push(id);
}

/** Progress of a walk through a graph: which rooms, keys and doors are reachable (the solvability check of the tests and generator). */
export interface VaultWalk {
  readonly reached: readonly boolean[];
  /** Locks opened in the order the walk found their keys. */
  readonly opened: readonly number[];
}

/**
 * Walks a graph like a player: open edges always, puzzle doors once their puzzle room is reached, a lock once its key's room
 * is reached (its key in hand), hidden walls only with `hidden`. Repeats until nothing new opens.
 */
export function walkVault(g: VaultGraph, hidden: boolean): VaultWalk {
  const reached = g.nodes.map((n) => n.id === g.start);
  const keys = new Set<number>();
  const opened: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of g.nodes) if (reached[n.id] === true && n.keyFor >= 0 && !keys.has(n.keyFor)) keys.add(n.keyFor);
    for (const e of g.edges) {
      const ra = reached[e.a] === true;
      const rb = reached[e.b] === true;
      if (ra === rb) continue;
      let passable = e.kind === 'offen' || (e.kind === 'verborgen' && hidden);
      // A puzzle door opens once the room holding its puzzle is reached (the puzzle is solvable there, src/game/puzzles/).
      if (e.kind === 'raetsel') passable = reached[g.nodes[e.a]?.puzzle !== null ? e.a : e.b] === true;
      if (e.kind === 'schloss' && keys.has(e.door)) {
        passable = true;
        if (!opened.includes(e.door)) opened.push(e.door);
      }
      if (!passable) continue;
      reached[ra ? e.b : e.a] = true;
      changed = true;
    }
  }
  return { reached, opened };
}
