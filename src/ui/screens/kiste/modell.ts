/**
 * Rules of the chest screen as plain data (MASTERPROMPT §16.7 "Umbenennen + Icon-Etikett, Sortieren, Schnellablage
 * in passende Kisten (10 Tiles), ‚Alles einlagern' (außer Schnellleiste)"; M4-21), unit tested in
 * tests/unit/ui/kiste-modell.test.ts:
 *
 * - **Name** (`kistenName`): the name on the lid, else the container item's name; a new name is trimmed and cut to
 *   `BALANCE.storage.nameMaxLength` (`nameKlemmen`) – an empty one gives the item's name back.
 * - **Icon label** (`etikettAuswahl`, `naechstesEtikett`): the items the chest holds (first-seen order), after the
 *   current label if it holds none of it any more, and "none"; the selector steps through them.
 * - **What fits** (`passtHinein`): the shelf takes raw materials and ingots only; pieces of every other category stay
 *   dim in the bags.
 * - **Refusals** (`kistenAblehnung`): the texts of the storage reasons.
 * - **Search over the base** (§16.7 "Suche über alle Kisten der Basis", from any chest): which base it runs over
 *   (`basisText`: a hearth's zone, or – without a hearth – the chests within `BALANCE.storage.searchRadiusTiles` of this
 *   chest), where a chest with finds stands (`ortText`: "diese Kiste" or "8 Felder nordwestlich", `richtung` in eight
 *   compass sectors) and which slots of the open chest hold a find (`trefferIn`, highlighted).
 */
import { BALANCE } from '../../../content/balance';
import type { ItemDef } from '../../../content/schema/item';
import type { ItemStack } from '../../../game/items/stack';
import type { I18n } from '../../../i18n';
import type { SucheAnsicht, SucheKiste } from './sucheQuelle';

/** The name shown for a chest: its own, else its item's. */
export function kistenName(name: string, itemName: string): string {
  const n = name.trim();
  return n === '' ? itemName : n;
}

/** A typed name as the chest keeps it (trimmed, at most `BALANCE.storage.nameMaxLength` characters). */
export function nameKlemmen(name: string): string {
  return [...name.trim()].slice(0, BALANCE.storage.nameMaxLength).join('');
}

/** Labels to choose from: `null` (none), then the items in the chest in slot order, the current label kept. */
export function etikettAuswahl(slots: readonly (ItemStack | null)[], aktuell: string | null): Array<string | null> {
  const items: string[] = [];
  for (const s of slots) if (s !== null && !items.includes(s.item)) items.push(s.item);
  if (aktuell !== null && !items.includes(aktuell)) items.push(aktuell);
  return [null, ...items];
}

/** The label `schritt` steps after `aktuell` in `auswahl` (wrapping). */
export function naechstesEtikett(auswahl: ReadonlyArray<string | null>, aktuell: string | null, schritt: number): string | null {
  const n = auswahl.length;
  if (n === 0) return null;
  const i = Math.max(0, auswahl.indexOf(aktuell));
  return auswahl[(((i + schritt) % n) + n) % n] ?? null;
}

/** Whether a chest taking the categories `nur` (`null`: all) takes `def`. */
export function passtHinein(nur: readonly string[] | null, def: Pick<ItemDef, 'kategorie'>): boolean {
  return nur === null || nur.includes(def.kategorie);
}

/** Text of a refused storage command. */
export function kistenAblehnung(i18n: I18n, reason: string): string {
  return i18n.t(`ui.storage.reject.${reason}`);
}

/** Compass directions in eight sectors, clockwise from north. */
export const RICHTUNGEN = ['n', 'no', 'o', 'so', 's', 'sw', 'w', 'nw'] as const;
export type Richtung = (typeof RICHTUNGEN)[number];

/** Degrees of a full turn and of one of the eight sectors. */
const VOLL = 360;
const SEKTOR = VOLL / RICHTUNGEN.length;

/** The compass direction of an offset (+x east, +y south) in eight sectors; `null` for none. */
export function richtung(dx: number, dy: number): Richtung | null {
  if (dx === 0 && dy === 0) return null;
  // Bearing clockwise from north (screen y grows southwards).
  const grad = ((Math.atan2(dx, -dy) * VOLL) / (2 * Math.PI) + VOLL) % VOLL;
  return RICHTUNGEN[Math.round(grad / SEKTOR) % RICHTUNGEN.length] ?? null;
}

/** Where a chest with finds stands: "diese Kiste" for the open one, else "8 Felder nordwestlich". */
export function ortText(i18n: I18n, kiste: Pick<SucheKiste, 'offen' | 'dx' | 'dy' | 'entfernung'>): string {
  if (kiste.offen) return i18n.t('ui.kiste.suche.hier');
  const r = richtung(kiste.dx, kiste.dy);
  const wohin = r === null ? i18n.t('ui.kiste.suche.nebenan') : i18n.t(`ui.kiste.suche.richtung.${r}`);
  return i18n.t('ui.kiste.suche.entfernung', { count: Math.max(1, kiste.entfernung), richtung: wohin });
}

/** Which base the search runs over and how many chests it holds. */
export function basisText(i18n: I18n, ansicht: Pick<SucheAnsicht, 'herd' | 'radius' | 'kistenGesamt'>): string {
  return i18n.t(ansicht.herd ? 'ui.kiste.suche.basis.herd' : 'ui.kiste.suche.basis.umkreis', { count: ansicht.kistenGesamt, radius: ansicht.radius });
}

/** Slots of chest `id` holding a find (highlighted in the open chest). */
export function trefferIn(ansicht: Pick<SucheAnsicht, 'kisten'> | null, id: number): ReadonlySet<number> {
  const k = ansicht?.kisten.find((x) => x.id === id);
  return new Set(k === undefined ? [] : k.funde.map((f) => f.index));
}
