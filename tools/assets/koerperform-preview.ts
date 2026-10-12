/**
 * Körperform-Vorschau (M7-113; MASTERPROMPT §4.5 „Spieler: Idle 4, Gehen 6, Rennen 6, Rolle 5, Angriff je Waffenklasse 4–6,
 * Werkzeug 4, Treffer 2, Tod 6, Schwimmen 4, Sitzen, Schlafen, Essen, Trinken, Tragen – je 4 Richtungen“, §26 „Körperform“):
 * je Körperform (`schmal`, `mittel`, `kraeftig`) ein Kontaktbogen `koerperform-<form>.png` mit **allen Aktionsclips** der
 * Spielfigur – Alltag, Licht-Varianten, Musizieren, Angeln und Kampf –, je Richtung eine Zeile mit den eigenen Bildern des Clips
 * in der Reihenfolge ihres ersten Auftritts (die Zahl der Bilder je Richtung steht im Blocktitel, das Bild des Aktions-Events ist
 * betont), angezogen mit Tunika und Hose der Form, in der Hand, was die Aktion hält (Steinaxt, die Waffe der Klasse, Schild,
 * Fackel, Flöte). Zuletzt die drei Rüstungssätze der Form (M7-110) in Alltags-, Kampf- und Sonderposen.
 *
 * Zusammengesetzt wie im Renderer (`src/render/anim/figure.ts`: Stapelfolge `FIGURE_LAYER_ORDER`; Overlay-Layer mit dem
 * Frame-Index des Körpers, Sockel-Layer mit ihrem Anker auf dem Sockel des Körper-Frames und ihrem Clip `<aktion>_<richtung>`
 * auf der Clip-Position des Körpers). Die Form spielt die Clips von `spieler_basis` (gleiche Frames, eigene Sockel, M7-53).
 *
 * CLI: `tsx tools/assets/koerperform-preview.ts [--force]`; in `npm run assets` als Schritt „Körperformen“ (übersprungen,
 * solange sich keine Eingabe geändert hat).
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { RICHTUNGEN, type Richtung } from '../../assets-src/lib/figure';
import { TRANSPARENT, type Sprite } from '../../assets-src/lib/sprite';
import { flatPalette } from '../../assets-src/palette';
import type { Aktion } from '../../assets-src/sprites/figuren/_spieler_aktionen';
import type { KoerperForm } from '../../assets-src/sprites/figuren/_spieler_formen';
import { FIGURE_LAYER_ORDER, SLOT_SOCKET, type EquipmentSlot } from '../../src/render/anim/figure';
import { hashFiles, listFiles, writeIfChanged } from '../lib/files';
import { GLYPH_H, drawText, textWidth } from '../lib/font';
import { RgbaImage, hexRgba, type Rgba } from '../lib/image';

/** Arbeitsfläche je Figur: Körperzelle 32×32 mit Rand für lange Waffen. */
const FLAECHE = 72;
const ZELLE_X = 20;
const ZELLE_Y = 22;
const SKALA = 2;
const MARGIN = 16;
const GAP = 6;
const LABEL_SCALE = 2;
const LABEL_H = GLYPH_H * LABEL_SCALE + 8;
/** Spalten des Bogens (die Blöcke fließen spaltenweise). */
const SPALTEN = 4;

const PALETTE: readonly Rgba[] = flatPalette().map(hexRgba);
const FARBEN = {
  bogen: hexRgba('#1a1426'),
  text: hexRgba('#f4ecd8'),
  leise: hexRgba('#7e8393'),
  wiese: hexRgba('#4b8c3c'),
  nacht: hexRgba('#10203f'),
  smear: hexRgba('#f07c1f'),
} as const;

/** Die Körperformen in der Reihenfolge der Charaktererstellung. */
const FORMEN: readonly KoerperForm[] = ['schmal', 'mittel', 'kraeftig'];

type Ausstattung = Partial<Record<EquipmentSlot, Sprite>>;

/** Was eine Form zum Zeichnen braucht. */
interface Figur {
  readonly form: KoerperForm;
  /** Körper der Form (Frames und Sockel); die Clips sind die von `spieler_basis`. */
  readonly koerper: Sprite;
  readonly clips: Sprite['clips'];
  readonly angezogen: Ausstattung;
  /** Rüstungsteile der Form nach Item-Id. */
  readonly ruestung: ReadonlyMap<string, Sprite>;
}

interface Daten {
  readonly figuren: readonly Figur[];
  readonly aktionen: readonly Aktion[];
  readonly lichtSuffix: string;
  readonly waffen: ReadonlyMap<string, Sprite>;
  readonly fackel: Sprite;
  readonly axt: Sprite;
  /** Instrumente nach Sprite-Id ohne `ausruestung_` (`floete`, `floete_schmal` …). */
  readonly instrumente: ReadonlyMap<string, Sprite>;
}

