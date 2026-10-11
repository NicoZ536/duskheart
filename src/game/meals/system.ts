/**
 * Meals (MASTERPROMPT §18 "Mahlzeit-Effekte: höchstens 2 verschiedene gleichzeitig … Überdruss … Wohlfühlessen", §11.3
 * "Mahlzeit- und Trankeffekte", §12.3; docs/SPIEL.md §17 "ActionsSystem addEatHook", §21; M7-26, M7-28; system `meals`, place
 * 37 of `SYSTEM_ORDER`).
 *
 * Eating stays `action.eat` of the actions system; this system is its eat hook (`eatHook`, src/game/actions/hooks.ts):
 * - **before** a piece acts (`nutrition`): boredom halves it, a kitchen's dish (`daten.kueche`) gives 10 % more, salt takes
 *   thirst, comfort food and the dining hall calm (src/game/meals/formulas.ts);
 * - **after** it acted (`eaten`): the meal's conditions (group `mahlzeit`, at most two at once – `ConditionsSystem.addGroupLimit`,
 *   the oldest gives way), a potion's conditions, cures and instant health and stamina, raw meat's 30 % food poisoning (the
 *   stream `meals`), the dish's boredom counter +1, and `mealEaten`.
 * - **Salve** (`itemUse`): a medicine with a `trank` block and no `essbar` is applied from the bags (`player.useItem`, like the
 *   bandage): it cures and gives its conditions, one piece is used up (`itemUsed`, use `heilen`).
 * - **Dawn** (`dailyTick`): every counter falls by 1,5 (§18 "klingt über 2 Tage ab").
 * Global (the player's stomach). Save participant `meals` (version 1): the boredom counters.
 */
import { BALANCE } from '../../content/balance';
import type { ItemDef } from '../../content/schema/item';
import { NULL_ENTITY } from '../../engine/ecs';
import type { EatContext, EatHook, Nutrition } from '../actions/hooks';
import type { ConditionsSystem } from '../conditions/system';
import type { FearSystem } from '../fear/system';
import { withSlot } from '../inventory/bags';
import type { InventorySystem } from '../inventory/system';
import { withCount } from '../items/stack';
import type { SaveParticipant } from '../participant';
import type { PlayerComponents } from '../player/components';
import type { PlayerSystem } from '../player/system';
import type { SimSystem, Simulation } from '../sim';
import type { ItemUseContext, ItemUseHandler, ItemUseOutcome } from '../tools/itemUses';
import { bored, comfortOf, countsForBoredom, decayedBoredom, effectSeconds, fromKitchen, isRawMeat, mealNutrition } from './formulas';
import { mealsSnapshotSchema } from './state';
import type { MealsApi } from './types';

/** Id of the meals system and its save participant. */
export const MEALS_SYSTEM_ID = 'meals';
/** Data version of the `meals` participant. */
export const MEALS_SAVE_VERSION = 1;
/** Random stream of raw meat's food poisoning (docs/SPIEL.md §28 "`meals` (roh)"). */
export const MEALS_RNG_STREAM = 'meals';
/** The condition raw meat may give (src/content/conditions.ts). */
export const FOOD_POISONING = 'lebensmittelvergiftung';

const M = BALANCE.meals;

/** Where the player eats: whether the room around it is a dining hall (§16.4 "Speisesaal"). */
export type DiningHallCheck = (sim: Simulation) => boolean;

/** The player's life as the meals system needs it (`useLife`: the life systems come last in the order, src/game/setup.ts). */
export interface MealsLife {
  readonly conditions: ConditionsSystem;
  readonly fear: FearSystem;
}

/** Dependencies of the meals system. */
export interface MealsSystemDeps {
  readonly components: PlayerComponents;
  readonly inventory: InventorySystem;
  readonly player: PlayerSystem;
  /** Default: never a dining hall (tests without rooms). */
  readonly diningHall?: DiningHallCheck;
}

