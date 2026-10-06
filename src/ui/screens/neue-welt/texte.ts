/**
 * Texts of the world settings (the new-world screen, M7-51; the pause menu's world view): values of the rows and the
 * summary of a preset – its factors and its death penalty (MASTERPROMPT §29 table; docs/SPIEL.md §25). Pure.
 */
import type { DeathPenalty } from '../../../content/balance/death';
import type { I18n } from '../../../i18n';
import { formatNumber, formatPercent } from '../../../i18n/format';
import { VOREINSTELLUNG, type NeueWeltZeile, type Voreinstellung } from './modell';

/** A factor as the menus show it: "×1,25". */
export function faktorText(i18n: I18n, f: number): string {
  return `×${formatNumber(i18n.lang, f, 2)}`;
}

/** The shadow flood: off, or "jede 5. Nacht". */
export function flutText(i18n: I18n, naechte: number | null): string {
  return naechte === null ? i18n.t('common.off') : i18n.t('ui.newWorld.jedeNacht', { n: String(naechte) });
}

/**
 * The death penalty of a preset in one line ("Inventar im Grab · –25 % Fertigkeitsfortschritt"); the separator sticks to
 * the part before it (no-break space), so a wrapped line never begins with "·".
 */
export function todText(i18n: I18n, tod: DeathPenalty): string {
  const parts = [i18n.t(`ui.newWorld.tod.grab.${tod.grave}`)];
  if (tod.skillLoss > 0) parts.push(i18n.t('ui.newWorld.tod.fertigkeit', { anteil: formatPercent(i18n.lang, tod.skillLoss) }));
  if (tod.permadeath) parts.push(i18n.t('ui.newWorld.tod.permadeath'));
  return parts.join('\u00a0· ');
}

/** The factors of a preset in one line ("Hunger/Durst ×1 · Gegnerschaden ×1 · Schattenflut jede 7. Nacht"). */
export function faktorenText(i18n: I18n, v: Voreinstellung): string {
  return i18n.t('ui.newWorld.faktoren', {
    hunger: faktorText(i18n, v.hungerDurst),
    schaden: faktorText(i18n, v.gegnerschaden),
    flut: flutText(i18n, v.schattenflut),
  });
}

/**
 * The value of a new-world row as the list shows it; `preset` gives the factors "Voreinstellung" stands for (the slider
 * rows show the value they take from the preset).
 */
export function zeilenWert(i18n: I18n, row: NeueWeltZeile, value: string | number | boolean, preset: Voreinstellung): string {
  switch (row.id) {
    case 'groesse':
      return i18n.t(`ui.newWorld.groesse.${String(value)}`);
    case 'schwierigkeit':
      return i18n.t(`ui.newWorld.schwierigkeit.${String(value)}`);
    case 'friedlich':
    case 'logistikRealismus':
      return i18n.t(value === true ? 'common.on' : 'common.off');
    case 'tageslaenge':
      return i18n.t('ui.newWorld.minuten', { n: String(value) });
    case 'jahreszeitenLaenge':
      return i18n.t('ui.newWorld.tage', { n: String(value) });
    case 'ressourcendichte':
      return i18n.t(`ui.newWorld.dichte.${String(value)}`);
    case 'hungerDurst':
      return value === VOREINSTELLUNG ? i18n.t('ui.newWorld.wieVoreinstellung', { wert: faktorText(i18n, preset.hungerDurst) }) : faktorText(i18n, value as number);
    case 'gegnerschaden':
      return value === VOREINSTELLUNG ? i18n.t('ui.newWorld.wieVoreinstellung', { wert: faktorText(i18n, preset.gegnerschaden) }) : faktorText(i18n, value as number);
    case 'schattenflut':
      return value === VOREINSTELLUNG
        ? i18n.t('ui.newWorld.wieVoreinstellung', { wert: flutText(i18n, preset.schattenflut) })
        : value === 'aus'
          ? i18n.t('common.off')
          : flutText(i18n, value as number);
    default:
      return String(value);
  }
}
