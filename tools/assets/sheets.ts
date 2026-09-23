/**
 * Kontaktbögen (M1-07, MASTERPROMPT §5 „Qualitätsschleife“): je Sprite-Gruppe ein PNG, 4× vergrößert.
 * - Übersicht: je Sprite Frame 0 als Albedo auf hellem und dunklem Grund, Normalen, Höhe, Emissiv.
 * - Animationsraster: je Clip (oder alle Frames) die Frames in Abspielreihenfolge auf dunklem und
 *   hellem Grund, darüber die Frame-Nummern.
 * Dazu `palette.png` (Rampen mit Indizes, UI-Farben, Raritätsfarben, alle Palettenzeilen) und
 * `normals.png` (Referenzform je Höhen-Hinweis und alle Sprites: Normalen, Höhe, Licht-Vorschau aus
 * zwei Richtungen).
 */
import { MATERIAL_TIERS, type PaletteRow } from '../../assets-src/paletteRows';
import { RAMPS, RARITY_COLORS, UI_COLORS, flatPalette, paletteIndex } from '../../assets-src/palette';
import { GLYPH_H, drawText, textWidth } from '../lib/font';
import { RGBA_BYTES, RgbaImage, hexRgba, type Rgba } from '../lib/image';
import type { HeightHint } from '../../assets-src/lib/sprite';
import type { FramePixels, ManifestSprite } from './atlas';
import { albedoFrameRgba, normalFrameRgba } from './normals';

/** Vergrößerung der Sprites auf den Bögen. */
export const SHEET_SCALE = 4;
/** Zielbreite eines Bogens (breitere Einzelsprites verbreitern ihn). */
const SHEET_MAX_WIDTH = 2048;
/** Außenrand, Abstand zwischen Feldern und zwischen Zellen. */
const MARGIN = 16;
const PANEL_GAP = 6;
const CELL_GAP = 20;
/** Schriftvergrößerung für Beschriftungen. */
const LABEL_SCALE = 2;
const LABEL_H = GLYPH_H * LABEL_SCALE + 6;
/** Innenabstand eines Feldes um das Sprite. */
const PANEL_PAD = 4;
/** zlib-Stufe für Bögen (groß, nur zum Ansehen). */
const SHEET_DEFLATE_LEVEL = 6;
/** Untere Graustufe der Höhendarstellung (Höhe 0 bleibt vom Hintergrund unterscheidbar). */
const HEIGHT_VIEW_FLOOR = 56;
const CHANNEL_MAX = 255;

const COLORS = {
  sheet: hexRgba('#1a1426'),
  text: hexRgba(UI_COLORS.text),
  muted: hexRgba('#7e8393'),
  light: hexRgba(UI_COLORS.pergament),
  dark: hexRgba(UI_COLORS.dunkel),
  normalBg: hexRgba('#2b2d3a'),
  heightBg: hexRgba('#10203f'),
  emissiveBg: hexRgba('#0d0a14'),
  emissiveOff: hexRgba('#2a2238'),
} as const;

const PALETTE_RGBA: readonly Rgba[] = flatPalette().map(hexRgba);

function paletteColor(index: number): Rgba {
  return PALETTE_RGBA[index - 1] ?? COLORS.dark;
}

type View = 'hell' | 'dunkel' | 'normalen' | 'hoehe' | 'emissiv' | 'lichtLinks' | 'lichtRechts';
const VIEWS: readonly View[] = ['hell', 'dunkel', 'normalen', 'hoehe', 'emissiv'];
const NORMAL_VIEWS: readonly View[] = ['dunkel', 'normalen', 'hoehe', 'lichtLinks', 'lichtRechts'];
const VIEW_BG: Readonly<Record<View, Rgba>> = {
  hell: COLORS.light,
  dunkel: COLORS.dark,
  normalen: COLORS.normalBg,
  hoehe: COLORS.heightBg,
  emissiv: COLORS.emissiveBg,
  lichtLinks: COLORS.dark,
  lichtRechts: COLORS.dark,
};

/** Vorschau-Lichtrichtungen (Bildraum: +x rechts, +y unten, +z zum Betrachter), normiert. */
const LIGHT_LEFT = normalize([-1, -1, 0.9]);
const LIGHT_RIGHT = normalize([1, 0.35, 0.7]);
/** Umgebungsanteil der Licht-Vorschau. */
const PREVIEW_AMBIENT = 0.3;

