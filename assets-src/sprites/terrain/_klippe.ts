/**
 * Klippen-Baukasten (M2-16/M2-18, MASTERPROMPT §4.4, docs/WORLD.md §7, docs/ART.md §3): setzt
 * `tileset_klippe_<gruppe>` in der Frame-Belegung `KLIPPE_FRAME` (src/world/autotile.ts) aus
 * handgezeichneten Quellstücken zusammen:
 * - `front`: zwei kachelbare 16×16-Wandtexturen (Frontfläche, zum Betrachter; Rippen, Schichten, Säulen),
 * - `fuss`: 16×6-Streifen am Wandfuß (Geröll, Verdeckung; `.` = Wand bleibt, `_` = Boden scheint durch),
 * - `rampe` und `treppe`: 16×16-Flächen (senkrecht kachelbar), aus denen auch die Kantenbrüche entstehen.
 * - `seite`: Seitenfläche (Außenecke der Wand, 6 px wie der Seitenrand der Plateaukachel darüber) – von
 *   der Seite gesehen, deshalb mit waagerechten Blockfugen; links und rechts gleich (§2.3 AO statt Richtung),
 * - `randNord`: Steinkante an der Nordkante.
 *
 * Rand (Frames 0–46, Blob-Maske = Nachbarn gleich hoch oder höher) liegt über dem Boden der
 * Plateaukachel und zeichnet nur außerhalb der Plateaufläche:
 * - Süd: Überhang des Oberbodens (`lippe.ueberhang`) mit hängenden Büscheln, darunter der Schatten unter
 *   dem Überhang, dann der Anfang der Front – die Wand selbst steht in den Kacheln darunter (16 px je
 *   Stufe), ihre Textur läuft über die Kachelgrenze weiter.
 * - Seiten: helle Kante, dann die Seitenfläche bis an den Kachelrand, außen die Kontur.
 * - Nord: nur die Steinkante (die Wand zeigt vom Betrachter weg).
 * - Innen an Nord- und Seitenkanten endet der Oberboden mit einem dunklen Saum (`saum`).
 */
import { BLOB_MASKS, KANTEN_BRUCH, KLIPPE_FRAME, WAND_SPALTE, WAND_ZEILE, klippenTilesetId, type KlippenGruppe } from '../../../src/world/autotile';
import { KACHEL, bereinige, blobFrame, male, type KantenGeometrie, type StilPixel } from '../../lib/blob';
import { PixelCanvas } from '../../lib/raster';
import { rasterRows, spriteFromPixels, type PixelFrameInput, type Sprite } from '../../lib/sprite';

/** Gruppe (Kontaktbogen) der Klippen-Tilesets. */
export const GRUPPE_KLIPPEN = 'klippen';
/** Zeichen in Fuß- und Bruchrastern: Untergrund bleibt sichtbar. */
const DURCH = '_';
/** Zeichen in Fuß-Rastern: die Wandtextur bleibt. */
const WAND = '.';
/** Spalten des Seitenflächen-Rasters. */
const SEITE_SPALTEN = 6;
/** Zeilen des Nordkanten-Rasters. */
const NORD_ZEILEN = 3;
/** Höhe des Fußstreifens in px. */
const FUSS_HOEHE = 6;
/** Versatz des Fußstreifens in der Wandvariante (Geröll nicht im 16-px-Takt). */
const FUSS_VERSATZ = 7;
/** Takt der gestuften Bruchkante in px und Lücke darin. */
const BRUCH_TAKT = 5;
const BRUCH_LUECKE = 3;
/** Breite der Wangen neben Rampe und Treppe in px. */
const WANGE = 3;

