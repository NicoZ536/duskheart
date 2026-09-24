/**
 * Screenshot scenarios of the light sources (M3-21, M3-22; MASTERPROMPT §31.5, M3-37 `nacht-fackel`):
 * the game view on the start beach at 22:00, the player with a burning torch in the off hand, a camp fire
 * beside them (fuelled and lit) and a torch on its stake a few steps away.
 * - `nacht-fackel`: the picture as the player sees it – warm light islands in the cool night (§4.1).
 * - `licht-abgleich`: the same camp through the render debugger's light map view (`lightmap-quellen`):
 *   gameplay light (red) against the light the renderer drew (green) – yellow where they agree, blue
 *   where they differ by more than 0,05, violet where a pixel is not comparable (sprites).
 *
 * In `nacht-fackel` the player has first thrown a stone axe east as far as it flies and walked a few steps
 * west, so the axe lies in the dark beyond the light islands – it glints there (M3-39, §4.6: pick-ups stay
 * findable in the dark without lighting anything).
 *
 * Only commands set the camp up (the scenario sees no simulation state): the player spawns on the start
 * beach; the camp fire is tried on the tiles around the player in a fixed order – the first free one
 * takes the only camp fire item, the later tries find the slot empty – and every one of those tiles is
 * then fuelled and lit (only the fire's tile accepts it); the stake torch likewise a few tiles off.
 * Registered in src/debug/scenarios.ts; stable once the world is drawn around the camp.
 */
import type { GameCameraStart } from '../world/gameScene';
import type { RenderSceneId } from '../scenes/ids';
import { equipmentRef } from '../../game/items/slots';
import { LIGHTMAP_SOURCES_VIEW } from '../debug/lightmapPass';

/** Scenario names. */
export const NIGHT_TORCH_SCENARIO = 'nacht-fackel';
export const LIGHT_COMPARE_SCENARIO = 'licht-abgleich';
/** Presentation time of the frozen picture [s] (flames mid-flicker). */
const WORLD_TIME = 1.3;
/** Frames until the picture counts as stable after the camp stands. */
const SETTLE_FRAMES = 6;
/** Clock time of the pictures: deep night in every season (spring night 20:00–04:00). */
const NIGHT = { hour: 22, minute: 0 } as const;
/** Tiles around the player tried for the camp fire (in reach of E: the eight neighbours), in order. */
const FIRE_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, 0],
  [-1, 1],
  [0, 1],
  [-1, 0],
  [1, -1],
  [-1, -1],
  [0, -1],
];
/** Tiles tried for the torch on its stake (within the 8-tile placing reach). */
export const STAKE_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [-5, -2],
  [-5, 2],
  [5, -3],
  [-4, 0],
  [4, 3],
  [0, -4],
];
/** Bag slots of the given items in a fresh session: lights go to the hotbar, the rest to the inventory. */
const SLOTS = {
  torchInHand: { bereich: 'schnellleiste', index: 0 },
  torchOnStake: { bereich: 'schnellleiste', index: 1 },
  campfire: { bereich: 'inventar', index: 0 },
  wood: { bereich: 'inventar', index: 1 },
} as const;
/** Logs put on the fire (§15.4: 45 s each; the fire burns through the picture). */
const LOGS = 6;
/** Logs kept in the bags: the fire in reach offers "[E] Nachlegen" instead of a refusal. */
const SPARE_LOGS = 1;
/**
 * The axe lost in the dark (M3-39): thrown from the hotbar (where a fresh session puts a tool) as far east as
 * a throw goes (§11.4 "Werfen" ≤ 8 tiles), left to land, then the player walks west for `walkTicks` (4,5
 * tiles/s ⇒ ≈ 3 tiles): the axe lies ≈ 11 tiles from the player – beyond the camp fire's 8 tiles, yet well
 * inside the picture (the view reaches 15 tiles to either side).
 */
const LOST_AXE = { item: 'steinaxt', from: { bereich: 'schnellleiste', index: 0 }, throwTiles: 8, landTicks: 90, walkTicks: 40 } as const;
const TILE = 16;

/** What the scenarios need of the renderer (`ScenarioRender`). */
interface ScenarioRenderPart {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
}

/** What the scenarios need of their context (`ScenarioContext`). */
interface LightScenarioContext {
  freezeAt(seconds: number): void;
  readonly render?: ScenarioRenderPart;
  readonly session?: { command(raw: unknown): unknown; step(): void; state?(): { readonly player: { readonly x: number; readonly y: number } | null } };
}

/** The player's tile from the session's state (the camera may still be on its way there). */
function playerTile(session: NonNullable<LightScenarioContext['session']>): { tx: number; ty: number } | null {
  const p = session.state?.().player ?? null;
  return p === null ? null : { tx: Math.floor(p.x / TILE), ty: Math.floor(p.y / TILE) };
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface LightScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: LightScenarioContext): void;
  ready(): boolean;
}

/**
 * Stake spots of the camp after the walk (the lost axe): on the open sand below-left of the player first,
 * where no pine crown hides the stake.
 */
