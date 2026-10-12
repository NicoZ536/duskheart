/**
 * Preact binding of the focus manager: a screen or dialog pushes its focus scope while it is
 * mounted. The handlers are read through a ref, so they may close over the latest props and state
 * without re-pushing the scope (which would reset the focus).
 *
 * `back` (Esc, B) belongs to the scope only while its handlers name an `onBack` (`focusScopeOf`): a screen without one
 * leaves Esc to its screen stack, which closes the top screen (src/ui/focus/screens.ts; M7-99 – an `onBack` that was always
 * there and did nothing swallowed Esc on the map, the vision and the travel screen).
 */
import type { RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { FocusElement, FocusManager, FocusRoot, FocusScope } from './manager';

export type FocusScopeHandlers = Omit<FocusScope, 'root'>;

/**
 * The scope of `root` that reads its handlers from `latest` at every action: `initial` and `onAction` always (no handler:
 * nothing focused, nothing handled), `onBack` only while `latest` has one – absent otherwise, so the focus manager reports
 * `back` as not handled.
 */
export function focusScopeOf(root: FocusRoot, latest: { readonly current: FocusScopeHandlers }): FocusScope {
  const back = (): void => latest.current.onBack?.();
  return {
    root,
    initial: (): FocusElement | null => latest.current.initial?.() ?? null,
    onAction: (action, focused, index) => latest.current.onAction?.(action, focused, index) ?? false,
    get onBack(): (() => void) | undefined {
      return latest.current.onBack === undefined ? undefined : back;
    },
  };
}

export function useFocusScope(focus: FocusManager, root: RefObject<HTMLElement>, handlers: FocusScopeHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useLayoutEffect(() => {
    const el = root.current;
    if (el === null) return;
    return focus.push(focusScopeOf(el as unknown as FocusRoot, latest));
  }, [focus, root]);
}

/** The element of `root` marked with `data-fokus` and `selector` (initial focus helpers). */
export function focusable(root: RefObject<HTMLElement>, selector: string): FocusElement | null {
  const el = root.current?.querySelector(selector);
  return el instanceof HTMLElement ? (el as unknown as FocusElement) : null;
}
