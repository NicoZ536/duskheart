/**
 * Die Minimap-Quelle einer laufenden Sitzung (M3-28): liest je Frame Lage, Kalender, Wetter, Chunks und
 * Marker über die lesenden Abtastungen der Sitzung (`sampleFocus`, `samplePlayer`, `sampleSky`, `mapChunk`,
 * `startBeach`, `sampleGraves` – ADR-0010: die UI greift nie direkt auf die Simulation zu) und erzeugt nie
 * etwas: Weltplan und Welt werden nur gelesen, wenn sie schon gebaut sind (sonst Nebel und kein Wetter),
 * damit die Minimap die Generierung nie in den Hauptthread zieht (docs/ARCHITEKTUR.md „Faul in zwei Stufen“).
 *
 * Marker: der Startstrand (Spawn der generierten Welt) und die Gräber des Spielers (§11.6 „auf der Karte
 * markiert, bleibt bis geleert“) aus dem Todessystem – oder, für Szenarien, `graeber`. Ab der Weltkarte (M7-49,
 * `sampleMap`/`sampleMapMarkers`) zeigt die Minimap nur Aufgedecktes (`KartenAufdeckung`) und dazu die Marker der Karte der
 * Ebene: entdeckte Orte, entzündete Leuchtfeuer, Basen, eigene Marker (die Gräber kommen weiter aus `sampleGraves`). Die Marker
 * der Karte liest sie neu, wenn sich die Karte änderte, sonst alle `KARTEN_MARKER_FRAMES` Frames (Basen und Leuchtfeuer ändern
 * sich selten; ihre Quellen sind nicht allokationsfrei).
 */
import type { GameSession, GraveSample, PlayerSample, SessionFocus } from '../../../game/session';
import { createPlayerSample, createSkySample } from '../../../game/session';
import type { Facing } from '../../../game/player/state';
import { TILE_PX, type Layer } from '../../../world/model/coords';
import type { KartenChunk } from './raster';
import { ALLES_AUFGEDECKT, type AufdeckungQuelle } from './raster';
import type { KartenMarker, MarkerArt, MinimapLage, MinimapQuelle } from './lage';
import { peilung } from './projektion';
import { KartenAufdeckung } from './aufdeckung';
import { createMapMarkerList } from '../../../game/samples/orte';
import type { MapMarkerKind } from '../../../game/map/types';

/** Was die Quelle von der Sitzung braucht (nur lesende Abtastungen). */
export type MinimapSitzung = Pick<GameSession, 'sampleFocus' | 'sampleSky' | 'mapChunk' | 'startBeach'> & Partial<Pick<GameSession, 'samplePlayer' | 'sampleGraves' | 'sampleMap' | 'sampleMapMarkers'>>;

export interface MinimapQuellenOptionen {
  /** Gräber als Marker (Szenarien); ohne: die Gräber des Todessystems der Sitzung (`sampleGraves`). */
  readonly graeber?: () => readonly KartenMarker[];
  /** Aufgedeckte Kacheln; ohne: die der Weltkarte (`sampleMap`, M7-49), ohne Karte alles Geladene. */
  readonly aufdeckung?: AufdeckungQuelle;
}

/** Blickrichtung der Figur in Grad (0 = Norden, im Uhrzeigersinn). */
export const BLICK_GRAD: Readonly<Record<Facing, number>> = { up: 0, right: 90, down: 180, left: 270 };

/** Bewegung [Kacheln] ab der die Richtung einer Figur ohne Blickrichtung (Debug-Figur) neu bestimmt wird. */
const BEWEGUNG_MIN = 0.05;
const ACHTEL = 45;
/** Kachelmitte. */
const MITTE = 0.5;

/** Ein Marker, dessen Felder die Quelle je Frame neu setzt (keine Allokation je Frame). */
interface Markerplatz {
  art: MarkerArt;
  symbol?: string;
  x: number;
  y: number;
  ebene: Layer;
}

/** Frames, nach denen die Marker der Karte ohne Änderung der Karte neu gelesen werden. */
export const KARTEN_MARKER_FRAMES = 30;

/** Arten der Kartenmarker, die die Minimap zeigt (Gräber: aus `sampleGraves`; die Händlerin kommt mit M9). */
const KARTEN_ARTEN: Readonly<Partial<Record<MapMarkerKind, MarkerArt>>> = { ort: 'ort', leuchtfeuer: 'leuchtfeuer', basis: 'basis', eigen: 'eigen', aufgabe: 'aufgabe' };

