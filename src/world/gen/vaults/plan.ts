/**
 * The generator's step `gewoelbe` (docs/SPIEL.md §19 "Generator", WORLD.md §2; M7-10, M7-11, M7-16): after `orte`, before
 * `untergrund` – one plan per vault slot whose biome has a tileset and whose surface layout stands (its mark `eingang`), a pure
 * function of seed, slots, layouts and content.
 *
 * - **Ember shards** (§21 "12 in der Welt"): the 12 slots are reserved over the vault slots of every biome – round by round, one
 *   slot per biome in the rule's biome order (`LOCATION_RULES.gewoelbe.biomes`, Grünhain first), each biome's slots in slot
 *   order, outside the start clearing; a reserved slot whose vault has a plan holds its shard (the vaults of later tilesets hold
 *   theirs when those come, M12-07 checks all 12).
 * - **Tablets** with the find spot `gewoelbe` go to the planned vaults round robin in slot order (their preferred room role kept).
 * - **Variety:** the Grünhain vault nearest the start beach gets `nearestPuzzleTypes` puzzle types (§32). Every biome's vaults
 *   together show every kind of guard (M7-97): a kind the draws left out of all of them is planned again into one of them
 *   (the k-th missing kind into the biome's k-th vault in slot order, its own kinds kept, grammar parameter `mustHold`), so a
 *   construct, a trap spirit and a mimic each stand in at least one of a biome's 3–4 vaults (`BALANCE.vaults.guardShareMin`).
 * - The plans' boxes are what the underground plan keeps out of (`createUndergroundPlan({ …, reserved })`).
 */
import { BALANCE, type WorldSizePreset } from '../../../content/balance';
import { Fnv1a64 } from '../../../engine/binary';
import { phypot } from '../../../engine/portableMath';
import { CONTENT } from '../../../content/index';
import type { PuzzleVariantDef, TabletDef, VaultRole } from '../../../content/dungeons/schema';
import { VAULT_GUARDS } from '../../../content/dungeons/waechter';
import { worldDimensions } from '../../model/worldSize';
import { LOCATION_RULES, type LocationSlot } from '../locations';
import type { PlacePlacement } from '../places/types';
import { VAULT_GUARD_KINDS, type VaultGraphParams, type VaultGuardKind } from './grammar';
import { planVault } from './embed';
import { tilesetOfBiome } from './templates';
import type { VaultPlan } from './types';

/** The slot type of the vaults. */
export const VAULT_SLOT_TYPE = 'gewoelbe';
/** The guards of the vaults (docs/SPIEL.md §29); a creature the content does not have yet is left out. */
export { VAULT_GUARDS };
/** Graph attempts per vault before the slot stays without one. Every grammar graph of ≤ 9 rooms embeds at once in practice. */
const GRAPH_ATTEMPTS = 4;

