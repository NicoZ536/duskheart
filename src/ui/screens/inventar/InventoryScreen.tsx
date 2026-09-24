/**
 * Inventory, equipment and stats screen (MASTERPROMPT §26 "Inventar/Ausrüstung/Werte",
 * "Inventar-Komfort", §13.1; M3-30), opened with Tab/I (D-pad up).
 *
 * Layout (fits 480×270 design px, the smallest auto-scaled viewport): equipment with the paper-doll
 * figure, belt and backpack slot | inventory (30), backpack compartment, hotbar (10), sort and bin |
 * stats (vitals, temperature, what the equipment adds). Below, a hint line with the gestures of the
 * device in use and the reason of the last refused move.
 *
 * Reads the bridge signals (bags, equipment stats, vitals) and sends bag commands only
 * (`bridge.actions.inventory`); every rule of the gestures lives in `model.ts`.
 * - Pointer: drag & drop (a ghost icon follows the pointer), Shift+click, right click, double click,
 *   number keys over a slot, drop on the bin (confirmation from rarity Selten).
 * - Keyboard/controller: the focus frame walks the slots; confirm picks up and puts down, next/prev
 *   (E/Q, RB/LB) are Shift+click and right click, number keys put the focused stack on the hotbar,
 *   back puts a carried stack back or closes the screen.
 * - Tooltips (`src/ui/tooltip`) for the hovered or focused slot, compared with the worn piece.
 */
import { useSignal } from '@preact/signals';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { itemFigureLayer, itemLayerSpriteId } from '../../../content/items/index';
import type { ItemDef } from '../../../content/schema/item';
import type { Slot as BagSlotContent } from '../../../game/inventory/bags';
import { contentItemCatalog, type ItemCatalog } from '../../../game/items/catalog';
import { FRESHNESS_MAX, maxDurability } from '../../../game/items/formulas';
import { sameSlot, type BagArea, type SlotRef } from '../../../game/items/slots';
import { stackQuality } from '../../../game/items/stack';
import type { I18n } from '../../../i18n';
import type { UiBridge } from '../../bridge';
import { ScreenLayer, designPixel } from '../../focus/Layer';
import type { FocusElement, FocusManager, NavAction } from '../../focus/manager';
import { actionPrompt, usesGamepad } from '../../focus/prompts';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { Button, Frame, Slot, uiPx } from '../../kit';
import { contentItemLookup, itemTooltip, ItemTooltip, tooltipTokens, type ItemLookup } from '../../tooltip';
import { Glyph, type GlyphId } from './glyphs';
import { ensureAtlasImages, hasSprite, itemIconUrl, layeredImage } from './itemIcons';
import {
  carryConfirm,
  clickIntent,
  comparisonSlot,
  discardIntent,
  DOLL_LEFT,
  DOLL_RIGHT,
  dropIntent,
  equipmentSlotRef,
  GRID_COLUMNS,
  hotbarIntent,
  parseSlotKey,
  slotKey,
  stackAt,
  type SlotIntent,
} from './model';
import { statGroups, type VitalsValues } from './stats';
import './inventar.css';

/** Body sprite of the figure and the shipwrecked's own clothes (src/render/game/playerFigure.ts). */
const FIGURE_BODY = ['spieler_basis', 'spieler_koerper'] as const;
const START_CLOTHES = ['ausruestung_leinenhose', 'ausruestung_leinentunika'] as const;
/** Pointer travel before a press on a slot becomes a drag [design px]. */
const DRAG_THRESHOLD = 3;
/** Scale of the paper-doll figure (integer, §26). */
const FIGURE_SCALE = 2;
/** Size of an item icon [design px] (docs/ART.md §3). */
const ICON_PX = 16;
/** Rarity and comparison colours for the slot rims and wear bars (palette tokens, src/ui/tooltip). */
const SCREEN_TOKENS = tooltipTokens();
/** Separator of the parts of a hint line in the texts; shown as gaps (the line wraps between parts, never inside one). */
const HINT_SEPARATOR = ' · ';
/** Size of a slot [design px] (kit graphic `slot`). */
const SLOT_PX = 20;

export interface InventoryScreenProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly focus: FocusManager;
  readonly close: () => void;
  /** Item definitions (default: the game's content). */
  readonly catalog?: ItemCatalog;
  /** "Verwendet in"/"Herkunft" (default: derived from the content). */
  readonly lookup?: ItemLookup;
}

