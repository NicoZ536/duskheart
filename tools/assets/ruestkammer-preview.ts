/**
 * Rüstkammer-Vorschau (M6-10, M6-11, M6-12, M6-31; MASTERPROMPT §5 „Qualitätsschleife“): setzt die Spielfigur mit Waffen,
 * Schilden und Rüstung so zusammen, wie der Renderer sie zeichnet (`src/render/anim/figure.ts`: Stapelfolge
 * `FIGURE_LAYER_ORDER`; Overlay-Layer mit dem Frame-Index des Körpers an ihrem eigenen Anker, Sockel-Layer mit ihrem
 * Anker auf dem Sockel des Körper-Frames und ihrem Clip `<aktion>_<richtung>` auf der Clip-Position des Körpers) und
 * schreibt Kontaktbögen nach `tools/out/sheets/`:
 *
 * - `spieler-kampf.png` (M6-10): jede Kampfaktion je Richtung in Abspielfolge (Haltephasen als wiederholte Zellen), mit
 *   einer Waffe ihrer Klasse in der Hand; das Smear-Bild (Event der Aktion) ist markiert. Dazu Block mit Schild und die
 *   Licht-Varianten mit Fackel.
 * - `waffen.png` (M6-11, M6-09): jede Waffe und jeder Schild in der Hand (vorn, hinten, beide Profile) und im Angriff
 *   ihrer Klasse nach rechts, dazu die Icons der Waffen, Munition und Wurfwaffen in 1× und 4×.
 * - `spieler-ruestung.png` (M6-12, M6-31): die drei Sets Faser, Leder und Bronze vollständig und gemischt auf der Figur –
 *   je Richtung Idle, Gehen, Werkzeugschlag, Schwerthieb, Rundumhieb, Block, Rolle, Schwimmen, Sitzen, Schlafen und Tod –,
 *   dazu die Icons der Rüstung, der Materialien und des Lederrucksacks.
 *
 * CLI: `tsx tools/assets/ruestkammer-preview.ts [--force]`; in `npm run assets` als Schritt „Rüstkammer“ (übersprungen,
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

/** Arbeitsfläche je Figur: Körperzelle 32×32 mit Rand für lange Waffen. */
const FLAECHE = 72;
const ZELLE_X = 20;
const ZELLE_Y = 22;
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
  hell: hexRgba('#e8d5a8'),
  smear: hexRgba('#f07c1f'),
} as const;

type Ausstattung = Partial<Record<EquipmentSlot, Sprite>>;

interface Daten {
  readonly koerper: Sprite;
  readonly angezogen: Ausstattung;
  readonly fackel: Sprite;
  readonly waffen: ReadonlyMap<string, Sprite>;
  readonly icons: ReadonlyMap<string, Sprite>;
  readonly ruestung: ReadonlyMap<string, Sprite>;
  readonly ruestungIcons: ReadonlyMap<string, Sprite>;
  readonly angriffe: readonly Aktion[];
  readonly schwer: readonly Aktion[];
  readonly sonst: readonly Aktion[];
  readonly mitLicht: readonly Aktion[];
}

