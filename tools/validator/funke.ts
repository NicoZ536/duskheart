/**
 * Funke-Regel des Content-Validators (MASTERPROMPT §8 „Funke … höchstens 2 Zeilen pro Einwurf“; docs/SPIEL.md §23 „Funke:
 * höchstens 2 Zeilen (gemessen mit der Pixelschrift in der Funke-Box, Validator-Regel `funke`) … ≥ 40 Kommentare DE/EN“;
 * M7-44 – Strang G). Reine Funktionen über eine Registry und eine Breitenfunktion, damit Tests sie mit Fixtures aufrufen;
 * `runChecks()` (checks.ts) misst mit der echten Pixelschrift (`pixelFontMeasure`).
 *
 * Regel `funke` (`checkFunke`):
 * - jeder Funke-Kommentar (`guideHints`, Kanal `funke`) und jede Zeile eines Funke-Dialogs (`dialogs`, Sprecher `funke`) passt
 *   in DE und EN in höchstens `BALANCE.guide.funkeMaxLines` Zeilen der Funke-Box (`BALANCE.guide.funkeTextWidthPx`), mit
 *   Zeilenumbruch an Leerzeichen wie im DOM; ein einzelnes Wort breiter als die Box ist ebenfalls ein Fehler;
 * - es gibt mindestens `FUNKE_MIN_COMMENTS` Funke-Kommentare.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { BALANCE } from '../../src/content/balance';
import type { GuideHintDef } from '../../src/content/guide/schema';
import type { DialogDef } from '../../src/content/quests/schema';
import type { ContentRegistryView } from '../../src/content/registry';
import { PIXEL_FONT } from '../../src/render/text/pixelFont';
import { SATZZEICHEN } from '../../assets-src/schrift/satzzeichen';

/** Mindestzahl der Funke-Kommentare (docs/SPIEL.md §23 „≥ 40 Kommentare DE/EN“, M7-44). */
export const FUNKE_MIN_COMMENTS = 40;

/** Breite eines Texts in Designpixeln der Pixelschrift. */
export type TextMeasure = (text: string) => number;

/** Ergebnis der Regel. */
export interface FunkeCheckResult {
  readonly errors: string[];
  readonly warnings: string[];
  /** Zahl der Funke-Kommentare. */
  readonly comments: number;
}

function records<T>(registry: ContentRegistryView, name: string): readonly T[] {
  return (registry.collections().find((c) => c.name === name)?.values() ?? []) as unknown as readonly T[];
}

/**
 * Zeilen, die `text` bei `width` Designpixeln belegt (gieriger Umbruch an Leerzeichen wie im DOM); `Infinity`, wenn ein Wort
 * allein breiter ist als die Box.
 */
export function wrappedLines(text: string, width: number, measure: TextMeasure): number {
  const words = text.split(' ').filter((w) => w.length > 0);
  if (words.length === 0) return 0;
  const space = measure(' ');
  let lines = 1;
  let line = 0;
  for (const w of words) {
    const ww = measure(w);
    if (ww > width) return Number.POSITIVE_INFINITY;
    if (line === 0) line = ww;
    else if (line + space + ww <= width) line += space + ww;
    else {
      lines++;
      line = ww;
    }
  }
  return lines;
}

/** Die Funke-Regel über `registry`, gemessen mit `measure`. */
export function checkFunke(registry: ContentRegistryView, measure: TextMeasure): FunkeCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const width = BALANCE.guide.funkeTextWidthPx;
  const max = BALANCE.guide.funkeMaxLines;
  const fits = (where: string, text: { de: string; en: string }): void => {
    for (const lang of ['de', 'en'] as const) {
      const n = wrappedLines(text[lang], width, measure);
      if (n > max) errors.push(`${where}: ${lang.toUpperCase()} braucht ${Number.isFinite(n) ? n : 'unendlich viele'} Zeilen in der Funke-Box (${width} px), höchstens ${max}: „${text[lang]}“`);
    }
  };
  const hints = records<GuideHintDef>(registry, 'guideHints').filter((h) => h.kanal === 'funke');
  for (const h of hints) fits(`Funke-Kommentar ${h.id}`, h.text);
  for (const d of records<DialogDef>(registry, 'dialogs')) {
    if (d.sprecher !== 'funke') continue;
    d.zeilen.forEach((z, i) => fits(`Dialog ${d.id} Zeile ${i + 1}`, z));
  }
  if (hints.length < FUNKE_MIN_COMMENTS) errors.push(`Funke hat ${hints.length} Kommentare, mindestens ${FUNKE_MIN_COMMENTS} (docs/SPIEL.md §23, M7-44)`);
  return { errors, warnings, comments: hints.length };
}

