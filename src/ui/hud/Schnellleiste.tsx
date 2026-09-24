/**
 * Bottom of the HUD (MASTERPROMPT §26 "unten Schnellleiste, Nebenhand, Gürtel"; §13.1; M3-27): the
 * off-hand slot (light or shield), the ten hotbar slots with the selected one lit (`player.selectHotbar`
 * on click, keys 1–0, wheel, LB/RB) and the three belt slots, the one the belt key uses next marked with
 * that key (§26 "Q Gürtel"; `action.useBelt` takes the first filled slot). Slots show the item icon,
 * the stack size, the rarity rim from Ungewöhnlich, a wear bar once a piece is worn or food no longer
 * fresh, and broken pieces greyed out; the slot of the carried light shows its burn time as a flame bar
 * (§12.2, dark while the torch is out). Tooltips name the item with its values, the belt key and the
 * light's time; empty off-hand and belt slots say what belongs there. Key glyphs follow the device used
 * last: the slot keys on the keyboard, LB/RB (or their PlayStation and generic names) beside the hotbar
 * on a gamepad. The row is centred on whole design pixels.
 */
import type { ReadonlySignal } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { ItemDef } from '../../content/schema/item';
import type { Action } from '../../engine/input/actions';
import type { GamepadFamily } from '../../engine/input/bindings';
import type { BagsState } from '../../game/inventory/bags';
import { contentItemCatalog, type ItemCatalog } from '../../game/items/catalog';
import { maxDurability } from '../../game/items/formulas';
import { equipmentSlotIndex, type SlotRef } from '../../game/items/slots';
import { stackQuality, type ItemStack } from '../../game/items/stack';
import type { I18n } from '../../i18n';
import type { UiBridge } from '../bridge';
import { designPixel, snapCentre } from '../focus/Layer';
import { Slot } from '../kit';
import { uiPx } from '../kit/geometry';
import { Glyph } from '../screens/inventar/glyphs';
import { itemIconUrl } from '../screens/inventar/itemIcons';
import { rarityVar } from '../tooltip/rarity';
import { HudBild } from './Bild';
import { HudTaste } from './Taste';
import { tastenName, tastenSymbol, type TastenSymbol } from './tasten';
import type { LightView } from './signale';
import { guertelZeile, itemTooltip, leerTooltip, lichtZeilen, NIEDRIG_ANTEIL, platzLabel, verschleiss, type HudZeile } from './texte';
import { useHudTooltip, type HudTooltipSlot } from './Tooltip';

/** Hotbar actions in slot order (keys 1–0). */
const HOTBAR_AKTIONEN: readonly Action[] = ['hotbar1', 'hotbar2', 'hotbar3', 'hotbar4', 'hotbar5', 'hotbar6', 'hotbar7', 'hotbar8', 'hotbar9', 'hotbar10'];
/** Inner width of the wear bar [design px] (inside the slot's 14 px floor). */
const VERSCHLEISS_PX = 12;
/** Index of the off-hand in the equipment area. */
const NEBENHAND = equipmentSlotIndex('nebenhand');
/** Small key digits 1–0 in the slot corner (assets-src/sprites/ui/hud.ts, 5×7; frames 0–9 dim, +10 bright). */
const ZIFFER_SPRITE = 'ui_hud_ziffer';
const ZIFFER_B = 5;
const ZIFFER_H = 7;
const ZIFFER_HELL = 10;
/** A key label drawn with the small digits (other labels – a rebound letter – use the font). */
const EINE_ZIFFER = /^[0-9]$/;
/** Share below which the wear bar is yellow (below `NIEDRIG_ANTEIL` it is red). */
const MITTEL_ANTEIL = 0.5;

/** The device the key glyphs are drawn for (updated by the HUD once per frame). */
export interface HudGeraet {
  readonly gamepad: boolean;
  readonly familie: GamepadFamily;
}