export interface KlippenStil {
  readonly gruppe: KlippenGruppe;
  /** Zeichen → Palettenreferenz für alle Raster dieser Gruppe. */
  readonly legende: Readonly<Record<string, string>>;
  /** Zwei kachelbare Frontflächen (Grundfassung, Variante). */
  readonly front: readonly [string, string];
  /**
   * Seitenfläche (Ost-/Westrand und Wandenden, schräg gesehen): 6 Spalten × 16 Zeilen, senkrecht
   * kachelbar; Spalte 0 = Kontur am Kachelrand, Spalte 5 = helle Kante an der Plateaufläche.
   */
  readonly seite: string;
  /** Nordkante: 16 Spalten × 3 Zeilen ab der Plateaufläche nach außen; `_` = Boden bleibt sichtbar. */
  readonly randNord: string;
  /** Saum des Oberbodens innen an Nord-, Ost- und Westkante (Gras endet an der Kante). */
  readonly saum: string;
  /** Fußstreifen (16×6). */
  readonly fuss: string;
  /** Kontur an Wandenden und Seitenrändern (dunkelste Stufe der Wandrampe). */
  readonly kontur: string;
  /** Helle Wandoberkante (sieht den Himmel). */
  readonly oberkante: string;
  /** Südlippe: Überhang des Oberbodens und Schatten darunter. */
  readonly lippe: { readonly ueberhang: string; readonly schatten: string };
  /** Rampe und Treppe (16×16, senkrecht kachelbar). */
  readonly rampe: string;
  readonly treppe: string;
  /** Kantenstücke des Rands (Einzug: Nord schmal, Süd Lippe, Seiten Seitenfläche). */
  readonly geometrie: KantenGeometrie;
  /** Positionen (x) hängender Überhang-Büschel an der Südlippe (1 = zwei Pixel tief). */
  readonly buesche: readonly number[];
}

function raster(text: string, w: number, h: number, wo: string): string[] {
  const rows = rasterRows(text);
  if (rows.length !== h || rows.some((r) => [...r].length !== w)) throw new Error(`Klippe ${wo}: Raster ${w}×${h} erwartet`);
  return rows;
}

function zeichen(rows: readonly string[], x: number, y: number): string {
  const r = rows[((y % rows.length) + rows.length) % rows.length] ?? '';
  return r[((x % r.length) + r.length) % r.length] ?? WAND;
}

function farbeVon(stil: KlippenStil, ch: string): string {
  const f = stil.legende[ch];
  if (f === undefined) throw new Error(`Klippe ${stil.gruppe}: Zeichen "${ch}" fehlt in der Legende`);
  return f;
}

/** Vorbereitete Quellstücke einer Gruppe. */
interface Quellen {
  readonly front: readonly (readonly string[])[];
  readonly seite: readonly string[];
  readonly randNord: readonly string[];
  readonly fuss: readonly string[];
  readonly rampe: readonly string[];
  readonly treppe: readonly string[];
}

function quellen(stil: KlippenStil): Quellen {
  return {
    front: stil.front.map((t, i) => raster(t, KACHEL, KACHEL, `front ${i}`)),
    seite: raster(stil.seite, SEITE_SPALTEN, KACHEL, 'seite'),
    randNord: raster(stil.randNord, KACHEL, NORD_ZEILEN, 'randNord'),
    fuss: raster(stil.fuss, KACHEL, FUSS_HOEHE, 'fuss'),
    rampe: raster(stil.rampe, KACHEL, KACHEL, 'rampe'),
    treppe: raster(stil.treppe, KACHEL, KACHEL, 'treppe'),
  };
}

/** Frontpixel (x, y) als Farbe. */
function wandFarbe(stil: KlippenStil, q: Quellen, variante: number, x: number, y: number): string {
  return farbeVon(stil, zeichen(q.front[variante] ?? q.front[0] ?? [], x, y));
}

/**
 * Seitenflächenpixel: `aussen` = Abstand zum Kachelrand (0 = Kontur), `innen` = Abstand zur
 * Plateaufläche (0 = helle Kante); dazwischen die Spalten 1–4 des Rasters.
 */
function seitenFarbe(stil: KlippenStil, q: Quellen, aussen: number, innen: number, y: number): string {
  const spalte = aussen === 0 ? 0 : innen === 0 ? SEITE_SPALTEN - 1 : Math.min(SEITE_SPALTEN - 2, aussen);
  return farbeVon(stil, zeichen(q.seite, spalte, y));
}

