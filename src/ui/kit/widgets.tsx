/**
 * Basic widgets of the UI kit (MASTERPROMPT §26): frames (wood, iron, parchment), buttons, slots
 * and bars. They are plain function components without hooks – state comes from props, pointer
 * states from CSS (`:hover`, `:active`, `:disabled`); `zustand` forces a state for galleries and
 * controller focus. Graphics and sizes come from `npm run assets` (`src/generated/ui.ts`,
 * `src/generated/ui-kit.css`).
 */
import type { ComponentChildren, JSX } from 'preact';
import { UI_GRAFIKEN } from '../../generated/ui';
import { barFillPx, uiPx } from './geometry';

/** Frame materials (§26 "Holz, Eisen, Pergament"). */
export const FRAME_ARTEN = ['holz', 'eisen', 'pergament'] as const;
export type FrameArt = (typeof FRAME_ARTEN)[number];

/** A pointer state forced from outside (gallery, controller focus). */
export type ForcedState = 'hover' | 'gedrueckt';

const FRAME_GRAFIK = { holz: UI_GRAFIKEN.rahmen_holz, eisen: UI_GRAFIKEN.rahmen_eisen, pergament: UI_GRAFIKEN.rahmen_pergament } as const;

/** Thickness of a frame's upper and lower rim [design px] (its 9-slice border). */
export function frameRim(art: FrameArt): number {
  const slice = FRAME_GRAFIK[art].slice;
  return Math.max(slice[0], slice[2]);
}

/**
 * Rows of a frame's upper and lower border that draw its rim [design px] – what a tooltip keeps clear of (`placeTooltip`,
 * M6-Gate). Wood and iron draw their whole 9-slice border (outline, wood or iron, inner line); the parchment draws an
 * outline and a brown edge, its third border row is already the parchment's fill (assets-src/ui/rahmen.ts
 * `RAHMEN_PERGAMENT`, checked against the rasters in tooltip-abstand.test.ts). Counting that row as rim kept a tooltip
 * three rows of parchment away instead of two.
 */
const FRAME_RIM_INK: Readonly<Record<FrameArt, number>> = { holz: 7, eisen: 7, pergament: 2 };

export function frameRimInk(art: FrameArt): number {
  return FRAME_RIM_INK[art];
}

/**
 * Side of the square in each outer corner of a frame that its graphic leaves transparent [design px] – the notch that rounds
 * the corner (assets-src/ui/rahmen.ts: wood and iron leave the corner pixel out, the parchment's torn corner up to two pixels;
 * checked against the rasters in tooltip-abstand.test.ts). Whatever lies under a frame shows through there: a tooltip covers
 * a glyph only where the glyph misses its notches (M6-Gate, third picture review: the "/" of "100/100" in the corner).
 */
const FRAME_NOTCH: Readonly<Record<FrameArt, number>> = { holz: 1, eisen: 1, pergament: 2 };

export function frameNotch(art: FrameArt): number {
  return FRAME_NOTCH[art];
}

/**
 * The outer `axis` size [design px] nearest to `size` (upwards with `up`, else downwards) at which the edge tiles of a frame
 * fall on whole design px. `border-image-repeat: repeat` centres the tiles in each edge (src/generated/ui-kit.css): a tile
 * starts (edge − tile) / 2 into the edge, so an edge (size minus both corner slices) whose length differs from the tile's
 * by an odd number puts every tile – the rivets of the iron frame – half a design pixel off the grid and the two cut tiles at
 * its ends unequal (M6-Gate, third picture review); at an odd UI scale the half pixel cannot even be drawn.
 */
export function frameTileSize(art: FrameArt, axis: 'width' | 'height', size: number, up: boolean): number {
  const g = FRAME_GRAFIK[art];
  const [top, right, bottom, left] = g.slice;
  const corners = axis === 'width' ? left + right : top + bottom;
  const tile = (axis === 'width' ? g.width : g.height) - corners;
  return (size - corners - tile) % 2 === 0 ? size : up ? size + 1 : size - 1;
}

function classes(...names: ReadonlyArray<string | false | undefined>): string {
  return names.filter((n): n is string => typeof n === 'string' && n !== '').join(' ');
}

