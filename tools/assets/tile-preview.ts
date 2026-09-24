/**
 * Boden- und Biom-Vorschau (MASTERPROMPT §5 „Qualitätsschleife“, M1-02/M1-22): zeigt Sprites im
 * Zusammenhang statt einzeln, damit Kachelnähte, Wiederholungsmuster, Größenverhältnisse und
 * Biom-Tönungen beurteilt werden können.
 *
 * - `vorschau_gruenhain.png`: 6×6-Kachelfelder (Gras, Erde, Weg quer, Weg längs; Varianten per
 *   Koordinaten-Hash gewichtet gestreut und wie im Renderer waagerecht gespiegelt) und eine Szene
 *   (Boden, Weg, Baum, Felsen, stehende Fackel am Wegrand, Spielerfigur in vier Richtungen,
 *   y-sortiert nach Anker).
 * - `biome.png`: dieselbe Kleinszene durch jede Biom-Palettenzeile (`BIOME_TINTS`) mit den Feldern
 *   Grundton, Akzent und Nachtfarbe – der Biom-Paletten-Kontaktbogen aus docs/ART.md §5.
 * - `autotile-<terrain>.png` (M2-17/M2-18): die 47 Blob-Frames über dem typischen tieferen Nachbarn,
 *   die Vollfeld-Varianten, ein 6×6-Feld und zwei Inselkarten (Terrain im Partner und umgekehrt), gelegt
 *   nach der Übergangsregel aus `src/world/autotile.ts` (`Uebergaenge.ebenen`) durch die Biomzeile.
 * - `autotile-uebergaenge.png`: Übergangsszenen mit mehreren Terrains je Biom.
 * - `klippen-rampen.png` (M2-16): Höhenkarte 0–3 mit Wänden je Stufe, Außen- und Innenecken,
 *   Rampen und Treppen an Süd-, Nord-, Ost- und Westkanten für jede Klippen-Gruppe
 *   (`klippenFrames`), `autotile-klippen.png`: alle Frames der Klippen-Tilesets.
 *
 * Fehlt ein Sprite, bleibt seine Stelle leer und der Bogenkopf nennt es.
 * CLI: `tsx tools/assets/tile-preview.ts` → `tools/out/sheets/`.
 */
import { join } from 'node:path';
import { flatPalette, paletteIndex } from '../../assets-src/palette';
import { BIOME_TINTS, PALETTE_ROWS, paletteRowIndex, type PaletteRow } from '../../assets-src/paletteRows';
import { TRANSPARENT, type Sprite } from '../../assets-src/lib/sprite';
import { hash2, hashToUnit } from '../../src/engine/rng';
import { TERRAIN } from '../../src/content/terrain';
import {
  BLOB_ANZAHL,
  BLOB_INSEL,
  BLOB_VOLL,
  KLIPPE_FRAME,
  RICHTUNGEN,
  SAUM_TERRAIN,
  TERRAIN_REIHENFOLGE,
  TILESET_VARIANTEN_START,
  UEBERGANG,
  Uebergaenge,
  VERSATZ,
  klippenFrames,
  klippenTilesetId,
  tilesetId,
  type KachelEbene,
  type KlippenGruppe,
  type KlippenUmgebung,
  type TerrainArt,
} from '../../src/world/autotile';
import { GLYPH_H, drawText, textWidth } from '../lib/font';
import { writeIfChanged } from '../lib/files';
import { RgbaImage, hexRgba, type Rgba } from '../lib/image';
import { loadSprites } from './sources';

/** Kachelkante in px (docs/ARCHITEKTUR.md „Welt“). */
const TILE = 16;
/** Kacheln je Seite eines Vorschau-Feldes. */
const FIELD_TILES = 6;
/** Vergrößerungen: Kachelfelder, Szene, Biom-Felder. */
const FIELD_SCALE = 4;
const SCENE_SCALE = 3;
const BIOME_SCALE = 2;
/** Szenengröße in Kacheln. */
const SCENE_W = 20;
const SCENE_H = 12;
/** Biom-Kleinszene in Kacheln. */
const BIOME_W = 7;
const BIOME_H = 5;
/** Biom-Felder je Zeile auf `biome.png`. */
const BIOME_COLUMNS = 4;
/** Ränder und Abstände auf den Bögen. */
const MARGIN = 16;
const GAP = 20;
const LABEL_SCALE = 2;
const LABEL_H = GLYPH_H * LABEL_SCALE + 6;
/** Kantenlänge der Farbfelder (Grundton, Akzent, Nacht). */
const SWATCH = 14;
/** Seeds der Variantenstreuung je Feld (fest, damit der Bogen reproduzierbar ist). */
const SEED = { gras: 11, erde: 23, quer: 37, laengs: 41, szene: 53, biom: 67 } as const;

/** Sprite-Ids der Grünhain-Grundserie. */
const IDS = {
  gras: 'boden_gras',
  erde: 'boden_erde',
  kante: 'boden_gras_kante',
  felsKlein: 'fels_klein',
  felsGross: 'fels_gross',
  baum: 'baum_laub',
  fackel: 'fackel_stand',
  spieler: 'spieler_koerper',
} as const;
/** Frames von `boden_gras_kante`: Seite, auf der das Gras liegt. */
const KANTE = { oben: 0, unten: 1, links: 2, rechts: 3 } as const;

const COLORS = {
  sheet: hexRgba('#1a1426'),
  text: hexRgba('#f4ecd8'),
  muted: hexRgba('#7e8393'),
  frame: hexRgba('#2a2238'),
} as const;

const PALETTE_RGBA: readonly Rgba[] = flatPalette().map(hexRgba);

type Ground = 'gras' | 'erde' | { readonly kante: keyof typeof KANTE };