async function laden(): Promise<Daten> {
  const [basis, kleidung, formen, ruestungFormen, faser, leder, bronze, aktionen, kampf, nahkampf, fernkampf, schilde, fackel, werkzeuge, instrumente] = await Promise.all([
    import('../../assets-src/sprites/figuren/spieler_basis'),
    import('../../assets-src/sprites/ausruestung/kleidung'),
    import('../../assets-src/sprites/figuren/spieler_formen'),
    import('../../assets-src/sprites/figuren/ruestung_formen'),
    import('../../assets-src/sprites/ausruestung/ruestung_faser'),
    import('../../assets-src/sprites/ausruestung/ruestung_leder'),
    import('../../assets-src/sprites/ausruestung/ruestung_bronze'),
    import('../../assets-src/sprites/figuren/_spieler_aktionen'),
    import('../../assets-src/sprites/figuren/_spieler_kampf'),
    import('../../assets-src/sprites/waffen/nahkampf'),
    import('../../assets-src/sprites/waffen/fernkampf'),
    import('../../assets-src/sprites/waffen/schilde'),
    import('../../assets-src/sprites/ausruestung/fackel'),
    import('../../assets-src/sprites/ausruestung/werkzeuge'),
    import('../../assets-src/sprites/figuren/instrumente'),
  ]);
  const [tunika, hose] = kleidung.default;
  const axt = werkzeuge.default.find((w) => w.id === 'ausruestung_steinaxt');
  if (tunika === undefined || hose === undefined || axt === undefined) throw new Error('Körperform-Vorschau: Kleidung oder Steinaxt fehlt');
  const ohnePraefix = (s: Sprite): string => s.id.replace(/^ausruestung_/, '');
  const figuren = FORMEN.map((form): Figur => {
    if (form === 'mittel') {
      return { form, koerper: basis.default, clips: basis.default.clips, angezogen: { koerper: tunika, beine: hose }, ruestung: new Map([...faser.default, ...leder.default, ...bronze.default].map((s) => [ohnePraefix(s), s])) };
    }
    const [koerper, , formTunika, formHose] = formen.formSprites(form);
    if (koerper === undefined || formTunika === undefined || formHose === undefined) throw new Error(`Körperform-Vorschau: Form ${form} fehlt`);
    const suffix = `_${form}`;
    const ruestung = new Map(ruestungFormen.default.filter((s) => s.id.endsWith(suffix)).map((s) => [ohnePraefix(s).slice(0, -suffix.length), s]));
    return { form, koerper, clips: basis.default.clips, angezogen: { koerper: formTunika, beine: formHose }, ruestung };
  });
  return {
    figuren,
    aktionen: [...aktionen.AKTIONEN, ...kampf.KAMPF_AKTIONEN],
    lichtSuffix: aktionen.LICHT_SUFFIX,
    waffen: new Map([...nahkampf.default, ...fernkampf.default, ...schilde.default].map((s) => [ohnePraefix(s), s])),
    fackel: fackel.default,
    axt,
    instrumente: new Map(instrumente.default.filter((s) => s.id.startsWith('ausruestung_')).map((s) => [ohnePraefix(s), s])),
  };
}

/** Zeichnet die Figur in Richtung `r` an Clip-Position `pos` von Clip `aktion` (Körper-Frame `f`) wie der Renderer. */
function bild(k: Sprite, r: Richtung, f: number, aktion: string | null, pos: number, ausstattung: Ausstattung): Uint8Array {
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
  readonly grund: Rgba;
}

const TITEL_BREITE = textWidth('right', 1) + 10;
const ZELLE = FLAECHE * SKALA + GAP;

function blockGroesse(b: Block): { w: number; h: number } {
  const w = Math.max(textWidth(b.titel, LABEL_SCALE), TITEL_BREITE + Math.max(0, ...b.zeilen.map((z) => z.zellen.length)) * ZELLE);
  return { w, h: LABEL_H + b.zeilen.length * ZELLE };
}

function zeichneBlock(img: RgbaImage, x: number, y: number, b: Block): void {
  drawText(img, x, y, b.titel, FARBEN.text, LABEL_SCALE);
  b.zeilen.forEach((zeile, zi) => {
    const zy = y + LABEL_H + zi * ZELLE;
    drawText(img, x, zy + (FLAECHE * SKALA) / 2 - 2, zeile.titel, FARBEN.leise, 1);
    zeile.zellen.forEach((z, i) => {
      const zx = x + TITEL_BREITE + i * ZELLE;
      img.fillRect(zx, zy, FLAECHE * SKALA, FLAECHE * SKALA, b.grund);
      img.drawScaled(zx, zy, FLAECHE, FLAECHE, SKALA, (px, py) => {
        const v = z.pixel[py * FLAECHE + px] ?? TRANSPARENT;
        return v === TRANSPARENT ? null : (PALETTE[v - 1] ?? null);
      });
      if (z.betont === true) img.strokeRect(zx - 1, zy - 1, FLAECHE * SKALA + 2, FLAECHE * SKALA + 2, FARBEN.smear);
      if (z.marke !== undefined) drawText(img, zx + 2, zy + 2, z.marke, FARBEN.leise, 1);
    });
  });
}

