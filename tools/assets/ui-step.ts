/**
 * UI-Schritt von `npm run assets` (M1-21, MASTERPROMPT §5 "UI-Grafik … als Pixel-Quellen; CSS mit
 * `image-rendering: pixelated` und ganzzahliger UI-Skalierung"):
 *
 * - `assets-src/ui/**` → `public/generated/ui/<id>.png` (RGBA, 1 Pixel je Designpixel),
 * - `src/generated/ui-kit.css`: je Grafik eine Klasse `dh-g-<id>` (9-Slice per `border-image`, sonst
 *   Hintergrundbild), Maße als Custom Properties (`--dh-g-<id>-w/-h`) und die Schrift-Tokens
 *   `--dh-font-px` / `--dh-line-px` aus dem Schrift-Deskriptor – alles in Pixeln bei 1×, die
 *   Stylesheets multiplizieren mit `--dh-ui-scale`,
 * - `src/generated/ui.ts`: Maß-Manifest (Größe, Slice, Datei) für die Komponenten,
 * - `tools/out/sheets/ui-kit.png`: Kontaktbogen (jede Grafik 4× auf dunklem und hellem Grund plus
 *   zusammengesetzte 9-Slice-Vorschauen in mehreren Größen, um Nähte der Kacheln zu prüfen).
 *
 * Deterministisch und schnell (ein paar Millisekunden); Dateien werden nur bei Änderung geschrieben,
 * veraltete PNGs früherer Läufe entfernt.
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { UI_KIT_FARBEN } from '../../assets-src/ui/farben';
import { uiFarbe, uiGrafik, type UiGrafik } from '../../assets-src/ui/format';
import { UI_GRAFIK_QUELLEN } from '../../assets-src/ui/index';
import { UI_COLORS } from '../../assets-src/palette';
import { lineHeightOf, PIXEL_FONT } from '../../src/render/text/pixelFont';
import { writeIfChanged } from '../lib/files';
import { drawText, GLYPH_H, textWidth } from '../lib/font';
import { hexRgba, RGBA_BYTES, RgbaImage, type Rgba } from '../lib/image';
import { encodePng } from '../lib/png';

export interface UiStepPaths {
  /** `src/generated` (CSS + Manifest). */
  readonly generated: string;
  /** `public/generated` (PNGs landen in `ui/`). */
  readonly publicGenerated: string;
  /** `tools/out/sheets`. */
  readonly sheets: string;
}

export interface UiStepResult {
  readonly grafiken: number;
  readonly geschrieben: number;
  readonly outputs: readonly string[];
}

/** Unterordner der PNGs in `public/generated` und URL-Pfad im Build (Vite-`public`, Basis `./`). */
export const UI_DIR = 'ui';
export const UI_URL_PREFIX = '/generated/ui/';
export const OUTPUT = { css: 'ui-kit.css', manifest: 'ui.ts', sheet: 'ui-kit.png' } as const;
/** CSS-Klassenpräfix einer Grafik und Custom Property der UI-Skalierung (src/ui/theme.ts). */
export const GRAFIK_CLASS_PREFIX = 'dh-g-';
const SCALE_VAR = 'var(--dh-ui-scale)';

/** Kontaktbogen: Vergrößerung, Abstände, Farben. */
const SHEET_SCALE = 4;
const SHEET_PAD = 8;
const SHEET_GAP = 12;
/** Breite, ab der der Bogen eine neue Zeile beginnt. */
const SHEET_MAX_WIDTH = 1400;
const LABEL_SCALE = 2;
const SHEET_BG: Rgba = hexRgba(UI_COLORS.dunkel);
const SHEET_LIGHT: Rgba = hexRgba(UI_COLORS.pergament);
const SHEET_TEXT: Rgba = hexRgba(UI_COLORS.text);

/** `calc(<n>px * var(--dh-ui-scale))`. */
export function scaledPx(n: number): string {
  return n === 0 ? '0' : `calc(${n}px * ${SCALE_VAR})`;
}

/** CSS-Regeln einer Grafik. */
export function grafikCss(g: UiGrafik): string {
  const url = `url("${UI_URL_PREFIX}${g.id}.png")`;
  const lines = [`.${GRAFIK_CLASS_PREFIX}${g.id} {`];
  if (g.slice !== null) {
    const [oben, rechts, unten, links] = g.slice;
    lines.push(
      '  border-style: solid;',
      `  border-width: ${[oben, rechts, unten, links].map(scaledPx).join(' ')};`,
      `  border-image-source: ${url};`,
      `  border-image-slice: ${oben} ${rechts} ${unten} ${links} fill;`,
      '  border-image-width: 1;',
      '  border-image-outset: 0;',
      `  border-image-repeat: ${g.kanten === 'dehnen' ? 'stretch' : 'repeat'};`,
    );
  } else {
    lines.push(`  background: ${url} no-repeat 0 0 / ${scaledPx(g.width)} ${scaledPx(g.height)};`);
  }
  lines.push('}');
  return lines.join('\n');
}

