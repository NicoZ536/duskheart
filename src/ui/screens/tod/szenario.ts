/**
 * Screenshot scenario `todesbildschirm` (M3-26, MASTERPROMPT §31.5): the game view at the start beach,
 * the player spawned there and killed (`death.kill`, one simulation step: the body lies at the place of
 * death), and over it the death screen of a death on Normal with a bed set as respawn point – the cause
 * the cold, nine stacks in the grave, "Erschüttert" and the skill loss of §29, the bed focused by keyboard.
 * Registered in src/debug/scenarios.ts; stable once the world is drawn and the screen's font is ready.
 */
import { BALANCE } from '../../../content/balance';
import type { GameCameraStart } from '../../../render/world/gameScene';
import type { RenderSceneId } from '../../../render/scenes/ids';
import { createI18n, FALLBACK_LANG, isLang } from '../../../i18n';
import { mountDeathScreen, type DeathScreenHandle } from './mount';
import type { DeathView } from './model';

/** Name of the scenario. */
export const DEATH_SCREEN_SCENARIO = 'todesbildschirm';
/** Presentation time of the frozen world picture [s] (the world scenes' torch and tree phase). */
const WORLD_TIME = 1.3;
/** Frames until the picture counts as stable (font, UI graphics, the world behind). */
const SETTLE_FRAMES = 45;

/** The death the screenshot shows: the cold on Normal, a grave of nine stacks, bed and beach to wake at. */
export const DEATH_SCREEN_EXAMPLE: DeathView = {
  cause: 'kaelte',
  grave: 1,
  graveItems: 9,
  penalty: BALANCE.death.penalties.normal,
  spots: ['bett', 'strand'],
};

/** What the scenario needs of the renderer (`ScenarioRender`). */
interface ScenarioRenderPart {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
}

/** What the scenario needs of its context (`ScenarioContext`). */
interface DeathScenarioContext {
  freezeAt(seconds: number): void;
  readonly render?: ScenarioRenderPart;
  readonly session?: { command(raw: unknown): unknown; step(): void };
}

/** The scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export function deathScreenScenario(): {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: DeathScenarioContext): void;
  ready(): boolean;
} {
  let render: ScenarioRenderPart | null = null;
  let session: NonNullable<DeathScenarioContext['session']> | null = null;
  let screen: DeathScreenHandle | null = null;
  return {
    name: DEATH_SCREEN_SCENARIO,
    description:
      'M3-26: Todesbildschirm über dem Startstrand – „Dein Licht ist erloschen.“, Ursache Kälte, Folgen auf Normal (Grab mit 9 Stapeln am Todesort, Ausrüstung bleibt, 3 min Erschüttert −15 % max. Leben, −25 % Fertigkeitsfortschritt), Erwachen am Bett (Fokusrahmen) oder am Startstrand',
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session === undefined) throw new Error(`Szenario ${DEATH_SCREEN_SCENARIO} braucht Renderer und Sitzung`);
      render = r;
      session = ctx.session;
      r.startGameCamera({ kind: 'titel' });
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(WORLD_TIME);
    },
    ready() {
      if (render === null || session === null || !render.sceneReady()) return false;
      if (screen === null) {
        session.command({ type: 'player.spawn' });
        session.command({ type: 'death.kill' });
        session.step();
        const lang = document.documentElement.lang;
        const i18n = createI18n(isLang(lang) ? lang : FALLBACK_LANG);
        i18n.onMissing((key, l) => console.error(`i18n: Schlüssel „${key}“ fehlt (${l})`));
        screen = mountDeathScreen(document, i18n, DEATH_SCREEN_EXAMPLE, () => undefined);
        return false;
      }
      return screen.ready;
    },
  };
}
