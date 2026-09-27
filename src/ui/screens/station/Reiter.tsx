/**
 * Tabs of the station and chest screens (MASTERPROMPT §26 "eigener Pixel-UI-Look …, keine Standard-Web-Widgets"):
 * wooden folder tabs in the pixel font – the chosen one lighter with its name in the accent colour, a count in a dark
 * chip (the pieces to repair). Every tab is a navigable element (`data-fokus`): the pointer clicks it, keys and the
 * controller walk to it with the focus frame and confirm it.
 *
 * A text field keeps the keyboard's keys for typing (the game's input ignores them there, src/engine/input/dom.ts), so
 * the focus frame could not walk up out of a search field below the tabs: `nachObenZumReiter` – a key handler of the
 * screen's root in the capture phase – takes ↑ in a text field to the chosen tab.
 */
import type { FocusElement, FocusManager } from '../../focus/manager';

export interface ReiterEintrag<T extends string> {
  readonly id: T;
  readonly label: string;
  /** A count after the name (omitted for 0). */
  readonly zahl?: number;
  readonly testId: string;
}

export interface ReiterProps<T extends string> {
  readonly eintraege: readonly ReiterEintrag<T>[];
  readonly aktiv: T;
  readonly waehlen: (id: T) => void;
  /** Accessible name of the tab list, already translated. */
  readonly label: string;
  readonly class?: string;
}

export function Reiter<T extends string>({ eintraege, aktiv, waehlen, label, class: extra }: ReiterProps<T>) {
  return (
    <div class={['dh-reiter', extra ?? ''].filter(Boolean).join(' ')} role="tablist" aria-label={label}>
      {eintraege.map((e) => (
        <button type="button" key={e.id} role="tab" class="dh-reiter__tab" aria-selected={e.id === aktiv} data-fokus="" data-reiter={e.id} data-testid={e.testId} onClick={() => waehlen(e.id)}>
          <span>{e.label}</span>
          {e.zahl !== undefined && e.zahl > 0 ? (
            <span class="dh-reiter__zahl" data-testid={`${e.testId}-zahl`}>
              {e.zahl}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** Handles ↑ in a text field inside `root`: the focus frame goes to the chosen tab (see the module comment); returns whether it did. */
export function nachObenZumReiter(e: KeyboardEvent, root: HTMLElement | null, focus: FocusManager): boolean {
  if (e.key !== 'ArrowUp' || !(e.target instanceof HTMLInputElement) || root === null) return false;
  const tab = root.querySelector('.dh-reiter__tab[aria-selected="true"]');
  if (!(tab instanceof HTMLElement)) return false;
  e.preventDefault();
  e.target.blur();
  focus.keysUsed();
  focus.focus(tab as unknown as FocusElement);
  return true;
}
