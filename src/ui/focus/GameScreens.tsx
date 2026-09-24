/**
 * The screens of the running game (MASTERPROMPT §26; M3-30, M3-31, M3-26): one focus manager and one
 * screen stack for the session. The bridge's frame hook polls the menu input once per rendered frame
 * (`ScreenController.poll`), a hidden tab opens the pause menu, and every open screen renders on top
 * of the world in stack order. The death screen (`DeathScreenHost`) lies above them all while the
 * player's light is out. Later screens (crafting, map, chronicle …) add a `ScreenSpec` and a case here.
 *
 * Sounds (§2.7, `MenuHooks.klang`): a screen opening or closing, the focus frame moving (keyboard,
 * controller) and pressing a navigable element (`data-fokus`) each play their UI sound (`SCREEN_SFX`).
 */
import { useEffect, useMemo } from 'preact/hooks';
import type { I18n, Lang } from '../../i18n';
import type { UiBridge } from '../bridge';
import { InventoryScreen } from '../screens/inventar/InventoryScreen';
import type { MenuHooks } from '../screens/pause/hooks';
import { PauseMenu } from '../screens/pause/PauseMenu';
import { DeathScreenHost } from '../screens/tod/DeathScreenHost';
import type { DeathScreenModel } from '../screens/tod/model';
import { FOCUS_ATTR, FocusManager } from './manager';
import { ScreenController, type ScreenSpec } from './screens';

/** UI sounds of the screens (presets `sfx_ui_*`, src/content/sfx/oberflaeche.ts). */
export const SCREEN_SFX = { open: 'sfx_ui_oeffnen', close: 'sfx_ui_schliessen', focus: 'sfx_ui_hover', press: 'sfx_ui_klick' } as const;

/** Screens of the game: the inventory (Tab/I, D-pad up; the world keeps running) and the pause menu (Esc, Start; pauses). */
export const GAME_SCREENS: readonly ScreenSpec[] = [
  { id: 'inventar', opener: 'inventory', pauses: false },
  { id: 'pause', opener: 'pause', pauses: true },
];

/** The screen stack and focus of the page, for debug scenarios (open a screen, place the focus). */
export interface GameScreensHandle {
  readonly controller: ScreenController;
  readonly focus: FocusManager;
}

let active: GameScreensHandle | null = null;

/** The game screens of the page while they are mounted, or `null`. */
export function activeGameScreens(): GameScreensHandle | null {
  return active;
}

export interface GameScreensProps {
  readonly i18n: I18n;
  /** Language of the content texts (the death screen's cause); the i18n's language when absent. */
  readonly lang?: Lang;
  readonly bridge: UiBridge;
  readonly hooks: MenuHooks;
  /** The session's death screen (`createDeathScreenModel`), or none (pages without a player). */
  readonly death?: DeathScreenModel;
}

/** Plays the screens' sounds through `klang`; returns the function that stops listening. */
function screenSounds(controller: ScreenController, focus: FocusManager, klang: NonNullable<MenuHooks['klang']>, doc: Document): () => void {
  let depth = controller.stack.peek().length;
  const stopStack = controller.stack.subscribe((stack) => {
    if (stack.length > depth) klang.play({ id: SCREEN_SFX.open });
    else if (stack.length < depth) klang.play({ id: SCREEN_SFX.close });
    depth = stack.length;
  });
  let last = focus.focused.peek();
  const stopFocus = focus.focused.subscribe((el) => {
    // Only the focus frame moving is heard (keyboard, controller); the pointer gliding over slots is not.
    if (el !== null && el !== last && focus.keys.peek()) klang.play({ id: SCREEN_SFX.focus });
    last = el;
  });
  const onPress = (ev: Event): void => {
    const target = ev.target;
    if (target instanceof Element && target.closest(`[${FOCUS_ATTR}]`) !== null) klang.play({ id: SCREEN_SFX.press });
  };
  doc.addEventListener('click', onPress, true);
  return () => {
    stopStack();
    stopFocus();
    doc.removeEventListener('click', onPress, true);
  };
}

export function GameScreens({ i18n, lang, bridge, hooks, death }: GameScreensProps) {
  const focus = useMemo(() => new FocusManager(), []);
  const controller = useMemo(
    () =>
      new ScreenController({
        screens: GAME_SCREENS,
        focus,
        input: bridge.input,
        setPaused: hooks.setPaused,
        // The inventory belongs to the player: without one (title, debug worlds) it does not open.
        canOpen: (id) => id !== 'inventar' || (bridge.state.player.present.peek() && bridge.state.bags.peek() !== null),
        // A tab switch pauses a running game with the menu; the title and debug world views only rest.
        autoPause: () => bridge.state.player.present.peek(),
      }),
    [bridge, focus, hooks],
  );
  useEffect(() => bridge.onFrame(() => controller.poll()), [bridge, controller]);
  useEffect(() => {
    const handle: GameScreensHandle = { controller, focus };
    active = handle;
    return () => {
      if (active === handle) active = null;
    };
  }, [controller, focus]);
  useEffect(() => {
    const klang = hooks.klang;
    return klang === undefined ? undefined : screenSounds(controller, focus, klang, document);
  }, [controller, focus, hooks]);
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.hidden) controller.tabHidden();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      controller.closeAll();
    };
  }, [controller]);

  return (
    <>
      {controller.stack.value.map((id) =>
        id === 'inventar' ? (
          <InventoryScreen key={id} i18n={i18n} bridge={bridge} focus={focus} close={() => controller.close(id)} />
        ) : id === 'pause' ? (
          <PauseMenu key={id} i18n={i18n} bridge={bridge} focus={focus} hooks={hooks} close={() => controller.close(id)} />
        ) : null,
      )}
      {death === undefined ? null : <DeathScreenHost i18n={i18n} lang={lang ?? i18n.lang} model={death} focus={focus} />}
    </>
  );
}
