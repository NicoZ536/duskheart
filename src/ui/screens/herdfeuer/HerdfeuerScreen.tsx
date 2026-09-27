/**
 * The hearth screen (MASTERPROMPT §16.5 "Herdfeuer (Basiskern): … Radius 12 Tiles, mit Glutkernen … bis 40 Tiles
 * aufrüstbar. Brennstoff: Holzscheite (1 je Spielstunde), Holzkohle (1 je 3 h) …; Vorratsfach 40. Solange es brennt:
 * … Lagerübersicht aller Kisten, Wiedereinstiegspunkt …", §16.7 "Suche über alle Kisten der Basis", §26; M4-20):
 * opens when the player opens a hearth (E "Öffnen", the simulation's `hearthOpened`) and closes with Esc/B, when the
 * hearth is taken down or the player no longer stands within its reach. The world keeps running.
 *
 * Three panels:
 * - **The hearth**: its picture (the ring with its flames and the cores set in their sockets), whether it burns and
 *   the game time its fire lasts ("Brennt noch 5 h 20 min"), the glow of the piece in the fire, "Entzünden" /
 *   "Löschen"; the fuel store – its 40 places as a gauge in burn order and its stacks (click: back into the bags) –;
 *   the protected radius (12 … 40 fields) and the respawn point ("Am Herdfeuer erwachen" while it burns); the ember
 *   core niches – a set core comes out on click, a core in the bags goes into its niche, the others are locked with
 *   the hint that the beacons give the cores. Only niches whose core item exists in the content show: while there are
 *   none (the beacons bring them, M7) the panel has no niche section (§2.1, Review M4 #18).
 * - **The bags**: what the hearth burns (and ember cores) is bright, the rest dim; click puts the stack into the
 *   store, right click half of it.
 * - **The overview of the base** (parchment, while it burns): every chest in its radius with name or label, fill
 *   and distance; the search over their contents (item names, German or English); a chest or find chosen shows the
 *   chest's slots.
 *
 * Tooltips for every stack and niche (pointer or focus frame). Keyboard/controller: confirm = click, prev (Q, LB) =
 * right click, back closes. Reads the bridge and the session's hearth sample, sends hearth commands only; a refusal
 * shows in the hint line.
 */
import { useComputed, useSignal } from '@preact/signals';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { BALANCE } from '../../../content/balance';
import type { ItemDef } from '../../../content/schema/item';
import { PALETTE_HEX, PALETTE_RAMPS } from '../../../generated/palette';
import { UI_GRAFIKEN } from '../../../generated/ui';
import { HEARTH_ITEM } from '../../../game/hearth/system';
import type { BagsState } from '../../../game/inventory/bags';
import { contentItemCatalog, type ItemCatalog } from '../../../game/items/catalog';
import type { ItemStack } from '../../../game/items/stack';
import type { SlotRef } from '../../../game/items/slots';
import type { I18n } from '../../../i18n';
import { generatedAtlasModule } from '../../../render/assets/generated';
import { paletteRefHex } from '../../../render/palette/rows';
import type { UiBridge } from '../../bridge';
import { ScreenLayer } from '../../focus/Layer';
import type { FocusElement, FocusManager, NavAction } from '../../focus/manager';
import { actionPrompt, usesGamepad } from '../../focus/prompts';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { Button, Frame, ScrollArea, Slot, uiPx } from '../../kit';
import { contentItemLookup, itemTooltip, ItemTooltip, type ItemTooltipModel } from '../../tooltip';
import { Zeichen } from '../handwerk/glyphen';
import { Fortschritt, Hinweiszeile, ItemBild, werkstattTokens } from '../handwerk/teile';
import { ensureAtlasImages, spriteImageUrl } from '../inventar/itemIcons';
import { parseSlotKey, slotKey, stackAt } from '../inventar/model';
import { useHerdQuelle, type BasisKiste, type HerdAnsicht, type UebersichtAnsicht } from './ansicht';
import { HerdZeichen } from './glyphen';
import { brennstunden, fundZeilen, herdAblehnung, herdNimmt, herdStatus, istHerdBrennstoff, kistenTitel, nischen, radiusMax, suchItems, vorratsSegmente, type Nische } from './modell';
import '../handwerk/handwerk.css';
import '../station/station.css';
import './herdfeuer.css';

/** Id of the hearth screen in the screen stack (src/ui/focus/GameScreens.tsx). */
export const HERD_SCREEN = 'herdfeuer';

