/**
 * Rüstungs-Layer-Generator (M6-12, M6-31; MASTERPROMPT §4.5 „Ausrüstung als Layer (Kopf, Körper, Beine, Waffe, Nebenhand)
 * mit Hand-Sockeln pro Frame“): Jedes Rüstungsteil entsteht aus denselben Posen wie der Körper. `mitUmzeichnung`
 * (`_spieler_rig.ts`) setzt alle Frames der Figur – Alltag und Kampf, Sonderposen eingeschlossen – noch einmal zusammen,
 * während die Teile (Kopf, Rumpf, Arme, Beine) umgefärbt werden: Haar wird Kappe oder Helm, Tunika wird Hemd, Wams oder
 * Panzer, Hose wird Faser-, Leder- oder Bronzeschutz, Stiefel werden Faserschuhe, Lederstiefel oder Bronzeschuhe. Aus
 * jedem so gesetzten Frame bleiben nur die Rüstungszeichen und die angrenzende Kontur (`bildPixel` mit Auszug) – verdeckt
 * ein Arm den Panzer, fehlt der Panzer an dieser Stelle auch im Layer.
 *
 * **Nur umfärben.** Eine Umzeichnung ändert kein Pixel von leer zu gesetzt oder umgekehrt (`umgefaerbt` prüft das): die
 * Silhouette jedes Teils bleibt die des Körpers. Sonst verschöbe das Drehen der Liege- und Rollbilder (es richtet sich
 * nach der Umrissbox) den Layer gegen den Körper, und der Layer deckte Dinge, die der Körper nicht hat.
 *
 * **Ausgabe je Platz** (Renderer `src/render/anim/figure.ts`):
 * - `brust`, `beine`, `fuesse`: Overlay-Layer (`koerper`, `beine`, `fuesse`) mit genau so vielen Frames wie
 *   `spieler_basis` in derselben Zelle; der Renderer zeichnet sie mit dem Frame-Index des Körpers. Gleiche Frames teilt
 *   der Atlas (Hose und Schuhe haben nur wenige verschiedene).
 * - `kopf`: Sockel-Layer am Sockel `kopf`. Jeder Frame ist ein eindeutiges Helmbild relativ zum Kopfsockel; Clips
 *   `<aktion>_<richtung>` für jede Körperaktion laufen Position für Position mit dem Körper (der Renderer spielt sie auf
 *   der Clip-Zeit des Körpers), die Halte-Clips `down`/`up`/`right`/`left` zeigen das Idle-Bild.
 *
 * Metall (Bronze) ist in der Rampe `stein` gezeichnet und wird über die Materialstufe umgefärbt (Metallflag), wie die
 * Waffen (`assets-src/sprites/waffen/_waffe.ts`).
 */
import { bildPixel, LEER, RICHTUNGEN, type Bild, type FigurLegende, type Teil } from '../../lib/figure';
import { materialStufen } from '../../lib/recolor';
import { spriteFromPixels, type Sprite } from '../../lib/sprite';
import { MATERIAL_TIERS } from '../../paletteRows';
import { spielerBilder, spielerBilderUmgezeichnet, type SpielerClip } from '../figuren/_spieler_bilder';
import type { TeilInfo, TeilUmzeichnung } from '../figuren/_spieler_rig';
import { SPIELER_META } from '../figuren/_spieler_sprite';
import { umbenannt } from '../waffen/_waffe';

/** Sprite-Gruppe der Rüstungs-Layer (die Animationen zeigt `spieler-ruestung.png`, tools/assets/ruestkammer-preview.ts). */
export const RUESTUNG_GRUPPE = 'ruestung';
/** Konturzeichen des Körpers (gehört an Rüstungsrändern zum Layer). */
const KONTUR = 'k';

/** Ausrüstungsplatz eines Rüstungsteils (src/content/items/ruestung.ts). */
export type RuestungsPlatz = 'kopf' | 'brust' | 'beine' | 'fuesse';

/** Umfärbung eines Pixels: Zeichen `c` an (x, y) im Teil → neues Zeichen (dasselbe = unverändert). */
export type PixelUmfaerbung = (c: string, x: number, y: number, t: Teil, info: TeilInfo) => string;

