/**
 * The vaults at runtime (MASTERPROMPT §21 "Gewölbe/Dungeons", "Fallen", "Belohnungen"; docs/SPIEL.md §19; M7-10 … M7-16, M7-46).
 * System `vaults`, global (every deadline is an absolute tick; nothing runs while the player is elsewhere – a blade's swing is
 * a pure function of the tick), save participant `vaults`.
 *
 * - **Vaults** are the plans of `GeneratedWorld.vaults` (src/world/gen/vaults): a box on layer −1 under a surface entrance,
 *   rooms, doors, puzzles, traps, chests, guards, tablets, the ember shard – stamped into the chunks by the generator. What
 *   changes lives here: one `VaultState` per entered vault.
 * - **Entering:** E at the stairs of the entrance (`vault.enter`) takes the player down beside the way up of the start room;
 *   the first time the guards rise (owned creatures `gewoelbe:<slot>`: constructs, trap spirits, mimics on their chests, the
 *   mini-boss in the end chamber) – `vaultEntered`. E at the way up (`vault.leave`) leads back to the surface.
 * - **Doors** (collision overlay while closed): a lock opens with a key of this vault (`gewoelbeschluessel`, `daten.gewoelbe` =
 *   slot; taken from its pedestal; any key of the vault fits any of its locks and is used up), a puzzle's door when the puzzle
 *   is solved, a cracked wall to a secret room with E (`vaultHiddenFound`).
 * - **Puzzles** keep their encoded state (src/game/puzzles/): E at a lever, a bowl (a burning light in the hand), a bell, a
 *   cracked wall (`vault.use`), at a crate (`vault.push`, away from the player), at the reset rune; a step counts after the
 *   previous one's spring (`BALANCE.puzzles`), a wrong step resets after a pause. The bell puzzle's inscription plays its
 *   tune tone by tone (`vaultHintPlayed`). Solved: `puzzleSolved`, experience (`raetsel_geloest`), its door opens.
 * - **Traps** of the vault the player is in: ready → warning (`vaultTrapArmed`, ≥ 0.4 s) → strike (`vaultTrapTriggered`) →
 *   cooldown; plates and lanes sense the player and creatures alike, blades swing on their beat; damage cause `falle` on the
 *   player (rolling dodges it), resistance and armour on creatures; a collapsed floor stays a hole (a chunk change).
 * - **Rewards:** chests (`placeLoot` `gewoelbe_<biom>_<stufe>` drawn with `hash(seed, vault, chest)`; the end chest adds its
 *   unique blueprint), keys, the ember shard, tablets (`tablet.read` → `tabletRead`, also for the places' marks through
 *   `PlacesSystem.addTabletReader`). **Completed** when the mini-boss fell and the end chest is open (`vaultCompleted`).
 * - **Table spawns** stay out of every box (a spawn blocker): the vault's creatures are its guards.
 * - **Light:** burning fire bowls light their row, the floor runes glow faintly around the player (`lightProvider`).
 */
import { BALANCE } from '../../content/balance';
import { CONTENT } from '../../content/index';
import type { PuzzleVariantDef, VaultTrapDef } from '../../content/dungeons/schema';
import { VAULT_UNIQUE_BLUEPRINTS } from '../../content/dungeons/belohnungen';
import { lightKindOfItem } from '../../content/lights';
import type { PlaceLootDef } from '../../content/places/schema';
import { NULL_ENTITY, type Entity } from '../../engine/ecs';
import { BLOCK_OBJECT, BLOCK_SOLID, type CollisionOverlay } from '../../world/collision/tiles';
import { VAULT_GUARDS } from '../../world/gen/vaults/plan';
import { placedTemplate, vaultRaster, VAULT_OPEN_CHEST_OBJECT, VAULT_COLLAPSED_OBJECT, type VaultRaster } from '../../world/gen/vaults/raster';
import type { VaultPlan } from '../../world/gen/vaults/types';
import type { ChunkData } from '../../world/model/chunk';
import { CHUNK_MASK, CHUNK_SHIFT, TILE_PX, type Layer } from '../../world/model/coords';
import type { CombatantView, CombatTargetProvider } from '../combat/targets';
import { createHitResult } from '../combat/system';
import { secondsToTicks } from '../combat/formulas';
import type { GameCommandType } from '../commands';
import type { CreatureOwner, OwnedCreaturesApi } from '../creatures/owned';
import { CARRY_AREAS } from '../items/slots';
import type { ItemCatalog } from '../items/catalog';
import { newStack, type ItemStack } from '../items/stack';
import { areaSlots } from '../inventory/bags';
import { discard } from '../inventory/ops';
import type { InventorySystem } from '../inventory/system';
import type { ExtraLightProvider } from '../light/system';
import type { SaveParticipant } from '../participant';
import { drawPlaceLoot, type PlaceLootDrop } from '../places/formulas';
import type { WorldCollision } from '../player/collision';
import type { PlayerSystem } from '../player/system';
import { kistenCanPush, kistenMap, kistenStep, partOrdinal, puzzleAct, puzzleInit, puzzleCanonical, puzzleSolve, puzzleSolved } from '../puzzles/index';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import type { DamageCause } from '../survival/events';
import type { VaultRejectReason } from './events';
import { pushDirection, trapBeatPhase, trapBeatTicks, trapCreatureDamage, trapPlayerDamage, trapRearmTicks, trapSenseTiles, trapStopsAtFirst, trapStrikeTiles, trapWarnTicks, uniqueBlueprintOf, vaultChestRng } from './formulas';
import { copyVaultState, newVaultState, TRAP_READY, TRAP_SPENT, vaultsSnapshotSchema, type VaultsSnapshot } from './state';
import type { VaultsApi, VaultState } from './types';

/** Id of the vaults system and its save participant. */
export const VAULTS_SYSTEM_ID = 'vaults';
/** Data version of the `vaults` participant. */
export const VAULTS_SAVE_VERSION = 1;
/** The key item of the vaults; its `daten.gewoelbe` names the vault it opens (docs/SPIEL.md §19). */
export const VAULT_KEY_ITEM = 'gewoelbeschluessel';
/** The ember shard of a vault (§21 "Glutsplitter: 12 in der Welt"). */
export const VAULT_SHARD_ITEM = 'glutsplitter';
/** The experience source of a solved puzzle (skill `ueberleben`, src/content/skills.ts). */
export const PUZZLE_SOLVED_SOURCE = 'raetsel_geloest';
/** The damage cause of the traps. */
const TRAP_CAUSE: DamageCause = 'falle';

/** The vaults lie on layer −1 (ADR-0207). */
export const VAULT_LAYER: Layer = -1;
const SURFACE: Layer = 0;
const OWNER_PREFIX = 'gewoelbe:';

const V = BALANCE.vaults;
const P = BALANCE.puzzles;

/** Packs a tile into a map key (wider than any world, WORLD.md §1). */
const TILE_KEY_STRIDE = 65_536;
function tileKey(tx: number, ty: number): number {
  return ty * TILE_KEY_STRIDE + tx;
}

/** What a tile of a vault holds for E: a kind and an index (door id, puzzle × 256 + part, chest id, key, tablet). */
const KIND_DOOR = 1;
const KIND_PART = 2;
const KIND_CHEST = 3;
const KIND_KEY = 4;
const KIND_SHARD = 5;
const KIND_TABLET = 6;
const KIND_UP = 7;
/** Parts per puzzle at most (packs into the index). */
const PART_STRIDE = 256;
/** Kind × this + index (2^20: room for any index below it). */
const KIND_STRIDE = 1_048_576;

