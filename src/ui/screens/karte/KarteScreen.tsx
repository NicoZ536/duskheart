/**
 * The map screen (MASTERPROMPT §25 "Karte (M)"; docs/SPIEL.md §18 "Karte", §30 "`karte` – M – sampleMap"; M7-49): M opens it
 * (and closes it again), the world runs on. A parchment sheet: the revealed world of a layer (`modell.ts` draws it into a
 * canvas of design pixels, scaled whole), the mist over the rest, the player's arrow, the markers – places, beacons, the
 * grave, the bases and the player's own – with their names; the zoom (buttons, mouse wheel), dragging moves the sheet,
 * "Zur Figur" brings it back, the layer buttons switch to the caves the player has seen. Own markers: a click on the map picks
 * the spot (else the player's), symbol and name, "Setzen"; the list renames and removes them.
 *
 * Reads the session only through `UiBridge.orte` (`sampleMap` every frame with a budget of new cells – a tower's view fills
 * in over a few frames –, `sampleMapMarkers` when the map changed or the second turns), writes only commands.
 */
import { useSignal } from '@preact/signals';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { BALANCE } from '../../../content/balance';
import { createMapMarkerList, createMapView, type MapView } from '../../../game/samples/orte';
import { MAP_MARKER_SPRITE } from '../../../game/map/formulas';
import { MAP_MARKER_SYMBOLS, type MapMarkerSymbol } from '../../../game/map/types';
import type { I18n } from '../../../i18n';
import { DEEPEST_LAYER, type Layer } from '../../../world/model/coords';
import type { UiBridge } from '../../bridge';
import { ScreenLayer } from '../../focus/Layer';
import type { FocusManager } from '../../focus/manager';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { HudBild } from '../../hud/Bild';
import { farbHex, farbIndex, PALETTE_RGBA32 } from '../../hud/minimap/palette';
import { uiPx } from '../../kit/geometry';
import { Button, Frame } from '../../kit/widgets';
import { erkundet, KARTE_ZOOM_START, kartenFarben, markerImBild, naechsterZoom, punktDer, verschiebe, zeichneKarte, zelleAm, type Ausschnitt, type MarkerImBild } from './modell';
import './karte.css';

/** Id of the map screen. */
export const KARTE_SCREEN = 'karte';
/** Size of the map picture [design px] (the sheet fits the reference frame 480 × 270 with the side panel). */
export const KARTE_BREITE = 288;
export const KARTE_HOEHE = 208;
/** New terrain cells computed per frame (≈ 10 µs each: a tower's 1 250 cells fill in within a frame or two). */
const ZELLEN_JE_FRAME = 1500;
/** Frames between two marker samples while nothing changed (graves, bases and beacons move rarely). */
const MARKER_FRAMES = 30;
/** Size of a map symbol and of the player's arrow [design px]. */
const SYMBOL = 16;
/** Movement of a drag [design px] below which it is a click (pick the spot of a new marker). */
const KLICK_WEG = 3;

/** The parchment's colour for the labels' halo (a palette colour as a CSS variable, ADR-0010). */
const PAPIER = { '--dh-karte-papier': farbHex(farbIndex('sand.4')) };

/** What the screen shows besides the picture (changes rarely – a signal, not per frame). */
interface KarteAnsicht {
  readonly marker: readonly MarkerImBild[];
  readonly spieler: { readonly x: number; readonly y: number; readonly frame: number } | null;
  readonly erkundet: number;
  readonly ebene: Layer;
  readonly ebenen: readonly Layer[];
  readonly eigene: readonly { readonly id: number; readonly name: string; readonly sprite: string }[];
  /** Revealed cells whose terrain is not drawn yet (they fill in over the next frames). */
  readonly ausstehend: number;
}

export interface KarteScreenProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly focus: FocusManager;
  readonly close: () => void;
}

/** The name of a layer in the i18n keys (`oberflaeche`, `hoehle1` … `hoehle3`). */
function ebenenName(l: Layer): string {
  return l === 0 ? 'oberflaeche' : `hoehle${-l}`;
}

