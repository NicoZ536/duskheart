/**
 * Test support for the vault tests (gewoelbe-laufzeit, fallen-gewoelbe, belohnungen, forschung, the roundtrip of `vaults`;
 * strand C, M7-10 … M7-18): the creature test world of kreatur-testwelt.ts (hand-drawn meadow, player, bags, combat, the
 * player's life, the content's creatures) plus the vaults system wired as in `createSimulation`, on a `VaultWorld` with one vault
 * the test plans with the generator (`planVault`, the content's Grünhain tileset) at a fixed entrance and stamps into the drawn
 * chunks of layer −1 (`stampVault`, the chunk generator's job in the game). The entrance's stairs stand on the meadow.
 *
 * `options.plan` may change the planned vault before it is used (other traps, say): plans are plain data.
 */
import { NULL_ENTITY } from '../../../src/engine/ecs';
import type { ItemStack } from '../../../src/game/items/stack';
import type { Simulation } from '../../../src/game/sim';
import { VaultsSystem, type VaultWorld } from '../../../src/game/vaults/system';
import { planVault, stampVault, tilesetOfBiome, vaultGraphParams, VAULT_STAIRS_DOWN_OBJECT } from '../../../src/world/gen/vaults/index';
import type { VaultPlan } from '../../../src/world/gen/vaults/types';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { CHUNK_SHIFT, TILE_PX, type Layer } from '../../../src/world/model/coords';
import { contentWorldIdTables } from '../../../src/world/model/runtimeIds';
import { kreaturWelt, meadow, OFFSET, type KreaturWelt } from './kreatur-testwelt';

/** The vault's slot id and its entrance (map tile of the drawn meadow; the box reaches 40 tiles around it). */
export const VAULT_SLOT = 7;
export const ENTRANCE = { x: 60, y: 60 } as const;

/** A drop the vaults handed to the drop system. */
export interface Spilled {
  readonly stack: ItemStack;
  readonly layer: number;
  readonly x: number;
  readonly y: number;
}

export interface GewoelbeWelt extends KreaturWelt {
  readonly vaults: VaultsSystem;
  readonly plan: VaultPlan;
  readonly spilledVault: Spilled[];
  /** Puts the player on world tile (tx, ty) of `layer` (one tick); returns its events. */
  goToTile(tx: number, ty: number, layer?: number): Map<string, unknown[]>;
  /** Puts the player beside tile (tx, ty) of layer −1 (the first free neighbour) and runs `command` on it. */
  useAt(tx: number, ty: number, type?: 'vault.use' | 'vault.push'): Map<string, unknown[]>;
  /** The object id on world tile (tx, ty) of `layer`. */
  objectAt(tx: number, ty: number, layer?: number): string | null;
  /** The `commandRejected` reasons of an event map. */
  rejections(events: Map<string, unknown[]>): string[];
}

/** Plans the test vault: every puzzle type (5), the given seed. */
export function testVaultPlan(seed = 11, puzzleTypes = 5): VaultPlan {
  const tileset = tilesetOfBiome('gruenhain');
  if (tileset === undefined) throw new Error('no Grünhain tileset');
  const variants = new Map(CONTENT.collection('puzzleTypes').values().flatMap((t) => t.varianten.map((v) => [v.id, v] as const)));
  const V = BALANCE.vaults;
  const plan = planVault({
    seed,
    slot: VAULT_SLOT,
    biome: 'gruenhain',
    entrance: { tx: OFFSET + ENTRANCE.x, ty: OFFSET + ENTRANCE.y },
    params: vaultGraphParams(puzzleTypes, [{ id: 'tafel_01' }], true),
    tileset,
    boxTiles: V.boxTiles,
    gridCells: V.gridCells,
    embedTries: V.embedTries,
    graphAttempts: 4,
    variant: (id) => variants.get(id),
  });
  if (plan === null) throw new Error(`no vault plan for seed ${seed}`);
  return plan;
}