export interface RuestungsStil {
  /** Item-Id; das Sprite heißt `ausruestung_<id>`. */
  readonly id: string;
  readonly platz: RuestungsPlatz;
  /** Rüstungszeichen → Farbe (Kontur `k` kommt dazu). */
  readonly legende: FigurLegende;
  /** Umfärbung je Körperteil; fehlt ein Teil, bleibt es unverändert. */
  readonly kopf?: PixelUmfaerbung;
  readonly rumpf?: PixelUmfaerbung;
  readonly arm?: PixelUmfaerbung;
  readonly bein?: PixelUmfaerbung;
  /** Metall in der Rampe `stein`: wird über die Materialstufe Bronze. */
  readonly bronze?: boolean;
}

/** Ein Teil umgefärbt; wirft, wenn sich die Silhouette ändert (siehe Modulkommentar). */
export function umgefaerbt(t: Teil, info: TeilInfo, f: PixelUmfaerbung): Teil {
  let geaendert = false;
  const zeilen = t.zeilen.map((z, y) =>
    [...z]
      .map((c, x) => {
        if (c === LEER) return c;
        const neu = f(c, x, y, t, info);
        if (neu === LEER || neu.length !== 1) throw new Error(`Rüstung: Umfärbung macht (${x}, ${y}) im Teil ${info.art}/${info.variante} leer`);
        if (neu !== c) geaendert = true;
        return neu;
      })
      .join(''),
  );
  return geaendert ? { ...t, zeilen } : t;
}

/** Die Umzeichnung eines Stils für `mitUmzeichnung`. */
function umzeichnung(stil: RuestungsStil): TeilUmzeichnung {
  return (t, info) => {
    const f = info.art === 'kopf' ? stil.kopf : info.art === 'rumpf' ? stil.rumpf : info.art === 'arm' ? stil.arm : stil.bein;
    return f === undefined ? t : umgefaerbt(t, info, f);
  };
}

/** Zeichen der Rüstung (alles in der Legende außer leer und Kontur). */
function ruestungsZeichen(stil: RuestungsStil): Set<string> {
  return new Set(Object.keys(stil.legende).filter((c) => c !== LEER && c !== KONTUR));
}

function legendeVon(stil: RuestungsStil): FigurLegende {
  return { '.': null, [KONTUR]: 'nacht.1', ...stil.legende };
}

/** Bronzestufe über `materialStufen` (nur die `stein`-Pixel, Metallflag), Id bleibt. */
function alsBronze(s: Sprite): Sprite {
  const bronze = MATERIAL_TIERS.find((t) => t.id === 'bronze');
  if (bronze === undefined) throw new Error('Materialstufe bronze fehlt');
  const [out] = materialStufen(s, [bronze]);
  if (out === undefined) throw new Error(`${s.id}: Bronzestufe fehlt`);
  return umbenannt(out, s.id);
}

/** Clips zur Ansicht auf dem Kontaktbogen (der Renderer nutzt nur die Frame-Indizes des Körpers). */
function ansicht(clips: Readonly<Record<string, SpielerClip>>): Record<string, SpielerClip> {
  return Object.fromEntries(RICHTUNGEN.flatMap((r) => [`idle_${r}`, `walk_${r}`].flatMap((n) => (clips[n] === undefined ? [] : [[n, clips[n]]]))));
}

/** Overlay-Layer (Brust, Beine, Füße): ein Frame je Körper-Frame, dieselbe Zelle. */
function overlay(stil: RuestungsStil, bilder: readonly Bild[]): Sprite {
  const { clips } = spielerBilder();
  const zeichen = ruestungsZeichen(stil);
  const legende = legendeVon(stil);
  return spriteFromPixels(
    {
      ...SPIELER_META,
      id: `ausruestung_${stil.id}`,
      group: RUESTUNG_GRUPPE,
      clips: ansicht(clips),
      einzelpixel: 'Layer-Auszug: einzeln stehende Rüstungs- und Konturpixel setzen Flächen des Körpers fort und sind im Zusammenbau Teil eines Clusters (geprüft in tests/unit/assets/ruestung-layer.test.ts)',
    },
    bilder.map((b) => bildPixel(b, legende, { zeichen, kontur: KONTUR })),
  );
}

/** Rand des Helm-Layers um den Kopfsockel (Kopf 16×11 um [8, 5], auch liegend und kopfüber). */
const HELM_RAND = 9;

/**
 * Sockel-Layer `kopf`: je Körper-Frame das Helmbild relativ zum Kopfsockel, gleiche Bilder einmal; Clips für jede
 * Körperaktion und die Halte-Clips.
 */
