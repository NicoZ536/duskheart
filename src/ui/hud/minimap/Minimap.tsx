/**
 * Minimap oben rechts (M3-28, §26 „oben rechts Minimap mit Tageszeit-Scheibe (Sonne/Mond), Tag, Jahreszeit,
 * Wetter“, §25 „Minimap (rund, zoombar)“): eine Leinwand in Designpixeln (`zeichnung.ts`), ganzzahlig
 * skaliert, darunter eine Leiste mit den Zoom-Knöpfen (UI-Kit, Tastatur- und Controller-Fokus) und einem
 * Schild mit Wettersymbol, Tag und Jahreszeit. Das Mausrad über der Karte zoomt ebenfalls.
 *
 * Gezeichnet wird nur, wenn sich etwas Sichtbares ändert (anderer Kartenpunkt, Minute, Wetter, Marker,
 * neues Chunk-Raster); DOM-Texte ändern sich über ein Signal nur bei neuen Werten. Für Screenreader
 * beschreibt die Karte sich selbst: Uhrzeit, Tagesphase, Mond und die Richtung jedes Markers
 * (farbunabhängig, §29).
 */
import './minimap.css';
import { useSignal } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { WeatherStateId } from '../../../content/weather';
import type { I18n, Lang } from '../../../i18n';
import { formatGameTime } from '../../../i18n/format';
import { FOCUS_ATTR } from '../../focus/manager';
import { uiPx } from '../../kit/geometry';
import { Button } from '../../kit/widgets';
import { geraetepixelAm, textFaktor } from '../meldungen/textgroesse';
import { kartenFarbtabellen } from './farben';
import { MinimapKarte } from './karte';
import type { KartenMarker, MinimapQuelle } from './lage';
import { hudFarbVariablen, indizesNachRgba } from './palette';
import { felderJePunkt, himmelsrichtung, peilung, ZOOM_NAH, ZOOM_STANDARD, ZOOM_WEIT, zoomStufe, type ZoomStufe } from './projektion';
import type { SpriteBilder } from './spriteBild';
import type { HudFrame } from './takt';
import { KARTE_RADIUS, MINIMAP_BREITE, MINIMAP_HOEHE, pfeilFrame, tagesphase, zeichneMinimap } from './zeichnung';

/** Wettersymbol je Zustand (Sprites `assets-src/sprites/ui/wetter.ts`). */
export const WETTER_SYMBOL: Readonly<Record<WeatherStateId, string>> = {
  klar: 'ui_wetter_klar',
  bewoelkt: 'ui_wetter_bewoelkt',
  nebel: 'ui_wetter_nebel',
  niesel: 'ui_wetter_niesel',
  regen: 'ui_wetter_regen',
  gewitter: 'ui_wetter_gewitter',
  schnee: 'ui_wetter_schnee',
  schneesturm: 'ui_wetter_schneesturm',
  hitzewelle: 'ui_wetter_hitzewelle',
  sandsturm: 'ui_wetter_sandsturm',
  ascheregen: 'ui_wetter_ascheregen',
  sternschnuppennacht: 'ui_wetter_sternschnuppennacht',
};
/** Klarer Himmel nach Sonnenuntergang: Mondsichel statt Sonne. */
export const WETTER_KLAR_NACHT = 'ui_wetter_klar_nacht';
/** Symbolgröße im Schild [Designpixel]. */
const SYMBOL = 16;
/** Marker näher als so viele Kacheln gelten als „hier“. */
const HIER_FELDER = 2;
const MINUTEN_JE_STUNDE = 60;
/** Die Zoom-Knöpfe sind im Fokussystem der Bildschirme (M3-31) navigierbar. */
const FOKUSIERBAR = { [FOCUS_ATTR]: '' };
/** Faktoren der Marker-Prüfsumme (FNV-artig; Kollisionen zeichnen höchstens einen Frame zu spät). */
const PRUEF_FAKTOR = 0x01000193;
const PRUEF_GRAB = 7;

