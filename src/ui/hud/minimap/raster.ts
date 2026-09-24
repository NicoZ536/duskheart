/**
 * Kartenraster der Minimap (M3-28): ein Chunk (32×32 Kacheln, docs/WORLD.md §3) wird zu 32×32
 * Palettenindizes – eine Farbe je Kachel (`farben.ts`) –, dazu zwei verkleinerte Stufen (16×16, 8×8) für
 * die weiten Zoomstufen. Verkleinert wird nach Mehrheit je 2×2 (keine Mischfarben: jede Kartenfarbe bleibt
 * eine Palettenfarbe).
 *
 * Aufdeckung (Hook für die Karte M7, §25 „Nebel über Unerkundetem“): Eine `AufdeckungQuelle` liefert je
 * Chunk eine 32×32-Maske; nicht aufgedeckte Kacheln zeigt die Karte als Nebel. Bis M7 ist alles
 * aufgedeckt, was die Minimap je geladen gesehen hat (`ALLES_AUFGEDECKT`).
 */
import type { Layer } from '../../../world/model/coords';
import { CHUNK_AREA, CHUNK_SIZE } from '../../../world/model/coords';
import {
  TILE_FLAG_BRIDGE,
  TILE_FLAG_RAMP,
  TILE_FLAG_ROAD,
  TILE_FLAG_STAIRS,
  WATER_DEPTH_DEEP,
  WATER_DEPTH_MASK,
  WATER_FROZEN,
  WATER_SEA,
} from '../../../world/model/chunk';
import type { KartenFarbtabellen } from './farben';
import { rampenStufe } from './palette';

/** Lesesicht auf die Kachelfelder eines Chunks (`ChunkData` erfüllt sie). */
export interface KartenChunk {
  readonly ground: Uint8Array;
  readonly height: Uint8Array;
  readonly biome: Uint8Array;
  readonly water: Uint8Array;
  readonly solid: Uint8Array;
  readonly flags: Uint8Array;
  readonly object: Uint16Array;
}

/**
 * Welche Kacheln aufgedeckt sind (Hook für die Weltkarte M7). `version` steigt, sobald sich die Aufdeckung
 * ändert (die Minimap rastert dann neu).
 */
export interface AufdeckungQuelle {
  readonly version: number;
  /** 32×32-Maske des Chunks (≠ 0 = aufgedeckt), oder `null` = der ganze Chunk ist aufgedeckt. */
  maske(ebene: Layer, cx: number, cy: number): Uint8Array | null;
}

/** Bis zur Weltkarte (M7): alles Geladene gilt als aufgedeckt. */
export const ALLES_AUFGEDECKT: AufdeckungQuelle = { version: 0, maske: () => null };

/** Kantenlängen der drei Raster-Stufen (Kacheln je Chunk-Seite: 1, 2, 4 Kacheln je Punkt). */
export const RASTER_SEITEN = [CHUNK_SIZE, CHUNK_SIZE / 2, CHUNK_SIZE / 4] as const;

/** Die Raster eines Chunks: Stufe 0 (32×32), 1 (16×16), 2 (8×8). */
export type ChunkRaster = readonly [Uint8Array, Uint8Array, Uint8Array];

export function neuesChunkRaster(): ChunkRaster {
  return [new Uint8Array(CHUNK_AREA), new Uint8Array(CHUNK_AREA / 4), new Uint8Array(CHUNK_AREA / 16)];
}

/** Letzte Zeile eines Chunks (Nachbar im Norden) → Index-Versatz. */
const LETZTE_ZEILE = CHUNK_AREA - CHUNK_SIZE;

/**
 * Kartenfarbe (Palettenindex) der Kachel `i` von `c`. `hoeheNord` ist die Höhenstufe der Kachel nördlich
 * davon (für die Schattenzeile unter Klippen; ohne Nachbarn die eigene).
 */
export function kachelFarbe(c: KartenChunk, i: number, unterirdisch: boolean, hoeheNord: number, wald: boolean, t: KartenFarbtabellen): number {
  const w = c.water[i] ?? 0;
  const f = c.flags[i] ?? 0;
  const tiefe = w & WATER_DEPTH_MASK;
  if ((f & TILE_FLAG_BRIDGE) !== 0) return t.bruecke;
  if (tiefe !== 0) {
    if ((w & WATER_FROZEN) !== 0) return t.wasserEis;
    if (tiefe === WATER_DEPTH_DEEP) return (w & WATER_SEA) !== 0 ? t.wasserMeer : t.wasserTief;
    return t.wasserFlach;
  }
  if (!unterirdisch && (f & TILE_FLAG_STAIRS) !== 0) return t.eingang;
  if (unterirdisch && (f & TILE_FLAG_RAMP) !== 0) return t.aufgang;
  const fest = c.solid[i] ?? 0;
  if (fest !== 0) return (t.erzader[fest] ?? 0) !== 0 ? t.erzFarbe : (t.boden[fest] || t.nebel);
  const g = c.ground[i] ?? 0;
  let farbe = t.boden[g] ?? 0;
  if (farbe === 0) return t.nebel;
  let toenen = (t.bodenGetoent[g] ?? 0) !== 0;
  if ((f & TILE_FLAG_ROAD) !== 0 && farbe !== t.strasse) {
    farbe = t.strasse;
    toenen = false;
  } else if (wald) {
    farbe = t.wald;
    toenen = true;
  }
  if (toenen) {
    const zeile = t.biomZeile[c.biome[i] ?? 0];
    if (zeile) farbe = zeile[farbe] ?? farbe;
  }
  // Schattenzeile unter einer höheren Stufe: die Klippenkante ist auf der Karte als dunkle Linie lesbar.
  if (hoeheNord > (c.height[i] ?? 0)) farbe = rampenStufe(farbe, -1);
  return farbe;
}

