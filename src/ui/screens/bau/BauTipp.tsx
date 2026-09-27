/**
 * Pixel tooltips of the build mode (MASTERPROMPT §26 "Keine Standard-Web-Widgets", "Inventar-Komfort: …
 * ‚Verwendet in'/‚Herkunft'", "Controller: vollständige Navigation mit Fokusrahmen"; Review M4 #16): the game's iron
 * framed tooltip (src/ui/tooltip) instead of the browser's `title`, for every element of the build mode that carries
 * `data-tipp`:
 *
 * - `teil:<id>` – a piece of the panel: its item tooltip (name in its rarity colour, category and tier, description,
 *   "Herkunft" and "Verwendet in" from the game's usage index);
 * - `kategorie:<k>` – a category tab: its name and how many pieces it holds;
 * - `overlay:<o>` – an overlay switch: its full name and what it shows;
 * - `blaupause` – the blueprint switch: what planning does;
 * - `werkzeug:<tool>` – a tool of the tool bar: its name and what it does;
 * - `raumtyp:<id>` – a room type in the rooms overlay's legend: its name and description.
 *
 * It shows for the element under the pointer and, while keys or a controller are used, for the one with the focus
 * frame (the selection by keys). Reads the content and the build mode's catalog only.
 */
import type { RefObject } from 'preact';
import { useSignal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';
import { BALANCE } from '../../../content/balance';
import { CONTENT } from '../../../content/index';
import { ROOM_TYPES } from '../../../content/roomTypes';
import type { I18n } from '../../../i18n';
import type { FocusManager } from '../../focus/manager';
import { contentItemLookup, itemTooltip, ItemTooltip, type ItemTooltipModel } from '../../tooltip';
import { eintraegeDer, type BauEintrag, type BauKategorie } from './katalog';

/** Attribute of an element with a tooltip; its value says what it shows (see module comment). */
export const BAU_TIPP_ATTR = 'data-tipp';

/** A tooltip of plain text: a title and lines below it (no item behind it). */
function textTipp(title: string, subtitle: string, lines: readonly string[]): ItemTooltipModel {
  return { title, rarity: 'gewoehnlich', subtitle, rarityLabel: '', sections: lines.length === 0 ? [] : [{ lines: lines.map((text) => ({ text, tone: 'text' as const })) }] };
}

/** The tooltip model of a `data-tipp` value, or `null` (nothing to say). */
export function bauTippModell(i18n: I18n, key: string, eintraege: readonly BauEintrag[]): ItemTooltipModel | null {
  const t = i18n.t;
  const i = key.indexOf(':');
  const art = i < 0 ? key : key.slice(0, i);
  const wert = i < 0 ? '' : key.slice(i + 1);
  switch (art) {
    case 'teil': {
      const def = CONTENT.collection('items').find(wert);
      return def === undefined ? null : itemTooltip(i18n, { def, stack: null, lookup: tippLookup() });
    }
    case 'kategorie':
      return textTipp(t(`ui.bau.kategorie.${wert}`), t('ui.bau.tipp.kategorie'), [t('ui.bau.tipp.teile', { count: eintraegeDer(eintraege, wert as BauKategorie).length })]);
    case 'overlay':
      return textTipp(t(`ui.bau.overlay.${wert}.name`), t('ui.bau.tipp.overlay'), [t(`ui.bau.overlay.${wert}.erklaerung`)]);
    case 'blaupause':
      return textTipp(t('ui.bau.blaupause.schalter'), t('ui.bau.tipp.schalter'), [t('ui.bau.blaupause.titel')]);
    case 'werkzeug':
      return textTipp(t(`ui.bau.werkzeug.${wert}`), t('ui.bau.tipp.werkzeug'), [t(`ui.bau.werkzeug.${wert}.info`, { sekunden: BALANCE.building.refund.fullSeconds, prozent: Math.round(BALANCE.building.refund.lateShare * 100) })]);
    case 'raumtyp': {
      const typ = ROOM_TYPES.find((r) => r.id === wert);
      return typ === undefined ? null : textTipp(typ.name[i18n.lang], t('ui.bau.tipp.raumtyp'), [typ.beschreibung[i18n.lang]]);
    }
    default:
      return null;
  }
}

let lookup: ReturnType<typeof contentItemLookup> | null = null;
/** The usage index of the content ("Herkunft", "Verwendet in"), built once. */
function tippLookup(): ReturnType<typeof contentItemLookup> {
  lookup ??= contentItemLookup();
  return lookup;
}

export interface BauTippProps {
  readonly i18n: I18n;
  readonly focus: FocusManager;
  /** The build mode's root: only elements inside it show a tooltip. */
  readonly root: RefObject<HTMLElement>;
  readonly eintraege: readonly BauEintrag[];
}

/** The tooltip of the hovered (pointer) or focused (keys) `data-tipp` element inside `root`. */
export function BauTipp({ i18n, focus, root, eintraege }: BauTippProps) {
  const hovered = useSignal<Element | null>(null);
  const keys = focus.keys.value;
  const focused = focus.focused.value;
  useEffect(() => {
    const el = root.current;
    if (el === null) return;
    const over = (e: PointerEvent): void => {
      const t = e.target instanceof Element ? e.target.closest(`[${BAU_TIPP_ATTR}]`) : null;
      const inside = t !== null && el.contains(t) ? t : null;
      if (inside !== hovered.peek()) hovered.value = inside;
    };
    const out = (e: PointerEvent): void => {
      const to = e.relatedTarget instanceof Element ? e.relatedTarget.closest(`[${BAU_TIPP_ATTR}]`) : null;
      if (to === null || !el.contains(to)) hovered.value = null;
    };
    el.addEventListener('pointerover', over);
    el.addEventListener('pointerout', out);
    return () => {
      el.removeEventListener('pointerover', over);
      el.removeEventListener('pointerout', out);
    };
  }, [root, hovered]);
  const fokusAnker = focused instanceof HTMLElement && focused.hasAttribute(BAU_TIPP_ATTR) && root.current?.contains(focused) === true ? focused : null;
  const anchor = keys ? fokusAnker : hovered.value;
  const key = anchor?.getAttribute(BAU_TIPP_ATTR) ?? null;
  const model = useMemo(() => (key === null ? null : bauTippModell(i18n, key, eintraege)), [i18n, key, eintraege]);
  if (anchor === null || model === null || !anchor.isConnected) return null;
  return <ItemTooltip anchor={anchor} model={model} />;
}
