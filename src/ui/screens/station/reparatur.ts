/**
 * Rules of the repair tab of the station screen as plain data (MASTERPROMPT §13.1 "Haltbarkeit für Werkzeuge, Waffen,
 * Rüstung; Reparatur an Werkbank, Amboss oder Schleifstein (anteilige Materialkosten). Kaputt = unbenutzbar, nie
 * zerstört."; M4-09), unit tested in tests/unit/ui/reparatur-modell.test.ts:
 *
 * - **What the tab lists** (`reparaturListe`): the worn pieces this station mends, in the order of the sample (hand,
 *   equipment, inventory …), then those that need another station.
 * - **What a station mends** (`kannText`) and **which stations mend a piece** (`reparaturStationen`, from the content:
 *   every station whose `reparatur` names its category and a tier at least its own).
 * - **Wear and price** (`abnutzung`): the worn share of the piece and the share of its recipe's ingredients the repair
 *   costs (`BALANCE.crafting.repairMaterialShare` of the wear; at least one piece of the largest ingredient).
 * - **Costs** (`kostenZeilen`): per material its name, icon, pieces needed and at hand (bags and chests in reach) and
 *   what is missing – rows of the crafting menu's shape, so a missing material reads like a missing ingredient
 *   ("Fehlt: 1× Zweig – …", `fehltText`).
 * - **Whether "Reparieren" goes** (`reparierbar`: a station in reach mends it – this one or another within reach – and
 *   every material is at hand) and, if not, why (`sperrText`: the stations that mend it, or the refusal `repair.item`
 *   would give; missing materials show as their own lines).
 */
import { BALANCE } from '../../../content/balance';
import type { ItemDef } from '../../../content/schema/item';
import type { StationDef } from '../../../content/stations';
import type { I18n, Lang } from '../../../i18n';
import type { RezeptKontext, ZutatZeile } from '../handwerk/modell';
import type { ReparaturAnsicht, ReparaturStueck } from './reparaturQuelle';

/** The pieces the tab lists: mendable here, then those needing another station. */
export interface ReparaturListe {
  readonly hier: readonly ReparaturStueck[];
  readonly anderswo: readonly ReparaturStueck[];
}

/** The worn pieces of `ansicht` split into those this station mends and the others (each in sample order). */
export function reparaturListe(ansicht: ReparaturAnsicht | null): ReparaturListe {
  const stuecke = ansicht?.vorhanden === true ? ansicht.stuecke : [];
  return { hier: stuecke.filter((s) => s.hier), anderswo: stuecke.filter((s) => !s.hier) };
}

/** The piece the detail shows: the chosen one if it is still listed, else the first mendable here, else the first other. */
export function reparaturAuswahl(liste: ReparaturListe, gewaehlt: string | null): ReparaturStueck | null {
  const alle = [...liste.hier, ...liste.anderswo];
  return alle.find((s) => s.key === gewaehlt) ?? alle[0] ?? null;
}

/** Whether station `station` mends a piece of `def` (its category and a tier at least the piece's). */
export function repariert(station: Pick<StationDef, 'reparatur'>, def: Pick<ItemDef, 'kategorie' | 'stufe'>): boolean {
  const r = station.reparatur;
  return r !== undefined && r.bisStufe >= def.stufe && (r.kategorien as readonly string[]).includes(def.kategorie);
}

/** Names of the stations that mend a piece of `def` (content order), in `lang`. */
export function reparaturStationen(ctx: RezeptKontext, def: Pick<ItemDef, 'kategorie' | 'stufe'>, lang: Lang): string[] {
  return ctx.book.stations.list.filter((s) => repariert(s, def)).map((s) => ctx.book.catalog.get(s.id).name[lang]);
}

/** "Repariert bis Stufe 0: Werkzeug, Waffe, Rüstung, Schild" – what station `station` mends; `null` for one that mends nothing. */
export function kannText(i18n: I18n, station: Pick<StationDef, 'reparatur'>): string | null {
  const r = station.reparatur;
  if (r === undefined) return null;
  return i18n.t('ui.reparatur.kann', { stufe: r.bisStufe, kategorien: r.kategorien.map((k) => i18n.t(`ui.item.kategorie.${k}`)).join(', ') });
}

/** Worn share of the piece [0–1] and the share of its recipe's ingredients a repair costs [0–1]. */
export function abnutzung(stueck: Pick<ReparaturStueck, 'stack' | 'voll'>, share: number = BALANCE.crafting.repairMaterialShare): { readonly abgenutzt: number; readonly kosten: number } {
  const h = stueck.stack.haltbarkeit ?? stueck.voll;
  const abgenutzt = stueck.voll <= 0 ? 0 : Math.min(1, Math.max(0, (stueck.voll - h) / stueck.voll));
  return { abgenutzt, kosten: abgenutzt * share };
}

/** The material rows of `stueck`'s repair: name, icon, needed, at hand, missing (the crafting menu's `ZutatZeile`). */
export function kostenZeilen(ctx: RezeptKontext, stueck: Pick<ReparaturStueck, 'kosten'>, lang: Lang): ZutatZeile[] {
  return stueck.kosten.map((k) => {
    const gruppe = ctx.book.group(k.key);
    const name = gruppe !== undefined ? gruppe.name[lang] : (ctx.book.catalog.find(k.key)?.name[lang] ?? k.key);
    const iconItem = k.items[0] ?? k.key;
    return { key: k.key, gruppe: gruppe !== undefined, name, iconItem, braucht: k.anzahl, hat: k.vorhanden, imBeutel: k.vorhanden, fehlt: Math.max(0, k.anzahl - k.vorhanden) };
  });
}

/**
 * Whether "Reparieren" mends `stueck` now: `repair.item` would quote it (a station in reach mends it – this one, or
 * another within reach) and every material is at hand.
 */
export function reparierbar(stueck: ReparaturStueck): boolean {
  return stueck.grund === null && stueck.station !== null && stueck.kosten.every((k) => k.vorhanden >= k.anzahl);
}

/**
 * Why "Reparieren" does not mend `stueck` (apart from missing materials, which have their own lines), or `null`: no
 * station in reach mends it (the stations that do are named, or none does yet), or the refusal `repair.item` would give.
 */
export function sperrText(i18n: I18n, ctx: RezeptKontext, stueck: ReparaturStueck): string | null {
  if (stueck.grund === null) return null;
  if (stueck.grund !== 'noStation') return i18n.t(`ui.repair.reject.${stueck.grund}`);
  const def = ctx.book.catalog.find(stueck.stack.item);
  const stationen = def === undefined ? [] : reparaturStationen(ctx, def, i18n.lang);
  if (stationen.length === 0) return i18n.t('ui.reparatur.keineStation');
  return i18n.t(stueck.hier ? 'ui.repair.reject.noStation' : 'ui.reparatur.anderswo.an', { stationen: stationen.join(', ') });
}

/** Text of a refused repair command. */
export function reparaturAblehnung(i18n: I18n, reason: string): string {
  return i18n.t(`ui.repair.reject.${reason}`);
}
