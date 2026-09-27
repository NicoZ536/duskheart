/**
 * Rules of the station screen as plain data (MASTERPROMPT §15.1 "Verarbeitungsstationen … haben Eingang,
 * Brennstoff und Ausgang", §15.4, §26; M4-07), unit tested in tests/unit/ui/station-modell.test.ts:
 *
 * - **Recipes of a station** (`stationsRezepte`): a hand station lists the hand recipes of its line up to its
 *   stage (Werkbank II also makes what Werkbank I makes), a processing station the batches it runs.
 * - **Where a bag stack goes** (`ablageZiel`): what the station's recipes use goes into the input slots, a fuel it
 *   accepts into the fuel slot (a smelting furnace takes charcoal, not wood); an item that is both – wood in the
 *   charcoal kiln – goes into the input, the alternative gesture puts it on the fuel (`ablageAlternative`).
 *   Pieces with durability never enter a slot.
 * - **Status line** (`stationsStatus`): what the station works on and how far, why it stands still, or – empty and
 *   idle – that it waits for a load.
 * - **Refusals** (`ablehnungsText`): the texts of the station reasons, else of the bag reasons.
 */
import type { RecipeDef } from '../../../content/recipes/schema';
import type { ItemDef } from '../../../content/schema/item';
import type { StationFuelBalance } from '../../../content/balance/stations';
import { STATION_REJECT_REASONS } from '../../../game/stations/events';
import { contentStationCatalog, type StationCatalog } from '../../../game/stations/catalog';
import { acceptsFuel, slotForbidden } from '../../../game/stations/formulas';
import type { StationStopReason } from '../../../game/stations/state';
import type { I18n } from '../../../i18n';
import { formatPercent } from '../../../i18n/format';
import type { RezeptKontext } from '../handwerk/modell';

/** The recipes station `station` offers: hand recipes of a hand station, the batches of a processing station. */
export function stationsRezepte(ctx: RezeptKontext, station: string): RecipeDef[] {
  const processing = ctx.book.stations.find(station)?.art === 'verarbeitung';
  return ctx.book.recipesAt(station).filter((r) => ctx.book.isProcessing(r) === processing);
}

/** Items the input slots of processing station `station` take (every ingredient of its batches). */
export function eingangsItems(ctx: RezeptKontext, station: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const r of stationsRezepte(ctx, station)) for (const z of ctx.book.ingredients(r.id)) for (const i of z.items) out.add(i);
  return out;
}

/** Slot areas a bag stack can go to. */
export type AblageBereich = 'eingang' | 'brennstoff';

/** What the station takes: its input items and its fuel rules (`null`: no fuel slot). */
export interface Ablage {
  readonly eingang: ReadonlySet<string>;
  readonly brennstoff: StationFuelBalance | null;
}

/** The slot rules of station `station`. */
export function ablageVon(ctx: RezeptKontext, station: string, stations: StationCatalog = contentStationCatalog()): Ablage {
  return { eingang: eingangsItems(ctx, station), brennstoff: stations.find(station) === undefined ? null : stations.fuel(station) };
}

/** Whether `def` burns in the station (a fuel slot that accepts its burn value). */
export function brenntDarin(ablage: Ablage, def: Pick<ItemDef, 'brennwert' | 'haltbarkeit'>): boolean {
  return ablage.brennstoff !== null && !slotForbidden(def) && def.brennwert !== undefined && acceptsFuel(ablage.brennstoff, def.brennwert);
}

/** The area a click puts `def` into: the input when a recipe uses it, else the fuel slot when it burns there; `null`: neither. */
export function ablageZiel(ablage: Ablage, def: Pick<ItemDef, 'id' | 'brennwert' | 'haltbarkeit'>): AblageBereich | null {
  if (slotForbidden(def)) return null;
  if (ablage.eingang.has(def.id)) return 'eingang';
  return brenntDarin(ablage, def) ? 'brennstoff' : null;
}

/** The other area of an item that fits both (wood in the charcoal kiln goes onto the fuel), else `null`. */
export function ablageAlternative(ablage: Ablage, def: Pick<ItemDef, 'id' | 'brennwert' | 'haltbarkeit'>): AblageBereich | null {
  return ablageZiel(ablage, def) === 'eingang' && brenntDarin(ablage, def) ? 'brennstoff' : null;
}

/** What the status line of a processing station shows. */
export interface StationsStatus {
  readonly text: string;
  readonly ton: 'laeuft' | 'halt' | 'still';
}

/** The state of a processing station as the status line needs it. */
export interface StatusEingabe {
  /** Recipe of the batch in progress, or `null`. */
  readonly rezept: string | null;
  /** Progress of the batch [0–1]. */
  readonly fortschritt: number;
  readonly laeuft: boolean;
  readonly halt: StationStopReason | null;
  /** The input slots (an empty input with nothing to work on asks for a load instead of reporting a stop). */
  readonly eingang: readonly unknown[];
}

/**
 * Status line: "Arbeitet: Ziegel – 42 %", the stop reason ("Lehmofen: der Brennstoff ist aus – leg nach."), or – with
 * an empty input and no batch (a new oven, or one that finished its load) – the request for a load.
 */
export function stationsStatus(i18n: I18n, ctx: RezeptKontext, name: string, s: StatusEingabe): StationsStatus {
  if (s.rezept !== null) {
    const r = ctx.book.find(s.rezept);
    const produkt = r === undefined ? s.rezept : (r.name?.[i18n.lang] ?? ctx.book.catalog.get(r.ergebnis.item).name[i18n.lang]);
    if (s.laeuft || s.halt === null) return { text: i18n.t('ui.station.laeuft', { name: produkt, anteil: formatPercent(i18n.lang, s.fortschritt) }), ton: 'laeuft' };
  }
  const leer = s.eingang.every((x) => x === null);
  if (s.halt !== null && !(s.halt === 'eingang' && leer && s.rezept === null)) return { text: i18n.t(`ui.station.stopped.${s.halt}`, { name }), ton: 'halt' };
  return { text: i18n.t('ui.station.bereit'), ton: 'still' };
}

/** Text of a refused station command: its station reason, else its bag reason. */
export function ablehnungsText(i18n: I18n, reason: string): string {
  return (STATION_REJECT_REASONS as readonly string[]).includes(reason) ? i18n.t(`ui.station.reject.${reason}`) : i18n.t(`ui.inventory.reject.${reason}`);
}
