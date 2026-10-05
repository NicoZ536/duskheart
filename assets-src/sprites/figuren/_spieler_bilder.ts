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
import { bildDerPose, mitUmzeichnung, type TeilUmzeichnung } from './_spieler_rig';

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
  const defs = [...RICHTUNGEN.flatMap((richtung) => ALLE_AKTIONEN.flatMap((a) => framesDerAktion(a, richtung).map((def) => [def, richtung] as const))), ...gedrehteDefs()];
  const roh = defs.map(([def, richtung]) => setzeZusammen(def, richtung));
  const bereinigt = roh.map((o) => {
    const b: Bild = { ...o, pixel: [...o.pixel], sockel: { ...o.sockel } };
    bereinigeEinzelpixel(b, [basis, angezogen]);
    return b;
  });
  koerper = { defs, roh, bereinigt };
  return koerper;
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
  cache = { bilder, clips, start };
  return cache;
}
