/**
 * Item tooltip panel (MASTERPROMPT §26): lays out an `ItemTooltipModel` in an iron frame next to its
 * anchor element (`placeTooltip`, on whole design pixels). It stays invisible until it is measured
 * and placed, so it never flashes at the corner.
 */
import { useLayoutEffect, useRef } from 'preact/hooks';
import { UI_HEX } from '../../generated/palette';
import { Frame } from '../kit';
import { designPixel } from '../focus/Layer';
import type { ItemTooltipModel, TooltipLine } from './itemTooltip';
import { FONT_INK, readObstacles } from './obstacles';
import { placeTooltip } from './place';
import { rarityHex, rarityTokens, rarityVar } from './rarity';
import './tooltip.css';

/** Gap between anchor and tooltip, and the least distance to the viewport edge [design px]. */
const TOOLTIP_GAP = 3;
const TOOLTIP_MARGIN = 2;
/**
 * Least distance [design px] between an upper or lower edge of the tooltip and the rim of a panel frame it overlaps
 * sideways, or a glyph of the panel's text outside it (`placeTooltip`): two pixels read as a deliberate offset, one as a
 * sliver of the panel's rim (M6-Gate).
 */
const TOOLTIP_FRAME_CLEAR = 2;
/**
 * Least distance [design px] between an upper or lower edge of the tooltip and a thin line of a covered panel (the divider
 * under a heading): at two pixels the 1-px line and the tooltip's dark outline pair into a double rule (M6-Gate, second
 * picture review of ui-inventar); three read as two separate lines, as before M6.
 */
const TOOLTIP_LINE_CLEAR = 3;
/**
 * How much wider [design px] the tooltip may grow on its far side so that edge cuts and touches no glyph of a covered
 * panel: the widest advance of the font (W, M, %: 8 px), so the edge can pass any one glyph.
 */
const TOOLTIP_SHIFT = 8;

/** Width of the tooltip before it widens (tooltip.css `max-width`), the widest it gets, and the step between [design px]. */
export const TOOLTIP_WIDTH = { normal: 200, max: 320, step: 20 } as const;

/**
 * The `max-width` [design px] a tooltip gets so its height fits `available`: the normal width, else the first wider step
 * at which it fits, else the widest (`heightAt` measures the height at a width). Pure, for the unit test.
 */
export function fittingWidth(heightAt: (width: number) => number, available: number): number {
  let width: number = TOOLTIP_WIDTH.normal;
  while (width < TOOLTIP_WIDTH.max && heightAt(width) > available) width += TOOLTIP_WIDTH.step;
  return width;
}

/**
 * A tooltip taller than the view (a long description, a comparison, the set of an armour piece and the sources together)
 * widens in steps until it fits: its lines rewrap into fewer ones, nothing is cut off at the screen edge (M6-43).
 */
function fitHeight(el: HTMLElement, available: number, step: number): void {
  el.style.maxWidth = '';
  if (el.offsetHeight <= available) return;
  const width = fittingWidth((w) => {
    el.style.maxWidth = `${w * step}px`;
    return el.offsetHeight;
  }, available);
  el.style.maxWidth = `${width * step}px`;
}

/** Colour tokens of tooltips and rarity frames: rarities plus better/worse of the comparison (§26 "grün/rot"). */
export function tooltipTokens(): Record<string, string> {
  return { ...rarityTokens(), '--dh-besser': rarityHex('ungewoehnlich'), '--dh-schlechter': UI_HEX.warnung };
}

/** The tokens, set on every tooltip (it lies in the screen layer, outside the screen's own root). */
const TOKENS = tooltipTokens();

function Line({ line }: { line: TooltipLine }) {
  return (
    <p class={`dh-tooltip__zeile dh-tooltip__zeile--${line.tone}`}>
      <span>{line.text}</span>
      {line.delta !== undefined ? <span class={`dh-tooltip__delta--${line.delta.tone}`}>{line.delta.text}</span> : null}
    </p>
  );
}

