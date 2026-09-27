/**
 * The station screen (MASTERPROMPT §15.1, §15.2, §13.1, §26 "Bildschirme: … Stationen"; M4-07, M4-09): opens when the
 * player uses a placed station (the simulation's `stationOpened`, `station.use`) and closes with Esc/B, when the
 * station is taken down or the player no longer stands within its reach.
 *
 * - A hand station (workbench, sawbuck, mason's bench, anvil, grindstone, spinning wheel) shows the recipe book
 *   (`RezeptBuch`) over its recipes – every stage of its line up to its own – with search, filter, quantity,
 *   queue, quality stars of the station, pinning and the missing ingredients with their solution hints.
 * - A processing station (drying rack, charcoal kiln, clay oven, smelting furnace) shows its input, fuel and
 *   output slots next to the bags and what it makes (`Verarbeitung`).
 * - A station that mends (Werkbank I/II, bronze anvil, grindstone: `reparatur` in src/content/stations.ts) has two
 *   tabs above its panels: "Herstellen" (or "Verarbeiten") and "Reparieren" with the count of worn pieces it mends –
 *   the repair tab (`Reparatur`, `repair.item`).
 *
 * Every slot, product and ingredient of the processing panels and every piece and material of the repair tab carries
 * the pixel item tooltip (`ItemTipp`: on hover and on the focus frame); so do the orders of the recipe book's queue
 * (their product, on hover) – its chosen product and ingredients have the book's own.
 *
 * Focus: the recipe book and the processing panels push their own focus scope. With tabs the screen puts one scope
 * above it whose root also holds the tab strip – keys and the controller reach the tabs by walking up – and which
 * hands every action to the panels' scope below (their confirm, next/prev and back work as before). The repair tab's
 * scope has the same root. ↑ in the recipe book's search field goes to the tabs (`nachObenZumReiter`).
 *
 * The world keeps running while the screen is open (the batches of the station too).
 */
import { useSignal } from '@preact/signals';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import type { ItemDef } from '../../../content/schema/item';
import type { I18n } from '../../../i18n';
import type { UiBridge } from '../../bridge';
import { ScreenLayer } from '../../focus/Layer';
import type { FocusManager, FocusScope } from '../../focus/manager';
import { contentRezeptKontext, type RezeptKontext } from '../handwerk/modell';
import { werkstattQuelle } from '../handwerk/quelle';
import { RezeptBuch } from '../handwerk/RezeptBuch';
import { parseSlotKey, stackAt } from '../inventar/model';
import { useStationAnsicht, type StationAnsicht } from './ansicht';
import { stationsRezepte } from './modell';
import { nachObenZumReiter, Reiter } from './Reiter';
import { Reparatur } from './Reparatur';
import { reparaturListe } from './reparatur';
import { useReparaturAnsicht } from './reparaturQuelle';
import { ItemTipp, type TippZiel } from './tipp';
import { Verarbeitung } from './Verarbeitung';
import './station.css';

export interface StationScreenProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly focus: FocusManager;
  /** Id of the placed station (`stationOpened.id`). */
  readonly station: number;
  readonly close: () => void;
  readonly ctx?: RezeptKontext;
}

/**
 * The recipe book's orders (its own markup: they carry their recipe) get their product's tooltip on hover. Its rows do
 * not: the book's detail panel beside them shows the chosen product with its own tooltips, a tooltip would cover it.
 */
const AUFTRAG_TIPP = { selector: '.dh-hw__auftrag[data-rezept]', schluessel: (el: Element) => `rezept:${el.getAttribute('data-rezept') ?? ''}` } as const;

/** The tabs of a station that mends. */
export type StationModus = 'herstellen' | 'reparieren';

/**
 * What a tooltip key of the station screen shows: `item:<id>` a bare item (a recipe's product or ingredient, a
 * material), `rezept:<id>` a recipe's product (the orders of the recipe book's queue), `tasche:<bereich>:<index>` the
 * stack in a bag or equipment slot, `station:<bereich>:<index>` the stack in a slot of the station.
 */
export function stationTippZiel(
  key: string,
  catalog: { find(id: string): ItemDef | undefined },
  bags: Parameters<typeof stackAt>[0] | null,
  ansicht: StationAnsicht | null,
  produktVon: (rezept: string) => string | undefined = () => undefined,
): TippZiel | null {
  const sep = key.indexOf(':');
  const art = key.slice(0, sep);
  const rest = key.slice(sep + 1);
  if (art === 'item' || art === 'rezept') {
    const def = catalog.find(art === 'item' ? rest : (produktVon(rest) ?? ''));
    return def === undefined ? null : { def, stack: null, aus: null };
  }
  if (art === 'tasche') {
    const at = parseSlotKey(rest);
    const stack = at === null || bags === null ? null : stackAt(bags, at);
    const def = stack === null ? undefined : catalog.find(stack.item);
    return stack === null || def === undefined || at === null ? null : { def, stack, aus: at };
  }
  if (art === 'station' && ansicht !== null) {
    const [bereich, i] = rest.split(':');
    const index = Number(i);
    const stack = bereich === 'brennstoff' ? ansicht.brennstoff : bereich === 'eingang' ? (ansicht.eingang[index] ?? null) : bereich === 'ausgang' ? (ansicht.ausgang[index] ?? null) : null;
    const def = stack === null ? undefined : catalog.find(stack.item);
    return stack === null || def === undefined ? null : { def, stack, aus: null };
  }
  return null;
}

