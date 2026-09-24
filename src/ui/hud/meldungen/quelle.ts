/**
 * Meldungsquelle einer laufenden Sitzung (M3-29): hört auf die Sim-Ereignisse (`GameSession.onEvent`, nach
 * jedem Tick geleert: Aufsammeln, volle Taschen, Warnstufen, abgelehnte Spielerbefehle) und wacht je Frame
 * über den Abend. Sie verändert nichts: Sie ruft nur `melde` mit fertigen Meldungen (`inhalte.ts`) auf.
 *
 * „Die Dunkelheit naht“ folgt der Uhr, nicht einem Sim-Ereignis: Überschreitet die Spielzeit an der
 * Oberfläche `DUNKELHEIT_VORLAUF_MIN` Spielminuten vor Sonnenuntergang, warnt die Quelle einmal je Tag.
 * Nur das Überschreiten zählt (vorheriger Frame davor, dieser danach) – nach dem Laden eines Abendspielstands
 * oder einem Zeitsprung über die Schwelle bleibt es still; es gibt keinen Zustand zu speichern.
 */
import type { GameSession } from '../../../game/session';
import type { ItemCatalog } from '../../../game/items/catalog';
import { MINUTES_PER_HOUR } from '../../../engine/time';
import type { MinimapLage } from '../minimap/lage';
import { ablehnungsText } from './ablehnung';
import { ablehnung, aufsammeln, dunkelheitNaht, istWarnStufe, stufenWarnung, taschenVoll, type MeldungInhalt } from './inhalte';
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

/** Verbindet die Sitzung mit `melde`. */
export function meldungenQuelle(s: MeldungenSitzung, katalog: Pick<ItemCatalog, 'find'>, melde: (e: MeldungEingabe<MeldungInhalt>) => void): MeldungenQuelle {
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
