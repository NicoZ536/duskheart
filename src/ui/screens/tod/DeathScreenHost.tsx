/**
 * The death screen in the running game: shows `DeathScreen` while the model reports a death and sends the
 * chosen respawn. The screen stack (src/ui/focus/GameScreens.tsx) renders it on top of every other screen
 * with its focus manager; the model is created once per session (`createDeathScreenModel`).
 */
import type { I18n, Lang } from '../../../i18n';
import type { FocusManager } from '../../focus/manager';
import { DeathScreen } from './DeathScreen';
import type { DeathScreenModel } from './model';

export interface DeathScreenHostProps {
  readonly i18n: I18n;
  readonly lang: Lang;
  readonly model: DeathScreenModel;
  readonly focus: FocusManager;
}

export function DeathScreenHost({ i18n, lang, model, focus }: DeathScreenHostProps) {
  const view = model.view.value;
  return view === null ? null : <DeathScreen i18n={i18n} lang={lang} view={view} focus={focus} onRespawn={(at) => model.respawn(at)} />;
}
