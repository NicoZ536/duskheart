/**
 * Figuren-Vorschau (M3-05 … M3-07, MASTERPROMPT §5 „Qualitätsschleife“): setzt die Spielfigur so zusammen,
 * wie der Renderer sie zeichnet (`src/render/anim/figure.ts`: Stapelfolge `FIGURE_LAYER_ORDER`,
 * Körper-Layer mit dem Frame-Index des Körpers, Hand-Layer mit ihrem Anker auf dem Sockel des
 * Körper-Frames), und schreibt vier Kontaktbögen nach `tools/out/sheets/`:
 *
 * - `spieler-bewegung.png` (M3-05): Idle, Gehen, Rennen, Rolle, Schwimmen – je Richtung eine Zeile,
 *   angezogen (Grundkörper + Leinentunika + Leinenhose) auf Wiesengrund.
 * - `spieler-aktionen.png` (M3-06): Werkzeug, Treffer, Tod, Sitzen, Schlafen, Essen, Trinken, Tragen.
 * - `spieler-layer.png` (M3-07): Schichtaufbau (Grundkörper → Hose → Tunika → Fackel → Axt), der
 *   Werkzeugschlag mit Steinaxt und Fackel je Richtung in Clip-Folge, alle Hand-Layer in der Hand, und
 *   die Fackel in der Nebenhand über **jedem** Frame der Figur (Nachtgrund).
 * - `spieler-licht.png` (M3-07): die Licht-Varianten `<aktion>_licht` mit Fackel in der Nebenhand.
 *
 * CLI: `tsx tools/assets/figure-preview.ts [--force]`; in `npm run assets` als Schritt „Figuren“ (übersprungen,
 * solange sich keine Eingabe geändert hat).
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { RICHTUNGEN, type Richtung } from '../../assets-src/lib/figure';
import { TRANSPARENT, type Sprite } from '../../assets-src/lib/sprite';
import { flatPalette } from '../../assets-src/palette';
import type { Aktion } from '../../assets-src/sprites/figuren/_spieler_aktionen';
import { FIGURE_LAYER_ORDER, SLOT_SOCKET, type EquipmentSlot } from '../../src/render/anim/figure';
import { hashFiles, listFiles, writeIfChanged } from '../lib/files';
import { GLYPH_H, drawText, textWidth } from '../lib/font';
import { RgbaImage, hexRgba, type Rgba } from '../lib/image';

/** Arbeitsfläche je Figur: Körperzelle (32×32) mit Rand für Werkzeuge, die über die Zelle ragen. */
const FLAECHE = 48;
const ZELLE_X = 8;
const ZELLE_Y = 8;
const MARGIN = 16;
const GAP = 6;
const LABEL_SCALE = 2;
const LABEL_H = GLYPH_H * LABEL_SCALE + 8;

const PALETTE: readonly Rgba[] = flatPalette().map(hexRgba);
const FARBEN = {
  bogen: hexRgba('#1a1426'),
  text: hexRgba('#f4ecd8'),
  leise: hexRgba('#7e8393'),
  wiese: hexRgba('#4b8c3c'),
  nacht: hexRgba('#10203f'),
} as const;

type Ausstattung = Partial<Record<EquipmentSlot, Sprite>>;

/** Item-Frame je Slot (Hand-Layer: Frame des Item-Clips; Körper-Layer: Frame-Index des Körpers). */
type ItemFrame = (slot: EquipmentSlot, item: Sprite) => number;

/** Sprites und Aktionstabellen der Figur (erst bei Bedarf geladen: Aufbau aller Frames kostet Zeit). */
interface Daten {
  readonly spielerBasis: Sprite;
  readonly tunika: Sprite;
  readonly hose: Sprite;
  readonly axt: Sprite;
  readonly fackel: Sprite;
  readonly werkzeuge: readonly Sprite[];
  readonly angezogen: Ausstattung;
  readonly bewegung: readonly Aktion[];
  readonly aktionen: readonly Aktion[];
  readonly mitLicht: readonly Aktion[];
  readonly lichtSuffix: string;
}

