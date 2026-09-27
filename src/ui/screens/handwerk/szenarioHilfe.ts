/**
 * Common course of the screenshot scenarios of the workshop screens (MASTERPROMPT §31.5; `ui-handwerk`,
 * `ui-station`, `ui-station-ofen`, `ui-kiste`, `hud-tracker`): the game view at the start beach at 11:00, the
 * player spawned there with the scenario's items (given through `inventory.give`, one simulation step), then the
 * scenario's own steps – one per rendered frame, each played with the game's commands and single simulation steps
 * (deterministic: fixed seed, frozen loop) – then, optionally, a screen of the page's screen stack is opened and the
 * keyboard focus frame put on an element. Stable once the item icons are decoded. Registered in
 * src/debug/scenarios.ts (the scenario objects have the shape of its `Scenario`).
 *
 * `platzieren` sets up a station or a chest next to the player: it tries the tiles around the player one after the
 * other (the beach has stones and grass tufts) until the simulation reports the placement (`stationPlaced` /
 * `chestPlaced` in the session's event counts); ids start at 1, so the count is the new id.
 */
import type { GameCameraStart } from '../../../render/world/gameScene';
import type { RenderSceneId } from '../../../render/scenes/ids';
import type { SessionDebugState } from '../../../game/session';
import { TILE_PX } from '../../../world/model/coords';
import { activeGameScreens } from '../../focus/GameScreens';
import { atlasImagesVersion } from '../inventar/itemIcons';

/** What the scenarios need of the renderer (`ScenarioRender`). */
export interface WerkstattSzenarioRender {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
}

/** What the scenarios need of the session (`ScenarioSession`). */
export interface WerkstattSzenarioSitzung {
  command(raw: unknown): unknown;
  step(): void;
  state(): SessionDebugState;
}

/** What the scenarios need of their context (`ScenarioContext`). */
export interface WerkstattSzenarioKontext {
  freezeAt(seconds: number): void;
  readonly render?: WerkstattSzenarioRender;
  readonly session?: WerkstattSzenarioSitzung;
}

/** The scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface WerkstattSzenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: WerkstattSzenarioKontext): void;
  ready(): boolean;
}

/** One step of a scenario: returns true once it is done (it runs again on the next frame otherwise). */
export type SzenarioSchritt = (s: WerkstattSzenarioSitzung) => boolean;

export interface WerkstattSzenarioOptionen {
  readonly name: string;
  readonly description: string;
  /** Items given at the start (in this order: they fill the inventory from its first slot). */
  readonly items: ReadonlyArray<readonly [string, number]>;
  /** The scenario's own steps after the start. */
  readonly schritte: readonly SzenarioSchritt[];
  /** Screen to open afterwards (id of the screen stack), if the steps did not open one. */
  readonly bildschirm?: string;
  /** Elements clicked once the screen is open, one per frame (choosing a recipe, a quantity). */
  readonly klicks?: readonly string[];
  /** Element to put the keyboard focus frame on. */
  readonly fokus?: string;
  /** Called once when the scenario starts (e.g. to force the HUD mode). */
  readonly vorher?: () => void;
}

/** Presentation time of the frozen world (the world scenes' torch and tree phase). */
const WELT_ZEIT = 1.3;
/** Frames until the picture counts as stable (font, UI graphics, the world behind). */
const RUHE_FRAMES = 45;
/** Time of the pictures: late morning, full daylight. */
const STUNDE = 11;

type Phase = 'welt' | 'schritte' | 'oeffnen' | 'klicks' | 'fokus' | 'fertig';