/** Was die DOM-Teile der Minimap zeigen (ändert sich selten). */
export interface MinimapAnzeige {
  readonly vorhanden: boolean;
  readonly tag: number;
  readonly jahreszeit: string;
  readonly minute: number;
  readonly phase: string;
  readonly mondphase: number;
  readonly wetter: WeatherStateId | null;
  readonly ebene: number;
  /** Marker der Ebene mit Himmelsrichtung vom Spieler (−1 = hier). */
  readonly marker: readonly { readonly art: string; readonly richtung: number }[];
}

const LEER: MinimapAnzeige = { vorhanden: false, tag: 0, jahreszeit: '', minute: -1, phase: '', mondphase: 0, wetter: null, ebene: 0, marker: [] };

/** Prüfsumme der Markerliste (Art, Lage auf ½ Kachel, Ebene) – erkennt Änderungen ohne Allokation. */
export function markerPruefsumme(liste: readonly KartenMarker[]): number {
  let h = liste.length;
  for (const m of liste) {
    h = (Math.imul(h, PRUEF_FAKTOR) + Math.floor(m.x * 2)) | 0;
    h = (Math.imul(h, PRUEF_FAKTOR) + Math.floor(m.y * 2)) | 0;
    h = (Math.imul(h, PRUEF_FAKTOR) + m.ebene + (m.art === 'grab' ? PRUEF_GRAB : 0)) | 0;
  }
  return h;
}

/**
 * Tastatur am fokussierten Knopf: Enter und Leertaste lösen ihn aus. Die Spielsteuerung hört auf dem Fenster
 * und unterdrückt die Standardaktion ihrer belegten Tasten (Enter, Leertaste); der Knopf handelt deshalb
 * selbst und gibt die Taste nicht an das Spiel weiter (kein Interagieren oder Rollen nebenbei).
 */
export function tasteAktiviert(aktion: () => void): (e: KeyboardEvent) => void {
  return (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) aktion();
  };
}

/** Wettersymbol der Anzeige (klare Nacht: Mond), oder `null` ohne Wetter. */
export function wetterSymbol(wetter: WeatherStateId | null, phase: string): string | null {
  if (wetter === null) return null;
  return wetter === 'klar' && phase === 'nacht' ? WETTER_KLAR_NACHT : WETTER_SYMBOL[wetter];
}

/** Beschreibung der Marker für Screenreader („Startstrand im Südwesten“). */
export function markerSaetze(i18n: I18n, marker: MinimapAnzeige['marker']): string[] {
  return marker.map((m) => {
    const name = i18n.t(`ui.minimap.marker.${m.art}`);
    return m.richtung < 0 ? i18n.t('ui.minimap.markerHier', { marker: name }) : i18n.t('ui.minimap.markerRichtung', { marker: name, richtung: i18n.t(`ui.kompass.richtung.${m.richtung}`) });
  });
}

export interface HudMinimapProps {
  readonly i18n: I18n;
  readonly lang: Lang;
  /** Welt-Lesezugriff (Chunks, Marker). */
  readonly quelle: MinimapQuelle;
  /** Frame-Takt mit der Lage des Frames. */
  readonly frame: HudFrame;
  readonly bilder: SpriteBilder;
  /** Zoomstufe von außen (Einstellung); ohne: eigener Zustand, Start `ZOOM_STANDARD`. */
  readonly zoom?: ZoomStufe;
  readonly onZoom?: (z: ZoomStufe) => void;
  /** Einstellung `accessibility.textScale` (1–2). */
  readonly textgroesse?: number;
}