/** A vault test world: the meadow around the entrance, the vault below it, the player at `spawnAt` on the surface. */
export function gewoelbeWelt(options: { seed?: number; puzzleTypes?: number; plan?: (p: VaultPlan) => VaultPlan; spawnAt?: { x: number; y: number }; worldSeed?: number } = {}): GewoelbeWelt {
  const spawnAt = options.spawnAt ?? { x: ENTRANCE.x, y: ENTRANCE.y + 2 };
  const k = kreaturWelt(meadow(ENTRANCE.x + 20, ENTRANCE.y + 20), spawnAt, options.worldSeed ?? 1, 'inhalt');
  const base = testVaultPlan(options.seed ?? 11, options.puzzleTypes);
  const plan = options.plan === undefined ? base : options.plan(base);
  const ids = contentWorldIdTables();
  // Layer −1: the box stamped into the drawn chunks; the surface: the stairs down at the entrance.
  const box = plan.box;
  for (let cy = box.y0 >> CHUNK_SHIFT; cy <= (box.y0 + box.h - 1) >> CHUNK_SHIFT; cy++) {
    for (let cx = box.x0 >> CHUNK_SHIFT; cx <= (box.x0 + box.w - 1) >> CHUNK_SHIFT; cx++) {
      const chunk = k.chunks.get(-1, cx, cy);
      if (chunk !== undefined) stampVault(chunk, plan);
    }
  }
  const top = k.chunks.at(plan.entrance.tx, plan.entrance.ty);
  top.chunk.object[top.i] = ids.objects.runtimeId(VAULT_STAIRS_DOWN_OBJECT);
  const world: VaultWorld = {
    vaults: () => [plan],
    chunk: (_s, layer, cx, cy) => k.chunks.get(layer, cx, cy),
    objectRuntimeId: (id) => ids.objects.runtimeId(id),
  };
  const spilledVault: Spilled[] = [];
  const teleport = k.player.commands['player.teleport'];
  if (teleport === undefined) throw new Error('no player.teleport');
  const vaults = k.sim.addSystem(
    new VaultsSystem(k.sim, {
      player: k.player,
      creatures: k.creatures,
      collision: k.collision,
      inventory: k.inventory,
      catalog: k.inventory.bags.catalog,
      spill: (_s: Simulation, stack: ItemStack, layer, x: number, y: number) => {
        spilledVault.push({ stack, layer, x, y });
        return NULL_ENTITY;
      },
      teleport: (s, x, y, layer) => teleport(s, { type: 'player.teleport', x, y, layer }, s.eventTick),
      damage: (s, amount, cause) => k.vitals.damage(s, amount, cause),
      enemyDamage: () => 1,
      world,
    }),
  );
  k.collision.addOverlay(vaults.collisionOverlay());
  vaults.useSkills(k.life.skills);
  const w: GewoelbeWelt = Object.assign(k, {
    vaults,
    plan,
    spilledVault,
    goToTile(tx: number, ty: number, layer = -1): Map<string, unknown[]> {
      return k.run(1, [{ type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty + 0.5) * TILE_PX, layer }]);
    },
    useAt(tx: number, ty: number, type: 'vault.use' | 'vault.push' = 'vault.use'): Map<string, unknown[]> {
      const free = [
        [0, 1],
        [1, 0],
        [-1, 0],
        [0, -1],
      ].find(([dx, dy]) => !vaults.blocks(-1, tx + (dx as number), ty + (dy as number)) && solidAt(tx + (dx as number), ty + (dy as number)) === 0);
      const [dx, dy] = (free ?? [0, 1]) as [number, number];
      w.goToTile(tx + dx, ty + dy);
      return k.run(1, [{ type, tx, ty }]);
    },
    objectAt(tx: number, ty: number, layer = -1): string | null {
      const { chunk, i } = k.chunks.at(tx, ty, layer as Layer);
      const id = chunk.object[i] as number;
      return id === 0 ? null : ids.objects.stringId(id);
    },
    rejections(events: Map<string, unknown[]>): string[] {
      return ((events.get('commandRejected') ?? []) as { reason: string }[]).map((e) => e.reason);
    },
  });
  function solidAt(tx: number, ty: number): number {
    const { chunk, i } = k.chunks.at(tx, ty, -1);
    return (chunk.solid[i] as number) + (chunk.object[i] === 0 ? 0 : 1);
  }
  return w;
}