function normalize(v: readonly [number, number, number]): readonly [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Albedo × (Umgebung + Lambert) – zeigt, ob die Normalen wie Relief wirken. */
function litColor(base: Rgba, nx: number, ny: number, light: readonly [number, number, number]): Rgba {
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  const k = Math.min(1, PREVIEW_AMBIENT + (1 - PREVIEW_AMBIENT) * Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]));
  return [Math.round(base[0] * k), Math.round(base[1] * k), Math.round(base[2] * k), CHANNEL_MAX];
}

/** Pixelfunktion eines Frames in einer Ansicht (null = Hintergrund). */
function viewPixel(view: View, px: FramePixels, w: number, maxHeight: number): (x: number, y: number) => Rgba | null {
  return (x, y) => {
    const i = (y * w + x) * RGBA_BYTES;
    if ((px.albedo[i + 3] ?? 0) === 0) return null;
    const index = px.albedo[i] ?? 0;
    switch (view) {
      case 'hell':
      case 'dunkel':
        return paletteColor(index);
      case 'normalen': {
        const r = px.normal[i] ?? 0;
        const g = px.normal[i + 1] ?? 0;
        const nx = (r / CHANNEL_MAX) * 2 - 1;
        const ny = (g / CHANNEL_MAX) * 2 - 1;
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        return [r, g, Math.round((0.5 + 0.5 * nz) * CHANNEL_MAX), CHANNEL_MAX];
      }
      case 'hoehe': {
        const hgt = px.normal[i + 2] ?? 0;
        const v = maxHeight > 0 ? Math.round(HEIGHT_VIEW_FLOOR + ((CHANNEL_MAX - HEIGHT_VIEW_FLOOR) * hgt) / maxHeight) : HEIGHT_VIEW_FLOOR;
        return [v, v, v, CHANNEL_MAX];
      }
      case 'emissiv':
        return (px.albedo[i + 1] ?? 0) > 0 ? paletteColor(index) : COLORS.emissiveOff;
      case 'lichtLinks':
      case 'lichtRechts': {
        // Emissive Pixel leuchten selbst und bleiben unbeleuchtet voll hell.
        if ((px.albedo[i + 1] ?? 0) > 0) return paletteColor(index);
        const nx = ((px.normal[i] ?? 0) / CHANNEL_MAX) * 2 - 1;
        // Atlas: +y oben; die Vorschau-Lichter rechnen im Raster (+y unten).
        const ny = -(((px.normal[i + 1] ?? 0) / CHANNEL_MAX) * 2 - 1);
        return litColor(paletteColor(index), nx, ny, view === 'lichtLinks' ? LIGHT_LEFT : LIGHT_RIGHT);
      }
    }
  };
}

function maxHeightOf(frames: readonly FramePixels[]): number {
  let m = 0;
  for (const f of frames) for (let i = 2; i < f.normal.length; i += RGBA_BYTES) m = Math.max(m, f.normal[i] ?? 0);
  return m;
}

interface Box {
  readonly w: number;
  readonly h: number;
  draw(img: RgbaImage, x: number, y: number): void;
}

function panelSize(s: ManifestSprite): { w: number; h: number } {
  return { w: s.size[0] * SHEET_SCALE + 2 * PANEL_PAD, h: s.size[1] * SHEET_SCALE + 2 * PANEL_PAD };
}

function drawFrame(img: RgbaImage, x: number, y: number, s: ManifestSprite, px: FramePixels, view: View, maxHeight: number): void {
  const { w, h } = panelSize(s);
  img.fillRect(x, y, w, h, VIEW_BG[view]);
  img.drawScaled(x + PANEL_PAD, y + PANEL_PAD, s.size[0], s.size[1], SHEET_SCALE, viewPixel(view, px, s.size[0], maxHeight));
}

