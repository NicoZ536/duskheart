/**
 * Rules of the hearth screen as plain data (MASTERPROMPT §16.5 "Herdfeuer (Basiskern)", §16.7 "Suche über alle
 * Kisten der Basis", §26 "Fehlermeldungen sagen, was fehlt und wie man es löst"; M4-20), unit tested in
 * tests/unit/ui/herdfeuer-modell.test.ts:
 *
 * - **Fire** (`herdStatus`, `brenndauerText`): burning with the game time it lasts ("brennt noch 5 h 20 min"),
 *   cold with fuel ("bereit"), or cold and empty – each with its tone.
 * - **Fuel** (`istHerdBrennstoff`, `vorratsSegmente`): what the hearth burns (logs, charcoal – `BALANCE.hearth`),
 *   and the store as its 40 places in burn order for the gauge.
 * - **Ember core niches** (`nischen`): niche n takes only core n; a set core comes out again, a core in the bags
 *   can go in, otherwise the niche is locked until its beacon burns. Only niches whose core item exists in the
 *   content are shown – none while there are no cores yet (their beacons come with M7; §2.1 "keine coming-soon"),
 *   all of them once the content has them (Review M4 #18).
 * - **Overview** (`suchItems`, `fundZeilen`, `kistenTitel`): the items a query names (German or English name or
 *   id, umlauts forgiven), the finds per chest and item, the name shown for a chest.
 * - **Refusals** (`herdAblehnung`): the texts of the hearth reasons.
 */
import { BALANCE } from '../../../content/balance';
import type { ItemDef } from '../../../content/schema/item';
import type { BagsState } from '../../../game/inventory/bags';
import type { ItemStack } from '../../../game/items/stack';
import type { SlotRef } from '../../../game/items/slots';
import type { I18n, Lang } from '../../../i18n';
import { suchform } from '../handwerk/modell';
import { kistenName } from '../kiste/modell';

const H = BALANCE.hearth;
/** Game minutes per game hour. */
const MINUTES_PER_HOUR = 60;

/** Whether the hearth burns `item` (§16.5 "Holzscheite …, Holzkohle …"). */
export function istHerdBrennstoff(item: string): boolean {
  return H.fuelGameHours[item] !== undefined;
}

/** Whether the hearth takes `item` from the bags: its fuel, or an ember core for a niche. */
export function herdNimmt(item: string): boolean {
  return istHerdBrennstoff(item) || H.coreItems.includes(item);
}

/** Game hours one piece of `item` burns in the hearth (0: no hearth fuel). */
export function brennstunden(item: string): number {
  return H.fuelGameHours[item] ?? 0;
}

/** "5 h 20 min", "5 h", "20 min" for `minuten` game minutes (rounded up to whole minutes). */
export function brenndauerText(i18n: I18n, minuten: number): string {
  const total = Math.max(0, Math.ceil(minuten));
  const h = Math.floor(total / MINUTES_PER_HOUR);
  const m = total % MINUTES_PER_HOUR;
  if (h === 0) return i18n.t('ui.herdfeuer.dauer.minuten', { m });
  if (m === 0) return i18n.t('ui.herdfeuer.dauer.stunden', { h });
  return i18n.t('ui.herdfeuer.dauer.stundenMinuten', { h, m });
}

/** What the fire does now: a short state word, the detail under it and the whole sentence (screen readers, tests). */
export interface HerdStatus {
  /** "Brennt noch" / "Erloschen". */
  readonly titel: string;
  /** The time it lasts ("5 h 20 min"), or what to do. */
  readonly detail: string;
  /** Both as one sentence ("Brennt noch 5 h 20 min"). */
  readonly text: string;
  /** `brennt`: protected; `bereit`: cold with fuel; `leer`: cold, nothing to burn. */
  readonly ton: 'brennt' | 'bereit' | 'leer';
}

/** The status of a hearth: burning with the time it lasts, or cold and what it needs. */
export function herdStatus(i18n: I18n, zustand: { readonly brennt: boolean; readonly restMinuten: number; readonly stueck: number; readonly glut: number }): HerdStatus {
  if (zustand.brennt) {
    const dauer = brenndauerText(i18n, zustand.restMinuten);
    return { titel: i18n.t('ui.herdfeuer.zustand.brennt'), detail: dauer, text: i18n.t('ui.herdfeuer.brenntNoch', { dauer }), ton: 'brennt' };
  }
  const ton = zustand.stueck > 0 || zustand.glut > 0 ? 'bereit' : 'leer';
  const detail = i18n.t(`ui.herdfeuer.kalt.${ton}`);
  return { titel: i18n.t('ui.herdfeuer.zustand.aus'), detail, text: i18n.t('ui.herdfeuer.aus', { was: detail }), ton };
}