/** Die Minimap-Quelle der Sitzung `s`. */
export function minimapQuelle(s: MinimapSitzung, o: MinimapQuellenOptionen = {}): MinimapQuelle {
  const fokus: SessionFocus = { x: 0, y: 0, layer: 0 };
  const sampleMap = s.sampleMap;
  const sampleMapMarkers = s.sampleMapMarkers;
  const karte = sampleMap === undefined ? null : new KartenAufdeckung((out, layer, budget) => sampleMap.call(s, out, layer, budget));
  const kartenListe = createMapMarkerList();
  const kartenMarker: Markerplatz[] = [];
  let kartenAnzahl = 0;
  let kartenStand = -1;
  let kartenEbene = Number.NaN;
  let kartenFrames = 0;
  const spieler: PlayerSample = createPlayerSample();
  const himmel = createSkySample();
  const aufdeckung = o.aufdeckung ?? karte ?? ALLES_AUFGEDECKT;
  let letzteX = Number.NaN;
  let letzteY = Number.NaN;
  let richtung = 0;
  const strand = { tx: 0, ty: 0 };
  let startstrand: KartenMarker | null = null;
  const graeber: GraveSample[] = [];
  const grabMarker: Markerplatz[] = [];
  const liste: KartenMarker[] = [];

  const quelle: MinimapQuelle = {
    aufdeckung,
    lage(out: MinimapLage): MinimapLage {
      out.vorhanden = s.sampleFocus(fokus);
      if (out.vorhanden) s.sampleSky(himmel, fokus.layer, Math.floor(fokus.x / TILE_PX), Math.floor(fokus.y / TILE_PX));
      else s.sampleSky(himmel);
      out.tag = himmel.day;
      out.minute = himmel.minuteOfDay;
      out.jahreszeit = himmel.season;
      out.tagDerJahreszeit = himmel.dayOfSeason;
      out.mondphase = himmel.moonPhase;
      out.morgenBeginn = himmel.dawnStart;
      out.sonnenaufgang = himmel.sunrise;
      out.sonnenuntergang = himmel.sunset;
      out.nachtBeginn = himmel.duskEnd;
      out.wetter = null;
      if (!out.vorhanden) return out;
      out.x = fokus.x / TILE_PX;
      out.y = fokus.y / TILE_PX;
      out.ebene = fokus.layer;
      karte?.aktualisiere(fokus.layer);
      if (s.samplePlayer?.(spieler) === true) richtung = BLICK_GRAD[spieler.facing];
      else if (Number.isFinite(letzteX) && Math.abs(out.x - letzteX) + Math.abs(out.y - letzteY) > BEWEGUNG_MIN) {
        richtung = Math.round(peilung(letzteX, letzteY, out.x, out.y) / ACHTEL) * ACHTEL;
      }
      letzteX = out.x;
      letzteY = out.y;
      out.richtung = richtung % 360;
      out.wetter = himmel.weather;
      return out;
    },
    chunk(ebene: Layer, cx: number, cy: number): KartenChunk | undefined {
      return s.mapChunk(ebene, cx, cy);
    },
    marker(): readonly KartenMarker[] {
      if (startstrand === null && s.startBeach(strand)) startstrand = { art: 'startstrand', x: strand.tx + MITTE, y: strand.ty + MITTE, ebene: 0 };
      liste.length = 0;
      if (startstrand !== null) liste.push(startstrand);
      if (o.graeber !== undefined) liste.push(...o.graeber());
      else if (s.sampleGraves !== undefined) {
        const n = s.sampleGraves(graeber);
        for (let i = 0; i < n; i++) {
          const g = graeber[i] as GraveSample;
          let m = grabMarker[i];
          if (m === undefined) {
            m = { art: 'grab', x: 0, y: 0, ebene: 0 };
            grabMarker.push(m);
          }
          m.x = g.x / TILE_PX;
          m.y = g.y / TILE_PX;
          m.ebene = g.layer;
          liste.push(m);
        }
      }
      if (karte !== null && sampleMapMarkers !== undefined) {
        const ebene = fokus.layer;
        const stand = karte.sicht(ebene).mapVersion;
        if (stand !== kartenStand || ebene !== kartenEbene || ++kartenFrames >= KARTEN_MARKER_FRAMES) {
          kartenStand = stand;
          kartenEbene = ebene;
          kartenFrames = 0;
          const l = sampleMapMarkers.call(s, kartenListe, ebene);
          kartenAnzahl = 0;
          for (let i = 0; i < l.count; i++) {
            const r = l.records[i];
            const art = r === undefined ? undefined : KARTEN_ARTEN[r.kind];
            if (r === undefined || art === undefined) continue;
            let m = kartenMarker[kartenAnzahl];
            if (m === undefined) {
              m = { art, x: 0, y: 0, ebene };
              kartenMarker.push(m);
            }
            m.art = art;
            m.symbol = r.sprite;
            m.x = r.tx + MITTE;
            m.y = r.ty + MITTE;
            m.ebene = ebene;
            kartenAnzahl++;
          }
        }
        for (let i = 0; i < kartenAnzahl; i++) liste.push(kartenMarker[i] as Markerplatz);
      }
      return liste;
    },
  };
  return quelle;
}
