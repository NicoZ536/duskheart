/**
 * Pure rules of the stations (MASTERPROMPT §15.1 "Verarbeitungsstationen … haben Eingang, Brennstoff und
 * Ausgang, laufen zeitbasiert und holen in entladenen Chunks per Zeitstempel auf", §15.4 "Brennwerte";
 * docs/ARCHITEKTUR.md "Aufholen": "Stationen verarbeiten min(Eingang, Brennstoff, Dauer / Takt) Chargen und
 * behalten den Restfortschritt"; M4-04). Unit-tested in tests/unit/game/verarbeitung-aufholen.test.ts and
 * stationen.test.ts.
 *
 * **A batch** (`advanceProcessing`): the first recipe of the station (book order, every stage of its line up
 * to its own) whose ingredients lie in the input slots and whose product fits into the output slots starts;
 * it takes the recipe's time divided by the station's tempo. A station with a fuel slot works only while a
 * fuel piece glows: when the heat runs out while a batch needs it, the next piece of the fuel slot is lit –
 * its burn value (§15.4) divided by the station's burn rate gives the heat in ticks of work. Fuel burns only
 * while the station works (an idle oven keeps its glow). A finished batch consumes its ingredients from the
 * input slots (first slot first) and puts its product into the output slots; the next batch starts at once.
 *
 * The advance is event-driven – it jumps from batch end to fuel change to the end of the span – so one call
 * over n ticks gives exactly the state of n calls over one tick each (the active zone advances every tick,
 * a frozen chunk catches up in one call; a → c ≡ a → b → c). All arithmetic is on whole ticks.
 */
import { BALANCE } from '../../content/balance';
import type { StationFuelBalance } from '../../content/balance/stations';
import type { RecipeDef } from '../../content/recipes/schema';
import type { ItemDef } from '../../content/schema/item';
import { CHUNK_SHIFT, TILE_PX } from '../../world/model/coords';
import type { ResolvedIngredient } from '../crafting/recipes';
import { canStack, joinedStack, withCount, type ItemStack } from '../items/stack';
import type { PlacedStation, ProcessingState, StationStopReason } from './state';

const TICK_HZ = BALANCE.time.tickHz;

/** One recipe a processing station runs, resolved. */
export interface ProcessRecipe {
  readonly recipe: RecipeDef;
  readonly ingredients: readonly ResolvedIngredient[];
  /** Ticks of one batch at this station (its tempo applied). */
  readonly ticks: number;
  /** The product of one batch. */
  readonly product: ItemStack;
}

/** What a processing station works with. */
export interface ProcessingContext {
  /** The recipes it runs, in book order. */
  readonly recipes: readonly ProcessRecipe[];
  /** Heat one piece of fuel `item` gives [ticks of work]; `null` for a station without a fuel slot. */
  readonly heat: ((item: string) => number) | null;
  /** Stack size of `item` [pieces]. */
  readonly stackSize: (item: string) => number;
}

/** What happened in an advance (only reported for ticking stations; catching up is silent). */
export interface ProcessingListener {
  started(recipe: string, ticks: number): void;
  produced(recipe: string, product: ItemStack): void;
  stopped(reason: StationStopReason): void;
}

/** Ticks of one batch of `seconds` at a station of `tempo` [ticks ≥ 1]. */
export function batchTicks(seconds: number, tempo: number, tickHz: number = TICK_HZ): number {
  return Math.max(1, Math.ceil((seconds * tickHz) / tempo));
}

/**
 * Heat of one fuel piece [ticks of work ≥ 1]: its burn value (§15.4) at the station's burn rate – a log (45 s)
 * keeps the charcoal kiln (rate 0,25) working three minutes.
 */
export function fuelHeatTicks(burnSeconds: number, burnRate: number, tickHz: number = TICK_HZ): number {
  return Math.max(1, Math.round((burnSeconds * tickHz) / burnRate));
}

