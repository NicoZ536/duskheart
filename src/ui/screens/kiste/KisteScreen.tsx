/**
 * The chest screen (MASTERPROMPT §16.7 "Holzkiste 16 · Truhe 24 · … · Lagerregal 48 (nur Rohstoffe). Umbenennen +
 * Icon-Etikett, Sortieren, Schnellablage in passende Kisten (10 Tiles), ‚Alles einlagern' (außer Schnellleiste)";
 * §26 "Einlagern"; M4-21): opens when the player opens a chest (the simulation's `chestOpened`) and closes with
 * Esc/B, when the chest is taken down or the player no longer stands within its reach – closing shuts the lid
 * (`storage.close`).
 *
 * Two panels: the chest – its name (a text field: Enter or leaving it renames, empty gives the item's name back),
 * the icon label on its lid (◀ icon ▶ through the items it holds and "none"), its slots, "Sortieren" and "Alles
 * nehmen" | two tabs above the right panel: the bags – inventory, backpack compartment, hotbar (what the chest does not
 * take is dim), "Alles einlagern" (not the hotbar) and "Schnellablage" (into the matching chests around) – and the
 * search over every chest of the base (`SucheTafel`, §16.7 "Suche über alle Kisten der Basis": also without a burning
 * hearth; the finds of this chest are highlighted in its slots).
 *
 * Every filled slot – the chest's, the bags', the finds – carries the pixel item tooltip with "Herkunft" and
 * "Verwendet in" (`ItemTipp`), on hover and on the focus frame.
 *
 * Gestures: click a stack – the whole stack across; right click – half of it. Keyboard/controller: confirm = click,
 * prev (Q, LB) = right click. Sends storage commands only; a refusal shows in the hint line.
 */
import { useSignal } from '@preact/signals';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { BALANCE } from '../../../content/balance';
import type { ItemDef } from '../../../content/schema/item';
import { contentItemCatalog, type ItemCatalog } from '../../../game/items/catalog';
import type { ItemStack } from '../../../game/items/stack';
import type { SlotRef } from '../../../game/items/slots';
import type { I18n } from '../../../i18n';
import type { UiBridge } from '../../bridge';
import { ScreenLayer } from '../../focus/Layer';
import type { FocusElement, FocusManager, NavAction } from '../../focus/manager';
import { actionPrompt, usesGamepad } from '../../focus/prompts';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { Button, Frame, Slot } from '../../kit';
import { Zeichen } from '../handwerk/glyphen';
import { Hinweiszeile, ItemBild, werkstattTokens } from '../handwerk/teile';
import { suchItems } from '../herdfeuer/modell';
import { ensureAtlasImages } from '../inventar/itemIcons';
import { parseSlotKey, slotKey, stackAt } from '../inventar/model';
import { nachObenZumReiter, Reiter } from '../station/Reiter';
import { ItemTipp, type TippZiel } from '../station/tipp';
import { useKistenAnsicht, type KistenAnsicht } from './ansicht';
import { etikettAuswahl, kistenAblehnung, kistenName, nameKlemmen, naechstesEtikett, passtHinein, trefferIn } from './modell';
import { SucheTafel } from './Suche';
import { useKistenSuche, type SucheAnsicht } from './sucheQuelle';
import '../handwerk/handwerk.css';
import '../station/station.css';
import './kiste.css';

const TOKENS = werkstattTokens();
/** Bag areas the chest screen lists (the belt stays on the belt, equipment is worn). */
const TASCHEN: ReadonlyArray<'inventar' | 'rucksackfach' | 'schnellleiste'> = ['inventar', 'rucksackfach', 'schnellleiste'];

/** The tabs of the right panel. */
export type KistenReiter = 'taschen' | 'suche';

/**
 * What a `data-tip` key of the chest screen shows: `kiste:<index>` a slot of the open chest, `tasche:<bereich>:<index>`
 * a bag slot, `fund:<chest>:<index>` a find of the search, `item:<id>` a bare item (an icon label).
 */
export function kistenTippZiel(
  key: string,
  catalog: Pick<ItemCatalog, 'find'>,
  bags: Parameters<typeof stackAt>[0] | null,
  ansicht: KistenAnsicht | null,
  suche: SucheAnsicht | null,
): TippZiel | null {
  const sep = key.indexOf(':');
  const art = key.slice(0, sep);
  const rest = key.slice(sep + 1);
  const mit = (stack: ItemStack | null | undefined, aus: TippZiel['aus']): TippZiel | null => {
    const def = stack === null || stack === undefined ? undefined : catalog.find(stack.item);
    return stack === null || stack === undefined || def === undefined ? null : { def, stack, aus };
  };
  switch (art) {
    case 'item': {
      const def = catalog.find(rest);
      return def === undefined ? null : { def, stack: null, aus: null };
    }
    case 'kiste':
      return mit(ansicht?.slots[Number(rest)], null);
    case 'tasche': {
      const at = parseSlotKey(rest);
      return at === null || bags === null ? null : mit(stackAt(bags, at), at);
    }
    case 'fund': {
      const [kiste, index] = rest.split(':').map(Number);
      return mit(suche?.kisten.find((k) => k.id === kiste)?.funde.find((f) => f.index === index)?.stack, null);
    }
    default:
      return null;
  }
}