/** Übersichtszelle: Frame 0 in den Ansichten `views` nebeneinander, Beschriftung darunter. */
function overviewCell(s: ManifestSprite, frames: readonly FramePixels[], views: readonly View[] = VIEWS): Box {
  const panel = panelSize(s);
  const label = `${s.id}`;
  const info = `${s.size[0]}x${s.size[1]} ${s.hoehe} ${s.frames.length}F ${s.farben} FARBEN${s.emissiv ? ' EMISSIV' : ''}`;
  const w = Math.max(views.length * panel.w + (views.length - 1) * PANEL_GAP, textWidth(label, LABEL_SCALE), textWidth(info, 1));
  const h = panel.h + LABEL_H + GLYPH_H + 4;
  const first = frames[0];
  const maxHeight = maxHeightOf(frames);
  return {
    w,
    h,
    draw(img, x, y) {
      if (first === undefined) return;
      views.forEach((view, i) => drawFrame(img, x + i * (panel.w + PANEL_GAP), y, s, first, view, maxHeight));
      drawText(img, x, y + panel.h + 4, label, COLORS.text, LABEL_SCALE);
      drawText(img, x, y + panel.h + LABEL_H, info, COLORS.muted, 1);
    },
  };
}

/** Animationszeilen eines Sprites: je Clip Frames auf dunklem und hellem Grund. */
function animationBlock(s: ManifestSprite, frames: readonly FramePixels[]): Box | null {
  if (frames.length < 2) return null;
  const clips: Array<[string, readonly number[], string]> = Object.entries(s.clips).map(([name, c]) => [name, c.frames, `${c.fps} FPS${c.loop ? ' LOOP' : ''}`]);
  if (clips.length === 0) clips.push(['frames', frames.map((_, i) => i), 'OHNE CLIP']);
  const panel = panelSize(s);
  const rowH = LABEL_H + 2 * panel.h + PANEL_GAP;
  const w = Math.max(...clips.map(([, seq]) => seq.length * (panel.w + PANEL_GAP)), textWidth(`${s.id} - xxxxxxxx - 00 FPS LOOP`, LABEL_SCALE));
  const maxHeight = maxHeightOf(frames);
  return {
    w,
    h: clips.length * (rowH + PANEL_GAP),
    draw(img, x, y) {
      clips.forEach(([name, seq, info], ci) => {
        const top = y + ci * (rowH + PANEL_GAP);
        drawText(img, x, top, `${s.id} - ${name} - ${info}`, COLORS.text, LABEL_SCALE);
        seq.forEach((fi, k) => {
          const px = frames[fi];
          if (px === undefined) return;
          const fx = x + k * (panel.w + PANEL_GAP);
          drawFrame(img, fx, top + LABEL_H, s, px, 'dunkel', maxHeight);
          drawFrame(img, fx, top + LABEL_H + panel.h + PANEL_GAP, s, px, 'hell', maxHeight);
          drawText(img, fx + 2, top + LABEL_H + 2, String(fi), COLORS.muted, 1);
        });
      });
    },
  };
}

/** Ordnet Boxen zeilenweise bis `maxWidth` an; liefert Positionen und Gesamtgröße. */
function flow(boxes: readonly Box[], maxWidth: number): { placed: Array<{ box: Box; x: number; y: number }>; w: number; h: number } {
  const placed: Array<{ box: Box; x: number; y: number }> = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let w = 0;
  for (const box of boxes) {
    if (x > 0 && x + box.w > maxWidth) {
      x = 0;
      y += rowH + CELL_GAP;
      rowH = 0;
    }
    placed.push({ box, x, y });
    x += box.w + CELL_GAP;
    rowH = Math.max(rowH, box.h);
    w = Math.max(w, x - CELL_GAP);
  }
  return { placed, w, h: boxes.length === 0 ? 0 : y + rowH };
}

interface Section {
  readonly title: string;
  readonly boxes: readonly Box[];
}

/** Bogen aus Abschnitten (Überschrift + fließend angeordnete Boxen) als PNG. */
function renderSheet(header: string, sections: readonly Section[]): Uint8Array {
  const used = sections.filter((sec) => sec.boxes.length > 0);
  const inner = Math.max(SHEET_MAX_WIDTH - 2 * MARGIN, ...used.flatMap((sec) => sec.boxes.map((b) => b.w)));
  const flows = used.map((sec) => ({ sec, f: flow(sec.boxes, inner) }));
  const sectionH = LABEL_H + 8;
  const width = Math.max(textWidth(header, LABEL_SCALE), ...flows.map(({ sec, f }) => Math.max(f.w, textWidth(sec.title, LABEL_SCALE)))) + 2 * MARGIN;
  const height = MARGIN + sectionH + flows.reduce((sum, { f }) => sum + sectionH + f.h + CELL_GAP, 0) + MARGIN;
  const img = new RgbaImage(width, height);
  img.fillRect(0, 0, width, height, COLORS.sheet);
  let y = MARGIN;
  drawText(img, MARGIN, y, header, COLORS.text, LABEL_SCALE);
  y += sectionH;
  for (const { sec, f } of flows) {
    drawText(img, MARGIN, y, sec.title, COLORS.muted, LABEL_SCALE);
    y += sectionH;
    for (const p of f.placed) p.box.draw(img, MARGIN + p.x, y + p.y);
    y += f.h + CELL_GAP;
  }
  return img.toPng(SHEET_DEFLATE_LEVEL);
}