export interface ItemTooltipProps {
  readonly model: ItemTooltipModel;
  /** The element the tooltip describes (slot). */
  readonly anchor: Element;
}

export function ItemTooltip({ model, anchor }: ItemTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Where the tooltip was placed last: anchor, size and view it was placed for, and the width it got. While they stay, it
  // stays – the text of the panels it covers may change under it (values counting down) without making it jump.
  const placed = useRef<{ anchor: Element; key: string; width: string; maxWidth: string } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const step = designPixel(el);
    // The screen layer (the offset parent) spans the viewport; placement is relative to it.
    const parent = el.offsetParent instanceof HTMLElement ? el.offsetParent : null;
    const box = parent !== null ? parent.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const a = anchor.getBoundingClientRect();
    el.style.width = '';
    fitHeight(el, box.height - 2 * TOOLTIP_MARGIN * step, step);
    const at = { left: a.left - box.left, top: a.top - box.top, width: a.width, height: a.height };
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const view = { width: box.width, height: box.height };
    const key = [at.left, at.top, at.width, at.height, size.width, size.height, view.width, view.height, step].join(' ');
    const last = placed.current;
    if (last !== null && last.anchor === anchor && last.key === key) {
      el.style.maxWidth = last.maxWidth;
      el.style.width = last.width;
      return;
    }
    // Lines and text count in the panels the tooltip may cover: its columns where it would go, plus the room to grow.
    const plain = placeTooltip(at, size, view, TOOLTIP_GAP * step, TOOLTIP_MARGIN * step, step);
    const reach = TOOLTIP_SHIFT * step;
    const obstacles = {
      ...readObstacles(parent ?? document.body, el, box, step, [plain.left - reach, plain.left + size.width + reach]),
      clear: TOOLTIP_FRAME_CLEAR * step,
      lineClear: TOOLTIP_LINE_CLEAR * step,
      spacing: FONT_INK.spacing * step,
      shift: reach,
    };
    let place = placeTooltip(at, size, view, TOOLTIP_GAP * step, TOOLTIP_MARGIN * step, step, obstacles);
    if (place.width !== undefined) {
      // Grown on its far side past a glyph of a covered panel: the content keeps its lines, else the tooltip its width.
      const own = el.style.maxWidth;
      el.style.maxWidth = `${place.width}px`;
      el.style.width = `${place.width}px`;
      if (el.offsetHeight !== size.height) {
        el.style.maxWidth = own;
        el.style.width = '';
        place = placeTooltip(at, size, view, TOOLTIP_GAP * step, TOOLTIP_MARGIN * step, step, { ...obstacles, shift: 0 });
      }
    }
    el.style.left = `${place.left}px`;
    el.style.top = `${place.top}px`;
    el.style.visibility = 'visible';
    placed.current = { anchor, key, width: el.style.width, maxWidth: el.style.maxWidth };
  });
  return (
    <div ref={ref} class="dh-tooltip" role="tooltip" data-testid="ui-tooltip" style={{ ...TOKENS, visibility: 'hidden' }}>
      <Frame art="eisen" class="dh-tooltip__rahmen">
        <p class="dh-tooltip__titel" style={{ color: `var(${rarityVar(model.rarity)})` }} data-raritaet={model.rarity}>
          {model.title}
        </p>
        <p class="dh-tooltip__unter">
          <span>{model.subtitle}</span>
          <span style={{ color: `var(${rarityVar(model.rarity)})` }}>{model.rarityLabel}</span>
        </p>
        {model.sections.map((section, i) => (
          <div class="dh-tooltip__abschnitt" key={i}>
            {section.heading !== undefined ? <p class="dh-tooltip__kopf">{section.heading}</p> : null}
            {section.lines.map((line, j) => (
              <Line line={line} key={j} />
            ))}
          </div>
        ))}
      </Frame>
    </div>
  );
}