export interface FrameProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class'> {
  readonly art: FrameArt;
  readonly class?: string;
  readonly children?: ComponentChildren;
}

/** 9-slice panel in wood, iron or parchment. */
export function Frame({ art, class: extra, children, ...rest }: FrameProps) {
  return (
    <div {...rest} class={classes('dh-rahmen', `dh-rahmen--${art}`, FRAME_GRAFIK[art].klasse, extra)}>
      {children}
    </div>
  );
}

export interface ButtonProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'class'> {
  readonly class?: string;
  readonly disabled?: boolean;
  readonly zustand?: ForcedState;
  readonly children?: ComponentChildren;
}

/** Wooden button with bevel and gloss edge; hover/focus, pressed and disabled have their own graphics. */
export function Button({ class: extra, disabled, zustand, children, ...rest }: ButtonProps) {
  return (
    <button type="button" {...rest} class={classes('dh-knopf', UI_GRAFIKEN.knopf.klasse, extra)} disabled={disabled} data-zustand={zustand}>
      {children}
    </button>
  );
}

export interface SlotProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'class'> {
  readonly class?: string;
  /** Selected slot (active quick-bar position). */
  readonly aktiv?: boolean;
  readonly zustand?: Extract<ForcedState, 'hover'>;
  /** Stack size shown bottom right (omitted for 0 or 1). */
  readonly anzahl?: number;
  /** Accessible name (item name or "empty slot"), already translated. */
  readonly label: string;
  readonly children?: ComponentChildren;
}

/** Inventory slot: a recessed well (bevelled rim with a gloss edge) for a 16 px icon. */
export function Slot({ class: extra, aktiv, zustand, anzahl, label, children, ...rest }: SlotProps) {
  return (
    <button type="button" {...rest} class={classes('dh-slot', UI_GRAFIKEN.slot.klasse, aktiv === true && 'dh-slot--aktiv', extra)} data-zustand={zustand} aria-label={label} aria-pressed={aktiv === true}>
      {children}
      {anzahl !== undefined && anzahl > 1 ? (
        <span class="dh-slot__anzahl" aria-hidden="true">
          {anzahl}
        </span>
      ) : null}
    </button>
  );
}

/** Bar fills (§26 HUD: Leben, Ausdauer, Sättigung, Durst). */
export const BAR_ARTEN = ['leben', 'ausdauer', 'saettigung', 'durst'] as const;
export type BarArt = (typeof BAR_ARTEN)[number];

const BAR_FILL = { leben: UI_GRAFIKEN.leiste_leben, ausdauer: UI_GRAFIKEN.leiste_ausdauer, saettigung: UI_GRAFIKEN.leiste_saettigung, durst: UI_GRAFIKEN.leiste_durst } as const;
/** Horizontal rim of the bar frame [design px] (left and right slice). */
const BAR_RIM = (UI_GRAFIKEN.leiste.slice[1] ?? 0) + (UI_GRAFIKEN.leiste.slice[3] ?? 0);

/** Filled width [design px] of a bar `width` px wide (frame included). */
export function barInnerWidth(width: number): number {
  return Math.max(0, Math.round(width) - BAR_RIM);
}

export interface BarProps {
  readonly art: BarArt;
  readonly value: number;
  readonly max: number;
  /** Total width [design px] including the frame. */
  readonly width: number;
  /** Accessible name and value text, already translated (e.g. "Leben: 87 von 100"). */
  readonly label: string;
  readonly class?: string;
}

/** Health/stamina style bar; the fill is rounded to whole pixels (`barFillPx`). */
export function Bar({ art, value, max, width, label, class: extra }: BarProps) {
  const fill = barFillPx(value, max, barInnerWidth(width));
  return (
    <div class={classes('dh-leiste', UI_GRAFIKEN.leiste.klasse, extra)} style={{ width: uiPx(Math.round(width)) }} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      {fill > 0 ? <span class={classes('dh-leiste__fuellung', BAR_FILL[art].klasse)} style={{ width: uiPx(fill) }} /> : null}
    </div>
  );
}
