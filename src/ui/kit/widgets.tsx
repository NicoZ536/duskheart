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

/** Wooden button; hover/focus, pressed and disabled have their own graphics. */
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

/** Inventory slot: 16 px content inside a recessed 2 px rim. */
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

/** Bar fills (§26 HUD). */
export const BAR_ARTEN = ['leben', 'ausdauer'] as const;
export type BarArt = (typeof BAR_ARTEN)[number];

const BAR_FILL = { leben: UI_GRAFIKEN.leiste_leben, ausdauer: UI_GRAFIKEN.leiste_ausdauer } as const;
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
