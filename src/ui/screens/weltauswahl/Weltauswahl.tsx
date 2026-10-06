/**
 * World selection (MASTERPROMPT §26 "Weltauswahl", §28 "mehrere Welten, Export/Import `.dhsave`, Seed teilen";
 * docs/SPIEL.md §25; M7-50, M7-58): the stored worlds, newest save first – name, game day, size, time played and when
 * they were saved. The focused (or clicked) world is the selected one; the bar under the list acts on it: Laden,
 * Exportieren (a `.dhsave` file), Seed kopieren ("DH-<Seed>-<Größe>") and Löschen (asks first). Importieren reads a
 * `.dhsave` file into a new world. The status line says what happened or why not. Fully usable with keyboard or
 * controller (Esc/B: back to the main menu, or out of the delete question).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { I18n } from '../../../i18n';
import type { UiInput } from '../../bridge';
import { ScreenLayer } from '../../focus/Layer';
import type { FocusElement, FocusManager } from '../../focus/manager';
import { actionPrompt } from '../../focus/prompts';
import { focusable, useFocusScope } from '../../focus/useFocusScope';
import { Button, Frame, ScrollArea } from '../../kit';
import type { WeltEintrag, WeltQuelle } from '../../menu/hooks';
import { auswahlNach, fehlerText, statusFehler, statusText, weltSeed, weltZeile, type WeltStatus } from './modell';
import './weltauswahl.css';

export interface WeltauswahlProps {
  readonly i18n: I18n;
  readonly focus: FocusManager;
  readonly input: UiInput | null;
  readonly welten: WeltQuelle;
  readonly kopieren: (text: string) => Promise<boolean>;
  readonly onLaden: (welt: WeltEintrag) => void;
  readonly onNeueWelt: () => void;
  readonly onZurueck: () => void;
}

/** Height of a world's row and the gap between rows [design px] (weltauswahl.css `.dh-welten__welt`). */
const WELT_PX = 26;
const WELT_ABSTAND = 1;
/** Rows the list shows at once (the panel fits 480×270 with its bars, status and hint line). */
const WELTEN_SICHTBAR = 4;

function weltVon(el: FocusElement | null): string | null {
  return el instanceof Element ? el.getAttribute('data-welt') : null;
}