async function laden(): Promise<Daten> {
  const [basis, kleidung, werkzeuge, fackel, aktionen] = await Promise.all([
    import('../../assets-src/sprites/figuren/spieler_basis'),
    import('../../assets-src/sprites/ausruestung/kleidung'),
    import('../../assets-src/sprites/ausruestung/werkzeuge'),
    import('../../assets-src/sprites/ausruestung/fackel'),
    import('../../assets-src/sprites/figuren/_spieler_aktionen'),
  ]);
  const [tunika, hose] = kleidung.default;
  const axt = werkzeuge.default.find((w) => w.id === 'ausruestung_steinaxt');
  if (tunika === undefined || hose === undefined || axt === undefined) throw new Error('Figuren-Vorschau: Kleidung oder Steinaxt fehlt');
  return {
    spielerBasis: basis.default,
    tunika,
    hose,
    axt,
    fackel: fackel.default,
    werkzeuge: werkzeuge.default,
    angezogen: { koerper: tunika, beine: hose },
    bewegung: aktionen.BEWEGUNG,
    aktionen: aktionen.AKTIONEN_M3_06,
    mitLicht: aktionen.MIT_LICHT,
    lichtSuffix: aktionen.LICHT_SUFFIX,
  };
}

/** Zeichnet die Figur in Richtung `r` mit Körper-Frame `f` (Stapelfolge wie im Renderer). */
function figur(d: Daten, r: Richtung, f: number, ausstattung: Ausstattung, itemFrame: ItemFrame): Uint8Array {
  const { spielerBasis } = d;
  const out = new Uint8Array(FLAECHE * FLAECHE);
  const blit = (s: Sprite, frame: number, x0: number, y0: number): void => {
    const px = s.frames[frame]?.index;
    if (px === undefined) return;
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const v = px[y * s.w + x] ?? TRANSPARENT;
        const tx = x0 + x;
        const ty = y0 + y;
        if (v !== TRANSPARENT && tx >= 0 && ty >= 0 && tx < FLAECHE && ty < FLAECHE) out[ty * FLAECHE + tx] = v;
      }
    }
  };
  for (const teil of FIGURE_LAYER_ORDER[r]) {
    if (teil === 'body') {
      blit(spielerBasis, f, ZELLE_X, ZELLE_Y);
      continue;
    }
    const item = ausstattung[teil];
    if (item === undefined) continue;
    const sockel = SLOT_SOCKET[teil];
    if (sockel === null) {
      blit(item, f, ZELLE_X, ZELLE_Y);
      continue;
    }
    const p = spielerBasis.sockets[sockel]?.[f];
    if (p === undefined) continue;
    blit(item, itemFrame(teil, item), ZELLE_X + p[0] - item.anchor[0], ZELLE_Y + p[1] - item.anchor[1]);
  }
  return out;
}

/** Halte-Clip des Items in Richtung `r` bzw. Clip `<aktion>_<r>` an Position `pos`, falls vorhanden. */
function itemFrameFuer(r: Richtung, aktion: string | null, pos: number, zeit: number): ItemFrame {
  return (_slot, item) => {
    const eigen = aktion === null ? undefined : item.clips[`${aktion}_${r}`];
    if (eigen !== undefined) return eigen.frames[Math.min(pos, eigen.frames.length - 1)] ?? 0;
    const halten = item.clips[r];
    if (halten === undefined) return 0;
    return halten.frames[Math.floor(zeit * halten.fps) % halten.frames.length] ?? 0;
  };
}

interface Zelle {
  readonly pixel: Uint8Array;
  readonly marke?: string;
}

function zeichneZelle(img: RgbaImage, x: number, y: number, z: Zelle, skala: number, grund: Rgba): void {
  img.fillRect(x, y, FLAECHE * skala, FLAECHE * skala, grund);
  img.drawScaled(x, y, FLAECHE, FLAECHE, skala, (px, py) => {
    const v = z.pixel[py * FLAECHE + px] ?? TRANSPARENT;
    return v === TRANSPARENT ? null : (PALETTE[v - 1] ?? null);
  });
  if (z.marke !== undefined) drawText(img, x + 2, y + 2, z.marke, FARBEN.leise, 1);
}

interface Zeile {
  readonly titel: string;
  readonly zellen: readonly Zelle[];
}

interface Block {
  readonly titel: string;
  readonly zeilen: readonly Zeile[];
  readonly skala: number;
  readonly grund: Rgba;
}