/**
 * Rastert `c` nach `out[0]` (32×32) und verkleinert nach `out[1]`/`out[2]`. `nord` ist der Chunk nördlich
 * davon (Klippenschatten in Zeile 0), `maske` die Aufdeckung (`null` = alles).
 */
export function rastereChunk(c: KartenChunk, ebene: Layer, nord: KartenChunk | undefined, maske: Uint8Array | null, t: KartenFarbtabellen, out: ChunkRaster): void {
  const unterirdisch = ebene < 0;
  const r0 = out[0];
  zaehleWald(c, t);
  for (let i = 0; i < CHUNK_AREA; i++) {
    if (maske !== null && (maske[i] ?? 0) === 0) {
      r0[i] = t.nebel;
      continue;
    }
    const hoeheNord = i >= CHUNK_SIZE ? (c.height[i - CHUNK_SIZE] ?? 0) : nord !== undefined ? (nord.height[i + LETZTE_ZEILE] ?? 0) : (c.height[i] ?? 0);
    r0[i] = kachelFarbe(c, i, unterirdisch, hoeheNord, istWald(i), t);
  }
  verkleinere(r0, RASTER_SEITEN[0], out[1]);
  verkleinere(out[1], RASTER_SEITEN[1], out[2]);
}

/** Bäume im gerundeten 5×5-Fenster um eine Kachel, ab denen sie als Wald gilt. */
export const WALD_SCHWELLE = 3;
/** Halbe Fensterbreite der Walddichte. */
const WALD_FENSTER = 2;
const SUMMEN_SEITE = CHUNK_SIZE + 1;
/** Summierte Baumzahlen (Integralbild 33×33) des gerade gerasterten Chunks – einmal angelegt. */
const summen = new Uint16Array(SUMMEN_SEITE * SUMMEN_SEITE);
/** Chunk und Tabellen des Integralbilds (für die Ecken des Fensters). */
let waldChunk: KartenChunk | null = null;
let waldTabellen: KartenFarbtabellen | null = null;

/** Ein Baum auf der Kachel (x, y) des gezählten Chunks (außerhalb: keiner). */
function baumAn(x: number, y: number): number {
  if (waldChunk === null || waldTabellen === null || x < 0 || y < 0 || x >= CHUNK_SIZE || y >= CHUNK_SIZE) return 0;
  return waldTabellen.baum[waldChunk.object[y * CHUNK_SIZE + x] ?? 0] ?? 0;
}

function zaehleWald(c: KartenChunk, t: KartenFarbtabellen): void {
  waldChunk = c;
  waldTabellen = t;
  for (let y = 0; y < CHUNK_SIZE; y++) {
    let zeile = 0;
    for (let x = 0; x < CHUNK_SIZE; x++) {
      zeile += t.baum[c.object[y * CHUNK_SIZE + x] ?? 0] ?? 0;
      summen[(y + 1) * SUMMEN_SEITE + x + 1] = (summen[y * SUMMEN_SEITE + x + 1] ?? 0) + zeile;
    }
  }
}

/**
 * Ob Kachel `i` des zuletzt gezählten Chunks im Wald liegt: Bäume im 5×5-Fenster ohne seine vier Ecken
 * (ein gerundetes Fenster – Waldränder werden rund statt treppig), am Chunkrand beschnitten.
 */
function istWald(i: number): boolean {
  const x = i % CHUNK_SIZE;
  const y = (i - x) / CHUNK_SIZE;
  const x0 = Math.max(0, x - WALD_FENSTER);
  const y0 = Math.max(0, y - WALD_FENSTER);
  const x1 = Math.min(CHUNK_SIZE, x + WALD_FENSTER + 1);
  const y1 = Math.min(CHUNK_SIZE, y + WALD_FENSTER + 1);
  const n = (summen[y1 * SUMMEN_SEITE + x1] ?? 0) - (summen[y0 * SUMMEN_SEITE + x1] ?? 0) - (summen[y1 * SUMMEN_SEITE + x0] ?? 0) + (summen[y0 * SUMMEN_SEITE + x0] ?? 0);
  const ecken =
    baumAn(x - WALD_FENSTER, y - WALD_FENSTER) + baumAn(x + WALD_FENSTER, y - WALD_FENSTER) + baumAn(x - WALD_FENSTER, y + WALD_FENSTER) + baumAn(x + WALD_FENSTER, y + WALD_FENSTER);
  return n - ecken >= WALD_SCHWELLE;
}

/** Mehrheitsfarbe von vier Werten (bei Gleichstand der erste der häufigsten, in Lesereihenfolge). */
export function mehrheit(a: number, b: number, c: number, d: number): number {
  if (a === b || a === c || a === d) return a;
  if (b === c || b === d) return b;
  if (c === d) return c;
  return a;
}

/** Halbiert ein quadratisches Raster der Seite `seite` nach `ziel` (Seite `seite / 2`), je 2×2 die Mehrheit. */
export function verkleinere(quelle: Uint8Array, seite: number, ziel: Uint8Array): void {
  const halb = seite >> 1;
  for (let y = 0; y < halb; y++) {
    for (let x = 0; x < halb; x++) {
      const i = y * 2 * seite + x * 2;
      ziel[y * halb + x] = mehrheit(quelle[i] ?? 0, quelle[i + 1] ?? 0, quelle[i + seite] ?? 0, quelle[i + seite + 1] ?? 0);
    }
  }
}
