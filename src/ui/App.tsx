/**
 * Root of the DOM overlay above the WebGL canvas (MASTERPROMPT §3.1, §26). It renders the current
 * screen: the message for a missing WebGL2 context, the main menu over its scene (M7-50: main menu, world selection,
 * new world, settings – src/ui/menu/MenuApp.tsx), or – while the game runs – the title card (a game booted directly
 * by the debug tools) or the loading screen (a game started from the menu, M7-50), the
 * HUD while the player exists (`Hud`: survival values, conditions, hotbar, interaction hint, minimap and
 * notifications; M3-27), otherwise the status line with day and time of day, and the game's menu screens
 * (inventory, pause menu, the death screen: `GameScreens`). Components read simulation state only through the
 * bridge signals (`./bridge`) and change it only through `bridge.actions`.
 */
import type { ReadonlySignal } from '@preact/signals';
import type { I18n, Lang } from '../i18n';
import { formatGameTime } from '../i18n/format';
import type { UiBridge } from './bridge';
import { GameScreens } from './focus/GameScreens';
import type { HauptmenueHooks } from './menu/hooks';
import { MenuApp } from './menu/MenuApp';
import { Ladebildschirm, type LadeQuelle } from './screens/laden/Ladebildschirm';
import { Hud } from './hud/Hud';
import type { HudWeltdienste } from './hud/minimap/Weltanzeigen';
import { NoWebGl2 } from './NoWebGl2';
import type { MenuHooks } from './screens/pause/hooks';
import type { DeathScreenModel } from './screens/tod/model';
import { Untertitel, type UntertitelQuelle } from './hud/Untertitel';
import { TitleCard } from './TitleCard';
import type { BuildGhost } from '../render/game/ghost';

/**
 * Progress of the world generation (M2-14 steps) for the title card, or why it failed; `null` once
 * the world is ready.
 */
export type WorldLoadingView =
  | {
      readonly kind: 'step';
      /** Step that runs now (`WORLD_GEN_STEPS`), e.g. `weltplan`. */
      readonly step: string;
      readonly index: number;
      readonly count: number;
    }
  | {
      readonly kind: 'failed';
      /** Technical reason (shown after the translated sentence). */
      readonly error: string;
    };

/** What the overlay shows. */
export type AppScreen =
  | { readonly kind: 'webgl2Missing' }
  | {
      /** The main menu over the menu scene (M7-50); the bridge of the menu session carries its input. */
      readonly kind: 'menu';
      readonly bridge: UiBridge;
      readonly hooks: HauptmenueHooks;
    }
  | {
      readonly kind: 'game';
      readonly bridge: UiBridge;
      readonly worldLoading?: ReadonlySignal<WorldLoadingView | null>;
      /** Hooks of the game's menus (settings, pause, save, back to the title; M3-31). */
      readonly menus?: MenuHooks;
      /** Minimap, compass bar and notifications of the session for the HUD (M3-28/M3-29, `hudWeltdienste`). */
      readonly hudWelt?: HudWeltdienste;
      /** The session's death screen (M3-26, `createDeathScreenModel`). */
      readonly death?: DeathScreenModel;
      /** Subtitles of important sounds (the audio kernel, M3-33; shown while `audio.subtitles` is on). */
      readonly untertitel?: UntertitelQuelle;
      /** The build mode's record shared with the game view (M4-22, `BuildGhost`); without it there is no build mode. */
      readonly bau?: BuildGhost;
      /** The loading screen of a game started from the menu (M7-50); without it the title card shows the progress. */
      readonly laden?: LadeQuelle;
    };

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

/** Menus without hooks (tests, pages without settings or saving): only the entries that need none. */
const NO_MENU_HOOKS: MenuHooks = {};

export function App({ i18n, lang, screen }: AppProps) {
  // Reading the signal subscribes the root, so switching the language re-renders all screens.
  const current = lang.value;
  if (screen.kind === 'webgl2Missing') return <NoWebGl2 i18n={i18n} />;
  if (screen.kind === 'menu') return <MenuApp i18n={i18n} bridge={screen.bridge} hooks={screen.hooks} />;
  return (
    <>
      {screen.laden === undefined ? <TitleCard i18n={i18n} loading={screen.worldLoading?.value ?? null} /> : null}
      {/* With a player the HUD shows day and time in the minimap's plate and disc (the line would lie under the minimap). */}
      {screen.bridge.state.player.present.value ? null : <StatusLine i18n={i18n} lang={current} bridge={screen.bridge} />}
      <Hud i18n={i18n} lang={current} bridge={screen.bridge} settings={screen.menus?.settings} welt={screen.hudWelt ?? null} />
      {screen.untertitel === undefined ? null : <Untertitel quelle={screen.untertitel} lang={current} />}
      <GameScreens i18n={i18n} lang={current} bridge={screen.bridge} hooks={screen.menus ?? NO_MENU_HOOKS} death={screen.death} bau={screen.bau} />
      {screen.laden === undefined ? null : <Ladebildschirm i18n={i18n} quelle={screen.laden} />}
    </>
  );
}