const zeilenTitelBreite = (skala: number): number => textWidth('right', 1) + (skala > 2 ? 12 : 8);

function blockGroesse(b: Block): { w: number; h: number } {
  const zelle = FLAECHE * b.skala + GAP;
  const w = Math.max(textWidth(b.titel, LABEL_SCALE), zeilenTitelBreite(b.skala) + Math.max(...b.zeilen.map((z) => z.zellen.length)) * zelle);
  return { w, h: LABEL_H + b.zeilen.length * zelle };
}

function zeichneBlock(img: RgbaImage, x: number, y: number, b: Block): void {
  drawText(img, x, y, b.titel, FARBEN.text, LABEL_SCALE);
  const zelle = FLAECHE * b.skala + GAP;
  b.zeilen.forEach((zeile, zi) => {
    const zy = y + LABEL_H + zi * zelle;
    drawText(img, x, zy + (FLAECHE * b.skala) / 2 - 2, zeile.titel, FARBEN.leise, 1);
    zeile.zellen.forEach((z, i) => zeichneZelle(img, x + zeilenTitelBreite(b.skala) + i * zelle, zy, z, b.skala, b.grund));
  });
}

/** Bogen aus Blöcken in `spalten` Spalten (Blöcke fließen spaltenweise von oben nach unten). */
function bogen(titel: string, bloecke: readonly Block[], spalten = 1): Uint8Array {
  const groessen = bloecke.map(blockGroesse);
  const proSpalte = Math.ceil(bloecke.length / spalten);
  const spaltenBreite: number[] = [];
  const spaltenHoehe: number[] = [];
  groessen.forEach((g, i) => {
    const s = Math.floor(i / proSpalte);
    spaltenBreite[s] = Math.max(spaltenBreite[s] ?? 0, g.w);
    spaltenHoehe[s] = (spaltenHoehe[s] ?? 0) + g.h + MARGIN;
  });
  const w = Math.max(textWidth(titel, LABEL_SCALE), spaltenBreite.reduce((a, b) => a + b + MARGIN, -MARGIN)) + 2 * MARGIN;
  const h = MARGIN + LABEL_H + Math.max(...spaltenHoehe) + MARGIN;
  const img = new RgbaImage(w, h);
  img.fillRect(0, 0, w, h, FARBEN.bogen);
  drawText(img, MARGIN, MARGIN, titel, FARBEN.text, LABEL_SCALE);
  let x = MARGIN;
  let y = MARGIN + LABEL_H + 4;
  bloecke.forEach((b, i) => {
    const s = Math.floor(i / proSpalte);
    if (i > 0 && i % proSpalte === 0) {
      x += (spaltenBreite[s - 1] ?? 0) + MARGIN;
      y = MARGIN + LABEL_H + 4;
    }
    zeichneBlock(img, x, y, b);
    y += (groessen[i]?.h ?? 0) + MARGIN;
  });
  return img.toPng();
}

/** Clip-Frames einer Aktion in Richtung `r` (Sprite-Frame-Indizes in Abspielfolge). */
function clipFrames(d: Daten, a: Aktion, r: Richtung): readonly number[] {
  return d.spielerBasis.clips[`${a.name}_${r}`]?.frames ?? [];
}

/** Block einer Aktion: je Richtung die eigenen Frames in Zeichenreihenfolge (angezogen). */
function aktionsBlock(d: Daten, a: Aktion, skala: number, ausstattung: Ausstattung = d.angezogen): Block {
  const zeilen = RICHTUNGEN.map((r) => {
    const frames = [...new Set(clipFrames(d, a, r))].sort((p, q) => p - q);
    return { titel: r, zellen: frames.map((f, i) => ({ pixel: figur(d, r, f, ausstattung, itemFrameFuer(r, null, 0, i / 10)), marke: String(i) })) };
  });
  const events = a.events.map((e) => `${e.name}(${e.frame})`).join(' ');
  const titel = `${a.name} - ${a.fps} FPS${a.loop ? ' LOOP' : ''} - FOLGE ${a.folge.join(' ')}${events === '' ? '' : ` - ${events}`}`;
  return { titel, zeilen, skala, grund: FARBEN.wiese };
}