/** Glyph of `action` on the device used last, or `null` when it has no binding there. */
export function aktionsSymbol(bridge: UiBridge, i18n: I18n, action: Action): TastenSymbol | null {
  const input = bridge.input;
  const b = input?.promptBinding(action);
  if (input === null || b === undefined) return null;
  return tastenSymbol(b, input.gamepadFamily, (k, p) => i18n.t(k, p));
}

/** Name of the key of `action` on the device used last (for texts), or `null`. */
export function aktionsName(bridge: UiBridge, i18n: I18n, action: Action): string | null {
  const input = bridge.input;
  const b = input?.promptBinding(action);
  if (input === null || b === undefined) return null;
  return tastenName(b, input.gamepadFamily, (k, p) => i18n.t(k, p));
}

interface HudPlatzProps {
  readonly i18n: I18n;
  readonly stack: ItemStack | null;
  readonly def: ItemDef | undefined;
  readonly label: string;
  readonly aktiv?: boolean;
  /** Key of the slot in its top left corner (hotbar keys 1–0). */
  readonly ziffer?: string | null;
  /** Key glyph above the slot (the belt key over the slot it uses next). */
  readonly marke?: TastenSymbol | null;
  readonly leer?: 'nebenhand' | 'guertel';
  /** The carried light, when it sits in this slot (burn bar instead of wear, its lines in the tooltip). */
  readonly licht?: LightView | null;
  /** Lines the slot adds below the item's (the belt key), read while the tooltip shows. */
  readonly zusatz?: () => readonly HudZeile[];
  /** Name of the light switch key (for the light's tooltip lines). */
  readonly schalter?: string | null;
  /** Tooltip of the empty slot. */
  readonly leerTipp?: () => ReturnType<typeof leerTooltip>;
  readonly tooltip: HudTooltipSlot;
  readonly testId: string;
  readonly onClick?: () => void;
}

/** Wear step of a share: `niedrig` (red), `mittel` (yellow), `hoch`. */
function anteilStufe(anteil: number): 'niedrig' | 'mittel' | 'hoch' {
  return anteil < NIEDRIG_ANTEIL ? 'niedrig' : anteil < MITTEL_ANTEIL ? 'mittel' : 'hoch';
}

