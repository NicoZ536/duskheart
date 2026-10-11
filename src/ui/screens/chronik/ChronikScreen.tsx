/**
 * The chronicle (MASTERPROMPT §23.3 "Chronik (J): Aufgaben, Bestiarium, Herbarium & Fischbuch, Wissen (Erbauer-Tafeln,
 * Visionen), Rezeptbuch, Statistiken, Erfolge (≥ 60, lokal)"; docs/SPIEL.md §30 "`chronik` (7 Reiter) – J / `chronicle`";
 * M7-41): a book on a wooden board – seven tabs (Q/E or a click switch them) above a parchment page that scrolls:
 *
 * - Aufgaben: the running quests (the main quest first) with their step, hint and progress, "Verfolgen" (at most three in the
 *   HUD, `quest.track`), the onboarding switch (`quest.onboarding`), the finished quests and the diary (the youngest entries).
 * - Bestiarium: every creature – unknown ones as "???", sighted ones with lore, defeated ones with the tip and the count.
 * - Herbarium & Fischbuch: the plants gathered and the fish caught, with their counts.
 * - Wissen: the unlocked knowledge (mechanics, tablets, visions).
 * - Rezeptbuch: the known recipes by station with their ingredients.
 * - Statistiken: the statistics, the milestones with the play time they were reached at, the skills with their level, perks and
 *   open perk choices ("Perk wählen" opens the perk choice).
 * - Erfolge: every achievement with its symbol, unlocked ones with the play time, the others with their progress.
 *
 * The world runs on (the screen does not pause). Reads the session through `quelle.ts`; writes only commands.
 */
import { useSignal } from '@preact/signals';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { I18n } from '../../../i18n';
import { formatNumber } from '../../../i18n/format';
import type { UiBridge } from '../../bridge';
import { ScreenLayer } from '../../focus/Layer';
import type { FocusManager } from '../../focus/manager';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { HudBild } from '../../hud/Bild';
import { ScrollArea } from '../../kit/ScrollArea';
import { Button, Frame } from '../../kit/widgets';
import { CHRONIK_REITER, naechsterReiter, type AufgabenKarte, type ChronikReiter } from './modell';
import { CHRONIK_EREIGNISSE, ChronikQuelle, type ChronikInhalt } from './quelle';
import './chronik.css';

/** Id of the chronicle screen. */
export const CHRONIK_SCREEN = 'chronik';
/** Height of the page [design px]: the board's room below title and tabs, above its foot. */
export const CHRONIK_SEITE_HOEHE = 168;
/** Size of an achievement's symbol [design px]. */
const ERFOLG_PX = 16;

export interface ChronikScreenProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly focus: FocusManager;
  readonly close: () => void;
  /** Opens the perk choice (the open choices wait there). */
  readonly perkwahl?: () => void;
  /** The tab to open on (scenarios, E2E); default Aufgaben. */
  readonly start?: ChronikReiter;
}