export interface KisteScreenProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly focus: FocusManager;
  /** Id of the chest (`chestOpened.chest`). */
  readonly kiste: number;
  readonly close: () => void;
  readonly catalog?: ItemCatalog;
}

export function KisteScreen({ i18n, bridge, focus, kiste, close, catalog = contentItemCatalog() }: KisteScreenProps) {
  const t = i18n.t;
  const lang = i18n.lang;
  const root = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const ansicht = useKistenAnsicht(bridge, kiste);
  const bags = bridge.state.bags.value;
  const keys = focus.keys.value;
  const entwurf = useSignal<string | null>(null);
  const reiter = useSignal<KistenReiter>('taschen');
  const suchText = useSignal('');
  const suche = useKistenSuche(bridge, kiste);
  const alleItems = useMemo(() => catalog.ids().map((i) => catalog.get(i)), [catalog]);
  const suchSet = useMemo(() => suchItems(suchText.value, alleItems, i18n.lang), [suchText.value, alleItems, i18n.lang]);
  const sucht = reiter.value === 'suche';
  useEffect(() => suche?.aktiv(sucht), [suche, sucht]);
  useEffect(() => suche?.suchen(suchSet), [suche, suchSet]);
  const sucheAnsicht = suche?.ansicht.value ?? null;
  const openedTick = useMemo(() => bridge.state.tick.peek(), [bridge]);
  const rejection = bridge.state.lastRejection.value;
  const weg = ansicht !== null && (!ansicht.vorhanden || !ansicht.inReichweite);

  useEffect(() => ensureAtlasImages(), []);
  useEffect(() => {
    if (weg) close();
  }, [weg, close]);
  // Closing the screen shuts the lid (while the chest is still there and in reach).
  const offen = useRef(ansicht !== null && ansicht.vorhanden && ansicht.inReichweite);
  offen.current = ansicht !== null && ansicht.vorhanden && ansicht.inReichweite;
  useEffect(
    () => () => {
      if (offen.current) bridge.actions.storage.close(kiste);
    },
    [bridge, kiste],
  );

  const defOf = (s: ItemStack | null): ItemDef | undefined => (s === null ? undefined : catalog.find(s.item));
  const nehmen = (index: number, haelfte: boolean): void => {
    const s = ansicht?.slots[index] ?? null;
    if (s !== null) bridge.actions.storage.take(kiste, index, haelfte ? Math.ceil(s.count / 2) : undefined);
  };
  const ablegen = (from: SlotRef, haelfte: boolean): void => {
    const s = bags === null ? null : stackAt(bags, from);
    if (s !== null) bridge.actions.storage.put(kiste, from, haelfte ? Math.ceil(s.count / 2) : undefined);
  };
  const umbenennen = (): void => {
    const e = entwurf.peek();
    if (e === null || ansicht === null) return;
    entwurf.value = null;
    const neu = nameKlemmen(e);
    if (neu !== ansicht.name) bridge.actions.storage.rename(kiste, neu);
  };

  useFocusScope(focus, root, {
    initial: () => focusable(root, '[data-kisten-slot]:not([data-leer])') ?? focusable(root, '[data-slot]:not([data-leer])') ?? focusable(root, '[data-kisten-slot]'),
    onAction(action: NavAction, focused: FocusElement | null): boolean {
      if (action !== 'prev' || !(focused instanceof HTMLElement)) return false;
      const from = parseSlotKey(focused.getAttribute('data-slot'));
      if (from !== null) {
        ablegen(from, true);
        return true;
      }
      const index = Number(focused.getAttribute('data-kisten-slot'));
      if (focused.hasAttribute('data-kisten-slot') && Number.isInteger(index)) {
        nehmen(index, true);
        return true;
      }
      return false;
    },
    onBack: close,
  });

  if (ansicht === null || !ansicht.vorhanden || weg) return null;
  const itemDef = catalog.find(ansicht.item);
  const itemName = itemDef?.name[lang] ?? ansicht.item;
  const name = kistenName(ansicht.name, itemName);
  const auswahl = etikettAuswahl(ansicht.slots, ansicht.label);
  const labelDef = ansicht.label === null ? undefined : catalog.find(ansicht.label);
  const belegt = ansicht.slots.filter((s) => s !== null).length;
  const treffer = sucht && suchSet !== null ? trefferIn(sucheAnsicht, kiste) : null;

  const lastRefusal = rejection !== null && rejection.tick >= openedTick && rejection.type.startsWith('storage.') ? kistenAblehnung(i18n, rejection.reason) : null;
  const pad = usesGamepad(bridge.input);
  const prompt = (action: Parameters<typeof actionPrompt>[2]): string => actionPrompt(i18n, bridge.input, action) ?? '-';
  const hint = keys || pad ? t('ui.kiste.hinweis.tasten', { umlagern: prompt('uiConfirm'), haelfte: prompt('uiTabPrev'), schliessen: prompt('uiBack') }) : t('ui.kiste.hinweis.maus');

  const stapelLabel = (s: ItemStack | null, def: ItemDef | undefined, platz: string): string =>
    s === null || def === undefined ? t('ui.inventory.leer', { platz }) : t('ui.inventory.stapel', { item: def.name[lang], anzahl: s.count });

  return (
    <ScreenLayer
      focus={focus}
      label={name}
      testId="ui-kiste"
      overlay={<ItemTipp i18n={i18n} focus={focus} root={root} aufloesen={(key) => kistenTippZiel(key, catalog, bags, ansicht, sucheAnsicht)} bags={bags} catalog={catalog} />}
    >
      <div ref={root} class="dh-ki" style={TOKENS} data-testid="kiste" data-kiste={kiste} data-reiter={reiter.value} onKeyDownCapture={(e) => nachObenZumReiter(e, root.current, focus)}>
        <span class="dh-ki__reiter-platz" aria-hidden="true" />
        {suche !== null ? (
          <Reiter<KistenReiter>
            class="dh-ki__reiter"
            label={t('ui.kiste.reiter')}
            aktiv={reiter.value}
            waehlen={(r) => (reiter.value = r)}
            eintraege={[
              { id: 'taschen', label: t('ui.station.taschen'), testId: 'kiste-reiter-taschen' },
              { id: 'suche', label: t('ui.kiste.reiter.suche'), testId: 'kiste-reiter-suche' },
            ]}
          />
        ) : (
          <span class="dh-ki__reiter-platz" aria-hidden="true" />
        )}
        <Frame art="holz" class="dh-hw__tafel dh-ki__tafel--kiste" data-testid="kiste-tafel">
          <div class="dh-ki__kopf">
            <input
              ref={nameRef}
              class="dh-hw__suchfeld dh-ki__name"
              type="text"
              value={entwurf.value ?? name}
              maxLength={BALANCE.storage.nameMaxLength}
              aria-label={t('ui.kiste.name')}
              spellcheck={false}
              autocomplete="off"
              data-fokus=""
              data-testid="kiste-name"
              onInput={(e) => {
                entwurf.value = (e.currentTarget as HTMLInputElement).value;
              }}
              onBlur={umbenennen}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') {
                  e.preventDefault();
                  if (e.key === 'Escape') entwurf.value = null;
                  nameRef.current?.blur();
                  const first = focusable(root, '[data-kisten-slot]');
                  if (first !== null) {
                    focus.keysUsed();
                    focus.focus(first);
                  }
                }
              }}
            />
            <span class="dh-ki__belegt" aria-label={t('ui.kiste.belegt', { belegt, max: ansicht.slots.length })}>
              {belegt}/{ansicht.slots.length}
            </span>
          </div>
          <div class="dh-ki__etikett" data-testid="kiste-etikett" data-etikett={ansicht.label ?? ''}>
            <span class="dh-ki__etikett-titel">{t('ui.kiste.etikett')}</span>
            <Button class="dh-hw__pfeil" data-fokus="" aria-label={t('ui.kiste.etikett.zurueck')} onClick={() => bridge.actions.storage.label(kiste, naechstesEtikett(auswahl, ansicht.label, -1))}>
              <Zeichen id="links" />
            </Button>
            <span
              class="dh-ki__etikett-bild"
              aria-label={labelDef === undefined ? t('ui.kiste.etikett.keins') : labelDef.name[lang]}
              data-tip={labelDef === undefined ? undefined : `item:${labelDef.id}`}
            >
              {labelDef === undefined ? <span class="dh-ki__etikett-keins">{t('ui.kiste.etikett.keins')}</span> : <ItemBild item={labelDef.id} name={labelDef.name[lang]} />}
            </span>
            <Button
              class="dh-hw__pfeil"
              data-fokus=""
              data-testid="kiste-etikett-weiter"
              aria-label={t('ui.kiste.etikett.weiter')}
              onClick={() => bridge.actions.storage.label(kiste, naechstesEtikett(auswahl, ansicht.label, 1))}
            >
              <Zeichen id="rechts" />
            </Button>
          </div>
          {ansicht.nur !== null ? <p class="dh-ki__nur">{t('ui.kiste.nur', { kategorien: ansicht.nur.map((k) => t(`ui.item.kategorie.${k}`)).join(', ') })}</p> : null}
          <div class="dh-ki__raster" data-testid="kiste-slots">
            {ansicht.slots.map((s, index) => {
              const def = defOf(s);
              return (
                <Slot
                  key={index}
                  class={treffer?.has(index) === true ? 'dh-st__slot dh-ki__slot dh-ki__slot--treffer' : 'dh-st__slot dh-ki__slot'}
                  label={stapelLabel(s, def, name)}
                  anzahl={s?.count}
                  data-fokus=""
                  data-kisten-slot={index}
                  data-treffer={treffer?.has(index) === true ? '' : undefined}
                  data-tip={s === null ? undefined : `kiste:${index}`}
                  data-testid={`kiste-slot-${index}`}
                  data-item={s?.item}
                  data-leer={s === null ? '' : undefined}
                  onClick={() => nehmen(index, false)}
                  onContextMenu={(e: MouseEvent) => {
                    e.preventDefault();
                    nehmen(index, true);
                  }}
                >
                  {s !== null && def !== undefined ? <ItemBild item={def.id} name={def.name[lang]} /> : null}
                </Slot>
              );
            })}
          </div>
          <div class="dh-ki__knoepfe">
            <Button data-fokus="" data-testid="kiste-sortieren" onClick={() => bridge.actions.storage.sort(kiste)}>
              {t('ui.kiste.sortieren')}
            </Button>
            <Button data-fokus="" data-testid="kiste-alles-nehmen" disabled={belegt === 0} onClick={() => bridge.actions.storage.takeAll(kiste)}>
              {t('ui.kiste.allesNehmen')}
            </Button>
          </div>
        </Frame>
        {sucht && suche !== null ? (
          <SucheTafel
            i18n={i18n}
            focus={focus}
            root={root}
            ansicht={sucheAnsicht}
            text={suchText.value}
            setText={(x) => (suchText.value = x)}
            suchSet={suchSet}
            catalog={catalog}
            nehmen={(index) => nehmen(index, false)}
          />
        ) : (
          <Frame art="holz" class="dh-hw__tafel dh-ki__tafel--taschen" data-testid="kiste-taschen">
            {suche === null ? <h2 class="dh-hw__titel">{t('ui.station.taschen')}</h2> : null}
            {bags === null
              ? null
              : TASCHEN.filter((area) => bags[area].length > 0).map((area) => (
                  <section key={area} class="dh-ki__bereich">
                    <h3 class="dh-st__unter">{t(`ui.inventory.bereich.${area}`)}</h3>
                    <div class="dh-ki__taschenraster">
                      {bags[area].map((s, index) => {
                        const at: SlotRef = { bereich: area, index };
                        const def = defOf(s);
                        const passt = def === undefined || passtHinein(ansicht.nur, def);
                        return (
                          <Slot
                            key={slotKey(at)}
                            class={passt ? 'dh-st__slot' : 'dh-st__slot dh-st__slot--passt-nicht'}
                            label={stapelLabel(s, def, t(`ui.inventory.bereich.${area}`))}
                            anzahl={s?.count}
                            data-fokus=""
                            data-slot={slotKey(at)}
                            data-tip={s === null ? undefined : `tasche:${slotKey(at)}`}
                            data-testid={`kiste-tasche-${area}-${index}`}
                            data-item={s?.item}
                            data-leer={s === null ? '' : undefined}
                            onClick={() => ablegen(at, false)}
                            onContextMenu={(e: MouseEvent) => {
                              e.preventDefault();
                              ablegen(at, true);
                            }}
                          >
                            {s !== null && def !== undefined ? <ItemBild item={def.id} name={def.name[lang]} /> : null}
                          </Slot>
                        );
                      })}
                    </div>
                  </section>
                ))}
            <div class="dh-ki__knoepfe">
              <Button data-fokus="" data-testid="kiste-alles-einlagern" onClick={() => bridge.actions.storage.storeAll(kiste)}>
                {t('ui.kiste.allesEinlagern')}
              </Button>
              <Button data-fokus="" data-testid="kiste-schnellablage" onClick={() => bridge.actions.storage.quickStash()}>
                {t('ui.kiste.schnellablage')}
              </Button>
            </div>
          </Frame>
        )}
        <Hinweiszeile text={lastRefusal ?? hint} fehler={lastRefusal !== null} testId="kiste-hinweis" />
      </div>
    </ScreenLayer>
  );
}
