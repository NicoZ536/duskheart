/**
 * The screens of the running game (MASTERPROMPT §26; M3-30, M3-31, M3-26): one focus manager and one
 * screen stack for the session. The bridge's frame hook polls the menu input once per rendered frame
 * (`ScreenController.poll`), a hidden tab opens the pause menu, and every open screen renders on top
 * of the world in stack order. The death screen (`DeathScreenHost`) lies above them all while the
 * player's light is out. The crafting menu opens with C (M4-32), a station's screen when the player uses it
 * (the simulation's `stationOpened`, M4-07), a chest's screen when the player opens it (`chestOpened`, M4-21), a
 * hearth's screen when the player opens it (`hearthOpened`, M4-20), the
 * build mode with B (M4-22) – a screen in input context `build` that keeps the world playable and the HUD shown.
 * Later screens (map, chronicle …) add a `ScreenSpec` and a case here.
 *
 * Sounds (§2.7, `MenuHooks.klang`): a screen opening or closing, the focus frame moving (keyboard,
 * controller) and pressing a navigable element (`data-fokus`) each play their UI sound (`SCREEN_SFX`).
 */
import { useSignal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';
import type { I18n, Lang } from '../../i18n';
import type { UiBridge } from '../bridge';
import { HandwerkScreen } from '../screens/handwerk/HandwerkScreen';
import { InventoryScreen } from '../screens/inventar/InventoryScreen';
import { KisteScreen } from '../screens/kiste/KisteScreen';
import { HERD_SCREEN, HerdfeuerScreen } from '../screens/herdfeuer/HerdfeuerScreen';
import type { MenuHooks } from '../screens/pause/hooks';
import { PauseMenu } from '../screens/pause/PauseMenu';
import { BAU_SCREEN, BauModus } from '../screens/bau/BauModus';
import type { BuildGhost } from '../../render/game/ghost';
import { StationScreen } from '../screens/station/StationScreen';
import { DeathScreenHost } from '../screens/tod/DeathScreenHost';
import { VISION_SCREEN, VisionScreen } from '../screens/vision/VisionScreen';
import { REISEN_SCREEN, ReisenScreen } from '../screens/reisen/ReisenScreen';
import { KARTE_SCREEN, KarteScreen } from '../screens/karte/KarteScreen';
import type { DeathScreenModel } from '../screens/tod/model';
import { FOCUS_ATTR, FocusManager } from './manager';
import { ScreenController, type ScreenSpec } from './screens';

/** UI sounds of the screens (presets `sfx_ui_*`, src/content/sfx/oberflaeche.ts). */
export const SCREEN_SFX = { open: 'sfx_ui_oeffnen', close: 'sfx_ui_schliessen', focus: 'sfx_ui_hover', press: 'sfx_ui_klick' } as const;

/**
 * Screens of the game: the inventory (Tab/I, D-pad up; the world keeps running), the crafting menu (C, D-pad right),
 * a station's, a chest's and a hearth's screen (opened by using the station, chest or hearth; E is their opener only
 * so it can close them) and the pause menu (Esc, Start; pauses).
 */
export const GAME_SCREENS: readonly ScreenSpec[] = [
  { id: 'inventar', opener: 'inventory', pauses: false },
  { id: 'handwerk', opener: 'crafting', pauses: false },
  { id: 'station', opener: 'interact', pauses: false },
  { id: 'kiste', opener: 'interact', pauses: false },
  { id: HERD_SCREEN, opener: 'interact', pauses: false },
  // The build mode (B, D-pad down; M4-22) lies over the world in context `build` – walking and placing stay –; B or Esc leave it.
  { id: BAU_SCREEN, opener: 'build', pauses: false, context: 'build', closers: ['pause'] },
  { id: 'pause', opener: 'pause', pauses: true },
  // Strand F (M7-35, M7-37): the vision of a lit beacon (opens on `beaconLit`, pauses) and the travel screen (opens on
  // `travelOpened`, E at a travel point; E closes it).
  { id: VISION_SCREEN, opener: 'interact', pauses: true },
  { id: REISEN_SCREEN, opener: 'interact', pauses: false },
  // Strand B (M7-49): the map – M opens and closes it, the world runs on.
  { id: KARTE_SCREEN, opener: 'map', pauses: false },
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
  /** The build mode's record shared with the game view (M4-22); without it the build mode does not open. */
  readonly bau?: BuildGhost;
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

export function GameScreens({ i18n, lang, bridge, hooks, death, bau }: GameScreensProps) {
  const focus = useMemo(() => new FocusManager(), []);
  // The station the player used last (`stationOpened`); its screen opens only for one.
  const station = useSignal<number | null>(null);
  // The chest the player opened last (`chestOpened`).
  const kiste = useSignal<number | null>(null);
  // The hearth the player opened last (`hearthOpened`).
  const herd = useSignal<number | null>(null);
  // The beacon whose vision shows (`beaconLit`).
  const vision = useSignal<number | null>(null);
  // Strand F: the vision and the travel screen open only on their event (`beaconLit`, `travelOpened`) – never on E alone,
  // their opener, which only closes them (one-shot requests, consumed by `canOpen`).
  const angefragt = useMemo(() => ({ vision: false, reisen: false }), []);
  const controller = useMemo(
    () =>
      new ScreenController({
        screens: GAME_SCREENS,
        focus,
        input: bridge.input,
        setPaused: hooks.setPaused,
        // The inventory and crafting belong to the player: without one (title, debug worlds) they do not open; a
        // station's screen only for a station the player used.
        canOpen: (id) =>
          id === VISION_SCREEN
            ? angefragt.vision && vision.peek() !== null && bridge.leuchtfeuer !== null
            : id === REISEN_SCREEN
            ? angefragt.reisen && bridge.leuchtfeuer !== null
            : id === KARTE_SCREEN
            ? bridge.orte?.sampleMap !== undefined && bridge.state.player.present.peek()
            : id === HERD_SCREEN
            ? herd.peek() !== null && bridge.basis !== null
            : id === BAU_SCREEN
            ? bau !== undefined && bridge.state.player.present.peek() && bridge.state.player.health.peek() > 0
            : id === 'station' || id === 'kiste'
            ? (id === 'station' ? station : kiste).peek() !== null && bridge.werkstatt !== null
            : (id !== 'inventar' && id !== 'handwerk') || (bridge.state.player.present.peek() && bridge.state.bags.peek() !== null && (id !== 'handwerk' || bridge.werkstatt !== null)),
        // A tab switch pauses a running game with the menu; the title and debug world views only rest.
        autoPause: () => bridge.state.player.present.peek(),
      }),
    [bridge, focus, hooks, station, kiste, herd, vision, bau, angefragt],
  );
  useEffect(() => bridge.onFrame(() => controller.poll()), [bridge, controller]);
  useEffect(
    () =>
      bridge.onEvent('stationOpened', (e) => {
        station.value = e.id;
        controller.open('station');
      }),
    [bridge, controller, station],
  );
  useEffect(
    () =>
      bridge.onEvent('chestOpened', (e) => {
        kiste.value = e.chest;
        controller.open('kiste');
      }),
    [bridge, controller, kiste],
  );
  useEffect(
    () =>
      bridge.onEvent('hearthOpened', (e) => {
        herd.value = e.hearth;
        controller.open(HERD_SCREEN);
      }),
    [bridge, controller, herd],
  );
  useEffect(
    () =>
      bridge.onEvent('beaconLit', (e) => {
        vision.value = e.beacon;
        angefragt.vision = true;
        controller.open(VISION_SCREEN);
        angefragt.vision = false;
      }),
    [bridge, controller, vision, angefragt],
  );
  useEffect(
    () =>
      bridge.onEvent('travelOpened', () => {
        angefragt.reisen = true;
        controller.open(REISEN_SCREEN);
        angefragt.reisen = false;
      }),
    [bridge, controller, angefragt],
  );
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
        ) : id === 'handwerk' ? (
          <HandwerkScreen key={id} i18n={i18n} bridge={bridge} focus={focus} close={() => controller.close(id)} />
        ) : id === 'station' && station.value !== null ? (
          <StationScreen key={`${id}:${station.value}`} i18n={i18n} bridge={bridge} focus={focus} station={station.value} close={() => controller.close(id)} />
        ) : id === 'kiste' && kiste.value !== null ? (
          <KisteScreen key={`${id}:${kiste.value}`} i18n={i18n} bridge={bridge} focus={focus} kiste={kiste.value} close={() => controller.close(id)} />
        ) : id === HERD_SCREEN && herd.value !== null ? (
          <HerdfeuerScreen key={`${id}:${herd.value}`} i18n={i18n} bridge={bridge} focus={focus} herd={herd.value} close={() => controller.close(id)} />
        ) : id === BAU_SCREEN && bau !== undefined ? (
          <BauModus key={id} i18n={i18n} bridge={bridge} focus={focus} ghost={bau} oben={() => controller.top() === BAU_SCREEN} close={() => controller.close(id)} />
        ) : id === VISION_SCREEN && vision.value !== null ? (
          <VisionScreen key={`${id}:${vision.value}`} i18n={i18n} bridge={bridge} focus={focus} beacon={vision.value} close={() => controller.close(id)} />
        ) : id === REISEN_SCREEN ? (
          <ReisenScreen key={id} i18n={i18n} bridge={bridge} focus={focus} close={() => controller.close(id)} />
        ) : id === KARTE_SCREEN ? (
          <KarteScreen key={id} i18n={i18n} bridge={bridge} focus={focus} close={() => controller.close(id)} />
        ) : id === 'pause' ? (
          <PauseMenu key={id} i18n={i18n} bridge={bridge} focus={focus} hooks={hooks} close={() => controller.close(id)} />
        ) : null,
      )}
      {death === undefined ? null : <DeathScreenHost i18n={i18n} lang={lang ?? i18n.lang} model={death} focus={focus} />}
    </>
  );
}