export function ChronikScreen({ i18n, bridge, focus, close, perkwahl, start = 'aufgaben' }: ChronikScreenProps) {
  const root = useRef<HTMLDivElement>(null);
  const reiter = useSignal<ChronikReiter>(start);
  const inhalt = useSignal<ChronikInhalt | null>(null);
  const quelle = useMemo(() => new ChronikQuelle(bridge, i18n), [bridge, i18n]);
  useFocusScope(focus, root, {
    initial: () => focusable(root, `[data-reiter="${reiter.peek()}"]`),
    onAction(action) {
      if (action !== 'next' && action !== 'prev') return false;
      reiter.value = naechsterReiter(reiter.peek(), action === 'next' ? 1 : -1);
      return true;
    },
    onBack: close,
  });
  useEffect(() => {
    const lesen = (): void => {
      inhalt.value = quelle.lesen(reiter.peek());
    };
    lesen();
    const aus = [reiter.subscribe(lesen), i18n.onChange(lesen), ...CHRONIK_EREIGNISSE.map((e) => bridge.onEvent(e, lesen))];
    return () => aus.forEach((f) => f());
  }, [bridge, i18n, quelle, reiter, inhalt]);
  const t = i18n.t;
  const aktiv = reiter.value;
  const i = inhalt.value;
  return (
    <ScreenLayer focus={focus} label={t('ui.chronik.titel')} testId="ui-chronik">
      <div ref={root} class="dh-chronik" data-reiter={aktiv}>
        <Frame art="holz" class="dh-chronik__tafel">
          <h2 class="dh-chronik__titel">{t('ui.chronik.titel')}</h2>
          <div class="dh-chronik__reiter" role="tablist">
            {CHRONIK_REITER.map((r) => (
              <button
                type="button"
                key={r}
                role="tab"
                aria-selected={r === aktiv}
                class={r === aktiv ? 'dh-chronik__tab dh-chronik__tab--aktiv' : 'dh-chronik__tab'}
                data-fokus=""
                data-reiter={r}
                data-testid={`chronik-reiter-${r}`}
                onClick={() => (reiter.value = r)}
              >
                {t(`ui.chronik.reiter.${r}`)}
              </button>
            ))}
          </div>
          <Frame art="pergament" class="dh-chronik__seite" data-testid={`chronik-seite-${aktiv}`}>
            <ScrollArea key={aktiv} height={CHRONIK_SEITE_HOEHE} labelHoch={t('ui.kit.scroll.hoch')} labelRunter={t('ui.kit.scroll.runter')} ganzeZeilen>
              {i === null ? <p class="dh-chronik__leer">{t('ui.chronik.leer')}</p> : <Seite i18n={i18n} bridge={bridge} inhalt={i} perkwahl={perkwahl} />}
            </ScrollArea>
          </Frame>
          <p class="dh-chronik__fuss">
            <Button data-fokus="" data-testid="chronik-schliessen" onClick={close}>
              {t('ui.chronik.schliessen')}
            </Button>
          </p>
        </Frame>
      </div>
    </ScreenLayer>
  );
}

interface SeiteProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly inhalt: ChronikInhalt;
  readonly perkwahl: (() => void) | undefined;
}

