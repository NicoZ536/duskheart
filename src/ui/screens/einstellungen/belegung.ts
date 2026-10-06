/**
 * Key bindings in the settings screen (MASTERPROMPT §26 "Alles umbelegbar", "Belegung umbelegbar mit
 * Konfliktanzeige"; docs/SPIEL.md §25; M7-56). Pure model over `BindingSet` (src/engine/input/bindings.ts):
 *
 * - one row per action, grouped by category, showing the first binding of the chosen device (keyboard & mouse, or
 *   controller); the developer tools' actions only while the developer mode is on;
 * - a captured input (a key with its held modifiers, a mouse button, a controller button) replaces that binding;
 *   when another action uses it in a shared context, the change waits for the player's choice (`konflikt`): swap (the
 *   other action gets the replaced binding), replace (the other action loses it) or cancel;
 * - rows of actions whose bindings conflict are marked, and actions left without any binding are named.
 * The result is stored as the settings' `controls.bindings` overrides (only actions that differ from the defaults).
 */
import { ACTION_CATEGORIES, ACTION_INFO, ACTIONS, actionLabelKey, type Action, type ActionCategory } from '../../../engine/input/actions';
import {
  BindingSet,
  bindingLabel,
  DEFAULT_BINDINGS,
  key,
  mouse,
  padButton,
  unboundActions,
  type Binding,
  type BindingConflict,
  type BindingDevice,
  type ConflictPolicy,
  type GamepadFamily,
  type SerializedBindings,
} from '../../../engine/input/bindings';
import type { I18n } from '../../../i18n';

/** The devices the binding rows switch between. */
export const BELEGUNGS_GERAETE: readonly BindingDevice[] = ['keyboardMouse', 'gamepad'];

/** Keys that are modifiers themselves: bound as plain keys, never as a chord with themselves. */
const MODIFIER_CODES: ReadonlySet<string> = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

/** The actions the rows show, in category order (the developer tools' only with the developer mode). */
export function belegbareAktionen(entwickler: boolean): Action[] {
  const out: Action[] = [];
  for (const cat of ACTION_CATEGORIES) {
    if (cat === 'debug' && !entwickler) continue;
    for (const a of ACTIONS) if (ACTION_INFO[a].category === cat) out.push(a);
  }
  return out;
}

/** The category of an action (the rows show a category's name before its first action). */
export function kategorieVon(action: Action): ActionCategory {
  return ACTION_INFO[action].category;
}

/** The binding table of the stored overrides. */
export function belegungAus(overrides: SerializedBindings): BindingSet {
  return new BindingSet(DEFAULT_BINDINGS, overrides);
}

/** The first binding of `action` on `geraet`, or undefined (unbound there). */
export function ersteBelegung(set: BindingSet, action: Action, geraet: BindingDevice): Binding | undefined {
  return set.primary(action, geraet);
}

/** A binding in words ("Strg+S", "Linke Maustaste", "A"); "Nicht belegt" for none. */
export function belegungsText(i18n: I18n, binding: Binding | undefined, family: GamepadFamily): string {
  if (binding === undefined) return i18n.t('input.rebind.unbound');
  return bindingLabel(binding, family)
    .map((part) => ('text' in part ? part.text : i18n.t(part.i18n, part.params)))
    .join('+');
}

/** Actions whose bindings conflict with another action's in a shared context. */
export function konfliktAktionen(set: BindingSet): ReadonlySet<Action> {
  const out = new Set<Action>();
  for (const c of set.allConflicts()) {
    out.add(c.action);
    out.add(c.other);
  }
  return out;
}

/** Names of the actions without any binding (`input.rebind.unboundWarning`), or null when every action has one. */
export function unbelegtText(i18n: I18n, set: BindingSet): string | null {
  const actions = unboundActions(set);
  if (actions.length === 0) return null;
  return i18n.t('input.rebind.unboundWarning', { actions: actions.map((a) => i18n.t(actionLabelKey(a))).join(', ') });
}

/** What a key event binds: the key with its held modifiers (a modifier key alone binds as a plain key). */
export function tastenBelegung(e: { readonly code: string; readonly ctrlKey: boolean; readonly shiftKey: boolean; readonly altKey: boolean; readonly metaKey?: boolean }): Binding {
  if (MODIFIER_CODES.has(e.code)) return key(e.code);
  return key(e.code, { ctrl: e.ctrlKey || e.metaKey === true, shift: e.shiftKey, alt: e.altKey });
}

/** What a mouse button binds. */
export function mausBelegung(button: number): Binding {
  return mouse(button);
}

/** What a controller button binds. */
export function padBelegung(index: number): Binding {
  return padButton(index);
}

/** Whether a captured binding belongs to `geraet` (a mouse click while the controller rows are shown does not). */
export function passtZuGeraet(binding: Binding, geraet: BindingDevice): boolean {
  const pad = binding.kind === 'padButton' || binding.kind === 'padAxis';
  return geraet === 'gamepad' ? pad : !pad;
}

/** The outcome of a rebinding. */
export type Umbelegung =
  | { readonly ok: true; readonly bindings: SerializedBindings }
  | { readonly ok: false; readonly konflikte: readonly BindingConflict[] };

/**
 * Binds `binding` to `action` in place of its first binding on the binding's device (or adds it when there is none).
 * With `policy` `reject` a conflict leaves everything as it was and is returned; `swap` and `unbindOther` resolve it
 * (`BindingSet.rebind`). Returns the new overrides.
 */
export function umbelegen(overrides: SerializedBindings, action: Action, binding: Binding, policy: ConflictPolicy): Umbelegung {
  const set = belegungAus(overrides);
  const device: BindingDevice = binding.kind === 'padButton' || binding.kind === 'padAxis' ? 'gamepad' : 'keyboardMouse';
  const replace = set.primary(action, device);
  const result = set.rebind(action, binding, replace === undefined ? { policy } : { replace, policy });
  if (!result.ok) return { ok: false, konflikte: result.conflicts };
  return { ok: true, bindings: set.serialize() };
}

/** The overrides with `action`'s bindings back at their defaults. */
export function standardFuer(overrides: SerializedBindings, action: Action): SerializedBindings {
  const set = belegungAus(overrides);
  set.reset(action);
  return set.serialize();
}