/** The layers the player has seen something of (the surface always, a cave once revealed or entered). */
function sichtbareEbenen(views: readonly MapView[], spielerEbene: Layer): Layer[] {
  const out: Layer[] = [0];
  for (let l = -1; l >= DEEPEST_LAYER; l--) {
    const v = views[-l];
    if (l === spielerEbene || (v !== undefined && v.available && erkundet(v) > 0)) out.push(l as Layer);
  }
  return out;
}

export function KarteScreen({ i18n, bridge, focus, close }: KarteScreenProps) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useFocusScope(focus, root, { initial: () => focusable(root, '[data-standard]') });
  const t = i18n.t;
  const farben = useMemo(() => kartenFarben(), []);
  /** One view per layer (the layer buttons read whether a cave was seen), the markers, the picture's buffers. */
  const views = useMemo(() => [0, -1, -2, -3].map(() => createMapView()), []);
  const marker = useMemo(() => createMapMarkerList(), []);
  const bild = useMemo(() => ({ index: new Uint8Array(KARTE_BREITE * KARTE_HOEHE), rgba: new ImageData(KARTE_BREITE, KARTE_HOEHE) }), []);
  const ausschnitt = useMemo<Ausschnitt>(() => ({ mitteX: 0, mitteY: 0, zoom: KARTE_ZOOM_START, breite: KARTE_BREITE, hoehe: KARTE_HOEHE }), []);
  const ebene = useSignal<Layer>(0);
  const zoom = useSignal(KARTE_ZOOM_START);
  const ansicht = useSignal<KarteAnsicht | null>(null);
  const ziel = useSignal<{ tx: number; ty: number } | null>(null);
  const symbol = useSignal<MapMarkerSymbol>('eigen_1');
  const name = useSignal('');
  const umbenennen = useSignal<{ id: number; name: string } | null>(null);
  /** Redraw state: the view's version, the centre and zoom drawn last; whether the view follows the player. */
  const zustand = useMemo(() => ({ version: -1, mx: Number.NaN, my: Number.NaN, zoom: 0, ebene: 0 as Layer, folgen: true, frames: 0 }), []);
  /** A drag of the sheet in progress (pointer position, distance so far [design px]). */
  const ziehen = useMemo(() => ({ aktiv: false, x: 0, y: 0, weg: 0 }), []);
  const orte = bridge.orte;

  useEffect(() => {
    if (orte === null || orte.sampleMap === undefined || orte.sampleMapMarkers === undefined) return undefined;
    const sampleMap = orte.sampleMap;
    const sampleMarkers = orte.sampleMapMarkers;
    const lesen = (): void => {
      const l = ebene.peek();
      const v = sampleMap(views[-l] as MapView, l, ZELLEN_JE_FRAME);
      if (!v.available) return;
      // The other layers only for the layer buttons (their masks; no terrain: budget 0).
      for (let k = 1; k <= -DEEPEST_LAYER; k++) if (-k !== l) sampleMap(views[k] as MapView, -k as Layer, 0);
      const a = ausschnitt;
      a.zoom = zoom.peek();
      if (zustand.folgen && v.player && v.playerLayer === l) {
        a.mitteX = v.playerX / v.cellTiles;
        a.mitteY = v.playerY / v.cellTiles;
      } else if (zustand.version < 0) {
        a.mitteX = v.side / 2;
        a.mitteY = v.side / 2;
      }
      const neu = v.version !== zustand.version || a.mitteX !== zustand.mx || a.mitteY !== zustand.my || a.zoom !== zustand.zoom || l !== zustand.ebene;
      zustand.frames++;
      if (!neu && zustand.frames < MARKER_FRAMES) return;
      zustand.frames = 0;
      if (neu) {
        zustand.version = v.version;
        zustand.mx = a.mitteX;
        zustand.my = a.mitteY;
        zustand.zoom = a.zoom;
        zustand.ebene = l;
        zeichneKarte(v, farben, a, bild.index);
        const px = new Uint32Array(bild.rgba.data.buffer);
        for (let i = 0; i < bild.index.length; i++) px[i] = PALETTE_RGBA32[bild.index[i] as number] ?? 0;
        canvas.current?.getContext('2d')?.putImageData(bild.rgba, 0, 0);
      }
      const m = sampleMarkers(marker, l);
      const spieler = v.player && v.playerLayer === l ? punktDer(a, Math.floor(v.playerX), Math.floor(v.playerY), v.cellTiles) : null;
      const eigene: { id: number; name: string; sprite: string }[] = [];
      for (let i = 0; i < m.count; i++) {
        const r = m.records[i];
        if (r !== undefined && r.kind === 'eigen') eigene.push({ id: r.id, name: r.ref, sprite: r.sprite });
      }
      ansicht.value = {
        marker: markerImBild(i18n, m.records, m.count, a, v.cellTiles),
        spieler: spieler === null ? null : { x: spieler.x, y: spieler.y, frame: Math.round(v.facing / 45) % 8 },
        erkundet: erkundet(v),
        ebene: l,
        ebenen: sichtbareEbenen(views, v.player ? v.playerLayer : 0),
        eigene,
        ausstehend: v.pending,
      };
    };
    lesen();
    return bridge.onFrame(lesen);
  }, [bridge, orte, i18n, views, marker, bild, ausschnitt, zustand, farben, ebene, zoom, ansicht]);

  const a = ansicht.value;
  if (orte === null || orte.sampleMap === undefined) return null;
  const zoomen = (richtung: number): void => {
    zoom.value = naechsterZoom(zoom.peek(), richtung);
  };
  const setzen = (): void => {
    const v = views[-ebene.peek()] as MapView;
    const spot = ziel.peek() ?? (v.player ? { tx: Math.floor(v.playerX), ty: Math.floor(v.playerY) } : null);
    if (spot === null) return;
    const n = name.peek().trim().length > 0 ? name.peek() : t(`ui.karte.symbol.${symbol.peek()}`);
    orte.markieren?.(symbol.peek(), n, ebene.peek(), spot.tx, spot.ty);
    name.value = '';
    ziel.value = null;
  };
  // Dragging the sheet; a click without moving picks the spot of the next own marker.
  const skala = (): number => {
    const el = canvas.current;
    return el === null ? 1 : el.clientWidth / KARTE_BREITE;
  };
  const zielPunkt = ziel.value === null ? null : punktDer(ausschnitt, ziel.value.tx, ziel.value.ty, (views[-ebene.value] as MapView).cellTiles || 1);
  return (
    <ScreenLayer focus={focus} label={t('ui.karte.label')} testId="ui-karte">
      <div ref={root} class="dh-karte" style={PAPIER}>
        <Frame art="pergament" class="dh-karte__blatt">
          <div class="dh-karte__kopf">
            <h2 class="dh-karte__titel">{t('ui.karte.label')}</h2>
            <span class="dh-karte__ebene" data-testid="karte-ebene">
              {t(`ui.karte.ebene.${ebenenName(a?.ebene ?? 0)}`)}
            </span>
            <span class="dh-karte__erkundet" data-testid="karte-erkundet" data-anteil={a === null ? 0 : a.erkundet.toFixed(4)}>
              {t('ui.karte.erkundet', { prozent: a === null ? 0 : Math.max(a.erkundet > 0 ? 1 : 0, Math.round(a.erkundet * 100)) })}
            </span>
          </div>
          <div class="dh-karte__inhalt">
            <div
              class="dh-karte__bild"
              style={{ width: uiPx(KARTE_BREITE), height: uiPx(KARTE_HOEHE) }}
              onWheel={(ev) => {
                ev.preventDefault();
                zoomen(ev.deltaY < 0 ? 1 : -1);
              }}
              onPointerDown={(ev) => {
                ziehen.aktiv = true;
                ziehen.x = ev.clientX;
                ziehen.y = ev.clientY;
                ziehen.weg = 0;
                (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
              }}
              onPointerMove={(ev) => {
                if (!ziehen.aktiv) return;
                const s = skala();
                const dx = (ziehen.x - ev.clientX) / s;
                const dy = (ziehen.y - ev.clientY) / s;
                ziehen.weg += Math.abs(dx) + Math.abs(dy);
                if (ziehen.weg < KLICK_WEG) return;
                ziehen.x = ev.clientX;
                ziehen.y = ev.clientY;
                zustand.folgen = false;
                verschiebe(ausschnitt, dx, dy, (views[-ebene.peek()] as MapView).side);
              }}
              onPointerUp={(ev) => {
                if (!ziehen.aktiv) return;
                ziehen.aktiv = false;
                if (ziehen.weg >= KLICK_WEG) return;
                const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                const s = skala();
                const c = zelleAm(ausschnitt, (ev.clientX - r.left) / s, (ev.clientY - r.top) / s);
                const v = views[-ebene.peek()] as MapView;
                if (c.cx < 0 || c.cy < 0 || c.cx >= v.side || c.cy >= v.side) return;
                ziel.value = { tx: c.cx * v.cellTiles + (v.cellTiles >> 1), ty: c.cy * v.cellTiles + (v.cellTiles >> 1) };
              }}
              data-testid="karte-bild"
              data-ausstehend={a?.ausstehend ?? -1}
            >
              <canvas ref={canvas} class="dh-karte__leinwand" width={KARTE_BREITE} height={KARTE_HOEHE} />
              {a?.marker.map((m, i) => (
                <div key={`${m.art}:${m.id}:${i}`} class={`dh-karte__marker dh-karte__marker--${m.art}`} style={{ left: uiPx(m.x - SYMBOL / 2), top: uiPx(m.y - SYMBOL / 2) }} title={m.name} data-marker={m.art} data-testid={m.id >= 0 ? `karte-marker-${m.id}` : undefined}>
                  <HudBild id={m.sprite} breite={SYMBOL} hoehe={SYMBOL} />
                  {m.beschriftung !== null ? <span class={`dh-karte__name dh-karte__name--${m.beschriftung}`} style={m.nameDx !== 0 ? { marginLeft: uiPx(m.nameDx) } : undefined}>{m.name}</span> : null}
                </div>
              ))}
              {zielPunkt === null ? null : <div class="dh-karte__ziel" style={{ left: uiPx(zielPunkt.x - 3), top: uiPx(zielPunkt.y - 3) }} data-testid="karte-ziel" />}
              {a === null || a.spieler === null ? null : (
                <div class="dh-karte__spieler" style={{ left: uiPx(a.spieler.x - SYMBOL / 2), top: uiPx(a.spieler.y - SYMBOL / 2) }} data-testid="karte-spieler">
                  <HudBild id="ui_karte_spieler" frame={a.spieler.frame} breite={SYMBOL} hoehe={SYMBOL} />
                </div>
              )}
            </div>
            <div class="dh-karte__seite">
              <div class="dh-karte__leiste">
                <Button data-fokus="" data-testid="karte-zoom-weg" onClick={() => zoomen(-1)} aria-label={t('ui.karte.weiter')}>
                  −
                </Button>
                <span class="dh-karte__zoom" data-testid="karte-zoom">
                  {t('ui.karte.zoom', { stufe: zoom.value })}
                </span>
                <Button data-fokus="" data-testid="karte-zoom-nah" onClick={() => zoomen(1)} aria-label={t('ui.karte.naeher')}>
                  +
                </Button>
                <Button
                  data-fokus=""
                  data-standard=""
                  data-testid="karte-figur"
                  onClick={() => {
                    zustand.folgen = true;
                    const v = views[-ebene.peek()] as MapView;
                    if (v.player) ebene.value = v.playerLayer;
                  }}
                >
                  {t('ui.karte.zurFigur')}
                </Button>
              </div>
              {a !== null && a.ebenen.length > 1 ? (
                <div class="dh-karte__leiste">
                  {a.ebenen.map((l) => (
                    <Button key={l} data-fokus="" data-testid={`karte-ebene-${-l}`} disabled={l === a.ebene} onClick={() => (ebene.value = l)}>
                      {t(`ui.karte.ebeneKurz.${ebenenName(l)}`)}
                    </Button>
                  ))}
                </div>
              ) : null}
              <h3 class="dh-karte__abschnitt">{t('ui.karte.neuerMarker')}</h3>
              <p class="dh-karte__hinweis">{ziel.value === null ? t('ui.karte.hierSetzen') : t('ui.karte.zielGewaehlt')}</p>
              <div class="dh-karte__symbole" role="radiogroup" aria-label={t('ui.karte.symbol')}>
                {MAP_MARKER_SYMBOLS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    data-fokus=""
                    data-testid={`karte-symbol-${s}`}
                    class={`dh-karte__symbol${symbol.value === s ? ' dh-karte__symbol--an' : ''}`}
                    aria-pressed={symbol.value === s}
                    aria-label={t(`ui.karte.symbol.${s}`)}
                    onClick={() => (symbol.value = s)}
                  >
                    <HudBild id={MAP_MARKER_SPRITE[s]} breite={SYMBOL} hoehe={SYMBOL} />
                  </button>
                ))}
              </div>
              <div class="dh-karte__neu">
                <input
                  data-fokus=""
                  class="dh-karte__eingabe"
                  aria-label={t('ui.karte.name')}
                  placeholder={t('ui.karte.name')}
                  maxLength={BALANCE.map.markerNameMax}
                  value={name.value}
                  onInput={(ev) => (name.value = (ev.target as HTMLInputElement).value)}
                  data-testid="karte-name"
                />
                <Button data-fokus="" data-testid="karte-setzen" disabled={a !== null && a.eigene.length >= BALANCE.map.maxMarkers} onClick={setzen}>
                  {t('ui.karte.setzen')}
                </Button>
              </div>
              <h3 class="dh-karte__abschnitt">{t('ui.karte.eigene', { anzahl: a?.eigene.length ?? 0, max: BALANCE.map.maxMarkers })}</h3>
              <ul class="dh-karte__liste" data-testid="karte-eigene">
                {(a?.eigene ?? []).map((m) => (
                  <li key={m.id} class="dh-karte__eintrag" data-eigen={m.id}>
                    <HudBild id={m.sprite} breite={SYMBOL} hoehe={SYMBOL} />
                    {umbenennen.value?.id === m.id ? (
                      <input
                        data-fokus=""
                        class="dh-karte__umbenennen"
                        maxLength={BALANCE.map.markerNameMax}
                        value={umbenennen.value.name}
                        onInput={(ev) => (umbenennen.value = { id: m.id, name: (ev.target as HTMLInputElement).value })}
                        onKeyDown={(ev) => {
                          if (ev.key !== 'Enter') return;
                          orte.umbenennen?.(m.id, umbenennen.peek()?.name ?? m.name);
                          umbenennen.value = null;
                        }}
                        data-testid={`karte-umbenennen-${m.id}`}
                      />
                    ) : (
                      <span class="dh-karte__eintragname">{m.name}</span>
                    )}
                    <Button
                      data-fokus=""
                      data-testid={`karte-umbenennen-knopf-${m.id}`}
                      onClick={() => {
                        const u = umbenennen.peek();
                        if (u !== null && u.id === m.id) {
                          orte.umbenennen?.(m.id, u.name);
                          umbenennen.value = null;
                        } else umbenennen.value = { id: m.id, name: m.name };
                      }}
                    >
                      {umbenennen.value?.id === m.id ? t('ui.karte.ok') : t('ui.karte.umbenennen')}
                    </Button>
                    <Button data-fokus="" data-testid={`karte-entfernen-${m.id}`} onClick={() => orte.entfernen?.(m.id)}>
                      {t('ui.karte.entfernen')}
                    </Button>
                  </li>
                ))}
              </ul>
              <Button data-fokus="" data-testid="karte-schliessen" onClick={close}>
                {t('ui.karte.schliessen')}
              </Button>
            </div>
          </div>
        </Frame>
      </div>
    </ScreenLayer>
  );
}
