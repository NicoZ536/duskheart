/**
 * The HUD's recipe tracker (MASTERPROMPT §15.1 "Rezept anheften → HUD zeigt fehlende Zutaten live", §26 "rechts
 * Aufgaben- und Rezept-Tracker"; M4-08): right, below the minimap, one plate per pinned recipe (at most three – the
 * simulation's list, `craft.pin`, saved with the game) – product icon and name, each missing ingredient with what is
 * at hand against what one craft needs and how to get it, the station it needs when none is within reach, "Nur am
 * Wasser" for a recipe made by the water away from it, and "Alles da" (with a tick, the plate framed in gold) once all
 * is there. Ingredients at hand are left out: three plates fit below the minimap. Live: it follows the crafting source
 * (the pins every frame; bags, chests in reach, stations and water about ten times a second). A click on the cross
 * unpins (`craft.pin`). Shown in the modes Voll and Kontextuell (Minimal shows only warnings), hidden under open
 * screens like the rest of the HUD.
 */
import { useEffect, useMemo } from 'preact/hooks';
import type { I18n } from '../../../i18n';
import { formatNumber } from '../../../i18n/format';
import type { UiBridge } from '../../bridge';
import { Zeichen } from '../../screens/handwerk/glyphen';
import { bedarfItems, bedarfStationen, contentRezeptKontext, type RezeptKontext } from '../../screens/handwerk/modell';
import { werkstattQuelle } from '../../screens/handwerk/quelle';
import { ItemBild, werkstattTokens } from '../../screens/handwerk/teile';
import { trackerBloecke } from './modell';
import '../../screens/handwerk/handwerk.css';
import './tracker.css';

const TOKENS = werkstattTokens();

export interface HudTrackerProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  readonly ctx?: RezeptKontext;
}

export function HudTracker({ i18n, bridge, ctx = contentRezeptKontext() }: HudTrackerProps) {
  const quelle = werkstattQuelle(bridge);
  const pins = quelle?.angeheftet.value ?? [];
  const bekannt = useMemo(() => pins.filter((id) => ctx.book.has(id)), [pins, ctx]);
  // Always a need while mounted: the pins come with every sample (a pin from the menu, a loaded game), the stock of the
  // pinned recipes' ingredients and stations only while something is pinned.
  const wasser = bekannt.some((id) => ctx.book.get(id).umgebung === 'wasser');
  useEffect(() => quelle?.bedarf(bedarfItems(ctx, bekannt), bedarfStationen(ctx, bekannt), wasser), [quelle, ctx, bekannt, wasser]);
  if (quelle === null || bekannt.length === 0) return null;
  const stand = quelle.stand.value;
  const bloecke = trackerBloecke(i18n, ctx, bekannt, quelle.vorrat.value, stand.sichtbar);
  const t = i18n.t;
  const lang = i18n.lang;
  return (
    <section class="dh-hud-tracker" style={TOKENS} aria-label={t('ui.tracker.titel')} data-testid="hud-tracker">
      {bloecke.map((b) => (
        <div key={b.id} class="dh-hud-platte dh-hud-tracker__block" data-testid={`tracker-${b.id}`} data-bereit={b.bereit ? '' : undefined}>
          <p class="dh-hud-tracker__kopf">
            <ItemBild item={b.produkt} name={b.name} />
            <span class="dh-hud-tracker__name">{b.name}</span>
            <button type="button" class="dh-hud-tracker__loesen" aria-label={t('ui.tracker.loesen', { name: b.name })} data-testid={`tracker-loesen-${b.id}`} onClick={() => quelle.anheften(b.id, false)}>
              <Zeichen id="kreuz" />
            </button>
          </p>
          <ul class="dh-hud-tracker__zeilen">
            {b.zeilen
              .filter((z) => z.hat < z.braucht)
              .map((z) => (
                <li key={z.key} class="dh-hud-tracker__zeile dh-hud-tracker__zeile--fehlt" data-zutat={z.key} data-hat={z.hat}>
                  <span class="dh-hud-tracker__zutat">
                    <span>{z.name}</span>
                    <span class="dh-hud-tracker__zahl">
                      {formatNumber(lang, z.hat)}/{formatNumber(lang, z.braucht)}
                    </span>
                  </span>
                  {z.hinweis !== null ? <span class="dh-hud-tracker__hinweis">{z.hinweis}</span> : null}
                </li>
              ))}
            {b.station !== null && !b.station.daHand ? <li class="dh-hud-tracker__station">{t('ui.tracker.station', { ort: b.station.ort })}</li> : null}
            {b.wasser !== null && !b.wasser.da ? (
              <li class="dh-hud-tracker__station" data-testid={`tracker-wasser-${b.id}`}>
                {t('ui.tracker.wasser')}
              </li>
            ) : null}
            {b.bereit ? (
              <li class="dh-hud-tracker__bereit">
                <Zeichen id="haken" />
                <span>{t('ui.tracker.bereit')}</span>
              </li>
            ) : null}
          </ul>
        </div>
      ))}
    </section>
  );
}
