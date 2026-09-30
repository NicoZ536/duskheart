/**
 * Screenshot scenarios of the armour on the player (M6-12, M6-31; MASTERPROMPT §4.5 "Ausrüstung als Layer", §31.5):
 * - `spieler-ruestung`: the player on the start beach at noon in the full bronze set (helmet, cuirass with leather
 *   strips, greaves, bronze shoes – the layers `ausruestung_bronze*` over the body) with the bronze sword in the hand.
 * - `spieler-ruestung-leder`: the same in the leather set (cap with ear flaps, laced sleeveless jerkin over the grey
 *   underdress, trousers, boots with a light cuff) with the bone dagger.
 *
 * Only commands set the state up: the player spawns four tiles west of the camera's tile, `inventory.give` hands out the four pieces
 * and the weapon (a fresh player's bags are empty, so they land in the inventory slots 0–4 in order), `inventory.move`
 * puts the pieces on head, chest, legs and feet and the weapon into the first hotbar slot, which is selected. The
 * world is fixed, so the picture is the same on every run. Registered in src/debug/scenarios.ts; stable once the view
 * around the player is complete.
 */
import { equipmentRef, type EquipmentSlot } from '../game/items/slots';
import type { GameCameraStart } from '../render/world/gameScene';
import type { RenderSceneId } from '../render/scenes/ids';

/** Scenario names. */
export const ARMOUR_SCENARIO = 'spieler-ruestung';
export const LEATHER_SCENARIO = 'spieler-ruestung-leder';
/** Where the camera starts: the start beach behind the title (bright sand, the figure reads well). */
const START: GameCameraStart = { kind: 'titel' };
/** Clock time of the picture: noon, short shadows (the trees of the beach cast none over the player). */
const TIME = { hour: 12, minute: 0 } as const;
/** The player stands this many tiles west of the camera's start tile (open sand, away from the palms). */
const WEST_TILES = 4;
/** Presentation time of the frozen picture [s] (idle breathing at rest). */
const PICTURE_TIME = 0.2;
/** Frames until the picture counts as stable after the player is dressed. */
const SETTLE_FRAMES = 6;
/** The slots the pieces go to, in the order they are given. */
const SLOTS: readonly EquipmentSlot[] = ['kopf', 'brust', 'beine', 'fuesse'];

/** What the scenarios need of the renderer (`ScenarioRender`). */
interface ScenarioRenderPart {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
}

/** What the scenarios need of their context (`ScenarioContext`). */
interface ArmourScenarioContext {
  freezeAt(seconds: number): void;
  readonly render?: ScenarioRenderPart;
  readonly session?: { command(raw: unknown): unknown; step(): void };
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface ArmourScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: ArmourScenarioContext): void;
  ready(): boolean;
}

/** The commands that dress a fresh player in `pieces` (head, chest, legs, feet) with `weapon` in the hand. */
function dressCommands(pieces: readonly [string, string, string, string], weapon: string): unknown[] {
  const give = [...pieces, weapon].map((item) => ({ type: 'inventory.give', item, count: 1 }));
  const wear = SLOTS.map((slot, i) => ({ type: 'inventory.move', from: { bereich: 'inventar', index: i }, to: equipmentRef(slot) }));
  const hold = [
    { type: 'inventory.move', from: { bereich: 'inventar', index: pieces.length }, to: { bereich: 'schnellleiste', index: 0 } },
    { type: 'player.selectHotbar', index: 0 },
  ];
  return [...give, ...wear, ...hold];
}

function armourScenario(name: string, description: string, commands: readonly unknown[]): ArmourScenario {
  let render: ScenarioRenderPart | null = null;
  let session: NonNullable<ArmourScenarioContext['session']> | null = null;
  let phase: 'welt' | 'spieler' | 'fertig' = 'welt';
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
      r.startGameCamera(START);
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(PICTURE_TIME);
    },
    ready() {
      if (render === null || session === null || !render.sceneReady()) return false;
      switch (phase) {
        case 'welt': {
          const at = render.gameCamera();
          if (at === null) return false;
          session.command({ type: 'setTime', hour: TIME.hour, minute: TIME.minute });
          session.command({ type: 'player.spawn', tx: at.tx - WEST_TILES, ty: at.ty, layer: at.layer });
          session.step();
          phase = 'spieler';
          return false;
        }
        case 'spieler':
          for (const cmd of commands) session.command(cmd);
          session.step();
          phase = 'fertig';
          return false;
        case 'fertig':
          return true;
      }
    },
  };
}

/** The armour scenarios. */
export function armourScenarios(): ArmourScenario[] {
  return [
    armourScenario(
      ARMOUR_SCENARIO,
      'M6-12: Bronzerüstung am Spieler – Helm mit Wangenklappen, Brustpanzer mit Lederstreifen, Beinschienen und Bronzeschuhe als Layer über dem Körper, das Bronzeschwert in der Hand; Startstrand um 12:00',
      dressCommands(['bronzehelm', 'bronzebrustpanzer', 'bronzebeinschienen', 'bronzestiefel'], 'bronzeschwert'),
    ),
    armourScenario(
      LEATHER_SCENARIO,
      'M6-31: Ledersatz am Spieler – Kappe mit Ohrenklappen, geschnürtes ärmelloses Wams über dem grauen Unterkleid, Lederhose und Stiefel mit hellem Umschlag, der Knochendolch in der Hand; Startstrand um 12:00',
      dressCommands(['lederkappe', 'lederwams', 'lederhose', 'lederstiefel'], 'knochendolch'),
    ),
  ];
}