/** Bag areas the screen lists (the belt stays on the belt, equipment is worn). */
const TASCHEN: ReadonlyArray<'inventar' | 'rucksackfach' | 'schnellleiste'> = ['inventar', 'rucksackfach', 'schnellleiste'];
/** The hearth's sprite, its clips and the core set into a socket (src/generated/atlas.ts). */
const HERD_SPRITE = 'obj_herdfeuer';
const KERN_SPRITE = 'obj_herdfeuer_glutkern';
/** Anchor of the core sprite (its point on the socket) [px]. */
const KERN_ANKER = [4, 6] as const;
/** Ticks per second of the simulation: the picture's flames follow game time (still while it is paused or frozen). */
const TICK_HZ = BALANCE.time.tickHz;
/** A row of slots: 20 px and the 1 px gap [design px]. */
const SLOT_ZEILE = 21;
/** Width of the glow bar [design px]. */
const GLUT_BALKEN = 44;
/** Compartments of the store row shown even when empty (one row of the six-column grid). */
const VORRAT_FAECHER = 6;
/** Heights of the scroll areas [design px]: the bags, the chest list, a chest's contents (four rows). */
const TASCHEN_HOEHE = 196;
const LISTE_HOEHE = 76;
const INHALT_HOEHE = 83;

/** Colour tokens: the tooltips' and recipe screens', plus the gauge's wood, charcoal and fire (palette references). */
function herdTokens(): Record<string, string> {
  const ref = (r: string): string => paletteRefHex(r, PALETTE_RAMPS, PALETTE_HEX);
  return { ...werkstattTokens(), '--dh-hf-holz': ref('holz.3'), '--dh-hf-holz-licht': ref('holz.4'), '--dh-hf-kohle': ref('stein.1'), '--dh-hf-kohle-licht': ref('stein.2'), '--dh-hf-feuer': ref('feuer.3') };
}
const TOKENS = herdTokens();

export interface HerdfeuerScreenProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly focus: FocusManager;
  /** Id of the hearth (`hearthOpened.hearth`). */
  readonly herd: number;
  readonly close: () => void;
  readonly catalog?: ItemCatalog;
}

export function HerdfeuerScreen({ i18n, bridge, focus, herd, close, catalog = contentItemCatalog() }: HerdfeuerScreenProps) {
  const lang = i18n.lang;
  const quelle = useHerdQuelle(bridge, herd);
  const ansicht = quelle?.herd.value ?? null;
  const weg = ansicht !== null && (!ansicht.vorhanden || !ansicht.inReichweite);
  useEffect(() => ensureAtlasImages(), []);
  useEffect(() => {
    if (weg) close();
  }, [weg, close]);
  if (quelle === null || ansicht === null || !ansicht.vorhanden || weg) return null;
  const name = catalog.get(HEARTH_ITEM).name[lang];
  return (
    <ScreenLayer focus={focus} label={name} testId="ui-herdfeuer" overlay={<HerdTooltip i18n={i18n} bridge={bridge} focus={focus} ansicht={ansicht} uebersicht={quelle.uebersicht.value} catalog={catalog} />}>
      <HerdInhalt i18n={i18n} bridge={bridge} focus={focus} ansicht={ansicht} uebersicht={quelle.uebersicht.value} suchen={quelle.suchen} name={name} close={close} catalog={catalog} />
    </ScreenLayer>
  );
}

interface InhaltProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly focus: FocusManager;
  readonly ansicht: HerdAnsicht;
  readonly uebersicht: UebersichtAnsicht | null;
  readonly suchen: (items: ReadonlySet<string> | null) => void;
  readonly name: string;
  readonly close: () => void;
  readonly catalog: ItemCatalog;
}

