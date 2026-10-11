/**
 * The screen stack of the running game with its one-shot requests (MASTERPROMPT §26; ADR-0235, M7-90): the part of
 * `GameScreens` that needs no DOM, so unit tests drive it with the events and the menu input of a fake bridge.
 *
 * The station's, the chest's and the hearth's screen, the vision of a lit beacon and the travel screen share E
 * (`interact`) as their opener, but open only on their simulation event (`stationOpened`, `chestOpened`,
 * `hearthOpened`, `beaconLit`, `travelOpened`): the event's handler raises a one-shot request around its `open`
 * and drops it right after. E alone never opens them – it only closes the top one. Their signals keep the id of the
 * last station, chest, hearth or beacon for the screen's key; without the request E would open the screen of the
 * station, chest or hearth used last from anywhere (M7-90).
 */
import { signal, type ReadonlySignal } from '@preact/signals';
import type { UiBridge } from '../bridge';
import { BAU_SCREEN } from '../screens/bau/BauModus';
import { CHRONIK_SCREEN } from '../screens/chronik/ChronikScreen';
import { PERKWAHL_SCREEN } from '../screens/perkwahl/PerkwahlScreen';
import { HERD_SCREEN } from '../screens/herdfeuer/HerdfeuerScreen';
import { KARTE_SCREEN } from '../screens/karte/KarteScreen';
import { REISEN_SCREEN } from '../screens/reisen/ReisenScreen';
import { VISION_SCREEN } from '../screens/vision/VisionScreen';
import type { FocusManager } from './manager';
import { ScreenController, type ScreenId, type ScreenSpec } from './screens';

/** What the screen control reads from the bridge (a `UiBridge` fits; tests pass a small fake). */
export interface GameScreenBridge {
  readonly state: {
    readonly player: Pick<UiBridge['state']['player'], 'present' | 'health'>;
    readonly bags: ReadonlySignal<object | null>;
  };
  readonly input: UiBridge['input'];
  readonly werkstatt: object | null;
  readonly basis: object | null;
  readonly leuchtfeuer: object | null;
  readonly orte: { readonly sampleMap?: unknown } | null;
  /** The chronicle's samples (M7-41, strand G); absent in fakes without it. */
  readonly chronik?: object | null;
  readonly onEvent: UiBridge['onEvent'];
}

export interface GameScreenControlOptions {
  readonly screens: readonly ScreenSpec[];
  readonly bridge: GameScreenBridge;
  readonly focus: FocusManager;
  readonly setPaused?: (paused: boolean) => void;
  /** Whether the page has a build mode (its record shared with the game view, M4-22). */
  readonly hasBuild: boolean;
  /** Clock for key repeat [ms] (tests); default `performance.now`. */
  readonly now?: () => number;
}

/** The screens that open only on their event (one-shot request), keyed by the request's name. */
interface Requests {
  station: boolean;
  kiste: boolean;
  herd: boolean;
  vision: boolean;
  reisen: boolean;
  perkwahl: boolean;
}

export interface GameScreenControl {
  readonly controller: ScreenController;
  /** The station the player used last (`stationOpened`): the key of its screen. */
  readonly station: ReadonlySignal<number | null>;
  /** The chest the player opened last (`chestOpened`). */
  readonly kiste: ReadonlySignal<number | null>;
  /** The hearth the player opened last (`hearthOpened`). */
  readonly herd: ReadonlySignal<number | null>;
  /** The beacon whose vision shows (`beaconLit`). */
  readonly vision: ReadonlySignal<number | null>;
  /** Opens the perk choice from the chronicle (its open choices wait there, M7-48). */
  perkwahl(): void;
  /**
   * Subscribes the perk choice to `perkChoiceOpened` (M7-48, strand G: a skill reached 30, 60 or 90 – the choice opens, pausing,
   * on top of what is open); returns the function that stops listening. Apart from `connect`, which keeps the five screens
   * of M7-90.
   */
  connectPerkwahl(): () => void;
  /** Subscribes to the opening events; returns the function that stops listening. */
  connect(): () => void;
}

/** Builds the screen stack of the game and the one-shot requests of the screens that open on an event. */
export function createGameScreenControl(options: GameScreenControlOptions): GameScreenControl {
  const { bridge, hasBuild } = options;
  const station = signal<number | null>(null);
  const kiste = signal<number | null>(null);
  const herd = signal<number | null>(null);
  const vision = signal<number | null>(null);
  const angefragt: Requests = { station: false, kiste: false, herd: false, vision: false, reisen: false, perkwahl: false };
  const player = bridge.state.player;
  const canOpen = (id: ScreenId): boolean =>
    id === VISION_SCREEN
      ? angefragt.vision && vision.peek() !== null && bridge.leuchtfeuer !== null
      : id === REISEN_SCREEN
      ? angefragt.reisen && bridge.leuchtfeuer !== null
      : id === KARTE_SCREEN
      ? bridge.orte?.sampleMap !== undefined && player.present.peek()
      : id === CHRONIK_SCREEN
      ? (bridge.chronik ?? null) !== null && player.present.peek()
      : id === PERKWAHL_SCREEN
      ? angefragt.perkwahl && (bridge.chronik ?? null) !== null && player.present.peek()
      : id === HERD_SCREEN
      ? angefragt.herd && herd.peek() !== null && bridge.basis !== null
      : id === BAU_SCREEN
      ? hasBuild && player.present.peek() && player.health.peek() > 0
      : id === 'station'
      ? angefragt.station && station.peek() !== null && bridge.werkstatt !== null
      : id === 'kiste'
      ? angefragt.kiste && kiste.peek() !== null && bridge.werkstatt !== null
      : // The inventory and crafting belong to the player: without one (title, debug worlds) they do not open.
        (id !== 'inventar' && id !== 'handwerk') || (player.present.peek() && bridge.state.bags.peek() !== null && (id !== 'handwerk' || bridge.werkstatt !== null));
  const controller = new ScreenController({
    screens: options.screens,
    focus: options.focus,
    input: bridge.input,
    setPaused: options.setPaused,
    canOpen,
    // A tab switch pauses a running game with the menu; the title and debug world views only rest.
    autoPause: () => player.present.peek(),
    now: options.now,
  });
  /** Opens `id` for this one call only: the request is raised around `open` and dropped right after. */
  const request = (name: keyof Requests, id: ScreenId): void => {
    angefragt[name] = true;
    try {
      controller.open(id);
    } finally {
      angefragt[name] = false;
    }
  };
  return {
    controller,
    station,
    kiste,
    herd,
    vision,
    perkwahl: () => request('perkwahl', PERKWAHL_SCREEN),
    connectPerkwahl: () => bridge.onEvent('perkChoiceOpened', () => request('perkwahl', PERKWAHL_SCREEN)),
    connect() {
      const stops = [
        bridge.onEvent('stationOpened', (e) => {
          station.value = e.id;
          request('station', 'station');
        }),
        bridge.onEvent('chestOpened', (e) => {
          kiste.value = e.chest;
          request('kiste', 'kiste');
        }),
        bridge.onEvent('hearthOpened', (e) => {
          herd.value = e.hearth;
          request('herd', HERD_SCREEN);
        }),
        bridge.onEvent('beaconLit', (e) => {
          vision.value = e.beacon;
          request('vision', VISION_SCREEN);
        }),
        bridge.onEvent('travelOpened', () => request('reisen', REISEN_SCREEN)),
      ];
      return () => {
        for (const stop of stops) stop();
      };
    },
  };
}
