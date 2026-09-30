/**
 * Kreatur-Kontaktbögen M6 (MASTERPROMPT §5 „Qualitätsschleife“, docs/ART.md §15): je Gruppe ein Bogen
 * `kreaturen-m6-<gruppe>.png` (`gruenhain`, `kueste`, `schattenbrut`) nach `tools/out/sheets/`. Je Kreatur:
 *
 * - Kopfzeile: Sprite, Zelle, Farben, Emissiv; Clips mit Frames, Bildrate und Ausholphase.
 * - Spielgröße: der erste Idle-Frame je Richtung in 1× und 2× auf Biomgrund, hellem und dunklem Grund und
 *   als Nachtbild (nur emissive Pixel hell, der Rest in der Nachtfarbe) – Silhouette und Augen bei Nacht.
 * - Je Clip vier Zeilen (down, up, right, left – `left` gespiegelt, wenn das Sprite spiegelbar ist) mit
 *   jeder Clip-Position (Haltephasen als wiederholte Zellen); Ausholphase orange unterstrichen, der
 *   Treffer-Frame rot.
 *
 * CLI: `tsx tools/assets/kreaturen-preview.ts [--force]`; in `npm run assets` als Schritt „Kreaturen“
 * (übersprungen, solange sich keine Eingabe geändert hat). Einzelbogen einer Kreatur zum Arbeiten:
 * `tsx tools/assets/kreaturen-preview.ts --nur <id> <datei.png>`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { KreaturClipInfo } from '../../assets-src/lib/creature';
import { TRANSPARENT, spriteColorCount, spriteHasEmissive, type Sprite } from '../../assets-src/lib/sprite';
import { flatPalette } from '../../assets-src/palette';
import { hashFiles, listFiles, writeIfChanged } from '../lib/files';
import { GLYPH_H, drawText, textWidth } from '../lib/font';
import { RgbaImage, hexRgba, type Rgba } from '../lib/image';

const PALETTE: readonly Rgba[] = flatPalette().map(hexRgba);
const MARGIN = 16;
const GAP = 4;
const LABEL_SCALE = 2;
const LABEL_H = GLYPH_H * LABEL_SCALE + 6;
const KLEIN_H = GLYPH_H + 4;
const RICHTUNGEN = ['down', 'up', 'right', 'left'] as const;
/** Spalten der Kreatur-Blöcke je Bogen. */
const SPALTEN = 2;

const FARBEN = {
  bogen: hexRgba('#1a1426'),
  text: hexRgba('#f4ecd8'),
  leise: hexRgba('#7e8393'),
  aushol: hexRgba('#f07c1f'),
  treffer: hexRgba('#d4473a'),
  hell: hexRgba('#e8d5a8'),
  dunkel: hexRgba('#120e18'),
  nacht: hexRgba('#10203f'),
} as const;

/** Biomgrund je Gruppe. */
const GRUND: Readonly<Record<string, Rgba>> = {
  gruenhain: hexRgba('#4b8c3c'),
  kueste: hexRgba('#dcc27f'),
  schattenbrut: hexRgba('#2f6b3a'),
};

interface Eintrag {
  readonly id: string;
  readonly gruppe: string;
  readonly sprite: Sprite;
  readonly clips: readonly KreaturClipInfo[];
  /** Aktion der Spielgrößen-Zeile (Standard `idle`). */
  readonly spielClip?: string;
}

interface Box {
  readonly w: number;
  readonly h: number;
  draw(img: RgbaImage, x: number, y: number): void;
}

/** Zeichnet Frame `f` von `s` (optional gespiegelt) in Vergrößerung `k`; `nacht`: nur emissive Pixel hell. */
function frame(img: RgbaImage, x: number, y: number, s: Sprite, f: number, k: number, grund: Rgba, spiegeln: boolean, nacht = false): void {
  img.fillRect(x, y, s.w * k, s.h * k, grund);
  const fr = s.frames[f];
  if (fr === undefined) return;
  img.drawScaled(x, y, s.w, s.h, k, (px, py) => {
    const i = py * s.w + (spiegeln ? s.w - 1 - px : px);
    const v = fr.index[i] ?? TRANSPARENT;
    if (v === TRANSPARENT) return null;
    if (nacht && (fr.emissive[i] ?? 0) === 0) return FARBEN.dunkel;
    return PALETTE[v - 1] ?? null;
  });
}

