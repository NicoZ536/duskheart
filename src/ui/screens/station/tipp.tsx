/**
 * Item tooltips of the station and chest screens (MASTERPROMPT §26 "Inventar-Komfort: … Vergleichs-Tooltips (grün/rot),
 * ‚Verwendet in'/‚Herkunft'", §15.1 "Für jedes Item ‚Verwendet in' und ‚Herkunft' nachschlagbar"; M4-07, M4-09,
 * M4-21): the same pixel tooltip as in the inventory (src/ui/tooltip: name in its rarity colour, category and tier,
 * stats, durability, "Herkunft" and "Verwendet in" from the game's `Verwendungsindex`) for every element inside the
 * screen's root that carries `data-tip` – a slot, a recipe's product or ingredient, a repair cost, a find of the
 * search. It shows for the element under the pointer and, while keys or a controller are used, for the one with the
 * focus frame. A stack is compared with the piece it would replace (the worn piece of its kind, a tool or weapon with
 * the one in the hand), like in the inventory.
 *
 * The screen says what a key means (`aufloesen`: the item and, for a slot, its stack and where it lies); the tooltip is
 * rendered in the screen layer's overlay, so it is placed against the whole layer.
 */
import type { RefObject } from 'preact';
import { useSignal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';
import type { ItemDef } from '../../../content/schema/item';
import type { BagsState } from '../../../game/inventory/bags';
import type { SlotRef } from '../../../game/items/slots';
import type { ItemStack } from '../../../game/items/stack';
import type { I18n } from '../../../i18n';
import type { FocusManager } from '../../focus/manager';
import { contentItemLookup, itemTooltip, ItemTooltip, type ItemLookup } from '../../tooltip';
import { comparisonSlot, stackAt } from '../inventar/model';

/** Attribute of an element with an item tooltip; its value is the screen's key of what it shows. */
export const TIPP_ATTR = 'data-tip';

/** What a tooltip key shows: an item, with the stack of a slot (`null`: the bare item, e.g. a recipe's product). */
export interface TippZiel {
  readonly def: ItemDef;
  readonly stack: ItemStack | null;
  /** The bag slot the stack lies in, or `null` when it lies elsewhere (a station, a chest). */
  readonly aus: SlotRef | null;
}

/** Stands for "not in the bags" when looking for the piece a stack compares with (no bag slot has index −1). */
const AUSSERHALB: SlotRef = { bereich: 'inventar', index: -1 };

/** The piece `ziel` compares with in `bags` (§26 "Vergleichs-Tooltips"), or `null`. */
export function vergleichFuer(bags: BagsState | null, ziel: TippZiel, catalog: { find(id: string): ItemDef | undefined }): { def: ItemDef; stack: ItemStack } | null {
  if (bags === null || ziel.stack === null) return null;
  const at = comparisonSlot(bags, ziel.def, ziel.aus ?? AUSSERHALB);
  const stack = at === null ? null : stackAt(bags, at);
  const def = stack === null ? undefined : catalog.find(stack.item);
  return stack === null || def === undefined ? null : { def, stack };
}

export interface ItemTippProps {
  readonly i18n: I18n;
  readonly focus: FocusManager;
  /** The screen's root: only elements inside it show a tooltip. */
  readonly root: RefObject<HTMLElement>;
  /**
   * Elements with a tooltip besides `data-tip` ones, as a CSS selector, and their key (the station screen gives the
   * orders of the recipe book's queue their product's tooltip without touching the book).
   */
  readonly weitere?: { readonly selector: string; readonly schluessel: (el: Element) => string | null };
  /** What the key of a `data-tip` element shows, or `null` (nothing there any more). */
  readonly aufloesen: (key: string) => TippZiel | null;
  /** The player's bags (the comparison), or `null`. */
  readonly bags: BagsState | null;
  readonly catalog: { find(id: string): ItemDef | undefined };
  readonly lookup?: ItemLookup;
}

/** The tooltip of the hovered (pointer) or focused (keys) `data-tip` element inside `root`. */
export function ItemTipp({ i18n, focus, root, aufloesen, bags, catalog, lookup, weitere }: ItemTippProps) {
  const hovered = useSignal<Element | null>(null);
  const selector = weitere === undefined ? `[${TIPP_ATTR}]` : `[${TIPP_ATTR}], ${weitere.selector}`;
  const index = useMemo(() => lookup ?? contentItemLookup(), [lookup]);
  const keys = focus.keys.value;
  const focused = focus.focused.value;
  useEffect(() => {
    const el = root.current;
    if (el === null) return;
    const over = (e: PointerEvent): void => {
      const t = e.target instanceof Element ? e.target.closest(selector) : null;
      const inside = t !== null && el.contains(t) ? t : null;
      if (inside !== hovered.peek()) hovered.value = inside;
    };
    const out = (e: PointerEvent): void => {
      const to = e.relatedTarget instanceof Element ? e.relatedTarget.closest(selector) : null;
      if (to === null || !el.contains(to)) hovered.value = null;
    };
    el.addEventListener('pointerover', over);
    el.addEventListener('pointerout', out);
    return () => {
      el.removeEventListener('pointerover', over);
      el.removeEventListener('pointerout', out);
    };
  }, [root, hovered, selector]);
  const fokusAnker = focused instanceof HTMLElement && focused.matches(selector) && root.current?.contains(focused) === true ? focused : null;
  const anchor = keys ? fokusAnker : hovered.value;
  if (anchor === null || !anchor.isConnected) return null;
  const key = anchor.getAttribute(TIPP_ATTR) ?? weitere?.schluessel(anchor) ?? null;
  const ziel = key === null ? null : aufloesen(key);
  if (ziel === null) return null;
  const compare = vergleichFuer(bags, ziel, catalog);
  return <ItemTooltip anchor={anchor} model={itemTooltip(i18n, { def: ziel.def, stack: ziel.stack, compare, lookup: index })} />;
}
