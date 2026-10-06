/**
 * The map screen's model (MASTERPROMPT §25 "Karte (M): Pergament-Pixel-Look, Nebel über Unerkundetem … Marker automatisch …
 * und eigene (Symbol + Name); Zoom; Ebenenwechsel für den Untergrund"; docs/SPIEL.md §18 "Karte", §30 "`karte` – M –
 * sampleMap"; M7-49). Pure – the screen (KarteScreen.tsx) feeds it the session's map view and markers.
 *
 * - **Picture** (`zeichneKarte`): palette indices of the master palette, one block of `zoom` design pixels per map cell
 *   (4 × 4 tiles). Revealed land is painted in the faded colour of its biome on parchment, the water in washed blues with a
 *   wave stroke on the open sea, roads as brown ink, lava in red; ink lines run along the coasts and the height steps (the
 *   contour of every level, darker as the land climbs). Unrevealed cells are bare parchment with a stipple of mist; the cells
 *   along the reveal's edge fray into it. Underground: the caves light on dark rock. Every pixel is a palette colour (§4.3).
 * - **View** (`Ausschnitt`): centre [cells], zoom (`KARTE_ZOOMS`), size [design px]; `zelleAm`/`punktDer` convert between
 *   view pixels and cells/tiles; `verschiebe` keeps the centre inside the world.
 * - **Markers** (`markerImBild`): the layer's markers inside the view with their position and label – own markers named by
 *   the player, places by their location type, the rest by their kind.
 */
import { CONTENT } from '../../../content/index';
import type { MapMarkerRecord, MapView } from '../../../game/samples/orte';
import { MAP_TERRAIN } from '../../../game/map/terrain';
import type { MapMarkerKind } from '../../../game/map/types';
import type { I18n } from '../../../i18n';
import { PLAN_BIOME_IDS } from '../../../world/gen/plan/biomes';
import { farbIndex, rampenStufe } from '../../hud/minimap/palette';

/**
 * Design pixels per map cell of the zoom steps: 1 – a medium world's quarter (288 × 208 cells); 4 – the land around the
 * player (288 × 208 tiles, about four screens of the world); 8 – two design pixels per tile.
 */
export const KARTE_ZOOMS = [1, 2, 4, 8] as const;
export type KarteZoom = (typeof KARTE_ZOOMS)[number];
/** Zoom when the screen opens: the land around the player, its reveal disc 40 design px across. */
export const KARTE_ZOOM_START: KarteZoom = 4;

/** The palette indices of the parchment map. */
export interface KartenFarben {
  readonly pergament: number;
  readonly pergamentDunkel: number;
  readonly nebelRand: number;
  readonly tinte: number;
  readonly hoehenlinie: number;
  readonly meer: number;
  readonly meerWelle: number;
  readonly kuestenmeer: number;
  readonly wasserTief: number;
  readonly wasserFlach: number;
  readonly strasse: number;
  readonly lava: number;
  readonly fels: number;
  readonly felsSchraffur: number;
  readonly hoehle: number;
  /** Land colour per plan biome (`PLAN_BIOME_IDS` order). */
  readonly biom: Uint8Array;
}

/** Faded land colours of the biomes on parchment (`rampe.stufe`). */
export const KARTE_BIOM_FARBE: Readonly<Record<string, string>> = {
  gruenhain: 'gras.5',
  salzkueste: 'sand.2',
  nebelmoor: 'stein.4',
  frostkamm: 'eis.3',
  glutsand: 'laub.4',
  aschenschlund: 'stein.3',
  scherbenhain: 'verderb.4',
  nachtherz: 'verderb.2',
};

let farben: KartenFarben | null = null;

/** The map's palette indices (built once). */
export function kartenFarben(): KartenFarben {
  if (farben !== null) return farben;
  const biom = new Uint8Array(PLAN_BIOME_IDS.length);
  PLAN_BIOME_IDS.forEach((id, i) => (biom[i] = farbIndex(KARTE_BIOM_FARBE[id] ?? 'sand.3')));
  farben = {
    pergament: farbIndex('sand.4'),
    pergamentDunkel: farbIndex('sand.3'),
    nebelRand: farbIndex('sand.2'),
    tinte: farbIndex('erde.1'),
    hoehenlinie: farbIndex('erde.2'),
    meer: farbIndex('eis.0'),
    meerWelle: farbIndex('eis.1'),
    kuestenmeer: farbIndex('eis.1'),
    wasserTief: farbIndex('eis.0'),
    wasserFlach: farbIndex('eis.2'),
    strasse: farbIndex('holz.1'),
    lava: farbIndex('feuer.2'),
    fels: farbIndex('stein.1'),
    felsSchraffur: farbIndex('stein.0'),
    hoehle: farbIndex('sand.3'),
    biom,
  };
  return farben;
}