async function laden(): Promise<Daten> {
  const [basis, kleidung, fackel, kampf, nahkampf, fernkampf, schilde, icons, faser, leder, bronze, ruestungIcons] = await Promise.all([
    import('../../assets-src/sprites/figuren/spieler_basis'),
    import('../../assets-src/sprites/ausruestung/kleidung'),
    import('../../assets-src/sprites/ausruestung/fackel'),
    import('../../assets-src/sprites/figuren/_spieler_kampf'),
    import('../../assets-src/sprites/waffen/nahkampf'),
    import('../../assets-src/sprites/waffen/fernkampf'),
    import('../../assets-src/sprites/waffen/schilde'),
    import('../../assets-src/sprites/waffen/icons'),
    import('../../assets-src/sprites/ausruestung/ruestung_faser'),
    import('../../assets-src/sprites/ausruestung/ruestung_leder'),
    import('../../assets-src/sprites/ausruestung/ruestung_bronze'),
    import('../../assets-src/sprites/ausruestung/ruestung_icons'),
  ]);
  const [tunika, hose] = kleidung.default;
  if (tunika === undefined || hose === undefined) throw new Error('Rüstkammer-Vorschau: Kleidung fehlt');
  const waffen = new Map([...nahkampf.default, ...fernkampf.default, ...schilde.default].map((s) => [s.id.replace('ausruestung_', ''), s]));
  return {
    koerper: basis.default,
    angezogen: { koerper: tunika, beine: hose },
    fackel: fackel.default,
    waffen,
    icons: new Map(icons.default.map((s) => [s.id.replace('icon_', ''), s])),
    ruestung: new Map([...faser.default, ...leder.default, ...bronze.default].map((s) => [s.id.replace('ausruestung_', ''), s])),
    ruestungIcons: new Map(ruestungIcons.default.map((s) => [s.id.replace('icon_', ''), s])),
    angriffe: kampf.KAMPF_ANGRIFFE,
    schwer: kampf.KAMPF_SCHWER,
    sonst: kampf.KAMPF_SONST,
    mitLicht: kampf.KAMPF_MIT_LICHT,
  };
}

function waffe(d: Daten, id: string): Sprite {
  const s = d.waffen.get(id);
  if (s === undefined) throw new Error(`Rüstkammer-Vorschau: Waffe ${id} fehlt`);
  return s;
}

/**
 * Zeichnet die Figur in Richtung `r` an Clip-Position `pos` von Clip `aktion` (Körper-Frame `f`): Overlays mit dem
 * Körper-Frame an ihrem Anker, Sockel-Layer mit ihrem Clip `<aktion>_<r>` bzw. ihrem Halte-Clip.
 */
function figur(d: Daten, r: Richtung, f: number, aktion: string | null, pos: number, ausstattung: Ausstattung): Uint8Array {
  const out = new Uint8Array(FLAECHE * FLAECHE);
  const k = d.koerper;
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
      blit(k, f, ZELLE_X, ZELLE_Y);
      continue;
    }
    const item = ausstattung[teil];
    if (item === undefined) continue;
    const sockel = SLOT_SOCKET[teil];
    if (sockel === null) {
      blit(item, f, ZELLE_X + k.anchor[0] - item.anchor[0], ZELLE_Y + k.anchor[1] - item.anchor[1]);
      continue;
    }
    const p = k.sockets[sockel]?.[f];
    if (p === undefined) continue;
    const eigen = aktion === null ? undefined : item.clips[`${aktion}_${r}`];
    const halten = item.clips[r];
    const frame = eigen !== undefined ? (eigen.frames[Math.min(pos, eigen.frames.length - 1)] ?? 0) : (halten?.frames[0] ?? 0);
    blit(item, frame, ZELLE_X + p[0] - item.anchor[0], ZELLE_Y + p[1] - item.anchor[1]);
  }
  return out;
}

interface Zelle {
  readonly pixel: Uint8Array;
  readonly marke?: string;
  readonly betont?: boolean;
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
  readonly flaeche?: number;
}

const TITEL_BREITE = textWidth('right', 1) + 10;

function blockGroesse(b: Block): { w: number; h: number } {
  const f = b.flaeche ?? FLAECHE;
  const zelle = f * b.skala + GAP;
  const w = Math.max(textWidth(b.titel, LABEL_SCALE), TITEL_BREITE + Math.max(0, ...b.zeilen.map((z) => z.zellen.length)) * zelle);
  return { w, h: LABEL_H + b.zeilen.length * zelle };
}

