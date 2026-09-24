/**
 * Button prompts of the menus (MASTERPROMPT §26 "automatische Tastensymbole (Xbox, PlayStation,
 * generisch)", "Alles umbelegbar"): the key or button an action is bound to on the device used last,
 * translated ("Eingabe", "E", "A", "Kreuz"). Screens show them in their hint
 * lines, so rebinding changes the hints too.
 */
import type { Action } from '../../engine/input/actions';
import { bindingLabel } from '../../engine/input/bindings';
import type { I18n } from '../../i18n';
import type { UiInput } from '../bridge';

/** Label of the key or button bound to `action` for the device used last, or `null` when unbound. */
export function actionPrompt(i18n: I18n, input: Pick<UiInput, 'promptBinding' | 'gamepadFamily'> | null, action: Action): string | null {
  const binding = input?.promptBinding(action);
  if (binding === undefined || input === null) return null;
  return bindingLabel(binding, input.gamepadFamily)
    .map((part) => ('text' in part ? part.text : i18n.t(part.i18n, part.params)))
    .join('+');
}

/** Whether the last input came from a gamepad (hints then name buttons, not mouse gestures). */
export function usesGamepad(input: Pick<UiInput, 'lastDevice'> | null): boolean {
  return input?.lastDevice === 'gamepad';
}