/** Welt in Pixeln als Palettenindizes (0 = leer). */
class IndexCanvas {
  readonly index: Uint8Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.index = new Uint8Array(w * h);
  }

  /** Zeichnet Frame `frame` mit der linken oberen Ecke bei (x, y), auf Wunsch waagerecht gespiegelt. */
  blit(s: Sprite, frame: number, x: number, y: number, mirror = false): void {
    const f = s.frames[frame] ?? s.frames[0];
    if (f === undefined) return;
    for (let sy = 0; sy < s.h; sy++) {
      for (let sx = 0; sx < s.w; sx++) {
        const v = f.index[sy * s.w + (mirror ? s.w - 1 - sx : sx)] ?? TRANSPARENT;
        const tx = x + sx;
        const ty = y + sy;
        if (v === TRANSPARENT || tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
        this.index[ty * this.w + tx] = v;
      }
    }
  }

  /** Zeichnet Frame `frame` mit dem Anker bei (x, y). */
  place(s: Sprite, frame: number, x: number, y: number): void {
    this.blit(s, frame, x - s.anchor[0], y - s.anchor[1]);
  }

  /** Überträgt die Welt durch die Palettenzeile `row` vergrößert ins Bild. */
  draw(img: RgbaImage, dx: number, dy: number, scale: number, row: PaletteRow): void {
    img.drawScaled(dx, dy, this.w, this.h, scale, (x, y) => {
      const v = this.index[y * this.w + x] ?? TRANSPARENT;
      if (v === TRANSPARENT) return null;
      return PALETTE_RGBA[(row.map[v - 1] ?? v) - 1] ?? null;
    });
  }
}

interface Library {
  get(id: string): Sprite | undefined;
  readonly missing: Set<string>;
}

async function library(spritesDir: string): Promise<Library> {
  const { sprites, errors } = await loadSprites(spritesDir);
  if (errors.length > 0) throw new Error(`Sprite-Quellen fehlerhaft:\n  ${errors.join('\n  ')}`);
  const byId = new Map(sprites.map((l) => [l.sprite.id, l.sprite]));
  const missing = new Set<string>();
  return {
    missing,
    get(id) {
      const s = byId.get(id);
      if (s === undefined) missing.add(id);
      return s;
    },
  };
}

/**
 * Streugewichte der Kachelvarianten (docs/ART.md §3): ruhige Varianten häufig, auffällige selten –
 * dieselben Gewichte soll die Weltgenerierung verwenden. Ohne Eintrag: gleich verteilt.
 */
const VARIANT_WEIGHTS: Readonly<Record<string, readonly number[]>> = {
  [IDS.gras]: [3, 3, 3, 1],
  [IDS.erde]: [2, 2, 3, 1],
};

/**
 * Kacheln, die wie in der Kachelkarte des Renderers (`src/render/tilemap/sceneKit.ts`, `mirror`)
 * waagerecht gespiegelt werden dürfen: ungerichteter Boden und die Grasränder oben/unten. So zeigt die
 * Vorschau dieselbe Vielfalt wie das Spiel.
 */
const MIRRORED: ReadonlySet<string> = new Set([IDS.gras, IDS.erde]);
const MIRRORED_KANTEN: ReadonlySet<number> = new Set([KANTE.oben, KANTE.unten]);
/** Salz des Spiegel-Hashes (unabhängig von der Variantenwahl). */
const MIRROR_SALT = 0x5eed;
/** Anteil gespiegelter Kacheln. */
const MIRROR_SHARE = 0.5;

function mirrored(tx: number, ty: number, seed: number): boolean {
  return hashToUnit(hash2(tx, ty, seed ^ MIRROR_SALT)) < MIRROR_SHARE;
}

/** Variante einer Kachel aus dem Koordinaten-Hash (deterministisch, gewichtet). */
function variant(s: Sprite, tx: number, ty: number, seed: number): number {
  const u = hashToUnit(hash2(tx, ty, seed));
  const weights = VARIANT_WEIGHTS[s.id];
  if (weights?.length !== s.frames.length) return Math.floor(u * s.frames.length);
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += (weights[i] ?? 0) / total;
    if (u < acc) return i;
  }
  return weights.length - 1;
}

/** Legt eine Kachelfläche `ground(tx, ty)` in den Canvas. */
function paintGround(lib: Library, c: IndexCanvas, tilesW: number, tilesH: number, seed: number, ground: (tx: number, ty: number) => Ground): void {
  for (let ty = 0; ty < tilesH; ty++) {
    for (let tx = 0; tx < tilesW; tx++) {
      const g = ground(tx, ty);
      if (g === 'gras' || g === 'erde') {
        const s = lib.get(g === 'gras' ? IDS.gras : IDS.erde);
        if (s !== undefined) c.blit(s, variant(s, tx, ty, seed), tx * TILE, ty * TILE, MIRRORED.has(s.id) && mirrored(tx, ty, seed));
      } else {
        const s = lib.get(IDS.kante);
        const frame = KANTE[g.kante];
        if (s !== undefined) c.blit(s, frame, tx * TILE, ty * TILE, MIRRORED_KANTEN.has(frame) && mirrored(tx, ty, seed));
      }
    }
  }
}

/** Weg quer: Gras oben, Kante, zwei Reihen Erde, Kante, Gras unten. */
function pathAcross(rowStart: number): (tx: number, ty: number) => Ground {
  return (_tx, ty) => {
    const r = ty - rowStart;
    if (r === 0) return { kante: 'oben' };
    if (r === 1 || r === 2) return 'erde';
    if (r === 3) return { kante: 'unten' };
    return 'gras';
  };
}

/** Weg längs: Gras links, Kante, zwei Spalten Erde, Kante, Gras rechts. */
function pathAlong(colStart: number): (tx: number, ty: number) => Ground {
  return (tx) => {
    const c = tx - colStart;
    if (c === 0) return { kante: 'links' };
    if (c === 1 || c === 2) return 'erde';
    if (c === 3) return { kante: 'rechts' };
    return 'gras';
  };
}

/** Objekt einer Szene: Sprite, Frame, Anker in Welt-px. */
interface Prop {
  readonly id: string;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
}