interface DragState {
  readonly from: SlotRef;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  x: number;
  y: number;
  active: boolean;
}

interface DiscardAsk {
  readonly from: SlotRef;
  readonly def: ItemDef;
  readonly count: number;
}

/** Execute an intent through the bridge (except discards that need the confirmation first). */
function sendIntent(bridge: UiBridge, intent: SlotIntent, ask: (from: SlotRef) => void): void {
  const inv = bridge.actions.inventory;
  switch (intent.kind) {
    case 'none':
      return;
    case 'move':
      inv.move(intent.from, intent.to);
      return;
    case 'quickMove':
      inv.quickMove(intent.from);
      return;
    case 'split':
      inv.split(intent.from);
      return;
    case 'collect':
      inv.collect(intent.at);
      return;
    case 'discard':
      if (intent.confirm) ask(intent.from);
      else inv.discard(intent.from);
      return;
  }
}

function slotOf(el: FocusElement | Element | null): SlotRef | null {
  return el instanceof Element ? parseSlotKey(el.getAttribute('data-slot')) : null;
}

/** Translated accessible name of a slot. */
function slotLabel(i18n: I18n, area: BagArea, stack: BagSlotContent, def: ItemDef | undefined, place: string): string {
  if (stack === null || def === undefined) return i18n.t('ui.inventory.leer', { platz: place });
  return stack.count > 1 ? i18n.t('ui.inventory.stapel', { item: def.name[i18n.lang], anzahl: stack.count }) : def.name[i18n.lang] + (area === 'ausruestung' ? ` (${place})` : '');
}

interface BagSlotProps {
  readonly i18n: I18n;
  readonly at: SlotRef;
  readonly stack: BagSlotContent;
  readonly def: ItemDef | undefined;
  readonly place: string;
  readonly glyph?: GlyphId;
  readonly aktiv?: boolean;
  readonly lifted: boolean;
  readonly handlers: SlotHandlers;
}

interface SlotHandlers {
  onPointerDown(e: PointerEvent, at: SlotRef): void;
  onClick(e: MouseEvent, at: SlotRef): void;
  onContextMenu(e: MouseEvent, at: SlotRef): void;
  onEnter(at: SlotRef): void;
  onLeave(at: SlotRef): void;
}

/**
 * Wear bar at the foot of a slot: durability or freshness share (0–1) once the piece is worn or the
 * food no longer fresh; `null` = none (new pieces and fresh food show no bar, like an unused tool).
 */
function wearShare(stack: BagSlotContent, def: ItemDef | undefined): { share: number; kind: 'haltbarkeit' | 'frische' } | null {
  if (stack === null || def === undefined) return null;
  let wear: { share: number; kind: 'haltbarkeit' | 'frische' } | null = null;
  if (def.haltbarkeit !== undefined && stack.haltbarkeit !== undefined) wear = { share: stack.haltbarkeit / maxDurability(def.haltbarkeit, stackQuality(stack)), kind: 'haltbarkeit' };
  else if (stack.frische !== undefined) wear = { share: stack.frische / FRESHNESS_MAX, kind: 'frische' };
  return wear !== null && wear.share < 1 ? wear : null;
}

/** Inner width of the wear bar [design px]. */
const WEAR_BAR_PX = 12;

function BagSlot({ i18n, at, stack, def, place, glyph, aktiv, lifted, handlers }: BagSlotProps) {
  const icon = def === undefined ? null : itemIconUrl(def.id);
  const wear = wearShare(stack, def);
  const fill = wear === null ? 0 : Math.max(stack?.haltbarkeit === 0 ? 0 : 1, Math.round(wear.share * WEAR_BAR_PX));
  return (
    <Slot
      class="dh-inv__slot"
      label={slotLabel(i18n, at.bereich, stack, def, place)}
      aktiv={aktiv}
      anzahl={stack?.count}
      data-fokus=""
      data-slot={slotKey(at)}
      data-testid={`slot-${at.bereich}-${at.index}`}
      data-item={stack?.item}
      data-raritaet={def?.raritaet}
      data-kaputt={stack?.haltbarkeit === 0 ? '' : undefined}
      data-angehoben={lifted ? '' : undefined}
      onPointerDown={(e: PointerEvent) => handlers.onPointerDown(e, at)}
      onClick={(e: MouseEvent) => handlers.onClick(e, at)}
      onContextMenu={(e: MouseEvent) => handlers.onContextMenu(e, at)}
      onPointerEnter={() => handlers.onEnter(at)}
      onPointerLeave={() => handlers.onLeave(at)}
    >
      {stack !== null && def !== undefined ? (
        icon !== null ? (
          <img class="dh-inv__icon" src={icon} alt="" draggable={false} />
        ) : (
          <span class="dh-inv__initiale" aria-hidden="true">
            {def.name[i18n.lang].slice(0, 1)}
          </span>
        )
      ) : glyph !== undefined ? (
        <Glyph id={glyph} class="dh-inv__glyphe" />
      ) : null}
      {wear !== null ? (
        <span class={`dh-inv__verschleiss dh-inv__verschleiss--${wear.kind}`} aria-hidden="true">
          <span style={{ width: uiPx(fill) }} data-anteil={wear.share < 0.25 ? 'niedrig' : wear.share < 0.5 ? 'mittel' : 'hoch'} />
        </span>
      ) : null}
    </Slot>
  );
}