function zeichneBlock(img: RgbaImage, x: number, y: number, b: Block): void {
  const f = b.flaeche ?? FLAECHE;
  drawText(img, x, y, b.titel, FARBEN.text, LABEL_SCALE);
  const zelle = f * b.skala + GAP;
  b.zeilen.forEach((zeile, zi) => {
    const zy = y + LABEL_H + zi * zelle;
    drawText(img, x, zy + (f * b.skala) / 2 - 2, zeile.titel, FARBEN.leise, 1);
    zeile.zellen.forEach((z, i) => {
      const zx = x + TITEL_BREITE + i * zelle;
      img.fillRect(zx, zy, f * b.skala, f * b.skala, b.grund);
      img.drawScaled(zx, zy, f, f, b.skala, (px, py) => {
        const v = z.pixel[py * f + px] ?? TRANSPARENT;
        return v === TRANSPARENT ? null : (PALETTE[v - 1] ?? null);
      });
      if (z.betont === true) img.strokeRect(zx - 1, zy - 1, f * b.skala + 2, f * b.skala + 2, FARBEN.smear);
      if (z.marke !== undefined) drawText(img, zx + 2, zy + 2, z.marke, FARBEN.leise, 1);
    });
  });
}

/** Bogen aus Blöcken in `spalten` Spalten (spaltenweise von oben nach unten). */
function bogen(titel: string, bloecke: readonly Block[], spalten = 1): Uint8Array {
  const groessen = bloecke.map(blockGroesse);
  const proSpalte = Math.ceil(bloecke.length / spalten);
  const breite: number[] = [];
  const hoehe: number[] = [];
  groessen.forEach((g, i) => {
    const s = Math.floor(i / proSpalte);
    breite[s] = Math.max(breite[s] ?? 0, g.w);
    hoehe[s] = (hoehe[s] ?? 0) + g.h + MARGIN;
  });
  const w = Math.max(textWidth(titel, LABEL_SCALE), breite.reduce((a, b) => a + b + MARGIN, -MARGIN)) + 2 * MARGIN;
  const h = MARGIN + LABEL_H + Math.max(...hoehe) + MARGIN;
  const img = new RgbaImage(w, h);
  img.fillRect(0, 0, w, h, FARBEN.bogen);
  drawText(img, MARGIN, MARGIN, titel, FARBEN.text, LABEL_SCALE);
  let x = MARGIN;
  let y = MARGIN + LABEL_H + 4;
  bloecke.forEach((b, i) => {
    const s = Math.floor(i / proSpalte);
    if (i > 0 && i % proSpalte === 0) {
      x += (breite[s - 1] ?? 0) + MARGIN;
      y = MARGIN + LABEL_H + 4;
    }
    zeichneBlock(img, x, y, b);
    y += (groessen[i]?.h ?? 0) + MARGIN;
  });
  return img.toPng();
}

/** Block einer Aktion: je Richtung jede Clip-Position; das Bild des Aktions-Events ist betont. */
function aktionsBlock(d: Daten, a: Aktion, ausstattung: Ausstattung, zusatz: string, skala = 2): Block {
  const zeilen = RICHTUNGEN.map((r) => {
    const clip = d.koerper.clips[`${a.name}_${r}`];
    if (clip === undefined) throw new Error(`Rüstkammer-Vorschau: Clip ${a.name}_${r} fehlt`);
    return {
      titel: r,
      zellen: clip.frames.map((f, pos) => ({
        pixel: figur(d, r, f, a.name, pos, ausstattung),
        marke: String(pos),
        betont: a.events.some((e) => e.frame === pos),
      })),
    };
  });
  const events = a.events.map((e) => `${e.name}(${e.frame})`).join(' ');
  return { titel: `${a.name} - ${a.fps} FPS${a.loop ? ' LOOP' : ''}${events === '' ? '' : ` - ${events}`} - ${zusatz}`, zeilen, skala, grund: FARBEN.wiese };
}