/** Clip einer Aktion in Richtung `r`; `left` fällt bei spiegelbaren Sprites auf `right` (gespiegelt) zurück. */
function clipIn(e: Eintrag, aktion: string, r: string): { clip: KreaturClipInfo; spiegeln: boolean } | null {
  const eigen = e.clips.find((c) => c.aktion === aktion && c.richtung === r);
  if (eigen !== undefined) return { clip: eigen, spiegeln: false };
  if (r === 'left' && e.sprite.spiegelbar) {
    const rechts = e.clips.find((c) => c.aktion === aktion && c.richtung === 'right');
    if (rechts !== undefined) return { clip: rechts, spiegeln: true };
  }
  return null;
}

function kreaturBlock(e: Eintrag): Box {
  const s = e.sprite;
  const k = s.w > 32 ? 2 : 3;
  const zelle = s.w * k + GAP;
  const aktionen = [...new Set(e.clips.map((c) => c.aktion))];
  const kopf = `${s.id.toUpperCase()} - ${s.w}X${s.h} - ${spriteColorCount(s)} FARBEN - ${s.frames.length} FRAMES${spriteHasEmissive(s) ? ' - EMISSIV' : ''}${s.spiegelbar ? ' - LEFT GESPIEGELT' : ''}`;
  const clipZeilen = aktionen.map((a) => {
    const c = e.clips.find((x) => x.aktion === a);
    if (c === undefined) return a;
    const eigene = new Set(c.frames).size;
    const aus = c.ausholen === null ? '' : ` - AUSHOL ${c.ausholen.von}-${c.ausholen.bis} (${((c.ausholen.bis - c.ausholen.von + 1) / c.fps).toFixed(2)} S)`;
    return `${a}: ${eigene} FRAMES ${c.frames.length} POS ${c.fps} FPS${c.loop ? ' LOOP' : ''}${aus}`;
  });
  const maxPos = Math.max(...e.clips.map((c) => c.frames.length));
  // Spielgröße: je Richtung 1× auf vier Gründen, 2× auf Biomgrund.
  const spielW = RICHTUNGEN.length * (4 * (s.w + GAP) + 2 * s.w + GAP * 3);
  const w = Math.max(textWidth(kopf, LABEL_SCALE), ...clipZeilen.map((z) => textWidth(z, 1)), 60 + maxPos * zelle, spielW);
  const zeileH = zelle + 3;
  const aktionH = KLEIN_H + RICHTUNGEN.length * zeileH + GAP;
  const spielH = KLEIN_H + 2 * s.h + GAP * 2;
  const h = LABEL_H + clipZeilen.length * KLEIN_H + spielH + aktionen.length * aktionH + GAP;
  const grund = GRUND[e.gruppe] ?? FARBEN.hell;
  return {
    w,
    h,
    draw(img, x0, y0) {
      let y = y0;
      drawText(img, x0, y, kopf, FARBEN.text, LABEL_SCALE);
      y += LABEL_H;
      for (const z of clipZeilen) {
        drawText(img, x0, y, z, FARBEN.leise, 1);
        y += KLEIN_H;
      }
      drawText(img, x0, y, 'SPIELGROESSE 1X: BIOM - HELL - DUNKEL - NACHT (NUR EMISSIV) | 2X BIOM', FARBEN.leise, 1);
      y += KLEIN_H;
      let x = x0;
      for (const r of RICHTUNGEN) {
        const c = clipIn(e, e.spielClip ?? 'idle', r);
        if (c === null) continue;
        const f = c.clip.frames[0] ?? 0;
        [grund, FARBEN.hell, FARBEN.dunkel].forEach((g) => {
          frame(img, x, y, s, f, 1, g, c.spiegeln);
          x += s.w + GAP;
        });
        frame(img, x, y, s, f, 1, FARBEN.nacht, c.spiegeln, true);
        x += s.w + GAP;
        frame(img, x, y, s, f, 2, grund, c.spiegeln);
        x += 2 * s.w + GAP * 3;
      }
      y += 2 * s.h + GAP * 2;
      for (const a of aktionen) {
        const c0 = e.clips.find((c) => c.aktion === a);
        drawText(img, x0, y, `${a.toUpperCase()}${c0 === undefined ? '' : ` - ${c0.fps} FPS`}`, FARBEN.text, 1);
        y += KLEIN_H;
        for (const r of RICHTUNGEN) {
          const c = clipIn(e, a, r);
          drawText(img, x0, y + zelle / 2 - 3, r, FARBEN.leise, 1);
          if (c !== null) {
            const treffer = new Set((s.clips[c.clip.clip]?.events ?? []).filter((ev) => ev.name === 'treffer').map((ev) => ev.frame));
            c.clip.frames.forEach((f, pos) => {
              const fx = x0 + 60 + pos * zelle;
              frame(img, fx, y, s, f, k, grund, c.spiegeln);
              const aus = c.clip.ausholen;
              if (aus !== null && pos >= aus.von && pos <= aus.bis) img.fillRect(fx, y + s.h * k, s.w * k, 2, FARBEN.aushol);
              if (treffer.has(pos)) img.fillRect(fx, y + s.h * k, s.w * k, 2, FARBEN.treffer);
            });
          }
          y += zeileH;
        }
        y += GAP;
      }
    },
  };
}

