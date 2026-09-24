/**
 * Preact binding of the focus manager: a screen or dialog pushes its focus scope while it is
 * mounted. The handlers are read through a ref, so they may close over the latest props and state
 * without re-pushing the scope (which would reset the focus).
 */
import type { RefObject } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { FocusElement, FocusManager, FocusRoot, FocusScope } from './manager';

export type FocusScopeHandlers = Omit<FocusScope, 'root'>;

export function useFocusScope(focus: FocusManager, root: RefObject<HTMLElement>, handlers: FocusScopeHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useLayoutEffect(() => {
    const el = root.current;
    if (el === null) return;
    return focus.push({
      root: el as unknown as FocusRoot,
      initial: (): FocusElement | null => latest.current.initial?.() ?? null,
      onAction: (action, focused, index) => latest.current.onAction?.(action, focused, index) ?? false,
      onBack: () => latest.current.onBack?.(),
    });
  }, [focus, root]);
}

/** The element of `root` marked with `data-fokus` and `selector` (initial focus helpers). */
export function focusable(root: RefObject<HTMLElement>, selector: string): FocusElement | null {
  const el = root.current?.querySelector(selector);
  return el instanceof HTMLElement ? (el as unknown as FocusElement) : null;
}
