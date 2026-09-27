/**
 * The repair tab of a station that mends (MASTERPROMPT §13.1 "Reparatur an Werkbank, Amboss oder Schleifstein
 * (anteilige Materialkosten). Kaputt = unbenutzbar, nie zerstört.", §26; M4-09): Werkbank I and II, the bronze anvil
 * and the grindstone (src/content/stations.ts `reparatur`).
 *
 * Two panels: the worn pieces the player carries or wears (wood) – first those this station mends, each with its
 * durability, then under "Braucht eine andere Station" the others –, what the station mends (categories up to a tier)
 * above them | the chosen piece (parchment): its durability now and after the repair, how worn it is and what share of
 * its recipe's ingredients the repair costs, the materials with what is at hand (bags and the chests in reach, where the
 * repair takes them from; green enough, red missing, always with the numbers), a line per missing material saying how
 * to get it, the station `repair.item` would mend it at (or why it cannot), and "Reparieren". Every piece and material
 * carries the item tooltip (src/ui/screens/station/tipp.tsx). Below, a hint line: the gestures, the last refused repair
 * or the last piece mended.
 *
 * Reads the repair view (`ReparaturAnsicht`, src/game/samples/reparatur.ts) and sends `repair.item` only; the
 * simulation decides. Keyboard/controller: the focus frame walks tabs, pieces, materials and the button; confirm on a
 * piece chooses it (again: jumps to "Reparieren"); back closes the screen.
 */
import type { RefObject } from 'preact';
import { useSignal } from '@preact/signals';
import { useEffect, useLayoutEffect, useMemo } from 'preact/hooks';
import { BALANCE } from '../../../content/balance';
import type { StationDef } from '../../../content/stations';
import type { I18n } from '../../../i18n';
import { formatPercent } from '../../../i18n/format';
import type { UiBridge } from '../../bridge';
import type { FocusElement, FocusManager, NavAction } from '../../focus/manager';
import { actionPrompt, usesGamepad } from '../../focus/prompts';
import { useFocusScope } from '../../focus/useFocusScope';
import { Button, Frame, ScrollArea } from '../../kit';
import { fehltText, type RezeptKontext } from '../handwerk/modell';
import { Fortschritt, Hinweiszeile, ItemBild, werkstattTokens } from '../handwerk/teile';
import { abnutzung, kannText, kostenZeilen, reparaturAblehnung, reparaturAuswahl, reparaturListe, reparierbar, sperrText } from './reparatur';
import type { ReparaturAnsicht, ReparaturStueck } from './reparaturQuelle';
import '../handwerk/handwerk.css';
import './station.css';

const TOKENS = werkstattTokens();
/** Height of the list of worn pieces and of the materials area [design px]. */
const LISTE_HOEHE = 172;
const KOSTEN_HOEHE = 124;
/** Scroll step of the list: one piece [design px]. */
const ZEILE = 24;
/** Width of the durability bars in the list and the detail [design px]. */
const LISTEN_BALKEN = 36;
const DETAIL_BALKEN = 60;

export interface ReparaturProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly focus: FocusManager;
  /** The element holding the tab strip and this tab: the root of its focus scope. */
  readonly rahmen: RefObject<HTMLElement>;
  readonly ansicht: ReparaturAnsicht | null;
  /** The open station (name and what it mends). */
  readonly name: string;
  readonly station: Pick<StationDef, 'reparatur'>;
  /** Recipes visible to the player (the solution hints of missing materials prefer them). */
  readonly sichtbar: ReadonlySet<string>;
  readonly ctx: RezeptKontext;
  readonly close: () => void;
}

