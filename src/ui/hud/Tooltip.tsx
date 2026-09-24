/**
 * Tooltip of the HUD (M3-27; §11.2 thermometer "Tooltip mit gefühlter Temperatur und Einflüssen", §11.3
 * conditions "Tooltip"): the item tooltip's iron frame and line styles (src/ui/tooltip), placed below a
 * display in the upper half of the screen and above one in the lower half, left edges aligned, kept inside
 * the viewport – always on whole design pixels. A display opens it with `useHudTooltip`: the model is read
 * while the tooltip renders, from the display's latest render, so the tooltip follows live values
 * (temperature, timers, counts) while it is open, and it closes when the pointer leaves or the display
 * goes away.
 */
import { signal, type Signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { Frame } from '../kit';
import { designPixel } from '../focus/Layer';
import type { HudTooltipModell } from './texte';

/** Gap between display and tooltip, least distance to the viewport edge [design px]. */
const ABSTAND = 3;
const RAND = 2;

/** What the tooltip shows: its anchor and the model (`null`: nothing to say right now). */
export interface HudTooltipZiel {
  readonly anker: Element;
  readonly modell: () => HudTooltipModell | null;
}

/** The HUD's tooltip slot (one open tooltip at a time). */
export type HudTooltipSlot = Signal<HudTooltipZiel | null>;

export function createTooltipSlot(): HudTooltipSlot {
  return signal<HudTooltipZiel | null>(null);
}

/** Pointer handlers of a display with a tooltip. */
export interface HudTooltipHandler {
  readonly onPointerEnter: (e: PointerEvent) => void;
  readonly onPointerLeave: (e: PointerEvent) => void;
}

/**
 * Pointer handlers that open the tooltip of `modell` over the display and close it again. The handlers
 * stay the same across renders; the tooltip always reads the model of the display's latest render, and a
 * render while it is open redraws it (a count or a timer changed). Unmounting the display closes it.
 */
export function useHudTooltip(slot: HudTooltipSlot, modell: () => HudTooltipModell | null): HudTooltipHandler {
  const aktuell = useRef(modell);
  aktuell.current = modell;
  const anker = useRef<Element | null>(null);
  const handler = useMemo<HudTooltipHandler>(() => {
    const lesen = (): HudTooltipModell | null => aktuell.current();
    return {
      onPointerEnter: (e) => {
        if (!(e.currentTarget instanceof Element)) return;
        anker.current = e.currentTarget;
        slot.value = { anker: e.currentTarget, modell: lesen };
      },
      onPointerLeave: (e) => {
        if (slot.peek()?.anker === e.currentTarget) slot.value = null;
        anker.current = null;
      },
    };
  }, [slot]);
  useLayoutEffect(() => {
    const a = anker.current;
    const z = slot.peek();
    if (a !== null && z !== null && z.anker === a) slot.value = { anker: a, modell: z.modell };
  });
  useEffect(
    () => () => {
      const a = anker.current;
      if (a !== null && slot.peek()?.anker === a) slot.value = null;
    },
    [slot],
  );
  return handler;
}

/** Top-left corner [CSS px] of a tooltip of `groesse` for `anker` in `raum` (see module comment). */
export function hudTooltipPlatz(
  anker: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  groesse: { readonly width: number; readonly height: number },
  raum: { readonly width: number; readonly height: number },
  schritt: number,
): { readonly left: number; readonly top: number } {
  const abstand = ABSTAND * schritt;
  const rand = RAND * schritt;
  const unten = anker.top + anker.height / 2 < raum.height / 2;
  let top = unten ? anker.top + anker.height + abstand : anker.top - abstand - groesse.height;
  let left = anker.left;
  left = Math.max(rand, Math.min(left, raum.width - rand - groesse.width));
  top = Math.max(rand, Math.min(top, raum.height - rand - groesse.height));
  const snap = (v: number): number => (schritt > 0 ? Math.floor(v / schritt) * schritt : Math.floor(v));
  return { left: snap(left), top: snap(top) };
}

export function HudTooltip({ slot }: { readonly slot: HudTooltipSlot }) {
  const ziel = slot.value;
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || ziel === null) return;
    const box = el.offsetParent instanceof HTMLElement ? el.offsetParent.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const a = ziel.anker.getBoundingClientRect();
    const p = hudTooltipPlatz({ left: a.left - box.left, top: a.top - box.top, width: a.width, height: a.height }, { width: el.offsetWidth, height: el.offsetHeight }, box, designPixel(el));
    el.style.left = `${p.left}px`;
    el.style.top = `${p.top}px`;
    el.style.visibility = 'visible';
  });
  const m = ziel === null || !ziel.anker.isConnected ? null : ziel.modell();
  if (m === null) return null;
  return (
    <div ref={ref} class="dh-tooltip dh-hud-tooltip" role="tooltip" data-testid="hud-tooltip" style={{ visibility: 'hidden' }}>
      <Frame art="eisen" class="dh-tooltip__rahmen">
        <p class="dh-tooltip__titel" style={{ color: m.titelFarbe ?? 'var(--dh-akzent)' }}>
          {m.titel}
        </p>
        {m.abschnitte.map((a, i) => (
          <div class="dh-tooltip__abschnitt" key={i}>
            {a.kopf !== undefined ? <p class="dh-tooltip__kopf">{a.kopf}</p> : null}
            {a.zeilen.map((z, j) => (
              <p class={`dh-tooltip__zeile dh-tooltip__zeile--${z.ton}`} key={j} style={z.farbe === undefined ? undefined : { color: z.farbe }}>
                <span>{z.text}</span>
              </p>
            ))}
          </div>
        ))}
      </Frame>
    </div>
  );
}
