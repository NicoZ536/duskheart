/**
 * Meldungsquelle einer laufenden Sitzung (M3-29): hört auf die Sim-Ereignisse (`GameSession.onEvent`, nach
 * jedem Tick geleert: Aufsammeln, volle Taschen, Warnstufen, abgelehnte Spielerbefehle; ab M4 neue Rezepte,
 * abgebrochene Aufträge – vom Spieler oder weil die Station einer Aufwertung fehlt –, aufgewertete und stehende
 * Stationen) und wacht je Frame über den Abend. Sie verändert
 * nichts: Sie ruft nur `melde` mit fertigen Meldungen (`inhalte.ts`) auf.
 *
 * „Die Dunkelheit naht“ folgt der Uhr, nicht einem Sim-Ereignis: Überschreitet die Spielzeit an der
 * Oberfläche `DUNKELHEIT_VORLAUF_MIN` Spielminuten vor Sonnenuntergang, warnt die Quelle einmal je Tag.
 * Nur das Überschreiten zählt (vorheriger Frame davor, dieser danach) – nach dem Laden eines Abendspielstands
 * oder einem Zeitsprung über die Schwelle bleibt es still; es gibt keinen Zustand zu speichern.
 */
import type { GameSession } from '../../../game/session';
import { contentRecipeBook, type RecipeBook } from '../../../game/crafting/recipes';
import { contentItemCatalog, type ItemCatalog } from '../../../game/items/catalog';
import { MINUTES_PER_HOUR } from '../../../engine/time';
import type { MinimapLage } from '../minimap/lage';
import { ablehnungsText } from './ablehnung';
import { ablehnung, auftragAbgebrochen, auftragOhneStation, aufsammeln, dunkelheitNaht, entdeckung, istWarnStufe, rezeptEntdeckt, stationAufgewertet, stationSteht, stufenWarnung, taschenVoll, type MeldungInhalt } from './inhalte';
import { CONTENT } from '../../../content/index';
import type { PlaceDef } from '../../../content/places/schema';
import type { MeldungEingabe } from './warteschlange';

/**
 * Vorlauf der Dunkelheits-Warnung vor Sonnenuntergang [Spielminuten]: 30 min + 2 h Dämmerung = 2½
 * Echtminuten bis zur Nacht (1 Spielstunde = 1 Echtminute, §10) – Zeit, eine Fackel zu bauen oder ein
 * Feuer zu erreichen.
 */
export const DUNKELHEIT_VORLAUF_MIN = 30;

/** Sim-Ereignisse, die die Quelle liest. */
export type MeldungenSitzung = Pick<GameSession, 'onEvent'>;

/** Wächter über den Abend (rein; je Frame mit der Minimap-Lage gefüttert). */
export class DunkelheitsWaechter {
  private letzteMinute = Number.NaN;
  private letzterTag = Number.NaN;
  private gewarntAm = Number.NaN;

  /** Liefert die Warnung, wenn in diesem Frame die Schwelle überschritten wurde, sonst `null`. */
  pruefe(l: MinimapLage): MeldungEingabe<MeldungInhalt> | null {
    const schwelle = l.sonnenuntergang * MINUTES_PER_HOUR - DUNKELHEIT_VORLAUF_MIN;
    const ueberschritten = l.tag === this.letzterTag && this.letzteMinute < schwelle && l.minute >= schwelle;
    this.letzteMinute = l.minute;
    this.letzterTag = l.tag;
    if (!ueberschritten || !l.vorhanden || l.ebene !== 0 || this.gewarntAm === l.tag) return null;
    this.gewarntAm = l.tag;
    return dunkelheitNaht(l.mondphase === 0);
  }
}

export interface MeldungenQuelle {
  /** Je Frame: Abend prüfen (mit der Lage der Minimap). */
  frame(l: MinimapLage): void;
  /** Hört auf. */
  trenne(): void;
}

/**
 * Verbindet die Sitzung mit `melde`. `katalog` nennt Items und Stationen, `rezepte` die Rezepte (Name, Erzeugnis;
 * Standard: die des Spiels).
 */
export function meldungenQuelle(
  s: MeldungenSitzung,
  katalog: Pick<ItemCatalog, 'find'>,
  melde: (e: MeldungEingabe<MeldungInhalt>) => void,
  rezepte: Pick<RecipeBook, 'find'> = contentRecipeBook(contentItemCatalog()),
): MeldungenQuelle {
  const waechter = new DunkelheitsWaechter();
  const stopps = [
    s.onEvent('itemsAdded', (e) => {
      const def = katalog.find(e.item);
      if (def !== undefined) melde(aufsammeln(e.item, e.count, def.name, def.raritaet));
    }),
    s.onEvent('inventoryFull', (e) => {
      const def = katalog.find(e.item);
      if (def !== undefined) melde(taschenVoll(e.count, def.name, def.raritaet));
    }),
    s.onEvent('survivalStageChanged', (e) => {
      if (istWarnStufe(e.stage)) melde(stufenWarnung(e.stage));
    }),
    s.onEvent('commandRejected', (e) => {
      const text = ablehnungsText(e.type, e.reason);
      if (text !== null) melde(ablehnung(text));
    }),
    s.onEvent('recipeDiscovered', (e) => {
      const r = rezepte.find(e.recipe);
      const produkt = r === undefined ? undefined : katalog.find(r.ergebnis.item);
      if (r !== undefined && produkt !== undefined) melde(rezeptEntdeckt(r.id, produkt.id, r.name ?? produkt.name));
    }),
    s.onEvent('craftCancelled', (e) => {
      const r = rezepte.find(e.recipe);
      const produkt = r?.ergebnis.item;
      if (produkt === undefined) return;
      if (e.reason === 'abgebrochen') melde(auftragAbgebrochen(e.recipe, produkt));
      else if (e.reason === 'stationWeg') {
        // The station the upgrade was turning into its next stage is gone: named by its item (the recipe's station).
        const id = r?.station ?? null;
        const station = id === null ? undefined : katalog.find(id);
        melde(auftragOhneStation(e.recipe, produkt, station?.name ?? null));
      }
    }),
    s.onEvent('stationUpgraded', (e) => {
      const def = katalog.find(e.to);
      if (def !== undefined) melde(stationAufgewertet(e.id, e.to, def.name));
    }),
    s.onEvent('stationStopped', (e) => {
      const def = katalog.find(e.station);
      if (def !== undefined) melde(stationSteht(e.id, e.station, e.reason, def.name));
    }),
    // A place found for the first time (M7-07): "Entdeckt: Gehöft" – once per place (the event comes once per slot).
    s.onEvent('placeDiscovered', (e) => {
      const def = CONTENT.collection('locationTypes').find(e.ortstyp) as PlaceDef | undefined;
      if (def !== undefined) melde(entdeckung(`ort_${e.place}`, def.name));
    }),
  ];
  return {
    frame(l) {
      const w = waechter.pruefe(l);
      if (w !== null) melde(w);
    },
    trenne() {
      for (const stop of stopps) stop();
    },
  };
}
