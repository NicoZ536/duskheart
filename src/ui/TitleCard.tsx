import type { I18n } from '../i18n';

/** Titelzeile über der Szene (wird in M7 vom Hauptmenü abgelöst). */
export function TitleCard({ i18n }: { i18n: I18n }) {
  return (
    <header class="dh-titlecard">
      <h1 class="dh-title">{i18n.t('game.title')}</h1>
      <p class="dh-subtitle">{i18n.t('game.subtitle')}</p>
    </header>
  );
}
