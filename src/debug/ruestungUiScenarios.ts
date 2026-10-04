/**
 * Screenshot scenario of the armour in the inventory (M6-42, M6-43; MASTERPROMPT §26 "Inventar/Ausrüstung/Werte", §13.1
 * "Rüstungssets mit Set-Boni", §31.5):
 * - `ui-inventar-ruestung`: the inventory screen over the start beach with the player in a mixed armour – bronze helmet
 *   and cuirass, leather trousers and boots. The paper doll draws the helmet on the head socket and the armour over the
 *   body without the linen tunic and trousers under it (src/ui/screens/inventar/puppe.ts); below it the worn sets (bronze
 *   2/4 and leather 2/4, each with its two-piece bonus reached and the four-piece bonus greyed – the tallest the panel
 *   gets); the keyboard focus rests on the leather cap in the bags, whose tooltip compares it with the worn helmet and
 *   shows its set with the pieces worn.
 *
 * Only commands set the state up: `inventory.give` hands out the four worn pieces (a fresh player's bags are empty, so they
 * land in the inventory slots 0–3), `inventory.move` puts them on head, chest, legs and feet, then the rest of the loadout
 * is given into the freed slots (the cap first; the dagger, held in the hand, goes to the hotbar by itself) and the first
 * hotbar slot is selected. The world is fixed and the time
 * frozen, so the picture is the same on every run. Registered in src/debug/scenarios.ts; stable once the item icons and
 * the figure are decoded from the game atlas.
 */
import type { ScenarioRender } from '../render/runtime';
import { WORLD_OVERLAYS } from '../render/debugOverlay';
import { activeGameScreens } from '../ui/focus/GameScreens';
import { atlasImagesVersion } from '../ui/screens/inventar/itemIcons';
import { equipmentRef, type EquipmentSlot } from '../game/items/slots';

/** Scenario name. */
export const ARMOUR_UI_SCENARIO = 'ui-inventar-ruestung';
/** Presentation time of the world behind the screen [s] (trees mid-sway, like the other menu scenarios). */
const WORLD_TIME = 1.3;
/** Frames until the picture counts as stable: web font, glyph atlas and UI graphics (like the other menu scenarios). */
const SETTLE_FRAMES = 45;
/**
 * The worn pieces, in the order of `WORN_SLOTS`: two of bronze, two of leather – the tallest set panel (two sets with a
 * reached and a greyed bonus each) and a doll with the helmet on the head and the cuirass without the tunic under it.
 */
const WORN: readonly string[] = ['bronzehelm', 'bronzebrustpanzer', 'lederhose', 'lederstiefel'];
const WORN_SLOTS: readonly EquipmentSlot[] = ['kopf', 'brust', 'beine', 'fuesse'];
/** Given after dressing, into the freed slots from 0 on: the cap (focused), armour, the leather goods; the dagger to the hotbar. */
const BAGS: ReadonlyArray<readonly [string, number]> = [
  ['lederkappe', 1],
  ['lederwams', 1],
  ['bronzebeinschienen', 1],
  ['knochendolch', 1],
  ['leder', 6],
  ['fell', 4],
  ['sehnen', 5],
  ['garn', 8],
  ['rinde', 12],
];
/** The focused slot: the leather cap. */
const FOCUS = '[data-slot="inventar:0"]';

/** What the scenario needs of its context (`ScenarioContext`). */
interface ArmourUiContext {
  freezeAt(seconds: number): void;
  readonly render?: ScenarioRender;
  readonly session?: { command(raw: unknown): unknown; step(): void };
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface ArmourUiScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: ArmourUiContext): void;
  ready(): boolean;
}

/** The commands that dress a fresh player and fill the bags (see module comment). */
export function armourUiCommands(): unknown[] {
  const give = (item: string, count: number) => ({ type: 'inventory.give', item, count });
  return [
    ...WORN.map((item) => give(item, 1)),
    ...WORN_SLOTS.map((slot, i) => ({ type: 'inventory.move', from: { bereich: 'inventar', index: i }, to: equipmentRef(slot) })),
    ...BAGS.map(([item, count]) => give(item, count)),
    { type: 'player.selectHotbar', index: 0 },
  ];
}

/** The scenario `ui-inventar-ruestung`. */
export function armourUiScenario(): ArmourUiScenario {
  let render: ScenarioRender | null = null;
  let session: NonNullable<ArmourUiContext['session']> | null = null;
  let phase: 'welt' | 'spieler' | 'offen' | 'fertig' = 'welt';
  return {
    name: ARMOUR_UI_SCENARIO,
    description:
      'M6-42/M6-43: Inventar mit gemischter Rüstung – Papierpuppe mit dem Bronzehelm am Kopfsockel, Brustpanzer, Lederhose und Stiefeln ohne Leinentunika und -hose darunter; darunter die getragenen Sets (Bronze 2/4, Leder 2/4: 2-Teile-Bonus aktiv, 4-Teile-Bonus grau); Fokus auf der Lederkappe mit Tooltip (Vergleich mit dem Helm, Set mit getragenen Teilen)',
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      if (ctx.render === undefined || ctx.session === undefined) throw new Error(`Szenario ${ARMOUR_UI_SCENARIO} braucht Renderer und Sitzung`);
      render = ctx.render;
      session = ctx.session;
      phase = 'welt';
      render.startGameCamera({ kind: 'titel' });
      for (const o of WORLD_OVERLAYS) render.setOverlay(o, false);
      render.showScene('spiel');
      render.setDebugView('off');
      ctx.freezeAt(WORLD_TIME);
    },
    ready() {
      if (render === null || session === null || !render.sceneReady()) return false;
      const ui = activeGameScreens();
      if (ui === null) return false;
      switch (phase) {
        case 'welt':
          session.command({ type: 'player.spawn' });
          for (const cmd of armourUiCommands()) session.command(cmd);
          session.step();
          phase = 'spieler';
          return false;
        case 'spieler':
          if (!ui.controller.open('inventar')) return false;
          phase = 'offen';
          return false;
        case 'offen': {
          const el = document.querySelector(FOCUS);
          if (!(el instanceof HTMLElement)) return false;
          ui.focus.keysUsed();
          ui.focus.focus(el);
          phase = 'fertig';
          return false;
        }
        case 'fertig':
          // Item icons and the paper doll come from the decoded game atlas.
          return atlasImagesVersion.value > 0;
      }
    },
  };
}
