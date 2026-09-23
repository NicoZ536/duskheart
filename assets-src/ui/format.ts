/**
 * Quellformat der UI-Grafik (MASTERPROMPT §5 "UI-Grafik: 9-Slice-Rahmen, Slots, Buttons, Leisten,
 * Scrollbars … ebenfalls als Pixel-Quellen", §26 "Holz, Eisen, Pergament").
 *
 * Wie bei Sprites (`assets-src/lib/sprite.ts`) ist eine Grafik ein Index-Raster mit Legende; die
 * Farben kommen aus der Master-Palette (`rampe.stufe`, Stufen 0-basiert) oder den acht UI-Farben
 * (`ui.<name>`, z. B. `ui.rahmen`). Anders als Sprites werden UI-Grafiken nicht palettenindiziert in
 * den Spielatlas gepackt, sondern als RGBA-PNG für das DOM-Overlay ausgegeben
 * (`tools/assets/ui-step.ts` → `public/generated/ui/<id>.png` + CSS `src/generated/ui-kit.css`).
 *
 * `slice` legt die 9-Slice-Ränder fest (oben, rechts, unten, links in Pixeln); Kanten und Mitte
 * werden in CSS gekachelt (`wiederholen`, für Maserung und Nieten – die Kachel muss nahtlos sein)
 * oder gedehnt (`dehnen`, nur für einfarbige Streifen, die sich dabei nicht verändern).
 */
import { rasterRows } from '../lib/sprite';
import { RAMPS, UI_COLORS } from '../palette';

/** 9-Slice-Ränder [oben, rechts, unten, links] in Pixeln. */
export type Slice = readonly [number, number, number, number];
export type KantenModus = 'wiederholen' | 'dehnen';

export interface UiGrafikQuelle {
  /** snake_case, zugleich Dateiname (`<id>.png`) und CSS-Klasse (`dh-g-<id>`). */
  readonly id: string;
  /** Wofür die Grafik da ist (Kontaktbogen, Fehlermeldungen). */
  readonly beschreibung: string;
  /** 9-Slice-Ränder: eine Zahl für alle Seiten oder [oben, rechts, unten, links]. Ohne: einfaches Bild. */
  readonly slice?: number | Slice;
  /** Kanten und Mitte kacheln oder dehnen (Standard: `wiederholen`). */
  readonly kanten?: KantenModus;
  /** Zeichen → `rampe.stufe`, `ui.<name>` oder `null` (transparent). */
  readonly legende: Readonly<Record<string, string | null>>;
  /** Index-Raster, eine Zeile je Pixelzeile; Einrückung und Leerzeilen fallen weg. */
  readonly raster: string;
  /** Größen [Breite, Höhe], in denen der Kontaktbogen die 9-Slice-Grafik zusammengesetzt zeigt. */
  readonly vorschau?: readonly (readonly [number, number])[];
}

export interface UiGrafik {
  readonly id: string;
  readonly beschreibung: string;
  readonly width: number;
  readonly height: number;
  readonly slice: Slice | null;
  readonly kanten: KantenModus;
  /** RGBA8, Zeile 0 zuerst. */
  readonly rgba: Uint8Array;
  /** Verschiedene deckende Farben. */
  readonly farben: number;
  readonly vorschau: readonly (readonly [number, number])[];
}

/** Strukturfehler einer UI-Grafik (unbekanntes Zeichen, Farbe, ungleiche Zeilen, Slice zu groß). */
export class UiGrafikFehler extends Error {
  constructor(id: string, detail: string) {
    super(`UI-Grafik ${id}: ${detail}`);
    this.name = 'UiGrafikFehler';
  }
}