/** Das komplette generierte Stylesheet. */
export function uiKitCss(grafiken: readonly UiGrafik[]): string {
  const vars = [`  --dh-font-family: "${PIXEL_FONT.family}";`, `  --dh-font-px: ${PIXEL_FONT.pixelsPerEm}px;`, `  --dh-line-px: ${lineHeightOf(PIXEL_FONT)}px;`];
  for (const [name, ref] of Object.entries(UI_KIT_FARBEN)) {
    const hex = uiFarbe(ref);
    if (hex === null) throw new Error(`UI-Kit-Farbe ${name}: ${ref} gibt es nicht`);
    vars.push(`  --dh-kit-${name}: ${hex};`);
  }
  for (const g of grafiken) {
    vars.push(`  --dh-g-${g.id}-w: ${g.width}px;`, `  --dh-g-${g.id}-h: ${g.height}px;`, `  --dh-g-${g.id}-bild: url("${UI_URL_PREFIX}${g.id}.png");`);
  }
  return [
    '/* Generiert von tools/assets/ui-step.ts (npm run assets) aus assets-src/ui/** und src/render/text/pixelFont.ts – nicht von Hand ändern. */',
    `:root {\n${vars.join('\n')}\n}`,
    ...grafiken.map(grafikCss),
    '',
  ].join('\n');
}

/** Das generierte Maß-Manifest (TypeScript). */
export function uiManifest(grafiken: readonly UiGrafik[]): string {
  const eintraege = grafiken.map((g) => {
    const slice = g.slice === null ? 'null' : `[${g.slice.join(', ')}]`;
    return `  ${g.id}: { width: ${g.width}, height: ${g.height}, slice: ${slice}, kanten: '${g.kanten}', klasse: '${GRAFIK_CLASS_PREFIX}${g.id}', datei: 'generated/${UI_DIR}/${g.id}.png' },`;
  });
  return [
    '/* Generiert von tools/assets/ui-step.ts (npm run assets) aus assets-src/ui/** – nicht von Hand ändern. */',
    'export const UI_GRAFIKEN = {',
    ...eintraege,
    '} as const;',
    'export type UiGrafikId = keyof typeof UI_GRAFIKEN;',
    '',
  ].join('\n');
}

function pixel(g: UiGrafik, x: number, y: number): Rgba | null {
  const i = (y * g.width + x) * RGBA_BYTES;
  const a = g.rgba[i + 3] ?? 0;
  return a === 0 ? null : [g.rgba[i] ?? 0, g.rgba[i + 1] ?? 0, g.rgba[i + 2] ?? 0, a];
}

/** Quellkoordinate eines 9-Slice-Abschnitts (wie CSS: `stretch` dehnt, `repeat` kachelt mittig zentriert). */
function quelle(pos: number, ziel: number, groesse: number, vorn: number, hinten: number, dehnen: boolean): number {
  if (pos < vorn) return pos;
  if (pos >= ziel - hinten) return groesse - (ziel - pos);
  const zielMitte = ziel - vorn - hinten;
  const quellMitte = groesse - vorn - hinten;
  const rel = pos - vorn;
  if (dehnen) return vorn + Math.floor((rel * quellMitte) / zielMitte);
  const versatz = Math.floor((zielMitte - quellMitte) / 2);
  return vorn + ((((rel - versatz) % quellMitte) + quellMitte) % quellMitte);
}

/** Setzt eine 9-Slice-Grafik auf `w` × `h` Designpixel zusammen (Vorschau im Kontaktbogen, Tests). */
export function compose9Slice(g: UiGrafik, w: number, h: number): Uint8Array {
  if (g.slice === null) throw new Error(`UI-Grafik ${g.id} hat keine 9-Slice-Ränder`);
  const [oben, rechts, unten, links] = g.slice;
  const dehnen = g.kanten === 'dehnen';
  const out = new Uint8Array(w * h * RGBA_BYTES);
  for (let y = 0; y < h; y++) {
    const sy = quelle(y, h, g.height, oben, unten, dehnen);
    for (let x = 0; x < w; x++) {
      const sx = quelle(x, w, g.width, links, rechts, dehnen);
      const s = (sy * g.width + sx) * RGBA_BYTES;
      out.set(g.rgba.subarray(s, s + RGBA_BYTES), (y * w + x) * RGBA_BYTES);
    }
  }
  return out;
}

function drawRgba(img: RgbaImage, dx: number, dy: number, w: number, h: number, rgba: Uint8Array): void {
  img.drawScaled(dx, dy, w, h, SHEET_SCALE, (x, y) => {
    const i = (y * w + x) * RGBA_BYTES;
    const a = rgba[i + 3] ?? 0;
    return a === 0 ? null : [rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0, a];
  });
}

interface Kachel {
  readonly label: string;
  readonly w: number;
  readonly h: number;
  draw(img: RgbaImage, x: number, y: number): void;
}

