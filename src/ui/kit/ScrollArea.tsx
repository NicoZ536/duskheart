/**
 * Scroll area with the kit's pixel scrollbar (MASTERPROMPT §26 "Keine Standard-Web-Widgets, eigene
 * Pixel-Scrollbars"). The native scrollbar is hidden; wheel and arrow buttons scroll by whole
 * lines, the thumb can be dragged, a click on the track pages, keyboard scrolling stays native.
 * Every scroll position is snapped to whole design pixels, so content never sits between screen
 * pixels at scales above 1×.
 */
import type { ComponentChildren } from 'preact';
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { UI_GRAFIKEN } from '../../generated/ui';
import { lineHeightOf } from '../../render/text';
import { UI_FONT } from '../font';
import { UI_SCALE_VAR } from '../theme';
import { scrollForThumb, snapScroll, thumbGeometry, uiPx } from './geometry';

/** Shortest thumb [design px]: its rims plus the grip grooves. */
export const MIN_THUMB = (UI_GRAFIKEN.scroll_griff.slice[0] ?? 0) + (UI_GRAFIKEN.scroll_griff.slice[2] ?? 0) + UI_GRAFIKEN.scroll_rillen.height;
/** Lines one page step keeps visible from the previous page. */
const PAGE_OVERLAP_LINES = 1;

export interface ScrollAreaProps {
  /** Height of the whole area [design px]. */
  readonly height: number;
  /** Accessible names of the arrow buttons, already translated. */
  readonly labelHoch: string;
  readonly labelRunter: string;
  /** Scroll step of wheel and arrows [design px]; default: one text line. */
  readonly zeile?: number;
  readonly class?: string;
  readonly children?: ComponentChildren;
}

interface Metrics {
  readonly view: number;
  readonly content: number;
  readonly scroll: number;
  readonly track: number;
  readonly scale: number;
}

const EMPTY: Metrics = { view: 0, content: 0, scroll: 0, track: 0, scale: 1 };

/** The applied UI scale at `el` (inherited custom property; 1 if missing). */
function uiScaleAt(el: Element): number {
  const v = Number.parseFloat(getComputedStyle(el).getPropertyValue(UI_SCALE_VAR));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export function ScrollArea({ height, labelHoch, labelRunter, zeile = lineHeightOf(UI_FONT), class: extra, children }: ScrollAreaProps) {
  const inhalt = useRef<HTMLDivElement>(null);
  const koerper = useRef<HTMLDivElement>(null);
  const schiene = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startOffset: number; size: number } | null>(null);
  const [m, setM] = useState<Metrics>(EMPTY);

  const measure = useCallback(() => {
    const el = inhalt.current;
    const rail = schiene.current;
    if (el === null || rail === null) return;
    const scale = uiScaleAt(el);
    setM({ view: el.clientHeight / scale, content: el.scrollHeight / scale, scroll: el.scrollTop / scale, track: rail.clientHeight / scale, scale });
  }, []);

  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    for (const el of [inhalt.current, koerper.current, schiene.current]) if (el !== null) observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const scrollTo = (designPx: number): void => {
    const el = inhalt.current;
    if (el === null) return;
    el.scrollTop = snapScroll(designPx * m.scale, m.scale);
  };
  const scrollBy = (lines: number): void => scrollTo(m.scroll + lines * zeile);

  const onScroll = (): void => {
    const el = inhalt.current;
    if (el === null) return;
    const scale = uiScaleAt(el);
    const snapped = snapScroll(el.scrollTop, scale);
    if (Math.abs(snapped - el.scrollTop) >= 1) el.scrollTop = snapped;
    measure();
  };
  const onWheel = (e: WheelEvent): void => {
    if (e.deltaY === 0) return;
    e.preventDefault();
    scrollBy(Math.sign(e.deltaY));
  };

  const thumb = thumbGeometry(m.view, m.content, m.scroll, m.track, MIN_THUMB);
  const atTop = m.scroll <= 0;
  const atBottom = m.scroll >= m.content - m.view - 1;
  const page = Math.max(zeile, m.view - PAGE_OVERLAP_LINES * zeile);

  const onRailDown = (e: PointerEvent): void => {
    const rail = schiene.current;
    if (rail === null || e.target !== rail) return;
    const y = (e.clientY - rail.getBoundingClientRect().top) / m.scale;
    scrollTo(m.scroll + (y < thumb.offset ? -page : page));
  };
  const onThumbDown = (e: PointerEvent): void => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startOffset: thumb.offset, size: thumb.size };
  };
  const onThumbMove = (e: PointerEvent): void => {
    const d = drag.current;
    if (d === null) return;
    const offset = d.startOffset + (e.clientY - d.startY) / m.scale;
    scrollTo(scrollForThumb(offset, m.view, m.content, m.track, d.size));
  };
  const onThumbUp = (): void => {
    drag.current = null;
  };

  const grooves = Math.floor((thumb.size - UI_GRAFIKEN.scroll_rillen.height) / 2);
  return (
    <div class={['dh-scroll', extra].filter(Boolean).join(' ')} style={{ height: uiPx(height) }}>
      <div ref={inhalt} class="dh-scroll__inhalt" tabIndex={0} onScroll={onScroll} onWheel={onWheel}>
        <div ref={koerper}>{children}</div>
      </div>
      <div class="dh-scroll__leiste">
        <button type="button" class={`dh-scroll__pfeil ${UI_GRAFIKEN.scroll_hoch.klasse}`} aria-label={labelHoch} disabled={!thumb.scrollable || atTop} onClick={() => scrollBy(-1)} />
        <div ref={schiene} class="dh-scroll__schiene" onPointerDown={onRailDown}>
          <div class={`dh-scroll__bahn ${UI_GRAFIKEN.scroll_bahn.klasse}`} aria-hidden="true" />
          {thumb.scrollable ? (
            <div
              class={`dh-scroll__griff ${UI_GRAFIKEN.scroll_griff.klasse}`}
              style={{ top: uiPx(thumb.offset), height: uiPx(thumb.size) }}
              aria-hidden="true"
              onPointerDown={onThumbDown}
              onPointerMove={onThumbMove}
              onPointerUp={onThumbUp}
              onPointerCancel={onThumbUp}
            >
              <span class={`dh-scroll__rillen ${UI_GRAFIKEN.scroll_rillen.klasse}`} style={{ top: uiPx(Math.max(0, grooves - (UI_GRAFIKEN.scroll_griff.slice[0] ?? 0))) }} />
            </div>
          ) : null}
        </div>
        <button type="button" class={`dh-scroll__pfeil ${UI_GRAFIKEN.scroll_runter.klasse}`} aria-label={labelRunter} disabled={!thumb.scrollable || atBottom} onClick={() => scrollBy(1)} />
      </div>
    </div>
  );
}