/** Zeichnet Objekte y-sortiert nach Anker (wie der Renderer, docs/RENDER.md §3). */
function paintProps(lib: Library, c: IndexCanvas, props: readonly Prop[]): void {
  const sorted = [...props].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const p of sorted) {
    const s = lib.get(p.id);
    if (s !== undefined) c.place(s, p.frame, p.x, p.y);
  }
}

/** Erster Frame des Idle-Clips einer Richtung (oder Frame 0). */
function idleFrame(lib: Library, dir: string): number {
  return lib.get(IDS.spieler)?.clips[`idle_${dir}`]?.frames[0] ?? 0;
}

function field(lib: Library, seed: number, ground: (tx: number, ty: number) => Ground): IndexCanvas {
  const c = new IndexCanvas(FIELD_TILES * TILE, FIELD_TILES * TILE);
  paintGround(lib, c, FIELD_TILES, FIELD_TILES, seed, ground);
  return c;
}

const PATH_ROW = 6;

function scene(lib: Library): IndexCanvas {
  const c = new IndexCanvas(SCENE_W * TILE, SCENE_H * TILE);
  paintGround(lib, c, SCENE_W, SCENE_H, SEED.szene, pathAcross(PATH_ROW));
  const t = (n: number): number => n * TILE;
  paintProps(lib, c, [
    { id: IDS.baum, frame: 0, x: t(4), y: t(5) + 2 },
    { id: IDS.baum, frame: 0, x: t(15) + 8, y: t(4) },
    { id: IDS.felsGross, frame: 0, x: t(9), y: t(4) + 6 },
    { id: IDS.felsKlein, frame: 0, x: t(12) + 4, y: t(5) + 4 },
    { id: IDS.felsKlein, frame: 0, x: t(2), y: t(11) + 6 },
    { id: IDS.felsGross, frame: 0, x: t(17), y: t(11) + 10 },
    { id: IDS.fackel, frame: 0, x: t(7) + 8, y: t(6) + 4 },
    { id: IDS.spieler, frame: idleFrame(lib, 'down'), x: t(6), y: t(8) + 4 },
    { id: IDS.spieler, frame: idleFrame(lib, 'up'), x: t(9), y: t(8) + 4 },
    { id: IDS.spieler, frame: idleFrame(lib, 'left'), x: t(12), y: t(8) + 4 },
    { id: IDS.spieler, frame: idleFrame(lib, 'right'), x: t(14), y: t(8) + 4 },
    { id: IDS.spieler, frame: idleFrame(lib, 'down'), x: t(5), y: t(4) + 2 },
  ]);
  return c;
}

function biomeScene(lib: Library): IndexCanvas {
  const c = new IndexCanvas(BIOME_W * TILE, BIOME_H * TILE);
  paintGround(lib, c, BIOME_W, BIOME_H, SEED.biom, pathAcross(2));
  const t = (n: number): number => n * TILE;
  paintProps(lib, c, [
    { id: IDS.baum, frame: 0, x: t(1) + 8, y: t(2) + 4 },
    { id: IDS.felsGross, frame: 0, x: t(5) + 8, y: t(2) + 2 },
    { id: IDS.felsKlein, frame: 0, x: t(6), y: t(5) - 2 },
    { id: IDS.spieler, frame: idleFrame(lib, 'down'), x: t(3) + 8, y: t(4) + 2 },
  ]);
  return c;
}

/** Bogen mit Überschrift; `blocks` sind (Titel, Canvas, Maßstab, Zeile) in einer Zeile nebeneinander. */
interface Block {
  readonly title: string;
  readonly canvas: IndexCanvas;
  readonly scale: number;
  readonly row: PaletteRow;
  readonly footer?: (img: RgbaImage, x: number, y: number) => void;
  readonly footerH?: number;
}

function blockSize(b: Block): { w: number; h: number } {
  return { w: Math.max(b.canvas.w * b.scale, textWidth(b.title, LABEL_SCALE)), h: LABEL_H + b.canvas.h * b.scale + (b.footerH ?? 0) };
}

function renderSheet(header: string, rows: readonly (readonly Block[])[]): Uint8Array {
  const rowSizes = rows.map((r) => r.map(blockSize));
  const width = MARGIN * 2 + Math.max(textWidth(header, LABEL_SCALE), ...rowSizes.map((r) => r.reduce((s, b) => s + b.w, 0) + GAP * (r.length - 1)));
  const height = MARGIN * 2 + LABEL_H + GAP + rowSizes.reduce((s, r) => s + Math.max(...r.map((b) => b.h)) + GAP, 0);
  const img = new RgbaImage(width, height);
  img.fillRect(0, 0, width, height, COLORS.sheet);
  drawText(img, MARGIN, MARGIN, header, COLORS.text, LABEL_SCALE);
  let y = MARGIN + LABEL_H + GAP;
  rows.forEach((r, ri) => {
    let x = MARGIN;
    r.forEach((b, bi) => {
      const size = rowSizes[ri]?.[bi] ?? { w: 0, h: 0 };
      drawText(img, x, y, b.title, COLORS.muted, LABEL_SCALE);
      const top = y + LABEL_H;
      img.strokeRect(x - 1, top - 1, b.canvas.w * b.scale + 2, b.canvas.h * b.scale + 2, COLORS.frame);
      b.canvas.draw(img, x, top, b.scale, b.row);
      b.footer?.(img, x, top + b.canvas.h * b.scale + 4);
      x += size.w + GAP;
    });
    y += Math.max(...(rowSizes[ri] ?? []).map((s) => s.h)) + GAP;
  });
  return img.toPng();
}

function swatches(img: RgbaImage, x: number, y: number, label: string, refs: readonly string[]): number {
  drawText(img, x, y + Math.floor((SWATCH - GLYPH_H) / 2), label, COLORS.muted, 1);
  let cx = x + textWidth(label, 1) + 4;
  for (const ref of refs) {
    // Heller Rahmen, damit auch Nachtfarben auf dem dunklen Bogen sichtbar bleiben.
    img.strokeRect(cx - 1, y - 1, SWATCH + 2, SWATCH + 2, COLORS.muted);
    img.fillRect(cx, y, SWATCH, SWATCH, PALETTE_RGBA[paletteIndex(ref) - 1] ?? COLORS.frame);
    cx += SWATCH + 4;
  }
  return cx;
}

