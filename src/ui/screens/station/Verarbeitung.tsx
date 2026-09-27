/**
 * The screen of a processing station (MASTERPROMPT §15.1 "Verarbeitungsstationen (Öfen, Meiler, Trockengestell …)
 * haben Eingang, Brennstoff und Ausgang, laufen zeitbasiert", §15.4, §26; M4-07): drying rack, charcoal kiln,
 * clay oven, smelting furnace.
 *
 * Three panels: the station – input slots, the arrow with the batch's progress, output slots with "Alles nehmen",
 * the fuel slot with the glow of the burning piece, a status line (what it works on, why it stands still) and what
 * the station is (its description) |
 * the player's bags (inventory, backpack compartment, hotbar): what the station takes is bright, the rest dim |
 * what the station makes (its visible batches): per batch the product, its ingredients with what the bags hold,
 * a pin for the tracker, and for the chosen one its ingredients (icon, what the bags hold of it) and the missing ones
 * with their solution hints.
 *
 * Every filled slot, every product and every ingredient carries the item tooltip with "Herkunft" and "Verwendet in"
 * (`data-tip`, shown by the station screen's `ItemTipp` on hover and on the focus frame).
 *
 * Gestures: click a bag stack – the whole stack into the input (or the fuel slot, for fuel); Shift+click – onto
 * the fuel slot (wood in the charcoal kiln); right click – half of it. Click a station slot – back into the bags.
 * Keyboard/controller: confirm = click, next (E, RB) = Shift+click, prev (Q, LB) = right click. Sends station
 * commands only; the simulation decides, a refusal shows in the hint line.
 */
import { useSignal } from '@preact/signals';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { ItemDef } from '../../../content/schema/item';
import type { Slot as BagSlot } from '../../../game/inventory/bags';
import type { ItemStack } from '../../../game/items/stack';
import type { SlotRef } from '../../../game/items/slots';
import type { I18n } from '../../../i18n';
import type { UiBridge } from '../../bridge';
import type { FocusElement, FocusManager, NavAction } from '../../focus/manager';
import { actionPrompt, usesGamepad } from '../../focus/prompts';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { Button, Frame, ScrollArea, Slot } from '../../kit';
import { angeheftet, umschalten } from '../../hud/tracker/anheften';
import { parseSlotKey, slotKey, stackAt } from '../inventar/model';
import { Zeichen } from '../handwerk/glyphen';
import { bedarfItems, fehltText, rezeptName, zutatZeilen, type RezeptKontext } from '../handwerk/modell';
import type { WerkstattQuelle } from '../handwerk/quelle';
import { Fortschritt, Hinweiszeile, ItemBild, werkstattTokens } from '../handwerk/teile';
import type { StationAnsicht } from './ansicht';
import { ablageAlternative, ablageVon, ablageZiel, ablehnungsText, stationsRezepte, stationsStatus, type AblageBereich } from './modell';
import '../handwerk/handwerk.css';
import './station.css';

const TOKENS = werkstattTokens();
/** Width of the batch progress bar under the arrow and of the glow bar [design px]. */
const PFEIL_BALKEN = 20;
const GLUT_BALKEN = 30;
/** Height of the bags' and the batches' scroll areas [design px]. */
const TASCHEN_HOEHE = 176;
const REZEPTE_HOEHE = 176;

export interface VerarbeitungProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly focus: FocusManager;
  readonly quelle: WerkstattQuelle;
  readonly ansicht: StationAnsicht;
  readonly name: string;
  readonly ctx: RezeptKontext;
  readonly close: () => void;
}

/** Bag areas the station screen lists (the carried stacks; equipment and belt stay out). */
const TASCHEN: ReadonlyArray<'inventar' | 'rucksackfach' | 'schnellleiste'> = ['inventar', 'rucksackfach', 'schnellleiste'];