function HerdInhalt({ i18n, bridge, focus, ansicht, uebersicht, suchen, name, close, catalog }: InhaltProps) {
  const t = i18n.t;
  const lang = i18n.lang;
  const root = useRef<HTMLDivElement>(null);
  const bags = bridge.state.bags.value;
  const keys = focus.keys.value;
  const openedTick = useMemo(() => bridge.state.tick.peek(), [bridge]);
  const rejection = bridge.state.lastRejection.value;
  const id = ansicht.id;

  const defOf = (s: ItemStack | null | undefined): ItemDef | undefined => (s === null || s === undefined ? undefined : catalog.find(s.item));
  const einlegen = (from: SlotRef, haelfte: boolean): void => {
    const s = bags === null ? null : stackAt(bags, from);
    if (s === null) return;
    const kern = BALANCE.hearth.coreItems.indexOf(s.item);
    if (kern >= 0) bridge.actions.hearth.core(id, from);
    else bridge.actions.hearth.fuel(id, from, haelfte ? Math.ceil(s.count / 2) : undefined);
  };
  const nehmen = (index: number, haelfte: boolean): void => {
    const s = ansicht.vorrat[index];
    if (s !== undefined) bridge.actions.hearth.take(id, index, haelfte ? Math.ceil(s.count / 2) : undefined);
  };

  useFocusScope(focus, root, {
    initial: () =>
      focusable(root, '[data-slot][data-brennstoff]:not([data-leer])') ?? focusable(root, '[data-testid="herd-schalter"]:not([disabled])') ?? focusable(root, '[data-vorrat]') ?? focusable(root, '[data-slot]'),
    onAction(action: NavAction, focused: FocusElement | null): boolean {
      if (action !== 'prev' || !(focused instanceof HTMLElement)) return false;
      const from = parseSlotKey(focused.getAttribute('data-slot'));
      if (from !== null) {
        einlegen(from, true);
        return true;
      }
      const index = Number(focused.getAttribute('data-vorrat'));
      if (focused.hasAttribute('data-vorrat') && Number.isInteger(index)) {
        nehmen(index, true);
        return true;
      }
      return false;
    },
    onBack: close,
  });

  const lastRefusal = rejection !== null && rejection.tick >= openedTick && rejection.type.startsWith('hearth.') ? herdAblehnung(i18n, rejection.reason) : null;
  const pad = usesGamepad(bridge.input);
  const prompt = (action: Parameters<typeof actionPrompt>[2]): string => actionPrompt(i18n, bridge.input, action) ?? '-';
  const hint = keys || pad ? t('ui.herdfeuer.hinweis.tasten', { waehlen: prompt('uiConfirm'), haelfte: prompt('uiTabPrev'), schliessen: prompt('uiBack') }) : t('ui.herdfeuer.hinweis.maus');

  return (
    <div ref={root} class="dh-hf" style={TOKENS} data-testid="herdfeuer" data-herd={id} data-brennt={ansicht.brennt ? '' : undefined}>
      <HerdTafel i18n={i18n} bridge={bridge} ansicht={ansicht} name={name} nehmen={nehmen} einlegen={einlegen} defOf={defOf} catalog={catalog} />
      <Frame art="holz" class="dh-hw__tafel dh-hf__tafel--taschen" data-testid="herd-taschen">
        <h2 class="dh-hw__titel">{t('ui.station.taschen')}</h2>
        <ScrollArea height={TASCHEN_HOEHE} labelHoch={t('ui.kit.scroll.hoch')} labelRunter={t('ui.kit.scroll.runter')} class="dh-st__taschen">
          {bags === null
            ? null
            : TASCHEN.filter((area) => bags[area].length > 0).map((area) => (
                <section key={area} class="dh-st__bereich">
                  <h3 class="dh-st__unter">{t(`ui.inventory.bereich.${area}`)}</h3>
                  <div class="dh-st__raster">
                    {bags[area].map((stack, index) => {
                      const at: SlotRef = { bereich: area, index };
                      const def = defOf(stack);
                      const passt = stack !== null && herdNimmt(stack.item);
                      return (
                        <Slot
                          key={slotKey(at)}
                          class={passt || stack === null ? 'dh-st__slot' : 'dh-st__slot dh-st__slot--passt-nicht'}
                          label={stack === null || def === undefined ? t('ui.inventory.leer', { platz: t(`ui.inventory.bereich.${area}`) }) : t('ui.inventory.stapel', { item: def.name[lang], anzahl: stack.count })}
                          anzahl={stack?.count}
                          data-fokus=""
                          data-slot={slotKey(at)}
                          data-tip={stack === null ? undefined : `tasche:${slotKey(at)}`}
                          data-testid={`herd-tasche-${area}-${index}`}
                          data-item={stack?.item}
                          data-brennstoff={passt ? '' : undefined}
                          data-leer={stack === null ? '' : undefined}
                          onClick={() => einlegen(at, false)}
                          onContextMenu={(e: MouseEvent) => {
                            e.preventDefault();
                            einlegen(at, true);
                          }}
                        >
                          {stack !== null && def !== undefined ? <ItemBild item={def.id} name={def.name[lang]} /> : null}
                        </Slot>
                      );
                    })}
                  </div>
                </section>
              ))}
        </ScrollArea>
      </Frame>
      <UebersichtTafel i18n={i18n} ansicht={ansicht} uebersicht={uebersicht} suchen={suchen} catalog={catalog} focus={focus} />
      <Hinweiszeile text={lastRefusal ?? hint} fehler={lastRefusal !== null} testId="herd-hinweis" />
    </div>
  );
}

/**
 * The hearth's picture: the ring with its flames (clip `brennt`, frames following game time – still while the game
 * is paused or frozen) or cold (`aus`), and the ember cores set into their sockets. Re-renders only when the shown
 * frame changes.
 */
