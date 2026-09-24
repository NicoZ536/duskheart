/**
 * Baut alle Frames der Spielfigur (M3-05/M3-06): je Richtung (`down`, `up`, `right`, `left`) je Aktion
 * die Frames in Aktionsreihenfolge, dazu die Clips `<aktion>_<richtung>` mit Abspielfolge, Bildrate und
 * Events. Grundkörper (`spieler_basis`), Kleidungs-Layer und Vorschau lesen dieselben Bilder, damit jeder
 * Layer pixelgenau auf seinem Körper-Frame liegt.
 */
import { RICHTUNGEN, bereinigeEinzelpixel, type Bild, type Richtung } from '../../lib/figure';
import { AKTIONEN, istSonder, type Aktion, type AktionsEvent, type FrameDef } from './_spieler_aktionen';
import { LEGENDE_ANGEZOGEN, LEGENDE_BASIS } from './_spieler_farben';
import { bildDerPose } from './_spieler_rig';

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

/** Baut einen Frame; durch Verdeckung übrig gebliebene Einzelpixel werden bereinigt. */
function baue(def: FrameDef, richtung: Richtung): Bild {
  const bild = istSonder(def) ? def.sonder(richtung) : bildDerPose(richtung, def);
  bereinigeEinzelpixel(bild, [basis, angezogen]);
  return bild;
}

let cache: SpielerBilder | null = null;

/** Alle Frames und Clips (einmal gebaut, danach aus dem Zwischenspeicher). */
export function spielerBilder(): SpielerBilder {
  if (cache !== null) return cache;
  const bilder: Bild[] = [];
  const clips: Record<string, SpielerClip> = {};
  const start: Record<string, number> = {};
  for (const richtung of RICHTUNGEN) {
    for (const a of AKTIONEN) {
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
