/**
 * The recipe book of the crafting menu (C, M4-32) and of a hand station (M4-07): MASTERPROMPT §15.1, §13.1, §26.
 *
 * Three panels (they fit 480×270 design px, like the inventory): the recipe list with search field and filter
 * selector (all, craftable now, product categories) | the chosen recipe – product with category, tier and the
 * quality stars the next piece gets, crafting time, the station it needs and whether one is at hand, its
 * ingredients with what is at hand for the chosen quantity, a line per missing ingredient saying how to get it
 * ("Fehlt: 2× Brett – herstellbar am Sägebock"), for a recipe made by the water whether water is within reach (live,
 * the crafting system's own check), the quantity (–, +, Max), "Herstellen" and "Anheften" | the queue
 * (`WarteschlangeTafel`). Below, a hint line with the gestures of the device in use and the reason of the last
 * refused crafting command.
 *
 * The product and every ingredient carry the item tooltip with "Herkunft" and "Verwendet in" (§15.1 "Für jedes Item
 * ‚Verwendet in' und ‚Herkunft' nachschlagbar"; src/ui/tooltip) – on hover, and on the focus frame while keys are used.
 *
 * Reads the crafting source (`WerkstattQuelle`) and sends crafting commands only; a pin is the command `craft.pin`
 * (the HUD's tracker shows it, the game saves it). Keyboard/controller: the focus frame walks rows and buttons;
 * confirm on a row chooses it (again: jumps to "Herstellen"), next/prev (E/Q, RB/LB) step the filter, typing in the
 * search field searches (↓/Enter return to the list, Esc leaves the field).
 */
import { useSignal } from '@preact/signals';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import type { RecipeDef } from '../../../content/recipes/schema';
import { contentStationCatalog } from '../../../game/stations/catalog';
import type { I18n } from '../../../i18n';
import { formatNumber } from '../../../i18n/format';
import type { UiBridge } from '../../bridge';
import type { FocusElement, FocusManager, NavAction } from '../../focus/manager';
import { actionPrompt, usesGamepad } from '../../focus/prompts';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { Button, Frame, ScrollArea } from '../../kit';
import { itemTooltip, ItemTooltip } from '../../tooltip';
import { ensureAtlasImages } from '../inventar/itemIcons';
import { Sterne, Zeichen } from './glyphen';
import {
  bedarfItems,
  bedarfStationen,
  contentRezeptKontext,
  dauerSekunden,
  fehltText,
  filterAuswahl,
  filtern,
  MAX_STERNE,
  mengeKlemmen,
  naechsterFilter,
  ortSchluessel,
  qualitaetsVorschau,
  rezeptZeilen,
  zutatZeilen,
  type RezeptFilter,
  type RezeptKontext,
} from './modell';
import type { VorratStand, WerkstattQuelle } from './quelle';
import { Hinweiszeile, ItemBild, WarteschlangeTafel, werkstattTokens } from './teile';
import './handwerk.css';

/** Colour tokens of the screens (rarity, better/worse, ink on parchment). */
const TOKENS = werkstattTokens();
/** Height of the recipe list [design px]. */
const LISTE_HOEHE = 168;
/** Height of the ingredient area of the detail panel [design px]. */
const ZUTATEN_HOEHE = 128;
/** Step of –/+ with Shift held [pieces]. */
const GROSSER_SCHRITT = 10;

/** Name of a filter: "Alle", "Herstellbar" or the category ("Werkzeug"). */
export function filterName(i18n: I18n, filter: RezeptFilter): string {
  return filter === 'alle' || filter === 'herstellbar' ? i18n.t(`ui.handwerk.filter.${filter}`) : i18n.t(`ui.item.kategorie.${filter}`);
}

export interface RezeptBuchProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly focus: FocusManager;
  readonly quelle: WerkstattQuelle;
  /** The recipes this book offers (the visible ones are listed). */
  readonly rezepte: readonly RecipeDef[];
  /** Heading of the list ("Handwerk", the station's name). */
  readonly titel: string;
  /** Text of an empty list (nothing visible yet). */
  readonly leer: string;
  readonly close: () => void;
  readonly testId: string;
  readonly ctx?: RezeptKontext;
}