/** Bogen aus Blöcken in `SPALTEN` Spalten (spaltenweise von oben nach unten). */
function bogen(titel: string, bloecke: readonly Block[]): Uint8Array {
  const groessen = bloecke.map(blockGroesse);
  const proSpalte = Math.ceil(bloecke.length / SPALTEN);
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

/** Waffe, mit der eine Kampfaktion gezeigt wird (`null` = Faust, ohne Waffe), wie im Rüstkammer-Bogen. */
const WAFFE_JE_KLASSE: Readonly<Record<string, string | null>> = {
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
  block: 'bronzeschwert',
  block_schild: 'bronzeschwert',
};

/** Was die Hände in Aktion `name` halten (Werkzeug, Waffe, Schild, Fackel, Instrument) und wie es im Titel heißt. */
function haende(d: Daten, f: Figur, name: string): { aus: Ausstattung; titel: string } {
  const licht = name.endsWith(d.lichtSuffix);
  const basis = licht ? name.slice(0, -d.lichtSuffix.length) : name;
  const aus: Ausstattung = { ...f.angezogen, ...(licht ? { nebenhand: d.fackel } : {}) };
  const namen: string[] = licht ? ['FACKEL'] : [];
  const nimm = (slot: EquipmentSlot, id: string, s: Sprite | undefined): void => {
    if (s === undefined) throw new Error(`Körperform-Vorschau: ${id} fehlt`);
    aus[slot] = s;
    namen.unshift(id.toUpperCase());
  };
  if (basis === 'tool') nimm('waffe', 'steinaxt', d.axt);
  else if (basis === 'musizieren') nimm('waffe', 'floete', d.instrumente.get(f.form === 'mittel' ? 'floete' : `floete_${f.form}`));
  else {
    const klasse = basis.replace(/^(attack|heavy)_/, '');
    const waffe = WAFFE_JE_KLASSE[klasse];
    if (waffe !== undefined && waffe !== null) nimm('waffe', waffe, d.waffen.get(waffe));
    if (basis === 'block_schild') nimm('nebenhand', 'holzschild', d.waffen.get('holzschild'));
  }
  return { aus, titel: namen.length === 0 ? 'OHNE GEGENSTAND' : namen.join(' + ') };
}

/** Block einer Aktion: je Richtung die eigenen Bilder des Clips in der Reihenfolge ihres ersten Auftritts. */
function aktionsBlock(d: Daten, f: Figur, a: Aktion): Block {
  const { aus, titel: hand } = haende(d, f, a.name);
  const anzahl: number[] = [];
  const zeilen = RICHTUNGEN.map((r) => {
    const clip = f.clips[`${a.name}_${r}`];
    if (clip === undefined) throw new Error(`Körperform-Vorschau: Clip ${a.name}_${r} fehlt`);
    const erste = new Map<number, number>();
    clip.frames.forEach((frame, pos) => {
      if (!erste.has(frame)) erste.set(frame, pos);
    });
    anzahl.push(erste.size);
    return {
      titel: r,
      zellen: [...erste].map(([frame, pos]) => ({
        pixel: bild(f.koerper, r, frame, a.name, pos, aus),
        marke: String(pos),
        betont: a.events.some((e) => clip.frames[e.frame] === frame),
      })),
    };
  });
  const events = a.events.map((e) => `${e.name}(${e.frame})`).join(' ');
  return {
    titel: `${a.name} - ${a.fps} FPS${a.loop ? ' LOOP' : ''} - BILDER ${anzahl.join('/')}${events === '' ? '' : ` - ${events}`} - ${hand}`,
    zeilen,
    grund: a.name.endsWith(d.lichtSuffix) ? FARBEN.nacht : FARBEN.wiese,
  };
}

/** Körperclips und Clip-Positionen, mit denen die Rüstung gezeigt wird (Alltag, Kampf, Sonderposen). */
const RUESTUNG_POSEN: readonly (readonly [string, number])[] = [
  ['idle', 0],
  ['walk', 1],
  ['walk', 3],
  ['tool', 3],
  ['attack_schwert', 3],
  ['heavy_schwert', 4],
  ['block', 1],
  ['roll', 1],
  ['swim', 0],
  ['sit', 0],
  ['sleep', 0],
  ['musizieren', 0],
];

/** Ein Rüstungssatz (Kopf, Brust, Beine, Füße) auf der Figur der Form. */
function ruestungsBlock(f: Figur, titel: string, teile: readonly [string, string, string, string]): Block {
  const teil = (id: string): Sprite => {
    const s = f.ruestung.get(id);
    if (s === undefined) throw new Error(`Körperform-Vorschau: ${id} in ${f.form} fehlt`);
    return s;
  };
  const [kopf, brust, beine, fuesse] = teile;
  const aus: Ausstattung = { kopf: teil(kopf), koerper: teil(brust), beine: teil(beine), fuesse: teil(fuesse) };
  const zeilen = RICHTUNGEN.map((r) => ({
    titel: r,
    zellen: RUESTUNG_POSEN.map(([aktion, pos]) => {
      const clip = f.clips[`${aktion}_${r}`];
      if (clip === undefined) throw new Error(`Körperform-Vorschau: Clip ${aktion}_${r} fehlt`);
      const frame = clip.frames[Math.min(pos, clip.frames.length - 1)] ?? 0;
      return { pixel: bild(f.koerper, r, frame, aktion, pos, aus), marke: aktion.slice(0, 6) };
    }),
  }));
  return { titel: `${titel} (${f.form.toUpperCase()})`, zeilen, grund: FARBEN.wiese };
}

function formBogen(d: Daten, f: Figur): Uint8Array {
  return bogen(`KOERPERFORM ${f.form.toUpperCase()} (M7-113) - ALLE ${d.aktionen.length} AKTIONSCLIPS JE RICHTUNG - EIGENE BILDER IN ABSPIELFOLGE - EVENT-BILD BETONT - RUESTUNG DER FORM (M7-110) - ${SKALA}X`, [
    ...d.aktionen.map((a) => aktionsBlock(d, f, a)),
    ruestungsBlock(f, 'FASERGEWAND', ['faserkappe', 'faserhemd', 'faserhose', 'faserschuhe']),
    ruestungsBlock(f, 'LEDER', ['lederkappe', 'lederwams', 'lederhose', 'lederstiefel']),
    ruestungsBlock(f, 'BRONZE', ['bronzehelm', 'bronzebrustpanzer', 'bronzebeinschienen', 'bronzestiefel']),
  ]);
}

/** Namen der Bögen (je Form einer). */
export const KOERPERFORM_BOEGEN = FORMEN.map((f) => `koerperform-${f}.png`);

/** Eingaben der Bögen (relativ zur Projektwurzel): ändert sich eine, entstehen die Bögen neu. */
const EINGABEN = ['assets-src/sprites/figuren', 'assets-src/sprites/ausruestung', 'assets-src/sprites/waffen', 'assets-src/lib', 'assets-src/palette.ts', 'src/render/anim', 'tools/lib', 'tools/assets/koerperform-preview.ts'] as const;

function eingabeHash(root: string): string {
  const dateien = EINGABEN.flatMap((e) => {
    const pfad = join(root, e);
    return e.endsWith('.ts') ? (existsSync(pfad) ? [pfad] : []) : listFiles(pfad);
  });
  return hashFiles(root, dateien);
}

/** Schreibt die Körperform-Bögen (Cache `<sheets>/../cache/koerperformen.json`, `--force` ignoriert ihn). */
export async function koerperformPreviewStep(outDir: string, root = process.cwd()): Promise<string> {
  const cacheDatei = join(dirname(outDir), 'cache', 'koerperformen.json');
  const hash = eingabeHash(root);
  if (!process.argv.includes('--force') && existsSync(cacheDatei) && KOERPERFORM_BOEGEN.every((n) => existsSync(join(outDir, n)))) {
    try {
      if ((JSON.parse(readFileSync(cacheDatei, 'utf8')) as { hash?: unknown }).hash === hash) return 'unverändert';
    } catch {
      // Beschädigter Cache: neu erzeugen.
    }
  }
  const d = await laden();
  d.figuren.forEach((f, i) => writeIfChanged(join(outDir, KOERPERFORM_BOEGEN[i] ?? `koerperform-${f.form}.png`), formBogen(d, f)));
  writeIfChanged(cacheDatei, `${JSON.stringify({ hash, files: KOERPERFORM_BOEGEN })}\n`);
  return KOERPERFORM_BOEGEN.map((n) => basename(n)).join(', ');
}

const isMain = import.meta.url === `file://${process.argv[1] ?? ''}`;
if (isMain) console.info(`koerperform-preview: ${await koerperformPreviewStep(join(process.cwd(), 'tools/out/sheets'))}`);