/** Körper-Clip einer Aktion; hält die Nebenhand ein Licht, die Variante `<aktion>_licht`, falls vorhanden. */
function koerperClip(d: Daten, aktion: string, r: Richtung, licht: boolean): readonly number[] {
  const c = (licht ? d.spielerBasis.clips[`${aktion}${d.lichtSuffix}_${r}`] : undefined) ?? d.spielerBasis.clips[`${aktion}_${r}`];
  return c?.frames ?? [];
}

/** Schichtaufbau je Richtung am ersten Idle-Frame (mit Licht: `idle_licht`). */
function schichtBlock(d: Daten): Block {
  const stufen: readonly [string, Ausstattung][] = [
    ['basis', {}],
    ['+hose', { beine: d.hose }],
    ['+tunika', { beine: d.hose, koerper: d.tunika }],
    ['+fackel', { ...d.angezogen, nebenhand: d.fackel }],
    ['+axt', { ...d.angezogen, nebenhand: d.fackel, waffe: d.axt }],
  ];
  const zeilen = RICHTUNGEN.map((r) => ({
    titel: r,
    zellen: stufen.map(([marke, a]) => {
      const f = koerperClip(d, 'idle', r, a.nebenhand !== undefined)[0] ?? 0;
      return { pixel: figur(d, r, f, a, itemFrameFuer(r, null, 0, 0)), marke };
    }),
  }));
  return { titel: 'SCHICHTEN: BASIS - HOSE - TUNIKA - FACKEL (NEBENHAND) - AXT (HAND)', zeilen, skala: 4, grund: FARBEN.wiese };
}

/** Werkzeugschlag mit Steinaxt und Fackel in Clip-Folge (Item-Clip `tool_licht_<richtung>` mit Körperzeit). */
function schlagBlock(d: Daten): Block {
  const tool = d.aktionen.find((a) => a.name === 'tool');
  if (tool === undefined) throw new Error('Figuren-Vorschau: Aktion tool fehlt');
  const zeilen = RICHTUNGEN.map((r) => ({
    titel: r,
    zellen: koerperClip(d, 'tool', r, true).map((f, pos) => ({
      pixel: figur(d, r, f, { ...d.angezogen, nebenhand: d.fackel, waffe: d.axt }, itemFrameFuer(r, `tool${d.lichtSuffix}`, pos, pos / tool.fps)),
      marke: String(pos),
    })),
  }));
  return { titel: 'WERKZEUGSCHLAG TOOL_LICHT_<RICHTUNG> - STEINAXT + FACKEL - CLIP-POSITIONEN', zeilen, skala: 4, grund: FARBEN.wiese };
}

/** Alle Hand-Layer gehalten (vorn und in beiden Profilen) und im Durchschlag nach rechts. */
function handBlock(d: Daten): Block {
  const zeile = (titel: string, r: Richtung, aktion: string | null): Zeile => {
    const clip = d.spielerBasis.clips[`${aktion ?? 'idle'}_${r}`];
    const pos = aktion === null ? 0 : (clip?.frames.length ?? 1) - 1;
    const f = clip?.frames[pos] ?? 0;
    return { titel, zellen: d.werkzeuge.map((w) => ({ pixel: figur(d, r, f, { ...d.angezogen, waffe: w }, itemFrameFuer(r, aktion, pos, 0)) })) };
  };
  return {
    titel: `HAND-LAYER: ${d.werkzeuge.map((w) => w.id.replace('ausruestung_', '')).join(' ')}`,
    zeilen: [zeile('down', 'down', null), zeile('right', 'right', null), zeile('left', 'left', null), zeile('tool', 'right', 'tool')],
    skala: 3,
    grund: FARBEN.wiese,
  };
}