/** The page of the open tab. */
function Seite({ i18n, bridge, inhalt, perkwahl }: SeiteProps) {
  const t = i18n.t;
  const lang = i18n.lang;
  const zahl = (n: number): string => formatNumber(lang, n);
  switch (inhalt.reiter) {
    case 'aufgaben': {
      const a = inhalt.ansicht;
      const karte = (k: AufgabenKarte) => (
        <li key={k.quest} class={`dh-chronik__aufgabe dh-chronik__aufgabe--${k.art}`} data-testid={`chronik-aufgabe-${k.quest}`} data-erledigt={k.erledigt ? 'ja' : 'nein'}>
          <p class="dh-chronik__kopf">
            <span class="dh-chronik__name">{k.titel}</span>
            <span class="dh-chronik__marke">{k.erledigt ? t('ui.chronik.aufgaben.erledigt') : k.pausiert ? t('ui.chronik.aufgaben.pausiert') : t(`ui.chronik.aufgaben.art.${k.art}`)}</span>
          </p>
          {k.erledigt ? null : <p class="dh-chronik__text">{k.beschreibung}</p>}
          {k.schritt !== null ? (
            <p class="dh-chronik__schritt">
              {t('ui.chronik.aufgaben.schritt', { nr: k.schritt.nr, von: k.schritt.von, ziel: k.schritt.titel })}
              {k.schritt.braucht > 0 ? <span class="dh-chronik__zahl"> {`${zahl(k.schritt.hat)}/${zahl(k.schritt.braucht)}`}</span> : null}
            </p>
          ) : null}
          {k.schritt !== null ? <p class="dh-chronik__hinweis">{k.schritt.hinweis}</p> : null}
          {!k.erledigt && !k.pausiert ? (
            <Button data-fokus="" data-testid={`chronik-verfolgen-${k.quest}`} aria-pressed={k.tracked} onClick={() => bridge.chronik?.verfolgen(k.quest, !k.tracked)}>
              {k.tracked ? t('ui.chronik.aufgaben.nichtVerfolgen') : t('ui.chronik.aufgaben.verfolgen')}
            </Button>
          ) : null}
        </li>
      );
      return (
        <div class="dh-chronik__inhalt">
          <p class="dh-chronik__zeile">
            <span>{t('ui.chronik.aufgaben.verfolgt', { n: a.verfolgt, max: 3 })}</span>
            <Button data-fokus="" data-testid="chronik-einstieg" aria-pressed={a.einstieg} onClick={() => bridge.chronik?.einstieg(!a.einstieg)}>
              {a.einstieg ? t('ui.chronik.aufgaben.einstiegAus') : t('ui.chronik.aufgaben.einstiegAn')}
            </Button>
          </p>
          <ul class="dh-chronik__liste">{a.laufend.map(karte)}</ul>
          {a.erledigt.length > 0 ? <h3 class="dh-chronik__abschnitt">{t('ui.chronik.aufgaben.abgeschlossen')}</h3> : null}
          <ul class="dh-chronik__liste">{a.erledigt.map(karte)}</ul>
          <h3 class="dh-chronik__abschnitt">{t('ui.chronik.tagebuch.titel')}</h3>
          {a.tagebuch.length === 0 ? <p class="dh-chronik__leer">{t('ui.chronik.tagebuch.leer')}</p> : null}
          <ul class="dh-chronik__liste" data-testid="chronik-tagebuch">
            {a.tagebuch.map((z) => (
              <li key={z.nr} class={`dh-chronik__eintrag dh-chronik__eintrag--${z.art}`}>
                <span class="dh-chronik__tag">{t('ui.chronik.tagebuch.tag', { tag: z.tag })}</span> {z.text}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case 'bestiarium':
      return (
        <ul class="dh-chronik__liste">
          {inhalt.ansicht.map((b) => (
            <li key={b.kreatur} class="dh-chronik__kreatur" data-kreatur={b.kreatur} data-bekannt={b.bekannt ? 'ja' : 'nein'}>
              <p class="dh-chronik__kopf">
                <span class="dh-chronik__name">{b.name ?? t('ui.chronik.unbekannt')}</span>
                {b.besiegt > 0 ? <span class="dh-chronik__marke">{t('ui.chronik.bestiarium.besiegt', { n: b.besiegt })}</span> : null}
              </p>
              {b.beschreibung !== null ? <p class="dh-chronik__text">{b.beschreibung}</p> : null}
              {b.text !== null ? <p class="dh-chronik__text">{b.text}</p> : null}
              {b.hinweis !== null ? <p class="dh-chronik__hinweis">{b.hinweis}</p> : null}
            </li>
          ))}
        </ul>
      );
    case 'herbarium': {
      const h = inhalt.ansicht;
      const liste = (titel: string, n: number, zeilen: typeof h.pflanzen, id: string) => (
        <div class="dh-chronik__spalte" data-testid={`chronik-${id}`}>
          <h3 class="dh-chronik__abschnitt">{t('ui.chronik.herbarium.anzahl', { titel, n, von: zeilen.length })}</h3>
          <ul class="dh-chronik__liste">
            {zeilen.map((z) => (
              <li key={z.id} class="dh-chronik__zeile" data-fund={z.id} data-bekannt={z.anzahl > 0 ? 'ja' : 'nein'}>
                <span class="dh-chronik__name">{z.name ?? t('ui.chronik.unbekannt')}</span>
                {z.anzahl > 0 ? <span class="dh-chronik__zahl">{zahl(z.anzahl)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      );
      return (
        <div class="dh-chronik__spalten">
          {liste(t('ui.chronik.herbarium.pflanzen'), h.pflanzenBekannt, h.pflanzen, 'pflanzen')}
          {liste(t('ui.chronik.herbarium.fische'), h.fischeBekannt, h.fische, 'fische')}
        </div>
      );
    }
    case 'wissen':
      return (
        <ul class="dh-chronik__liste">
          {inhalt.ansicht.length === 0 ? <li class="dh-chronik__leer">{t('ui.chronik.wissen.leer')}</li> : null}
          {inhalt.ansicht.map((w) => (
            <li key={w.id} class="dh-chronik__wissen" data-wissen={w.id}>
              <p class="dh-chronik__kopf">
                <span class="dh-chronik__name">{w.titel}</span>
                <span class="dh-chronik__marke">{t(`ui.chronik.wissen.quelle.${w.quelle}`)}</span>
              </p>
              <p class="dh-chronik__text">{w.text}</p>
            </li>
          ))}
        </ul>
      );
    case 'rezepte':
      return (
        <div class="dh-chronik__inhalt">
          {inhalt.ansicht.length === 0 ? <p class="dh-chronik__leer">{t('ui.chronik.rezepte.leer')}</p> : null}
          {inhalt.ansicht.map((g) => (
            <section key={g.station ?? '-'} class="dh-chronik__gruppe" data-station={g.station ?? 'hand'}>
              <h3 class="dh-chronik__abschnitt">{g.name}</h3>
              <ul class="dh-chronik__liste">
                {g.rezepte.map((r) => (
                  <li key={r.id} class="dh-chronik__rezept" data-rezept={r.id}>
                    <span class="dh-chronik__name">{r.anzahl > 1 ? `${r.name} ×${r.anzahl}` : r.name}</span>
                    <span class="dh-chronik__hinweis">{r.zutaten}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      );
    case 'statistik': {
      const s = inhalt.ansicht;
      return (
        <div class="dh-chronik__inhalt">
          <ul class="dh-chronik__raster">
            {s.werte.map((w) => (
              <li key={w.stat} class="dh-chronik__zeile" data-stat={w.stat}>
                <span class="dh-chronik__name">{w.name}</span>
                <span class="dh-chronik__zahl">{w.wert}</span>
              </li>
            ))}
          </ul>
          <h3 class="dh-chronik__abschnitt">{t('ui.chronik.statistik.meilensteine')}</h3>
          <ul class="dh-chronik__raster">
            {s.meilensteine.map((m) => (
              <li key={m.id} class="dh-chronik__zeile" data-meilenstein={m.id} data-erreicht={m.zeit === null ? 'nein' : 'ja'}>
                <span class="dh-chronik__name">{m.name}</span>
                <span class="dh-chronik__zahl">{m.zeit ?? '–'}</span>
              </li>
            ))}
          </ul>
          <h3 class="dh-chronik__abschnitt">{t('ui.chronik.statistik.fertigkeiten')}</h3>
          <ul class="dh-chronik__liste">
            {s.fertigkeiten.map((f) => (
              <li key={f.id} class="dh-chronik__fertigkeit" data-fertigkeit={f.id}>
                <p class="dh-chronik__kopf">
                  <span class="dh-chronik__name">{f.name}</span>
                  <span class="dh-chronik__zahl">{t('ui.chronik.statistik.stufe', { stufe: f.stufe })}</span>
                </p>
                <span class="dh-chronik__balken" aria-hidden="true">
                  <span class="dh-chronik__balken-fuellung" style={{ width: `${Math.round(f.anteil * 100)}%` }} />
                </span>
                {f.perks.length > 0 ? <p class="dh-chronik__hinweis">{f.perks.join(' · ')}</p> : null}
                {f.offen.length > 0 && perkwahl !== undefined ? (
                  <Button data-fokus="" data-testid={`chronik-perkwahl-${f.id}`} onClick={perkwahl}>
                    {t('ui.chronik.statistik.perkWaehlen', { count: f.offen.length })}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case 'erfolge': {
      const e = inhalt.ansicht;
      return (
        <div class="dh-chronik__inhalt">
          <p class="dh-chronik__zeile" data-testid="chronik-erfolge-anzahl">
            {t('ui.chronik.erfolge.anzahl', { n: e.erreicht, von: e.zeilen.length })}
          </p>
          <ul class="dh-chronik__liste">
            {e.zeilen.map((z) => (
              <li key={z.id} class={`dh-chronik__erfolg${z.erreicht ? ' dh-chronik__erfolg--erreicht' : ''}`} data-erfolg={z.id} data-erreicht={z.erreicht ? 'ja' : 'nein'}>
                <HudBild id={z.icon} breite={ERFOLG_PX} hoehe={ERFOLG_PX} class="dh-chronik__symbol" />
                <span class="dh-chronik__erfolg-text">
                  <span class="dh-chronik__kopf">
                    <span class="dh-chronik__name">{z.name}</span>
                    <span class="dh-chronik__zahl">{z.zeit ?? (z.braucht > 0 ? `${zahl(z.hat)}/${zahl(z.braucht)}` : '')}</span>
                  </span>
                  {z.beschreibung !== null ? <span class="dh-chronik__hinweis">{z.beschreibung}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
  }
}
