/**
 * Baut alle Frames der Spielfigur (M3-05/M3-06): je Richtung (`down`, `up`, `right`, `left`) je Aktion
 * die Frames in Aktionsreihenfolge, dazu die Clips `<aktion>_<richtung>` mit Abspielfolge, Bildrate und
 * Events. Grundkörper (`spieler_basis`), Kleidungs-Layer und Vorschau lesen dieselben Bilder, damit jeder
 * Layer pixelgenau auf seinem Körper-Frame liegt. Hinter allen Aktionen stehen die gedrehten Körperbilder (M6-Gate,
 * `KAMPF_GEDREHT`: der Bogen schräg nach oben) mit ihren Clips `<aktion>_<richtung>_rechtsrum`/`_linksrum`.
 */
import { LEER, RICHTUNGEN, bereinigeEinzelpixel, type Bild, type Richtung } from '../../lib/figure';
import { AKTIONEN, istSonder, type Aktion, type AktionsEvent, type FrameDef } from './_spieler_aktionen';
import { LEGENDE_ANGEZOGEN, LEGENDE_BASIS } from './_spieler_farben';
import { GEDREHT_SUFFIX, KAMPF_AKTIONEN, KAMPF_GEDREHT } from './_spieler_kampf';
import type { KoerperForm } from './_spieler_formen';
import { bildDerPose, mitFigur, mitUmzeichnung, type KopfStil, type TeilUmzeichnung } from './_spieler_rig';

export interface SpielerClip {
  readonly frames: number[];
  readonly fps: number;
  readonly loop: boolean;
  readonly events: AktionsEvent[];
}

export interface SpielerBilder {
  readonly bilder: readonly Bild[];
  /** Clips `<aktion>_<richtung>` und die gedrehten `<aktion>_<richtung><suffix>` (`KAMPF_GEDREHT`). */
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

/** Gebaute Figuren je Körperform und Frisur (`spielerBilderFuer`). */
const caches = new Map<string, SpielerBilder>();

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
  const { defs, roh, bereinigt: alleBereinigt } = koerperBilder();
  const um = mitUmzeichnung(umzeichnung, () => defs.map(([def, richtung]) => setzeZusammen(def, richtung)));
  return um.map((bild, i) => {
    const o = roh[i];
    const bereinigt = alleBereinigt[i];
    if (o === undefined || bereinigt === undefined) throw new Error(`Spieler: Frame ${i} fehlt`);
    bereinigt.pixel.forEach((c, p) => {
      if (c === o.pixel[p]) return;
      // The body took the character of a neighbour: the drawn-over frame takes its own character of that neighbour.
      bild.pixel[p] = c === LEER ? LEER : (nachbarGleich(bereinigt, p, c, bild) ?? c);
    });
    return bild;
  });
}

/** Die Frames in Sprite-Reihenfolge, der Körper unbereinigt und bereinigt (`koerperBilder`). */
interface KoerperBilder {
  readonly defs: readonly (readonly [FrameDef, Richtung])[];
  /** Je Frame der Körper ohne Umzeichnung, wie zusammengesetzt. */
  readonly roh: readonly Bild[];
  /** Je Frame derselbe Körper nach der Einzelpixel-Bereinigung. */
  readonly bereinigt: readonly Bild[];
}

let koerper: KoerperBilder | null = null;

/**
 * Der Körper, an dem `spielerBilderUmgezeichnet` die Bereinigung abliest: für jede Umzeichnung derselbe (zusammengesetzt
 * ohne Umzeichnung, M6-93) – einmal gebaut statt je Rüstungsteil; die Bilder werden nur gelesen.
 */
function koerperBilder(): KoerperBilder {
  if (koerper !== null) return koerper;
  const defs = frameDefs();
  const roh = defs.map(([def, richtung]) => setzeZusammen(def, richtung));
  const bereinigt = roh.map((o) => {
    const b: Bild = { ...o, pixel: [...o.pixel], sockel: { ...o.sockel } };
    bereinigeEinzelpixel(b, [basis, angezogen]);
    return b;
  });
  koerper = { defs, roh, bereinigt };
  return koerper;
}

/** Die Frame-Definitionen in Sprite-Reihenfolge (wie `baueAlle`): je Richtung alle Aktionen, danach die gedrehten Bilder. */
export function frameDefs(): (readonly [FrameDef, Richtung])[] {
  return [...RICHTUNGEN.flatMap((richtung) => ALLE_AKTIONEN.flatMap((a) => framesDerAktion(a, richtung).map((def) => [def, richtung] as const))), ...gedrehteDefs()];
}

/**
 * Alle Frames in Sprite-Reihenfolge, zusammengesetzt in Körperform und mit Kopfstil von `figur`, ohne Einzelpixel-Bereinigung
 * (die Sonde der Frisuren, assets-src/sprites/frisuren/frisuren.ts: welches Kopfpixel in welchem Frame zu sehen ist).
 */
