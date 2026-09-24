/**
 * Was die Minimap je Frame von der Welt liest (M3-28): Lage und Blickrichtung der Figur, Uhrzeit, Tag,
 * Jahreszeit, Mondphase, Tageszeiten der Jahreszeit und das Wetter am Standort, dazu die Marker. Ein vom
 * Aufrufer gehaltener Datensatz, der je Frame überschrieben wird (keine Allokation, §30).
 */
import type { SeasonId } from '../../../content/balance';
import type { WeatherStateId } from '../../../content/weather';
import type { Layer } from '../../../world/model/coords';
import type { KartenLeser } from './karte';

/** Lage der Minimap. */
export interface MinimapLage {
  /** Es gibt eine Figur (sonst zeigt die Minimap nur Nebel und die Uhr). */
  vorhanden: boolean;
  /** Position der Figur [Kacheln, gebrochen]. */
  x: number;
  y: number;
  ebene: Layer;
  /** Blickrichtung [Grad, 0 = Norden, im Uhrzeigersinn, Vielfache von 45]. */
  richtung: number;
  /** Tag (ab 1) und Spielminute des Tages (0–1439). */
  tag: number;
  minute: number;
  jahreszeit: SeasonId;
  /** Tag in der Jahreszeit (ab 1) und Länge der Jahreszeit [Tage]. */
  tagDerJahreszeit: number;
  /** Mondphase der laufenden bzw. kommenden Nacht, 0 (Finstermond) … 7. */
  mondphase: number;
  /** Tageszeiten der Jahreszeit [Stunden nach Mitternacht] (`Calendar.dayTimes`). */
  morgenBeginn: number;
  sonnenaufgang: number;
  sonnenuntergang: number;
  nachtBeginn: number;
  /** Wetter am Standort (Oberfläche), `null` in Höhlen, auf offenem Meer oder vor dem Weltplan. */
  wetter: WeatherStateId | null;
}

export function neueMinimapLage(): MinimapLage {
  return {
    vorhanden: false,
    x: 0,
    y: 0,
    ebene: 0,
    richtung: 0,
    tag: 1,
    minute: 0,
    jahreszeit: 'fruehling',
    tagDerJahreszeit: 1,
    mondphase: 0,
    morgenBeginn: 4,
    sonnenaufgang: 6,
    sonnenuntergang: 18,
    nachtBeginn: 20,
    wetter: null,
  };
}

/** Art eines Kartenmarkers (Symbol `ui_karte_<art>`). */
export type MarkerArt = 'grab' | 'startstrand';

/** Ein Marker auf Minimap und Kompassbalken. */
export interface KartenMarker {
  readonly art: MarkerArt;
  /** Weltposition [Kacheln, gebrochen – Kachelmitte = +0,5] und Ebene. */
  readonly x: number;
  readonly y: number;
  readonly ebene: Layer;
}

/** Lesezugriff der Minimap: Lage, Chunks, Aufdeckung, Marker. */
export interface MinimapQuelle extends KartenLeser {
  /** Füllt `out` mit der aktuellen Lage (je Frame, ohne Allokation). */
  lage(out: MinimapLage): MinimapLage;
  /** Die Marker der Welt (Startstrand, Gräber …); die Minimap filtert nach Ebene. */
  marker(): readonly KartenMarker[];
}