export function InventoryScreen({ i18n, bridge, focus, close, catalog = contentItemCatalog(), lookup = contentItemLookup() }: InventoryScreenProps) {
  const t = i18n.t;
  const lang = i18n.lang;
  const root = useRef<HTMLDivElement>(null);
  const bags = bridge.state.bags.value;
  const keys = focus.keys.value;
  const focusedEl = focus.focused.value;
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const [hovered, setHovered] = useState<SlotRef | null>(null);
  const carry = useSignal<SlotRef | null>(null);
  const [ask, setAsk] = useState<DiscardAsk | null>(null);
  const openedTick = useMemo(() => bridge.state.tick.peek(), [bridge]);
  const rejection = bridge.state.lastRejection.value;

  useEffect(() => ensureAtlasImages(), []);

  const defOf = (stack: BagSlotContent): ItemDef | undefined => (stack === null ? undefined : catalog.find(stack.item));
  const current = (ref: SlotRef | null): BagSlotContent => (ref === null || bags === null ? null : stackAt(bags, ref));

  const askDiscard = (from: SlotRef): void => {
    const stack = current(from);
    const def = defOf(stack);
    if (stack !== null && def !== undefined) setAsk({ from, def, count: stack.count });
  };
  const run = (intent: SlotIntent): void => sendIntent(bridge, intent, askDiscard);

  // --- Pointer gestures -------------------------------------------------------------------
  const handlers: SlotHandlers = {
    onPointerDown(e, at) {
      // A click swallowed after a drag never outlives the next press.
      suppressClick.current = false;
      if (e.button !== 0 || e.shiftKey || current(at) === null) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const d: DragState = { from: at, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, active: false };
      dragRef.current = d;
      carry.value = null;
    },
    onClick(e, at) {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      if (current(at) === null) return;
      run(clickIntent(at, { button: e.button, shift: e.shiftKey, detail: e.detail }));
    },
    onContextMenu(e, at) {
      e.preventDefault();
      if (current(at) !== null) run(clickIntent(at, { button: 2, shift: false, detail: 1 }));
    },
    onEnter(at) {
      setHovered(at);
    },
    onLeave(at) {
      setHovered((h) => (h !== null && sameSlot(h, at) ? null : h));
    },
  };

  // Window listeners of a drag, registered once; they reach the latest render through `latest`.
  const latest = useRef({ current, defOf, run });
  latest.current = { current, defOf, run };
  useEffect(() => {
    const move = (e: PointerEvent): void => {
      const d = dragRef.current;
      if (d === null || e.pointerId !== d.pointerId) return;
      d.x = e.clientX;
      d.y = e.clientY;
      const step = root.current === null ? 1 : designPixel(root.current);
      if (!d.active && Math.hypot(d.x - d.startX, d.y - d.startY) >= DRAG_THRESHOLD * step) d.active = true;
      if (d.active) setDrag({ ...d });
    };
    const up = (e: PointerEvent): void => {
      const d = dragRef.current;
      if (d === null || e.pointerId !== d.pointerId) return;
      dragRef.current = null;
      setDrag(null);
      if (!d.active) return;
      suppressClick.current = true;
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-slot], [data-muell]') ?? null;
      if (target === null) return;
      const act = latest.current;
      if (target.hasAttribute('data-muell')) {
        const def = act.defOf(act.current(d.from));
        if (def !== undefined) act.run(discardIntent(d.from, def));
        return;
      }
      const to = parseSlotKey(target.getAttribute('data-slot'));
      if (to !== null) act.run(dropIntent(d.from, to));
    };
    const cancel = (e: PointerEvent): void => {
      if (dragRef.current?.pointerId === e.pointerId) {
        dragRef.current = null;
        setDrag(null);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, []);

  // --- Keyboard / controller --------------------------------------------------------------
  useFocusScope(focus, root, {
    initial: () => focusable(root, `[data-slot="${slotKey({ bereich: 'inventar', index: 0 })}"]`),
    onAction(action: NavAction, focused: FocusElement | null, index: number): boolean {
      const at = slotOf(focused);
      if (action === 'hotbar') {
        const from = focus.keys.peek() ? at : hovered;
        if (from !== null && current(from) !== null) run(hotbarIntent(from, index));
        return true;
      }
      if (action === 'back' && carry.peek() !== null) {
        carry.value = null;
        return true;
      }
      if (action === 'confirm' && focused instanceof Element && focused.hasAttribute('data-muell')) {
        const from = carry.peek();
        if (from === null) return true;
        carry.value = null;
        const def = defOf(current(from));
        if (def !== undefined) run(discardIntent(from, def));
        return true;
      }
      if (at === null) return false;
      if (action === 'confirm') {
        const step = carryConfirm(carry.peek(), at, current(at) !== null);
        carry.value = step.carry;
        run(step.intent);
        return true;
      }
      if ((action === 'next' || action === 'prev') && current(at) !== null) {
        run(action === 'next' ? { kind: 'quickMove', from: at } : { kind: 'split', from: at });
        return true;
      }
      return false;
    },
    onBack: close,
  });

  // A carried stack that vanished (moved by the simulation) is no longer carried.
  useLayoutEffect(() => {
    const c = carry.peek();
    if (c !== null && current(c) === null) carry.value = null;
  });

  if (bags === null) return null;

  const lifted = drag?.active === true ? drag.from : carry.value;
  const slot = (at: SlotRef, place: string, glyph?: GlyphId, aktiv?: boolean) => {
    const stack = stackAt(bags, at);
    return (
      <BagSlot
        key={slotKey(at)}
        i18n={i18n}
        at={at}
        stack={stack}
        def={defOf(stack)}
        place={place}
        glyph={glyph}
        aktiv={aktiv}
        lifted={lifted !== null && sameSlot(lifted, at)}
        handlers={handlers}
      />
    );
  };
  const grid = (area: 'inventar' | 'rucksackfach' | 'schnellleiste', testId: string) => (
    <div class="dh-inv__raster" data-testid={testId} style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, ${uiPx(SLOT_PX)})` }}>
      {bags[area].map((_, index) => slot({ bereich: area, index }, t(`ui.inventory.bereich.${area}`), undefined, area === 'schnellleiste' && index === bags.auswahl))}
    </div>
  );

  // Tooltip: the hovered slot (pointer) or the focused one (keys), not while dragging, carrying or asking.
  const tipAt = drag !== null || ask !== null || carry.value !== null ? null : keys ? slotOf(focusedEl) : hovered;
  const tipStack = current(tipAt);
  const tipDef = defOf(tipStack);
  const tipAnchor = tipAt === null ? null : (root.current?.querySelector(`[data-slot="${slotKey(tipAt)}"]`) ?? null);
  const compareAt = tipAt !== null && tipDef !== undefined ? comparisonSlot(bags, tipDef, tipAt) : null;
  const compareStack = current(compareAt);
  const compareDef = defOf(compareStack);
  const tooltip =
    tipAt !== null && tipStack !== null && tipDef !== undefined && tipAnchor !== null ? (
      <ItemTooltip anchor={tipAnchor} model={itemTooltip(i18n, { def: tipDef, stack: tipStack, compare: compareStack !== null && compareDef !== undefined ? { def: compareDef, stack: compareStack } : null, lookup })} />
    ) : null;

  const ghostIcon = drag?.active === true ? itemIconUrl(current(drag.from)?.item ?? '') : null;
  const ghost =
    drag?.active === true && ghostIcon !== null && root.current !== null ? (
      <DragGhost url={ghostIcon} x={drag.x} y={drag.y} layer={root.current.closest('.dh-ebene')} />
    ) : null;

  // Paper doll: body, the shipwrecked's clothes, worn pieces drawn on the figure (M3-07 layers).
  const body = FIGURE_BODY.find((id) => hasSprite(id)) ?? null;
  const worn = bags.ausruestung.flatMap((s) => {
    const def = defOf(s);
    if (def === undefined || itemFigureLayer(def) === null || itemFigureLayer(def) === 'nebenhand') return [];
    const id = itemLayerSpriteId(def.id);
    return hasSprite(id) ? [id] : [];
  });
  const figure = body === null ? null : layeredImage([body, ...START_CLOTHES, ...worn], 'idle_down');

  const lastRefusal = rejection !== null && rejection.tick >= openedTick && rejection.type.startsWith('inventory.') ? t(`ui.inventory.reject.${rejection.reason}`) : null;
  const pad = usesGamepad(bridge.input);
  const prompt = (action: Parameters<typeof actionPrompt>[2], fallback: string): string => actionPrompt(i18n, bridge.input, action) ?? fallback;
  const carried = carry.value === null ? undefined : defOf(current(carry.value));
  const hint =
    carried !== undefined
      ? t('ui.inventory.hinweis.traegt', { item: carried.name[lang], ablegen: prompt('uiConfirm', '-'), zurueck: prompt('uiBack', '-') })
      : keys || pad
        ? t('ui.inventory.hinweis.tasten', { waehlen: prompt('uiConfirm', '-'), schnell: prompt('uiTabNext', '-'), teilen: prompt('uiTabPrev', '-'), schliessen: prompt('uiBack', '-') })
        : t('ui.inventory.hinweis.maus');

  return (
    <ScreenLayer
      focus={focus}
      label={t('ui.inventory.titel')}
      testId="ui-inventar"
      overlay={
        <>
          {tooltip}
          {ghost}
          {ask !== null ? (
            <DiscardDialog
              i18n={i18n}
              focus={focus}
              ask={ask}
              onYes={() => {
                bridge.actions.inventory.discard(ask.from);
                setAsk(null);
              }}
              onNo={() => setAsk(null)}
            />
          ) : null}
        </>
      }
    >
      <div ref={root} class="dh-inv" style={SCREEN_TOKENS} data-traegt={carry.value === null ? undefined : slotKey(carry.value)}>
        <Frame art="holz" class="dh-inv__tafel dh-inv__tafel--ausruestung" data-testid="inventar-ausruestung">
          <h2 class="dh-inv__titel">{t('ui.inventory.bereich.ausruestung')}</h2>
          <div class="dh-inv__puppe">
            <div class="dh-inv__spalte">{DOLL_LEFT.map((s) => slot(equipmentSlotRef(s), t(`ui.equipment.slot.${s}`), s))}</div>
            <div class="dh-inv__figur">
              {figure !== null ? <img src={figure.url} alt={t('ui.inventory.figur')} draggable={false} style={{ width: uiPx(figure.width * FIGURE_SCALE), height: uiPx(figure.height * FIGURE_SCALE) }} /> : null}
            </div>
            <div class="dh-inv__spalte">{DOLL_RIGHT.map((s) => slot(equipmentSlotRef(s), t(`ui.equipment.slot.${s}`), s))}</div>
          </div>
          <p class="dh-inv__unter dh-inv__beschriftung">
            <span>{t('ui.inventory.bereich.guertel')}</span>
            <span>{t('ui.inventory.bereich.rucksack')}</span>
          </p>
          <div class="dh-inv__guertel">
            <div class="dh-inv__reihe">{bags.guertel.map((_, index) => slot({ bereich: 'guertel', index }, t('ui.inventory.bereich.guertel'), 'guertel'))}</div>
            {slot({ bereich: 'rucksack', index: 0 }, t('ui.inventory.bereich.rucksack'), 'rucksack')}
          </div>
        </Frame>
        <Frame art="holz" class="dh-inv__tafel dh-inv__tafel--taschen">
          <h2 class="dh-inv__titel">{t('ui.inventory.bereich.inventar')}</h2>
          {grid('inventar', 'inventar-raster')}
          <p class="dh-inv__unter">{t('ui.inventory.bereich.rucksackfach')}</p>
          {bags.rucksackfach.length > 0 ? grid('rucksackfach', 'rucksackfach-raster') : <p class="dh-inv__leer">{t('ui.inventory.keinRucksack')}</p>}
          <p class="dh-inv__unter">{t('ui.inventory.schnellleiste')}</p>
          {grid('schnellleiste', 'schnellleiste-raster')}
          <div class="dh-inv__werkzeuge">
            <Button data-fokus="" data-testid="inventar-sortieren" onClick={() => bridge.actions.inventory.sort()}>
              {t('ui.inventory.sortieren')}
            </Button>
            <Slot class="dh-inv__muell" label={t('ui.inventory.muell')} data-fokus="" data-muell="" data-testid="inventar-muell">
              <Glyph id="muell" class="dh-inv__glyphe" />
            </Slot>
          </div>
        </Frame>
        <StatsPanel i18n={i18n} bridge={bridge} />
        <p class={lastRefusal !== null ? 'dh-inv__hinweis dh-inv__hinweis--fehler' : 'dh-inv__hinweis'} data-testid="inventar-hinweis" role={lastRefusal !== null ? 'alert' : undefined}>
          {(lastRefusal ?? hint).split(HINT_SEPARATOR).map((part, i) => (
            <span key={i}>{part}</span>
          ))}
        </p>
      </div>
    </ScreenLayer>
  );
}

/**
 * The stats panel: its own component, so the vitals (they change while the world runs) re-render
 * only these rows, not the slots.
 */
function StatsPanel({ i18n, bridge }: { i18n: I18n; bridge: UiBridge }) {
  const v = bridge.state.player;
  const vitals: VitalsValues | null = v.present.value
    ? {
        health: v.health.value,
        maxHealth: v.maxHealth.value,
        stamina: v.stamina.value,
        maxStamina: v.maxStamina.value,
        satiety: v.satiety.value,
        thirst: v.thirst.value,
        wetness: v.wetness.value,
        exhaustion: v.exhaustion.value,
        coreC: v.coreC.value,
        feltC: v.feltC.value,
        bandLowC: v.bandLowC.value,
        bandHighC: v.bandHighC.value,
        temperatureStage: v.temperatureStage.value,
      }
    : null;
  return (
    <Frame art="pergament" class="dh-inv__tafel dh-inv__tafel--werte" data-testid="inventar-werte">
      {statGroups(i18n, vitals, bridge.state.equipmentStats.value).map((g) => (
        <section key={g.id} class="dh-inv__gruppe">
          <h2 class="dh-inv__titel">{g.heading}</h2>
          <dl class="dh-inv__werte">
            {g.rows.map((r) => (
              <div key={r.id} class={`dh-inv__wert dh-inv__wert--${r.tone}`} data-testid={`wert-${r.id}`}>
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </Frame>
  );
}

/** Icon under the pointer while dragging, on whole design pixels of the layer. */
function DragGhost({ url, x, y, layer }: { url: string; x: number; y: number; layer: Element | null }) {
  const box = layer?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const step = layer === null ? 1 : designPixel(layer);
  const half = (ICON_PX / 2) * step;
  const left = Math.round((x - box.left - half) / step) * step;
  const top = Math.round((y - box.top - half) / step) * step;
  return <img class="dh-inv__geist" src={url} alt="" style={{ left: `${left}px`, top: `${top}px` }} data-testid="inventar-geist" />;
}

interface DiscardDialogProps {
  readonly i18n: I18n;
  readonly focus: FocusManager;
  readonly ask: DiscardAsk;
  readonly onYes: () => void;
  readonly onNo: () => void;
}

/** Confirmation before the bin destroys an item of rarity Selten or higher (§26). */
function DiscardDialog({ i18n, focus, ask, onYes, onNo }: DiscardDialogProps) {
  const t = i18n.t;
  const ref = useRef<HTMLDivElement>(null);
  useFocusScope(focus, ref, { initial: () => focusable(ref, '[data-nein]'), onBack: onNo });
  return (
    <div class="dh-inv__dialog-ebene" role="alertdialog" aria-label={t('ui.inventory.muell.titel')} data-testid="inventar-muell-dialog">
      <div ref={ref}>
        <Frame art="holz" class="dh-inv__dialog">
          <h2 class="dh-inv__titel">{t('ui.inventory.muell.titel')}</h2>
          <p class="dh-inv__dialog-text">
            {t('ui.inventory.muell.frage', {
              item: ask.def.name[i18n.lang],
              anzahl: ask.count,
              raritaet: t(`ui.item.raritaet.${ask.def.raritaet}`),
            })}
          </p>
          <div class="dh-inv__dialog-knoepfe">
            <Button data-fokus="" data-ja="" data-testid="inventar-muell-ja" onClick={onYes}>
              {t('ui.inventory.muell.ja')}
            </Button>
            <Button data-fokus="" data-nein="" data-testid="inventar-muell-nein" onClick={onNo}>
              {t('ui.inventory.muell.nein')}
            </Button>
          </div>
        </Frame>
      </div>
    </div>
  );
}

