/**
 * Using items from the bags (docs/SPIEL.md §3 `player.useItem {slot}`; MASTERPROMPT §11.3, §11.4, §13.1;
 * M3-15, M3-16).
 *
 * - Food and drink are eaten or drunk: the command is handed to the actions system (`action.eat`, which
 *   also refuses what cannot be eaten now).
 * - A cure (`CURES`, src/content/items/grundlagen.ts – the bandage) ends the conditions it treats; one
 *   piece is used up. Nothing to treat: `nothingToCure`, the bandage stays.
 * - A bucket of water (`BUCKETS`, src/content/items/werkzeuge.ts) is poured out over the player: it soaks
 *   (wetness as after a swim, §11.1 "Nässe") and puts out flames (`loescht`: "Brennen", §11.3); the bucket
 *   is empty again and worn by one use (§D) – at 0 it breaks (`itemBroken`) and cannot be filled until it
 *   is repaired (§13.1). Filling it is the recipe `rezept_holzeimer_wasser` (water in reach).
 * - A light item (a torch or a camp fire, src/content/lights.ts) is set up by the light system (`light.place`,
 *   whose refusals it raises): on the aimed tile (`player.aim`) when that lies within the placing reach,
 *   else on the tile in front of the player.
 * - Anything else: `notUsable` (tools and weapons work through `player.interact`).
 * Without a slot the item in the hand is used (the selected hotbar slot) – the primary button (§26 "LMB"):
 * an empty hand or an item without a use of its own (tools, weapons, raw materials) does nothing and is not
 * refused, since the primary button of those is the swing of combat (M6) and a click must not sound an
 * error; a use from a slot (the inventory) is refused with the reason. Using is instant and raises
 * `itemUsed` (the item's `sounds.benutzen`, a splash of water) – setting up a light raises `lightPlaced`
 * instead. No state of its own, no tick hooks, no save participant.
 */
import { BALANCE } from '../../content/balance';
import { BUCKETS, type BucketPair } from '../../content/items/werkzeuge';
import { CURES } from '../../content/items/grundlagen';
import { lightKindOfItem } from '../../content/lights';
import { NULL_ENTITY } from '../../engine/ecs';
import { TILE_PX, pxToTile, type Layer } from '../../world/model/coords';
import type { ActionsSystem } from '../actions/system';
import type { ConditionsSystem } from '../conditions/system';
import { isValidRef, slotAt, withSlot } from '../inventory/bags';
import type { InventoryRejectReason } from '../inventory/events';
import type { InventorySystem } from '../inventory/system';
import type { SlotRef } from '../items/slots';
import { withCount, type ItemStack } from '../items/stack';
import type { InteractionSystem } from '../interaction/system';
import { facingUnit } from '../interaction/formulas';
import type { Facing } from '../player/state';
import type { PlayerSystem } from '../player/system';
import type { CommandHandler, CommandHandlers, SimSystem, Simulation } from '../sim';
import { SWIMMING_WETNESS } from '../survival/formulas';
import type { CommandOfType } from '../commands';
import type { ToolRejectReason } from './events';
import { curable, pouredBucket } from './formulas';

/** Id of the item-use system. */
export const TOOLS_SYSTEM_ID = 'tools';

/** Placing reach of lights [px] (the light system refuses targets beyond it). */
const PLACE_REACH_PX = BALANCE.light.placement.reachTiles * TILE_PX;

/** Dependencies of the item-use system. */
export interface ToolsSystemDeps {
  readonly player: PlayerSystem;
  readonly inventory: InventorySystem;
  /** The aimed point (`player.aim`) for setting up lights; without it lights go on the tile ahead. */
  readonly interaction?: Pick<InteractionSystem, 'aimPoint'>;
}

/** The light system as far as using an item sets up lights (bound after it exists). */
export interface ToolsLight {
  readonly commands: CommandHandlers;
}

/** The life systems the item use acts through (bound after they exist). */
export interface ToolsLife {
  readonly conditions: ConditionsSystem;
  readonly actions: Pick<ActionsSystem, 'commands'>;
}

type Refusal = ToolRejectReason | InventoryRejectReason | null;

export class ToolsSystem implements SimSystem {
  readonly id = TOOLS_SYSTEM_ID;
  readonly commands: CommandHandlers;

  private readonly player: PlayerSystem;
  private readonly inventory: InventorySystem;
  private readonly interaction: Pick<InteractionSystem, 'aimPoint'> | null;
  private conditions: ConditionsSystem | null = null;
  private eat: CommandHandler<'action.eat'> | null = null;
  private place: CommandHandler<'light.place'> | null = null;
  private readonly at = { x: 0, y: 0 };
  private readonly ahead = { x: 0, y: 0 };

  constructor(deps: ToolsSystemDeps) {
    this.player = deps.player;
    this.inventory = deps.inventory;
    this.interaction = deps.interaction ?? null;
    const catalog = deps.inventory.bags.catalog;
    for (const b of BUCKETS) {
      if (catalog.find(b.empty)?.werkzeug?.art !== 'eimer' || catalog.find(b.full)?.werkzeug?.art !== 'eimer') throw new Error(`ToolsSystem: bucket ${b.empty}/${b.full} is no pair of buckets in the item catalog`);
    }
    this.commands = {
      'player.useItem': (sim, cmd, tick) => {
        const reason = this.use(sim, cmd, tick);
        if (reason !== null) sim.events.push('commandRejected', { type: cmd.type, reason, tick });
      },
    };
  }