/** Kontaktbogen einer Gruppe als PNG. */
export function groupSheet(group: string, sprites: readonly ManifestSprite[], pixels: ReadonlyMap<string, readonly FramePixels[]>): Uint8Array {
  const framesOf = (s: ManifestSprite): readonly FramePixels[] => pixels.get(s.id) ?? [];
  return renderSheet(`GRUPPE ${group} - ${sprites.length} SPRITES - ${SHEET_SCALE}X`, [
    { title: 'UEBERSICHT: HELL - DUNKEL - NORMALEN - HOEHE - EMISSIV (FRAME 0)', boxes: sprites.map((s) => overviewCell(s, framesOf(s))) },
    { title: 'ANIMATIONEN', boxes: sprites.map((s) => animationBlock(s, framesOf(s))).filter((b): b is Box => b !== null) },
  ]);
}

/** Kantenlänge der Referenzformen auf `normals.png`. */
const REFERENCE_SIZE = 16;
/** Halbachsen der Referenz-Ellipse. */
const REFERENCE_RX = 6.5;
const REFERENCE_RY = 6;
/** Spitze der Höhen-Pyramide für den Hinweis `custom` (px). */
const REFERENCE_PEAK = 6;

/** Referenzform (Ellipse aus stein.3) je Höhen-Hinweis; `custom` mit einer Pyramide als Höhen-Raster. */
function referenceSprites(): Array<{ sprite: ManifestSprite; pixels: FramePixels }> {
  const size = REFERENCE_SIZE;
  const c = size / 2;
  const index = new Uint8Array(size * size);
  const pyramid = new Int8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - c) / REFERENCE_RX;
      const dy = (y + 0.5 - c) / REFERENCE_RY;
      if (dx * dx + dy * dy <= 1) index[y * size + x] = paletteIndex('stein.3');
      pyramid[y * size + x] = Math.max(0, REFERENCE_PEAK - Math.max(Math.abs(x + 0.5 - c), Math.abs(y + 0.5 - c)) + 1);
    }
  }
  const hints: readonly HeightHint[] = ['flach', 'zylinder', 'kugel', 'block', 'custom'];
  return hints.map((hint) => {
    const frame = { index, emissive: new Uint8Array(size * size), material: new Uint8Array(size * size), heightOverride: hint === 'custom' ? pyramid : null };
    const sprite: ManifestSprite = {
      id: `referenz_${hint}`,
      group: 'normals',
      size: [size, size],
      anchor: [c, size],
      hitbox: null,
      sockets: {},
      frames: [{ x: 0, y: 0, w: size, h: size }],
      clips: {},
      occluder: { kind: 'none' },
      schatten: { kind: 'none' },
      hoehe: hint,
      emissiv: false,
      material: 0,
      bounds: { x: 0, y: 0, w: size, h: size },
      spiegelbar: true,
      farben: 1,
    };
    return { sprite, pixels: { albedo: albedoFrameRgba(frame, size, size), normal: normalFrameRgba(frame, size, size, hint) } };
  });
}

/** `normals.png`: Referenzform je Höhen-Hinweis und alle Sprites – Normalen, Höhe, Licht von links/rechts. */
export function normalsSheet(sprites: readonly ManifestSprite[], pixels: ReadonlyMap<string, readonly FramePixels[]>): Uint8Array {
  const refs = referenceSprites();
  return renderSheet(`NORMALEN UND HOEHE - DUNKEL - NORMALEN - HOEHE - LICHT LINKS OBEN - LICHT RECHTS - ${SHEET_SCALE}X`, [
    { title: 'HOEHEN-HINWEISE (REFERENZ-ELLIPSE, CUSTOM = PYRAMIDE)', boxes: refs.map((r) => overviewCell(r.sprite, [r.pixels], NORMAL_VIEWS)) },
    { title: 'SPRITES (FRAME 0)', boxes: sprites.map((s) => overviewCell(s, pixels.get(s.id) ?? [], NORMAL_VIEWS)) },
  ]);
}