// ---------------------------------------------------------------------------------------------
// Autotiling (M2-16 … M2-18): Blob-Sätze, Inselkarten, Übergänge je Biom, Klippen und Rampen
// ---------------------------------------------------------------------------------------------

/** Vergrößerung der Autotile-Bögen. */
const AUTOTILE_SCALE = 3;
/** Blob-Frames je Zeile im 47er-Raster. */
const BLOB_SPALTEN = 8;
/** Abstand zwischen den Zellen des 47er-Rasters in px (Weltpixel). */
const BLOB_LUECKE = 4;

/**
 * Streugewichte der Vollfeld-Varianten und ob sie gespiegelt werden dürfen – aus dem Terrain-Datensatz
 * (`tileset` in `src/content/terrain.ts`, ADR-0024), derselben Quelle wie der Renderer; ruhige
 * Varianten häufig, auffällige selten (docs/ART.md §3).
 */
const TILESET_STREUUNG: ReadonlyMap<string, { readonly weights: readonly number[]; readonly mirror: boolean }> = new Map(
  TERRAIN.flatMap((t) => (t.tileset === null ? [] : [[tilesetId(t.id), { weights: t.tileset.variantWeights, mirror: t.tileset.mirror }] as const])),
);

/** Vollfeld-Frame eines Tilesets an (tx, ty): gewichtete Variante, bei ungerichtetem Boden gespiegelt. */
function tilesetVariante(s: Sprite, tx: number, ty: number, seed: number): { frame: number; mirror: boolean } {
  const n = s.frames.length - TILESET_VARIANTEN_START;
  if (n <= 0) return { frame: BLOB_VOLL, mirror: false };
  const u = hashToUnit(hash2(tx, ty, seed));
  const streuung = TILESET_STREUUNG.get(s.id);
  const weights = streuung?.weights;
  let i = Math.floor(u * n);
  if (weights?.length === n) {
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    i = n - 1;
    for (let k = 0; k < n; k++) {
      acc += (weights[k] ?? 0) / total;
      if (u < acc) {
        i = k;
        break;
      }
    }
  }
  return { frame: TILESET_VARIANTEN_START + i, mirror: (streuung?.mirror ?? true) && mirrored(tx, ty, seed) };
}

const UEBERGAENGE = new Uebergaenge([...TERRAIN_REIHENFOLGE]);
const TERRAIN_INDEX = new Map<string, number>(TERRAIN_REIHENFOLGE.map((t, i) => [t, i]));

function terrainIndex(t: string): number {
  const i = TERRAIN_INDEX.get(t);
  if (i === undefined) throw new Error(`Vorschau: unbekanntes Terrain ${t}`);
  return i;
}

/** Legt Boden nach der Übergangsregel (`Uebergaenge.ebenen`) in den Canvas; außerhalb wird geklemmt. */
function zeichneBoden(lib: Library, c: IndexCanvas, w: number, h: number, seed: number, boden: (tx: number, ty: number) => string, ox = 0, oy = 0): void {
  const at = (tx: number, ty: number): number => terrainIndex(boden(Math.max(0, Math.min(w - 1, tx)), Math.max(0, Math.min(h - 1, ty))));
  const out: KachelEbene[] = [];
  const nachbarn = new Array<number>(RICHTUNGEN.length).fill(0);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      RICHTUNGEN.forEach((r, i) => {
        const [dx, dy] = VERSATZ[r];
        nachbarn[i] = at(tx + dx, ty + dy);
      });
      const n = UEBERGAENGE.ebenen(at(tx, ty), nachbarn, out);
      for (let e = 0; e < n; e++) {
        const ebene = out[e];
        if (ebene === undefined) continue;
        const s = lib.get(tilesetId(TERRAIN_REIHENFOLGE[ebene.terrain] ?? ''));
        if (s === undefined) continue;
        const v = ebene.blob === BLOB_VOLL ? tilesetVariante(s, tx, ty, seed) : { frame: ebene.blob, mirror: false };
        c.blit(s, v.frame, ox + tx * TILE, oy + ty * TILE, v.mirror);
      }
    }
  }
}

/** Zeichenkarte → Terrain je Kachel. */
function karte(zeilen: readonly string[], legende: Readonly<Record<string, string>>): { w: number; h: number; at: (tx: number, ty: number) => string } {
  const h = zeilen.length;
  const w = zeilen[0]?.length ?? 0;
  return {
    w,
    h,
    at: (tx, ty) => {
      const ch = zeilen[ty]?.[tx] ?? '';
      const t = legende[ch];
      if (t === undefined) throw new Error(`Vorschau-Karte: Zeichen "${ch}" ohne Terrain`);
      return t;
    },
  };
}

/**
 * Inselkarte: Einzelkacheln, Diagonalberührungen, Streifen, Ring mit Loch, großer Block mit See und
 * Insel im See – zusammen alle Blob-Fälle in natürlicher Umgebung.
 */
const INSELN = [
  '....................',
  '.##......####.......',
  '.##.....######..#...',
  '.......###..###.....',
  '..###..##....##..##.',
  '..#.#..###..###..##.',
  '..###...######......',
  '.........####...#.#.',
  '.#..................',
  '.##...##########....',
  '..#...#........#..#.',
  '......#..####..#....',
  '......##########.##.',
  '....................',
];

