/**
 * UI layer entry point (MASTERPROMPT §3.2 `src/ui`): Preact components of the DOM overlay, the
 * signals bridge to the game session and the theme. The composition root (`src/main.tsx`) mounts
 * the overlay with `mountApp`; besides src/ui only the developer views in src/debug import Preact
 * (ESLint `no-restricted-imports`, ADR-0010).
 */
import { signal } from '@preact/signals';
import { h, render } from 'preact';
import type { I18n } from '../i18n';
import { App, type AppScreen } from './App';

export { App, StatusLine, type AppProps, type AppScreen, type StatusLineProps } from './App';
export { createUiBridge, type CommandRejection, type ControlledView, type UiActions, type UiBridge, type UiBridgeSession, type UiState } from './bridge';
export {
  MAX_UI_SCALE,
  MIN_UI_SCALE,
  THEME_COLORS,
  THEME_VARS,
  UI_REFERENCE_HEIGHT,
  UI_REFERENCE_WIDTH,
  UI_SCALE_VAR,
  applyThemeColors,
  autoUiScale,
  createTheme,
  devicePixelScale,
  resolveUiScale,
  themeColorVar,
  type StyleTarget,
  type Theme,
  type ThemeOptions,
  type UiColorName,
  type UiScale,
  type UiScaleSetting,
} from './theme';

export interface MountAppOptions {
  readonly i18n: I18n;
  readonly screen: AppScreen;
}

/** Renders the overlay into `host` and follows language changes. Returns a function that unmounts it. */
export function mountApp(host: Element, { i18n, screen }: MountAppOptions): () => void {
  const lang = signal(i18n.lang);
  const stopLang = i18n.onChange((next) => {
    lang.value = next;
  });
  render(h(App, { i18n, lang, screen }), host);
  return () => {
    stopLang();
    render(null, host);
  };
}