export function spielerRohbilder(figur: { readonly form: KoerperForm; readonly kopf: KopfStil }): Bild[] {
  const defs = frameDefs();
  return mitFigur(figur, () => defs.map(([def, richtung]) => setzeZusammen(def, richtung)));
}

/** Alle Aktionen in Frame-Reihenfolge: Alltag (M3-05/M3-06), danach der Kampf (M6-10, `_spieler_kampf.ts`). */
const ALLE_AKTIONEN: readonly Aktion[] = [...AKTIONEN, ...KAMPF_AKTIONEN];

/**
 * Die gedrehten Körperbilder (`KAMPF_GEDREHT`, M6-Gate) in Frame-Reihenfolge: nach allen Bildern der Aktionen, damit deren
 * Frame-Nummern bleiben – je Eintrag die ersetzten Bilder in aufsteigendem Index.
 */
function gedrehteDefs(): (readonly [FrameDef, Richtung])[] {
  return KAMPF_GEDREHT.flatMap((g) =>
    Object.keys(g.bilder)
      .map(Number)
      .sort((a, b) => a - b)
      .map((i) => [g.bilder[i] as FrameDef, g.richtung] as const),
  );
}

/** Alle Frames und Clips der Figur bis M6 – Körperform `mittel`, der gezeichnete Kopf (einmal gebaut, danach aus dem Zwischenspeicher). */
export function spielerBilder(): SpielerBilder {
  return spielerBilderFuer({ form: 'mittel' });
}

/** Eine Figur zum Bauen: Körperform und Frisur (`stil` benennt die Frisur im Zwischenspeicher; ohne `kopf` der gezeichnete Kopf). */
export interface FigurWahl {
  readonly form: KoerperForm;
  readonly kopf?: { readonly stil: string; readonly zeichnen: KopfStil };
}

/**
 * Alle Frames und Clips der Figur in Körperform `form` mit der Frisur `kopf` (M7-53, M7-54): dieselben Aktionen, Frames und
 * Clips in derselben Reihenfolge wie `spielerBilder()` – Frame i gehört in jeder Form und mit jeder Frisur zu derselben Pose.
 * Mit `merken` einmal je Wahl gebaut, danach aus dem Zwischenspeicher.
 */
export function spielerBilderFuer(wahl: FigurWahl, merken = true): SpielerBilder {
  const key = `${wahl.form}|${wahl.kopf?.stil ?? ''}`;
  const known = caches.get(key);
  if (known !== undefined) return known;
  const gebaut = mitFigur({ form: wahl.form, kopf: wahl.kopf?.zeichnen ?? null }, baueAlle);
  // Frisuren werden nur einmal gelesen (ihr Layer-Auszug): ohne Merken bleibt der Speicher klein (je Figur ≈ 9 MB Zeichen).
  if (merken) caches.set(key, gebaut);
  return gebaut;
}

/** Baut alle Frames und Clips in der Körperform und mit der Frisur, die gerade gelten (`mitFigur`). */
function baueAlle(): SpielerBilder {
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
  // Gedrehte Varianten: die ersetzten Bilder hinten an. Eine Aktion mit gedrehten Bildern bekommt ihre gedrehten Clips in
  // allen Richtungen und beiden Drehsinnen (das Rig verlangt jede Richtung, wie bei den gedrehten Clips der Waffen); wo nichts
  // ersetzt ist, zeigen sie die ungedrehten Bilder.
  const ersatz = new Map<string, Map<number, number>>();
  for (const g of KAMPF_GEDREHT) {
    const name = `${g.aktion.name}_${g.richtung}${g.suffix}`;
    if (ersatz.has(name)) throw new Error(`Spieler: gedrehte Bilder zu ${name} doppelt`);
    const je = new Map<number, number>();
    for (const i of Object.keys(g.bilder).map(Number).sort((x, y) => x - y)) {
      const def = g.bilder[i];
      if (def === undefined || i >= framesDerAktion(g.aktion, g.richtung).length) throw new Error(`Spieler: gedrehtes Bild ${i} zu ${name} gibt es nicht`);
      je.set(i, bilder.length);
      bilder.push(baue(def, g.richtung));
    }
    ersatz.set(name, je);
  }
  for (const a of new Set(KAMPF_GEDREHT.map((g) => g.aktion))) {
    for (const richtung of RICHTUNGEN) {
      const erster = start[`${a.name}_${richtung}`];
      if (erster === undefined) throw new Error(`Spieler: gedrehte Bilder zu ${a.name}, die Aktion fehlt`);
      for (const suffix of Object.values(GEDREHT_SUFFIX)) {
        const name = `${a.name}_${richtung}${suffix}`;
        const je = ersatz.get(name);
        clips[name] = { frames: a.folge.map((i) => je?.get(i) ?? erster + i), fps: a.fps, loop: a.loop, events: a.events.map((e) => ({ ...e })) };
      }
    }
  }
  return { bilder, clips, start };
}