// ---------------------------------------------------------------------------------------------
// Rand (Blob 0–46)
// ---------------------------------------------------------------------------------------------

function randFaerbung(stil: KlippenStil, q: Quellen): (p: StilPixel) => string | null | undefined {
  return (p) => {
    if (p.innen) {
      // Der Oberboden endet an Nord- und Seitenkanten mit einem dunklen Saum.
      return p.tiefe === 0 && p.seite !== null && p.seite !== 's' ? stil.saum : undefined;
    }
    switch (p.seite) {
      case 's':
        if (p.tiefe === 0) return stil.lippe.ueberhang;
        if (p.tiefe === 1) return (stil.buesche[p.x] ?? 0) > 0 ? stil.lippe.ueberhang : stil.lippe.schatten;
        if (p.tiefe === 2 && (stil.buesche[p.x] ?? 0) > 1) return stil.lippe.ueberhang;
        if (p.tiefe === 2 && (stil.buesche[p.x] ?? 0) > 0) return stil.lippe.schatten;
        return wandFarbe(stil, q, 0, p.x, p.y);
      case 'n': {
        if (p.tiefe >= NORD_ZEILEN) return undefined;
        const ch = zeichen(q.randNord, p.x, p.tiefe);
        return ch === DURCH ? undefined : farbeVon(stil, ch);
      }
      case 'w':
      case 'o':
        return seitenFarbe(stil, q, p.seite === 'w' ? p.x : KACHEL - 1 - p.x, p.tiefe, p.y);
      default:
        return undefined;
    }
  };
}

function randFrame(stil: KlippenStil, q: Quellen, maske: number): PixelFrameInput {
  return blobFrame(
    {
      id: klippenTilesetId(stil.gruppe),
      group: GRUPPE_KLIPPEN,
      art: 'kante',
      geometrie: stil.geometrie,
      varianten: [{ index: new Uint8Array(KACHEL * KACHEL), emissive: new Uint8Array(KACHEL * KACHEL), material: new Uint8Array(KACHEL * KACHEL), heightOverride: null }],
      basis: stil.kontur,
      fuellung: 'textur',
      faerbung: randFaerbung(stil, q),
    },
    maske,
  );
}

// ---------------------------------------------------------------------------------------------
// Wand, Rampe, Treppe
// ---------------------------------------------------------------------------------------------

/** Breite der Seitenfläche an Wandenden je Zeile: Läufe von 3 px, oben an der Fuge des Seitenrands (6). */
const SEITE_VERLAUF = [6, 6, 6, 6, 5, 5, 5, 6, 6, 6, 7, 7, 7, 6, 6, 6];
/** Breite der Seitenfläche, falls der Verlauf endet. */
const SEITE_BREITE = 6;

function linksEnde(spalte: number): boolean {
  return spalte === WAND_SPALTE.links || spalte === WAND_SPALTE.einzeln;
}
function rechtsEnde(spalte: number): boolean {
  return spalte === WAND_SPALTE.rechts || spalte === WAND_SPALTE.einzeln;
}
function hatFuss(zeile: number): boolean {
  return zeile === WAND_ZEILE.unten || zeile === WAND_ZEILE.einzeln;
}
function hatKopf(zeile: number): boolean {
  return zeile === WAND_ZEILE.oben || zeile === WAND_ZEILE.einzeln;
}

/** Seitenfläche an den Wandenden: Außenecke mit Kontur am Kachelrand und heller Kante zur Front. */
function enden(k: PixelCanvas, stil: KlippenStil, q: Quellen, spalte: number): void {
  for (let y = 0; y < KACHEL; y++) {
    const b = SEITE_VERLAUF[y] ?? SEITE_BREITE;
    for (let i = 0; i < b; i++) {
      const seiten: Array<[boolean, number]> = [
        [linksEnde(spalte), i],
        [rechtsEnde(spalte), KACHEL - 1 - i],
      ];
      for (const [aktiv, x] of seiten) {
        if (!aktiv) continue;
        male(k, x, y, seitenFarbe(stil, q, i, b - 1 - i, y));
      }
    }
  }
}