/** Whether an item with burn value `burnSeconds` (undefined = no fuel) may go into the fuel slot of a station with `rules`. */
export function acceptsFuel(rules: StationFuelBalance, burnSeconds: number | undefined): boolean {
  return burnSeconds !== undefined && burnSeconds >= rules.minBurnSeconds;
}

/** Pieces of the items `items` in `slots` [pieces]. */
export function slotCount(slots: readonly (ItemStack | null)[], items: readonly string[]): number {
  let n = 0;
  for (const s of slots) if (s !== null && items.includes(s.item)) n += s.count;
  return n;
}

/** Whether the input slots hold every ingredient of one batch. */
export function inputsHold(slots: readonly (ItemStack | null)[], ingredients: readonly ResolvedIngredient[]): boolean {
  return ingredients.every((z) => slotCount(slots, z.items) >= z.anzahl);
}

/** Pieces of `stack` the slots take [pieces]: joining stacks first, then empty slots. */
export function roomIn(slots: readonly (ItemStack | null)[], stack: ItemStack, stackSize: number): number {
  let room = 0;
  for (const s of slots) {
    if (s === null) room += stackSize;
    else if (canStack(s, stack)) room += Math.max(0, stackSize - s.count);
  }
  return room;
}

/**
 * Puts up to `stack.count` pieces into `slots` (joining stacks first, then empty slots, in slot order); returns
 * the pieces that did not fit.
 */
export function addToSlots(slots: (ItemStack | null)[], stack: ItemStack, stackSize: number): number {
  let rest = stack.count;
  for (let i = 0; i < slots.length && rest > 0; i++) {
    const s = slots[i] ?? null;
    if (s === null || !canStack(s, stack) || s.count >= stackSize) continue;
    const n = Math.min(rest, stackSize - s.count);
    slots[i] = joinedStack(s, stack, n);
    rest -= n;
  }
  for (let i = 0; i < slots.length && rest > 0; i++) {
    if (slots[i] !== null) continue;
    const n = Math.min(rest, stackSize);
    slots[i] = withCount(stack, n);
    rest -= n;
  }
  return rest;
}

/** Removes the ingredients of one batch from the input slots (first slot first); the caller checked they are there. */
export function consumeInputs(slots: (ItemStack | null)[], ingredients: readonly ResolvedIngredient[]): void {
  for (const z of ingredients) {
    let need = z.anzahl;
    for (let i = 0; i < slots.length && need > 0; i++) {
      const s = slots[i] ?? null;
      if (s === null || !z.items.includes(s.item)) continue;
      const n = Math.min(need, s.count);
      slots[i] = s.count > n ? withCount(s, s.count - n) : null;
      need -= n;
    }
    if (need > 0) throw new RangeError(`input slots lack ${need} × "${z.key}"`);
  }
}

/** The first recipe that can start now, or why none can: nothing matches (`eingang`) or the output is full (`ausgang`). */
export function matchBatch(p: ProcessingState, ctx: ProcessingContext): ProcessRecipe | StationStopReason {
  let full = false;
  for (const r of ctx.recipes) {
    if (!inputsHold(p.eingang, r.ingredients)) continue;
    if (roomIn(p.ausgang, r.product, ctx.stackSize(r.product.item)) >= r.product.count) return r;
    full = true;
  }
  return full ? 'ausgang' : 'eingang';
}

/** The recipe of the batch in progress, looked up in the context. */
function current(p: ProcessingState, ctx: ProcessingContext): ProcessRecipe | undefined {
  return p.rezept === null ? undefined : ctx.recipes.find((r) => r.recipe.id === p.rezept);
}

/** Drops the batch in progress (its progress is lost). */
export function resetBatch(p: ProcessingState): void {
  p.rezept = null;
  p.fortschritt = 0;
  p.dauer = 0;
}

/**
 * After the player changed the slots: a batch whose ingredients are no longer all in the input slots is
 * dropped (its progress is lost, nothing was consumed yet). Returns whether it was dropped.
 */