/** The store as its places in burn order: the item of each stored piece, then `null` up to `H.storePieces`. */
export function vorratsSegmente(vorrat: readonly ItemStack[], plaetze: number = H.storePieces): Array<string | null> {
  const out: Array<string | null> = [];
  for (const s of vorrat) for (let i = 0; i < s.count && out.length < plaetze; i++) out.push(s.item);
  while (out.length < plaetze) out.push(null);
  return out;
}

/** State of an ember core niche. */
export type NischenZustand = 'gesetzt' | 'bereit' | 'gesperrt';

/** An ember core niche as the screen shows it. */
export interface Nische {
  readonly index: number;
  /** The core item this niche takes (`glutkern_<n>`). */
  readonly kern: string;
  readonly zustand: NischenZustand;
  /** Where the bags hold its core (`bereit`), else `null`. */
  readonly ausBeutel: SlotRef | null;
}

/** What the niches ask of the items: whether an item exists (the item catalog, the content registry). */
export interface KernKatalog {
  find(id: string): unknown;
}

/**
 * The niches: set, ready (its core is in the bags) or locked (§16.5; niche n takes only core n). With `katalog` only
 * the niches whose core item it knows – none while the content has no ember cores (the screen then shows no niche
 * section at all); without it all six.
 */
export function nischen(kerne: readonly (string | null)[], bags: BagsState | null, katalog?: KernKatalog): Nische[] {
  const out: Nische[] = [];
  H.coreItems.forEach((kern, index) => {
    if (katalog !== undefined && katalog.find(kern) === undefined) return;
    if (kerne[index] !== null && kerne[index] !== undefined) {
      out.push({ index, kern, zustand: 'gesetzt', ausBeutel: null });
      return;
    }
    const at = bags === null ? null : findeImBeutel(bags, kern);
    out.push({ index, kern, zustand: at === null ? 'gesperrt' : 'bereit', ausBeutel: at });
  });
  return out;
}

/** The first bag slot (inventory, backpack compartment, hotbar) holding `item`, or `null`. */
export function findeImBeutel(bags: BagsState, item: string): SlotRef | null {
  for (const bereich of ['inventar', 'rucksackfach', 'schnellleiste'] as const) {
    const index = bags[bereich].findIndex((s) => s !== null && s.item === item);
    if (index >= 0) return { bereich, index };
  }
  return null;
}

/** Radius of the base with every niche filled [tiles] (§16.5 "bis 40 Tiles"). */
export function radiusMax(): number {
  return H.radiusByCores[H.radiusByCores.length - 1] as number;
}

/**
 * The items a search names: every item whose German or English name or id contains each word of `text` (umlauts
 * and case forgiven); `null` for an empty query.
 */
export function suchItems(text: string, items: Iterable<Pick<ItemDef, 'id' | 'name'>>, lang: Lang): Set<string> | null {
  const woerter = suchform(text, lang)
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (woerter.length === 0) return null;
  const out = new Set<string>();
  for (const def of items) {
    const heu = suchform(`${def.name.de} ${def.name.en} ${def.id.replace(/_/g, ' ')}`, lang);
    if (woerter.every((w) => heu.includes(w))) out.add(def.id);
  }
  return out;
}

/** A chest of the overview as the list names it. */
export interface KistenEintrag {
  readonly id: number;
  readonly item: string;
  readonly name: string;
  readonly label: string | null;
  readonly belegt: number;
  readonly plaetze: number;
  readonly entfernung: number;
}

/** The name shown for a chest of the overview: its own, else its container item's (in `lang`). */
export function kistenTitel(kiste: Pick<KistenEintrag, 'name' | 'item'>, def: Pick<ItemDef, 'name'> | undefined, lang: Lang): string {
  return kistenName(kiste.name, def?.name[lang] ?? kiste.item);
}

/** One line of the search: pieces of one item in one chest. */
export interface FundZeile {
  readonly kiste: number;
  readonly item: string;
  readonly anzahl: number;
}

/**
 * The finds joined per chest and item (a chest may hold an item in several slots), in the order the search found
 * them (nearest chest first, slot order).
 */
export function fundZeilen(treffer: ReadonlyArray<{ readonly kiste: number; readonly stack: Pick<ItemStack, 'item' | 'count'> }>): FundZeile[] {
  const out: Array<{ kiste: number; item: string; anzahl: number }> = [];
  for (const t of treffer) {
    const same = out.find((z) => z.kiste === t.kiste && z.item === t.stack.item);
    if (same !== undefined) same.anzahl += t.stack.count;
    else out.push({ kiste: t.kiste, item: t.stack.item, anzahl: t.stack.count });
  }
  return out;
}

/** Text of a refused hearth command. */
export function herdAblehnung(i18n: I18n, reason: string): string {
  return i18n.t(`ui.hearth.reject.${reason}`);
}