// ---------------------------------------------------------------------------------------------
// Die echte Pixelschrift: Vorschübe aus der WOFF-Datei des Pakets (head, hhea, hmtx, cmap), die Satzzeichen-Ergänzung aus
// ihren Glyphen (assets-src/schrift/satzzeichen.ts) – dieselben Breiten, mit denen das DOM die Funke-Box setzt.
// ---------------------------------------------------------------------------------------------

const WOFF_SIGNATURE = 0x774f4646;
const WOFF_HEADER = 44;
const WOFF_ENTRY = 20;
const SFNT_HEADER = 12;
const SFNT_ENTRY = 16;

/** Vorschub je Zeichen [Designpixel] der Schriftdatei `bytes`. */
function advancesOf(bytes: Uint8Array): Map<number, number> {
  const b = Buffer.from(bytes);
  const tables = new Map<string, Buffer>();
  const woff = b.readUInt32BE(0) === WOFF_SIGNATURE;
  const numTables = b.readUInt16BE(woff ? 12 : 4);
  for (let i = 0; i < numTables; i++) {
    const o = woff ? WOFF_HEADER + i * WOFF_ENTRY : SFNT_HEADER + i * SFNT_ENTRY;
    const tag = b.toString('latin1', o, o + 4);
    if (woff) {
      const off = b.readUInt32BE(o + 4);
      const comp = b.readUInt32BE(o + 8);
      const orig = b.readUInt32BE(o + 12);
      const raw = b.subarray(off, off + comp);
      tables.set(tag, comp < orig ? inflateSync(raw) : raw);
    } else {
      const off = b.readUInt32BE(o + 8);
      tables.set(tag, b.subarray(off, off + b.readUInt32BE(o + 12)));
    }
  }
  const table = (tag: string): Buffer => {
    const t = tables.get(tag);
    if (t === undefined) throw new Error(`Pixelschrift: Tabelle ${tag} fehlt`);
    return t;
  };
  const unitsPerEm = table('head').readUInt16BE(18);
  const numHMetrics = table('hhea').readUInt16BE(34);
  const hmtx = table('hmtx');
  const advance = (glyph: number): number => hmtx.readUInt16BE(Math.min(glyph, numHMetrics - 1) * 4);
  const cmapTable = table('cmap');
  const out = new Map<number, number>();
  const px = (glyph: number): number => (advance(glyph) / unitsPerEm) * PIXEL_FONT.pixelsPerEm;
  for (let i = 0; i < cmapTable.readUInt16BE(2); i++) {
    const so = cmapTable.readUInt32BE(8 + i * 8);
    const format = cmapTable.readUInt16BE(so);
    if (format === 4) {
      const segX2 = cmapTable.readUInt16BE(so + 6);
      const endO = so + 14;
      const startO = endO + segX2 + 2;
      const deltaO = startO + segX2;
      const rangeO = deltaO + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = cmapTable.readUInt16BE(endO + s * 2);
        const start = cmapTable.readUInt16BE(startO + s * 2);
        const delta = cmapTable.readInt16BE(deltaO + s * 2);
        const range = cmapTable.readUInt16BE(rangeO + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let g = range === 0 ? (c + delta) & 0xffff : cmapTable.readUInt16BE(rangeO + s * 2 + range + (c - start) * 2);
          if (range !== 0 && g !== 0) g = (g + delta) & 0xffff;
          if (g !== 0) out.set(c, px(g));
        }
      }
    } else if (format === 12) {
      for (let k = 0; k < cmapTable.readUInt32BE(so + 12); k++) {
        const first = cmapTable.readUInt32BE(so + 16 + k * 12);
        const last = cmapTable.readUInt32BE(so + 20 + k * 12);
        const g = cmapTable.readUInt32BE(so + 24 + k * 12);
        for (let c = first; c <= last; c++) out.set(c, px(g + c - first));
      }
    }
  }
  return out;
}

/** Die Breitenfunktion der Pixelschrift des Spiels (Hauptschrift + Satzzeichen-Ergänzung, Ersatzzeichen für Fehlendes). */
export function pixelFontMeasure(root = process.cwd()): TextMeasure {
  const src = PIXEL_FONT.source;
  const file = join(root, 'node_modules', src.npm, src.files[0] as string);
  const adv = advancesOf(readFileSync(file));
  for (const [ch, g] of Object.entries(SATZZEICHEN.glyphen)) adv.set(ch.codePointAt(0) as number, g.vorschub);
  const fallback = adv.get((PIXEL_FONT.fallback.codePointAt(0) as number)) ?? PIXEL_FONT.pixelsPerEm;
  return (text) => {
    let w = 0;
    for (const ch of text) {
      const sub = PIXEL_FONT.substitutes?.[ch];
      w += adv.get(((sub ?? ch).codePointAt(0) as number)) ?? fallback;
    }
    return w;
  };
}