/** Kantenlänge der Rampenfelder und der Palettenzeilen-Felder auf `palette.png`. */
const SWATCH = 40;
const ROW_SWATCH = 12;
const RAMP_LABEL_W = 110;

/** `palette.png`: Rampen (mit Palettenindex), UI-Farben, Raritäten und alle Palettenzeilen. */
export function paletteSheet(rows: readonly PaletteRow[]): Uint8Array {
  const rampW = RAMP_LABEL_W + Math.max(...RAMPS.map((r) => r.colors.length)) * (SWATCH + PANEL_GAP);
  const uiW = RAMP_LABEL_W + Object.keys(UI_COLORS).length * (SWATCH + PANEL_GAP) * 2;
  const rowsW = RAMP_LABEL_W + flatPalette().length * ROW_SWATCH + RAMPS.length * PANEL_GAP;
  const width = MARGIN * 2 + Math.max(rampW, uiW, rowsW);
  const rampBlockH = RAMPS.length * (SWATCH + LABEL_H);
  const height = MARGIN * 2 + 3 * (LABEL_H + 8) + rampBlockH + 2 * (SWATCH + 2 * LABEL_H) + rows.length * (ROW_SWATCH + PANEL_GAP) + LABEL_H;
  const img = new RgbaImage(width, height);
  img.fillRect(0, 0, width, height, COLORS.sheet);
  let y = MARGIN;
  drawText(img, MARGIN, y, `MASTER-PALETTE - ${flatPalette().length} FARBEN IN ${RAMPS.length} RAMPEN + ${Object.keys(UI_COLORS).length} UI`, COLORS.text, LABEL_SCALE);
  y += LABEL_H + 8;
  let index = 1;
  for (const ramp of RAMPS) {
    drawText(img, MARGIN, y + SWATCH / 2 - GLYPH_H, ramp.name, COLORS.text, LABEL_SCALE);
    ramp.colors.forEach((hex, step) => {
      const x = MARGIN + RAMP_LABEL_W + step * (SWATCH + PANEL_GAP);
      img.fillRect(x, y, SWATCH, SWATCH, hexRgba(hex));
      drawText(img, x, y + SWATCH + 2, `${index}.${step}`, COLORS.muted, 1);
      index++;
    });
    y += SWATCH + LABEL_H;
  }
  y += 8;
  drawText(img, MARGIN, y, 'UI', COLORS.text, LABEL_SCALE);
  Object.entries(UI_COLORS).forEach(([name, hex], i) => {
    const x = MARGIN + RAMP_LABEL_W + i * 2 * (SWATCH + PANEL_GAP);
    img.fillRect(x, y, SWATCH * 2, SWATCH, hexRgba(hex));
    drawText(img, x, y + SWATCH + 2, name, COLORS.muted, 1);
  });
  y += SWATCH + 2 * LABEL_H;
  drawText(img, MARGIN, y, 'RARITAET', COLORS.text, LABEL_SCALE);
  Object.entries(RARITY_COLORS).forEach(([name, ref], i) => {
    const x = MARGIN + RAMP_LABEL_W + i * 2 * (SWATCH + PANEL_GAP);
    img.fillRect(x, y, SWATCH * 2, SWATCH, paletteColor(paletteIndex(ref)));
    drawText(img, x, y + SWATCH + 2, `${name} ${ref}`, COLORS.muted, 1);
  });
  y += SWATCH + 2 * LABEL_H;
  drawText(img, MARGIN, y, `PALETTENZEILEN (${rows.length}) - MATERIALSTUFEN ${MATERIAL_TIERS.length}`, COLORS.text, LABEL_SCALE);
  y += LABEL_H + 8;
  for (const row of rows) {
    drawText(img, MARGIN, y + 2, row.id, COLORS.text, 1);
    let x = MARGIN + RAMP_LABEL_W;
    let i = 0;
    for (const ramp of RAMPS) {
      for (let s = 0; s < ramp.colors.length; s++) {
        img.fillRect(x, y, ROW_SWATCH, ROW_SWATCH, paletteColor(row.map[i] ?? i + 1));
        x += ROW_SWATCH;
        i++;
      }
      x += PANEL_GAP;
    }
    y += ROW_SWATCH + PANEL_GAP;
  }
  return img.toPng();
}