/** The start clearing (`BALANCE.places.startClearTiles` around the spawn): no place and no vault there. */
export interface VaultClearing {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

function inClearing(slot: LocationSlot, c: VaultClearing): boolean {
  return phypot(slot.x - c.x, slot.y - c.y) - slot.radius < c.radius;
}

/**
 * The slots holding an ember shard: `count` reserved round by round over the rule's biomes (one per biome and round, slot
 * order within a biome), outside the clearing.
 */
export function shardSlots(slots: readonly LocationSlot[], clearing: VaultClearing, count: number = BALANCE.vaults.emberShards): ReadonlySet<number> {
  const biomes = LOCATION_RULES.gewoelbe?.biomes ?? [];
  const byBiome = biomes.map((b) => slots.filter((s) => s.type === VAULT_SLOT_TYPE && s.biome === b && !inClearing(s, clearing)).sort((a, c) => a.id - c.id));
  const out = new Set<number>();
  for (let round = 0; out.size < count; round++) {
    let any = false;
    for (const list of byBiome) {
      const s = list[round];
      if (s === undefined) continue;
      any = true;
      if (out.size < count) out.add(s.id);
    }
    if (!any) break;
  }
  return out;
}

/** The grammar's parameters from the balance and the content (guards the content has, every puzzle type and trap). */
export function vaultGraphParams(minPuzzleTypes: number, tablets: VaultGraphParams['tablets'], shard: boolean, mustHold: readonly VaultGuardKind[] = []): VaultGraphParams {
  const V = BALANCE.vaults;
  const creatures = CONTENT.collection('creatures');
  const guard = (id: string): string | null => (creatures.find(id) === undefined ? null : id);
  const types = CONTENT.collection('puzzleTypes').values();
  return {
    minRooms: V.minRooms,
    maxRooms: V.maxRooms,
    minPuzzleTypes,
    puzzleTypes: types.map((t) => t.id),
    trapTypes: CONTENT.collection('vaultTraps').ids(),
    hiddenWallChance: V.hiddenWallChance,
    puzzleVariants: Object.fromEntries(types.map((t) => [t.id, t.varianten.map((v) => v.id)])),
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
    guards: { chamber: guard(VAULT_GUARDS.chamber), trapRoom: guard(VAULT_GUARDS.trapRoom), boss: guard(VAULT_GUARDS.boss), mimic: guard(VAULT_GUARDS.mimic) },
    mustHold,
    tablets,
    shard,
  };
}

let variants: ReadonlyMap<string, PuzzleVariantDef> | null = null;
function variantOf(id: string): PuzzleVariantDef | undefined {
  variants ??= new Map(CONTENT.collection('puzzleTypes').values().flatMap((t) => t.varianten.map((v) => [v.id, v] as const)));
  return variants.get(id);
}

/** The entrance of a vault slot: the mark `eingang` of its surface layout, or null (no layout, no vault). */
function entranceOf(slot: LocationSlot, placements: readonly PlacePlacement[]): { tx: number; ty: number } | null {
  const p = placements.find((x) => x.slot === slot.id);
  const m = p?.markers.find((x) => x.mark === 'eingang');
  return m === undefined ? null : { tx: m.tx, ty: m.ty };
}

/** The plans of every vault of a world (slot order). */
export function planVaults(seed: number, preset: WorldSizePreset, slots: readonly LocationSlot[], placements: readonly PlacePlacement[], clearing: VaultClearing): VaultPlan[] {
  const V = BALANCE.vaults;
  const tiles = worldDimensions(preset).tiles;
  const half = Math.floor(V.boxTiles / 2);
  const candidates: { slot: LocationSlot; entrance: { tx: number; ty: number } }[] = [];
  for (const slot of [...slots].sort((a, b) => a.id - b.id)) {
    if (slot.type !== VAULT_SLOT_TYPE || inClearing(slot, clearing) || tilesetOfBiome(slot.biome) === undefined) continue;
    const entrance = entranceOf(slot, placements);
    if (entrance === null) continue;
    if (entrance.tx - half < 0 || entrance.ty - half < 0 || entrance.tx + half > tiles || entrance.ty + half > tiles) continue;
    candidates.push({ slot, entrance });
  }
  const shards = shardSlots(slots, clearing);
  // Tablets of the vaults, round robin over the candidates in slot order.
  const tablets: TabletDef[] = CONTENT.collection('tablets')
    .values()
    .filter((t) => t.fundort.art === 'gewoelbe');
  const tabletsOf = candidates.map((): { id: string; role?: VaultRole }[] => []);
  tablets.forEach((t, i) => {
    const role = t.fundort.art === 'gewoelbe' ? t.fundort.rolle : undefined;
    tabletsOf[i % Math.max(1, candidates.length)]?.push(role === undefined ? { id: t.id } : { id: t.id, role });
  });
  // The Grünhain vault nearest the start beach shows the breadth of the puzzles.
  let nearest = -1;
  let nearestD = Number.POSITIVE_INFINITY;
  candidates.forEach((c, i) => {
    if (c.slot.biome !== 'gruenhain') return;
    const dx = c.slot.x - clearing.x;
    const dy = c.slot.y - clearing.y;
    const d = dx * dx + dy * dy;
    if (d < nearestD) {
      nearestD = d;
      nearest = i;
    }
  });
  const plan = (i: number, mustHold: readonly VaultGuardKind[]): VaultPlan | null => {
    const c = candidates[i];
    const tileset = c === undefined ? undefined : tilesetOfBiome(c.slot.biome);
    if (c === undefined || tileset === undefined) return null;
    return planVault({
      seed,
      slot: c.slot.id,
      biome: c.slot.biome,
      entrance: c.entrance,
      params: vaultGraphParams(i === nearest ? V.nearestPuzzleTypes : 1, tabletsOf[i] ?? [], shards.has(c.slot.id), mustHold),
      tileset,
      boxTiles: V.boxTiles,
      gridCells: V.gridCells,
      embedTries: V.embedTries,
      graphAttempts: GRAPH_ATTEMPTS,
      variant: variantOf,
    });
  };
  const planned = candidates.map((_, i) => plan(i, []));
  // Variety of the guards per biome (module comment): a kind none of a biome's vaults shows goes into one of them.
  const guardIds = vaultGraphParams(1, [], false).guards;
  const kindsOf = (p: VaultPlan): VaultGuardKind[] => VAULT_GUARD_KINDS.filter((k) => guardIds[k] !== null && p.guards.some((g) => g.creature === guardIds[k]));
  for (const biome of new Set(candidates.map((c) => c.slot.biome))) {
    const own = planned.flatMap((p, i) => (p !== null && candidates[i]?.slot.biome === biome ? [i] : []));
    if (own.length === 0) continue;
    const missing = VAULT_GUARD_KINDS.filter((k) => guardIds[k] !== null && !own.some((i) => kindsOf(planned[i] as VaultPlan).includes(k)));
    const extra = new Map<number, VaultGuardKind[]>();
    missing.forEach((k, j) => {
      const i = own[j % own.length] as number;
      extra.set(i, [...(extra.get(i) ?? []), k]);
    });
    for (const [i, kinds] of extra) {
      const again = plan(i, [...kindsOf(planned[i] as VaultPlan), ...kinds]);
      if (again !== null) planned[i] = again;
    }
  }
  return planned.filter((p): p is VaultPlan => p !== null);
}

/** Determinism hash of a world's vault plans (part of the world hash; the plans are plain data, their JSON is canonical). */
export function vaultPlansHash(plans: readonly VaultPlan[]): string {
  const json = JSON.stringify(plans);
  const codes = new Uint16Array(json.length);
  for (let i = 0; i < json.length; i++) codes[i] = json.charCodeAt(i);
  return new Fnv1a64().update(codes).hex();
}