/** Bogen aus Kreatur-Blöcken in Spalten (spaltenweise von oben nach unten). */
function bogen(titel: string, bloecke: readonly Box[]): Uint8Array {
  const proSpalte = Math.ceil(bloecke.length / SPALTEN);
  const breite: number[] = [];
  const hoehe: number[] = [];
  bloecke.forEach((b, i) => {
    const s = Math.floor(i / proSpalte);
    breite[s] = Math.max(breite[s] ?? 0, b.w);
    hoehe[s] = (hoehe[s] ?? 0) + b.h + MARGIN * 2;
  });
  const w = Math.max(textWidth(titel, LABEL_SCALE), breite.reduce((a, b) => a + b + MARGIN * 2, -MARGIN * 2)) + 2 * MARGIN;
  const h = MARGIN + LABEL_H + Math.max(...hoehe) + MARGIN;
  const img = new RgbaImage(w, h);
  img.fillRect(0, 0, w, h, FARBEN.bogen);
  drawText(img, MARGIN, MARGIN, titel, FARBEN.text, LABEL_SCALE);
  let x = MARGIN;
  let y = MARGIN + LABEL_H + 4;
  bloecke.forEach((b, i) => {
    const s = Math.floor(i / proSpalte);
    if (i > 0 && i % proSpalte === 0) {
      x += (breite[s - 1] ?? 0) + MARGIN * 2;
      y = MARGIN + LABEL_H + 4;
    }
    b.draw(img, x, y);
    y += b.h + MARGIN * 2;
  });
  return img.toPng();
}

/** Eingaben der Bögen (relativ zur Projektwurzel): ändert sich eine, entstehen die Bögen neu. */
const EINGABEN = ['assets-src/sprites/kreaturen', 'assets-src/sprites/figuren', 'assets-src/lib', 'assets-src/palette.ts', 'src/engine/rng.ts', 'tools/lib', 'tools/assets/kreaturen-preview.ts'] as const;

function eingabeHash(root: string): string {
  const dateien = EINGABEN.flatMap((e) => {
    const pfad = join(root, e);
    return e.endsWith('.ts') ? (existsSync(pfad) ? [pfad] : []) : listFiles(pfad);
  });
  return hashFiles(root, dateien);
}

