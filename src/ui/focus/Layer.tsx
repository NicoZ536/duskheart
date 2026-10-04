/**
 * Full-screen layer of a menu screen (MASTERPROMPT §26): dims the world, holds the screen's panels
 * centred on whole design pixels (`snapCentre`: an odd leftover of the viewport would otherwise put
 * every frame edge and glyph between screen pixels), and connects the pointer to the focus manager
 * (moving the pointer hides the focus frame, hovering a navigable element makes it the focused one).
 *
 * The layer never cuts a screen off (M6-Gate): it tells the screen its room (`useScreenRoom`, the view less
 * `SCREEN_MARGIN` above and below – a list of variable length sizes itself to it), and when the content does not fit
 * the view at the theme's UI scale even so, it draws at the largest smaller whole scale at which it does
 * (`fittingDesignPixel`), so panels and hint line stay whole.
 */
import { signal, useSignal, type ReadonlySignal } from '@preact/signals';
import { createContext, type ComponentChildren } from 'preact';
import { useContext, useLayoutEffect, useRef } from 'preact/hooks';
import { UI_REFERENCE_HEIGHT, UI_REFERENCE_WIDTH, UI_SCALE_VAR } from '../theme';
import { FOCUS_ATTR, type FocusElement, type FocusManager } from './manager';
import { fittingDesignPixel, screenRoom, type ScreenRoom } from './platz';
import './focus.css';

/**
 * Offset [CSS px] that centres `content` in `available`, rounded down to whole design pixels of
 * `step` CSS px (never negative: content larger than the viewport starts at its edge).
 */
export function snapCentre(available: number, content: number, step: number): number {
  if (!(step > 0)) return Math.max(0, Math.floor((available - content) / 2));
  return Math.max(0, Math.floor((available - content) / 2 / step) * step);
}

/** The applied design pixel [CSS px] at `el`. */
export function designPixel(el: Element): number {
  const v = Number.parseFloat(getComputedStyle(el).getPropertyValue(UI_SCALE_VAR));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** Room outside a screen layer (tests, galleries): the reference frame 480×270 (§4.2). */
const REFERENCE_ROOM = signal<ScreenRoom>(screenRoom(UI_REFERENCE_WIDTH, UI_REFERENCE_HEIGHT, 1));
const ScreenRoomContext = createContext<ReadonlySignal<ScreenRoom>>(REFERENCE_ROOM);

/** The room [design px] the enclosing screen layer gives its content (see `screenRoom`). */
export function useScreenRoom(): ReadonlySignal<ScreenRoom> {
  return useContext(ScreenRoomContext);
}

export interface ScreenLayerProps {
  readonly focus: FocusManager;
  /** Accessible name of the screen (dialog), already translated. */
  readonly label: string;
  /** Dim the world behind the screen. */
  readonly dim?: boolean;
  readonly class?: string;
  readonly testId?: string;
  readonly children?: ComponentChildren;
  /** Content positioned against the whole layer instead of the centred panels (tooltips, dragged items). */
  readonly overlay?: ComponentChildren;
}

export function ScreenLayer({ focus, label, dim = true, class: extra, testId, children, overlay }: ScreenLayerProps) {
  const layer = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const room = useSignal<ScreenRoom>(REFERENCE_ROOM.peek());

  useLayoutEffect(() => {
    const outer = layer.current;
    const inner = content.current;
    if (outer === null || inner === null) return;
    const place = (): void => {
      // The theme's design pixel (inherited from above the layer), and the one the layer draws with now.
      const themeStep = designPixel(outer.parentElement ?? document.documentElement);
      const current = designPixel(inner);
      const fit = fittingDesignPixel(outer.clientWidth, outer.clientHeight, inner.offsetWidth / current, inner.offsetHeight / current, themeStep, window.devicePixelRatio);
      if (fit === themeStep) outer.style.removeProperty(UI_SCALE_VAR);
      else outer.style.setProperty(UI_SCALE_VAR, String(fit));
      const step = designPixel(inner);
      const next = screenRoom(outer.clientWidth, outer.clientHeight, step);
      const was = room.peek();
      if (was.width !== next.width || was.height !== next.height) room.value = next;
      inner.style.left = `${snapCentre(outer.clientWidth, inner.offsetWidth, step)}px`;
      inner.style.top = `${snapCentre(outer.clientHeight, inner.offsetHeight, step)}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(outer);
    observer.observe(inner);
    // A changed UI scale setting changes the theme's design pixel on the document root.
    const theme = new MutationObserver(place);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => {
      observer.disconnect();
      theme.disconnect();
    };
  }, []);

  const onPointerMove = (): void => focus.pointerUsed();
  const onPointerOver = (e: PointerEvent): void => {
    const target = e.target instanceof Element ? e.target.closest(`[${FOCUS_ATTR}]`) : null;
    if (target instanceof HTMLElement) focus.hover(target as unknown as FocusElement);
  };

  return (
    <div
      ref={layer}
      class={['dh-kit', 'dh-ebene', dim ? 'dh-ebene--dunkel' : '', extra ?? ''].filter(Boolean).join(' ')}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-testid={testId}
      onPointerMove={onPointerMove}
      onPointerOver={onPointerOver}
      // The game's own right click (split) – never the browser's context menu over a screen.
      onContextMenu={(e) => e.preventDefault()}
    >
      <ScreenRoomContext.Provider value={room}>
        <div ref={content} class="dh-ebene__inhalt">
          {children}
        </div>
        {overlay}
      </ScreenRoomContext.Provider>
    </div>
  );
}