/** Je Terrain: typischer Nachbar für die Inselkarte und Palettenzeile des Bogens. */
const AUTOTILE_BOEGEN: ReadonlyArray<{ readonly terrain: TerrainArt; readonly partner: TerrainArt; readonly zeile: string }> = [
  { terrain: 'gras', partner: 'erde', zeile: 'biom_gruenhain' },
  { terrain: 'erde', partner: 'sand', zeile: 'biom_gruenhain' },
  { terrain: 'sand', partner: 'meeresgrund', zeile: 'biom_salzkueste' },
  { terrain: 'duenengras', partner: 'sand', zeile: 'biom_salzkueste' },
  { terrain: 'meeresgrund', partner: 'sand', zeile: 'biom_salzkueste' },
  { terrain: 'moorschlamm', partner: 'torf', zeile: 'biom_nebelmoor' },
  { terrain: 'torf', partner: 'moorschlamm', zeile: 'biom_nebelmoor' },
  { terrain: 'strasse', partner: 'moorschlamm', zeile: 'biom_gruenhain' },
  { terrain: 'eis', partner: 'schnee', zeile: 'biom_frostkamm' },
  { terrain: 'schnee', partner: 'erde', zeile: 'biom_frostkamm' },
  { terrain: 'asche', partner: 'lava', zeile: 'biom_aschenschlund' },
  { terrain: 'lava', partner: 'obsidianboden', zeile: 'biom_glutadern' },
  { terrain: 'kristallboden', partner: 'gras', zeile: 'biom_scherbenhain' },
  { terrain: 'hoehlenboden', partner: 'meeresgrund', zeile: 'biom_tiefgrund' },
  { terrain: 'wurzelboden', partner: 'hoehlenboden', zeile: 'biom_wurzelhoehlen' },
  { terrain: 'lehm', partner: 'moorschlamm', zeile: 'biom_wurzelhoehlen' },
  { terrain: 'obsidianboden', partner: 'lava', zeile: 'biom_glutadern' },
];

/** 47er-Raster: jeder Blob-Frame über dem Vollfeld des Partners (Saum-Terrain: ohne Unterlage). */
function blobRaster(lib: Library, terrain: string, partner: string): IndexCanvas {
  const zeilen = Math.ceil(BLOB_ANZAHL / BLOB_SPALTEN);
  const zelle = TILE + BLOB_LUECKE;
  const c = new IndexCanvas(BLOB_SPALTEN * zelle - BLOB_LUECKE, zeilen * zelle - BLOB_LUECKE);
  const s = lib.get(tilesetId(terrain));
  const unter = SAUM_TERRAIN.has(terrain) ? undefined : lib.get(tilesetId(partner));
  for (let i = 0; i < BLOB_ANZAHL; i++) {
    const x = (i % BLOB_SPALTEN) * zelle;
    const y = Math.floor(i / BLOB_SPALTEN) * zelle;
    if (unter !== undefined) c.blit(unter, SAUM_TERRAIN.has(partner) ? BLOB_INSEL : TILESET_VARIANTEN_START, x, y);
    if (s !== undefined) c.blit(s, i, x, y);
  }
  return c;
}

/** Vollfeld-Varianten nebeneinander. */
function variantenReihe(lib: Library, terrain: string): IndexCanvas {
  const s = lib.get(tilesetId(terrain));
  const n = Math.max(1, (s?.frames.length ?? TILESET_VARIANTEN_START) - TILESET_VARIANTEN_START);
  const c = new IndexCanvas(n * (TILE + BLOB_LUECKE) - BLOB_LUECKE, TILE);
  for (let i = 0; i < n && s !== undefined; i++) c.blit(s, TILESET_VARIANTEN_START + i, i * (TILE + BLOB_LUECKE), 0);
  return c;
}

function inselKarte(lib: Library, terrain: string, partner: string, invers: boolean, seed: number): IndexCanvas {
  const k = karte(INSELN, invers ? { '#': partner, '.': terrain } : { '#': terrain, '.': partner });
  const c = new IndexCanvas(k.w * TILE, k.h * TILE);
  zeichneBoden(lib, c, k.w, k.h, seed, k.at);
  return c;
}

function feldKarte(lib: Library, terrain: string, seed: number): IndexCanvas {
  const c = new IndexCanvas(FIELD_TILES * TILE, FIELD_TILES * TILE);
  zeichneBoden(lib, c, FIELD_TILES, FIELD_TILES, seed, () => terrain);
  return c;
}

/**
 * Übergangsszenen je Biom: mehrere Terrains in einer Karte, durch die Biom-Palettenzeile. Zeichen:
 * g gras · e erde · s sand · d duenengras · w meeresgrund · m moorschlamm · t torf · p strasse · i eis · n schnee ·
 * a asche · l lava · k kristallboden · h hoehlenboden · r wurzelboden · o obsidianboden.
 */
const SZENEN_LEGENDE: Readonly<Record<string, TerrainArt>> = {
  g: 'gras',
  e: 'erde',
  s: 'sand',
  d: 'duenengras',
  w: 'meeresgrund',
  m: 'moorschlamm',
  t: 'torf',
  p: 'strasse',
  i: 'eis',
  n: 'schnee',
  a: 'asche',
  l: 'lava',
  k: 'kristallboden',
  h: 'hoehlenboden',
  r: 'wurzelboden',
  o: 'obsidianboden',
};