export function HudMinimap({ i18n, lang, quelle, frame, bilder, zoom: zoomVonAussen, onZoom, textgroesse = 1 }: HudMinimapProps) {
  const leinwand = useRef<HTMLCanvasElement>(null);
  const wurzel = useRef<HTMLDivElement>(null);
  const [eigenerZoom, setEigenerZoom] = useState<ZoomStufe>(ZOOM_STANDARD);
  const zoom = zoomVonAussen ?? eigenerZoom;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const anzeige = useSignal<MinimapAnzeige>(LEER);
  const [faktor, setFaktor] = useState(1);
  const karte = useMemo(() => new MinimapKarte(kartenFarbtabellen()), []);
  const farben = useMemo(() => hudFarbVariablen(), []);

  const setzeZoom = (z: ZoomStufe): void => {
    onZoom?.(z);
    if (zoomVonAussen === undefined) setEigenerZoom(z);
  };

  useEffect(() => {
    const el = wurzel.current;
    if (el === null) return undefined;
    const miss = (): void => setFaktor(textFaktor(geraetepixelAm(el, window.devicePixelRatio), textgroesse));
    miss();
    window.addEventListener('resize', miss);
    return () => window.removeEventListener('resize', miss);
  }, [textgroesse]);

  useEffect(() => {
    const c = leinwand.current;
    const ctx = c?.getContext('2d') ?? null;
    if (c === null || ctx === null) return undefined;
    const puffer = new Uint8Array(MINIMAP_BREITE * MINIMAP_HOEHE);
    const bild = ctx.createImageData(MINIMAP_BREITE, MINIMAP_HOEHE);
    const rgba = new Uint32Array(bild.data.buffer);
    // Zuletzt gezeichnet: bei Gleichheit aller Werte bleibt das Bild stehen (keine Allokation je Frame).
    const z = { punktX: Number.NaN, punktY: Number.NaN, ebene: 0, pfeil: -1, minute: -1, wetter: '', mond: -1, zoom: -1, version: -1, bereit: false, vorhanden: false, marker: 0 };
    const richtungen: number[] = [];
    const zeichne = (): void => {
      const l = frame.lage;
      const zm = zoomRef.current;
      if (l.vorhanden) karte.aktualisiere(quelle, l.ebene, l.x, l.y, zm, KARTE_RADIUS);
      const liste = quelle.marker();
      const fjp = felderJePunkt(zm);
      const punktX = Math.floor(l.x / fjp);
      const punktY = Math.floor(l.y / fjp);
      const pfeil = pfeilFrame(l.richtung);
      const bereit = bilder.bereit.peek();
      const wetter = l.wetter ?? '';
      const markerHash = markerPruefsumme(liste);
      if (
        punktX !== z.punktX ||
        punktY !== z.punktY ||
        l.ebene !== z.ebene ||
        pfeil !== z.pfeil ||
        l.minute !== z.minute ||
        wetter !== z.wetter ||
        l.mondphase !== z.mond ||
        zm !== z.zoom ||
        karte.version !== z.version ||
        bereit !== z.bereit ||
        l.vorhanden !== z.vorhanden ||
        markerHash !== z.marker
      ) {
        z.punktX = punktX;
        z.punktY = punktY;
        z.ebene = l.ebene;
        z.pfeil = pfeil;
        z.minute = l.minute;
        z.wetter = wetter;
        z.mond = l.mondphase;
        z.zoom = zm;
        z.version = karte.version;
        z.bereit = bereit;
        z.vorhanden = l.vorhanden;
        z.marker = markerHash;
        zeichneMinimap(puffer, karte, l, zm, liste, bilder);
        indizesNachRgba(puffer, rgba);
        ctx.putImageData(bild, 0, 0);
      }
      const phase = tagesphase(l, l.minute / MINUTEN_JE_STUNDE);
      richtungen.length = 0;
      if (l.vorhanden) {
        for (const m of liste) {
          if (m.ebene === l.ebene) richtungen.push(Math.hypot(m.x - l.x, m.y - l.y) < HIER_FELDER ? -1 : himmelsrichtung(peilung(l.x, l.y, m.x, m.y)));
        }
      }
      const alt = anzeige.peek();
      let markerGleich = alt.marker.length === richtungen.length;
      for (let i = 0; markerGleich && i < richtungen.length; i++) markerGleich = alt.marker[i]?.richtung === richtungen[i];
      if (
        alt.vorhanden !== l.vorhanden ||
        alt.tag !== l.tag ||
        alt.jahreszeit !== l.jahreszeit ||
        alt.minute !== l.minute ||
        alt.phase !== phase ||
        alt.mondphase !== l.mondphase ||
        alt.wetter !== l.wetter ||
        alt.ebene !== l.ebene ||
        !markerGleich
      ) {
        const marker = liste.filter((m) => l.vorhanden && m.ebene === l.ebene).map((m, i) => ({ art: m.art, richtung: richtungen[i] ?? -1 }));
        anzeige.value = { vorhanden: l.vorhanden, tag: l.tag, jahreszeit: l.jahreszeit, minute: l.minute, phase, mondphase: l.mondphase, wetter: l.wetter, ebene: l.ebene, marker };
      }
    };
    zeichne();
    return frame.onFrame(zeichne);
  }, [frame, quelle, bilder, karte]);

  const a = anzeige.value;
  // `bereit` lesen: Das Wettersymbol erscheint, sobald der Atlas dekodiert ist.
  const bereit = bilder.bereit.value;
  const symbol = wetterSymbol(a.wetter, a.phase);
  const symbolUrl = symbol !== null && bereit ? bilder.url(symbol) : null;
  const zeit = formatGameTime(lang, Math.max(0, a.minute));
  const beschreibung = [
    i18n.t('ui.minimap.beschreibung', { zeit, phase: i18n.t(`ui.minimap.phase.${a.phase || 'tag'}`), mond: i18n.t(`ui.minimap.mond.${a.mondphase}`) }),
    ...markerSaetze(i18n, a.marker),
  ].join(' ');
  const zeile = [i18n.t('ui.minimap.tagJahreszeit', { day: a.tag, season: a.jahreszeit === '' ? '' : i18n.t(`world.season.${a.jahreszeit}`) })];
  if (a.ebene < 0) zeile.push(i18n.t('ui.minimap.tiefe', { tiefe: -a.ebene }));
  const wetterName = a.wetter === null ? '' : i18n.t(`ui.minimap.wetter.${a.wetter}`);

  return (
    <div ref={wurzel} class="dh-hud-minimap dh-kit" style={farben} data-testid="hud-minimap" data-zoom={zoom} data-bereit={bereit ? '1' : '0'}>
      <canvas
        ref={leinwand}
        class="dh-hud-minimap__bild"
        width={MINIMAP_BREITE}
        height={MINIMAP_HOEHE}
        style={{ width: uiPx(MINIMAP_BREITE), height: uiPx(MINIMAP_HOEHE) }}
        role="img"
        aria-label={beschreibung}
        onWheel={(e) => {
          e.preventDefault();
          setzeZoom(zoomStufe(zoom + Math.sign(e.deltaY)));
        }}
      />
      <div class="dh-hud-minimap__leiste">
        <Button
          class="dh-hud-minimap__knopf"
          {...FOKUSIERBAR}
          aria-label={i18n.t('ui.minimap.zoomRaus')}
          disabled={zoom === ZOOM_WEIT}
          onClick={() => setzeZoom(zoomStufe(zoom + 1))}
          onKeyDown={tasteAktiviert(() => setzeZoom(zoomStufe(zoom + 1)))}
          data-testid="hud-minimap-raus"
        >
          –
        </Button>
        <Button
          class="dh-hud-minimap__knopf"
          {...FOKUSIERBAR}
          aria-label={i18n.t('ui.minimap.zoomRein')}
          disabled={zoom === ZOOM_NAH}
          onClick={() => setzeZoom(zoomStufe(zoom - 1))}
          onKeyDown={tasteAktiviert(() => setzeZoom(zoomStufe(zoom - 1)))}
          data-testid="hud-minimap-rein"
        >
          +
        </Button>
        <p class="dh-hud-minimap__schild" style={{ '--dh-hud-text': String(faktor) }} data-testid="hud-minimap-info">
          {symbolUrl !== null ? (
            <img class="dh-hud-minimap__wetter" src={symbolUrl} width={SYMBOL} height={SYMBOL} style={{ width: uiPx(SYMBOL), height: uiPx(SYMBOL) }} alt={wetterName} data-wetter={a.wetter ?? ''} />
          ) : null}
          <span>{zeile.join(' · ')}</span>
        </p>
      </div>
    </div>
  );
}
