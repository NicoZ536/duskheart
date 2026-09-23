/**
 * World-near UI (MASTERPROMPT §26 "Weltnahe UI im WebGL-Pass", §4.5 rarity colours, §4.6 interaction
 * markers; M1-23): names, life bars, damage numbers and interaction markers that belong to things in
 * the world. Producers fill the frame's `WorldUiList` (part of `RenderScene`) in world px, like
 * sprites; `WorldUiPass` draws it with the pixel font's glyph atlas into the final image after light,
 * composition and post – on whole internal pixels, so it stays crisp, keeps its colours in the
 * darkest night and moves with the world (the presentation shifts it by the subpixel camera offset
 * together with the scene).
 *
 * The list is filled per frame through pooled entries: a frame that shows as many elements as the
 * last one allocates nothing. Texts are passed as strings the caller keeps (i18n strings, a damage
 * number formatted once when the hit happened), never built per frame.
 */
import { PALETTE_HEX, PALETTE_RAMPS, RARITY_REFS, UI_HEX } from '../../generated/palette';
import { paletteRefHex } from '../palette/rows';
import { rgbaFromHex } from '../text/textBatch';

export type WorldUiKind = 'label' | 'bar' | 'damage' | 'marker';
/** Colour of a label: names of figures, enemies, and items in their rarity colour (§4.5). */
export type LabelTone = 'name' | 'feind' | keyof typeof RARITY_REFS;
export type BarKind = 'leben' | 'ausdauer';
export type DamageKind = 'treffer' | 'kritisch' | 'heilung';

/** Palette references of the world UI colours (one palette, one UI style: the kit's bars use the same ramps). */
const REF = {
  /** Empty part of a bar. */
  barEmpty: 'nacht.2',
  lebenLight: 'feuer.2',
  lebenBody: 'feuer.1',
  lebenEndLight: 'feuer.3',
  lebenEndBody: 'feuer.2',
  ausdauerLight: 'gras.4',
  ausdauerBody: 'gras.3',
  ausdauerEndLight: 'gras.5',
  ausdauerEndBody: 'gras.4',
  /** Healing numbers. */
  heilung: 'gras.5',
  /** Ink of the key letter on the parchment key cap. */
  keyInk: 'erde.0',
} as const;

function paletteRgba(ref: string): number {
  return rgbaFromHex(paletteRefHex(ref, PALETTE_RAMPS, PALETTE_HEX));
}

/** Packed 0xRRGGBBAA colours of the world UI. */
export const WORLD_UI_COLORS = {
  /** 8-neighbour outline around every text and frame (readable on any ground, day and night). */
  outline: rgbaFromHex(UI_HEX.dunkel),
  text: rgbaFromHex(UI_HEX.text),
  barEmpty: paletteRgba(REF.barEmpty),
  keyFace: rgbaFromHex(UI_HEX.pergament),
  keyShade: rgbaFromHex(UI_HEX.pergamentDunkel),
  keyInk: paletteRgba(REF.keyInk),
} as const;

/** Ink colour of each label tone. */
export const LABEL_COLORS: Readonly<Record<LabelTone, number>> = {
  name: rgbaFromHex(UI_HEX.text),
  feind: rgbaFromHex(UI_HEX.warnung),
  gewoehnlich: paletteRgba(RARITY_REFS.gewoehnlich),
  ungewoehnlich: paletteRgba(RARITY_REFS.ungewoehnlich),
  selten: paletteRgba(RARITY_REFS.selten),
  episch: paletteRgba(RARITY_REFS.episch),
  legendaer: paletteRgba(RARITY_REFS.legendaer),
};

/** Fill colours of a bar: upper (lit) row, lower row, and both rows of the brighter end column. */
export interface BarColors {
  readonly light: number;
  readonly body: number;
  readonly endLight: number;
  readonly endBody: number;
}

export const BAR_COLORS: Readonly<Record<BarKind, BarColors>> = {
  leben: { light: paletteRgba(REF.lebenLight), body: paletteRgba(REF.lebenBody), endLight: paletteRgba(REF.lebenEndLight), endBody: paletteRgba(REF.lebenEndBody) },
  ausdauer: { light: paletteRgba(REF.ausdauerLight), body: paletteRgba(REF.ausdauerBody), endLight: paletteRgba(REF.ausdauerEndLight), endBody: paletteRgba(REF.ausdauerEndBody) },
};