/** The world the vaults live in (the generated world of the simulation; tests draw their own). */
export interface VaultWorld {
  /** The vault plans (`GeneratedWorld.vaults`). */
  vaults(sim: Simulation): readonly VaultPlan[];
  /** The resident chunk (cx, cy) of `layer`, or undefined. */
  chunk(sim: Simulation, layer: Layer, cx: number, cy: number): ChunkData | undefined;
  /** Runtime id of a world object (`WorldIdTables.objects`). */
  objectRuntimeId(id: string): number;
}

/** The world of the simulation: its generated world, chunks and id tables. */
export function worldVaultWorld(objectRuntimeId: (id: string) => number): VaultWorld {
  return {
    vaults: (sim) => sim.world.generated.vaults,
    chunk: (sim, layer, cx, cy) => sim.world.chunks.get(layer, cx, cy),
    objectRuntimeId,
  };
}

/** Dependencies of the vaults system (the systems registered before it). */
export interface VaultsSystemDeps {
  readonly player: PlayerSystem;
  readonly creatures: OwnedCreaturesApi & { readonly targets: CombatTargetProvider; positionOf(e: Entity, out: { x: number; y: number }): boolean };
  readonly collision: WorldCollision;
  readonly inventory: InventorySystem;
  readonly catalog: ItemCatalog;
  /** Spawns a stack as a drop at (x, y) [px] (the drop system). */
  readonly spill: (sim: Simulation, stack: ItemStack, layer: Layer, x: number, y: number) => void;
  /** Puts the player at (x, y) [px] of `layer` (`player.teleport`). */
  readonly teleport: (sim: Simulation, x: number, y: number, layer: Layer) => void;
  /** Instant damage to the player (`VitalsSystem.damage`). */
  readonly damage: (sim: Simulation, amount: number, cause: DamageCause) => number;
  /** The world's enemy damage factor (difficulty, world settings §25). */
  readonly enemyDamage: () => number;
  readonly world: VaultWorld;
}

/** Experience of the skills (bound with the life systems). */
export interface VaultSkills {
  award(sim: Simulation, sourceId: string, times?: number): number;
}

/** One vault of the world and what the runtime needs of it. */
interface VaultEntry {
  readonly plan: VaultPlan;
  readonly raster: VaultRaster;
  readonly variants: readonly PuzzleVariantDef[];
  readonly traps: readonly VaultTrapDef[];
  /** What E finds per tile: `kind × KIND_STRIDE + index`. */
  readonly partAt: ReadonlyMap<number, number>;
  /** Origin of each `kisten` puzzle's map (absolute tile), else −1. */
  readonly kistenX: Int32Array;
  readonly kistenY: Int32Array;
  /** Overlay bits per box tile (`BLOCK_*`), from the state. */
  readonly block: Uint8Array;
  /** The chest in the end chamber, or −1. */
  readonly endChest: number;
  /** Whether the plan has a mini-boss. */
  readonly hasBoss: boolean;
  /** The unique blueprint of its end chest, or null. */
  readonly blueprint: string | null;
  /** The glowing floor runes of its rooms (`VAULT_RUNE_OBJECT`): absolute tiles, x and y in turn. */
  readonly runes: Int32Array;
}

interface VaultIndex {
  readonly all: readonly VaultEntry[];
  readonly bySlot: ReadonlyMap<number, VaultEntry>;
}

export class VaultsSystem implements SimSystem, VaultsApi {
  readonly id = VAULTS_SYSTEM_ID;
  readonly timeScope = 'global' as const;
  readonly commands: CommandHandlers;
  readonly save: SaveParticipant;
  private readonly states = new Map<number, VaultState>();
  private index: VaultIndex | null = null;
  private skills: VaultSkills | null = null;
  private readonly at = { x: 0, y: 0 };
  /** Slot of the vault the player stood in at the last tick, or −1 (`playerVault`). */
  private playerSlot = -1;
  private readonly loot: PlaceLootDrop[] = [];
  private readonly tiles: number[] = [];
  private readonly found: Entity[] = [];
  private readonly view: CombatantView = {
    entity: NULL_ENTITY,
    team: 'feind',
    layer: 0,
    level: 0,
    x: 0,
    y: 0,
    radius: 0,
    facing: 0,
    health: 0,
    maxHealth: 0,
    armor: 0,
    resist: { hieb: 0, stich: 0, wucht: 0, feuer: 0, frost: 0, gift: 0, licht: 0, schatten: 0 },
    invulnerable: false,
    blockSinceTick: -1,
    blockPower: 0,
  };
  private readonly hit = createHitResult();