export function Verarbeitung({ i18n, bridge, focus, quelle, ansicht, name, ctx, close }: VerarbeitungProps) {
  const t = i18n.t;
  const lang = i18n.lang;
  const root = useRef<HTMLDivElement>(null);
  const bags = bridge.state.bags.value;
  const keys = focus.keys.value;
  const stand = quelle.stand.value;
  const vorrat = quelle.vorrat.value;
  const pins = angeheftet.value;
  const gewaehlt = useSignal<string | null>(null);
  const openedTick = useMemo(() => bridge.state.tick.peek(), [bridge]);
  const rejection = bridge.state.lastRejection.value;
  const station = ansicht.station;
  const ablage = useMemo(() => ablageVon(ctx, station), [ctx, station]);
  const rezepte = useMemo(() => stationsRezepte(ctx, station), [ctx, station]);
  const ids = useMemo(() => rezepte.map((r) => r.id), [rezepte]);
  useEffect(() => quelle.bedarf(bedarfItems(ctx, ids), []), [quelle, ctx, ids]);
  const sichtbar = rezepte.filter((r) => stand.sichtbar.has(r.id));
  const auswahl = sichtbar.find((r) => r.id === gewaehlt.value) ?? sichtbar[0] ?? null;
  const catalog = ctx.book.catalog;
  const defOf = (s: BagSlot | ItemStack | null): ItemDef | undefined => (s === null ? undefined : catalog.find(s.item));

  const ablegen = (from: SlotRef, art: 'ziel' | 'alternativ' | 'haelfte'): void => {
    if (bags === null) return;
    const stack = stackAt(bags, from);
    const def = defOf(stack);
    if (stack === null || def === undefined) return;
    const ziel: AblageBereich | null = art === 'alternativ' ? (ablageAlternative(ablage, def) ?? ablageZiel(ablage, def)) : ablageZiel(ablage, def);
    // Nothing fits: the command still goes, so the simulation says why (wrong item, not fuel, too weak).
    const bereich = ziel ?? (def.brennwert !== undefined && ablage.brennstoff !== null ? 'brennstoff' : 'eingang');
    const count = art === 'haelfte' ? Math.ceil(stack.count / 2) : undefined;
    bridge.actions.stations.put(ansicht.id, from, bereich, count);
  };
  const nehmen = (bereich: 'eingang' | 'brennstoff' | 'ausgang', index: number): void => bridge.actions.stations.take(ansicht.id, bereich, index);

  useFocusScope(focus, root, {
    initial: () => focusable(root, '[data-slot]:not([data-leer])') ?? focusable(root, '[data-slot]'),
    onAction(action: NavAction, focused: FocusElement | null): boolean {
      if (!(focused instanceof HTMLElement)) return false;
      const from = parseSlotKey(focused.getAttribute('data-slot'));
      if (from !== null && (action === 'next' || action === 'prev')) {
        ablegen(from, action === 'next' ? 'alternativ' : 'haelfte');
        return true;
      }
      return false;
    },
    onBack: close,
  });

  const lastRefusal = rejection !== null && rejection.tick >= openedTick && rejection.type.startsWith('station.') ? ablehnungsText(i18n, rejection.reason) : null;
  const pad = usesGamepad(bridge.input);
  const prompt = (action: Parameters<typeof actionPrompt>[2]): string => actionPrompt(i18n, bridge.input, action) ?? '-';
  const hint =
    keys || pad
      ? t('ui.station.hinweis.tasten', { ablegen: prompt('uiConfirm'), brennstoff: prompt('uiTabNext'), haelfte: prompt('uiTabPrev'), schliessen: prompt('uiBack') })
      : t('ui.station.hinweis.maus');
  const status = stationsStatus(i18n, ctx, name, ansicht);
  const hatBrennstoff = ablage.brennstoff !== null;

  const stationSlot = (bereich: 'eingang' | 'brennstoff' | 'ausgang', index: number, stack: ItemStack | null) => {
    const def = defOf(stack);
    const label = stack === null || def === undefined ? t(`ui.station.leer.${bereich}`) : t('ui.inventory.stapel', { item: def.name[lang], anzahl: stack.count });
    return (
      <Slot
        key={`${bereich}:${index}`}
        class="dh-st__slot"
        label={label}
        anzahl={stack?.count}
        data-fokus=""
        data-station-slot={`${bereich}:${index}`}
        data-tip={stack === null ? undefined : `station:${bereich}:${index}`}
        data-testid={`station-${bereich}-${index}`}
        data-item={stack?.item}
        data-leer={stack === null ? '' : undefined}
        onClick={() => {
          if (stack !== null) nehmen(bereich, index);
        }}
      >
        {stack !== null && def !== undefined ? <ItemBild item={def.id} name={def.name[lang]} /> : bereich === 'brennstoff' ? <Zeichen id="flamme" class="dh-st__leer-symbol" /> : null}
      </Slot>
    );
  };

  return (
    <div ref={root} class="dh-st" style={TOKENS} data-testid="station-verarbeitung" data-station={station}>
      <Frame art="holz" class="dh-hw__tafel dh-st__tafel--station" data-testid="station-slots">
        <h2 class="dh-hw__titel">{name}</h2>
        <p class="dh-st__beschriftung">
          <span>{t('ui.station.eingang')}</span>
          <span>{t('ui.station.ausgang')}</span>
        </p>
        <div class="dh-st__fluss">
          <div class="dh-st__reihe">{ansicht.eingang.map((s, i) => stationSlot('eingang', i, s))}</div>
          <div class="dh-st__pfeil" data-laeuft={ansicht.laeuft ? '' : undefined}>
            <Zeichen id="pfeil" />
            <Fortschritt anteil={ansicht.fortschritt} breite={PFEIL_BALKEN} label={t('ui.station.fortschritt')} />
          </div>
          <div class="dh-st__reihe">{ansicht.ausgang.map((s, i) => stationSlot('ausgang', i, s))}</div>
        </div>
        {hatBrennstoff ? (
          <div class="dh-st__brennstoff">
            <span class="dh-st__brennstoff-titel">{t('ui.station.brennstoff')}</span>
            {stationSlot('brennstoff', 0, ansicht.brennstoff)}
            <span class="dh-st__glut" data-glueht={ansicht.glut > 0 ? '' : undefined}>
              <Zeichen id="flamme" />
              <Fortschritt anteil={ansicht.glut} breite={GLUT_BALKEN} art="glut" label={t('ui.station.glut')} />
            </span>
          </div>
        ) : (
          <p class="dh-st__ohne-feuer">{t('ui.station.ohneBrennstoff')}</p>
        )}
        <p class={`dh-st__status dh-st__status--${status.ton}`} data-testid="station-status" data-ton={status.ton}>
          {status.text}
        </p>
        <p class="dh-st__beschreibung">{catalog.get(station).beschreibung[lang]}</p>
        <Button class="dh-st__alles" data-fokus="" data-testid="station-alles-nehmen" disabled={ansicht.ausgang.every((s) => s === null)} onClick={() => bridge.actions.stations.takeAll(ansicht.id)}>
          {t('ui.station.allesNehmen')}
        </Button>
      </Frame>
      <Frame art="holz" class="dh-hw__tafel dh-st__tafel--taschen" data-testid="station-taschen">
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
                      const ziel = def === undefined ? null : ablageZiel(ablage, def);
                      const passt = ziel !== null;
                      return (
                        <Slot
                          key={slotKey(at)}
                          class={passt ? 'dh-st__slot' : 'dh-st__slot dh-st__slot--passt-nicht'}
                          label={
                            stack === null || def === undefined
                              ? t('ui.inventory.leer', { platz: t(`ui.inventory.bereich.${area}`) })
                              : t('ui.inventory.stapel', { item: def.name[lang], anzahl: stack.count })
                          }
                          anzahl={stack?.count}
                          data-fokus=""
                          data-slot={slotKey(at)}
                          data-tip={stack === null ? undefined : `tasche:${slotKey(at)}`}
                          data-testid={`station-tasche-${area}-${index}`}
                          data-item={stack?.item}
                          data-passt={ziel ?? undefined}
                          data-leer={stack === null ? '' : undefined}
                          onClick={(e: MouseEvent) => {
                            if (stack !== null) ablegen(at, e.shiftKey ? 'alternativ' : 'ziel');
                          }}
                          onContextMenu={(e: MouseEvent) => {
                            e.preventDefault();
                            if (stack !== null) ablegen(at, 'haelfte');
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
      <Frame art="pergament" class="dh-hw__tafel dh-st__tafel--rezepte" data-testid="station-rezepte">
        <h2 class="dh-st__titel-pergament">{t('ui.station.macht')}</h2>
        <ScrollArea height={REZEPTE_HOEHE} labelHoch={t('ui.kit.scroll.hoch')} labelRunter={t('ui.kit.scroll.runter')} class="dh-st__rezepte">
          {sichtbar.length === 0 ? <p class="dh-st__leer">{t('ui.station.keineRezepte')}</p> : null}
          {sichtbar.map((r) => {
            const produkt = catalog.get(r.ergebnis.item);
            const rname = rezeptName(r, produkt, lang);
            const zutaten = zutatZeilen(ctx, r.id, 1, vorrat, lang);
            const gewaehltHier = auswahl?.id === r.id;
            return (
              <div key={r.id} class={gewaehltHier ? 'dh-st__rezept dh-st__rezept--gewaehlt' : 'dh-st__rezept'} data-rezept-block={r.id}>
                <button
                  type="button"
                  class="dh-st__rezept-knopf"
                  data-fokus=""
                  data-tip={`item:${produkt.id}`}
                  data-testid={`station-rezept-${r.id}`}
                  aria-pressed={gewaehltHier}
                  onClick={() => (gewaehlt.value = r.id)}
                >
                  <ItemBild item={produkt.id} name={rname} />
                  <span class="dh-st__rezept-text">
                    <span class="dh-st__rezept-name">
                      {rname}
                      {r.ergebnis.anzahl > 1 ? ` ×${r.ergebnis.anzahl}` : ''}
                    </span>
                    <span class="dh-st__rezept-zutaten">{zutaten.map((z) => t('ui.station.zutat', { anzahl: z.braucht, name: z.name })).join(', ')}</span>
                  </span>
                </button>
                <Button
                  class="dh-st__nadel"
                  data-fokus=""
                  data-testid={`station-anheften-${r.id}`}
                  aria-pressed={pins.includes(r.id)}
                  aria-label={t(pins.includes(r.id) ? 'ui.handwerk.loesen' : 'ui.handwerk.anheften')}
                  onClick={() => umschalten(r.id)}
                >
                  <Zeichen id="nadel" />
                </Button>
              </div>
            );
          })}
          {auswahl !== null ? (
            <section class="dh-st__auswahl" data-testid="station-auswahl" data-rezept={auswahl.id}>
              <h3 class="dh-st__abschnitt">{t('ui.station.zutaten', { name: rezeptName(auswahl, catalog.get(auswahl.ergebnis.item), lang) })}</h3>
              <ul class="dh-st__zutaten" data-testid="station-zutaten">
                {zutatZeilen(ctx, auswahl.id, 1, vorrat, lang).map((z) => (
                  <li key={z.key} class={z.imBeutel < z.braucht ? 'dh-hw__zutat dh-hw__zutat--fehlt' : 'dh-hw__zutat'} data-zutat={z.key} data-fokus="" data-tip={`item:${z.iconItem}`}>
                    <ItemBild item={z.iconItem} name={z.name} />
                    <span class="dh-hw__zutat-name">{z.name}</span>
                    <span class="dh-hw__zutat-zahl">
                      {z.imBeutel}/{z.braucht}
                    </span>
                  </li>
                ))}
              </ul>
              <div class="dh-hw__fehlt" data-testid="station-fehlt">
                {zutatZeilen(ctx, auswahl.id, 1, vorrat, lang)
                  .filter((z) => z.imBeutel < z.braucht)
                  .map((z) => (
                    <p key={z.key}>{fehltText(i18n, ctx, { ...z, fehlt: z.braucht - z.imBeutel }, stand.sichtbar)}</p>
                  ))}
              </div>
            </section>
          ) : null}
        </ScrollArea>
      </Frame>
      <Hinweiszeile text={lastRefusal ?? hint} fehler={lastRefusal !== null} testId="station-hinweis" />
    </div>
  );
}
