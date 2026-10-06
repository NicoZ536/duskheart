/**
 * Heart and ember shards (MASTERPROMPT §20.2 "Herzsplitter (+10 max. Leben)", §21 "Glutsplitter (+5 max. Ausdauer; 12 in der
 * Welt)", §11.1 "Leben 100 (+10 je Boss-Herzsplitter)"; docs/SPIEL.md §22 "Splitter"; strand F, system `shards`, M7-32):
 * using an item with a `splitter` block (`player.useItem` through `ToolsSystem.addItemUse`) takes the piece and makes it
 * part of the player for good – a heart shard +10 maximum health (and the 10 at once), an ember shard +5 maximum stamina –,
 * as a modifier source of the player (`PlayerInfluences.addModifierSource`): equipment, conditions and shards add up.
 * `shardUsed` tells the presentation and the chronicle.
 *
 * No tick hooks. Save participant `shards` (version 1): the shards used per kind.
 */
import type { ItemDef } from '../../content/schema/item';
import type { CommandHandlers, SimSystem, Simulation } from '../sim';
import { discard } from '../inventory/ops';
import type { InventorySystem } from '../inventory/system';
import type { SaveParticipant } from '../participant';
import type { PlayerModifierSource } from '../survival/modifiers';
import type { ItemUseHandler } from '../tools/itemUses';
import { shardGain, shardHealthBonus, shardStaminaBonus } from './formulas';
import { shardsSnapshotSchema, type ShardKind, type ShardsSnapshot } from './state';
import type { ShardsApi } from './types';

/** Id of the shard system and its save participant. */
export const SHARDS_SYSTEM_ID = 'shards';
/** Data version of the `shards` participant. */
export const SHARDS_SAVE_VERSION = 1;

/** Dependencies of the shard system. */
export interface ShardsSystemDeps {
  readonly inventory: InventorySystem;
  /** Heals the player by `amount` [HP] (a heart shard fills the health it adds), when alive. */
  readonly heal: (sim: Simulation, amount: number) => void;
}

export class ShardsSystem implements SimSystem, ShardsApi {
  readonly id = SHARDS_SYSTEM_ID;
  readonly commands: CommandHandlers = {};
  readonly save: SaveParticipant;
  private herz = 0;
  private glut = 0;

  constructor(private readonly deps: ShardsSystemDeps) {
    this.save = {
      id: SHARDS_SYSTEM_ID,
      version: SHARDS_SAVE_VERSION,
      // Saves before M7 know no shards: none used.
      migrations: [{ from: 0, migrate: (): ShardsSnapshot => ({ herz: 0, glut: 0 }) }],
      serialize: (): ShardsSnapshot => ({ herz: this.herz, glut: this.glut }),
      deserialize: (data) => {
        const parsed = shardsSnapshotSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`shards snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        this.herz = parsed.data.herz;
        this.glut = parsed.data.glut;
      },
    };
  }

  used(kind: ShardKind): number {
    return kind === 'herz' ? this.herz : this.glut;
  }

  /** The shards as a modifier source of the player: maximum health and stamina of every used one. */
  modifierSource(): PlayerModifierSource {
    return (_sim, _player, out) => {
      out.maxHealthBonus += shardHealthBonus(this.herz);
      out.maxStaminaBonus += shardStaminaBonus(this.glut);
    };
  }

  /** `player.useItem` on a shard (`ToolsSystem.addItemUse`): the piece goes into the player for good. */
  itemUse(): ItemUseHandler {
    return {
      id: 'splitter',
      handles: (def: ItemDef) => def.splitter !== undefined,
      use: (sim, ctx) => {
        const kind = ctx.def.splitter?.art;
        if (kind === undefined) return 'pass';
        const inv = this.deps.inventory;
        const consumed = discard(inv.state, inv.bags.catalog, ctx.slot, 1);
        if (!consumed.ok) return { reject: consumed.reason };
        inv.bags.replace(consumed.state);
        sim.events.push('inventoryChanged', { change: 'remove', tick: sim.eventTick });
        if (kind === 'herz') this.herz++;
        else this.glut++;
        if (kind === 'herz') this.deps.heal(sim, shardGain('herz'));
        sim.events.push('shardUsed', { art: kind, gesamt: this.used(kind), item: ctx.def.id, tick: sim.eventTick });
        return 'used';
      },
    };
  }
}