/** A workshop scenario (see the module comment). */
export function werkstattSzenario(o: WerkstattSzenarioOptionen): WerkstattSzenario {
  let render: WerkstattSzenarioRender | null = null;
  let session: WerkstattSzenarioSitzung | null = null;
  let phase: Phase = 'welt';
  let schritt = 0;
  let klick = 0;
  return {
    name: o.name,
    description: o.description,
    settleFrames: RUHE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session === undefined) throw new Error(`Szenario ${o.name} braucht Renderer und Sitzung`);
      render = r;
      session = ctx.session;
      o.vorher?.();
      r.startGameCamera({ kind: 'titel' });
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(WELT_ZEIT);
    },
    ready() {
      const s = session;
      const ui = activeGameScreens();
      if (render === null || s === null || ui === null || !render.sceneReady()) return false;
      switch (phase) {
        case 'welt':
          s.command({ type: 'player.spawn' });
          s.command({ type: 'setTime', hour: STUNDE, minute: 0 });
          for (const [item, count] of o.items) s.command({ type: 'inventory.give', item, count });
          s.step();
          phase = 'schritte';
          return false;
        case 'schritte': {
          const step = o.schritte[schritt];
          if (step === undefined) {
            phase = o.bildschirm === undefined ? 'klicks' : 'oeffnen';
            return false;
          }
          if (step(s)) schritt++;
          return false;
        }
        case 'oeffnen':
          if (o.bildschirm !== undefined && !ui.controller.open(o.bildschirm)) return false;
          phase = 'klicks';
          return false;
        case 'klicks': {
          const sel = o.klicks?.[klick];
          if (sel === undefined) {
            phase = 'fokus';
            return false;
          }
          const el = document.querySelector(sel);
          if (!(el instanceof HTMLElement)) return false;
          el.click();
          klick++;
          return false;
        }
        case 'fokus': {
          if (o.fokus !== undefined) {
            const el = document.querySelector(o.fokus);
            if (!(el instanceof HTMLElement)) return false;
            ui.focus.keysUsed();
            ui.focus.focus(el);
          }
          phase = 'fertig';
          return false;
        }
        case 'fertig':
          return atlasImagesVersion.value > 0;
      }
    },
  };
}

/** Tile offsets around the player tried for a placement, nearest first. */
const VERSUCHE: ReadonlyArray<readonly [number, number]> = [
  [1, -2],
  [-2, -2],
  [1, 1],
  [-2, 1],
  [2, -1],
  [-3, -1],
  [0, 2],
  [0, -3],
  [3, 0],
  [-4, 0],
  [2, 2],
  [-3, 2],
];

/** Event whose count tells that a placement succeeded. */
type PlatzEreignis = 'stationPlaced' | 'chestPlaced';

/**
 * A step that sets something up next to the player with `befehl(tx, ty)` (one try per frame) until the event count
 * `ereignis` rose; `fertig(id)` receives the new id. Throws when no tile around the player takes it.
 */
export function platzieren(befehl: (tx: number, ty: number) => unknown, ereignis: PlatzEreignis, fertig: (id: number) => void): SzenarioSchritt {
  let versuch = 0;
  let vorher = -1;
  return (s) => {
    const st = s.state();
    const zahl = st.events[ereignis];
    if (vorher >= 0 && zahl > vorher) {
      fertig(zahl);
      return true;
    }
    const at = st.player;
    if (at === null) return false;
    const off = VERSUCHE[versuch++];
    if (off === undefined) throw new Error(`Szenario: kein freier Platz für ${ereignis} neben dem Spieler`);
    vorher = zahl;
    s.command(befehl(Math.floor(at.x / TILE_PX) + off[0], Math.floor(at.y / TILE_PX) + off[1]));
    s.step();
    return false;
  };
}

/** A step that runs `n` simulation steps (spread over frames, `jeFrame` at a time). */
export function schritte(n: number, jeFrame = n): SzenarioSchritt {
  let gelaufen = 0;
  return (s) => {
    const k = Math.min(jeFrame, n - gelaufen);
    for (let i = 0; i < k; i++) s.step();
    gelaufen += k;
    return gelaufen >= n;
  };
}

/** A step that sends `befehle` and runs one simulation step. */
export function befehle(...cmds: unknown[]): SzenarioSchritt {
  return (s) => {
    for (const c of cmds) s.command(c);
    s.step();
    return true;
  };
}