/** Die Fackel in der Nebenhand über jedem Frame der Figur (Flamme mit Item-Zeit). */
function fackelBlock(d: Daten): Block {
  const proZeile = 30;
  const zeilen: Zeile[] = [];
  const clips = d.spielerBasis.clips;
  for (const r of RICHTUNGEN) {
    const frames = [...new Set(Object.entries(clips).flatMap(([name, c]) => (name.endsWith(`_${r}`) ? c.frames : [])))].sort((a, b) => a - b);
    for (let i = 0; i < frames.length; i += proZeile) {
      zeilen.push({
        titel: i === 0 ? r : '',
        zellen: frames.slice(i, i + proZeile).map((f) => ({ pixel: figur(d, r, f, { ...d.angezogen, nebenhand: d.fackel }, itemFrameFuer(r, null, 0, f / 10)) })),
      });
    }
  }
  return { titel: `FACKEL IN DER NEBENHAND - ALLE ${d.spielerBasis.frames.length} FRAMES DER FIGUR`, zeilen, skala: 2, grund: FARBEN.nacht };
}

/** Namen der Figuren-Bögen. */
export const FIGUREN_BOEGEN = ['spieler-bewegung.png', 'spieler-aktionen.png', 'spieler-layer.png', 'spieler-licht.png'] as const;

/** Eingaben der Bögen (relativ zur Projektwurzel): ändert sich eine, entstehen die Bögen neu. */
const EINGABEN = ['assets-src/sprites/figuren', 'assets-src/sprites/ausruestung', 'assets-src/lib', 'assets-src/palette.ts', 'src/render/anim', 'tools/lib', 'tools/assets/figure-preview.ts'] as const;

function eingabeHash(root: string): string {
  const dateien = EINGABEN.flatMap((e) => {
    const pfad = join(root, e);
    return e.endsWith('.ts') ? (existsSync(pfad) ? [pfad] : []) : listFiles(pfad);
  });
  return hashFiles(root, dateien);
}

/**
 * Schreibt die Figuren-Bögen; liefert die Dateinamen oder „unverändert“, wenn der Quell-Hash seit dem
 * letzten Lauf gleich ist und alle Bögen existieren (Cache `<sheets>/../cache/figuren.json`,
 * `--force` ignoriert ihn).
 */
export async function figurePreviewStep(outDir: string, root = process.cwd()): Promise<string> {
  const cacheDatei = join(dirname(outDir), 'cache', 'figuren.json');
  const hash = eingabeHash(root);
  const force = process.argv.includes('--force');
  if (!force && existsSync(cacheDatei) && FIGUREN_BOEGEN.every((n) => existsSync(join(outDir, n)))) {
    try {
      if ((JSON.parse(readFileSync(cacheDatei, 'utf8')) as { hash?: unknown }).hash === hash) return 'unverändert';
    } catch {
      // Beschädigter Cache: neu erzeugen.
    }
  }
  const d = await laden();
  const boegen: Readonly<Record<(typeof FIGUREN_BOEGEN)[number], Uint8Array>> = {
    'spieler-bewegung.png': bogen('SPIELER-BEWEGUNG (M3-05) - SPIELER_BASIS + LEINENTUNIKA + LEINENHOSE - 3X', d.bewegung.map((a) => aktionsBlock(d, a, 3))),
    'spieler-aktionen.png': bogen('SPIELER-AKTIONEN (M3-06) - SPIELER_BASIS + LEINENTUNIKA + LEINENHOSE - 3X', d.aktionen.map((a) => aktionsBlock(d, a, 3)), 2),
    'spieler-layer.png': bogen('AUSRUESTUNGS-LAYER (M3-07) - STAPELFOLGE UND SOCKEL WIE SRC/RENDER/ANIM/FIGURE.TS', [schichtBlock(d), schlagBlock(d), handBlock(d), fackelBlock(d)]),
    'spieler-licht.png': bogen('LICHT IN DER NEBENHAND (M3-07) - <AKTION>_LICHT MIT FACKEL - 3X', d.mitLicht.map((a) => aktionsBlock(d, a, 3, { ...d.angezogen, nebenhand: d.fackel })), 2),
  };
  for (const name of FIGUREN_BOEGEN) writeIfChanged(join(outDir, name), boegen[name]);
  writeIfChanged(cacheDatei, `${JSON.stringify({ hash, files: [...FIGUREN_BOEGEN] })}\n`);
  return FIGUREN_BOEGEN.map((n) => basename(n)).join(', ');
}

const isMain = import.meta.url === `file://${process.argv[1] ?? ''}`;
if (isMain) console.info(`figure-preview: ${await figurePreviewStep(join(process.cwd(), 'tools/out/sheets'))}`);
