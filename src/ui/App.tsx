/**
 * Root of the DOM overlay above the WebGL canvas (MASTERPROMPT §3.1, §26). It renders the current
 * screen: the message for a missing WebGL2 context, or – while the game runs – the title card and
 * the status line with day and time of day. Components read simulation state only through the
 * bridge signals (`./bridge`) and change it only through `bridge.actions`.
 */
import type { ReadonlySignal } from '@preact/signals';
import type { I18n, Lang } from '../i18n';
import { formatGameTime } from '../i18n/format';
import type { UiBridge } from './bridge';
import { NoWebGl2 } from './NoWebGl2';
import { TitleCard } from './TitleCard';

/** What the overlay shows. */
export type AppScreen = { readonly kind: 'webgl2Missing' } | { readonly kind: 'game'; readonly bridge: UiBridge };

export interface AppProps {
  readonly i18n: I18n;
  /** Current UI language; a change re-renders every text. */
  readonly lang: ReadonlySignal<Lang>;
  readonly screen: AppScreen;
}

export interface StatusLineProps {
  readonly i18n: I18n;
  readonly lang: Lang;
  readonly bridge: UiBridge;
}

/** Day and time of day of the running world ("Tag 1 · 06:00"); re-renders once per game minute. */
export function StatusLine({ i18n, lang, bridge }: StatusLineProps) {
  const { day, minuteOfDay } = bridge.state;
  return (
    <p class="dh-status" data-testid="ui-status">
      {i18n.t('ui.status.dayTime', { day: day.value, time: formatGameTime(lang, minuteOfDay.value) })}
    </p>
  );
}

export function App({ i18n, lang, screen }: AppProps) {
  // Reading the signal subscribes the root, so switching the language re-renders all screens.
  const current = lang.value;
  if (screen.kind === 'webgl2Missing') return <NoWebGl2 i18n={i18n} />;
  return (
    <>
      <TitleCard i18n={i18n} />
      <StatusLine i18n={i18n} lang={current} bridge={screen.bridge} />
    </>
  );
}
