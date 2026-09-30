/**
 * Baut alle Frames der Spielfigur (M3-05/M3-06): je Richtung (`down`, `up`, `right`, `left`) je Aktion
 * die Frames in Aktionsreihenfolge, dazu die Clips `<aktion>_<richtung>` mit Abspielfolge, Bildrate und
 * Events. Grundkörper (`spieler_basis`), Kleidungs-Layer und Vorschau lesen dieselben Bilder, damit jeder
 * Layer pixelgenau auf seinem Körper-Frame liegt.
 */
import { LEER, RICHTUNGEN, bereinigeEinzelpixel, type Bild, type Richtung } from '../../lib/figure';
import { AKTIONEN, istSonder, type Aktion, type AktionsEvent, type FrameDef } from './_spieler_aktionen';
import { LEGENDE_ANGEZOGEN, LEGENDE_BASIS } from './_spieler_farben';
import { KAMPF_AKTIONEN } from './_spieler_kampf';
import { bildDerPose, mitUmzeichnung, type TeilUmzeichnung } from './_spieler_rig';

export interface SpielerClip {
  readonly frames: number[];
  readonly fps: number;
  readonly loop: boolean;
  readonly events: AktionsEvent[];
}

export interface SpielerBilder {
  readonly bilder: readonly Bild[];
  /** Clips `<aktion>_<richtung>`. */
  readonly clips: Readonly<Record<string, SpielerClip>>;
  /** Erster Frame jeder Aktion je Richtung (`<aktion>_<richtung>` → Sprite-Frame). */
  readonly start: Readonly<Record<string, number>>;
}

/** Frames einer Aktion in Blickrichtung (von hinten ohne eigene Tabelle wie von vorn). */
export function framesDerAktion(a: Aktion, richtung: Richtung): readonly FrameDef[] {
  if (richtung === 'down') return a.vorn;
  if (richtung === 'up') return a.hinten ?? a.vorn;
  return a.profil;
}

/** Farbe eines Zeichens im Grundkörper bzw. im angezogenen Körper (beide Ausgaben werden geprüft). */
const farbeIn =
  (legende: Readonly<Record<string, string | null>>) =>
  (c: string): string =>
    legende[c] ?? c;
const basis = farbeIn(LEGENDE_BASIS);
const angezogen = farbeIn(LEGENDE_ANGEZOGEN);

/** Setzt einen Frame zusammen (ohne Bereinigung). */
function setzeZusammen(def: FrameDef, richtung: Richtung): Bild {
  return istSonder(def) ? def.sonder(richtung) : bildDerPose(richtung, def);
}

/** Baut einen Frame; durch Verdeckung übrig gebliebene Einzelpixel werden bereinigt. */
function baue(def: FrameDef, richtung: Richtung): Bild {
  const bild = setzeZusammen(def, richtung);
  bereinigeEinzelpixel(bild, [basis, angezogen]);
  return bild;
}

let cache: SpielerBilder | null = null;

/** Das Zeichen in `ziel` am ersten Nachbarn (8er-Nachbarschaft) von Pixel `p`, der in `quelle` das Zeichen `c` trägt. */
function nachbarGleich(quelle: Bild, p: number, c: string, ziel: Bild): string | null {
  const x = p % quelle.w;
  const y = (p - x) / quelle.w;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= quelle.w || ny >= quelle.h) continue;
      if (quelle.pixel[ny * quelle.w + nx] === c) return ziel.pixel[ny * quelle.w + nx] ?? null;
    }
  }
  return null;
}

/**
 * Alle Frames in Sprite-Reihenfolge, jedes Teil durch `umzeichnung` umgezeichnet (M6-12: die Rüstungs-Layer entstehen
 * aus denselben Posen wie der Körper, `assets-src/sprites/ausruestung/_ruestung.ts`). Frame i gehört zu Frame i von
 * `spielerBilder().bilder`. Die Einzelpixel-Bereinigung entscheidet der Körper: wo sie ein Pixel des Körpers ändert,
 * trägt auch das umgezeichnete Bild das bereinigte Körperpixel, sonst bleibt es umgezeichnet – eigene Zeichen der
 * Umzeichnung (ein einzelnes Gürtelpixel in eigener Farbe) verschwinden so nicht, wo der Körper sie behält.
 */
export function spielerBilderUmgezeichnet(umzeichnung: TeilUmzeichnung): Bild[] {
  const defs = RICHTUNGEN.flatMap((richtung) => ALLE_AKTIONEN.flatMap((a) => framesDerAktion(a, richtung).map((def) => [def, richtung] as const)));
  const roh = defs.map(([def, richtung]) => setzeZusammen(def, richtung));
  const um = mitUmzeichnung(umzeichnung, () => defs.map(([def, richtung]) => setzeZusammen(def, richtung)));
  return um.map((bild, i) => {
    const o = roh[i];
    if (o === undefined) throw new Error(`Spieler: Frame ${i} fehlt`);
    const bereinigt: Bild = { ...o, pixel: [...o.pixel], sockel: { ...o.sockel } };
    bereinigeEinzelpixel(bereinigt, [basis, angezogen]);
    bereinigt.pixel.forEach((c, p) => {
      if (c === o.pixel[p]) return;
      // The body took the character of a neighbour: the drawn-over frame takes its own character of that neighbour.
      bild.pixel[p] = c === LEER ? LEER : (nachbarGleich(bereinigt, p, c, bild) ?? c);
    });
    return bild;
  });
}

/** Alle Aktionen in Frame-Reihenfolge: Alltag (M3-05/M3-06), danach der Kampf (M6-10, `_spieler_kampf.ts`). */
const ALLE_AKTIONEN: readonly Aktion[] = [...AKTIONEN, ...KAMPF_AKTIONEN];

/** Alle Frames und Clips (einmal gebaut, danach aus dem Zwischenspeicher). */
export function spielerBilder(): SpielerBilder {
  if (cache !== null) return cache;
  const bilder: Bild[] = [];
  const clips: Record<string, SpielerClip> = {};
  const start: Record<string, number> = {};
  for (const richtung of RICHTUNGEN) {
    for (const a of ALLE_AKTIONEN) {
      const erster = bilder.length;
      const defs = framesDerAktion(a, richtung);
      for (const def of defs) bilder.push(baue(def, richtung));
      for (const pos of a.folge) if (pos >= defs.length) throw new Error(`Spieler: ${a.name}_${richtung} nennt Frame ${pos}, es gibt ${defs.length}`);
      const name = `${a.name}_${richtung}`;
      start[name] = erster;
      clips[name] = { frames: a.folge.map((i) => erster + i), fps: a.fps, loop: a.loop, events: a.events.map((e) => ({ ...e })) };
    }
  }
  cache = { bilder, clips, start };
  return cache;
}