/** What part of the map the screen shows. */
export interface Ausschnitt {
  /** Centre of the view [cells, fractional]. */
  mitteX: number;
  mitteY: number;
  zoom: KarteZoom;
  /** Size of the view [design px]. */
  readonly breite: number;
  readonly hoehe: number;
}

/** The cell under view pixel (px, py) (may lie outside the world). */
export function zelleAm(a: Readonly<Ausschnitt>, px: number, py: number): { cx: number; cy: number } {
  return { cx: Math.floor(a.mitteX + (px - a.breite / 2) / a.zoom), cy: Math.floor(a.mitteY + (py - a.hoehe / 2) / a.zoom) };
}

/** The view pixel of tile (tx, ty) (its centre) with `cellTiles` tiles per cell. */
export function punktDer(a: Readonly<Ausschnitt>, tx: number, ty: number, cellTiles: number): { x: number; y: number } {
  return { x: Math.round(a.breite / 2 + ((tx + 0.5) / cellTiles - a.mitteX) * a.zoom), y: Math.round(a.hoehe / 2 + ((ty + 0.5) / cellTiles - a.mitteY) * a.zoom) };
}

/** Moves the centre by (dx, dy) view pixels and keeps it inside the world of `side` cells. */
export function verschiebe(a: Ausschnitt, dx: number, dy: number, side: number): void {
  a.mitteX = Math.max(0, Math.min(side, a.mitteX + dx / a.zoom));
  a.mitteY = Math.max(0, Math.min(side, a.mitteY + dy / a.zoom));
}

/** The next zoom step in `richtung` (+1 nearer, −1 farther), held at the ends. */
export function naechsterZoom(zoom: KarteZoom, richtung: number): KarteZoom {
  const i = KARTE_ZOOMS.indexOf(zoom) + Math.sign(richtung);
  return KARTE_ZOOMS[Math.max(0, Math.min(KARTE_ZOOMS.length - 1, i))] as KarteZoom;
}

/** The map view the picture is drawn from (`MapView` of the session; tests build their own). */
export type KartenBild = Pick<MapView, 'side' | 'mask' | 'kind' | 'level' | 'layer'>;

/** Whether cell (cx, cy) is revealed (outside the raster: no). */
function offen(v: KartenBild, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= v.side || cy >= v.side) return false;
  const i = cy * v.side + cx;
  return ((v.mask[i >> 3] as number) & (1 << (i & 7))) !== 0;
}

/** Water kinds (coast lines run between them and land). */
function nass(kind: number): boolean {
  return kind === MAP_TERRAIN.sea || kind === MAP_TERRAIN.shallowSea || kind === MAP_TERRAIN.deepWater || kind === MAP_TERRAIN.shallowWater;
}