const UEBERGANGS_SZENEN: ReadonlyArray<{ readonly titel: string; readonly zeile: string; readonly karte: readonly string[] }> = [
  {
    titel: 'GRUENHAIN KUESTE',
    zeile: 'biom_gruenhain',
    karte: [
      'gggggggggggggggggggg',
      'ggggggeeegggggggggss',
      'gggggeeeeegggppgggss',
      'gggggggeeggggppggsss',
      'ggmmgggggggggppgssww',
      'gmmmmtggggggppggssww',
      'ggmmttggggggppgsswww',
      'ggggggggggggpgsswwww',
      'ggggggggeeeppsswwwww',
      'gggggggeeeepssswwwww',
      'ggggssssssssswwwwwww',
      'gsssswwwwwwwwwwwwwww',
    ],
  },
  {
    titel: 'SALZKUESTE DUENEN',
    zeile: 'biom_salzkueste',
    karte: [
      'dddddddddddddddddddd',
      'ddddddddsssddddddddd',
      'dddddddsssssdddddddd',
      'dddddssdddsssddddssd',
      'ddddssssddddddsssssd',
      'dddsssddddssdddssssd',
      'ddssssdddddsssddssss',
      'dssssssddsssssssssss',
      'ssssssssssssssssssss',
      'sssssssssssssswwwsss',
      'sssswwwwwwwwwwwwwwww',
      'wwwwwwwwwwwwwwwwwwww',
    ],
  },
  {
    titel: 'FROSTKAMM',
    zeile: 'biom_frostkamm',
    karte: [
      'nnnnnnnnnnnnnnnnnnnn',
      'nnnnnnnnnniiinnnnnnn',
      'nnnnnnnniiiiiinnnnnn',
      'nnggnnnniiiiiiinnnnn',
      'ngggennnniiiiinnnnnn',
      'nggeeennnnnnnnnnnggn',
      'nngeeeennnnnnnnngggn',
      'nnnneeennnnnnnnggggn',
      'nnnnneeeennnnnngggnn',
      'nnnnnnneeeeennnnnnnn',
      'nnnnnnnnnneeeennnnnn',
      'nnnnnnnnnnnnnnnnnnnn',
    ],
  },
  {
    titel: 'GLUTSAND OASE',
    zeile: 'biom_glutsand',
    karte: [
      'ssssssssssssssssssss',
      'sssssssspppppsssssss',
      'sssssssspppppsssssss',
      'ssssssssssssssssssss',
      'sssssggggggsssssssss',
      'ssssggwwwwggssssssss',
      'ssssgwwwwwwgssssseee',
      'sssssgwwwwgsssssseee',
      'ssssssgggggsssssssee',
      'ssssssssssssssssssss',
      'sseeesssssssssssssss',
      'ssssssssssssssssssss',
    ],
  },
  {
    titel: 'ASCHENSCHLUND',
    zeile: 'biom_aschenschlund',
    karte: [
      'aaaaaaaaaaaaaaaaaaaa',
      'aaaaaaallllaaaaaaaaa',
      'aaaaaallllllaaaaeeaa',
      'aaaaaaallllllaaeeeea',
      'aaaaaaaaallllaaaeeaa',
      'aaeeaaaaaalllaaaaaaa',
      'aeeeeaaaaaallllaaaaa',
      'aaeeaaaaaaaalllllaaa',
      'aaaaaaaaaaaaaallllla',
      'aaaaaaaaaaaaaaaallll',
      'aaaaaaaaaaaaaaaaaall',
      'aaaaaaaaaaaaaaaaaaaa',
    ],
  },
  {
    titel: 'SCHERBENHAIN',
    zeile: 'biom_scherbenhain',
    karte: [
      'gggggggggggggggggggg',
      'gggkkkggggggggggkkgg',
      'ggkkkkkgggggggggkkkg',
      'ggkkkkkkggggggggggkg',
      'gggkkkkggggggggggggg',
      'ggggggggggkkkggggggg',
      'gggggggggkkkkkgggggg',
      'ggggggggkkkwwkkggggg',
      'gggggggggkwwwkgggggg',
      'ggggggggggkkkggggggg',
      'gggggggggggggggggggg',
      'gggggggggggggggggggg',
    ],
  },
  {
    titel: 'UNTERGRUND',
    zeile: 'biom_wurzelhoehlen',
    karte: [
      'hhhhhhhhhhhhhhhhhhhh',
      'hhrrrhhhhhhhhhoooooh',
      'hrrrrrhhhhhhhoollloo',
      'hrrrrrrhhhhhhoollloh',
      'hhrrrhhhhhhhhhoolloh',
      'hhhhhhhhwwwhhhhoohhh',
      'hhhhhhhwwwwwhhhhhhhh',
      'hhhhhhhwwwwhhhhhhrrh',
      'hhhrhhhhwwhhhhhhrrrh',
      'hhrrrhhhhhhhhhhhhrrh',
      'hhhrhhhhhhhhhhhhhhhh',
      'hhhhhhhhhhhhhhhhhhhh',
    ],
  },
];

/**
 * Klippen-Demo: Höhen 0–3 (Ziffern) mit Wänden je Stufe, Übergangs-Flags an den oberen Kantenkacheln
 * (`r` Rampe, `t` Treppe): Treppe Süd 1→0, Rampe Süd 2→0 (zwei Stufen), Rampe Süd 2→1, Treppe Nord,
 * Rampe West, Treppe Ost; dazu Außen- und Innenecken und eine Innenecke im L-Plateau.
 */
const KLIPPEN_HOEHEN = [
  '0000000000000000000000',
  '0011111111111000000000',
  '0011111111111002222200',
  '0011222222111002222200',
  '0011222222111002222200',
  '0011223322111002222200',
  '0011223322111002222200',
  '0011222222111000000000',
  '0011111111111000000000',
  '0011111111111110000000',
  '0000000000001110000000',
  '0000000000000000000000',
  '0000000000000000000000',
  '0000000000000000000000',
];
const KLIPPEN_FLAGS = [
  '......................',
  '.....tt...............',
  '......................',
  '......................',
  '..r................t..',
  '......................',
  '................rr....',
  '........rr............',
  '......................',
  '..........tt..........',
  '......................',
  '......................',
  '......................',
  '......................',
];

