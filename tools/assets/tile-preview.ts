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
 *
 * Fehlt ein Sprite, bleibt seine Stelle leer und der Bogenkopf nennt es.
 * CLI: `tsx tools/assets/tile-preview.ts` → `tools/out/sheets/`.
 */
import { join } from 'node:path';
import { flatPalette, paletteIndex } from '../../assets-src/palette';
import { BIOME_TINTS, PALETTE_ROWS, paletteRowIndex, type PaletteRow } from '../../assets-src/paletteRows';
import { TRANSPARENT, type Sprite } from '../../assets-src/lib/sprite';
import { hash2, hashToUnit } from '../../src/engine/rng';
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

/** Schreibt beide Vorschaubögen nach `outDir`; liefert die Pfade. */
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
  return files;
}

const isMain = import.meta.url === `file://${process.argv[1] ?? ''}`;
if (isMain) {
  const root = process.cwd();
  const files = await buildPreviews(join(root, 'assets-src/sprites'), join(root, 'tools/out/sheets'));
  console.log(`vorschau: ${files.map((f) => f.slice(root.length + 1)).join(', ')}`);
}