export function Reparatur({ i18n, bridge, focus, rahmen, ansicht, name, station, sichtbar, ctx, close }: ReparaturProps) {
  const t = i18n.t;
  const lang = i18n.lang;
  const catalog = ctx.book.catalog;
  const keys = focus.keys.value;
  const gewaehlt = useSignal<string | null>(null);
  const openedTick = useMemo(() => bridge.state.tick.peek(), [bridge]);
  const rejection = bridge.state.lastRejection.value;
  const erfolg = useSignal<{ readonly item: string; readonly tick: number } | null>(null);
  useEffect(() => bridge.onEvent('itemRepaired', (e) => (erfolg.value = { item: e.item, tick: e.tick })), [bridge, erfolg]);

  const liste = reparaturListe(ansicht);
  const auswahl = reparaturAuswahl(liste, gewaehlt.value);

  const anfang = (): FocusElement | null => {
    const root = rahmen.current;
    const el = root?.querySelector('.dh-rp__zeile[aria-pressed="true"]') ?? root?.querySelector('.dh-rp__zeile') ?? root?.querySelector('.dh-reiter__tab[aria-selected="true"]');
    return el instanceof HTMLElement ? (el as unknown as FocusElement) : null;
  };
  // A mended piece leaves the list and takes the detail's button with it: the frame goes on to the next piece (or the tab).
  useLayoutEffect(() => {
    const f = focus.focused.peek();
    if (!focus.keys.peek() || !(f instanceof HTMLElement) || f.isConnected) return;
    const el = anfang();
    if (el !== null) focus.focus(el);
  });

  useFocusScope(focus, rahmen, {
    initial: anfang,
    onAction(action: NavAction, focused: FocusElement | null): boolean {
      if (action !== 'confirm' || !(focused instanceof HTMLElement) || !focused.classList.contains('dh-rp__zeile')) return false;
      if (focused.getAttribute('data-stueck') !== auswahl?.key) return false;
      // A second confirm on the chosen piece goes to "Reparieren".
      const knopf = rahmen.current?.querySelector('[data-testid="reparatur-reparieren"]');
      if (knopf instanceof HTMLElement) focus.focus(knopf as unknown as FocusElement);
      return true;
    },
    onBack: close,
  });

  const repaired = erfolg.value;
  const refusal = rejection !== null && rejection.tick >= openedTick && rejection.type === 'repair.item' ? rejection : null;
  const pad = usesGamepad(bridge.input);
  const prompt = (action: Parameters<typeof actionPrompt>[2]): string => actionPrompt(i18n, bridge.input, action) ?? '-';
  let hint = keys || pad ? t('ui.reparatur.hinweis.tasten', { waehlen: prompt('uiConfirm'), schliessen: prompt('uiBack') }) : t('ui.reparatur.hinweis.maus');
  let fehler = false;
  if (refusal !== null && (repaired === null || refusal.tick >= repaired.tick)) {
    hint = reparaturAblehnung(i18n, refusal.reason);
    fehler = true;
  } else if (repaired !== null && repaired.tick >= openedTick) {
    hint = t('ui.repair.done', { name: catalog.find(repaired.item)?.name[lang] ?? repaired.item });
  }
  const kann = kannText(i18n, station);

  const zeile = (s: ReparaturStueck) => {
    const def = catalog.find(s.stack.item);
    if (def === undefined) return null;
    const h = s.stack.haltbarkeit ?? s.voll;
    const aktiv = auswahl?.key === s.key;
    const itemName = def.name[lang];
    return (
      <button
        type="button"
        key={s.key}
        class={['dh-rp__zeile', aktiv ? 'dh-rp__zeile--gewaehlt' : '', s.hier ? '' : 'dh-rp__zeile--anderswo'].filter(Boolean).join(' ')}
        aria-pressed={aktiv}
        aria-label={t('ui.reparatur.stueck', { name: itemName, wert: h, max: s.voll, ort: t(`ui.inventory.bereich.${s.slot.bereich}`) })}
        data-fokus=""
        data-stueck={s.key}
        data-item={s.stack.item}
        data-testid={`reparatur-stueck-${s.key}`}
        data-tip={`tasche:${s.key}`}
        onClick={() => (gewaehlt.value = s.key)}
      >
        <span class="dh-rp__bild" data-raritaet={def.raritaet}>
          <ItemBild item={def.id} name={itemName} />
        </span>
        <span class="dh-rp__text">
          <span class="dh-rp__name">{itemName}</span>
          <span class="dh-rp__zustand">
            <Fortschritt anteil={s.voll > 0 ? h / s.voll : 0} breite={LISTEN_BALKEN} label={t('ui.item.haltbarkeit', { wert: h, max: s.voll })} />
            <span class={h * 4 <= s.voll ? 'dh-rp__zahl dh-rp__zahl--knapp' : 'dh-rp__zahl'}>
              {h}/{s.voll}
            </span>
            <span class="dh-rp__ort">{t(`ui.inventory.bereich.${s.slot.bereich}`)}</span>
          </span>
        </span>
      </button>
    );
  };

  return (
    <div class="dh-hw dh-rp" style={TOKENS} data-testid="station-reparatur">
      <Frame art="holz" class="dh-hw__tafel dh-rp__tafel--liste" data-testid="reparatur-liste">
        <h2 class="dh-hw__titel">{name}</h2>
        {kann !== null ? (
          <p class="dh-rp__kann" data-testid="reparatur-kann">
            {kann}
          </p>
        ) : null}
        <ScrollArea height={LISTE_HOEHE} zeile={ZEILE} labelHoch={t('ui.kit.scroll.hoch')} labelRunter={t('ui.kit.scroll.runter')} class="dh-rp__liste">
          <div role="listbox" aria-label={t('ui.reparatur.liste')}>
            {liste.hier.length === 0 && liste.anderswo.length === 0 ? (
              <p class="dh-rp__leer" data-testid="reparatur-leer">
                {t('ui.reparatur.leer')}
              </p>
            ) : null}
            {liste.hier.length === 0 && liste.anderswo.length > 0 ? <p class="dh-rp__leer">{t('ui.reparatur.nichtsHier')}</p> : null}
            {liste.hier.map(zeile)}
            {liste.anderswo.length > 0 ? <h3 class="dh-rp__gruppe">{t('ui.reparatur.anderswo')}</h3> : null}
            {liste.anderswo.map(zeile)}
          </div>
        </ScrollArea>
      </Frame>
      <Frame art="pergament" class="dh-hw__tafel dh-rp__tafel--detail" data-testid="reparatur-detail" data-stueck={auswahl?.key}>
        {auswahl === null ? (
          <>
            <h2 class="dh-rp__titel-pergament">{t('ui.reparatur.titel')}</h2>
            <p class="dh-rp__erklaerung" data-testid="reparatur-erklaerung">
              {t('ui.reparatur.erklaerung', { anteil: formatPercent(lang, BALANCE.crafting.repairMaterialShare) })}
            </p>
          </>
        ) : (
          <Detail i18n={i18n} bridge={bridge} ctx={ctx} stueck={auswahl} sichtbar={sichtbar} />
        )}
      </Frame>
      <Hinweiszeile text={hint} fehler={fehler} testId="reparatur-hinweis" />
    </div>
  );
}

