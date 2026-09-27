/**
 * Was eine Benachrichtigung zeigt (M3-29): Symbol, Textschlüssel und Werte – übersetzt wird erst beim
 * Anzeigen, damit ein Sprachwechsel auch stehende Meldungen umstellt. Hier stehen die Zuordnungen von
 * Sim-Ereignissen zu Meldungen:
 *
 * - `itemsAdded` → Aufsammeln „Feuerstein ×3“ (Name in der Raritätsfarbe, docs/ART.md §6), Item-Icon;
 * - `inventoryFull` → Warnung „Taschen voll“;
 * - `survivalStageChanged` in eine schlechtere Stufe → Warnung mit dem Zustands-Icon und einem Satz, der
 *   sagt, was zu tun ist (§26); Rückkehr zu „normal“ meldet nichts;
 * - der Abend (Uhr kurz vor Sonnenuntergang, an der Oberfläche) → „Die Dunkelheit naht“, in einer
 *   Finstermond-Nacht mit Zusatz;
 * - Entdeckungen (Orte, Gebiete) über `entdeckung()`, sobald Erkundung (M7) sie meldet;
 * - `commandRejected` eines Spielerbefehls → Warnung mit Grund und Lösung (`ablehnung.ts`);
 * - Handwerk und Stationen (M4-07, M4-08; §26 „Entdeckungen, Warnungen“): `recipeDiscovered` → Entdeckung „Neues
 *   Rezept: Steinaxt“ mit dem Icon des Erzeugnisses; `craftCancelled` durch den Spieler → „Abgebrochen – die Zutaten
 *   sind zurück.“, weil die Station eines Aufwertungsrezepts verschwand (`stationWeg`) → „Abgebrochen – die Werkbank
 *   fehlt, die Zutaten sind zurück.“ (die zurückgegebenen Zutaten melden sich als Aufsammeln; ein Abbruch durch den Tod
 *   bleibt still, dort spricht der Todesbildschirm); `stationUpgraded` → Entdeckung „Aufgewertet: Werkbank II“; `stationStopped` → Warnung
 *   mit Stationsname, Grund und Lösung („Lehmofen: der Brennstoff ist aus – leg nach.“). Diese Meldungen sind stumm:
 *   ihre Ereignisse klingen schon im Audiokern (src/audio/eventMap.ts). Ein fertiges Stück (`craftCompleted`) hat keine
 *   eigene Meldung: es kommt in die Taschen und meldet sich dort gestapelt als Aufsammeln („Faserseil ×3“).
 */
import type { LocalizedText, Rarity } from '../../../content/schema/common';
import type { StationStopReason } from '../../../game/stations/state';
import type { I18nKey } from '../../../i18n';
import type { MeldungEingabe } from './warteschlange';

/**
 * Klang einer neuen Entdeckung oder Warnung (Audio-Kern M3-33, „eine Glocke, die Meldung gleitet herein“).
 * Aufsammeln bleibt still: Das Aufheben hat seinen eigenen Klang (`sounds.aufheben` des Items).
 */
export const MELDUNG_SFX = 'sfx_ui_meldung';

/** Anzeige-Daten einer Meldung. */
export interface MeldungInhalt {
  /** Sprite-Id des Symbols (Atlas). */
  readonly symbol: string;
  readonly text: I18nKey;
  /** Name, der als `{name}` eingesetzt wird (Item, Ort). */
  readonly name?: LocalizedText;
  /** Rarität des Namens (Farbe). */
  readonly raritaet?: Rarity;
  /** Ohne Meldungsklang: Ablehnungen klingen schon mit dem Fehlerklang des Audiokerns. */
  readonly stumm?: boolean;
}

/** Stufen der Überlebenswerte, die warnen (docs/SPIEL.md §6, src/game/survival/formulas.ts). */
export const WARN_STUFEN = [
  'hungrig',
  'verhungernd',
  'durstig',
  'verdurstend',
  'frierend',
  'unterkuehlt',
  'erfrierend',
  'erhitzt',
  'ueberhitzt',
  'hitzschlag',
  'muede',
  'erschoepft',
  'durchnaesst',
  'ertrinkend',
] as const;
export type WarnStufe = (typeof WARN_STUFEN)[number];

/** Warnungstext je Stufe (Satz mit Lösung). */
const WARN_TEXT: Readonly<Record<WarnStufe, I18nKey>> = {
  hungrig: 'ui.meldungen.warnung.hungrig',
  verhungernd: 'ui.meldungen.warnung.verhungernd',
  durstig: 'ui.meldungen.warnung.durstig',
  verdurstend: 'ui.meldungen.warnung.verdurstend',
  frierend: 'ui.meldungen.warnung.frierend',
  unterkuehlt: 'ui.meldungen.warnung.unterkuehlt',
  erfrierend: 'ui.meldungen.warnung.erfrierend',
  erhitzt: 'ui.meldungen.warnung.erhitzt',
  ueberhitzt: 'ui.meldungen.warnung.ueberhitzt',
  hitzschlag: 'ui.meldungen.warnung.hitzschlag',
  muede: 'ui.meldungen.warnung.muede',
  erschoepft: 'ui.meldungen.warnung.erschoepft',
  durchnaesst: 'ui.meldungen.warnung.durchnaesst',
  ertrinkend: 'ui.meldungen.warnung.ertrinkend',
};

export function istWarnStufe(stufe: string): stufe is WarnStufe {
  return (WARN_STUFEN as readonly string[]).includes(stufe);
}

