/**
 * Screenshot scenarios of the visible condition effects at the player (M3-20; MASTERPROMPT §11.3
 * "sichtbare Wirkung", §31.5):
 * - `zustand-frierend`: the player in the snow of the Frostkamm at midday, cold enough to reach Frierend
 *   (core temperature < 36 °C, §11.2): shivering and small clouds of breath towards where they look.
 * - `zustand-brennen`: the player on the start beach at dusk, burning (Brennen, §11.3): little flames lick
 *   up the body and glow in the dusk.
 *
 * Only commands set the state up (Frierend follows the core temperature and cannot be applied: the
 * scenario lets the simulation run in the cold until the player's temperature stage is Frierend, reading
 * the session's debug state). The number of ticks follows from the seed, so the picture is the same on
 * every run. Registered in src/debug/scenarios.ts; stable once the view around the player is complete.
 */
import type { SessionDebugState } from '../game/session';
import type { GameCameraStart } from '../render/world/gameScene';
import type { RenderSceneId } from '../render/scenes/ids';

/** Scenario names. */
export const FREEZING_SCENARIO = 'zustand-frierend';
export const BURNING_SCENARIO = 'zustand-brennen';
/** Frames until the picture counts as stable after the state is reached. */
const SETTLE_FRAMES = 6;
/** Simulation ticks per rendered frame while the scenario waits for the cold to bite. */
const TICKS_PER_FRAME = 240;
/** Most ticks the freezing scenario waits (15 game minutes: Frierend comes within a few minutes in the Frostkamm). */
const MAX_COLD_TICKS = 54_000;

/** What the scenarios need of the renderer (`ScenarioRender`). */
interface ScenarioRenderPart {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
}

/** What the scenarios need of their context (`ScenarioContext`). */
interface ConditionScenarioContext {
  freezeAt(seconds: number): void;
  readonly render?: ScenarioRenderPart;
  readonly session?: { command(raw: unknown): unknown; step(): void; state?(): SessionDebugState };
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface ConditionScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: ConditionScenarioContext): void;
  ready(): boolean;
}

/** How a scenario reaches its condition. */
interface ConditionRecipe {
  readonly start: GameCameraStart;
  /** Presentation time of the frozen picture [s]: the effect mid-way (a breath cloud in full bloom, flames licking). */
  readonly pictureTime: number;
  readonly time: { readonly hour: number; readonly minute: number };
  /** Commands after the player stands (conditions that can be applied). */
  readonly commands: readonly unknown[];
  /** Temperature stage to wait for (conditions that follow the core temperature), or null. */
  readonly waitForStage: string | null;
}

function conditionScenario(name: string, description: string, recipe: ConditionRecipe): ConditionScenario {
  let render: ScenarioRenderPart | null = null;
  let session: NonNullable<ConditionScenarioContext['session']> | null = null;
  let phase: 'welt' | 'spieler' | 'warten' | 'fertig' = 'welt';
  let ticks = 0;
  return {
    name,
    description,
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session === undefined) throw new Error(`Szenario ${name} braucht Renderer und Sitzung`);
      render = r;
      session = ctx.session;
      phase = 'welt';
      r.startGameCamera(recipe.start);
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(recipe.pictureTime);
    },
    ready() {
      if (render === null || session === null || !render.sceneReady()) return false;
      switch (phase) {
        case 'welt': {
          const at = render.gameCamera();
          if (at === null) return false;
          session.command({ type: 'setTime', hour: recipe.time.hour, minute: recipe.time.minute });
          session.command({ type: 'player.spawn', tx: at.tx, ty: at.ty, layer: at.layer });
          session.step();
          phase = 'spieler';
          return false;
        }
        case 'spieler':
          for (const cmd of recipe.commands) session.command(cmd);
          session.step();
          phase = recipe.waitForStage === null ? 'fertig' : 'warten';
          return false;
        case 'warten': {
          const read = session.state;
          if (read === undefined) throw new Error(`Szenario ${name} braucht den Zustand der Sitzung`);
          for (let k = 0; k < TICKS_PER_FRAME; k++) {
            if (read.call(session).player?.temperatureStage === recipe.waitForStage) {
              phase = 'fertig';
              return false;
            }
            session.step();
            if (++ticks > MAX_COLD_TICKS) throw new Error(`Szenario ${name}: Stufe ${recipe.waitForStage ?? ''} nach ${MAX_COLD_TICKS} Ticks nicht erreicht`);
          }
          return false;
        }
        case 'fertig':
          return true;
      }
    },
  };
}

/** The condition scenarios. */
export function conditionScenarios(): ConditionScenario[] {
  return [
    conditionScenario(
      FREEZING_SCENARIO,
      'M3-20: Frierend – der Spieler im Schnee des Frostkamms um 12:00, die Kerntemperatur unter 36 °C: er zittert (ein Pixel hin und her), wird kältebleich und haucht kleine Atemwolken in Blickrichtung',
      { start: { kind: 'biom', biome: 'frostkamm' }, pictureTime: 2, time: { hour: 12, minute: 0 }, commands: [], waitForStage: 'frierend' },
    ),
    conditionScenario(
      BURNING_SCENARIO,
      'M3-20: Brennen – der Spieler am Startstrand in der Abenddämmerung (18:45) steht in Flammen: kleine emissive Flammenzungen lecken am Körper hoch und glühen in der Dämmerung',
      { start: { kind: 'titel' }, pictureTime: 1.3, time: { hour: 18, minute: 45 }, commands: [{ type: 'conditions.apply', id: 'brennen' }], waitForStage: null },
    ),
  ];
}
