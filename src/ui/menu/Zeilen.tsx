/**
 * Rows of the menus' forms (the settings screen, the new-world screen and the pause menu's world view; M7-51, M7-55,
 * M7-56): each row a navigable button with its name on the left and "< value >" on the right. Left/right (keys, D-pad,
 * the arrows with the mouse) step the value – the screen's focus scope maps the focused row (`zeileVon`) to its step –;
 * a click on the row steps forward.
 *
 * The list shows as many whole rows as the screen's room holds (`useScreenRoom`, like the pause menu's settings,
 * M6-Gate): everything of the screen but the list is measured once laid out, what remains holds the rows; with too
 * little room it scrolls (the focus frame takes it along) and the screen layer never cuts the panel off.
 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { designPixel, useScreenRoom } from '../focus/Layer';
import type { FocusElement } from '../focus/manager';
import { rowsHeight, wholeRows } from '../focus/platz';
import { ScrollArea } from '../kit';
import './menu.css';

/** One row as the list shows it. */
export interface MenuZeile {
  readonly id: string;
  /** Name, translated. */
  readonly name: string;
  /** Value, formatted and translated. */
  readonly wert: string;
  /** Test id of the row (its value: `<testId>-wert`). */
  readonly testId: string;
  /** Not changeable now (Unbarmherzig's locked difficulty): shown, not navigable. */
  readonly gesperrt?: boolean;
  /** Marked (a conflict of the key bindings, a value that differs from the preset). */
  readonly markiert?: boolean;
}

/** Height of a row and the gap between two rows [design px] (menu.css `.dh-menue__zeile`). */
export const ZEILE_PX = 13;
export const ZEILEN_ABSTAND = 1;

/** The row id of a focused element (`data-zeile`), or null. */
export function zeileVon(el: FocusElement | null): string | null {
  return el instanceof Element ? el.getAttribute('data-zeile') : null;
}

export interface ZeilenListeProps {
  readonly zeilen: readonly MenuZeile[];
  /** Steps row `id` by `dir`. */
  readonly schritt: (id: string, dir: 1 | -1) => void;
  /** The element around the screen's content (`.dh-ebene__inhalt` is searched from it). */
  readonly bildschirm: { readonly current: HTMLElement | null };
  /** Fewest rows shown (the layer draws smaller below that). */
  readonly mindestens: number;
  readonly labelHoch: string;
  readonly labelRunter: string;
  /** Accessible text of a row (`{name}: {wert}`). */
  readonly ariaLabel: (z: MenuZeile) => string;
  /** Test id of the list (`data-zeilen` holds the rows shown). */
  readonly testId: string;
}

export function ZeilenListe({ zeilen, schritt, bildschirm, mindestens, labelHoch, labelRunter, ariaLabel, testId }: ZeilenListeProps) {
  const room = useScreenRoom().value;
  const liste = useRef<HTMLDivElement>(null);
  const [rest, setRest] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = liste.current;
    const inhalt = bildschirm.current?.closest('.dh-ebene__inhalt');
    if (el === null || !(inhalt instanceof HTMLElement)) return;
    const step = designPixel(el);
    const next = Math.round((inhalt.offsetHeight - el.offsetHeight) / step);
    if (next !== rest) setRest(next);
  });
  const total = zeilen.length;
  const shown = rest === null ? total : wholeRows(room.height - rest, ZEILE_PX, ZEILEN_ABSTAND, total, mindestens);
  return (
    <div ref={liste} data-testid={testId} data-zeilen={shown}>
      <ScrollArea
        height={rowsHeight(shown, ZEILE_PX, ZEILEN_ABSTAND)}
        zeile={ZEILE_PX + ZEILEN_ABSTAND}
        labelHoch={labelHoch}
        labelRunter={labelRunter}
        class={shown < total ? undefined : 'dh-menue__zeilenbereich--ganz'}
      >
        <div class="dh-menue__zeilen" role="list">
          {zeilen.map((z) => (
            <button
              type="button"
              key={z.id}
              role="listitem"
              class={z.markiert === true ? 'dh-menue__zeile dh-menue__zeile--markiert' : 'dh-menue__zeile'}
              data-fokus={z.gesperrt === true ? undefined : ''}
              data-zeile={z.id}
              data-testid={z.testId}
              aria-disabled={z.gesperrt === true ? 'true' : undefined}
              aria-label={ariaLabel(z)}
              onClick={() => {
                if (z.gesperrt !== true) schritt(z.id, 1);
              }}
            >
              <span class="dh-menue__name">{z.name}</span>
              <span class="dh-menue__wahl">
                <span
                  class="dh-menue__pfeil"
                  aria-hidden="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (z.gesperrt !== true) schritt(z.id, -1);
                  }}
                >
                  {z.gesperrt === true ? ' ' : '<'}
                </span>
                <span class="dh-menue__wert" data-testid={`${z.testId}-wert`}>
                  {z.wert}
                </span>
                <span
                  class="dh-menue__pfeil"
                  aria-hidden="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (z.gesperrt !== true) schritt(z.id, 1);
                  }}
                >
                  {z.gesperrt === true ? ' ' : '>'}
                </span>
              </span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