  constructor(
    private readonly sim: Simulation,
    private readonly deps: VaultsSystemDeps,
  ) {
    this.commands = {
      'vault.enter': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.enter(s, cmd.vault, tick)),
      'vault.leave': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.leave(s, cmd.vault, tick)),
      'vault.use': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.useTile(s, cmd.tx, cmd.ty, tick)),
      'vault.push': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.push(s, cmd.tx, cmd.ty, tick)),
      'tablet.read': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.readTablet(s, cmd.tablet, 'gewoelbe', -1, tick) ? null : 'unknownTablet'),
      'vault.solve': (s, cmd, tick) => this.refuse(s, cmd.type, tick, this.debugSolve(s, cmd.vault, cmd.puzzle ?? -1, tick)),
    };
    this.save = {
      id: VAULTS_SYSTEM_ID,
      version: VAULTS_SAVE_VERSION,
      // Saves before M7 entered no vault.
      migrations: [{ from: 0, migrate: (): VaultsSnapshot => ({ vaults: [] }) }],
      serialize: () => this.snapshot(),
      deserialize: (data) => this.restore(data),
    };
    deps.creatures.onOwnedDeath((s, owner, creature, entity) => this.guardFell(s, owner, creature, entity));
    deps.creatures.addSpawnBlocker((s, layer, tx, ty) => layer === VAULT_LAYER && this.entryAt(s, tx, ty) !== undefined);
  }

  /** Binds the skills (experience of a solved puzzle; registered after this system). */
  useSkills(skills: VaultSkills): void {
    this.skills = skills;
  }

  // -------------------------------------------------------------------------------------------
  // Index
  // -------------------------------------------------------------------------------------------

  /**
   * The vaults of the world (built once). The lookup stays apart from `buildIndex`: a function whose closures capture its own
   * variables allocates their context on every call, before any early return (§30 – this runs every tick and every frame).
   */
  private vaults(sim: Simulation): VaultIndex {
    return this.index ?? this.buildIndex(sim);
  }

  private buildIndex(sim: Simulation): VaultIndex {
    const plans = this.deps.world.vaults(sim);
    const variants = new Map(CONTENT.collection('puzzleTypes').values().flatMap((t) => t.varianten.map((v) => [v.id, v] as const)));
    const trapDefs = CONTENT.collection('vaultTraps');
    const all: VaultEntry[] = [];
    const bySlot = new Map<number, VaultEntry>();
    for (const plan of plans) {
      const partAt = new Map<number, number>();
      const set = (tx: number, ty: number, kind: number, index: number): void => {
        partAt.set(tileKey(tx, ty), kind * KIND_STRIDE + index);
      };
      for (const d of plan.doors) {
        set(d.tx, d.ty, KIND_DOOR, d.id);
        set(d.vertical ? d.tx : d.tx + 1, d.vertical ? d.ty + 1 : d.ty, KIND_DOOR, d.id);
      }
      const kistenX = new Int32Array(plan.puzzles.length).fill(-1);
      const kistenY = new Int32Array(plan.puzzles.length).fill(-1);
      const vs: PuzzleVariantDef[] = [];
      for (const p of plan.puzzles) {
        const v = variants.get(p.variant);
        if (v === undefined) throw new RangeError(`Vault ${plan.slot}: puzzle variant ${p.variant} is not in the content`);
        vs.push(v);
        p.parts.forEach((part, j) => {
          if (part.role === 'ursprung') {
            kistenX[p.id] = part.tx;
            kistenY[p.id] = part.ty;
          }
          if (part.role === 'hebel' || part.role === 'schale' || part.role === 'glocke' || part.role === 'risswand' || part.role === 'ruecksetzer' || (part.role === 'hinweis' && v.typ === 'glocken')) {
            set(part.tx, part.ty, KIND_PART, p.id * PART_STRIDE + j);
          }
        });
      }
      plan.chests.forEach((c) => set(c.tx, c.ty, KIND_CHEST, c.id));
      plan.keys.forEach((k, i) => set(k.tx, k.ty, KIND_KEY, i));
      if (plan.shard !== null) set(plan.shard.tx, plan.shard.ty, KIND_SHARD, 0);
      plan.tablets.forEach((t, i) => set(t.tx, t.ty, KIND_TABLET, i));
      set(plan.entrance.tx, plan.entrance.ty, KIND_UP, 0);
      const endRoom = plan.rooms.find((r) => r.node === plan.graph.end);
      const endT = endRoom === undefined ? null : placedTemplate(plan.tileset, endRoom.template);
      const inEnd = (c: { tx: number; ty: number }): boolean => endRoom !== undefined && endT !== null && c.tx >= endRoom.x0 && c.ty >= endRoom.y0 && c.tx < endRoom.x0 + endT.w && c.ty < endRoom.y0 + endT.h;
      const endChest = plan.chests.find((c) => c.tier === TIER_END && inEnd(c))?.id ?? -1;
      const entry: VaultEntry = {
        plan,
        raster: vaultRaster(plan),
        variants: vs,
        traps: plan.traps.map((t) => trapDefs.get(t.type)),
        partAt,
        kistenX,
        kistenY,
        block: new Uint8Array(plan.box.w * plan.box.h),
        endChest,
        hasBoss: plan.guards.some((g) => g.boss),
        blueprint: uniqueBlueprintOf(plans, plan.slot, VAULT_UNIQUE_BLUEPRINTS),
        runes: runeTiles(vaultRaster(plan)),
      };
      all.push(entry);
      bySlot.set(plan.slot, entry);
    }
    this.index = { all, bySlot };
    for (const e of all) this.fillBlock(e, this.states.get(e.plan.slot) ?? null);
    return this.index;
  }

  /** The vault whose box holds tile (tx, ty) of layer −1, or undefined. */
  private entryAt(sim: Simulation, tx: number, ty: number): VaultEntry | undefined {
    const all = this.vaults(sim).all;
    for (let i = 0; i < all.length; i++) {
      const b = (all[i] as VaultEntry).plan.box;
      if (tx >= b.x0 && ty >= b.y0 && tx < b.x0 + b.w && ty < b.y0 + b.h) return all[i];
    }
    return undefined;
  }

  /** The state of a vault, created on first touch. */
  private touch(e: VaultEntry): VaultState {
    let s = this.states.get(e.plan.slot);
    if (s === undefined) {
      s = newVaultState(e.plan.slot, e.variants.map((v) => puzzleInit(v)), e.plan.traps.length);
      this.states.set(e.plan.slot, s);
    }
    return s;
  }

  // -------------------------------------------------------------------------------------------
  // Overlay
  // -------------------------------------------------------------------------------------------

  /** Writes the overlay bits of a vault from its state (`null`: untouched). */
  private fillBlock(e: VaultEntry, s: Readonly<VaultState> | null): void {
    const { plan, block } = e;
    const { x0, y0, w } = plan.box;
    block.fill(0);
    const mark = (tx: number, ty: number, bits: number): void => {
      block[(ty - y0) * w + (tx - x0)] = bits;
    };
    for (const d of plan.doors) {
      if (this.doorOpen(e, s, d.id)) continue;
      mark(d.tx, d.ty, BLOCK_SOLID);
      mark(d.vertical ? d.tx : d.tx + 1, d.vertical ? d.ty + 1 : d.ty, BLOCK_SOLID);
    }
    plan.keys.forEach((k, i) => {
      if (((s?.keysTaken ?? 0) & (1 << i)) === 0) mark(k.tx, k.ty, BLOCK_OBJECT);
    });
    if (plan.shard !== null && s?.shardTaken !== true) mark(plan.shard.tx, plan.shard.ty, BLOCK_OBJECT);
    plan.puzzles.forEach((p, k) => {
      const v = e.variants[k] as PuzzleVariantDef;
      const state = s === null ? puzzleInit(v) : puzzleCanonical(v, s.puzzles[k] ?? []);
      p.parts.forEach((part, j) => {
        if (part.role === 'hebel' || part.role === 'schale' || part.role === 'glocke' || part.role === 'hinweis') mark(part.tx, part.ty, BLOCK_OBJECT);
        // A cracked wall stands until it is found open (only the real ones open, `VERBORGENE_WAND_RULES`).
        if (part.role === 'risswand' && ((state[0] ?? 0) & (1 << partOrdinal(p.parts, j))) === 0) mark(part.tx, part.ty, BLOCK_SOLID);
      });
      if (v.typ === 'kisten') {
        const m = kistenMap(v);
        for (const c of state) mark((e.kistenX[k] as number) + (c % m.w), (e.kistenY[k] as number) + Math.floor(c / m.w), BLOCK_OBJECT);
      }
    });
  }

  /** Recomputes a vault's overlay and reports every tile that changed to the collision grid. */
  private refreshBlock(e: VaultEntry): void {
    const before = Uint8Array.from(e.block);
    this.fillBlock(e, this.states.get(e.plan.slot) ?? null);
    const { x0, y0, w } = e.plan.box;
    for (let i = 0; i < before.length; i++) if (before[i] !== e.block[i]) this.deps.collision.invalidateTile(VAULT_LAYER, x0 + (i % w), y0 + Math.floor(i / w));
  }

  private doorOpen(e: VaultEntry, s: Readonly<VaultState> | null, door: number): boolean {
    const d = e.plan.doors[door];
    if (d === undefined || s === null) return false;
    return d.kind === 'verborgen' ? (s.hiddenFound & (1 << door)) !== 0 : (s.doorsOpen & (1 << door)) !== 0;
  }

  /** The vaults' closed doors, crates, pedestals and standing cracked walls (a collision overlay). */
  collisionOverlay(): CollisionOverlay {
    return {
      overlayAt: (layer, tx, ty) => {
        if (layer !== VAULT_LAYER) return 0;
        const e = this.entryAt(this.sim, tx, ty);
        if (e === undefined) return 0;
        const b = e.plan.box;
        return e.block[(ty - b.y0) * b.w + (tx - b.x0)] ?? 0;
      },
    };
  }

  // -------------------------------------------------------------------------------------------
  // VaultsApi and reads of the presentation
  // -------------------------------------------------------------------------------------------

  vaultAt(layer: Layer, tx: number, ty: number): number {
    if (layer !== VAULT_LAYER) return -1;
    return this.entryAt(this.sim, tx, ty)?.plan.slot ?? -1;
  }

  playerVault(): number {
    return this.playerSlot;
  }

  planOf(slot: number): VaultPlan | undefined {
    return this.vaults(this.sim).bySlot.get(slot)?.plan;
  }

  state(slot: number): Readonly<VaultState> | undefined {
    return this.states.get(slot);
  }

  blocks(layer: Layer, tx: number, ty: number): boolean {
    return this.collisionOverlay().overlayAt(layer, tx, ty) !== 0;
  }

  use(sim: Simulation, layer: Layer, tx: number, ty: number, tick: number): boolean {
    return layer === VAULT_LAYER && this.useTile(sim, tx, ty, tick) === null;
  }

  /** The vault whose entrance is surface tile (tx, ty), or −1. */
  entranceAt(sim: Simulation, tx: number, ty: number): number {
    for (const e of this.vaults(sim).all) if (e.plan.entrance.tx === tx && e.plan.entrance.ty === ty) return e.plan.slot;
    return -1;
  }

  /** What E finds on tile (tx, ty) of layer −1: `{kind, index}` into `out`; false when nothing. */
  partAtTile(sim: Simulation, tx: number, ty: number, out: { slot: number; kind: number; index: number }): boolean {
    const e = this.entryAt(sim, tx, ty);
    if (e === undefined) return false;
    const code = e.partAt.get(tileKey(tx, ty));
    out.slot = e.plan.slot;
    if (code === undefined) {
      if (this.crateAt(e, tx, ty) < 0) return false;
      out.kind = USE_CRATE;
      out.index = this.crateAt(e, tx, ty);
      return true;
    }
    out.kind = Math.floor(code / KIND_STRIDE);
    out.index = code % KIND_STRIDE;
    return true;
  }

  /** Whether door `door` of the vault in `slot` is open. */
  isDoorOpen(slot: number, door: number): boolean {
    const e = this.vaults(this.sim).bySlot.get(slot);
    return e !== undefined && this.doorOpen(e, this.states.get(slot) ?? null, door);
  }

  /** The encoded state of puzzle `puzzle` of the vault in `slot` (its start when untouched). */
  puzzleState(slot: number, puzzle: number): readonly number[] {
    const e = this.vaults(this.sim).bySlot.get(slot);
    const v = e?.variants[puzzle];
    if (e === undefined || v === undefined) return [];
    const s = this.states.get(slot);
    return s === undefined ? puzzleInit(v) : puzzleCanonical(v, s.puzzles[puzzle] ?? []);
  }

  /** Whether puzzle `puzzle` of the vault in `slot` is solved. */
  isSolved(slot: number, puzzle: number): boolean {
    const v = this.vaults(this.sim).bySlot.get(slot)?.variants[puzzle];
    return v !== undefined && puzzleSolved(v, this.puzzleState(slot, puzzle));
  }

  /** Whether the chest `chest` of the vault in `slot` is open. */
  chestOpen(slot: number, chest: number): boolean {
    return ((this.states.get(slot)?.chestsOpened ?? 0) & (1 << chest)) !== 0;
  }

  /** Whether the key on pedestal `key` (index into `VaultPlan.keys`) was taken. */
  keyTaken(slot: number, key: number): boolean {
    return ((this.states.get(slot)?.keysTaken ?? 0) & (1 << key)) !== 0;
  }

  /** The puzzle variant of puzzle `puzzle` of the vault in `slot`. */
  variantOf(slot: number, puzzle: number): PuzzleVariantDef | undefined {
    return this.vaults(this.sim).bySlot.get(slot)?.variants[puzzle];
  }

  /** The trap record of trap `trap` of the vault in `slot`. */
  trapDefOf(slot: number, trap: number): VaultTrapDef | undefined {
    return this.vaults(this.sim).bySlot.get(slot)?.traps[trap];
  }

  /** Every vault of the world, in slot order. */
  forEachVault(visit: (plan: VaultPlan, state: Readonly<VaultState> | undefined) => void): void {
    for (const e of this.vaults(this.sim).all) visit(e.plan, this.states.get(e.plan.slot));
  }

  /**
   * The lights of the vaults (`LightSystem.addLightProviders`): the burning fire bowls of the entered vaults
   * (`BALANCE.vaults.bowlLight` – a bowl lit in the order burns until a wrong one puts them all out, a solved row burns for
   * good) and the faint cold pools of the glowing floor runes of the vault the player is in, within
   * `runeLightReachTiles` of him (`runeLight`). Reads the saved states and the runes listed once per vault (no allocation per
   * tick).
   */
  lightProvider(): ExtraLightProvider {
    const l = V.bowlLight;
    const r = V.runeLight;
    const reach = V.runeLightReachTiles;
    return (sim, emit) => {
      if (this.states.size === 0) return;
      const all = this.vaults(sim).all;
      // The runes of the vault the player is in, near him.
      const body = this.deps.player.body(sim);
      if (body !== undefined && body.layer === VAULT_LAYER && this.deps.player.position(sim, this.at)) {
        const ptx = Math.floor(this.at.x / TILE_PX);
        const pty = Math.floor(this.at.y / TILE_PX);
        const e = this.entryAt(sim, ptx, pty);
        if (e !== undefined) {
          const runes = e.runes;
          for (let k = 0; k + 1 < runes.length; k += 2) {
            const tx = runes[k] as number;
            const ty = runes[k + 1] as number;
            if (Math.abs(tx - ptx) > reach || Math.abs(ty - pty) > reach) continue;
            emit(RUNE_LIGHT_ID_BASE + ((e.plan.slot & BOWL_LIGHT_SLOT_MASK) << RUNE_LIGHT_SLOT_SHIFT) + (k >> 1), RUNE_LIGHT_KIND, r.farbe, VAULT_LAYER, (tx + 0.5) * TILE_PX, (ty + 0.5) * TILE_PX, r.flameHeightPx, r.radiusTiles * TILE_PX, r.intensity, r.flicker, 1, Math.ceil(r.radiusTiles));
          }
        }
      }
      for (let i = 0; i < all.length; i++) {
        const e = all[i] as VaultEntry;
        const s = this.states.get(e.plan.slot);
        if (s === undefined || !s.entered) continue;
        for (let k = 0; k < e.variants.length; k++) {
          const v = e.variants[k] as PuzzleVariantDef;
          if (v.typ !== 'feuerschalen') continue;
          const lit = bowlsLit(v.folge, s.puzzles[k]);
          if (lit === 0) continue;
          const parts = (e.plan.puzzles[k] as VaultPlan['puzzles'][number]).parts;
          let bowl = 0;
          for (let j = 0; j < parts.length; j++) {
            const part = parts[j] as (typeof parts)[number];
            if (part.role !== 'schale') continue;
            if ((lit & (1 << bowl)) !== 0) {
              const id = BOWL_LIGHT_ID_BASE + ((e.plan.slot & BOWL_LIGHT_SLOT_MASK) << BOWL_LIGHT_SLOT_SHIFT) + k * BOWL_LIGHT_PUZZLE_STRIDE + bowl;
              emit(id, BOWL_LIGHT_KIND, l.farbe, VAULT_LAYER, (part.tx + 0.5) * TILE_PX, (part.ty + 1) * TILE_PX - 1, l.flameHeightPx, l.radiusTiles * TILE_PX, l.intensity, l.flicker, 1, Math.ceil(l.radiusTiles));
            }
            bowl++;
          }
        }
      }
    };
  }

  /** Whether the player carries a key of the vault in `slot`. */
  hasKey(slot: number): boolean {
    return this.keySlot(slot) !== null;
  }

  // -------------------------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------------------------

  update(sim: Simulation): void {
    this.playerSlot = -1;
    const body = this.deps.player.body(sim);
    if (body === undefined || body.layer !== VAULT_LAYER || !this.deps.player.position(sim, this.at)) return;
    const tx = Math.floor(this.at.x / TILE_PX);
    const ty = Math.floor(this.at.y / TILE_PX);
    const e = this.entryAt(sim, tx, ty);
    if (e === undefined) return;
    this.playerSlot = e.plan.slot;
    const tick = sim.eventTick;
    const s = this.states.get(e.plan.slot);
    // Inside without the stairs (a debug teleport, a load): the vault counts as entered.
    if (s === undefined || !s.entered) this.arrive(sim, e, tick);
    const st = this.touch(e);
    this.playHint(sim, e, st, tick);
    this.runTraps(sim, e, st, tick);
  }

  // -------------------------------------------------------------------------------------------
  // Entering and leaving
  // -------------------------------------------------------------------------------------------

  private refuse(sim: Simulation, type: GameCommandType, tick: number, reason: VaultRejectReason | null): void {
    if (reason !== null) sim.events.push('commandRejected', { type, reason, tick });
  }

  /** The player can act and stands somewhere: null, else the reason. */
  private able(sim: Simulation): VaultRejectReason | null {
    const { player } = this.deps;
    if (sim.player === NULL_ENTITY || player.body(sim) === undefined || !player.position(sim, this.at)) return 'noPlayer';
    return player.incapacity(sim);
  }

  /** Whether the player stands within the use reach of tile (tx, ty) on `layer`. */
  private inReach(sim: Simulation, layer: Layer, tx: number, ty: number): boolean {
    if (this.deps.player.body(sim)?.layer !== layer) return false;
    const dx = this.at.x - (tx + 0.5) * TILE_PX;
    const dy = this.at.y - (ty + 0.5) * TILE_PX;
    const reach = V.useReachTiles * TILE_PX;
    return dx * dx + dy * dy <= reach * reach;
  }

  private enter(sim: Simulation, slot: number, tick: number): VaultRejectReason | null {
    const unable = this.able(sim);
    if (unable !== null) return unable;
    const e = this.vaults(sim).bySlot.get(slot);
    if (e === undefined) return 'unknownVault';
    const { tx, ty } = e.plan.entrance;
    if (!this.inReach(sim, SURFACE, tx, ty)) return 'outOfReach';
    const stand = standBeside(e.raster, tx, ty);
    this.deps.teleport(sim, (stand.tx + 0.5) * TILE_PX, (stand.ty + 0.5) * TILE_PX, VAULT_LAYER);
    this.arrive(sim, e, tick);
    return null;
  }

  /** The player arrived in the vault: the first time its guards rise; `vaultEntered` every time he comes down. */
  private arrive(sim: Simulation, e: VaultEntry, tick: number): void {
    const s = this.touch(e);
    const first = !s.entered;
    s.entered = true;
    if (!s.guardsRisen) {
      s.guardsRisen = true;
      this.raiseGuards(sim, e);
    }
    sim.events.push('vaultEntered', { vault: e.plan.slot, biome: e.plan.biome, erstmals: first, tick });
  }

  private leave(sim: Simulation, slot: number, tick: number): VaultRejectReason | null {
    const unable = this.able(sim);
    if (unable !== null) return unable;
    const e = this.vaults(sim).bySlot.get(slot);
    if (e === undefined) return 'unknownVault';
    const { tx, ty } = e.plan.entrance;
    if (!this.inReach(sim, VAULT_LAYER, tx, ty)) return 'outOfReach';
    // Up the stairs onto the tile south of the way down (the layout's floor in front of the stairs).
    this.deps.teleport(sim, (tx + 0.5) * TILE_PX, (ty + 1 + 0.5) * TILE_PX, SURFACE);
    sim.events.push('vaultLeft', { vault: slot, tick });
    return null;
  }

  private raiseGuards(sim: Simulation, e: VaultEntry): void {
    const owner: CreatureOwner = `gewoelbe:${e.plan.slot}`;
    for (const g of e.plan.guards) {
      this.deps.creatures.spawnOwned(sim, { creature: g.creature, layer: VAULT_LAYER, x: (g.tx + 0.5) * TILE_PX, y: (g.ty + 0.5) * TILE_PX, owner, leashTiles: V.guardLeashTiles });
    }
  }

  private guardFell(sim: Simulation, owner: CreatureOwner, creature: string, entity: Entity): void {
    if (!owner.startsWith(OWNER_PREFIX)) return;
    const e = this.vaults(sim).bySlot.get(Number(owner.slice(OWNER_PREFIX.length)));
    if (e === undefined) return;
    const s = this.touch(e);
    const guard = e.plan.guards.find((g) => g.creature === creature);
    if (guard?.boss === true) {
      s.bossDefeated = true;
      this.checkCompleted(sim, e, s, sim.eventTick);
      return;
    }
    // A mimic was a chest: its loot spills where it stood (the nearest of the vault's unopened mimic chests).
    const mimics = e.plan.chests.filter((c) => c.mimic && (s.chestsOpened & (1 << c.id)) === 0);
    if (creature !== VAULT_GUARDS.mimic || mimics.length === 0) return;
    const hasPos = this.deps.creatures.positionOf(entity, this.at);
    const near = (c: (typeof mimics)[number]): number => {
      if (!hasPos) return c.id;
      const ox = (c.tx + 0.5) * TILE_PX - this.at.x;
      const oy = (c.ty + 0.5) * TILE_PX - this.at.y;
      return ox * ox + oy * oy;
    };
    const chest = mimics.reduce((a, b) => (near(b) < near(a) ? b : a));
    this.openChest(sim, e, s, chest.id, true, sim.eventTick);
  }

  // -------------------------------------------------------------------------------------------
  // Uses
  // -------------------------------------------------------------------------------------------

  private useTile(sim: Simulation, tx: number, ty: number, tick: number): VaultRejectReason | null {
    const unable = this.able(sim);
    if (unable !== null) return unable;
    const e = this.entryAt(sim, tx, ty);
    if (e === undefined) return 'notInVault';
    if (!this.inReach(sim, VAULT_LAYER, tx, ty)) return 'outOfReach';
    const code = e.partAt.get(tileKey(tx, ty));
    if (code === undefined) return 'nothingThere';
    const s = this.touch(e);
    const index = code % KIND_STRIDE;
    switch (Math.floor(code / KIND_STRIDE)) {
      case KIND_DOOR:
        return this.useDoor(sim, e, s, index, tick);
      case KIND_PART:
        return this.usePart(sim, e, s, Math.floor(index / PART_STRIDE), index % PART_STRIDE, tick);
      case KIND_CHEST:
        return this.useChest(sim, e, s, index, tick);
      case KIND_KEY:
        return this.takeKey(sim, e, s, index, tick);
      case KIND_SHARD:
        return this.takeShard(sim, e, s, tick);
      case KIND_TABLET: {
        const t = e.plan.tablets[index];
        return t !== undefined && this.readTablet(sim, t.tablet, 'gewoelbe', e.plan.slot, tick) ? null : 'unknownTablet';
      }
      case KIND_UP:
        return this.leave(sim, e.plan.slot, tick);
      default:
        return 'nothingThere';
    }
  }

  private useDoor(sim: Simulation, e: VaultEntry, s: VaultState, door: number, tick: number): VaultRejectReason | null {
    const d = e.plan.doors[door];
    if (d === undefined || this.doorOpen(e, s, door)) return 'nothingThere';
    if (d.kind === 'raetsel') return 'puzzleClosed';
    if (d.kind === 'verborgen') {
      s.hiddenFound |= 1 << door;
      this.refreshBlock(e);
      sim.events.push('vaultHiddenFound', { vault: e.plan.slot, door, tx: d.tx, ty: d.ty, tick });
      return null;
    }
    const key = this.keySlot(e.plan.slot);
    if (key === null) return 'locked';
    const inv = this.deps.inventory;
    const used = discard(inv.state, inv.bags.catalog, key, 1);
    if (!used.ok) return 'locked';
    inv.bags.replace(used.state);
    sim.events.push('inventoryChanged', { change: 'remove', tick });
    s.doorsOpen |= 1 << door;
    this.refreshBlock(e);
    sim.events.push('vaultDoorUnlocked', { vault: e.plan.slot, door, schluessel: VAULT_KEY_ITEM, tx: d.tx, ty: d.ty, tick });
    return null;
  }

  /** The bag slot of a key of the vault in `slot`, or null. */
  private keySlot(slot: number): { bereich: (typeof CARRY_AREAS)[number]; index: number } | null {
    const state = this.deps.inventory.state;
    for (const area of CARRY_AREAS) {
      const slots = areaSlots(state, area);
      for (let i = 0; i < slots.length; i++) {
        const st = slots[i];
        if (st !== null && st !== undefined && st.item === VAULT_KEY_ITEM && st.daten?.gewoelbe === slot) return { bereich: area, index: i };
      }
    }
    return null;
  }

  private usePart(sim: Simulation, e: VaultEntry, s: VaultState, puzzle: number, part: number, tick: number): VaultRejectReason | null {
    const p = e.plan.puzzles[puzzle];
    const v = e.variants[puzzle];
    const at = p?.parts[part];
    if (p === undefined || v === undefined || at === undefined) return 'nothingThere';
    const before = puzzleCanonical(v, s.puzzles[puzzle] ?? []);
    if (at.role === 'hinweis') {
      // The bell puzzle's inscription plays its tune (solved or not: the player may want to hear it again).
      s.hint = [puzzle, tick];
      return null;
    }
    if (puzzleSolved(v, before)) return 'solved';
    if (tick < (s.puzzleReadyTick[puzzle] ?? 0)) return 'cooling';
    if (at.role === 'ruecksetzer') {
      s.puzzles[puzzle] = [...puzzleInit(v)];
      this.refreshBlock(e);
      sim.events.push('puzzleReset', { vault: e.plan.slot, puzzle, typ: v.typ, tick });
      return null;
    }
    if (at.role === 'schale') {
      const hand = this.deps.inventory.selected();
      if (hand === null || lightKindOfItem(hand.item) === undefined) return 'noTorch';
    }
    const ordinal = partOrdinal(p.parts, part);
    const after = puzzleAct(v, before, { part: ordinal, dir: 0 });
    const advanced = progress(after) > progress(before);
    s.puzzles[puzzle] = [...after];
    const ton = v.typ === 'glocken' ? (v.toene[ordinal] ?? 0) : 0;
    sim.events.push('puzzleStep', { vault: e.plan.slot, puzzle, typ: v.typ, part: ordinal, richtig: advanced, ton, tx: at.tx, ty: at.ty, tick });
    const reset = !advanced && progress(before) > 0 && progress(after) < progress(before);
    if (reset) sim.events.push('puzzleReset', { vault: e.plan.slot, puzzle, typ: v.typ, tick });
    s.puzzleReadyTick[puzzle] = tick + secondsToTicks(reset ? P.resetDelaySeconds : P.leverCooldownSeconds);
    this.refreshBlock(e);
    if (puzzleSolved(v, after)) this.solved(sim, e, s, puzzle, tick);
    return null;
  }

  /** Index of the `kisten` puzzle whose crate stands on tile (tx, ty), or −1. */
  private crateAt(e: VaultEntry, tx: number, ty: number): number {
    for (let k = 0; k < e.variants.length; k++) {
      const v = e.variants[k] as PuzzleVariantDef;
      if (v.typ !== 'kisten') continue;
      const m = kistenMap(v);
      const lx = tx - (e.kistenX[k] as number);
      const ly = ty - (e.kistenY[k] as number);
      if (lx < 0 || ly < 0 || lx >= m.w || ly >= m.h) continue;
      if (this.puzzleState(e.plan.slot, k).includes(ly * m.w + lx)) return k;
    }
    return -1;
  }

  private push(sim: Simulation, tx: number, ty: number, tick: number): VaultRejectReason | null {
    const unable = this.able(sim);
    if (unable !== null) return unable;
    const e = this.entryAt(sim, tx, ty);
    if (e === undefined) return 'notInVault';
    if (!this.inReach(sim, VAULT_LAYER, tx, ty)) return 'outOfReach';
    const k = this.crateAt(e, tx, ty);
    const v = e.variants[k];
    if (k < 0 || v === undefined || v.typ !== 'kisten') return 'nothingThere';
    const s = this.touch(e);
    const before = puzzleCanonical(v, s.puzzles[k] ?? []);
    if (puzzleSolved(v, before)) return 'solved';
    const dir = pushDirection(Math.floor(this.at.x / TILE_PX), Math.floor(this.at.y / TILE_PX), tx, ty);
    const m = kistenMap(v);
    const from = (ty - (e.kistenY[k] as number)) * m.w + (tx - (e.kistenX[k] as number));
    if (dir < 0 || !kistenCanPush(m, before, from, dir)) return 'blocked';
    const after = puzzleAct(v, before, { part: from, dir });
    s.puzzles[k] = [...after];
    const to = kistenStep(m, from, dir);
    const nx = (e.kistenX[k] as number) + (to % m.w);
    const ny = (e.kistenY[k] as number) + Math.floor(to / m.w);
    this.refreshBlock(e);
    sim.events.push('vaultCratePushed', { vault: e.plan.slot, puzzle: k, typ: v.typ, tx: nx, ty: ny, dir, platte: m.plate[to] === 1, tick });
    if (puzzleSolved(v, after)) this.solved(sim, e, s, k, tick);
    return null;
  }

  /** Debug (`vault.solve`): solves puzzle `puzzle` (−1: every unsolved one) by its rules' solver, as if the player had. */
  private debugSolve(sim: Simulation, slot: number, puzzle: number, tick: number): VaultRejectReason | null {
    const e = this.vaults(sim).bySlot.get(slot);
    if (e === undefined) return 'unknownVault';
    if (puzzle >= e.variants.length) return 'nothingThere';
    const s = this.touch(e);
    let any = false;
    for (let k = 0; k < e.variants.length; k++) {
      if (puzzle >= 0 && k !== puzzle) continue;
      const v = e.variants[k] as PuzzleVariantDef;
      if (puzzleSolved(v, puzzleCanonical(v, s.puzzles[k] ?? []))) continue;
      let state = puzzleInit(v);
      for (const a of puzzleSolve(v) ?? []) state = puzzleAct(v, state, a);
      if (!puzzleSolved(v, state)) continue;
      s.puzzles[k] = [...state];
      this.solved(sim, e, s, k, tick);
      any = true;
    }
    return any ? null : 'solved';
  }

  /** A puzzle is solved: its doors open, the player learns from it. */
  private solved(sim: Simulation, e: VaultEntry, s: VaultState, puzzle: number, tick: number): void {
    const v = e.variants[puzzle] as PuzzleVariantDef;
    sim.events.push('puzzleSolved', { vault: e.plan.slot, puzzle, typ: v.typ, tick });
    this.skills?.award(sim, PUZZLE_SOLVED_SOURCE);
    for (const d of e.plan.doors) {
      if (d.kind !== 'raetsel' || d.puzzle !== puzzle || (s.doorsOpen & (1 << d.id)) !== 0) continue;
      s.doorsOpen |= 1 << d.id;
      sim.events.push('vaultDoorOpened', { vault: e.plan.slot, door: d.id, puzzle, tx: d.tx, ty: d.ty, tick });
    }
    this.refreshBlock(e);
  }

  private useChest(sim: Simulation, e: VaultEntry, s: VaultState, chest: number, tick: number): VaultRejectReason | null {
    const c = e.plan.chests[chest];
    // A mimic is no chest to open: it is a creature (its own E is its fight).
    if (c === undefined || c.mimic || (s.chestsOpened & (1 << chest)) !== 0) return 'nothingThere';
    this.openChest(sim, e, s, chest, false, tick);
    return null;
  }

  private openChest(sim: Simulation, e: VaultEntry, s: VaultState, chest: number, mimic: boolean, tick: number): void {
    const c = e.plan.chests[chest];
    if (c === undefined) return;
    s.chestsOpened |= 1 << chest;
    if (!mimic) this.setObject(sim, c.tx, c.ty, VAULT_OPEN_CHEST_OBJECT);
    const x = (c.tx + 0.5) * TILE_PX;
    const y = (c.ty + 0.5) * TILE_PX;
    const def = CONTENT.collection('placeLoot').find(c.loot) as PlaceLootDef | undefined;
    if (def !== undefined) {
      this.loot.length = 0;
      drawPlaceLoot(def, vaultChestRng(sim.config.seed, e.plan.slot, chest), this.loot);
      for (const d of this.loot) this.spill(sim, d.item, d.count, x, y);
    }
    if (chest === e.endChest && e.blueprint !== null) this.spill(sim, e.blueprint, 1, x, y);
    sim.events.push('vaultChestOpened', { vault: e.plan.slot, chest, stufe: c.tier, mimik: mimic, tx: c.tx, ty: c.ty, tick });
    this.checkCompleted(sim, e, s, tick);
  }

  private spill(sim: Simulation, item: string, count: number, x: number, y: number): void {
    const def = this.deps.catalog.find(item);
    if (def !== undefined) this.deps.spill(sim, newStack(def, count), VAULT_LAYER, x, y);
  }

  private checkCompleted(sim: Simulation, e: VaultEntry, s: VaultState, tick: number): void {
    if (s.completed || (e.hasBoss && !s.bossDefeated)) return;
    if (e.endChest >= 0 && (s.chestsOpened & (1 << e.endChest)) === 0) return;
    s.completed = true;
    sim.events.push('vaultCompleted', { vault: e.plan.slot, biome: e.plan.biome, tick });
  }

  private takeKey(sim: Simulation, e: VaultEntry, s: VaultState, key: number, tick: number): VaultRejectReason | null {
    const k = e.plan.keys[key];
    if (k === undefined || (s.keysTaken & (1 << key)) !== 0) return 'nothingThere';
    const given = this.deps.inventory.give(sim, VAULT_KEY_ITEM, 1, { daten: { gewoelbe: e.plan.slot } });
    if (given.added < 1) return 'bagsFull';
    s.keysTaken |= 1 << key;
    this.refreshBlock(e);
    sim.events.push('vaultKeyTaken', { vault: e.plan.slot, door: k.door, tx: k.tx, ty: k.ty, tick });
    return null;
  }

  private takeShard(sim: Simulation, e: VaultEntry, s: VaultState, tick: number): VaultRejectReason | null {
    const at = e.plan.shard;
    if (at === null || s.shardTaken) return 'nothingThere';
    const given = this.deps.inventory.give(sim, VAULT_SHARD_ITEM, 1);
    if (given.added < 1) return 'bagsFull';
    s.shardTaken = true;
    this.refreshBlock(e);
    sim.events.push('vaultShardTaken', { vault: e.plan.slot, tx: at.tx, ty: at.ty, tick });
    return null;
  }

  /**
   * Reads Builder tablet `tablet` (`tabletRead`): from a vault (`ort` its slot), from a place's mark (`ort` the place's slot,
   * through `PlacesSystem.addTabletReader`) or from the console (−1). False when the content has no such tablet.
   */
  readTablet(sim: Simulation, tablet: string, quelle: 'gewoelbe' | 'ort', ort: number, tick: number): boolean {
    if (CONTENT.collection('tablets').find(tablet) === undefined) return false;
    sim.events.push('tabletRead', { tablet, quelle, ort, tick });
    return true;
  }

  /** Writes object `id` on tile (tx, ty) of layer −1 (a resident chunk: the player stands near). */
  private setObject(sim: Simulation, tx: number, ty: number, id: string): void {
    const chunk = this.deps.world.chunk(sim, VAULT_LAYER, tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT);
    if (chunk === undefined) return;
    chunk.setObject(((ty & CHUNK_MASK) << CHUNK_SHIFT) | (tx & CHUNK_MASK), this.deps.world.objectRuntimeId(id));
    this.deps.collision.invalidateTile(VAULT_LAYER, tx, ty);
  }

  // -------------------------------------------------------------------------------------------
  // The bell tune
  // -------------------------------------------------------------------------------------------

  private playHint(sim: Simulation, e: VaultEntry, s: VaultState, tick: number): void {
    if (s.hint.length < 2) return;
    const puzzle = s.hint[0] as number;
    const start = s.hint[1] as number;
    const v = e.variants[puzzle];
    const at = e.plan.puzzles[puzzle]?.parts.find((p) => p.role === 'hinweis');
    if (v === undefined || v.typ !== 'glocken' || at === undefined) {
      s.hint = [];
      return;
    }
    const spacing = secondsToTicks(P.toneSpacingSeconds, 1);
    const k = (tick - start) / spacing;
    if (k >= v.folge.length) {
      s.hint = [];
      return;
    }
    if (!Number.isInteger(k) || k < 0) return;
    const bell = v.folge[k] as number;
    sim.events.push('vaultHintPlayed', { vault: e.plan.slot, puzzle, typ: v.typ, index: k, ton: v.toene[bell] ?? 0, tx: at.tx, ty: at.ty, tick });
  }

  // -------------------------------------------------------------------------------------------
  // Traps
  // -------------------------------------------------------------------------------------------

  private runTraps(sim: Simulation, e: VaultEntry, s: VaultState, tick: number): void {
    const traps = e.plan.traps;
    for (let k = 0; k < traps.length; k++) {
      const trap = traps[k];
      const def = e.traps[k];
      if (trap === undefined || def === undefined) continue;
      const ready = s.trapReadyTick[k] ?? TRAP_READY;
      if (ready === TRAP_SPENT) continue;
      if (def.ausloeser === 'takt') {
        const beat = trapBeatTicks(def);
        const phase = trapBeatPhase(tick, e.plan.slot, k, beat);
        if (phase === 0) this.trapEvent(sim, 'vaultTrapArmed', e, k, tick);
        else if (phase === trapWarnTicks(def)) this.strike(sim, e, s, k, tick);
        continue;
      }
      const armed = s.trapArmedTick[k] ?? TRAP_READY;
      if (armed >= 0) {
        if (tick >= armed + trapWarnTicks(def)) this.strike(sim, e, s, k, tick);
        continue;
      }
      if (ready >= 0 && tick < ready) continue;
      s.trapReadyTick[k] = TRAP_READY;
      trapSenseTiles(def, trap, this.tiles);
      if (this.anyBodyOn(sim, this.tiles)) {
        s.trapArmedTick[k] = tick;
        this.trapEvent(sim, 'vaultTrapArmed', e, k, tick);
      }
    }
  }

  private trapEvent(sim: Simulation, type: 'vaultTrapArmed' | 'vaultTrapTriggered', e: VaultEntry, k: number, tick: number): void {
    const trap = e.plan.traps[k];
    if (trap === undefined) return;
    sim.events.push(type, { vault: e.plan.slot, trap: k, typ: trap.type, x: (trap.tx + 0.5) * TILE_PX, y: (trap.ty + 0.5) * TILE_PX, tick });
  }

  /** Whether the player or a creature stands on one of the tiles (tx, ty pairs). */
  private anyBodyOn(sim: Simulation, tiles: readonly number[]): boolean {
    const ptx = this.playerTileX(sim);
    const pty = Math.floor(this.at.y / TILE_PX);
    for (let i = 0; i + 1 < tiles.length; i += 2) {
      const tx = tiles[i] as number;
      const ty = tiles[i + 1] as number;
      if (tx === ptx && ty === pty) return true;
      this.found.length = 0;
      this.deps.creatures.targets.queryCircle(sim, VAULT_LAYER, (tx + 0.5) * TILE_PX, (ty + 0.5) * TILE_PX, TILE_PX / 2, this.found);
      if (this.found.length > 0) return true;
    }
    return false;
  }

  /** The player's tile column on layer −1 (refreshes `at`), or NaN elsewhere. */
  private playerTileX(sim: Simulation): number {
    if (this.deps.player.body(sim)?.layer !== VAULT_LAYER || !this.deps.player.position(sim, this.at)) return Number.NaN;
    return Math.floor(this.at.x / TILE_PX);
  }

  private strike(sim: Simulation, e: VaultEntry, s: VaultState, k: number, tick: number): void {
    const trap = e.plan.traps[k];
    const def = e.traps[k];
    if (trap === undefined || def === undefined) return;
    if (def.ausloeser !== 'takt') {
      s.trapArmedTick[k] = TRAP_READY;
      s.trapReadyTick[k] = def.bleibtOffen === true ? TRAP_SPENT : tick + trapRearmTicks(def);
    }
    this.trapEvent(sim, 'vaultTrapTriggered', e, k, tick);
    trapStrikeTiles(def, trap, this.tiles);
    const first = trapStopsAtFirst(def);
    const ptx = this.playerTileX(sim);
    const pty = Math.floor(this.at.y / TILE_PX);
    for (let i = 0; i + 1 < this.tiles.length; i += 2) {
      const tx = this.tiles[i] as number;
      const ty = this.tiles[i + 1] as number;
      let hit = false;
      if (tx === ptx && ty === pty && (this.deps.player.body(sim)?.invulnerableTicks ?? 0) === 0) {
        this.deps.damage(sim, trapPlayerDamage(def, this.deps.enemyDamage()), TRAP_CAUSE);
        hit = true;
      }
      if (this.hitCreatures(sim, def, tx, ty)) hit = true;
      if (hit && first) break;
    }
    if (def.bleibtOffen === true) this.setObject(sim, trap.tx, trap.ty, VAULT_COLLAPSED_OBJECT);
  }

  /** Hits the creatures on tile (tx, ty) with a trap; whether there were any. */
  private hitCreatures(sim: Simulation, def: VaultTrapDef, tx: number, ty: number): boolean {
    const targets = this.deps.creatures.targets;
    this.found.length = 0;
    targets.queryCircle(sim, VAULT_LAYER, (tx + 0.5) * TILE_PX, (ty + 0.5) * TILE_PX, TILE_PX / 2, this.found);
    const n = this.found.length;
    for (let i = 0; i < n; i++) {
      const c = this.found[i] as Entity;
      if (!targets.view(sim, c, this.view) || this.view.invulnerable) continue;
      const h = this.hit;
      h.attacker = NULL_ENTITY;
      h.attackerTeam = 'feind';
      h.amount = trapCreatureDamage(def, this.view.resist[def.schadensart], this.view.armor);
      h.type = def.schadensart;
      targets.applyHit(sim, c, h);
    }
    return n > 0;
  }

  // -------------------------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------------------------

  private snapshot(): VaultsSnapshot {
    return { vaults: [...this.states.values()].sort((a, b) => a.slot - b.slot).map(copyVaultState) as VaultsSnapshot['vaults'] };
  }

  private restore(data: unknown): void {
    const parsed = vaultsSnapshotSchema.safeParse(data);
    if (!parsed.success) throw new TypeError(`vaults snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    const seen = new Set<number>();
    for (const v of parsed.data.vaults) {
      if (seen.has(v.slot)) throw new TypeError(`vaults snapshot invalid: slot ${v.slot} twice`);
      seen.add(v.slot);
    }
    this.states.clear();
    for (const v of parsed.data.vaults) this.states.set(v.slot, copyVaultState(v));
    if (this.index !== null) for (const e of this.index.all) this.refreshBlock(e);
  }
}

/** The end chest's tier (§21 "Truhen nach Stufe": the end chamber holds the best). */
const TIER_END = 3;
/** What `partAtTile` reports for a crate (beside the kinds of the index). */
export const USE_CRATE = 8;
/** The kinds of `partAtTile`. */
export const VAULT_USE_KINDS = { door: KIND_DOOR, part: KIND_PART, chest: KIND_CHEST, key: KIND_KEY, shard: KIND_SHARD, tablet: KIND_TABLET, up: KIND_UP, crate: USE_CRATE } as const;
/** Index of a part in `partAtTile`: puzzle × this + part. */
export const VAULT_PART_STRIDE = PART_STRIDE;

/** Light kind and stable light ids of the fire bowls (beside the fires' 1 << 24, the bosses' 0x5000_0000, the beacons' 0x6000_0000). */
const BOWL_LIGHT_KIND = 'gewoelbe_schale';
const BOWL_LIGHT_ID_BASE = 0x4700_0000;
const BOWL_LIGHT_SLOT_MASK = 0xfff;
const BOWL_LIGHT_SLOT_SHIFT = 8;
/** Bowls per puzzle at most is 5; puzzles of a vault at most 3 (`BALANCE.vaults.puzzlesMax`) – 8 ids each leave room. */
const BOWL_LIGHT_PUZZLE_STRIDE = 8;
/** The floor runes' light kind and ids (a vault's runes number far below 2^12). */
const RUNE_LIGHT_KIND = 'gewoelbe_rune';
const RUNE_LIGHT_ID_BASE = 0x4800_0000;
const RUNE_LIGHT_SLOT_SHIFT = 12;
/** The world object of a glowing floor rune (src/content/dungeons/objekte.ts). */
const VAULT_RUNE_OBJECT = 'ort_gw_rune';

/** The rune tiles of a raster (x and y in turn). */
function runeTiles(r: VaultRaster): Int32Array {
  const out: number[] = [];
  for (let i = 0; i < r.object.length; i++) if (r.object[i] === VAULT_RUNE_OBJECT) out.push(r.x0 + (i % r.w), r.y0 + Math.floor(i / r.w));
  return Int32Array.from(out);
}

/**
 * The burning bowls of a `feuerschalen` state (`[done, lit]`, src/game/puzzles/sequence.ts) as a bit mask – 0 when the saved
 * state is no state of the rules (the canonical start then: all cold). Integer work only.
 */
function bowlsLit(folge: readonly number[], state: readonly number[] | undefined): number {
  if (state === undefined) return 0;
  const done = state[0] ?? 0;
  if (!Number.isInteger(done) || done < 0 || done > folge.length) return 0;
  let lit = 0;
  for (let k = 0; k < done; k++) lit |= 1 << (folge[k] as number);
  return (state[1] ?? 0) === lit ? lit : 0;
}

/** Progress of an encoded puzzle state: steps done, bowls lit, walls found, crates on plates (a number that grows when right). */
function progress(state: readonly number[]): number {
  return state[0] ?? 0;
}

/** The tile the player stands on beside the way up of a start room: the first free floor tile of its four neighbours (south first). */
function standBeside(r: VaultRaster, tx: number, ty: number): { tx: number; ty: number } {
  for (const [dx, dy] of STAND_ORDER) {
    const x = tx + dx - r.x0;
    const y = ty + dy - r.y0;
    if (x < 0 || y < 0 || x >= r.w || y >= r.h) continue;
    const i = y * r.w + x;
    if (r.solid[i] === 0 && r.object[i] === null) return { tx: tx + dx, ty: ty + dy };
  }
  return { tx, ty };
}
const STAND_ORDER: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
];