export function revalidateBatch(p: ProcessingState, ctx: ProcessingContext): boolean {
  const r = current(p, ctx);
  if (p.rezept === null || (r !== undefined && inputsHold(p.eingang, r.ingredients))) return false;
  resetBatch(p);
  return true;
}

/** Advances a processing station by `ticks` (see module comment); `listener` hears what happened. */
export function advanceProcessing(p: ProcessingState, ctx: ProcessingContext, ticks: number, listener?: ProcessingListener): void {
  let remaining = ticks;
  let worked = false;
  let halt: StationStopReason | null = null;
  while (remaining > 0) {
    let r = current(p, ctx);
    if (r === undefined) {
      const m = matchBatch(p, ctx);
      if (typeof m === 'string') {
        halt = m;
        break;
      }
      r = m;
      p.rezept = r.recipe.id;
      p.fortschritt = 0;
      p.dauer = r.ticks;
      listener?.started(r.recipe.id, r.ticks);
    }
    if (ctx.heat !== null && p.glut === 0) {
      const fuel = p.brennstoff;
      if (fuel === null) {
        halt = 'brennstoff';
        break;
      }
      const heat = ctx.heat(fuel.item);
      p.glut = heat;
      p.glutVoll = heat;
      p.brennstoff = fuel.count > 1 ? withCount(fuel, fuel.count - 1) : null;
    }
    let step = Math.min(remaining, p.dauer - p.fortschritt);
    if (ctx.heat !== null) step = Math.min(step, p.glut);
    p.fortschritt += step;
    if (ctx.heat !== null) {
      p.glut -= step;
      if (p.glut === 0) p.glutVoll = 0;
    }
    remaining -= step;
    worked = true;
    if (p.fortschritt >= p.dauer) {
      consumeInputs(p.eingang, r.ingredients);
      const rest = addToSlots(p.ausgang, r.product, ctx.stackSize(r.product.item));
      if (rest > 0) throw new RangeError(`output slots took ${r.product.count - rest} of ${r.product.count} × "${r.product.item}"`);
      resetBatch(p);
      listener?.produced(r.recipe.id, r.product);
    }
  }
  const running = halt === null && (worked || p.laeuft);
  if (p.laeuft && !running && halt !== null) listener?.stopped(halt);
  p.laeuft = running;
  p.halt = running ? null : halt;
}

/** Footprint rectangle of a placed station [world px]: x0, y0, x1, y1. */
export function footprintPx(st: Pick<PlacedStation, 'tx' | 'ty'>, width: number, depth: number, out: { x0: number; y0: number; x1: number; y1: number }): typeof out {
  out.x0 = st.tx * TILE_PX;
  out.y0 = st.ty * TILE_PX;
  out.x1 = (st.tx + width) * TILE_PX;
  out.y1 = (st.ty + depth) * TILE_PX;
  return out;
}

/** Distance from (x, y) to the rectangle [px] (0 inside). */
export function distanceToFootprint(x: number, y: number, r: { x0: number; y0: number; x1: number; y1: number }): number {
  const dx = x < r.x0 ? r.x0 - x : x > r.x1 ? x - r.x1 : 0;
  const dy = y < r.y0 ? r.y0 - y : y > r.y1 ? y - r.y1 : 0;
  return Math.hypot(dx, dy);
}

/** Chunk coordinates of a placed station's anchor tile. */
export function stationChunk(st: Pick<PlacedStation, 'tx' | 'ty'>): { cx: number; cy: number } {
  return { cx: st.tx >> CHUNK_SHIFT, cy: st.ty >> CHUNK_SHIFT };
}

/** Whether two footprints (anchor + size in tiles) overlap. */
export function footprintsOverlap(ax: number, ay: number, aw: number, ad: number, bx: number, by: number, bw: number, bd: number): boolean {
  return ax < bx + bw && bx < ax + aw && ay < by + bd && by < ay + ad;
}

/** Whether `def` is a stack that may never enter a station slot (pieces with durability are tools, not material). */
export function slotForbidden(def: Pick<ItemDef, 'haltbarkeit'>): boolean {
  return def.haltbarkeit !== undefined;
}