export class MealsSystem implements SimSystem, MealsApi {
  readonly id = MEALS_SYSTEM_ID;
  readonly timeScope = 'global';
  readonly save: SaveParticipant;
  /** The eat hook the actions system calls (`ActionsSystem.addEatHook`). */
  readonly eatHook: EatHook;
  private life: MealsLife | null = null;
  private readonly components: PlayerComponents;
  private readonly inventory: InventorySystem;
  private readonly player: PlayerSystem;
  private readonly diningHall: DiningHallCheck;
  /** Boredom counter by dish [pieces]. */
  private readonly counters = new Map<string, number>();
  /** What `nutrition` found for the piece `eaten` finishes (the same piece, one call after the other). */
  private pieceBored = false;
  private pieceKitchen = false;
  private readonly at = { x: 0, y: 0 };

  constructor(deps: MealsSystemDeps) {
    this.components = deps.components;
    this.inventory = deps.inventory;
    this.player = deps.player;
    this.diningHall = deps.diningHall ?? (() => false);
    this.eatHook = {
      nutrition: (sim, ctx, out) => this.nutrition(sim, ctx, out),
      eaten: (sim, ctx) => this.eaten(sim, ctx),
    };
    this.save = {
      id: MEALS_SYSTEM_ID,
      version: MEALS_SAVE_VERSION,
      // Saves from before the kitchen (versions 1–3) know no boredom.
      migrations: [{ from: 0, migrate: () => ({ ueberdruss: [] }) }],
      serialize: () => ({ ueberdruss: [...this.counters.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) }),
      deserialize: (data) => {
        const parsed = mealsSnapshotSchema.safeParse(data);
        if (!parsed.success) throw new TypeError(`meals snapshot invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        const catalog = this.inventory.bags.catalog;
        let last = '';
        for (const [item, n] of parsed.data.ueberdruss) {
          if (!catalog.has(item)) throw new TypeError(`meals snapshot invalid: unknown dish "${item}"`);
          if (item <= last) throw new TypeError('meals snapshot invalid: dishes must be unique and in ascending order');
          if (n * 2 !== Math.floor(n * 2)) throw new TypeError(`meals snapshot invalid: the counter of "${item}" is no multiple of 0.5`);
          last = item;
        }
        this.counters.clear();
        for (const [item, n] of parsed.data.ueberdruss) this.counters.set(item, n);
      },
    };
  }

  /** Connects the conditions and the fear (before the first meal; src/game/setup.ts). */
  useLife(life: MealsLife): void {
    this.life = life;
  }

  private get conditions(): ConditionsSystem {
    if (this.life === null) throw new Error('MealsSystem: useLife was not called');
    return this.life.conditions;
  }

  private get fear(): FearSystem {
    if (this.life === null) throw new Error('MealsSystem: useLife was not called');
    return this.life.fear;
  }

  // -------------------------------------------------------------------------------------------
  // MealsApi
  // -------------------------------------------------------------------------------------------

  /** Boredom counter of a dish [pieces] (≥ 2 before eating ⇒ −50 % nutrition). */
  boredom(item: string): number {
    return this.counters.get(item) ?? 0;
  }

  /** The comfort the next piece of `item` gives [fear points] (tooltips; without kitchen and dining hall). */
  comfortOf(item: string): number {
    const def = this.inventory.bags.catalog.find(item);
    return def === undefined ? 0 : comfortOf(def);
  }

  /** The dishes with a boredom counter, in item order (the presentation's sample; allocates). */
  boredDishes(): [string, number][] {
    return [...this.counters.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  // -------------------------------------------------------------------------------------------
  // Ticks
  // -------------------------------------------------------------------------------------------

  /** The dawn: every boredom counter fades by 1,5; faded ones are forgotten. */
  dailyTick(): void {
    for (const [item, n] of this.counters) {
      const next = decayedBoredom(n);
      if (next > 0) this.counters.set(item, next);
      else this.counters.delete(item);
    }
  }

  // -------------------------------------------------------------------------------------------
  // The eat hook
  // -------------------------------------------------------------------------------------------

  private nutrition(sim: Simulation, ctx: EatContext, out: Nutrition): void {
    const def = ctx.def;
    this.pieceBored = countsForBoredom(def) && bored(this.boredom(ctx.item));
    this.pieceKitchen = fromKitchen(ctx.stack);
    mealNutrition(def, this.pieceBored, this.pieceKitchen, this.diningHall(sim), out);
  }

  private eaten(sim: Simulation, ctx: EatContext): void {
    const def = ctx.def;
    const kitchen = this.pieceKitchen;
    const effects: string[] = [];
    this.act(sim, def, kitchen, effects);
    let raw = false;
    if (isRawMeat(ctx.item) && sim.rng.stream(MEALS_RNG_STREAM).next() < M.rawMeatPoison) {
      raw = true;
      this.conditions.apply(sim, FOOD_POISONING);
    }
    if (countsForBoredom(def)) this.counters.set(ctx.item, this.boredom(ctx.item) + M.boredom.perPiece);
    sim.events.push('mealEaten', { item: ctx.item, effekte: effects, ueberdruss: this.pieceBored ? 1 - M.boredom.factor : 0, kueche: kitchen, roh: raw, tick: sim.eventTick });
    this.pieceBored = false;
    this.pieceKitchen = false;
  }

  /** The conditions, cures and instant effects of a meal or potion `def` (`effects` collects the conditions given). */
  private act(sim: Simulation, def: ItemDef, kitchen: boolean, effects: string[]): void {
    const meal = def.mahlzeit;
    if (meal !== undefined) {
      for (const z of meal.zustaende) {
        if (this.conditions.apply(sim, z.id, effectSeconds(z.sekunden, kitchen)).ok) effects.push(z.id);
      }
    }
    const potion = def.trank;
    if (potion === undefined) return;
    for (const id of potion.heilt) if (this.conditions.has(id)) this.conditions.cure(sim, id);
    for (const z of potion.gibt) {
      if (this.conditions.apply(sim, z.id, effectSeconds(z.sekunden, kitchen)).ok) effects.push(z.id);
    }
    const now = potion.sofort;
    if (now === undefined) return;
    const v = sim.player === NULL_ENTITY ? undefined : this.components.vitals.get(sim.player);
    if (v === undefined) return;
    if (now.leben !== undefined) v.health = Math.min(v.maxHealth, Math.max(0, v.health + now.leben));
    if (now.ausdauer !== undefined) v.stamina = Math.min(v.maxStamina, Math.max(0, v.stamina + now.ausdauer));
    if (now.furcht !== undefined && now.furcht > 0) this.fear.spike(sim, now.furcht, 'nahrung');
  }

  // -------------------------------------------------------------------------------------------
  // The salve: medicine applied from the bags
  // -------------------------------------------------------------------------------------------

  /** The item use of medicine without `essbar` (the salve, `player.useItem` like the bandage). */
  itemUse(): ItemUseHandler {
    return {
      id: 'heilmittel',
      handles: (def) => def.trank !== undefined && def.essbar === undefined,
      use: (sim, ctx) => this.apply(sim, ctx),
    };
  }

  private apply(sim: Simulation, ctx: ItemUseContext): ItemUseOutcome {
    const potion = ctx.def.trank;
    if (potion === undefined) return 'pass';
    const cured = potion.heilt.filter((id) => this.conditions.has(id));
    // A salve without a wound to dress and nothing to give does nothing: it stays in the bags (like the bandage).
    if (cured.length === 0 && potion.gibt.length === 0 && potion.sofort === undefined) return { reject: 'nothingToCure' };
    const effects: string[] = [];
    this.act(sim, ctx.def, fromKitchen(ctx.stack), effects);
    const stack = ctx.stack;
    this.inventory.bags.replace(withSlot(this.inventory.state, ctx.slot, stack.count > 1 ? withCount(stack, stack.count - 1) : null));
    sim.events.push('inventoryChanged', { change: 'remove', tick: ctx.tick });
    const body = this.player.body(sim);
    const layer = body?.layer ?? 0;
    if (!this.player.position(sim, this.at)) return 'used';
    sim.events.push('itemUsed', { item: stack.item, from: { bereich: ctx.slot.bereich, index: ctx.slot.index }, use: 'heilen', cured, layer, x: this.at.x, y: this.at.y, tick: ctx.tick });
    return 'used';
  }
}