interface DetailProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly ctx: RezeptKontext;
  readonly stueck: ReparaturStueck;
  readonly sichtbar: ReadonlySet<string>;
}

/** The chosen piece: durability now and after, wear and price, materials, missing lines, station, "Reparieren". */
function Detail({ i18n, bridge, ctx, stueck, sichtbar }: DetailProps) {
  const t = i18n.t;
  const lang = i18n.lang;
  const def = ctx.book.catalog.find(stueck.stack.item);
  if (def === undefined) return null;
  const itemName = def.name[lang];
  const h = stueck.stack.haltbarkeit ?? stueck.voll;
  const anteil = abnutzung(stueck);
  const kosten = kostenZeilen(ctx, stueck, lang);
  const fehlend = kosten.filter((k) => k.fehlt > 0);
  const sperre = sperrText(i18n, ctx, stueck);
  const bereit = reparierbar(stueck);
  const an = stueck.station === null ? null : (ctx.book.catalog.find(stueck.station)?.name[lang] ?? stueck.station);
  return (
    <>
      <div class="dh-hw__kopf">
        <span class="dh-hw__kopf-bild" data-raritaet={def.raritaet} data-fokus="" data-testid="reparatur-produkt" data-tip={`tasche:${stueck.key}`}>
          <ItemBild item={def.id} name={itemName} />
        </span>
        <div class="dh-hw__kopf-text">
          <h2 class="dh-hw__name">
            <span class="dh-hw__name-text" style={{ color: `var(--dh-raritaet-${def.raritaet})` }}>
              {itemName}
            </span>
          </h2>
          <p class="dh-hw__unter">
            {t(`ui.item.kategorie.${def.kategorie}`)} · {t('ui.item.stufe', { stufe: def.stufe })}
          </p>
        </div>
      </div>
      <p class="dh-rp__haltbarkeit" data-testid="reparatur-haltbarkeit" data-wert={h} data-max={stueck.voll}>
        <span class={h === 0 ? 'dh-rp__kaputt' : undefined}>{h === 0 ? t('ui.reparatur.kaputt', { max: stueck.voll }) : t('ui.item.haltbarkeit', { wert: h, max: stueck.voll })}</span>
        <Fortschritt anteil={stueck.voll > 0 ? h / stueck.voll : 0} breite={DETAIL_BALKEN} label={t('ui.item.haltbarkeit', { wert: h, max: stueck.voll })} />
      </p>
      <p class="dh-hw__info dh-hw__info--klein dh-rp__anteil">{t('ui.reparatur.anteil', { abgenutzt: formatPercent(lang, anteil.abgenutzt), kosten: formatPercent(lang, anteil.kosten) })}</p>
      <ScrollArea height={KOSTEN_HOEHE} labelHoch={t('ui.kit.scroll.hoch')} labelRunter={t('ui.kit.scroll.runter')} class="dh-hw__zutaten-rahmen">
        <h3 class="dh-hw__abschnitt">{t('ui.reparatur.material')}</h3>
        {kosten.length === 0 ? <p class="dh-rp__keine-kosten">{t('ui.reparatur.keinMaterial')}</p> : null}
        <ul class="dh-hw__zutaten" data-testid="reparatur-kosten">
          {kosten.map((k) => (
            <li
              key={k.key}
              class={k.fehlt > 0 ? 'dh-hw__zutat dh-hw__zutat--fehlt' : 'dh-hw__zutat'}
              data-zutat={k.key}
              data-hat={k.hat}
              data-braucht={k.braucht}
              data-fokus=""
              data-tip={`item:${k.iconItem}`}
            >
              <ItemBild item={k.iconItem} name={k.name} />
              <span class="dh-hw__zutat-name">{k.name}</span>
              <span class="dh-hw__zutat-zahl">
                {k.hat}/{k.braucht}
              </span>
            </li>
          ))}
        </ul>
        {fehlend.length > 0 ? (
          <div class="dh-hw__fehlt" data-testid="reparatur-fehlt">
            {fehlend.map((k) => (
              <p key={k.key}>{fehltText(i18n, ctx, k, sichtbar)}</p>
            ))}
          </div>
        ) : null}
        {sperre !== null ? (
          <p class="dh-rp__sperre" data-testid="reparatur-sperre">
            {sperre}
          </p>
        ) : null}
        <p class="dh-hw__beschreibung">{def.beschreibung[lang]}</p>
      </ScrollArea>
      <p class="dh-rp__an" data-testid="reparatur-an">
        {an !== null ? t('ui.reparatur.an', { station: an }) : ''}
      </p>
      <Button
        class={bereit ? 'dh-rp__knopf' : 'dh-rp__knopf dh-hw__herstellen--matt'}
        data-fokus=""
        data-testid="reparatur-reparieren"
        data-bereit={bereit ? '' : undefined}
        onClick={() => bridge.actions.stations.repair(stueck.slot)}
      >
        {t('ui.reparatur.knopf')}
      </Button>
    </>
  );
}