/** Aufsammel-Meldung (`anzahl` wird beim Stapeln addiert). */
export function aufsammeln(item: string, anzahl: number, name: LocalizedText, raritaet: Rarity): MeldungEingabe<MeldungInhalt> {
  return { art: 'aufsammeln', schluessel: item, anzahl, daten: { symbol: `icon_${item}`, text: 'ui.meldungen.aufsammeln', name, raritaet } };
}

/** Warnung „Taschen voll“ für ein Item, das liegen bleibt. */
export function taschenVoll(anzahl: number, name: LocalizedText, raritaet: Rarity): MeldungEingabe<MeldungInhalt> {
  return { art: 'warnung', schluessel: 'taschen_voll', anzahl, daten: { symbol: 'ui_meldung_taschen_voll', text: 'ui.meldungen.taschenVoll', name, raritaet } };
}

/** Warnung zu einer Stufe eines Überlebenswerts (Symbol = Zustands-Icon). */
export function stufenWarnung(stufe: WarnStufe): MeldungEingabe<MeldungInhalt> {
  return { art: 'warnung', schluessel: `stufe_${stufe}`, daten: { symbol: `zustand_${stufe}`, text: WARN_TEXT[stufe] } };
}

/** „Die Dunkelheit naht“, in einer Finstermond-Nacht mit Zusatz. */
export function dunkelheitNaht(finstermond: boolean): MeldungEingabe<MeldungInhalt> {
  return {
    art: 'warnung',
    schluessel: 'dunkelheit',
    daten: { symbol: 'ui_meldung_dunkelheit', text: finstermond ? 'ui.meldungen.dunkelheitFinstermond' : 'ui.meldungen.dunkelheit' },
  };
}

/**
 * Warnung zu einem abgelehnten Spielerbefehl (`ablehnung.ts`): Grund und Lösung als Satz; derselbe Text
 * erscheint nicht doppelt. Stumm – der Fehlerklang des Befehls ist ihr Klang.
 */
export function ablehnung(text: I18nKey): MeldungEingabe<MeldungInhalt> {
  return { art: 'warnung', schluessel: `ablehnung_${text}`, daten: { symbol: 'ui_meldung_hinweis', text, stumm: true } };
}

/** Entdeckung eines Orts oder Gebiets (`schluessel`: dessen Id). */
export function entdeckung(schluessel: string, name: LocalizedText): MeldungEingabe<MeldungInhalt> {
  return { art: 'entdeckung', schluessel, daten: { symbol: 'ui_meldung_entdeckung', text: 'ui.meldungen.entdeckung', name } };
}

/** „Neues Rezept: Steinaxt“ (`name`: Name des Rezepts oder seines Erzeugnisses), Symbol des Erzeugnisses. */
export function rezeptEntdeckt(rezept: string, produkt: string, name: LocalizedText): MeldungEingabe<MeldungInhalt> {
  return { art: 'entdeckung', schluessel: rezept, daten: { symbol: `icon_${produkt}`, text: 'ui.craft.discovered', name, stumm: true } };
}

/** „Abgebrochen – die Zutaten sind zurück.“ zu einem Auftrag von `rezept`, Symbol des Erzeugnisses. */
export function auftragAbgebrochen(rezept: string, produkt: string): MeldungEingabe<MeldungInhalt> {
  return { art: 'warnung', schluessel: `abgebrochen_${rezept}`, daten: { symbol: `icon_${produkt}`, text: 'ui.craft.cancelled', stumm: true } };
}

/**
 * „Abgebrochen – die Werkbank fehlt, die Zutaten sind zurück.“: die Station, die ein Aufwertungsrezept von `rezept`
 * an Ort und Stelle zur nächsten Stufe machen sollte, verschwand, während das Stück entstand (`craftCancelled` mit
 * `stationWeg`); `station` nennt sie (Item-Name), ohne sie der allgemeine Satz „Abgebrochen – die Station fehlt …“.
 */
export function auftragOhneStation(rezept: string, produkt: string, station: LocalizedText | null): MeldungEingabe<MeldungInhalt> {
  return {
    art: 'warnung',
    schluessel: `abgebrochen_${rezept}_stationWeg`,
    daten: station === null ? { symbol: `icon_${produkt}`, text: 'ui.craft.cancelledStation', stumm: true } : { symbol: `icon_${produkt}`, text: 'ui.craft.cancelledStationName', name: station, stumm: true },
  };
}

/** „Aufgewertet: Werkbank II“ – die aufgestellte Station `id` ist jetzt `neu` (`name` dessen Name). */
export function stationAufgewertet(id: number, neu: string, name: LocalizedText): MeldungEingabe<MeldungInhalt> {
  return { art: 'entdeckung', schluessel: `aufgewertet_${id}_${neu}`, daten: { symbol: `icon_${neu}`, text: 'ui.craft.upgraded', name, stumm: true } };
}

/** Satz je Grund, warum eine Verarbeitungsstation steht (mit Lösung). */
const STOPP_TEXT: Readonly<Record<StationStopReason, I18nKey>> = {
  eingang: 'ui.station.stopped.eingang',
  brennstoff: 'ui.station.stopped.brennstoff',
  ausgang: 'ui.station.stopped.ausgang',
};

/** „Lehmofen: der Brennstoff ist aus – leg nach.“ – die Station `id` (Item `station`, Name `name`) steht. */
export function stationSteht(id: number, station: string, grund: StationStopReason, name: LocalizedText): MeldungEingabe<MeldungInhalt> {
  return { art: 'warnung', schluessel: `steht_${id}_${grund}`, daten: { symbol: `icon_${station}`, text: STOPP_TEXT[grund], name, stumm: true } };
}