export function RezeptBuch({ i18n, bridge, focus, quelle, rezepte, titel, leer, close, testId, ctx = contentRezeptKontext() }: RezeptBuchProps) {
  const t = i18n.t;
  const lang = i18n.lang;
  const root = useRef<HTMLDivElement>(null);
  const sucheRef = useRef<HTMLInputElement>(null);
  const suche = useSignal('');
  const filter = useSignal<RezeptFilter>('alle');
  const gewaehlt = useSignal<string | null>(null);
  const menge = useSignal(1);
  const openedTick = useMemo(() => bridge.state.tick.peek(), [bridge]);
  const stand = quelle.stand.value;
  const vorrat = quelle.vorrat.value;
  const pins = quelle.angeheftet.value;
  const keys = focus.keys.value;
  const fokussiert = focus.focused.value;
  const rejection = bridge.state.lastRejection.value;
  // The item under the mouse whose tooltip shows ("Herkunft", "Verwendet in").
  const tipp = useSignal<{ readonly item: string; readonly el: Element } | null>(null);

  useEffect(() => ensureAtlasImages(), []);
  // What the sample counts: every ingredient and station of this book's recipes, and the water for recipes made by it.
  const ids = useMemo(() => rezepte.map((r) => r.id), [rezepte]);
  const wasser = useMemo(() => rezepte.some((r) => r.umgebung === 'wasser'), [rezepte]);
  useEffect(() => quelle.bedarf(bedarfItems(ctx, ids), bedarfStationen(ctx, ids), wasser), [quelle, ctx, ids, wasser]);

  const sichtbar = useMemo(() => rezepte.filter((r) => stand.sichtbar.has(r.id)), [rezepte, stand.sichtbar]);
  const zeilen = rezeptZeilen(ctx, sichtbar, vorrat, lang);
  const auswahl = filterAuswahl(zeilen);
  const aktiverFilter = auswahl.includes(filter.value) ? filter.value : 'alle';
  const liste = filtern(ctx, zeilen, suche.value, aktiverFilter, lang);
  const zeile = liste.find((z) => z.id === gewaehlt.value) ?? liste[0] ?? null;
  // Another recipe replaces the detail panel: a tooltip of its old items would point at nothing.
  const zeileId = zeile?.id ?? null;
  useEffect(() => {
    tipp.value = null;
  }, [zeileId]);
  const tippFokus = keys && fokussiert instanceof HTMLElement && fokussiert.dataset['tippItem'] !== undefined ? { item: fokussiert.dataset['tippItem'], el: fokussiert } : null;
  const tippZeigt = tipp.value ?? tippFokus;
  const tippDef = tippZeigt === null ? undefined : ctx.book.catalog.find(tippZeigt.item);

  const waehlen = (id: string): void => {
    if (gewaehlt.peek() !== id) menge.value = 1;
    gewaehlt.value = id;
  };
  const herstellen = (): void => {
    if (zeile !== null) bridge.actions.crafting.start(zeile.id, mengeKlemmen(menge.peek()));
  };
  const zurListe = (): void => {
    const first = focusable(root, '.dh-hw__zeile');
    sucheRef.current?.blur();
    if (first !== null) {
      focus.keysUsed();
      focus.focus(first);
    }
  };

  // Never the search field first: a key press would type into it. Until the first sample brings the rows, the
  // filter selector holds the frame; the rows take it over once they appear (below).
  useFocusScope(focus, root, {
    initial: () => focusable(root, '.dh-hw__zeile[aria-pressed="true"]') ?? focusable(root, '.dh-hw__zeile') ?? focusable(root, '.dh-hw__filter [data-fokus]'),
    onAction(action: NavAction, focused: FocusElement | null): boolean {
      if (action === 'next' || action === 'prev') {
        filter.value = naechsterFilter(auswahl, aktiverFilter, action === 'next' ? 1 : -1);
        return true;
      }
      if (action === 'confirm' && focused instanceof HTMLElement && focused.classList.contains('dh-hw__zeile')) {
        const id = focused.getAttribute('data-rezept');
        if (id !== null && zeile?.id === id) {
          // A second confirm on the chosen recipe goes to "Herstellen".
          const knopf = focusable(root, '[data-testid="handwerk-herstellen"]');
          if (knopf !== null) focus.focus(knopf);
          return true;
        }
      }
      return false;
    },
    onBack: close,
  });

  // The chosen recipe follows the list (a search or filter may hide it).
  useLayoutEffect(() => {
    if (zeile !== null && gewaehlt.peek() !== zeile.id) gewaehlt.value = zeile.id;
  });
  // Opened by keys before the first sample: the first row takes the frame from the filter selector once it appears.
  const ersteZeilen = useRef(false);
  useLayoutEffect(() => {
    if (ersteZeilen.current || liste.length === 0) return;
    ersteZeilen.current = true;
    const current = focus.focused.peek();
    const filterKnopf = current instanceof HTMLElement && current.closest('.dh-hw__filter') !== null;
    if (focus.keys.peek() && (current === null || filterKnopf)) {
      const first = focusable(root, '.dh-hw__zeile[aria-pressed="true"]') ?? focusable(root, '.dh-hw__zeile');
      if (first !== null) focus.focus(first);
    }
  });

  const lastRefusal = rejection !== null && rejection.tick >= openedTick && rejection.type.startsWith('craft.') ? t(`ui.craft.reject.${rejection.reason}`) : null;
  const pad = usesGamepad(bridge.input);
  const prompt = (action: Parameters<typeof actionPrompt>[2]): string => actionPrompt(i18n, bridge.input, action) ?? '-';
  const hint =
    keys || pad
      ? t('ui.handwerk.hinweis.tasten', { waehlen: prompt('uiConfirm'), filter: `${prompt('uiTabPrev')}/${prompt('uiTabNext')}`, schliessen: prompt('uiBack') })
      : t('ui.handwerk.hinweis.maus');

  return (
    <>
      <div ref={root} class="dh-hw" style={TOKENS} data-testid={testId}>
        <Frame art="holz" class="dh-hw__tafel dh-hw__tafel--liste">
          <h2 class="dh-hw__titel">{titel}</h2>
          <label class="dh-hw__suche">
            <Zeichen id="lupe" class="dh-hw__suche-symbol" />
            <input
              ref={sucheRef}
              class="dh-hw__suchfeld"
              type="text"
              value={suche.value}
              placeholder={t('ui.handwerk.suche')}
              aria-label={t('ui.handwerk.suche')}
              spellcheck={false}
              autocomplete="off"
              data-fokus=""
              data-suche=""
              data-testid="handwerk-suche"
              onInput={(e) => {
                suche.value = (e.currentTarget as HTMLInputElement).value;
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape') {
                  e.preventDefault();
                  zurListe();
                }
              }}
            />
          </label>
          <div class="dh-hw__filter" data-testid="handwerk-filter" data-filter={aktiverFilter}>
            <Button class="dh-hw__pfeil" data-fokus="" aria-label={t('ui.handwerk.filter.zurueck')} onClick={() => (filter.value = naechsterFilter(auswahl, aktiverFilter, -1))}>
              <Zeichen id="links" />
            </Button>
            <span class="dh-hw__filter-name">{filterName(i18n, aktiverFilter)}</span>
            <Button class="dh-hw__pfeil" data-fokus="" aria-label={t('ui.handwerk.filter.weiter')} onClick={() => (filter.value = naechsterFilter(auswahl, aktiverFilter, 1))}>
              <Zeichen id="rechts" />
            </Button>
          </div>
          <ScrollArea height={LISTE_HOEHE} labelHoch={t('ui.kit.scroll.hoch')} labelRunter={t('ui.kit.scroll.runter')} class="dh-hw__liste">
            <div role="listbox" aria-label={titel} data-testid="handwerk-liste">
              {liste.length === 0 ? <p class="dh-hw__leer">{zeilen.length === 0 ? leer : t('ui.handwerk.keinTreffer')}</p> : null}
              {liste.map((z) => (
                <button
                  key={z.id}
                  type="button"
                  role="option"
                  class={z.herstellbar > 0 ? 'dh-hw__zeile' : 'dh-hw__zeile dh-hw__zeile--fehlt'}
                  aria-selected={zeile?.id === z.id}
                  aria-pressed={zeile?.id === z.id}
                  data-fokus=""
                  data-rezept={z.id}
                  data-testid={`rezept-${z.id}`}
                  onClick={() => waehlen(z.id)}
                  onDblClick={() => {
                    waehlen(z.id);
                    bridge.actions.crafting.start(z.id, 1);
                  }}
                >
                  <ItemBild item={z.produkt.id} name={z.name} />
                  <span class="dh-hw__zeile-name">{z.name}</span>
                  {pins.includes(z.id) ? <Zeichen id="nadel" class="dh-hw__zeile-nadel" /> : null}
                  <span class="dh-hw__zeile-zahl" aria-label={t('ui.handwerk.herstellbar', { anzahl: z.herstellbar })}>
                    {z.herstellbar > 0 ? `×${formatNumber(lang, Math.min(z.herstellbar, 99))}` : ''}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </Frame>
        {zeile === null ? (
          <Frame art="pergament" class="dh-hw__tafel dh-hw__tafel--detail" data-testid="handwerk-detail">
            <p class="dh-hw__leer dh-hw__leer--pergament">{zeilen.length === 0 ? leer : t('ui.handwerk.keinTreffer')}</p>
          </Frame>
        ) : (
          <RezeptDetail
            i18n={i18n}
            ctx={ctx}
            recipe={zeile.recipe}
            herstellbar={zeile.herstellbar}
            menge={menge.value}
            setMenge={(n) => (menge.value = mengeKlemmen(n))}
            sichtbar={stand.sichtbar}
            vorrat={vorrat}
            handwerkStufe={stand.handwerkStufe}
            angeheftet={pins.includes(zeile.id)}
            onHerstellen={herstellen}
            onAnheften={() => quelle.anheften(zeile.id, !pins.includes(zeile.id))}
            onTipp={(item, el) => (tipp.value = item === null || el === null ? null : { item, el })}
          />
        )}
        <WarteschlangeTafel i18n={i18n} bridge={bridge} quelle={quelle} ctx={ctx} />
        <Hinweiszeile text={lastRefusal ?? hint} fehler={lastRefusal !== null} testId="handwerk-hinweis" />
      </div>
      {tippZeigt !== null && tippDef !== undefined ? <ItemTooltip anchor={tippZeigt.el} model={itemTooltip(i18n, { def: tippDef, stack: null, lookup: ctx.lookup })} /> : null}
    </>
  );
}

interface RezeptDetailProps {
  readonly i18n: I18n;
  readonly ctx: RezeptKontext;
  readonly recipe: RecipeDef;
  readonly herstellbar: number;
  readonly menge: number;
  readonly setMenge: (n: number) => void;
  readonly sichtbar: ReadonlySet<string>;
  readonly vorrat: VorratStand;
  readonly handwerkStufe: number;
  readonly angeheftet: boolean;
  readonly onHerstellen: () => void;
  readonly onAnheften: () => void;
  /** The mouse entered (`item`, its element) or left (`null`) an item with a tooltip. */
  readonly onTipp: (item: string | null, el: Element | null) => void;
}

/** Hover handlers of an element showing the tooltip of `item`. */
function tippGesten(item: string, onTipp: RezeptDetailProps['onTipp']) {
  return {
    'data-tipp-item': item,
    onMouseEnter: (e: MouseEvent) => onTipp(item, e.currentTarget as Element),
    onMouseLeave: () => onTipp(null, null),
  };
}

/** The chosen recipe: product, stars, time, station, water, ingredients with hints, quantity and the two actions. */
function RezeptDetail({ i18n, ctx, recipe, herstellbar, menge, setMenge, sichtbar, vorrat, handwerkStufe, angeheftet, onHerstellen, onAnheften, onTipp }: RezeptDetailProps) {
  const t = i18n.t;
  const lang = i18n.lang;
  const produkt = ctx.book.catalog.get(recipe.ergebnis.item);
  const name = recipe.name?.[lang] ?? produkt.name[lang];
  const zutaten = zutatZeilen(ctx, recipe.id, menge, vorrat, lang);
  const fehlend = zutaten.filter((z) => z.fehlt > 0);
  const station = recipe.station;
  const anHand = station === null ? null : vorrat.stationAnHand(station);
  const punkte = station === null ? null : (anHand?.qualitaet ?? contentStationCatalog().stage(station).qualitaet);
  const sterne = qualitaetsVorschau(produkt, handwerkStufe, punkte);
  const amWasser = recipe.umgebung !== 'wasser' || vorrat.amWasser;
  const bereit = herstellbar >= menge && (station === null || anHand !== null) && amWasser;
  const stueck = recipe.ergebnis.anzahl * menge;
  return (
    <Frame art="pergament" class="dh-hw__tafel dh-hw__tafel--detail" data-testid="handwerk-detail" data-rezept={recipe.id}>
      <div class="dh-hw__kopf">
        <span class="dh-hw__kopf-bild" data-raritaet={produkt.raritaet} data-fokus="" data-testid="handwerk-produkt" {...tippGesten(produkt.id, onTipp)}>
          <ItemBild item={produkt.id} name={name} />
        </span>
        <div class="dh-hw__kopf-text">
          <h2 class="dh-hw__name">
            <span class="dh-hw__name-text" style={{ color: `var(--dh-raritaet-${produkt.raritaet})` }}>
              {name}
              {recipe.ergebnis.anzahl > 1 ? <span class="dh-hw__stueck"> ×{recipe.ergebnis.anzahl}</span> : null}
            </span>
            {sterne !== null ? <Sterne anzahl={sterne} max={MAX_STERNE} label={t('ui.item.qualitaet', { sterne })} /> : null}
          </h2>
          <p class="dh-hw__unter">
            {t(`ui.item.kategorie.${produkt.kategorie}`)} · {t('ui.item.stufe', { stufe: produkt.stufe })}
          </p>
        </div>
      </div>
      <p class="dh-hw__info">
        <Zeichen id="uhr" />
        <span>{t('ui.handwerk.dauer', { sekunden: formatNumber(lang, dauerSekunden(recipe), 1) })}</span>
        <span class={station === null || anHand !== null ? 'dh-hw__ort' : 'dh-hw__ort dh-hw__ort--fehlt'} data-testid="handwerk-ort">
          {station === null
            ? t('ui.handwerk.ohneStation')
            : anHand !== null
              ? t('ui.handwerk.stationDa', { name: ctx.book.catalog.get(anHand.station).name[lang] })
              : t('ui.handwerk.stationFehlt', { ort: t(ortSchluessel(station)) })}
        </span>
      </p>
      {recipe.umgebung === 'wasser' ? (
        <p class={amWasser ? 'dh-hw__info dh-hw__info--klein dh-hw__wasser' : 'dh-hw__info dh-hw__info--klein dh-hw__wasser dh-hw__wasser--fehlt'} data-testid="handwerk-wasser" data-am-wasser={amWasser ? '' : undefined}>
          {t(amWasser ? 'ui.handwerk.umgebung.wasserDa' : 'ui.handwerk.umgebung.wasser')}
        </p>
      ) : null}
      <ScrollArea height={ZUTATEN_HOEHE} labelHoch={i18n.t('ui.kit.scroll.hoch')} labelRunter={i18n.t('ui.kit.scroll.runter')} class="dh-hw__zutaten-rahmen">
        <h3 class="dh-hw__abschnitt">{t('ui.handwerk.zutaten')}</h3>
        <ul class="dh-hw__zutaten" data-testid="handwerk-zutaten">
          {zutaten.map((z) => (
            <li key={z.key} class={z.fehlt > 0 ? 'dh-hw__zutat dh-hw__zutat--fehlt' : 'dh-hw__zutat'} data-zutat={z.key} data-hat={z.hat} data-braucht={z.braucht} data-fokus="" {...tippGesten(z.iconItem, onTipp)}>
              <ItemBild item={z.iconItem} name={z.name} />
              <span class="dh-hw__zutat-name">{z.name}</span>
              <span class="dh-hw__zutat-zahl">
                {formatNumber(lang, z.hat)}/{formatNumber(lang, z.braucht)}
              </span>
            </li>
          ))}
        </ul>
        {fehlend.length > 0 ? (
          <div class="dh-hw__fehlt" data-testid="handwerk-fehlt">
            {fehlend.map((z) => (
              <p key={z.key}>{fehltText(i18n, ctx, z, sichtbar)}</p>
            ))}
          </div>
        ) : null}
        <p class="dh-hw__beschreibung">{produkt.beschreibung[lang]}</p>
      </ScrollArea>
      <div class="dh-hw__menge" data-testid="handwerk-menge" data-menge={menge}>
        <span class="dh-hw__menge-titel">{t('ui.handwerk.menge')}</span>
        <Button class="dh-hw__menge-knopf" data-fokus="" data-testid="handwerk-weniger" aria-label={t('ui.handwerk.weniger')} onClick={(e: MouseEvent) => setMenge(menge - (e.shiftKey ? GROSSER_SCHRITT : 1))}>
          –
        </Button>
        <span class="dh-hw__menge-zahl" aria-live="polite">
          {formatNumber(lang, menge)}
        </span>
        <Button class="dh-hw__menge-knopf" data-fokus="" data-testid="handwerk-mehr" aria-label={t('ui.handwerk.mehr')} onClick={(e: MouseEvent) => setMenge(menge + (e.shiftKey ? GROSSER_SCHRITT : 1))}>
          +
        </Button>
        <Button class="dh-hw__menge-max" data-fokus="" data-testid="handwerk-max" onClick={() => setMenge(Math.max(1, herstellbar))}>
          {t('ui.handwerk.max')}
        </Button>
      </div>
      <div class="dh-hw__aktionen">
        <Button class={bereit ? 'dh-hw__herstellen' : 'dh-hw__herstellen dh-hw__herstellen--matt'} data-fokus="" data-testid="handwerk-herstellen" onClick={onHerstellen}>
          {stueck > 1 ? t('ui.handwerk.herstellenAnzahl', { anzahl: stueck }) : t('ui.handwerk.herstellen')}
        </Button>
        <Button class="dh-hw__anheften" data-fokus="" data-testid="handwerk-anheften" aria-pressed={angeheftet} onClick={onAnheften}>
          <Zeichen id="nadel" />
          <span>{t(angeheftet ? 'ui.handwerk.loesen' : 'ui.handwerk.anheften')}</span>
        </Button>
      </div>
    </Frame>
  );
}