function HudPlatz({ i18n, stack, def, label, aktiv, ziffer, marke, leer, licht = null, zusatz, schalter = null, leerTipp, tooltip, testId, onClick }: HudPlatzProps) {
  const maxH = def?.haltbarkeit === undefined || stack === null ? null : maxDurability(def.haltbarkeit, stackQuality(stack));
  const v = verschleiss(stack, def, maxH);
  const kaputt = stack?.haltbarkeit === 0;
  const handler = useHudTooltip(tooltip, () => {
    if (stack === null || def === undefined) return leerTipp?.() ?? null;
    const extra: HudZeile[] = [...(licht === null ? [] : lichtZeilen(i18n, licht, schalter)), ...(zusatz?.() ?? [])];
    return itemTooltip(i18n, stack, def, maxH, `var(${rarityVar(def.raritaet)})`, extra);
  });
  const icon = def === undefined ? null : itemIconUrl(def.id);
  return (
    <Slot
      class={`dh-hud-platz${licht !== null && !licht.lit ? ' dh-hud-platz--aus' : ''}`}
      label={label}
      aktiv={aktiv}
      anzahl={stack?.count}
      tabIndex={-1}
      data-testid={testId}
      data-item={stack?.item}
      data-raritaet={def?.raritaet}
      data-kaputt={kaputt ? '' : undefined}
      data-licht={licht === null ? undefined : licht.lit ? 'an' : 'aus'}
      // A click selects without taking the keyboard focus (Space and Enter stay the game's keys).
      onMouseDown={(e: MouseEvent) => e.preventDefault()}
      onClick={onClick}
      {...handler}
    >
      {stack !== null && def !== undefined ? (
        icon !== null ? (
          <img class="dh-hud-platz__icon" src={icon} alt="" draggable={false} />
        ) : (
          <span class="dh-hud-platz__initiale" aria-hidden="true">
            {def.name[i18n.lang].slice(0, 1)}
          </span>
        )
      ) : leer !== undefined ? (
        <Glyph id={leer === 'nebenhand' ? 'nebenhand' : 'guertel'} class="dh-hud-platz__glyphe" />
      ) : null}
      {licht !== null ? (
        <span class="dh-hud-platz__verschleiss dh-hud-platz__brand" aria-hidden="true" data-testid={`${testId}-brand`}>
          <span style={{ width: uiPx(Math.max(licht.share > 0 ? 1 : 0, Math.round(licht.share * VERSCHLEISS_PX))) }} data-anteil={anteilStufe(licht.share)} />
        </span>
      ) : v !== null && !kaputt ? (
        <span class="dh-hud-platz__verschleiss" aria-hidden="true">
          <span style={{ width: uiPx(Math.max(1, Math.round(v.anteil * VERSCHLEISS_PX))) }} data-anteil={anteilStufe(v.anteil)} />
        </span>
      ) : null}
      {ziffer !== undefined && ziffer !== null ? (
        EINE_ZIFFER.test(ziffer) ? (
          <HudBild id={ZIFFER_SPRITE} frame={Number(ziffer) + (aktiv === true ? ZIFFER_HELL : 0)} breite={ZIFFER_B} hoehe={ZIFFER_H} class="dh-hud-platz__ziffer dh-hud-platz__ziffer--bild" />
        ) : (
          <span class="dh-hud-platz__ziffer" aria-hidden="true">
            {ziffer}
          </span>
        )
      ) : null}
      {marke !== undefined && marke !== null ? (
        <span class="dh-hud-platz__marke" data-testid={`${testId}-taste`}>
          <HudTaste symbol={marke} />
        </span>
      ) : null}
    </Slot>
  );
}

/** Whether the carried light `licht` sits in slot `ref`. */
function lichtIn(licht: LightView | null, bereich: SlotRef['bereich'], index: number): LightView | null {
  return licht !== null && licht.slot.bereich === bereich && licht.slot.index === index ? licht : null;
}

export interface HudSchnellleisteProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly stufe: ReadonlySignal<number>;
  readonly geraet: ReadonlySignal<HudGeraet>;
  readonly tooltip: HudTooltipSlot;
  readonly catalog?: ItemCatalog;
}

/** Index of the belt slot the belt key uses next (the first filled one), or −1. */
export function naechsterGuertelPlatz(bags: BagsState): number {
  return bags.guertel.findIndex((s) => s !== null);
}