function HerdBild({ bridge, brennt, kerne }: { readonly bridge: UiBridge; readonly brennt: boolean; readonly kerne: readonly (string | null)[] }) {
  const frame = useComputed(() => {
    const clip = generatedAtlasModule()?.SPRITES[HERD_SPRITE]?.clips[brennt ? 'brennt' : 'aus'];
    if (clip === undefined || clip.frames.length === 0) return 0;
    const step = Math.max(1, Math.round(TICK_HZ / Math.max(1, clip.fps)));
    return clip.frames[Math.floor(bridge.state.tick.value / step) % clip.frames.length] ?? 0;
  });
  const bild = spriteImageUrl(HERD_SPRITE, frame.value);
  const kernBild = spriteImageUrl(KERN_SPRITE, 0);
  return (
    <div class="dh-hf__bild" aria-hidden="true" data-testid="herd-bild" data-bild={brennt ? 'brennt' : 'aus'}>
      {bild !== null ? <img src={bild} alt="" draggable={false} /> : null}
      {kernBild !== null
        ? kerne.map((k, i) => {
            const p = k === null ? null : kernSockel(i);
            return p === null ? null : <img key={i} class="dh-hf__kern-bild" src={kernBild} alt="" draggable={false} style={{ left: uiPx(p[0] - KERN_ANKER[0]), top: uiPx(p[1] - KERN_ANKER[1]) }} />;
          })
        : null}
    </div>
  );
}

/** Where the cores sit in the picture: the sprite's sockets `glutkern_1` … `_6` [px of the 48 × 48 cell]. */
function kernSockel(index: number): readonly [number, number] | null {
  const s = generatedAtlasModule()?.SPRITES[HERD_SPRITE]?.sockets[`glutkern_${index + 1}`];
  const p = s?.[0];
  return p === undefined ? null : [p[0], p[1]];
}

interface HerdTafelProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly ansicht: HerdAnsicht;
  readonly name: string;
  readonly nehmen: (index: number, haelfte: boolean) => void;
  readonly einlegen: (from: SlotRef, haelfte: boolean) => void;
  readonly defOf: (s: ItemStack | null | undefined) => ItemDef | undefined;
  /** The items (which ember cores exist). */
  readonly catalog: ItemCatalog;
}

