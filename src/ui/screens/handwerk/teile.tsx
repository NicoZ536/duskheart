/**
 * Parts shared by the crafting menu, the station screen and the chest screen (M4-07, M4-32, M4-21): an item
 * icon (the atlas icon, or the item's initial while the atlas loads), a progress bar on whole design pixels,
 * the crafting queue panel with cancel buttons and the chest switch, and the hint line under the panels.
 */
import type { ComponentChildren } from 'preact';
import { BALANCE } from '../../../content/balance';
import { PALETTE_HEX, PALETTE_RAMPS } from '../../../generated/palette';
import { paletteRefHex } from '../../../render/palette/rows';
import { craftSeconds } from '../../../game/crafting/formulas';
import type { I18n } from '../../../i18n';
import type { UiBridge } from '../../bridge';
import { Button, Frame, ScrollArea, uiPx } from '../../kit';
import { tooltipTokens } from '../../tooltip';
import { itemIconUrl } from '../inventar/itemIcons';
import { contentRezeptKontext, rezeptName, type RezeptKontext } from './modell';
import type { WerkstattQuelle } from './quelle';
import { Zeichen } from './glyphen';

/**
 * Colour tokens of the recipe screens for the inline style of their root: rarities and better/worse of the
 * tooltips, plus the ink of "enough" and "missing" on parchment (the light comparison colours of the dark iron
 * tooltip are not readable on it).
 */
export function werkstattTokens(): Record<string, string> {
  return {
    ...tooltipTokens(),
    '--dh-hw-genug': paletteRefHex('gras.2', PALETTE_RAMPS, PALETTE_HEX),
    '--dh-hw-fehlt': paletteRefHex('feuer.1', PALETTE_RAMPS, PALETTE_HEX),
  };
}

/** Separator of the parts of a hint line in the texts; shown as gaps (the line wraps between parts only). */
export const HINWEIS_TRENNER = ' · ';

/** An item's 16-px icon, or its initial while the atlas loads. */
export function ItemBild({ item, name, class: extra }: { item: string; name: string; class?: string }) {
  const url = itemIconUrl(item);
  return url !== null ? (
    <img class={['dh-hw__icon', extra ?? ''].filter(Boolean).join(' ')} src={url} alt="" draggable={false} />
  ) : (
    <span class={['dh-hw__initiale', extra ?? ''].filter(Boolean).join(' ')} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  );
}

/** Filled width [design px] of a bar `breite` px wide at share `anteil` (0–1): whole pixels, a started share shows 1 px. */
export function balkenPx(anteil: number, breite: number): number {
  if (!(anteil > 0) || !(breite > 0)) return 0;
  if (anteil >= 1) return breite;
  return Math.min(breite - 1, Math.max(1, Math.floor(anteil * breite)));
}

/** A thin progress bar (`breite` × 2 design px). */
export function Fortschritt({ anteil, breite, art = 'arbeit', label }: { anteil: number; breite: number; art?: 'arbeit' | 'glut'; label: string }) {
  return (
    <span class={`dh-hw__balken dh-hw__balken--${art}`} style={{ width: uiPx(breite) }} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(anteil * 100)}>
      <span style={{ width: uiPx(balkenPx(anteil, breite)) }} />
    </span>
  );
}

/** A hint line: its parts wrap as wholes; `fehler` colours it as a refusal. */
export function Hinweiszeile({ text, fehler, testId }: { text: string; fehler: boolean; testId: string }) {
  return (
    <p class={fehler ? 'dh-hw__hinweis dh-hw__hinweis--fehler' : 'dh-hw__hinweis'} data-testid={testId} role={fehler ? 'alert' : undefined}>
      {text.split(HINWEIS_TRENNER).map((part, i) => (
        <span key={i}>{part}</span>
      ))}
    </p>
  );
}

/** Width of the queue's progress bar [design px]. */
const SCHLANGE_BALKEN = 60;
/** Height of the queue's scroll area [design px]. */
const SCHLANGE_HOEHE = 150;