function helm(stil: RuestungsStil, bilder: readonly Bild[]): Sprite {
  const { clips } = spielerBilder();
  const zeichen = ruestungsZeichen(stil);
  const legende = legendeVon(stil);
  const n = 2 * HELM_RAND + 1;
  const eindeutig = new Map<string, number>();
  const frames: { index: Uint8Array }[] = [];
  const frameJeBild = bilder.map((b, i) => {
    const sockel = b.sockel.kopf;
    if (sockel === undefined) throw new Error(`Helm ${stil.id}: Körper-Frame ${i} ohne Kopfsockel`);
    const px = bildPixel(b, legende, { zeichen, kontur: KONTUR }).index;
    const zelle = new Uint8Array(n * n);
    px.forEach((v, p) => {
      if (v === 0) return;
      const x = (p % b.w) - sockel[0] + HELM_RAND;
      const y = Math.floor(p / b.w) - sockel[1] + HELM_RAND;
      if (x < 0 || y < 0 || x >= n || y >= n) throw new Error(`Helm ${stil.id}: Frame ${i} ragt über die Helmzelle`);
      zelle[y * n + x] = v;
    });
    const key = zelle.join(',');
    let f = eindeutig.get(key);
    if (f === undefined) {
      f = frames.length;
      eindeutig.set(key, f);
      frames.push({ index: zelle });
    }
    return f;
  });
  const helmClips: Record<string, SpielerClip> = {};
  for (const [name, c] of Object.entries(clips)) helmClips[name] = { ...c, frames: c.frames.map((f) => frameJeBild[f] ?? 0), events: [] };
  for (const r of RICHTUNGEN) {
    const idle = clips[`idle_${r}`]?.frames[0];
    if (idle === undefined) throw new Error(`Helm ${stil.id}: Idle ${r} fehlt`);
    helmClips[r] = { frames: [frameJeBild[idle] ?? 0], fps: 8, loop: true, events: [] };
  }
  return spriteFromPixels(
    {
      id: `ausruestung_${stil.id}`,
      group: RUESTUNG_GRUPPE,
      size: [n, n],
      anchor: [HELM_RAND, HELM_RAND],
      hoehe: 'kugel',
      clips: helmClips,
      occluder: { kind: 'none' },
      spiegelbar: false,
      einzelpixel: 'Layer-Auszug aus dem Kopf: einzeln stehende Helm- und Konturpixel setzen Flächen des Kopfes fort (geprüft in tests/unit/assets/ruestung-layer.test.ts)',
    },
    frames,
  );
}

/** Das Layer-Sprite eines Rüstungsteils (Bronze umgefärbt). */
export function ruestungsLayer(stil: RuestungsStil): Sprite {
  const bilder = spielerBilderUmgezeichnet(umzeichnung(stil));
  const s = stil.platz === 'kopf' ? helm(stil, bilder) : overlay(stil, bilder);
  return stil.bronze === true ? alsBronze(s) : s;
}

// ---------------------------------------------------------------------------------------------
// Bausteine der Umfärbungen
// ---------------------------------------------------------------------------------------------

/** Haarzeichen des Kopfes (`_spieler_farben.ts`: `1`–`3` = holz dunkel → hell). */
export const HAAR: ReadonlySet<string> = new Set(['1', '2', '3']);
/** Stoffzeichen von Tunika und Unterkleid (`b` Schatten, `t` Grundton, `T` Licht); der Gürtel ist `g`, `G`. */
export const STOFF: ReadonlySet<string> = new Set(['b', 't', 'T']);
/** Hose (`p` Grundton, `P` Licht) und Stiefel (`e` Sohle/Schatten, `E` Leder). */
export const HOSE: ReadonlySet<string> = new Set(['p', 'P']);
const STIEFEL: ReadonlySet<string> = new Set(['e', 'E']);

/** Erste Zeile eines Beinteils mit Stiefel (die Hose endet darüber); ohne Stiefel die Höhe des Teils. */
export function stiefelOben(t: Teil): number {
  const i = t.zeilen.findIndex((z) => [...z].some((c) => STIEFEL.has(c)));
  return i < 0 ? t.h : i;
}

/** Abstand (Schachbrett) eines Pixels vom Drehpunkt des Teils – beim Arm die Schulter. */
export function abstandZumDrehpunkt(t: Teil, x: number, y: number): number {
  return Math.max(Math.abs(x - t.pivot[0]), Math.abs(y - t.pivot[1]));
}