/** Fußstreifen: Geröll und Verdeckung am Wandfuß, `_` lässt den Boden durchscheinen. */
function fuss(k: PixelCanvas, stil: KlippenStil, q: Quellen, spalte: number, versatz: number): void {
  for (let r = 0; r < FUSS_HOEHE; r++) {
    const y = KACHEL - FUSS_HOEHE + r;
    for (let x = 0; x < KACHEL; x++) {
      const ch = zeichen(q.fuss, x + versatz, r);
      if (ch === WAND) continue;
      if (ch === DURCH) k.clear(x, y);
      else male(k, x, y, farbeVon(stil, ch));
    }
  }
  // Wandende: die unterste Ecke gerundet (der Boden läuft um den Fuß herum).
  const ecken: Array<[boolean, number, number]> = [
    [linksEnde(spalte), 0, 1],
    [rechtsEnde(spalte), KACHEL - 1, -1],
  ];
  for (const [aktiv, x0, dx] of ecken) {
    if (!aktiv) continue;
    k.clear(x0, KACHEL - 1);
    k.clear(x0 + dx, KACHEL - 1);
    k.clear(x0, KACHEL - 2);
  }
}

function wandStueck(stil: KlippenStil, q: Quellen, zeile: number, spalte: number, variante: number): PixelFrameInput {
  const k = new PixelCanvas(KACHEL, KACHEL);
  for (let y = 0; y < KACHEL; y++) for (let x = 0; x < KACHEL; x++) male(k, x, y, wandFarbe(stil, q, variante, x, y));
  enden(k, stil, q, spalte);
  if (hatFuss(zeile)) fuss(k, stil, q, spalte, variante * FUSS_VERSATZ);
  bereinige(k);
  return k.toFrame();
}

/** Rampe oder Treppe an einer Südkante: Fläche, Wangen zu den Nachbarwänden, Kopf und Fuß. */
function uebergangsStueck(stil: KlippenStil, q: Quellen, flaeche: readonly string[], zeile: number, spalte: number): PixelFrameInput {
  const k = new PixelCanvas(KACHEL, KACHEL);
  for (let y = 0; y < KACHEL; y++) for (let x = 0; x < KACHEL; x++) male(k, x, y, farbeVon(stil, zeichen(flaeche, x, y)));
  for (let y = 0; y < KACHEL; y++) {
    for (let i = 0; i < WANGE; i++) {
      const farbe = seitenFarbe(stil, q, i, WANGE - 1 - i, y);
      if (linksEnde(spalte)) male(k, i, y, farbe);
      if (rechtsEnde(spalte)) male(k, KACHEL - 1 - i, y, farbe);
    }
  }
  if (hatFuss(zeile)) {
    // Der Weg läuft in den Boden aus: unterste Reihe lückig, darüber verdeckter Fuß der Wangen.
    for (let x = 0; x < KACHEL; x++) if (x % 5 === 1 || x % 5 === 2 || x < WANGE || x >= KACHEL - WANGE) k.clear(x, KACHEL - 1);
  }
  if (hatKopf(zeile)) {
    // Oberkante: die Fläche beginnt unter der Plateaukante mit einer hellen Reihe.
    for (let x = WANGE; x < KACHEL - WANGE; x++) if (x % 4 !== 0) male(k, x, 0, stil.oberkante);
  }
  bereinige(k);
  return k.toFrame();
}

/**
 * Kantenbruch (Rampe/Treppe an Nord-, Ost- oder Westkante) über dem Boden der Plateaukachel: der
 * untere Ausschnitt der Fläche über die ganze Kachelbreite (mehrere Bruchkacheln nebeneinander
 * ergeben eine breite Treppe), an der Plateaufläche eine helle Kante. Nord: Zeilen 0–6; Ost/West:
 * 7 Spalten, die Fläche um 90° gedreht.
 */