/** Klippen-Gruppen der Demo: Palettenzeile und Boden je Höhenstufe (unten → oben). */
const KLIPPEN_DEMOS: ReadonlyArray<{ readonly gruppe: KlippenGruppe; readonly zeile: string; readonly boden: readonly TerrainArt[]; readonly weg: TerrainArt }> = [
  { gruppe: 'gruen', zeile: 'biom_gruenhain', boden: ['gras', 'gras', 'gras', 'gras'], weg: 'erde' },
  { gruppe: 'stein', zeile: 'biom_frostkamm', boden: ['schnee', 'schnee', 'schnee', 'schnee'], weg: 'eis' },
  { gruppe: 'sand', zeile: 'biom_glutsand', boden: ['sand', 'sand', 'sand', 'sand'], weg: 'strasse' },
  { gruppe: 'asche', zeile: 'biom_aschenschlund', boden: ['asche', 'asche', 'asche', 'asche'], weg: 'erde' },
  { gruppe: 'kristall', zeile: 'biom_scherbenhain', boden: ['gras', 'kristallboden', 'kristallboden', 'kristallboden'], weg: 'gras' },
  { gruppe: 'hoehle', zeile: 'biom_tiefgrund', boden: ['hoehlenboden', 'hoehlenboden', 'wurzelboden', 'hoehlenboden'], weg: 'obsidianboden' },
];
/** Wegkacheln der Klippen-Demo (führen zu Treppen und Rampen). */
const KLIPPEN_WEG = [
  '......................',
  '.....ww...............',
  '.....ww...............',
  '......................',
  '..w...................',
  '..w.................w.',
  '................ww..w.',
  '........ww......ww....',
  '........ww......ww....',
  '..........ww....ww....',
  '..........ww....ww....',
  '..........ww..........',
  '......................',
  '......................',
];

function klippenKarte(lib: Library, demo: (typeof KLIPPEN_DEMOS)[number], seed: number): IndexCanvas {
  const h = KLIPPEN_HOEHEN.length;
  const w = KLIPPEN_HOEHEN[0]?.length ?? 0;
  const clampX = (x: number): number => Math.max(0, Math.min(w - 1, x));
  const clampY = (y: number): number => Math.max(0, Math.min(h - 1, y));
  const hoeheAt = (tx: number, ty: number): number => Number(KLIPPEN_HOEHEN[clampY(ty)]?.[clampX(tx)] ?? '0');
  const flagAt = (tx: number, ty: number): number => {
    const ch = KLIPPEN_FLAGS[clampY(ty)]?.[clampX(tx)] ?? '.';
    return ch === 'r' ? UEBERGANG.rampe : ch === 't' ? UEBERGANG.treppe : UEBERGANG.keiner;
  };
  const c = new IndexCanvas(w * TILE, h * TILE);
  zeichneBoden(lib, c, w, h, seed, (tx, ty) => {
    if (KLIPPEN_WEG[ty]?.[tx] === 'w') return demo.weg;
    return demo.boden[Math.min(demo.boden.length - 1, hoeheAt(tx, ty))] ?? demo.weg;
  });
  const s = lib.get(klippenTilesetId(demo.gruppe));
  if (s === undefined) return c;
  const frames: number[] = [];
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const u: KlippenUmgebung = { hoehe: (dx, dy) => hoeheAt(tx + dx, ty + dy), uebergang: (dx, dy) => flagAt(tx + dx, ty + dy) };
      klippenFrames(u, hashToUnit(hash2(tx, ty, seed)), frames);
      for (const f of frames) c.blit(s, f, tx * TILE, ty * TILE);
    }
  }
  return c;
}

/** Alle Klippen-Frames einer Gruppe als Raster (Kante 0–46, Wand, Rampe, Treppe, Brüche). */
function klippenRaster(lib: Library, gruppe: KlippenGruppe, unterlage: TerrainArt): IndexCanvas {
  const s = lib.get(klippenTilesetId(gruppe));
  const n = s?.frames.length ?? 0;
  const spalten = 16;
  const zelle = TILE + BLOB_LUECKE;
  const c = new IndexCanvas(spalten * zelle - BLOB_LUECKE, Math.max(1, Math.ceil(n / spalten)) * zelle - BLOB_LUECKE);
  const unter = lib.get(tilesetId(unterlage));
  for (let i = 0; i < n && s !== undefined; i++) {
    const x = (i % spalten) * zelle;
    const y = Math.floor(i / spalten) * zelle;
    if (unter !== undefined) c.blit(unter, TILESET_VARIANTEN_START, x, y);
    c.blit(s, i, x, y);
  }
  return c;
}

function zeileVon(id: string): PaletteRow {
  const row = PALETTE_ROWS[paletteRowIndex(id)];
  if (row === undefined) throw new Error(`Palettenzeile ${id} fehlt`);
  return row;
}

