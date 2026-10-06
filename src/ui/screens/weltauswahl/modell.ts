/**
 * Model of the world selection (MASTERPROMPT §26 "Weltauswahl"; §28 "mehrere Welten, Export/Import `.dhsave`, Seed
 * teilen"; docs/SPIEL.md §25; M7-50, M7-58). Pure: what a row of the list says about a world, and what the player's
 * actions on the selected world leave in the status line.
 */
import { BALANCE } from '../../../content/balance';
import type { I18n } from '../../../i18n';
import { formatHours } from '../../../i18n/format';
import { shareSeedText } from '../../../save/dhsave';
import type { WeltEintrag } from '../../menu/hooks';

/** The texts of one world's row. */
export interface WeltZeile {
  readonly name: string;
  /** "Tag 12 · Klein · 3,5 h". */
  readonly details: string;
  /** When it was saved last, in the player's locale. */
  readonly gespeichert: string;
}

/** Seconds of play in `ticks` simulation ticks. */
export function spielSekunden(ticks: number): number {
  return Math.max(0, ticks) / BALANCE.time.tickHz;
}

export function weltZeile(i18n: I18n, welt: WeltEintrag): WeltZeile {
  const zeit = new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'short', timeStyle: 'short' }).format(welt.gespeichert);
  return {
    name: welt.name,
    details: i18n.t('ui.welten.details', {
      tag: welt.tag,
      groesse: i18n.t(`ui.newWorld.groesse.${welt.groesse}`),
      spielzeit: formatHours(i18n.lang, spielSekunden(welt.ticks)),
    }),
    gespeichert: i18n.t('ui.welten.gespeichert', { zeit }),
  };
}

/** The shared seed of a world ("DH-<Seed>-<Größe>", §28 "Seed teilen"). */
export function weltSeed(welt: Pick<WeltEintrag, 'seed' | 'groesse'>): string {
  return shareSeedText(welt.seed, welt.groesse);
}

/** What the status line under the list says after an action. */
export type WeltStatus =
  | { readonly art: 'leer' }
  | { readonly art: 'arbeitet' }
  | { readonly art: 'exportiert'; readonly datei: string }
  | { readonly art: 'importiert'; readonly name: string }
  | { readonly art: 'kopiert'; readonly text: string }
  | { readonly art: 'kopierenFehler'; readonly text: string }
  | { readonly art: 'geloescht'; readonly name: string }
  | { readonly art: 'fehler'; readonly fehler: string };

/** The status line's text, or null for none. */
export function statusText(i18n: I18n, status: WeltStatus): string | null {
  switch (status.art) {
    case 'leer':
      return null;
    case 'arbeitet':
      return i18n.t('ui.welten.arbeitet');
    case 'exportiert':
      return i18n.t('ui.welten.exportiert', { datei: status.datei });
    case 'importiert':
      return i18n.t('ui.welten.importiert', { name: status.name });
    case 'kopiert':
      return i18n.t('ui.welten.kopiert', { seed: status.text });
    case 'kopierenFehler':
      return i18n.t('ui.welten.kopierenFehler', { seed: status.text });
    case 'geloescht':
      return i18n.t('ui.welten.geloescht', { name: status.name });
    case 'fehler':
      return i18n.t('ui.welten.fehler', { fehler: status.fehler });
  }
}

/** Whether the status reports a failure (shown in the warning colour). */
export function statusFehler(status: WeltStatus): boolean {
  return status.art === 'fehler';
}

/** The world selected after the list changed: the same id when it is still there, else the first (or none). */
export function auswahlNach(liste: readonly WeltEintrag[], vorher: string | null): string | null {
  if (vorher !== null && liste.some((w) => w.id === vorher)) return vorher;
  return liste[0]?.id ?? null;
}

/** The reason of a failed call, for the status line. */
export function fehlerText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