function bruchStueck(stil: KlippenStil, flaeche: readonly string[], richtung: number): PixelFrameInput {
  const k = new PixelCanvas(KACHEL, KACHEL);
  const tief = 7;
  for (let y = 0; y < KACHEL; y++) {
    for (let x = 0; x < KACHEL; x++) {
      let u: number;
      let v: number;
      if (richtung === KANTEN_BRUCH.n) {
        if (y >= tief) continue;
        u = x;
        v = y;
      } else {
        const d = richtung === KANTEN_BRUCH.w ? x : KACHEL - 1 - x;
        if (d >= tief) continue;
        u = y;
        v = d;
      }
      // Helle Kante zur Plateaufläche: gestuft und lückig, keine durchgehende 1-px-Linie (§2.5).
      const kante = (u % BRUCH_TAKT === 0 ? v === tief - 2 : v === tief - 1) && u % BRUCH_TAKT !== BRUCH_LUECKE;
      male(k, x, y, kante ? stil.oberkante : farbeVon(stil, zeichen(flaeche, u, v + KACHEL - tief)));
    }
  }
  bereinige(k);
  return k.toFrame();
}

/**
 * Standard-Kantenstücke des Klippenrands: Nord 3 px (Steinkante), Süd 5 px (Lippe und Wandanfang),
 * Seiten 6 px (Seitenfläche, gleich breit wie die Seitenfläche der Wandenden darunter).
 */
export const GEOMETRIE_KLIPPE: KantenGeometrie = {
  profile: {
    n: [
      [3, 3, 3, 2, 2, 3, 3, 4, 4, 3, 3, 2, 2, 3, 3, 3],
      [3, 3, 3, 4, 4, 3, 2, 2, 2, 3, 3, 4, 3, 3, 3, 3],
    ],
    s: [
      [5, 5, 5, 4, 4, 4, 5, 6, 6, 6, 5, 4, 4, 5, 5, 5],
      [5, 5, 5, 6, 6, 5, 5, 4, 4, 4, 5, 5, 6, 5, 5, 5],
    ],
    w: [
      [6, 6, 6, 5, 5, 5, 6, 6, 6, 7, 7, 7, 6, 6, 6, 6],
      [6, 6, 6, 7, 7, 7, 6, 6, 5, 5, 5, 6, 6, 6, 6, 6],
    ],
    o: [
      [6, 6, 6, 7, 7, 7, 6, 6, 6, 5, 5, 5, 6, 6, 6, 6],
      [6, 6, 6, 5, 5, 5, 6, 6, 7, 7, 7, 6, 6, 6, 6, 6],
    ],
  },
  eckenRadien: [1, 2],
  innenFormen: [2, 3],
};

/** Das Klippen-Tileset einer Gruppe in der Belegung `KLIPPE_FRAME`. */
export function klippenTileset(stil: KlippenStil): Sprite {
  const q = quellen(stil);
  const frames: PixelFrameInput[] = BLOB_MASKS.map((m) => randFrame(stil, q, m));
  const zeilen = Object.values(WAND_ZEILE);
  const spalten = Object.values(WAND_SPALTE);
  for (const z of zeilen) for (const s of spalten) frames.push(wandStueck(stil, q, z, s, 0));
  for (const z of zeilen) frames.push(wandStueck(stil, q, z, WAND_SPALTE.mitte, 1));
  for (const z of zeilen) for (const s of spalten) frames.push(uebergangsStueck(stil, q, q.rampe, z, s));
  for (const z of zeilen) for (const s of spalten) frames.push(uebergangsStueck(stil, q, q.treppe, z, s));
  for (const r of Object.values(KANTEN_BRUCH)) frames.push(bruchStueck(stil, q.rampe, r));
  for (const r of Object.values(KANTEN_BRUCH)) frames.push(bruchStueck(stil, q.treppe, r));
  if (frames.length !== KLIPPE_FRAME.anzahl) throw new Error(`Klippe ${stil.gruppe}: ${frames.length} Frames statt ${KLIPPE_FRAME.anzahl}`);
  return spriteFromPixels({ id: klippenTilesetId(stil.gruppe), group: GRUPPE_KLIPPEN, size: [KACHEL, KACHEL], anchor: [0, 0], hoehe: 'flach' }, frames);
}
