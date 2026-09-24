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
import { placeTooltip } from './place';
import { rarityHex, rarityTokens, rarityVar } from './rarity';
import './tooltip.css';

/** Gap between anchor and tooltip, and the least distance to the viewport edge [design px]. */
const TOOLTIP_GAP = 3;
const TOOLTIP_MARGIN = 2;

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
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const step = designPixel(el);
    // The screen layer (the offset parent) spans the viewport; placement is relative to it.
    const box = el.offsetParent instanceof HTMLElement ? el.offsetParent.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const a = anchor.getBoundingClientRect();
    const place = placeTooltip(
      { left: a.left - box.left, top: a.top - box.top, width: a.width, height: a.height },
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: box.width, height: box.height },
      TOOLTIP_GAP * step,
      TOOLTIP_MARGIN * step,
      step,
    );
    el.style.left = `${place.left}px`;
    el.style.top = `${place.top}px`;
    el.style.visibility = 'visible';
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