/** Kontaktbogen: jede Grafik auf dunklem und hellem Grund, 9-Slice-Grafiken zusätzlich zusammengesetzt. */
export function uiSheet(grafiken: readonly UiGrafik[]): Uint8Array {
  const kacheln: Kachel[] = [];
  for (const g of grafiken) {
    const w = g.width * SHEET_SCALE;
    const h = g.height * SHEET_SCALE;
    kacheln.push({
      label: g.id,
      w: 2 * w + SHEET_PAD,
      h,
      draw(img, x, y) {
        img.fillRect(x + w + SHEET_PAD, y, w, h, SHEET_LIGHT);
        img.drawScaled(x, y, g.width, g.height, SHEET_SCALE, (px, py) => pixel(g, px, py));
        img.drawScaled(x + w + SHEET_PAD, y, g.width, g.height, SHEET_SCALE, (px, py) => pixel(g, px, py));
      },
    });
    if (g.slice === null) continue;
    for (const [tw, th] of g.vorschau) {
      kacheln.push({
        label: `${g.id} ${tw}x${th}`,
        w: tw * SHEET_SCALE,
        h: th * SHEET_SCALE,
        draw(img, x, y) {
          drawRgba(img, x, y, tw, th, compose9Slice(g, tw, th));
        },
      });
    }
  }
  // Zeilenweise anordnen: Kacheln nebeneinander, bis die Bogenbreite erreicht ist.
  const labelH = GLYPH_H * LABEL_SCALE + SHEET_PAD / 2;
  const breite = Math.max(SHEET_MAX_WIDTH, ...kacheln.map((k) => k.w + 2 * SHEET_PAD));
  const plaetze: Array<{ k: Kachel; x: number; y: number }> = [];
  let x = SHEET_PAD;
  let y = SHEET_PAD;
  let zeilenHoehe = 0;
  for (const k of kacheln) {
    const w = Math.max(k.w, textWidth(k.label, LABEL_SCALE));
    if (x > SHEET_PAD && x + w + SHEET_PAD > breite) {
      x = SHEET_PAD;
      y += zeilenHoehe + SHEET_GAP;
      zeilenHoehe = 0;
    }
    plaetze.push({ k, x, y });
    x += w + SHEET_GAP;
    zeilenHoehe = Math.max(zeilenHoehe, labelH + k.h);
  }
  const hoehe = y + zeilenHoehe + SHEET_PAD;
  const img = new RgbaImage(breite, hoehe);
  img.fillRect(0, 0, breite, hoehe, SHEET_BG);
  for (const p of plaetze) {
    drawText(img, p.x, p.y, p.k.label, SHEET_TEXT, LABEL_SCALE);
    p.k.draw(img, p.x, p.y + labelH);
  }
  return img.toPng();
}

/** Prüft und rastert alle Quellen; Fehler aller Quellen werden gesammelt gemeldet. */
export function loadUiGrafiken(): UiGrafik[] {
  const fehler: string[] = [];
  const grafiken: UiGrafik[] = [];
  const ids = new Set<string>();
  for (const q of UI_GRAFIK_QUELLEN) {
    try {
      const g = uiGrafik(q);
      if (ids.has(g.id)) fehler.push(`UI-Grafik ${g.id}: id doppelt`);
      ids.add(g.id);
      grafiken.push(g);
    } catch (err) {
      fehler.push((err as Error).message);
    }
  }
  if (fehler.length > 0) throw new Error(`UI-Grafiken fehlerhaft:\n  ${fehler.join('\n  ')}`);
  return grafiken;
}

/** Führt den UI-Schritt aus. */
export function buildUi(paths: UiStepPaths): UiStepResult {
  const grafiken = loadUiGrafiken();
  const pngDir = join(paths.publicGenerated, UI_DIR);
  const outputs: string[] = [];
  let geschrieben = 0;
  const write = (file: string, data: string | Uint8Array): void => {
    if (writeIfChanged(file, data)) geschrieben++;
    outputs.push(file);
  };
  for (const g of grafiken) write(join(pngDir, `${g.id}.png`), encodePng(g.width, g.height, g.rgba));
  write(join(paths.generated, OUTPUT.css), uiKitCss(grafiken));
  write(join(paths.generated, OUTPUT.manifest), uiManifest(grafiken));
  write(join(paths.sheets, OUTPUT.sheet), uiSheet(grafiken));
  // PNGs umbenannter oder entfernter Grafiken.
  if (existsSync(pngDir)) {
    for (const name of readdirSync(pngDir)) {
      const file = join(pngDir, name);
      if (!outputs.includes(file)) rmSync(file);
    }
  }
  return { grafiken: grafiken.length, geschrieben, outputs };
}

/** Schritt für `tools/assets/build.ts`: baut und liefert die Zusammenfassung für die Konsole. */
export function uiStep(paths: UiStepPaths): string {
  const r = buildUi(paths);
  return `${r.grafiken} Grafiken → public/generated/${UI_DIR}/, ${OUTPUT.css}, ${OUTPUT.manifest}, Kontaktbogen ${OUTPUT.sheet} (${r.geschrieben} Dateien geändert)`;
}