/** A stable 0…3 per cell (mist and wave strokes; no randomness, the same picture every time). */
function muster(cx: number, cy: number): number {
  let h = Math.imul(cx, 0x27d4eb2d) ^ Math.imul(cy, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  return (h >>> 13) & 3;
}

/** The base colour of revealed cell `i` (kind, biome, level). */
function grundfarbe(v: KartenBild, f: KartenFarben, i: number, cx: number, cy: number, ux: number, uy: number, zoom: number): number {
  const kind = v.kind[i] as number;
  switch (kind) {
    case MAP_TERRAIN.unknown:
      return f.pergamentDunkel;
    case MAP_TERRAIN.sea: {
      // Open sea: a short wave stroke in some cells (two pixels, at the cell's middle row).
      const welle = muster(cx, cy) === 0 && uy === Math.floor(zoom / 2) && ux < Math.max(1, zoom - 1);
      return welle ? f.meerWelle : f.meer;
    }
    case MAP_TERRAIN.shallowSea:
      return f.kuestenmeer;
    case MAP_TERRAIN.deepWater:
      return f.wasserTief;
    case MAP_TERRAIN.shallowWater:
      return f.wasserFlach;
    case MAP_TERRAIN.road:
      return f.strasse;
    case MAP_TERRAIN.lava:
      return f.lava;
    case MAP_TERRAIN.rock:
      return ((cx + cy + ux + uy) & 3) === 0 ? f.felsSchraffur : f.fels;
    case MAP_TERRAIN.cave:
      return f.hoehle;
    default: {
      const b = f.biom[kind - MAP_TERRAIN.land] ?? f.pergamentDunkel;
      // Higher land a step darker from level 2 on (the hills read as hills between the contour lines).
      const level = v.level[i] as number;
      return level >= 2 ? rampenStufe(b, -1) : b;
    }
  }
}

/**
 * Draws the map of `v` into `ziel` (palette indices, `a.breite × a.hoehe`, row-major): revealed cells in their colours with
 * coast and contour lines, the rest parchment with mist.
 */
export function zeichneKarte(v: KartenBild, f: KartenFarben, a: Readonly<Ausschnitt>, ziel: Uint8Array): void {
  const z = a.zoom;
  const x0 = a.mitteX - a.breite / 2 / z;
  const y0 = a.mitteY - a.hoehe / 2 / z;
  const unten = v.layer < 0;
  for (let py = 0; py < a.hoehe; py++) {
    const fy = y0 + py / z;
    const cy = Math.floor(fy);
    const uy = Math.floor((fy - cy) * z);
    const row = py * a.breite;
    for (let px = 0; px < a.breite; px++) {
      const fx = x0 + px / z;
      const cx = Math.floor(fx);
      const ux = Math.floor((fx - cx) * z);
      ziel[row + px] = pixel(v, f, cx, cy, ux, uy, z, unten);
    }
  }
}

function pixel(v: KartenBild, f: KartenFarben, cx: number, cy: number, ux: number, uy: number, z: number, unten: boolean): number {
  if (!offen(v, cx, cy)) {
    // Parchment; the mist stipples it sparsely (one dot in some cells), and next to the revealed land it frays (every other
    // pixel darker).
    const rand = offen(v, cx - 1, cy) || offen(v, cx + 1, cy) || offen(v, cx, cy - 1) || offen(v, cx, cy + 1);
    if (rand && ((ux + uy + cx + cy) & 1) === 0) return f.nebelRand;
    return muster(cx, cy) === 1 && ux === 0 && uy === 0 ? f.pergamentDunkel : f.pergament;
  }
  const i = cy * v.side + cx;
  const kind = v.kind[i] as number;
  // Ink along the edges of the cell where a neighbour differs: land against water (coast), open against rock (cave wall),
  // revealed against unknown (the edge of what was seen), and a step up in height (contour).
  const left = ux === 0;
  const top = uy === 0;
  if (left || top) {
    const nx = left ? cx - 1 : cx;
    const ny = left ? cy : cy - 1;
    if (offen(v, nx, ny)) {
      const j = ny * v.side + nx;
      const nk = v.kind[j] as number;
      if (unten ? (nk === MAP_TERRAIN.rock) !== (kind === MAP_TERRAIN.rock) : nass(nk) !== nass(kind)) return f.tinte;
      if (!unten && !nass(kind) && !nass(nk) && v.level[j] !== v.level[i]) return f.hoehenlinie;
    }
  }
  if (ux === z - 1 || uy === z - 1) {
    // The right and bottom edges against water/rock too (one ink pixel wide either side of a coast is a 2 px line at zoom
    // 1, so only where the neighbour is the wet one).
    const nx = ux === z - 1 ? cx + 1 : cx;
    const ny = ux === z - 1 ? cy : cy + 1;
    if (z > 1 && offen(v, nx, ny)) {
      const nk = v.kind[ny * v.side + nx] as number;
      if (unten ? nk === MAP_TERRAIN.rock && kind !== MAP_TERRAIN.rock : nass(nk) && !nass(kind)) return f.tinte;
    }
  }
  return grundfarbe(v, f, i, cx, cy, ux, uy, z);
}

/** A marker in the view. */
export interface MarkerImBild {
  readonly art: MapMarkerKind;
  readonly sprite: string;
  /** Own marker's id, or −1. */
  readonly id: number;
  /** Position [view design px] of the symbol's centre. */
  readonly x: number;
  readonly y: number;
  /** Label (own: its name; places: the location type; else the kind). */
  readonly name: string;
  /** Where the label stands: below the symbol, above it, or none (it would cover another label or symbol; the name stays the tooltip). */
  readonly beschriftung: Beschriftung;
  /** Shift of the label from the symbol's centre [design px]: a label at the view's edge moves inside (a symbol on the rim keeps its whole name). */
  readonly nameDx: number;
}

/** Place of a marker's label on the sheet (`markerImBild`). */
export type Beschriftung = 'unten' | 'oben' | null;

/** Half the size of a map symbol [design px] (16 × 16 sprites): markers this far outside the view still show their edge. */
const SYMBOL_HALB = 8;
/**
 * A label's box [design px]: the advance of a character of the UI font (`--dh-font-px` 10, the Latin glyphs about 5 px with
 * their spacing – measured on the sheet: "Natural Wonder" 72 px), its height, and its top relative to the symbol's centre
 * below (`.dh-karte__name` 15 px under the symbol's top; the glyphs begin a pixel under their line's top) and above
 * (`.dh-karte__name--oben`).
 */
const ZEICHEN_PX = 5.2;
const NAME_HOEHE = 10;
const NAME_UNTEN = 8;
const NAME_OBEN = -19;

/** The label of marker `m` in the language of `i18n`. */
export function markerName(i18n: I18n, m: Pick<MapMarkerRecord, 'kind' | 'ref'>): string {
  if (m.kind === 'eigen') return m.ref;
  if (m.kind === 'ort') return CONTENT.collection('locationTypes').find(m.ref)?.name[i18n.lang] ?? m.ref;
  return i18n.t(`ui.karte.marker.${m.kind}`);
}

/** The markers of `liste` (the first `anzahl`) inside the view `a`, with their positions and labels. */
export function markerImBild(i18n: I18n, liste: readonly MapMarkerRecord[], anzahl: number, a: Readonly<Ausschnitt>, cellTiles: number): MarkerImBild[] {
  const out: { -readonly [K in keyof MarkerImBild]: MarkerImBild[K] }[] = [];
  for (let k = 0; k < anzahl; k++) {
    const m = liste[k];
    if (m === undefined) continue;
    const p = punktDer(a, m.tx, m.ty, cellTiles);
    if (p.x < -SYMBOL_HALB || p.y < -SYMBOL_HALB || p.x > a.breite + SYMBOL_HALB || p.y > a.hoehe + SYMBOL_HALB) continue;
    out.push({ art: m.kind, sprite: m.sprite, id: m.id, x: p.x, y: p.y, name: markerName(i18n, m), beschriftung: null, nameDx: 0 });
  }
  // Labels without overlap, greedy: own markers first (the player named them), then the places; each below its symbol, else
  // above, else none. Every symbol blocks the labels of the others.
  const belegt: number[] = [];
  for (const m of out) belegt.push(m.x - SYMBOL_HALB, m.y - SYMBOL_HALB, m.x + SYMBOL_HALB, m.y + SYMBOL_HALB);
  for (const art of BESCHRIFTET) {
    for (const m of out) {
      if (m.art !== art) continue;
      const halb = (m.name.length * ZEICHEN_PX) / 2;
      // Inside the view: a label wider than the view stays centred on its symbol.
      const lx = 2 * halb >= a.breite ? m.x : Math.max(halb, Math.min(a.breite - halb, m.x));
      for (const [lage, oben] of LAGEN) {
        const y0 = m.y + oben;
        if (frei(belegt, lx - halb, y0, lx + halb, y0 + NAME_HOEHE)) {
          m.beschriftung = lage;
          m.nameDx = Math.round(lx - m.x);
          belegt.push(lx - halb, y0, lx + halb, y0 + NAME_HOEHE);
          break;
        }
      }
    }
  }
  return out;
}

/** The kinds whose markers carry a label on the sheet, in the order they claim their place. */
const BESCHRIFTET: readonly MapMarkerKind[] = ['eigen', 'ort'];
/** The places a label tries, with its top relative to the symbol's centre. */
const LAGEN: readonly (readonly [Exclude<Beschriftung, null>, number])[] = [
  ['unten', NAME_UNTEN],
  ['oben', NAME_OBEN],
];

/** Whether the box (x0, y0)–(x1, y1) overlaps none of the boxes in `belegt` (four numbers each; a label's box touches its own symbol's, never overlaps it). */
function frei(belegt: readonly number[], x0: number, y0: number, x1: number, y1: number): boolean {
  for (let b = 0; b < belegt.length; b += 4) {
    if (x0 < (belegt[b + 2] as number) && x1 > (belegt[b] as number) && y0 < (belegt[b + 3] as number) && y1 > (belegt[b + 1] as number)) return false;
  }
  return true;
}

/** Share of the world's cells revealed on the layer [0–1] (the screen's corner line "erkundet: n %"). */
export function erkundet(v: Pick<MapView, 'mask' | 'side'>): number {
  let n = 0;
  for (let i = 0; i < v.mask.length; i++) {
    let b = v.mask[i] as number;
    while (b !== 0) {
      b &= b - 1;
      n++;
    }
  }
  return v.side === 0 ? 0 : n / (v.side * v.side);
}