export interface WarteschlangeTafelProps {
  readonly i18n: I18n;
  readonly bridge: UiBridge;
  /** The crafting source; the panel reads the queue itself, so its progress re-renders only this panel. */
  readonly quelle: WerkstattQuelle;
  readonly ctx?: RezeptKontext;
  readonly children?: ComponentChildren;
}

/**
 * The crafting queue (§15.1 "Warteschlange (10)"): every order with its product, pieces left and – for the first –
 * the progress of the piece in work and why it waits; a cancel button per order ("Abbrechen erstattet
 * vollständig"), and the switch whether crafting takes from chests in reach.
 */
export function WarteschlangeTafel({ i18n, bridge, quelle, ctx = contentRezeptKontext(), children }: WarteschlangeTafelProps) {
  const t = i18n.t;
  const schlange = quelle.warteschlange.value;
  const kisten = quelle.stand.value.kisten;
  const lang = i18n.lang;
  const erster = schlange.auftraege[0];
  return (
    <Frame art="holz" class="dh-hw__tafel dh-hw__tafel--schlange" data-testid="handwerk-warteschlange">
      <h2 class="dh-hw__titel">{t('ui.handwerk.warteschlange', { anzahl: schlange.auftraege.length, max: BALANCE.crafting.queueLength })}</h2>
      <ScrollArea height={SCHLANGE_HOEHE} labelHoch={t('ui.kit.scroll.hoch')} labelRunter={t('ui.kit.scroll.runter')} class="dh-hw__schlange">
        {schlange.auftraege.length === 0 ? <p class="dh-hw__leer">{t('ui.handwerk.warteschlange.leer')}</p> : null}
        {schlange.auftraege.map((a, i) => {
          const recipe = ctx.book.find(a.rezept);
          if (recipe === undefined) return null;
          const produkt = ctx.book.catalog.get(recipe.ergebnis.item);
          const name = rezeptName(recipe, produkt, lang);
          return (
            <div key={`${i}:${a.rezept}`} class={i === 0 ? 'dh-hw__auftrag dh-hw__auftrag--erster' : 'dh-hw__auftrag'} data-testid={`auftrag-${i}`} data-rezept={a.rezept}>
              <ItemBild item={produkt.id} name={name} />
              <span class="dh-hw__auftrag-text">
                <span class="dh-hw__auftrag-name">{name}</span>
                <span class="dh-hw__auftrag-rest">{t('ui.handwerk.auftrag.rest', { anzahl: a.anzahl * recipe.ergebnis.anzahl })}</span>
                {i === 0 ? (
                  <Fortschritt anteil={a.fortschritt} breite={SCHLANGE_BALKEN} label={t('ui.handwerk.auftrag.fortschritt', { sekunden: craftSeconds(recipe) })} />
                ) : null}
              </span>
              <Button class="dh-hw__abbrechen" data-fokus="" data-testid={`auftrag-abbrechen-${i}`} aria-label={t('ui.handwerk.auftrag.abbrechen', { name })} onClick={() => bridge.actions.crafting.cancel(i)}>
                <Zeichen id="kreuz" />
              </Button>
            </div>
          );
        })}
      </ScrollArea>
      {erster !== undefined && schlange.blockiert !== null ? (
        <p class="dh-hw__wartet" data-testid="handwerk-wartet">
          {t(`ui.craft.reject.${schlange.blockiert}`)}
        </p>
      ) : null}
      {children}
      <Button class="dh-hw__kisten" data-fokus="" data-testid="handwerk-kisten" aria-pressed={kisten} onClick={() => bridge.actions.crafting.useChests(!kisten)}>
        <Zeichen id="kiste" />
        <span>{t(kisten ? 'ui.handwerk.kisten.an' : 'ui.handwerk.kisten.aus')}</span>
      </Button>
    </Frame>
  );
}