/** Schreibt die Autotile-Bögen: `autotile-<terrain>.png`, `autotile-uebergaenge.png`, `klippen-rampen.png`. */
function buildAutotilePreviews(lib: Library, outDir: string, missing: () => string): string[] {
  const files: string[] = [];
  const basis = zeileVon('basis');
  AUTOTILE_BOEGEN.forEach((b, i) => {
    const seed = SEED.biom + i;
    const row = zeileVon(b.zeile);
    const sheet = renderSheet(`AUTOTILE ${b.terrain} - 47 BLOB-FRAMES + VARIANTEN - PARTNER ${b.partner} - ${AUTOTILE_SCALE}X${missing()}`, [
      [
        { title: `47 BLOB (UEBER ${b.partner})`, canvas: blobRaster(lib, b.terrain, b.partner), scale: AUTOTILE_SCALE, row: basis },
        { title: 'VARIANTEN', canvas: variantenReihe(lib, b.terrain), scale: AUTOTILE_SCALE, row: basis },
        { title: 'FELD 6X6', canvas: feldKarte(lib, b.terrain, seed), scale: AUTOTILE_SCALE, row: basis },
      ],
      [
        { title: `INSELN ${b.terrain} IN ${b.partner} (${b.zeile})`, canvas: inselKarte(lib, b.terrain, b.partner, false, seed), scale: AUTOTILE_SCALE, row },
        { title: `INSELN ${b.partner} IN ${b.terrain}`, canvas: inselKarte(lib, b.terrain, b.partner, true, seed), scale: AUTOTILE_SCALE, row },
      ],
    ]);
    const file = join(outDir, `autotile-${b.terrain}.png`);
    writeIfChanged(file, sheet);
    files.push(file);
  });
  const szenen: Block[] = UEBERGANGS_SZENEN.map((s, i) => {
    const k = karte(s.karte, SZENEN_LEGENDE);
    const c = new IndexCanvas(k.w * TILE, k.h * TILE);
    zeichneBoden(lib, c, k.w, k.h, SEED.szene + i, k.at);
    return { title: `${s.titel} (${s.zeile})`, canvas: c, scale: AUTOTILE_SCALE, row: zeileVon(s.zeile) };
  });
  const uebergaenge = renderSheet(`AUTOTILE UEBERGAENGE JE BIOM - HOEHERES TERRAIN ZEICHNET DEN RAND - ${AUTOTILE_SCALE}X${missing()}`, [szenen.slice(0, 2), szenen.slice(2, 4), szenen.slice(4, 6)]);
  const fileU = join(outDir, 'autotile-uebergaenge.png');
  writeIfChanged(fileU, uebergaenge);
  files.push(fileU);
  const demos: Block[] = KLIPPEN_DEMOS.map((d, i) => ({ title: `KLIPPE ${d.gruppe} (${d.zeile})`, canvas: klippenKarte(lib, d, SEED.szene + i), scale: AUTOTILE_SCALE, row: zeileVon(d.zeile) }));
  const klippen = renderSheet(`KLIPPEN UND RAMPEN - 16 PX WAND JE STUFE - TREPPE/RAMPE SUED, NORD, OST, WEST - ${AUTOTILE_SCALE}X${missing()}`, [demos.slice(0, 2), demos.slice(2, 4), demos.slice(4, 6)]);
  const fileK = join(outDir, 'klippen-rampen.png');
  writeIfChanged(fileK, klippen);
  files.push(fileK);
  const raster: Block[] = KLIPPEN_DEMOS.map((d) => ({ title: `TILESET KLIPPE ${d.gruppe} - ${KLIPPE_FRAME.anzahl} FRAMES`, canvas: klippenRaster(lib, d.gruppe, d.boden[1] ?? 'gras'), scale: AUTOTILE_SCALE, row: zeileVon(d.zeile) }));
  const klippenSatz = renderSheet(`AUTOTILE KLIPPEN - KANTE 0-46, WAND, VARIANTE, RAMPE, TREPPE, BRUECHE - ${AUTOTILE_SCALE}X${missing()}`, [raster.slice(0, 2), raster.slice(2, 4), raster.slice(4, 6)]);
  const fileS = join(outDir, 'autotile-klippen.png');
  writeIfChanged(fileS, klippenSatz);
  files.push(fileS);
  return files;
}

/** Schreibt die Vorschaubögen nach `outDir`; liefert die Pfade. */
export async function buildPreviews(spritesDir: string, outDir: string): Promise<string[]> {
  const lib = await library(spritesDir);
  const basis = PALETTE_ROWS[paletteRowIndex('basis')];
  if (basis === undefined) throw new Error('Palettenzeile basis fehlt');
  const fields: Block[] = [
    { title: 'GRAS 6X6', canvas: field(lib, SEED.gras, () => 'gras'), scale: FIELD_SCALE, row: basis },
    { title: 'ERDE 6X6', canvas: field(lib, SEED.erde, () => 'erde'), scale: FIELD_SCALE, row: basis },
    { title: 'WEG QUER', canvas: field(lib, SEED.quer, pathAcross(1)), scale: FIELD_SCALE, row: basis },
    { title: 'WEG LAENGS', canvas: field(lib, SEED.laengs, pathAlong(1)), scale: FIELD_SCALE, row: basis },
  ];
  const sceneBlock: Block = { title: `SZENE ${SCENE_W}X${SCENE_H} KACHELN`, canvas: scene(lib), scale: SCENE_SCALE, row: basis };
  const small = biomeScene(lib);
  const biomeBlocks: Block[] = BIOME_TINTS.map((b) => {
    const row = PALETTE_ROWS[paletteRowIndex(b.zeile)] ?? basis;
    return {
      title: `${b.biom} ${b.ebene === 0 ? '' : `EBENE ${b.ebene}`}`.trim(),
      canvas: small,
      scale: BIOME_SCALE,
      row,
      footerH: 3 * (SWATCH + 4),
      footer: (img, x, y) => {
        swatches(img, x, y, 'GRUNDTON', b.grundton);
        swatches(img, x, y + SWATCH + 4, 'AKZENT  ', b.akzent);
        swatches(img, x, y + 2 * (SWATCH + 4), 'NACHT   ', [b.nacht]);
      },
    };
  });
  const missing = (): string => (lib.missing.size === 0 ? '' : ` - FEHLT: ${[...lib.missing].sort().join(', ')}`);
  const vorschau = renderSheet(`VORSCHAU GRUENHAIN - KACHELN ${FIELD_SCALE}X - SZENE ${SCENE_SCALE}X${missing()}`, [fields, [sceneBlock]]);
  const biomeRows: Block[][] = [];
  for (let i = 0; i < biomeBlocks.length; i += BIOME_COLUMNS) biomeRows.push(biomeBlocks.slice(i, i + BIOME_COLUMNS));
  const biome = renderSheet(`BIOM-TOENUNG - ${BIOME_TINTS.length} BIOME - ${BIOME_SCALE}X${missing()}`, biomeRows);
  const files = [join(outDir, 'vorschau_gruenhain.png'), join(outDir, 'biome.png')];
  writeIfChanged(files[0] ?? '', vorschau);
  writeIfChanged(files[1] ?? '', biome);
  return [...files, ...buildAutotilePreviews(lib, outDir, missing)];
}

const isMain = import.meta.url === `file://${process.argv[1] ?? ''}`;
if (isMain) {
  const root = process.cwd();
  const files = await buildPreviews(join(root, 'assets-src/sprites'), join(root, 'tools/out/sheets'));
  console.log(`vorschau: ${files.map((f) => f.slice(root.length + 1)).join(', ')}`);
}