export function Weltauswahl({ i18n, focus, input, welten, kopieren, onLaden, onNeueWelt, onZurueck }: WeltauswahlProps) {
  const t = i18n.t;
  const [liste, setListe] = useState<readonly WeltEintrag[] | null>(null);
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [status, setStatus] = useState<WeltStatus>({ art: 'leer' });
  const [frage, setFrage] = useState<WeltEintrag | null>(null);
  const datei = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const neuLesen = async (wahl: string | null): Promise<void> => {
    try {
      const next = await welten.liste();
      if (!alive.current) return;
      setListe(next);
      setGewaehlt(auswahlNach(next, wahl));
    } catch (err) {
      if (!alive.current) return;
      setListe([]);
      setStatus({ art: 'fehler', fehler: fehlerText(err) });
    }
  };
  useEffect(() => {
    void neuLesen(null);
  }, [welten]);

  const welt = liste?.find((w) => w.id === gewaehlt) ?? null;
  const arbeitet = status.art === 'arbeitet';
  const run = async (action: () => Promise<WeltStatus>): Promise<void> => {
    if (arbeitet) return;
    setStatus({ art: 'arbeitet' });
    let next: WeltStatus;
    try {
      next = await action();
    } catch (err) {
      next = { art: 'fehler', fehler: fehlerText(err) };
    }
    if (alive.current) setStatus(next);
  };

  const exportieren = (): void => {
    if (welt === null) return;
    void run(async () => ({ art: 'exportiert', datei: await welten.exportieren(welt.id) }));
  };
  const seedKopieren = (): void => {
    if (welt === null) return;
    const text = weltSeed(welt);
    void run(async () => ((await kopieren(text)) ? { art: 'kopiert', text } : { art: 'kopierenFehler', text }));
  };
  const importieren = (files: FileList | null): void => {
    const file = files?.[0];
    if (file === undefined) return;
    void run(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const neu = await welten.importieren({ name: file.name, bytes });
      await neuLesen(neu.id);
      return { art: 'importiert', name: neu.name };
    });
  };
  const loeschen = (opfer: WeltEintrag): void => {
    setFrage(null);
    void run(async () => {
      await welten.loeschen(opfer.id);
      await neuLesen(null);
      return { art: 'geloescht', name: opfer.name };
    });
  };

  const hint = t('ui.pause.hinweis', { waehlen: actionPrompt(i18n, input, 'uiConfirm') ?? '-', zurueck: actionPrompt(i18n, input, 'uiBack') ?? '-' });
  return (
    <ScreenLayer focus={focus} label={t('ui.menu.worlds')} testId="ui-weltauswahl">
      {frage === null ? (
        <ListenAnsicht
          i18n={i18n}
          focus={focus}
          liste={liste}
          gewaehlt={welt}
          arbeitet={arbeitet}
          status={statusText(i18n, status)}
          statusFehler={statusFehler(status)}
          onWaehlen={setGewaehlt}
          onLaden={() => {
            if (welt !== null) onLaden(welt);
          }}
          onExportieren={exportieren}
          onSeed={seedKopieren}
          onLoeschen={() => {
            if (welt !== null) setFrage(welt);
          }}
          onImportieren={() => datei.current?.click()}
          onNeueWelt={onNeueWelt}
          onZurueck={onZurueck}
        />
      ) : (
        <LoeschFrage i18n={i18n} focus={focus} welt={frage} onJa={() => loeschen(frage)} onNein={() => setFrage(null)} />
      )}
      <input
        ref={datei}
        type="file"
        accept=".dhsave,application/gzip"
        class="dh-welten__datei"
        data-testid="welten-import-datei"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const el = e.currentTarget;
          importieren(el.files);
          el.value = '';
        }}
      />
      <p class="dh-welten__hinweis">{hint}</p>
    </ScreenLayer>
  );
}

interface ListenAnsichtProps {
  readonly i18n: I18n;
  readonly focus: FocusManager;
  readonly liste: readonly WeltEintrag[] | null;
  readonly gewaehlt: WeltEintrag | null;
  readonly arbeitet: boolean;
  readonly status: string | null;
  readonly statusFehler: boolean;
  readonly onWaehlen: (id: string) => void;
  readonly onLaden: () => void;
  readonly onExportieren: () => void;
  readonly onSeed: () => void;
  readonly onLoeschen: () => void;
  readonly onImportieren: () => void;
  readonly onNeueWelt: () => void;
  readonly onZurueck: () => void;
}