export function HudSchnellleiste({ i18n, bridge, stufe, geraet, tooltip, catalog = contentItemCatalog() }: HudSchnellleisteProps) {
  const bags = bridge.state.bags.value;
  const s = stufe.value;
  const g = geraet.value;
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (el === null || host === null || host === undefined) return;
    const place = (): void => {
      el.style.left = `${snapCentre(host.clientWidth, el.offsetWidth, designPixel(el))}px`;
    };
    place();
    const obs = new ResizeObserver(place);
    obs.observe(host);
    obs.observe(el);
    return () => obs.disconnect();
  }, [bags === null, s === 0]);
  if (bags === null || s === 0) return null;
  const defOf = (st: ItemStack | null): ItemDef | undefined => (st === null ? undefined : catalog.find(st.item));
  const nebenhand = bags.ausruestung[NEBENHAND] ?? null;
  const naechster = naechsterGuertelPlatz(bags);
  const guertelTaste = aktionsSymbol(bridge, i18n, 'belt');
  const guertelName = aktionsName(bridge, i18n, 'belt');
  const schalter = aktionsName(bridge, i18n, 'toggleLight');
  const licht = bridge.state.hud.light.value;
  const nebenhandLicht = lichtIn(licht, 'ausruestung', NEBENHAND);
  // The light's state belongs to the slot's name for screen readers ("Nebenhand: Fackel, brennt noch 3 min 12 s").
  const mitLicht = (name: string, l: LightView | null): string => (l === null ? name : i18n.t('ui.hud.licht.label', { platz: name, zustand: lichtZeilen(i18n, l, schalter)[0]?.text ?? '' }));
  const zurueck = g.gamepad ? aktionsSymbol(bridge, i18n, 'hotbarPrev') : null;
  const weiter = g.gamepad ? aktionsSymbol(bridge, i18n, 'hotbarNext') : null;
  return (
    <div ref={ref} class="dh-hud-unten" data-stufe={String(s)} data-testid="hud-schnellleiste" data-auswahl={bags.auswahl}>
      <HudPlatz
        i18n={i18n}
        stack={nebenhand}
        def={defOf(nebenhand)}
        label={nebenhand === null ? i18n.t('ui.hud.nebenhand.leer') : mitLicht(i18n.t('ui.hud.nebenhand.platz', { item: defOf(nebenhand)?.name[i18n.lang] ?? nebenhand.item }), nebenhandLicht)}
        leer="nebenhand"
        licht={nebenhandLicht}
        schalter={schalter}
        leerTipp={() => leerTooltip(i18n, 'nebenhand', aktionsName(bridge, i18n, 'inventory'), null)}
        tooltip={tooltip}
        testId="hud-nebenhand"
      />
      <div class="dh-hud-unten__leiste" role="group" aria-label={i18n.t('ui.hud.schnellleiste.label')}>
        {zurueck !== null ? (
          <span class="dh-hud-unten__blaettern" aria-label={i18n.t('ui.hud.schnellleiste.zurueck', { taste: aktionsName(bridge, i18n, 'hotbarPrev') ?? '' })} role="img">
            <HudTaste symbol={zurueck} />
          </span>
        ) : null}
        {bags.schnellleiste.map((st, i) => {
          const def = defOf(st);
          const nummer = String((i + 1) % HOTBAR_AKTIONEN.length);
          const taste = g.gamepad ? null : aktionsSymbol(bridge, i18n, HOTBAR_AKTIONEN[i] as Action);
          const ziffer = taste === null ? null : taste.art === 'kappe' ? taste.text : taste.name;
          const l = lichtIn(licht, 'schnellleiste', i);
          return (
            <HudPlatz
              key={i}
              i18n={i18n}
              stack={st}
              def={def}
              label={mitLicht(platzLabel(i18n, 'schnellleiste', ziffer ?? nummer, st, def), l)}
              aktiv={i === bags.auswahl}
              ziffer={ziffer}
              licht={l}
              schalter={schalter}
              tooltip={tooltip}
              testId={`hud-schnellleiste-${i}`}
              onClick={() => bridge.actions.inventory.select(i)}
            />
          );
        })}
        {weiter !== null ? (
          <span class="dh-hud-unten__blaettern" aria-label={i18n.t('ui.hud.schnellleiste.weiter', { taste: aktionsName(bridge, i18n, 'hotbarNext') ?? '' })} role="img">
            <HudTaste symbol={weiter} />
          </span>
        ) : null}
      </div>
      <div class="dh-hud-unten__guertel" role="group" aria-label={i18n.t('ui.hud.guertel.label')}>
        {bags.guertel.map((st, i) => {
          const def = defOf(st);
          return (
            <HudPlatz
              key={i}
              i18n={i18n}
              stack={st}
              def={def}
              label={platzLabel(i18n, 'guertel', String(i + 1), st, def)}
              marke={i === naechster ? guertelTaste : null}
              leer="guertel"
              zusatz={() => (i === naechster && guertelName !== null && def !== undefined ? [guertelZeile(i18n, guertelName, def)] : [])}
              leerTipp={() => leerTooltip(i18n, 'guertel', null, guertelName)}
              tooltip={tooltip}
              testId={`hud-guertel-${i}`}
            />
          );
        })}
      </div>
    </div>
  );
}