/** Waffe, mit der eine Aktion im Kampfbogen gezeigt wird (`null` = Faust). */
const WAFFE_JE_AKTION: Readonly<Record<string, string | null>> = {
  faust: null,
  schwert: 'bronzeschwert',
  axt: 'bronzekampfaxt',
  keule: 'bronzestreitkolben',
  speer: 'bronzespeer',
  dolch: 'bronzedolch',
  zweihand: 'bronzezweihaender',
  armbrust: 'armbrust',
  schleuder: 'schleuder',
  bogen: 'kurzbogen',
  wurf: null,
};

function klasseDer(a: Aktion): string {
  return a.name.replace(/^(attack|heavy)_/, '').replace(/_licht$/, '');
}

function kampfBoegen(d: Daten): Uint8Array {
  const mitWaffe = (a: Aktion, extra: Ausstattung = {}): Block => {
    const id = WAFFE_JE_AKTION[klasseDer(a)] ?? null;
    const aus: Ausstattung = { ...d.angezogen, ...(id === null ? {} : { waffe: waffe(d, id) }), ...extra };
    return aktionsBlock(d, a, aus, id === null ? 'OHNE WAFFE' : id.toUpperCase());
  };
  const block = d.sonst.find((a) => a.name === 'block');
  if (block === undefined) throw new Error('Rüstkammer-Vorschau: Aktion block fehlt');
  const bloecke: Block[] = [
    ...d.angriffe.map((a) => mitWaffe(a)),
    ...d.schwer.map((a) => mitWaffe(a)),
    ...d.sonst.filter((a) => a !== block).map((a) => mitWaffe(a)),
    aktionsBlock(d, block, { ...d.angezogen, waffe: waffe(d, 'bronzeschwert'), nebenhand: waffe(d, 'holzschild') }, 'BRONZESCHWERT + HOLZSCHILD'),
    aktionsBlock(d, block, { ...d.angezogen, waffe: waffe(d, 'bronzekriegshammer') }, 'BRONZEKRIEGSHAMMER'),
    ...d.mitLicht.filter((a) => ['attack_schwert_licht', 'heavy_axt_licht', 'attack_speer_licht'].includes(a.name)).map((a) => mitWaffe(a, { nebenhand: d.fackel })),
  ];
  return bogen('SPIELER-KAMPF (M6-10) - KAMPFAKTIONEN JE RICHTUNG IN ABSPIELFOLGE - EVENT-BILD (SMEAR) BETONT - 2X', bloecke, 2);
}

/** Waffen in der Hand je Richtung (Idle-Frame 0) und im Angriff ihrer Klasse nach rechts. */
function waffenBogen(d: Daten): Uint8Array {
  const halten: Zeile[] = RICHTUNGEN.map((r) => {
    const f = d.koerper.clips[`idle_${r}`]?.frames[0] ?? 0;
    return {
      titel: r,
      zellen: [...d.waffen.entries()].map(([id, s]) => ({ pixel: figur(d, r, f, null, 0, { ...d.angezogen, [id.endsWith('schild') ? 'nebenhand' : 'waffe']: s }), marke: id.slice(0, 12) })),
    };
  });
  const angriffe: Zeile[] = [...d.waffen.entries()]
    .filter(([id]) => !id.endsWith('schild'))
    .map(([id, s]) => {
      const aktion = Object.keys(s.clips).find((c) => c.startsWith('attack_') && c.endsWith('_right') && !c.includes('_licht'));
      const name = aktion?.replace(/_right$/, '') ?? 'idle';
      const clip = d.koerper.clips[`${name}_right`];
      return { titel: id.slice(0, 5), zellen: (clip?.frames ?? []).map((f, pos) => ({ pixel: figur(d, 'right', f, name, pos, { ...d.angezogen, waffe: s }), marke: String(pos) })) };
    });
  return bogen('WAFFEN UND SCHILDE (M6-11, M6-09) - IN DER HAND UND IM ANGRIFF - ICONS', [
    { titel: 'IN DER HAND (IDLE) - VORN, HINTEN, PROFIL RECHTS UND LINKS - 2X', zeilen: halten, skala: 2, grund: FARBEN.wiese },
    { titel: 'ANGRIFF DER KLASSE NACH RECHTS - 2X', zeilen: angriffe, skala: 2, grund: FARBEN.wiese },
    iconBlock(d.icons, 1),
    iconBlock(d.icons, 4),
  ]);
}

