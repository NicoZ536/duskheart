import type { I18n } from '../i18n';
import type { WorldLoadingView } from './App';

/** Text der Ladezeile: laufender Generierungsschritt oder der Grund, warum die Welt nicht entstand. */
export function worldLoadingText(i18n: I18n, loading: WorldLoadingView): string {
  if (loading.kind === 'failed') return i18n.t('loading.world.failed', { error: loading.error });
  return i18n.t('loading.world.progress', { step: i18n.t(`loading.world.step.${loading.step}`), index: loading.index + 1, count: loading.count });
}

/**
 * Titelzeile über der Szene (wird in M7 vom Hauptmenü abgelöst). Solange die Welt der Sitzung im
 * Welt-Worker entsteht, zeigt eine Zeile darunter den laufenden Generierungsschritt (M2-14); scheitert
 * die Erzeugung, nennt sie den Grund (statt still stehen zu bleiben).
 */
export function TitleCard({ i18n, loading = null }: { i18n: I18n; loading?: WorldLoadingView | null }) {
  return (
    <header class="dh-titlecard">
      <h1 class="dh-title">{i18n.t('game.title')}</h1>
      <p class="dh-subtitle">{i18n.t('game.subtitle')}</p>
      {loading !== null && (
        <p class={loading.kind === 'failed' ? 'dh-loading dh-loading--fehler' : 'dh-loading'} data-testid="ui-world-loading" role={loading.kind === 'failed' ? 'alert' : 'status'}>
          {worldLoadingText(i18n, loading)}
        </p>
      )}
    </header>
  );
}