/** Ink colour of damage numbers. */
export const DAMAGE_COLORS: Readonly<Record<DamageKind, number>> = {
  treffer: rgbaFromHex(UI_HEX.text),
  kritisch: rgbaFromHex(UI_HEX.akzent),
  heilung: paletteRgba(REF.heilung),
};

/** How long a damage number stays (s), how far it rises (px) and when it starts to fade (share of the life). */
export const DAMAGE_LIFETIME = 0.9;
export const DAMAGE_RISE_PX = 12;
export const DAMAGE_FADE_START = 0.6;
/** Opacity steps of the fade (pixel art fades in a few hard steps, not a smooth ramp). */
export const DAMAGE_FADE_STEPS = 3;

/**
 * Rise of a damage number `age` seconds after the hit (whole px, upwards): fast at first, then
 * settling (ease-out), clamped at the end of its life.
 */
export function damageRise(age: number): number {
  const t = Math.min(1, Math.max(0, age / DAMAGE_LIFETIME));
  const eased = 1 - (1 - t) * (1 - t);
  return Math.round(DAMAGE_RISE_PX * eased);
}

/** Opacity 0…1 of a damage number: full until `DAMAGE_FADE_START`, then fading in hard steps; 0 once gone. */
export function damageOpacity(age: number): number {
  const t = age / DAMAGE_LIFETIME;
  if (t < 0 || t >= 1) return 0;
  if (t < DAMAGE_FADE_START) return 1;
  const fade = (t - DAMAGE_FADE_START) / (1 - DAMAGE_FADE_START);
  return 1 - Math.ceil(fade * DAMAGE_FADE_STEPS) / (DAMAGE_FADE_STEPS + 1);
}

/** Filled width of a bar `width` px wide: rounded, at least one pixel while anything is left. */
export function barFill(width: number, value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  const share = Math.min(1, value / max);
  return Math.max(1, Math.round(width * share));
}

/** One element of the world UI (pooled; fields not used by a kind keep their last value). */
export class WorldUiEntry {
  kind: WorldUiKind = 'label';
  /** Anchor in world px: labels and markers sit above it (bottom edge), bars hang below it (top edge). */
  x = 0;
  y = 0;
  text = '';
  /** Key shown in the marker's key cap. */
  key = '';
  /** Packed ink colour (labels, damage numbers). */
  color = 0;
  bar: BarKind = 'leben';
  /** Inner width of a bar (px). */
  width = 0;
  value = 0;
  max = 1;
  /** Seconds since the hit (damage numbers). */
  age = 0;
}

/** The world UI of one frame. */
export class WorldUiList {
  private readonly pool: WorldUiEntry[] = [];
  private n = 0;

  get count(): number {
    return this.n;
  }

  /** Entry `i` of this frame (0 ≤ i < count). */
  entry(i: number): WorldUiEntry | undefined {
    return i < this.n ? this.pool[i] : undefined;
  }

  clear(): void {
    this.n = 0;
  }

  /** A text centred on `x`, its baseline on `y` (names, item labels). */
  label(x: number, y: number, text: string, tone: LabelTone = 'name'): void {
    const e = this.next('label', x, y);
    e.text = text;
    e.color = LABEL_COLORS[tone];
  }

  /** A bar centred on `x` whose top edge is `y`; `width` is the inner width in px. */
  bar(x: number, y: number, width: number, value: number, max: number, kind: BarKind = 'leben'): void {
    const e = this.next('bar', x, y);
    e.width = width;
    e.value = value;
    e.max = max;
    e.bar = kind;
  }

  /** A damage (or healing) number `age` seconds after the hit at (x, y); rises and fades by itself. */
  damage(x: number, y: number, text: string, age: number, kind: DamageKind = 'treffer'): void {
    if (damageOpacity(age) <= 0) return;
    const e = this.next('damage', x, y);
    e.text = text;
    e.age = age;
    e.color = DAMAGE_COLORS[kind];
  }

  /** An interaction marker – key cap with `key` and the action `text` – centred on `x`, bottom edge on `y`. */
  marker(x: number, y: number, key: string, text: string): void {
    const e = this.next('marker', x, y);
    e.key = key;
    e.text = text;
  }

  private next(kind: WorldUiKind, x: number, y: number): WorldUiEntry {
    let e = this.pool[this.n];
    if (e === undefined) {
      e = new WorldUiEntry();
      this.pool.push(e);
    }
    this.n++;
    e.kind = kind;
    e.x = x;
    e.y = y;
    return e;
  }
}