/** The hearth panel: picture and fire, store, radius and respawn, niches. */
function HerdTafel({ i18n, bridge, ansicht, name, nehmen, einlegen, defOf, catalog }: HerdTafelProps) {
  const t = i18n.t;
  const lang = i18n.lang;
  const id = ansicht.id;
  const status = herdStatus(i18n, ansicht);
  const segmente = vorratsSegmente(ansicht.vorrat);
  const kannEntzuenden = !ansicht.brennt && (ansicht.stueck > 0 || ansicht.glut > 0);
  // Only niches whose ember core exists in the content: none yet (the beacons bring them) – no niche section at all.
  const liste = nischen(ansicht.kerne, bridge.state.bags.value, catalog);
  const gesetzt = liste.filter((n) => n.zustand === 'gesetzt').length;
  const alleGesperrt = liste.every((n) => n.zustand === 'gesperrt');

  return (
    <Frame art="holz" class="dh-hw__tafel dh-hf__tafel--herd" data-testid="herd-tafel">
      <h2 class="dh-hw__titel">{name}</h2>
      <div class="dh-hf__feuer">
        <HerdBild bridge={bridge} brennt={ansicht.brennt} kerne={ansicht.kerne} />
        <div class="dh-hf__zustand" data-testid="herd-status" data-ton={status.ton} aria-label={status.text} role="status">
          <span class={`dh-hf__zustand-titel dh-hf__zustand-titel--${status.ton}`}>{status.titel}</span>
          <span class={`dh-hf__zustand-detail dh-hf__zustand-detail--${status.ton}`} data-testid="herd-restzeit">
            {status.detail}
          </span>
          <span class="dh-hf__glut" data-glueht={ansicht.brennt ? '' : undefined}>
            <Zeichen id="flamme" />
            <Fortschritt anteil={ansicht.glut} breite={GLUT_BALKEN} art="glut" label={t('ui.herdfeuer.glut')} />
          </span>
          <Button
            class="dh-hf__schalter"
            data-fokus=""
            data-testid="herd-schalter"
            disabled={!ansicht.brennt && !kannEntzuenden}
            onClick={() => (ansicht.brennt ? bridge.actions.hearth.douse(id) : bridge.actions.hearth.ignite(id))}
          >
            {t(ansicht.brennt ? 'ui.herdfeuer.loeschen' : 'ui.herdfeuer.entzuenden')}
          </Button>
        </div>
      </div>
      <div class="dh-hf__zeile">
        <span class="dh-hf__unter">{t('ui.herdfeuer.vorrat')}</span>
        <span class="dh-hf__zahl" data-testid="herd-vorrat-stueck">
          {t('ui.herdfeuer.vorrat.stueck', { stueck: ansicht.stueck, max: BALANCE.hearth.storePieces })}
        </span>
      </div>
      <div class="dh-hf__messer" role="meter" aria-label={t('ui.herdfeuer.vorrat.stueck', { stueck: ansicht.stueck, max: BALANCE.hearth.storePieces })} aria-valuemin={0} aria-valuemax={BALANCE.hearth.storePieces} aria-valuenow={ansicht.stueck}>
        {segmente.map((item, i) => (
          <span key={i} class={item === null ? 'dh-hf__segment' : `dh-hf__segment dh-hf__segment--${item === 'holzkohle' ? 'kohle' : 'holz'}`} />
        ))}
      </div>
      <div class="dh-st__raster dh-hf__vorrat" data-testid="herd-vorrat">
        {ansicht.vorrat.map((s, index) => {
          const def = defOf(s);
          const label = def === undefined ? s.item : t('ui.herdfeuer.vorrat.stapel', { item: def.name[lang], anzahl: s.count, stunden: brennstunden(s.item) * s.count });
          return (
            <Slot
              key={index}
              class="dh-st__slot dh-hf__vorrat-slot"
              label={label}
              anzahl={s.count}
              data-fokus=""
              data-vorrat={index}
              data-tip={`vorrat:${index}`}
              data-testid={`herd-vorrat-${index}`}
              data-item={s.item}
              onClick={() => nehmen(index, false)}
              onContextMenu={(e: MouseEvent) => {
                e.preventDefault();
                nehmen(index, true);
              }}
            >
              {def !== undefined ? <ItemBild item={def.id} name={def.name[lang]} /> : null}
            </Slot>
          );
        })}
        {Array.from({ length: Math.max(0, VORRAT_FAECHER - ansicht.vorrat.length) }, (_, i) => (
          <span key={`frei-${i}`} class={`dh-slot ${UI_GRAFIKEN.slot.klasse} dh-st__slot dh-hf__fach`} role="img" aria-label={t('ui.herdfeuer.vorrat.leer')} data-testid="herd-vorrat-frei">
            <Zeichen id="flamme" class="dh-st__leer-symbol" />
          </span>
        ))}
      </div>
      <p class="dh-hf__info" data-testid="herd-radius">
        <HerdZeichen id="schild" class={ansicht.brennt ? 'dh-hf__info-symbol dh-hf__info-symbol--an' : 'dh-hf__info-symbol'} />
        <span>{t(ansicht.brennt ? 'ui.herdfeuer.radius.an' : 'ui.herdfeuer.radius.aus', { radius: ansicht.radius, max: radiusMax() })}</span>
      </p>
      <p class="dh-hf__info" data-testid="herd-wiedereinstieg">
        <HerdZeichen id="erwachen" class={ansicht.brennt ? 'dh-hf__info-symbol dh-hf__info-symbol--an' : 'dh-hf__info-symbol'} />
        <span>{t(ansicht.brennt ? 'ui.herdfeuer.wiedereinstieg.an' : 'ui.herdfeuer.wiedereinstieg.aus')}</span>
      </p>
      {liste.length > 0 ? (
        <>
          <div class="dh-hf__zeile" data-testid="herd-kerne">
            <span class="dh-hf__unter">{t('ui.herdfeuer.kerne')}</span>
            <span class="dh-hf__zahl">{t('ui.herdfeuer.kerne.anzahl', { gesetzt, max: liste.length, radius: radiusMax() })}</span>
          </div>
          <div class="dh-hf__nischen" data-testid="herd-nischen">
            {liste.map((n) => (
              <NischenSlot key={n.index} i18n={i18n} nische={n} onClick={() => (n.zustand === 'gesetzt' ? bridge.actions.hearth.uncore(id, n.index) : n.ausBeutel !== null ? einlegen(n.ausBeutel, false) : undefined)} />
            ))}
          </div>
          {alleGesperrt ? (
            <p class="dh-hf__nischen-hinweis" data-testid="herd-nischen-hinweis">
              {t('ui.herdfeuer.kerne.hinweis')}
            </p>
          ) : null}
        </>
      ) : null}
    </Frame>
  );
}

/** One ember core niche: the core set in it, its core ready in the bags, or locked (the core's outline and a lock). */
function NischenSlot({ i18n, nische, onClick }: { readonly i18n: I18n; readonly nische: Nische; readonly onClick: () => void }) {
  const url = spriteImageUrl(`icon_${nische.kern}`);
  return (
    <Slot
      class={`dh-st__slot dh-hf__nische dh-hf__nische--${nische.zustand}`}
      label={i18n.t(`ui.herdfeuer.nische.${nische.zustand}`, { n: nische.index + 1 })}
      data-fokus=""
      data-nische={nische.index}
      data-nischen-zustand={nische.zustand}
      data-tip={`nische:${nische.index}`}
      data-testid={`herd-nische-${nische.index}`}
      onClick={onClick}
    >
      {url !== null ? <img class="dh-hw__icon dh-hf__nische-bild" src={url} alt="" draggable={false} /> : null}
      {nische.zustand === 'gesperrt' ? <HerdZeichen id="schloss" class="dh-hf__schloss" /> : null}
    </Slot>
  );
}