const STAKE_SPOTS_AFTER_WALK: ReadonlyArray<readonly [number, number]> = [[-4, 3], ...STAKE_SPOTS];

/** The commands that set the camp up around the player on tile (tx, ty); the stake torch goes to the first free of `stakes`. */
export function campCommands(tx: number, ty: number, stakes: ReadonlyArray<readonly [number, number]> = STAKE_SPOTS): unknown[] {
  const cmds: unknown[] = [
    { type: 'inventory.give', item: 'fackel', count: 2 },
    { type: 'inventory.give', item: 'lagerfeuer', count: 1 },
    { type: 'inventory.give', item: 'holz', count: LOGS + SPARE_LOGS },
    { type: 'inventory.move', from: SLOTS.torchInHand, to: equipmentRef('nebenhand') },
  ];
  for (const [dx, dy] of FIRE_SPOTS) cmds.push({ type: 'light.place', from: SLOTS.campfire, tx: tx + dx, ty: ty + dy });
  cmds.push({ type: 'light.fuel', light: 1, from: SLOTS.wood, count: LOGS });
  for (const [dx, dy] of FIRE_SPOTS) cmds.push({ type: 'light.ignite', tx: tx + dx, ty: ty + dy });
  for (const [dx, dy] of stakes) cmds.push({ type: 'light.place', from: SLOTS.torchOnStake, tx: tx + dx, ty: ty + dy });
  cmds.push({ type: 'light.toggle' });
  return cmds;
}

/** Commands that throw the axe from the player at tile (tx, ty) as far east as it flies. */
export function lostAxeCommands(tx: number, ty: number): unknown[] {
  return [
    { type: 'inventory.give', item: LOST_AXE.item, count: 1 },
    { type: 'action.throw', from: LOST_AXE.from, x: (tx + 0.5 + LOST_AXE.throwTiles) * TILE, y: (ty + 0.5) * TILE },
  ];
}

function lightScenario(name: string, description: string, debugView: string, lostAxe: boolean): LightScenario {
  let render: ScenarioRenderPart | null = null;
  let session: NonNullable<LightScenarioContext['session']> | null = null;
  let phase: 'welt' | 'spieler' | 'wurf' | 'gehen' | 'lager' | 'fertig' = 'welt';
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
      r.startGameCamera({ kind: 'titel' });
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(WORLD_TIME);
    },
    ready() {
      if (render === null || session === null || !render.sceneReady()) return false;
      switch (phase) {
        case 'welt':
          session.command({ type: 'setTime', hour: NIGHT.hour, minute: NIGHT.minute });
          session.command({ type: 'player.spawn' });
          session.step();
          phase = 'spieler';
          return false;
        case 'spieler': {
          const at = render.gameCamera();
          if (at === null) return false;
          if (lostAxe) {
            for (const cmd of lostAxeCommands(at.tx, at.ty)) session.command(cmd);
            for (let i = 0; i < LOST_AXE.landTicks; i++) session.step();
            phase = 'wurf';
            return false;
          }
          for (const cmd of campCommands(at.tx, at.ty)) session.command(cmd);
          session.step();
          phase = 'lager';
          return false;
        }
        case 'wurf':
          session.command({ type: 'player.move', dx: -1, dy: 0 });
          for (let i = 0; i < LOST_AXE.walkTicks; i++) session.step();
          session.command({ type: 'player.move', dx: 0, dy: 0 });
          session.step();
          phase = 'gehen';
          return false;
        case 'gehen': {
          // The camp goes where the player stands now (the camera follows it there a moment later).
          const at = playerTile(session);
          if (at === null) throw new Error(`Szenario ${name} braucht den Zustand der Sitzung (Standort des Spielers)`);
          for (const cmd of campCommands(at.tx, at.ty, STAKE_SPOTS_AFTER_WALK)) session.command(cmd);
          session.step();
          phase = 'lager';
          return false;
        }
        case 'lager':
          render.setDebugView(debugView);
          phase = 'fertig';
          return false;
        case 'fertig':
          return true;
      }
    },
  };
}

/** The light scenarios: the night camp as the player sees it, and through the light map view. */
export function lightScenarios(): LightScenario[] {
  return [
    lightScenario(
      NIGHT_TORCH_SCENARIO,
      'M3-22/M3-39: Nacht am Startstrand (22:00) – der Spieler mit brennender Fackel in der Nebenhand, daneben ein Lagerfeuer mit Scheiten, einige Schritte weiter eine Fackel am Pfahl: warme Lichtinseln in kühlem Mondlicht; rechts im Dunkeln liegt eine weggeworfene Steinaxt und glitzert',
      'off',
      true,
    ),
    lightScenario(
      LIGHT_COMPARE_SCENARIO,
      'M3-21: dasselbe Lager im Render-Debugger „lightmap-quellen“ – Gameplay-Licht (rot) gegen gerendertes Licht (grün): gelb stimmt überein, blau weicht um mehr als 0,05 ab, violett ist nicht vergleichbar (Sprites)',
      LIGHTMAP_SOURCES_VIEW,
      false,
    ),
  ];
}