/** Dateiname des Bogens einer Gruppe. */
export function kreaturenBogen(gruppe: string): string {
  return `kreaturen-m6-${gruppe}.png`;
}

/**
 * Schreibt die Kreatur-Bögen; liefert die Dateinamen oder „unverändert“, wenn der Quell-Hash seit dem
 * letzten Lauf gleich ist und alle Bögen existieren (Cache `<sheets>/../cache/kreaturen.json`, `--force`
 * ignoriert ihn).
 */
export async function kreaturenPreviewStep(outDir: string, root = process.cwd()): Promise<string> {
  const { KREATUR_GRUPPEN, KREATUREN_M6 } = await import('../../assets-src/sprites/kreaturen/_katalog');
  const namen = KREATUR_GRUPPEN.map(kreaturenBogen);
  const cacheDatei = join(dirname(outDir), 'cache', 'kreaturen.json');
  const hash = eingabeHash(root);
  if (!process.argv.includes('--force') && existsSync(cacheDatei) && namen.every((n) => existsSync(join(outDir, n)))) {
    try {
      if ((JSON.parse(readFileSync(cacheDatei, 'utf8')) as { hash?: unknown }).hash === hash) return 'unverändert';
    } catch {
      // Beschädigter Cache: neu erzeugen.
    }
  }
  const geschoss = (await import('../../assets-src/sprites/kreaturen/geschoss_spucken')).default;
  for (const gruppe of KREATUR_GRUPPEN) {
    const eintraege: Eintrag[] = KREATUREN_M6.filter((k) => k.gruppe === gruppe).map((k) => ({ id: k.id, gruppe, sprite: k.ergebnis.sprite, clips: k.ergebnis.clips }));
    if (gruppe === 'schattenbrut') {
      // Das Geschoss des Speiers: richtungslos, im Flug nach rechts gezeichnet.
      const clips: KreaturClipInfo[] = Object.entries(geschoss.clips).map(([name, c]) => ({ clip: name, aktion: name, richtung: 'right', frames: c.frames, fps: c.fps, loop: c.loop, ausholen: null }));
      eintraege.push({ id: 'geschoss_spucken', gruppe, sprite: geschoss, clips, spielClip: 'flug' });
    }
    const titel = `KREATUREN M6 - ${gruppe.toUpperCase()} - ${eintraege.length} SPRITES - AUSHOLPHASE ORANGE, TREFFER ROT`;
    writeIfChanged(join(outDir, kreaturenBogen(gruppe)), bogen(titel, eintraege.map(kreaturBlock)));
  }
  writeIfChanged(cacheDatei, `${JSON.stringify({ hash, files: namen })}\n`);
  return namen.map((n) => basename(n)).join(', ');
}

/** Einzelbogen einer Kreatur (Arbeitsansicht beim Zeichnen). */
async function einzelbogen(id: string, datei: string): Promise<void> {
  const { KREATUREN_M6 } = await import('../../assets-src/sprites/kreaturen/_katalog');
  const k = KREATUREN_M6.find((x) => x.id === id);
  if (k === undefined) throw new Error(`kreaturen-preview: unbekannte Kreatur ${id}`);
  writeIfChanged(datei, bogen(`KREATUR ${id.toUpperCase()}`, [kreaturBlock({ id: k.id, gruppe: k.gruppe, sprite: k.ergebnis.sprite, clips: k.ergebnis.clips })]));
}

const isMain = import.meta.url === `file://${process.argv[1] ?? ''}`;
if (isMain) {
  const nur = process.argv.indexOf('--nur');
  if (nur >= 0) await einzelbogen(process.argv[nur + 1] ?? '', process.argv[nur + 2] ?? join(process.cwd(), 'tools/out/sheets/kreatur.png'));
  else console.info(`kreaturen-preview: ${await kreaturenPreviewStep(join(process.cwd(), 'tools/out/sheets'))}`);
}