interface UebersichtProps {
  readonly i18n: I18n;
  readonly ansicht: HerdAnsicht;
  readonly uebersicht: UebersichtAnsicht | null;
  readonly suchen: (items: ReadonlySet<string> | null) => void;
  readonly catalog: ItemCatalog;
  readonly focus: FocusManager;
}

/** The overview of the base (parchment): search, chests, the chosen chest's slots or the finds. */
function UebersichtTafel({ i18n, ansicht, uebersicht, suchen, catalog, focus }: UebersichtProps) {
  const t = i18n.t;
  const lang = i18n.lang;
  const text = useSignal('');
  const gewaehlt = useSignal<number | null>(null);
  const feld = useRef<HTMLInputElement>(null);
  const liste = useRef<HTMLDivElement>(null);
  const items = useMemo(() => catalog.ids().map((i) => catalog.get(i)), [catalog]);
  const suchSet = useMemo(() => suchItems(text.value, items, lang), [text.value, items, lang]);
  useEffect(() => suchen(suchSet), [suchen, suchSet]);

  const kisten = uebersicht?.kisten ?? [];
  const kiste = kisten.find((k) => k.id === gewaehlt.value) ?? null;
  const funde = suchSet === null ? [] : fundZeilen(uebersicht?.treffer ?? []);
  const titelVon = (k: BasisKiste): string => kistenTitel(k, catalog.find(k.item), lang);
  const verlassen = (): void => {
    feld.current?.blur();
    const first = liste.current?.querySelector('[data-fokus]');
    if (first instanceof HTMLElement) {
      focus.keysUsed();
      focus.focus(first as unknown as FocusElement);
    }
  };

  return (
    <Frame art="pergament" class="dh-hw__tafel dh-hf__tafel--uebersicht" data-testid="herd-uebersicht" data-gezeigt={uebersicht?.gezeigt === true ? '' : undefined}>
      <h2 class="dh-hw__titel dh-st__titel-pergament">{t('ui.herdfeuer.uebersicht')}</h2>
      {uebersicht === null || !uebersicht.gezeigt ? (
        <p class="dh-hf__erklaerung" data-testid="herd-uebersicht-aus">
          {t('ui.herdfeuer.uebersicht.aus')}
        </p>
      ) : (
        <>
          <label class="dh-hw__suche dh-hf__suche">
            <Zeichen id="lupe" class="dh-hw__suche-symbol" />
            <input
              ref={feld}
              class="dh-hw__suchfeld dh-hf__suchfeld"
              type="text"
              value={text.value}
              placeholder={t('ui.herdfeuer.suche.platzhalter')}
              aria-label={t('ui.herdfeuer.suche')}
              spellcheck={false}
              autocomplete="off"
              data-fokus=""
              data-testid="herd-suche"
              onInput={(e) => {
                text.value = (e.currentTarget as HTMLInputElement).value;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') {
                  e.preventDefault();
                  if (e.key === 'Escape') text.value = '';
                  verlassen();
                }
              }}
            />
          </label>
          <p class="dh-hf__unter-pergament" data-testid="herd-kisten-zahl">
            {suchSet === null ? t('ui.herdfeuer.kisten', { count: kisten.length, radius: ansicht.radius }) : t('ui.herdfeuer.funde', { count: funde.length })}
          </p>
          <ScrollArea height={LISTE_HOEHE} labelHoch={t('ui.kit.scroll.hoch')} labelRunter={t('ui.kit.scroll.runter')} class="dh-hf__liste">
            <div ref={liste} role="listbox" aria-label={t('ui.herdfeuer.uebersicht')}>
              {suchSet === null ? (
                kisten.length === 0 ? (
                  <p class="dh-hf__erklaerung" data-testid="herd-keine-kisten">
                    {t('ui.herdfeuer.kisten.keine', { radius: ansicht.radius })}
                  </p>
                ) : (
                  kisten.map((k) => {
                    const titel = titelVon(k);
                    const bild = k.label ?? k.item;
                    return (
                      <button
                        type="button"
                        key={k.id}
                        class={`dh-hf__eintrag${gewaehlt.value === k.id ? ' dh-hf__eintrag--gewaehlt' : ''}`}
                        aria-pressed={gewaehlt.value === k.id}
                        aria-label={t('ui.herdfeuer.kiste.label', { name: titel, belegt: k.belegt, max: k.plaetze, entfernung: k.entfernung })}
                        data-fokus=""
                        data-kiste={k.id}
                        data-testid={`herd-kiste-${k.id}`}
                        onClick={() => {
                          gewaehlt.value = gewaehlt.peek() === k.id ? null : k.id;
                        }}
                      >
                        <ItemBild item={bild} name={titel} />
                        <span class="dh-hf__eintrag-name">{titel}</span>
                        <span class="dh-hf__eintrag-zahl">
                          {k.belegt}/{k.plaetze}
                        </span>
                      </button>
                    );
                  })
                )
              ) : funde.length === 0 ? (
                <p class="dh-hf__erklaerung" data-testid="herd-keine-funde">
                  {t('ui.herdfeuer.funde.keine', { text: text.value.trim() })}
                </p>
              ) : (
                funde.map((f) => {
                  const k = kisten.find((x) => x.id === f.kiste);
                  const def = catalog.find(f.item);
                  const itemName = def?.name[lang] ?? f.item;
                  const ort = k === undefined ? '' : titelVon(k);
                  return (
                    <button
                      type="button"
                      key={`${f.kiste}:${f.item}`}
                      class={`dh-hf__eintrag${gewaehlt.value === f.kiste ? ' dh-hf__eintrag--gewaehlt' : ''}`}
                      aria-pressed={gewaehlt.value === f.kiste}
                      aria-label={t('ui.herdfeuer.fund', { anzahl: f.anzahl, item: itemName, kiste: ort })}
                      data-fokus=""
                      data-kiste={f.kiste}
                      data-tip={`fund:${f.item}`}
                      data-testid={`herd-fund-${f.kiste}-${f.item}`}
                      onClick={() => {
                        gewaehlt.value = f.kiste;
                      }}
                    >
                      <ItemBild item={f.item} name={itemName} />
                      <span class="dh-hf__eintrag-text">
                        <span class="dh-hf__eintrag-name">{t('ui.herdfeuer.fund.menge', { anzahl: f.anzahl, item: itemName })}</span>
                        <span class="dh-hf__eintrag-ort">{ort}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>
          {kiste !== null ? <KistenInhalt i18n={i18n} kiste={kiste} titel={titelVon(kiste)} catalog={catalog} hervor={suchSet} /> : <p class="dh-hf__erklaerung dh-hf__erklaerung--klein">{t('ui.herdfeuer.kiste.waehlen')}</p>}
        </>
      )}
    </Frame>
  );
}

/** The slots of a chest of the overview (to look at: the chest stays where it stands). */
function KistenInhalt({ i18n, kiste, titel, catalog, hervor }: { readonly i18n: I18n; readonly kiste: BasisKiste; readonly titel: string; readonly catalog: ItemCatalog; readonly hervor: ReadonlySet<string> | null }) {
  const t = i18n.t;
  const lang = i18n.lang;
  return (
    <section class="dh-hf__inhalt" data-testid="herd-kiste-inhalt" data-kiste={kiste.id}>
      <p class="dh-hf__inhalt-kopf">
        <span class="dh-hf__eintrag-name">{titel}</span>
        <span class="dh-hf__eintrag-zahl">{t('ui.herdfeuer.kiste.entfernung', { felder: kiste.entfernung })}</span>
      </p>
      <ScrollArea height={INHALT_HOEHE} zeile={SLOT_ZEILE} labelHoch={t('ui.kit.scroll.hoch')} labelRunter={t('ui.kit.scroll.runter')} class="dh-hf__inhalt-raster">
        <div class="dh-st__raster">
          {kiste.slots.map((s, index) => {
            const def = s === null ? undefined : catalog.find(s.item);
            const treffer = s !== null && hervor !== null && hervor.has(s.item);
            return (
              <Slot
                key={index}
                class={`dh-st__slot dh-hf__kisten-slot${treffer ? ' dh-hf__kisten-slot--treffer' : ''}`}
                label={s === null || def === undefined ? t('ui.inventory.leer', { platz: titel }) : t('ui.inventory.stapel', { item: def.name[lang], anzahl: s.count })}
                anzahl={s?.count}
                data-fokus={s === null ? undefined : ''}
                data-tip={s === null ? undefined : `kiste:${kiste.id}:${index}`}
                data-testid={`herd-kiste-slot-${index}`}
                data-item={s?.item}
                data-leer={s === null ? '' : undefined}
                tabIndex={s === null ? -1 : undefined}
              >
                {s !== null && def !== undefined ? <ItemBild item={def.id} name={def.name[lang]} /> : null}
              </Slot>
            );
          })}
        </div>
      </ScrollArea>
    </section>
  );
}

interface TooltipProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly focus: FocusManager;
  readonly ansicht: HerdAnsicht;
  readonly uebersicht: UebersichtAnsicht | null;
  readonly catalog: ItemCatalog;
}

/**
 * The tooltip of the hovered (pointer) or focused (keys) stack or niche: an item's tooltip for the store, the bags,
 * the chests and the finds; for a niche what it takes and what it gives.
 */
function HerdTooltip({ i18n, bridge, focus, ansicht, uebersicht, catalog }: TooltipProps) {
  const hovered = useSignal<Element | null>(null);
  const lookup = useMemo(() => contentItemLookup(), []);
  const keys = focus.keys.value;
  const focused = focus.focused.value;
  const bags = bridge.state.bags.value;
  useEffect(() => {
    const over = (e: PointerEvent): void => {
      const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
      if (el !== hovered.peek()) hovered.value = el;
    };
    const out = (e: PointerEvent): void => {
      const to = e.relatedTarget instanceof Element ? e.relatedTarget.closest('[data-tip]') : null;
      if (to === null) hovered.value = null;
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
    };
  }, [hovered]);
  const anchor = keys ? (focused instanceof HTMLElement && focused.hasAttribute('data-tip') ? focused : null) : hovered.value;
  const key = anchor?.getAttribute('data-tip') ?? null;
  if (anchor === null || key === null || !anchor.isConnected) return null;
  const model = tooltipFor(i18n, key, { ansicht, uebersicht, bags, catalog, lookup });
  return model === null ? null : <ItemTooltip anchor={anchor} model={model} />;
}

/** The tooltip model of a `data-tip` key (see `HerdTooltip`). */
function tooltipFor(
  i18n: I18n,
  key: string,
  ctx: { readonly ansicht: HerdAnsicht; readonly uebersicht: UebersichtAnsicht | null; readonly bags: BagsState | null; readonly catalog: ItemCatalog; readonly lookup: ReturnType<typeof contentItemLookup> },
): ItemTooltipModel | null {
  const [art, a, b] = key.split(':');
  const item = (stack: ItemStack | null | undefined): ItemTooltipModel | null => {
    const def = stack === null || stack === undefined ? undefined : ctx.catalog.find(stack.item);
    return stack === null || stack === undefined || def === undefined ? null : mitHerdZeile(i18n, def.id, itemTooltip(i18n, { def, stack, lookup: ctx.lookup }));
  };
  switch (art) {
    case 'vorrat':
      return item(ctx.ansicht.vorrat[Number(a)]);
    case 'tasche': {
      const at = parseSlotKey(key.slice('tasche:'.length));
      return at === null || ctx.bags === null ? null : item(stackAt(ctx.bags, at));
    }
    case 'kiste':
      return item(ctx.uebersicht?.kisten.find((k) => k.id === Number(a))?.slots[Number(b)]);
    case 'fund': {
      const def = a === undefined ? undefined : ctx.catalog.find(a);
      return def === undefined ? null : mitHerdZeile(i18n, def.id, itemTooltip(i18n, { def, stack: null, lookup: ctx.lookup }));
    }
    case 'nische':
      return nischenTooltip(i18n, ctx.ansicht, Number(a));
    default:
      return null;
  }
}

/** An item's tooltip with how long one piece burns in the hearth (§16.5) after its description, for hearth fuel. */
function mitHerdZeile(i18n: I18n, item: string, model: ItemTooltipModel): ItemTooltipModel {
  if (!istHerdBrennstoff(item)) return model;
  const zeile = { lines: [{ text: i18n.t('ui.herdfeuer.tooltip.brennt', { stunden: brennstunden(item) }), tone: 'better' as const }] };
  return { ...model, sections: [...model.sections.slice(0, 1), zeile, ...model.sections.slice(1)] };
}

/** What a niche takes and gives (§16.5 "mit Glutkernen (einer je Leuchtfeuer) bis 40 Tiles"). */
function nischenTooltip(i18n: I18n, ansicht: HerdAnsicht, index: number): ItemTooltipModel {
  const t = i18n.t;
  const n = index + 1;
  const gesetzt = ansicht.kerne[index] !== null && ansicht.kerne[index] !== undefined;
  const table = BALANCE.hearth.radiusByCores;
  const cores = ansicht.kerne.filter((k) => k !== null).length;
  const mit = table[Math.min(table.length - 1, cores + (gesetzt ? 0 : 1))] ?? radiusMax();
  return {
    title: t('ui.herdfeuer.nische.titel', { n }),
    rarity: 'legendaer',
    subtitle: t('ui.herdfeuer.nische.art'),
    rarityLabel: t(gesetzt ? 'ui.herdfeuer.nische.zustand.gesetzt' : 'ui.herdfeuer.nische.zustand.frei'),
    sections: [
      { lines: [{ text: t('ui.herdfeuer.nische.nimmt', { n }), tone: 'text' }] },
      { lines: [{ text: t(gesetzt ? 'ui.herdfeuer.nische.gibt' : 'ui.herdfeuer.nische.wuerde', { radius: mit }), tone: gesetzt ? 'better' : 'dim' }] },
      { lines: [{ text: t(gesetzt ? 'ui.herdfeuer.nische.herausnehmen' : 'ui.herdfeuer.nische.quelle'), tone: 'dim' }] },
    ],
  };
}