export function StationScreen({ i18n, bridge, focus, station, close, ctx = contentRezeptKontext() }: StationScreenProps) {
  const t = i18n.t;
  const quelle = werkstattQuelle(bridge);
  const ansicht = useStationAnsicht(bridge, station);
  const rahmen = useRef<HTMLDivElement>(null);
  const modus = useSignal<StationModus>('herstellen');
  const def = ansicht === null || !ansicht.vorhanden ? null : ctx.book.catalog.find(ansicht.station);
  const stationDef = ansicht === null || !ansicht.vorhanden ? undefined : ctx.book.stations.find(ansicht.station);
  const repariert = stationDef?.reparatur !== undefined && bridge.reparatur !== null;
  const reparatur = useReparaturAnsicht(bridge, station, repariert);
  const rezepte = useMemo(() => (ansicht === null || !ansicht.vorhanden ? [] : stationsRezepte(ctx, ansicht.station)), [ctx, ansicht?.vorhanden, ansicht?.station]);
  const weg = ansicht !== null && (!ansicht.vorhanden || !ansicht.inReichweite);
  const sichtbar = quelle !== null && ansicht !== null && def !== null && def !== undefined && !weg;
  const zeigt: StationModus = repariert ? modus.value : 'herstellen';
  // The latest `close` (a new function on every render of the screen stack) for the scope below, which stays pushed.
  const schliessen = useRef(close);
  schliessen.current = close;
  useEffect(() => {
    if (weg) close();
  }, [weg, close]);

  // With tabs, while the panels make: one scope above theirs that also holds the tab strip and hands every action down.
  useLayoutEffect(() => {
    const el = rahmen.current;
    if (!sichtbar || !repariert || zeigt !== 'herstellen' || el === null) return;
    const top = focus.top();
    const inner: FocusScope | null = top !== null && top.root instanceof Node && el.contains(top.root) ? top : null;
    return focus.push({
      root: el as unknown as FocusScope['root'],
      initial: () => inner?.initial?.() ?? null,
      onAction: (action, focused, index) => inner?.onAction?.(action, focused, index) ?? false,
      onBack: () => (inner?.onBack ?? schliessen.current)(),
    });
  }, [focus, sichtbar, repariert, zeigt, ansicht?.station, ansicht?.verarbeitung]);

  if (!sichtbar || quelle === null || ansicht === null || def === null || def === undefined) return null;
  const name = def.name[i18n.lang];
  const bags = bridge.state.bags.value;
  const tipp = (
    <ItemTipp
      i18n={i18n}
      focus={focus}
      root={rahmen}
      aufloesen={(key) => stationTippZiel(key, ctx.book.catalog, bags, ansicht, (r) => ctx.book.find(r)?.ergebnis.item)}
      bags={bags}
      catalog={ctx.book.catalog}
      lookup={ctx.lookup}
      weitere={AUFTRAG_TIPP}
    />
  );
  const herstellen = ansicht.verarbeitung ? (
    <Verarbeitung key={ansicht.station} i18n={i18n} bridge={bridge} focus={focus} quelle={quelle} ansicht={ansicht} name={name} ctx={ctx} close={close} />
  ) : (
    <RezeptBuch
      key={ansicht.station}
      i18n={i18n}
      bridge={bridge}
      focus={focus}
      quelle={quelle}
      rezepte={rezepte}
      titel={name}
      leer={t('ui.station.keineRezepte')}
      close={close}
      testId="station-handwerk"
      ctx={ctx}
    />
  );
  return (
    <ScreenLayer focus={focus} label={name} testId="ui-station" overlay={tipp}>
      <div ref={rahmen} class="dh-stw" data-modus={zeigt} onKeyDownCapture={(e) => nachObenZumReiter(e, rahmen.current, focus)}>
        {repariert && stationDef !== undefined ? (
          <>
            <Reiter<StationModus>
              label={t('ui.station.reiter')}
              aktiv={zeigt}
              waehlen={(m) => (modus.value = m)}
              eintraege={[
                { id: 'herstellen', label: t(ansicht.verarbeitung ? 'ui.station.reiter.verarbeiten' : 'ui.station.reiter.herstellen'), testId: 'station-reiter-herstellen' },
                { id: 'reparieren', label: t('ui.station.reiter.reparieren'), zahl: reparaturListe(reparatur).hier.length, testId: 'station-reiter-reparieren' },
              ]}
            />
            {zeigt === 'reparieren' ? (
              <Reparatur
                i18n={i18n}
                bridge={bridge}
                focus={focus}
                rahmen={rahmen}
                ansicht={reparatur}
                name={name}
                station={stationDef}
                sichtbar={quelle.stand.value.sichtbar}
                ctx={ctx}
                close={close}
              />
            ) : (
              herstellen
            )}
          </>
        ) : (
          herstellen
        )}
      </div>
    </ScreenLayer>
  );
}