/** Icons (16×16) in `skala`, auf hellem Grund. */
function iconBlock(icons: ReadonlyMap<string, Sprite>, skala: number): Block {
  const f = 16;
  const zellen = [...icons.values()].map((s) => {
    const px = new Uint8Array(f * f);
    px.set(s.frames[0]?.index ?? new Uint8Array(f * f));
    return { pixel: px };
  });
  const proZeile = skala === 1 ? 60 : 16;
  const zeilen: Zeile[] = [];
  for (let i = 0; i < zellen.length; i += proZeile) zeilen.push({ titel: '', zellen: zellen.slice(i, i + proZeile) });
  return { titel: `ICONS ${skala}X`, zeilen, skala, grund: FARBEN.hell, flaeche: f };
}

/** Körperclips und Clip-Positionen, mit denen die Rüstung gezeigt wird (Alltag, Kampf, Sonderposen). */
const RUESTUNG_POSEN: readonly (readonly [string, number])[] = [
  ['idle', 0],
  ['walk', 0],
  ['walk', 1],
  ['walk', 3],
  ['tool', 3],
  ['attack_schwert', 1],
  ['attack_schwert', 3],
  ['heavy_schwert', 4],
  ['block', 1],
  ['roll', 1],
  ['swim', 0],
  ['sit', 0],
  ['sleep', 0],
  ['death', 5],
];

function ruestungsTeil(d: Daten, id: string): Sprite {
  const s = d.ruestung.get(id);
  if (s === undefined) throw new Error(`Rüstkammer-Vorschau: Rüstungsteil ${id} fehlt`);
  return s;
}

/** Ein Satz Rüstung (Kopf, Brust, Beine, Füße; `null` = Kleidung des Schiffbrüchigen bzw. nichts) auf der Figur. */
function ruestungsBlock(d: Daten, titel: string, teile: readonly [string | null, string | null, string | null, string | null], hand: string | null): Block {
  const [kopf, brust, beine, fuesse] = teile;
  const aus: Ausstattung = {
    koerper: brust === null ? d.angezogen.koerper : ruestungsTeil(d, brust),
    beine: beine === null ? d.angezogen.beine : ruestungsTeil(d, beine),
    ...(kopf === null ? {} : { kopf: ruestungsTeil(d, kopf) }),
    ...(fuesse === null ? {} : { fuesse: ruestungsTeil(d, fuesse) }),
    ...(hand === null ? {} : { waffe: waffe(d, hand) }),
  };
  const zeilen = RICHTUNGEN.map((r) => ({
    titel: r,
    zellen: RUESTUNG_POSEN.map(([aktion, pos]) => {
      const clip = d.koerper.clips[`${aktion}_${r}`];
      if (clip === undefined) throw new Error(`Rüstkammer-Vorschau: Clip ${aktion}_${r} fehlt`);
      const f = clip.frames[Math.min(pos, clip.frames.length - 1)] ?? 0;
      return { pixel: figur(d, r, f, aktion, pos, aus), marke: aktion.slice(0, 6) };
    }),
  }));
  return { titel, zeilen, skala: 2, grund: FARBEN.wiese };
}

