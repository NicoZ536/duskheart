/**
 * Kompassbalken oben mittig (M3-28, §25 „optionaler Kompassbalken mit Markern“; ein- und ausschaltbar über
 * die Einstellung, die die Kompositionswurzel als `sichtbar` hereinreicht). Die Leinwand zeigt ±90° um die
 * Blickrichtung der Figur (`kompass.ts`); wechselt die Blickrichtung, dreht der Balken in einer kurzen
 * Bewegung nach – mit „Bewegung reduzieren“ (§29) springt er.
 */
import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import type { I18n } from '../../../i18n';
import type { GlyphAtlas } from '../../../render/text';
import { uiPx } from '../../kit/geometry';
import { markerSaetze, type MinimapAnzeige } from './Minimap';
import { dreheZu, KOMPASS_BREITE, KOMPASS_HOEHE, zeichneKompass } from './kompass';
import type { MinimapQuelle } from './lage';
import { indizesNachRgba } from './palette';
import { himmelsrichtung, peilung } from './projektion';
import { hudSchrift } from './schrift';
import type { SpriteBilder } from './spriteBild';
import type { HudFrame } from './takt';

/** Drehgeschwindigkeit des Balkens beim Richtungswechsel [Grad/s]: eine Vierteldrehung in 0,15 s. */
const DREHUNG_GRAD_JE_S = 600;
const MS_JE_S = 1000;
/** Längster Zeitschritt einer Drehung [s] (nach einer Pause springt der Balken nicht über das Ziel). */
const MAX_SCHRITT_S = 0.1;
const HIER_FELDER = 2;
/** Prüfsumme des gezeichneten Bilds (FNV-artig). */
const PRUEF_FAKTOR = 0x01000193;
const PRUEF_BASIS = 64;
/** Buchstaben-Schlüssel für N, O, S, W. */
const RICHTUNG_SCHLUESSEL = ['ui.kompass.buchstabe.n', 'ui.kompass.buchstabe.o', 'ui.kompass.buchstabe.s', 'ui.kompass.buchstabe.w'] as const;

export interface HudKompassProps {
  readonly i18n: I18n;
  readonly quelle: MinimapQuelle;
  readonly frame: HudFrame;
  readonly bilder: SpriteBilder;
  /** Einstellung „Bewegung reduzieren“ (§29): Richtungswechsel ohne Drehbewegung. */
  readonly bewegungReduziert?: boolean;
  /** Zeitquelle [ms] (Standard `performance.now`). */
  readonly uhr?: () => number;
}

interface KompassAnzeige {
  readonly richtung: number;
  readonly marker: MinimapAnzeige['marker'];
}

export function HudKompass({ i18n, quelle, frame, bilder, bewegungReduziert = false, uhr }: HudKompassProps) {
  const leinwand = useRef<HTMLCanvasElement>(null);
  const reduziert = useRef(bewegungReduziert);
  reduziert.current = bewegungReduziert;
  const anzeige = useSignal<KompassAnzeige>({ richtung: -1, marker: [] });
  const buchstaben = RICHTUNG_SCHLUESSEL.map((k) => i18n.t(k));
  const buchstabenRef = useRef(buchstaben);
  const buchstabenText = buchstaben.join('');
  buchstabenRef.current = buchstaben;

  useEffect(() => {
    const c = leinwand.current;
    const ctx = c?.getContext('2d') ?? null;
    if (c === null || ctx === null) return undefined;
    const jetzt = uhr ?? (() => performance.now());
    const puffer = new Uint8Array(KOMPASS_BREITE * KOMPASS_HOEHE);
    const bild = ctx.createImageData(KOMPASS_BREITE, KOMPASS_HOEHE);
    const rgba = new Uint32Array(bild.data.buffer);
    let schrift: GlyphAtlas | null = null;
    let lebt = true;
    let blick = Number.NaN;
    let zuletzt = jetzt();
    let gezeichnet = Number.NaN;
    let neuZeichnen = true;
    hudSchrift(document)
      .then((s) => {
        if (!lebt) return;
        schrift = s;
        neuZeichnen = true;
      })
      .catch((err: unknown) => console.error(`Kompass: Pixelschrift nicht geladen – ${err instanceof Error ? err.message : String(err)}`));
    const richtungen: number[] = [];
    const zeichne = (): void => {
      const l = frame.lage;
      const t = jetzt();
      const dt = Math.min(MAX_SCHRITT_S, Math.max(0, (t - zuletzt) / MS_JE_S));
      zuletzt = t;
      blick = Number.isNaN(blick) || reduziert.current ? l.richtung : dreheZu(blick, l.richtung, DREHUNG_GRAD_JE_S * dt);
      const liste = quelle.marker();
      // Prüfsumme des Bilds (ohne Allokation): Blick, Marker-Peilungen auf ganze Grad, Symbole, Schrift, Ebene.
      let schluessel = Math.round(blick) * PRUEF_BASIS + (bilder.bereit.peek() ? 1 : 0) + (schrift === null ? 0 : 2) + (l.vorhanden ? 4 * (1 - l.ebene) : 0);
      richtungen.length = 0;
      for (const m of liste) {
        if (!l.vorhanden || m.ebene !== l.ebene) continue;
        const grad = peilung(l.x, l.y, m.x, m.y);
        schluessel = (Math.imul(schluessel, PRUEF_FAKTOR) + Math.round(grad)) | 0;
        richtungen.push(Math.hypot(m.x - l.x, m.y - l.y) < HIER_FELDER ? -1 : himmelsrichtung(grad));
      }
      if (neuZeichnen || schluessel !== gezeichnet) {
        neuZeichnen = false;
        gezeichnet = schluessel;
        zeichneKompass(puffer, blick, l, liste, bilder, schrift, buchstabenRef.current);
        indizesNachRgba(puffer, rgba);
        ctx.putImageData(bild, 0, 0);
      }
      const alt = anzeige.peek();
      const richtung = himmelsrichtung(l.richtung);
      let gleich = alt.richtung === richtung && alt.marker.length === richtungen.length;
      for (let i = 0; gleich && i < richtungen.length; i++) gleich = alt.marker[i]?.richtung === richtungen[i];
      if (!gleich) {
        const marker = liste.filter((m) => l.vorhanden && m.ebene === l.ebene).map((m, i) => ({ art: m.art, richtung: richtungen[i] ?? -1 }));
        anzeige.value = { richtung, marker };
      }
    };
    zeichne();
    const stop = frame.onFrame(zeichne);
    return () => {
      lebt = false;
      stop();
    };
    // Die Buchstaben (Sprache) zeichnen über `buchstabenText` neu.
  }, [frame, quelle, bilder, uhr, buchstabenText]);

  const a = anzeige.value;
  const beschreibung = [i18n.t('ui.kompass.beschreibung', { richtung: i18n.t(`ui.kompass.richtung.${Math.max(0, a.richtung)}`) }), ...markerSaetze(i18n, a.marker)].join(' ');
  return (
    <div class="dh-hud-kompass dh-kit" data-testid="hud-kompass">
      <canvas ref={leinwand} class="dh-hud-kompass__bild" width={KOMPASS_BREITE} height={KOMPASS_HOEHE} style={{ width: uiPx(KOMPASS_BREITE), height: uiPx(KOMPASS_HOEHE) }} role="img" aria-label={beschreibung} />
    </div>
  );
}
