/**
 * Benachrichtigungen unten links (M3-29, §26): ein Stapel aus höchstens vier Schildern, ältestes oben,
 * neuestes unten. Aufsammeln zeigt Item-Icon und „Name ×Anzahl“ in der Raritätsfarbe (docs/ART.md §6),
 * Entdeckungen einen goldenen, Warnungen einen roten Randstreifen – zusätzlich zur Farbe trägt jede Art ihr
 * eigenes Symbol (farbunabhängig lesbar, §29). Neue Schilder rücken 2 px herein, alte blenden in drei
 * harten Stufen aus; beim Stapeln leuchtet die Anzahl kurz auf. Die Textgröße folgt der Einstellung
 * (`textgroesse`, auf ganze Schriftpixel gerundet). Die Liste ist eine höfliche Live-Region für
 * Screenreader.
 *
 * Die Zeit kommt von außen (`uhr`, Sekunden): im Spiel die Präsentationsuhr, im Szenario eine feste.
 */
import './meldungen.css';
import { useSignal } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { RARITY_REFS } from '../../../generated/palette';
import type { I18n, Lang } from '../../../i18n';
import { uiPx } from '../../kit/geometry';
import { farbHex, farbIndex, hudFarbVariablen } from '../minimap/palette';
import type { SpriteBilder } from '../minimap/spriteBild';
import type { FrameTakt } from '../minimap/takt';
import type { MeldungInhalt } from './inhalte';
import { geraetepixelAm, textFaktor } from './textgroesse';
import type { MeldungenWarteschlange, MeldungAnsicht } from './warteschlange';

const SYMBOL = 16;
const MS_JE_S = 1000;

/** Eine gezeichnete Meldung (Momentaufnahme für die Anzeige). */
interface Schild {
  readonly id: number;
  readonly art: string;
  readonly anzahl: number;
  readonly inhalt: MeldungInhalt;
  readonly ansicht: MeldungAnsicht;
}

export interface HudMeldungenProps {
  readonly i18n: I18n;
  readonly lang: Lang;
  readonly warteschlange: MeldungenWarteschlange<MeldungInhalt>;
  readonly takt: FrameTakt;
  readonly bilder: SpriteBilder;
  /** Einstellung `accessibility.textScale` (1–2). */
  readonly textgroesse?: number;
  /** „Bewegung reduzieren“ (§29): Schilder erscheinen ohne Hereinrücken. */
  readonly bewegungReduziert?: boolean;
  /** Zeit [s]; Standard `performance.now() / 1000`. */
  readonly uhr?: () => number;
}

/** Textfarbe eines Schilds (Raritätsfarbe beim Aufsammeln). */
function textFarbe(inhalt: MeldungInhalt): string | undefined {
  return inhalt.raritaet === undefined ? undefined : farbHex(farbIndex(RARITY_REFS[inhalt.raritaet]));
}

/** Der übersetzte Text einer Meldung. */
export function meldungsText(i18n: I18n, lang: Lang, inhalt: MeldungInhalt, anzahl: number): string {
  const name = inhalt.name === undefined ? '' : inhalt.name[lang];
  return i18n.t(inhalt.text, { name, count: anzahl });
}

export function HudMeldungen({ i18n, lang, warteschlange, takt, bilder, textgroesse = 1, bewegungReduziert = false, uhr }: HudMeldungenProps) {
  const wurzel = useRef<HTMLDivElement>(null);
  const schilder = useSignal<readonly Schild[]>([]);
  const [faktor, setFaktor] = useState(1);
  const farben = useMemo(() => hudFarbVariablen(), []);

  useEffect(() => {
    const el = wurzel.current;
    if (el === null) return undefined;
    const miss = (): void => setFaktor(textFaktor(geraetepixelAm(el, window.devicePixelRatio), textgroesse));
    miss();
    window.addEventListener('resize', miss);
    return () => window.removeEventListener('resize', miss);
  }, [textgroesse]);

  useEffect(() => {
    const jetzt = uhr ?? (() => performance.now() / MS_JE_S);
    const aktualisiere = (): void => {
      const t = jetzt();
      // Neue und gestapelte Meldungen, Ein- und Ausblendstufen meldet `aktualisiere`; sonst bleibt alles stehen.
      if (!warteschlange.aktualisiere(t)) return;
      schilder.value = warteschlange.sichtbar.map((m) => ({ id: m.id, art: m.art, anzahl: m.anzahl, inhalt: m.daten, ansicht: warteschlange.ansicht(m, t) }));
    };
    aktualisiere();
    return takt.onFrame(aktualisiere);
  }, [takt, warteschlange, uhr]);

  const bereit = bilder.bereit.value;
  return (
    <div
      ref={wurzel}
      class={`dh-hud-meldungen dh-kit${bewegungReduziert ? ' dh-hud-meldungen--ruhig' : ''}`}
      style={{ ...farben, '--dh-hud-text': String(faktor) }}
      role="log"
      aria-live="polite"
      aria-label={i18n.t('ui.meldungen.region')}
      data-testid="hud-meldungen"
      data-bereit={bereit ? '1' : '0'}
    >
      {schilder.value.map((s) => {
        const url = bereit ? bilder.url(s.inhalt.symbol) : null;
        const farbe = textFarbe(s.inhalt);
        return (
          <div
            key={s.id}
            class={`dh-hud-meldung dh-hud-meldung--${s.art}`}
            data-phase={s.ansicht.phase}
            data-art={s.art}
            style={{ opacity: String(s.ansicht.deckkraft) }}
            role={s.art === 'warnung' ? 'alert' : undefined}
          >
            {url !== null ? (
              <img class="dh-hud-meldung__symbol" src={url} width={SYMBOL} height={SYMBOL} style={{ width: uiPx(SYMBOL), height: uiPx(SYMBOL) }} alt="" />
            ) : (
              <span class="dh-hud-meldung__symbol" style={{ width: uiPx(SYMBOL), height: uiPx(SYMBOL) }} />
            )}
            <span class="dh-hud-meldung__text" style={farbe === undefined ? undefined : { '--dh-hud-textfarbe': farbe }}>
              {meldungsText(i18n, lang, s.inhalt, s.anzahl)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