function ListenAnsicht(p: ListenAnsichtProps) {
  const { i18n, focus, liste, gewaehlt } = p;
  const t = i18n.t;
  const ref = useRef<HTMLDivElement>(null);
  useFocusScope(focus, ref, {
    initial: () => focusable(ref, gewaehlt !== null ? `[data-welt="${gewaehlt.id}"]` : '[data-testid="welten-neu"], [data-testid="welten-import"]'),
    // The focused world is the selected one (its row's `focus` handler); confirming a world loads it.
    onAction(action, focused) {
      if (action === 'confirm' && weltVon(focused) !== null) {
        p.onLaden();
        return true;
      }
      return false;
    },
    onBack: p.onZurueck,
  });
  const keine = gewaehlt === null || p.arbeitet;
  const shown = Math.min(WELTEN_SICHTBAR, Math.max(1, liste?.length ?? 1));
  return (
    <div ref={ref}>
      <Frame art="holz" class="dh-welten__tafel">
        <h2 class="dh-welten__titel">{t('ui.menu.worlds')}</h2>
        {liste === null ? (
          <p class="dh-welten__leer">{t('ui.welten.lesen')}</p>
        ) : liste.length === 0 ? (
          <Frame art="pergament" class="dh-welten__leer-tafel">
            <p data-testid="welten-leer">{t('ui.worlds.empty')}</p>
          </Frame>
        ) : (
          <ScrollArea
            height={shown * WELT_PX + (shown - 1) * WELT_ABSTAND}
            zeile={WELT_PX + WELT_ABSTAND}
            labelHoch={t('ui.kit.scroll.hoch')}
            labelRunter={t('ui.kit.scroll.runter')}
            class={liste.length <= WELTEN_SICHTBAR ? 'dh-welten__bereich--ganz' : undefined}
          >
            <div class="dh-welten__liste" role="listbox" aria-label={t('ui.menu.worlds')}>
              {liste.map((w) => {
                const z = weltZeile(i18n, w);
                const aktiv = gewaehlt?.id === w.id;
                return (
                  <button
                    type="button"
                    key={w.id}
                    role="option"
                    aria-selected={aktiv}
                    class={aktiv ? 'dh-welten__welt dh-welten__welt--gewaehlt' : 'dh-welten__welt'}
                    data-fokus=""
                    data-welt={w.id}
                    data-testid={`welt-${w.id}`}
                    onClick={() => p.onWaehlen(w.id)}
                    onDblClick={p.onLaden}
                    onFocus={() => p.onWaehlen(w.id)}
                  >
                    <span class="dh-welten__zeile1">
                      <span class="dh-welten__name">{z.name}</span>
                      <span class="dh-welten__zeit">{z.gespeichert}</span>
                    </span>
                    <span class="dh-welten__details">{z.details}</span>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        )}
        <div class="dh-welten__leiste">
          <Button data-fokus="" data-testid="welten-laden" disabled={keine} onClick={p.onLaden}>
            {t('ui.welten.laden')}
          </Button>
          <Button data-fokus="" data-testid="welten-export" disabled={keine} onClick={p.onExportieren}>
            {t('ui.welten.exportieren')}
          </Button>
          <Button data-fokus="" data-testid="welten-seed" disabled={keine} onClick={p.onSeed}>
            {t('ui.welten.seedKopieren')}
          </Button>
          <Button data-fokus="" data-testid="welten-loeschen" disabled={keine} onClick={p.onLoeschen}>
            {t('ui.welten.loeschen')}
          </Button>
        </div>
        <div class="dh-welten__leiste">
          <Button data-fokus="" data-testid="welten-neu" onClick={p.onNeueWelt}>
            {t('ui.menu.newWorld')}
          </Button>
          <Button data-fokus="" data-testid="welten-import" disabled={p.arbeitet} onClick={p.onImportieren}>
            {t('ui.welten.importieren')}
          </Button>
          <Button data-fokus="" data-testid="welten-zurueck" onClick={p.onZurueck}>
            {t('common.back')}
          </Button>
        </div>
        <p class={p.statusFehler ? 'dh-welten__status dh-welten__status--fehler' : 'dh-welten__status'} data-testid="welten-status" role="status">
          {p.status ?? ' '}
        </p>
      </Frame>
    </div>
  );
}

interface LoeschFrageProps {
  readonly i18n: I18n;
  readonly focus: FocusManager;
  readonly welt: WeltEintrag;
  readonly onJa: () => void;
  readonly onNein: () => void;
}

function LoeschFrage({ i18n, focus, welt, onJa, onNein }: LoeschFrageProps) {
  const t = i18n.t;
  const ref = useRef<HTMLDivElement>(null);
  useFocusScope(focus, ref, { initial: () => focusable(ref, '[data-nein]'), onBack: onNein });
  return (
    <div ref={ref}>
      <Frame art="holz" class="dh-welten__tafel dh-welten__tafel--frage" role="alertdialog" aria-label={t('ui.welten.loeschenTitel', { name: welt.name })}>
        <h2 class="dh-welten__titel">{t('ui.welten.loeschenTitel', { name: welt.name })}</h2>
        <p class="dh-welten__text">{t('ui.welten.loeschenText')}</p>
        <div class="dh-welten__leiste">
          <Button data-fokus="" data-testid="welten-loeschen-ja" onClick={onJa}>
            {t('ui.welten.loeschenJa')}
          </Button>
          <Button data-fokus="" data-nein="" data-testid="welten-loeschen-nein" onClick={onNein}>
            {t('common.cancel')}
          </Button>
        </div>
      </Frame>
    </div>
  );
}