function ruestungsBogen(d: Daten): Uint8Array {
  return bogen('RUESTUNG (M6-12, M6-31) - SETS AUF DER FIGUR - LAYER AUS DEN KOERPERPOSEN - 2X', [
    ruestungsBlock(d, 'FASERGEWAND (T0): FASERKAPPE, FASERHEMD, FASERHOSE, FASERSCHUHE + FEUERSTEINKLINGE', ['faserkappe', 'faserhemd', 'faserhose', 'faserschuhe'], 'feuersteinklinge'),
    ruestungsBlock(d, 'LEDER (T1): LEDERKAPPE, LEDERWAMS, LEDERHOSE, LEDERSTIEFEL + KNOCHENDOLCH', ['lederkappe', 'lederwams', 'lederhose', 'lederstiefel'], 'knochendolch'),
    ruestungsBlock(d, 'BRONZE (T1): BRONZEHELM, BRONZEBRUSTPANZER, BRONZEBEINSCHIENEN, BRONZESTIEFEL + BRONZESCHWERT', ['bronzehelm', 'bronzebrustpanzer', 'bronzebeinschienen', 'bronzestiefel'], 'bronzeschwert'),
    ruestungsBlock(d, 'GEMISCHT: BRONZEHELM, LEDERWAMS, FASERHOSE, LEDERSTIEFEL', ['bronzehelm', 'lederwams', 'faserhose', 'lederstiefel'], null),
    ruestungsBlock(d, 'EINZELN UEBER DER KLEIDUNG: LEDERKAPPE, BRONZESTIEFEL (TUNIKA UND HOSE DES SCHIFFBRUECHIGEN)', ['lederkappe', null, null, 'bronzestiefel'], null),
    iconBlock(d.ruestungIcons, 1),
    iconBlock(d.ruestungIcons, 4),
  ]);
}

/** Namen der Bögen. */
export const RUESTKAMMER_BOEGEN = ['spieler-kampf.png', 'waffen.png', 'spieler-ruestung.png'] as const;

const EINGABEN = ['assets-src/sprites/figuren', 'assets-src/sprites/ausruestung', 'assets-src/sprites/waffen', 'assets-src/lib', 'assets-src/palette.ts', 'src/render/anim', 'tools/lib', 'tools/assets/ruestkammer-preview.ts'] as const;

function eingabeHash(root: string): string {
  const dateien = EINGABEN.flatMap((e) => {
    const pfad = join(root, e);
    return e.endsWith('.ts') ? (existsSync(pfad) ? [pfad] : []) : listFiles(pfad);
  });
  return hashFiles(root, dateien);
}

/** Schreibt die Rüstkammer-Bögen (Cache `<sheets>/../cache/ruestkammer.json`, `--force` ignoriert ihn). */
export async function ruestkammerPreviewStep(outDir: string, root = process.cwd()): Promise<string> {
  const cacheDatei = join(dirname(outDir), 'cache', 'ruestkammer.json');
  const hash = eingabeHash(root);
  if (!process.argv.includes('--force') && existsSync(cacheDatei) && RUESTKAMMER_BOEGEN.every((n) => existsSync(join(outDir, n)))) {
    try {
      if ((JSON.parse(readFileSync(cacheDatei, 'utf8')) as { hash?: unknown }).hash === hash) return 'unverändert';
    } catch {
      // Beschädigter Cache: neu erzeugen.
    }
  }
  const d = await laden();
  const boegen: Readonly<Record<(typeof RUESTKAMMER_BOEGEN)[number], Uint8Array>> = {
    'spieler-kampf.png': kampfBoegen(d),
    'waffen.png': waffenBogen(d),
    'spieler-ruestung.png': ruestungsBogen(d),
  };
  for (const name of RUESTKAMMER_BOEGEN) writeIfChanged(join(outDir, name), boegen[name]);
  writeIfChanged(cacheDatei, `${JSON.stringify({ hash, files: [...RUESTKAMMER_BOEGEN] })}\n`);
  return RUESTKAMMER_BOEGEN.map((n) => basename(n)).join(', ');
}

const isMain = import.meta.url === `file://${process.argv[1] ?? ''}`;
if (isMain) console.info(`ruestkammer-preview: ${await ruestkammerPreviewStep(join(process.cwd(), 'tools/out/sheets'))}`);
