import type { I18n } from '../i18n';

/** Verständliche Meldung, wenn WebGL2 fehlt (MASTERPROMPT §6.3). */
export function NoWebGl2({ i18n }: { i18n: I18n }) {
  const t = i18n.t;
  return (
    <div class="dh-fatal" data-testid="no-webgl2" role="alert">
      <h1>{t('ui.error.webgl2.title')}</h1>
      <p>{t('ui.error.webgl2.body')}</p>
      <p>{t('ui.error.webgl2.hint')}</p>
      <button type="button" class="dh-button" onClick={() => location.reload()}>
        {t('ui.error.webgl2.retry')}
      </button>
    </div>
  );
}