  /** Binds the life systems: conditions (cures, flames) and actions (eating). */
  useLife(life: ToolsLife): void {
    const eat = life.actions.commands['action.eat'];
    if (eat === undefined) throw new Error('ToolsSystem: the actions system handles no action.eat');
    this.conditions = life.conditions;
    this.eat = eat;
  }

  /** Binds the light system: light items are set up through its `light.place`. */
  useLight(light: ToolsLight): void {
    const place = light.commands['light.place'];
    if (place === undefined) throw new Error('ToolsSystem: the light system handles no light.place');
    this.place = place;
  }

  private use(sim: Simulation, cmd: CommandOfType<'player.useItem'>, tick: number): Refusal {
    const body = this.player.body(sim);
    if (sim.player === NULL_ENTITY || body === undefined || !this.player.position(sim, this.at)) return 'noPlayer';
    // Dead or asleep (§11.5, §11.6): nothing is used.
    const unable = this.player.incapacity(sim);
    if (unable !== null) return unable;
    const state = this.inventory.state;
    const ref: SlotRef = cmd.slot ?? { bereich: 'schnellleiste', index: state.auswahl };
    if (!isValidRef(state, ref)) return 'invalidSlot';
    const primary = cmd.slot === undefined;
    const stack = slotAt(state, ref);
    if (stack === null) return primary ? null : 'slotEmpty';
    const def = this.inventory.bags.catalog.get(stack.item);
    if (def.essbar !== undefined) {
      this.requireLife().eat(sim, { type: 'action.eat', from: ref }, tick);
      return null;
    }
    const cures = CURES[def.id];
    if (cures !== undefined) return this.cure(sim, ref, stack, cures, body.layer, tick);
    const bucket = BUCKETS.find((b) => b.full === def.id);
    if (bucket !== undefined) return this.pour(sim, ref, stack, bucket, body.layer, tick);
    if (lightKindOfItem(def.id) !== undefined) return this.setUp(sim, ref, body.facing, tick);
    return primary ? null : 'notUsable';
  }

  /** Sets the light item of `ref` up on the aimed tile in reach, else on the tile ahead (the light system decides and refuses). */
  private setUp(sim: Simulation, ref: SlotRef, facing: Facing, tick: number): Refusal {
    const place = this.place;
    if (place === null) throw new Error('ToolsSystem: the light system is not bound (useLight)');
    const aim = this.interaction === null ? null : this.interaction.aimPoint;
    let x: number;
    let y: number;
    if (aim !== null && (aim.x - this.at.x) ** 2 + (aim.y - this.at.y) ** 2 <= PLACE_REACH_PX * PLACE_REACH_PX) {
      x = aim.x;
      y = aim.y;
    } else {
      facingUnit(facing, this.ahead);
      x = this.at.x + this.ahead.x * TILE_PX;
      y = this.at.y + this.ahead.y * TILE_PX;
    }
    place(sim, { type: 'light.place', from: { ...ref }, tx: pxToTile(x), ty: pxToTile(y) }, tick);
    return null;
  }

  /** Ends the conditions the item treats and uses up one piece. */
  private cure(sim: Simulation, ref: SlotRef, stack: ItemStack, cures: readonly string[], layer: Layer, tick: number): Refusal {
    const conditions = this.requireLife().conditions;
    const active = curable(cures, (id) => conditions.has(id));
    if (active.length === 0) return 'nothingToCure';
    for (const id of active) conditions.cure(sim, id);
    this.inventory.bags.replace(withSlot(this.inventory.state, ref, stack.count > 1 ? withCount(stack, stack.count - 1) : null));
    sim.events.push('inventoryChanged', { change: 'remove', tick });
    sim.events.push('itemUsed', { item: stack.item, from: { ...ref }, use: 'heilen', cured: active, layer, x: this.at.x, y: this.at.y, tick });
    return null;
  }

  /** Pours the bucket out over the player: soaked, flames out, the bucket empty and worn by one use. */
  private pour(sim: Simulation, ref: SlotRef, stack: ItemStack, bucket: BucketPair, layer: Layer, tick: number): Refusal {
    if (stack.haltbarkeit === 0) return 'notUsable';
    const conditions = this.requireLife().conditions;
    const empty = pouredBucket(stack, this.inventory.bags.catalog.get(bucket.empty));
    this.inventory.bags.replace(withSlot(this.inventory.state, ref, empty));
    sim.events.push('inventoryChanged', { change: 'remove', tick });
    if (empty.haltbarkeit === 0) sim.events.push('itemBroken', { at: { ...ref }, item: empty.item, tick });
    const vitals = this.player.vitalsOf(sim.player);
    if (vitals !== undefined) vitals.wetness = SWIMMING_WETNESS;
    const cured = curable(bucket.loescht, (id) => conditions.has(id));
    for (const id of cured) conditions.cure(sim, id);
    sim.events.push('itemUsed', { item: stack.item, from: { ...ref }, use: 'ausgiessen', cured, layer, x: this.at.x, y: this.at.y, tick });
    return null;
  }

  private requireLife(): { conditions: ConditionsSystem; eat: CommandHandler<'action.eat'> } {
    if (this.conditions === null || this.eat === null) throw new Error('ToolsSystem: the life systems are not bound (useLife)');
    return { conditions: this.conditions, eat: this.eat };
  }
}