/** Bytes je RGBA-Pixel und volle Deckung. */
const RGBA = 4;
const DECKEND = 255;
const HEX_BASIS = 16;
const KANAL_R = 16;
const KANAL_G = 8;
const BYTE = 0xff;
/** Präfix der UI-Farben in der Legende. */
const UI_PRAEFIX = 'ui.';
const ID_MUSTER = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** Löst `rampe.stufe` oder `ui.<name>` in `#rrggbb` auf; `null`, wenn es die Farbe nicht gibt. */
export function uiFarbe(ref: string): string | null {
  if (ref.startsWith(UI_PRAEFIX)) {
    const name = ref.slice(UI_PRAEFIX.length);
    return Object.hasOwn(UI_COLORS, name) ? UI_COLORS[name as keyof typeof UI_COLORS] : null;
  }
  const [rampe, stufe] = ref.split('.');
  const ramp = RAMPS.find((r) => r.name === rampe);
  const hex = ramp?.colors[Number(stufe)];
  return hex !== undefined && /^\d+$/.test(stufe ?? '') ? hex : null;
}

function sliceOf(q: UiGrafikQuelle): Slice | null {
  if (q.slice === undefined) return null;
  return typeof q.slice === 'number' ? [q.slice, q.slice, q.slice, q.slice] : q.slice;
}

/** Prüft eine Quelle und rastert sie zu RGBA. Wirft `UiGrafikFehler`. */
export function uiGrafik(q: UiGrafikQuelle): UiGrafik {
  const fail = (detail: string): never => {
    throw new UiGrafikFehler(q.id, detail);
  };
  if (!ID_MUSTER.test(q.id)) fail('id muss snake_case sein');
  const rows = rasterRows(q.raster);
  const width = rows[0]?.length ?? 0;
  const height = rows.length;
  if (width === 0) fail('leeres Raster');
  rows.forEach((row, y) => {
    if (row.length !== width) fail(`Zeile ${y} hat ${row.length} statt ${width} Zeichen`);
  });
  const farben = new Map<string, readonly [number, number, number] | null>();
  for (const [zeichen, ref] of Object.entries(q.legende)) {
    if (zeichen.length !== 1) fail(`Legendenschlüssel „${zeichen}“ ist kein einzelnes Zeichen`);
    if (ref === null) {
      farben.set(zeichen, null);
      continue;
    }
    const hex = uiFarbe(ref);
    if (hex === null) return fail(`Farbe „${ref}“ gibt es weder in der Palette noch unter den UI-Farben`);
    const v = Number.parseInt(hex.slice(1), HEX_BASIS);
    farben.set(zeichen, [(v >> KANAL_R) & BYTE, (v >> KANAL_G) & BYTE, v & BYTE]);
  }
  const rgba = new Uint8Array(width * height * RGBA);
  const benutzt = new Set<string>();
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const zeichen = row[x] ?? '';
      if (!farben.has(zeichen)) fail(`Zeichen „${zeichen}“ (Zeile ${y}, Spalte ${x}) fehlt in der Legende`);
      const c = farben.get(zeichen);
      if (c === null || c === undefined) continue;
      const i = (y * width + x) * RGBA;
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
      rgba[i + 3] = DECKEND;
      benutzt.add(zeichen);
    }
  });
  const slice = sliceOf(q);
  if (slice !== null) {
    const [oben, rechts, unten, links] = slice;
    if (slice.some((s) => !Number.isInteger(s) || s < 0)) fail('Slice-Ränder müssen ganze Zahlen ≥ 0 sein');
    if (oben + unten >= height || links + rechts >= width) fail(`Slice [${slice.join(', ')}] lässt keine Mitte in ${width}×${height}`);
  }
  const farbwerte = new Set([...benutzt].map((z) => String(farben.get(z))));
  for (const [w, h] of q.vorschau ?? []) {
    if (slice === null) fail('Vorschaugrößen gibt es nur für 9-Slice-Grafiken');
    else if (w <= slice[1] + slice[3] || h <= slice[0] + slice[2]) fail(`Vorschau ${w}×${h} ist kleiner als die Slice-Ränder`);
  }
  return { id: q.id, beschreibung: q.beschreibung, width, height, slice, kanten: q.kanten ?? 'wiederholen', rgba, farben: farbwerte.size, vorschau: q.vorschau ?? [] };
}
