/**
 * Die Weltanzeigen des HUD in einem Stück (M3-28/M3-29): Minimap oben rechts, Kompassbalken oben mittig
 * (wenn eingeschaltet), Benachrichtigungen unten links – alle aus einer Lage je Frame (`HudFrame`).
 *
 * Einbau durch die Kompositionswurzel bzw. den HUD (M3-27):
 * ```tsx
 * const welt = hudWeltdienste(session);            // einmal je Sitzung
 * <HudWeltanzeigen i18n={i18n} lang={lang} takt={bridge} dienste={welt}
 *   kompass={settings.game.compassBar} textgroesse={settings.accessibility.textScale}
 *   bewegungReduziert={settings.accessibility.reducedMotion} />
 * ```
 * `takt` ist alles mit `onFrame` (die UI-Brücke). Die Anzeigen lesen die Welt nur (`minimapQuelle`) und
 * schreiben nichts in die Simulation.
 */
import { useEffect, useMemo } from 'preact/hooks';
import { contentItemCatalog, type ItemCatalog } from '../../../game/items/catalog';
import type { I18n, Lang } from '../../../i18n';
import { HudMeldungen } from '../meldungen/Meldungen';
import { MELDUNG_SFX, type MeldungInhalt } from '../meldungen/inhalte';
import { meldungenQuelle, type MeldungenQuelle, type MeldungenSitzung } from '../meldungen/quelle';
import { MeldungenWarteschlange } from '../meldungen/warteschlange';
import { HudKompass } from './Kompass';
import { HudMinimap } from './Minimap';
import type { MinimapQuelle } from './lage';
import type { ZoomStufe } from './projektion';
import { minimapQuelle, type MinimapQuellenOptionen, type MinimapSitzung } from './quelle';
import { spriteBilder, type SpriteBilder } from './spriteBild';
import { HudFrame, type FrameTakt } from './takt';

const MS_JE_S = 1000;

/** Was die Weltanzeigen einer Sitzung brauchen (einmal je Sitzung erzeugt). */
export interface HudWeltdienste {
  readonly quelle: MinimapQuelle;
  readonly warteschlange: MeldungenWarteschlange<MeldungInhalt>;
  /** Sim-Ereignisse → Meldungen; `null` ohne Sitzung (Szenarien, die Meldungen selbst einspeisen). */
  readonly meldungsQuelle: MeldungenQuelle | null;
  /** Präsentationsuhr der Meldungen [s]. */
  readonly uhr: () => number;
}

export interface HudWeltdiensteOptionen extends MinimapQuellenOptionen {
  /** Item-Katalog (Namen, Rarität); Standard: der Content. */
  readonly katalog?: Pick<ItemCatalog, 'find'>;
  /** Uhr [s]; Standard `performance.now() / 1000`. */
  readonly uhr?: () => number;
  /** Audio-Kern (`AudioRuntime.play`): neue Entdeckungen und Warnungen klingen (`MELDUNG_SFX`), Ablehnungen nicht (sie haben ihren Fehlerklang). */
  readonly klang?: { play(cue: { readonly id: string }): boolean };
}

/** Quelle, Warteschlange und Ereignis-Anbindung für die Sitzung `s`. `trenne()` der Meldungsquelle beim Beenden. */
export function hudWeltdienste(s: MinimapSitzung & MeldungenSitzung, o: HudWeltdiensteOptionen = {}): HudWeltdienste {
  const uhr = o.uhr ?? (() => performance.now() / MS_JE_S);
  const warteschlange = new MeldungenWarteschlange<MeldungInhalt>();
  return {
    quelle: minimapQuelle(s, o),
    warteschlange,
    meldungsQuelle: meldungenQuelle(s, o.katalog ?? contentItemCatalog(), (e) => {
      const r = warteschlange.melde(e, uhr());
      if (e.art !== 'aufsammeln' && e.daten.stumm !== true && (r === 'neu' || r === 'wartet')) o.klang?.play({ id: MELDUNG_SFX });
    }),
    uhr,
  };
}

export interface HudWeltanzeigenProps {
  readonly i18n: I18n;
  readonly lang: Lang;
  /** Frame-Takt der Seite (UI-Brücke `onFrame`). */
  readonly takt: FrameTakt;
  readonly dienste: HudWeltdienste;
  /** Einstellung Kompassbalken (§25 „optional“). */
  readonly kompass?: boolean;
  readonly zoom?: ZoomStufe;
  readonly onZoom?: (z: ZoomStufe) => void;
  readonly textgroesse?: number;
  readonly bewegungReduziert?: boolean;
  /** Symbolquelle (Standard: der Spielatlas des Dokuments). */
  readonly bilder?: SpriteBilder;
}

export function HudWeltanzeigen({ i18n, lang, takt, dienste, kompass = false, zoom, onZoom, textgroesse = 1, bewegungReduziert = false, bilder }: HudWeltanzeigenProps) {
  const frame = useMemo(() => new HudFrame(dienste.quelle), [dienste]);
  const symbole = useMemo(() => bilder ?? spriteBilder(document), [bilder]);
  useEffect(
    () =>
      takt.onFrame(() => {
        frame.frame();
        dienste.meldungsQuelle?.frame(frame.lage);
      }),
    [takt, frame, dienste],
  );
  const uhrMs = useMemo(() => () => dienste.uhr() * MS_JE_S, [dienste]);
  return (
    <>
      <HudMinimap i18n={i18n} lang={lang} quelle={dienste.quelle} frame={frame} bilder={symbole} textgroesse={textgroesse} {...(zoom === undefined ? {} : { zoom })} {...(onZoom === undefined ? {} : { onZoom })} />
      {kompass ? <HudKompass i18n={i18n} quelle={dienste.quelle} frame={frame} bilder={symbole} bewegungReduziert={bewegungReduziert} uhr={uhrMs} /> : null}
      <HudMeldungen i18n={i18n} lang={lang} warteschlange={dienste.warteschlange} takt={frame} bilder={symbole} textgroesse={textgroesse} bewegungReduziert={bewegungReduziert} uhr={dienste.uhr} />
    </>
  );
}
