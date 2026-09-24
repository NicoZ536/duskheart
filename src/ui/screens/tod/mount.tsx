/**
 * Mounts the death screen on its own layer above the page (the screenshot scenario `todesbildschirm`,
 * outside the overlay that screenshot mode hides): a `DeathScreen` with its own focus manager in keyboard
 * mode, so the focus frame shows on the first place to wake. `ready` once the pixel font is loaded and two
 * frames are painted.
 */
import { render } from 'preact';
import type { RespawnSpot } from '../../../game/death/events';
import type { I18n } from '../../../i18n';
import { loadUiFont } from '../../font';
import { FocusManager } from '../../focus/manager';
import { DeathScreen } from './DeathScreen';
import type { DeathView } from './model';

/** Frames painted after the font loaded before the picture counts as stable. */
const PAINT_FRAMES = 2;
/** Stacking order of the layer above the game view and its overlay. */
const LAYER_Z = '10';

/** A mounted death screen. */
export interface DeathScreenHandle {
  readonly ready: boolean;
  dispose(): void;
}

function nextFrame(win: Window): Promise<void> {
  return new Promise((resolve) => win.requestAnimationFrame(() => resolve()));
}

/** Shows `view` on a layer of `doc`; `onRespawn` receives the chosen place. */
export function mountDeathScreen(doc: Document, i18n: I18n, view: DeathView, onRespawn: (at: RespawnSpot) => void): DeathScreenHandle {
  const host = doc.body.appendChild(doc.createElement('div'));
  host.className = 'dh-tod-ebene';
  Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: LAYER_Z });
  const focus = new FocusManager();
  const state = { ready: false };
  render(<DeathScreen i18n={i18n} lang={i18n.lang} view={view} focus={focus} onRespawn={onRespawn} />, host);
  const win = doc.defaultView;
  const prepare = async (): Promise<void> => {
    await loadUiFont(doc.fonts);
    focus.keysUsed();
    const first = host.querySelector('[data-standard]');
    if (first instanceof HTMLElement) focus.focus(first);
    if (win !== null) for (let i = 0; i < PAINT_FRAMES; i++) await nextFrame(win);
    state.ready = true;
  };
  prepare().catch((err: unknown) => console.error(`Todesbildschirm: ${err instanceof Error ? err.message : String(err)}`));
  return {
    get ready() {
      return state.ready;
    },
    dispose() {
      render(null, host);
      host.remove();
    },
  };
}
