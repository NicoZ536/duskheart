/**
 * Screenshot scenarios of the kitchen (MASTERPROMPT §31.5; §18 "Kochen & Ernährung", §16.4 "Küche"; M7-25 … M7-30, strand E):
 *
 * - `kueche-innen`: a log cabin furnished as a kitchen at night, the player inside (roof faded, front cut) – the stone
 *   fireplace burning on the back wall, the cauldron beside it boiling water (the player crafts at it: the fire within one
 *   tile lets it cook, the room's kitchen bonus), the pantry barrel, the herb table and the fermenting barrel brewing beer
 *   along the back wall, the bread oven fired and baking in the corner, a table with two chairs before it.
 * - `kueche-hof`: the yard of a homestead in the late morning – the camp fire with a fish on the spit (the player roasts
 *   it), the smokehouse smoking salted trout, the quern grinding wheat, the drying rack drying salted venison, the rain
 *   collector and the pantry barrel beside them.
 * - `ui-kueche`: the inventory over the start beach after two bowls of fish soup – the keyboard focus on the third bowl,
 *   whose tooltip shows the meal section (its conditions and their minutes, comfort, salt) with the boredom warning;
 *   the bags hold bread, smoked fish, tea, beer, a water skin, a bucket of boiled water, potions and the wound salve.
 *
 * The two pictures of the world are laid out like the base's (src/debug/basisScenarios.ts `basisSzenario`: a site found
 * and cleared ring by ring around the Grünhain showcase, built with the game's commands, the creatures kept off the
 * subject); the inventory picture follows src/debug/ruestungUiScenarios.ts. Registered in src/debug/scenarios.ts.
 */
import type { ScenarioRender } from '../render/runtime';
import { WORLD_OVERLAYS } from '../render/debugOverlay';
import { activeGameScreens } from '../ui/focus/GameScreens';
import { atlasImagesVersion } from '../ui/screens/inventar/itemIcons';
import { consumeTicks } from '../game/actions/formulas';
import { basisSzenario, huette, type BasisSzenario, type Bild } from './basisScenarios';
import { VIEW_CLEARING_TILES } from './scenarioCreatures';

/** Scenario names. */
export const KUECHE_INNEN = 'kueche-innen';
export const KUECHE_HOF = 'kueche-hof';
export const KUECHE_UI = 'ui-kueche';

/**
 * `kueche-innen`: cabin 9 × 6 – door in the front, a window in the back wall; inside (x 1–7, y 1–4) along the back wall
 * the fireplace (1–2), the cauldron (3), the pantry barrel (4), the herb table (5–6) and the fermenting barrel (7); the
 * table with two chairs before it, the bread oven (2 × 2) in the south-east corner. Night: the fires light the room.
 */
const INNEN: Bild = {
  name: KUECHE_INNEN,
  description:
    'M7-25 … M7-30: Küche bei Nacht um 21:00 – Blockhütte (Dach ausgeblendet, Front gekappt): an der Rückwand der brennende Steinkamin, daneben der Kessel, an dem der Spieler Wasser abkocht (Kessel dampft), Vorratsfass, Kräutertisch und das Gärfass mit Gerste; in der Ecke der befeuerte Backofen mit Mehl (Glut im Ofenmaul), davor Tisch mit zwei Stühlen; warmes Feuerlicht im Raum',
  stunde: 21,
  minute: 0,
  teile: [
    ...huette(0, 0, 9, 6, [
      { teil: 'tuer_holz', x: 4, y: 5 },
      { teil: 'fenster_glas', x: 5, y: 0 },
    ]),
    { teil: 'kamin_stein', x: 1, y: 1, b: 2, t: 1 },
    { teil: 'vorratsfass', x: 4, y: 1, b: 1, t: 1 },
    { teil: 'tisch_holz', x: 2, y: 3, b: 2, t: 1 },
    { teil: 'stuhl_holz', x: 1, y: 3, b: 1, t: 1 },
    { teil: 'stuhl_holz', x: 4, y: 3, b: 1, t: 1 },
  ],
  stationen: [
    { station: 'kessel', x: 3, y: 1, b: 1, t: 1 },
    { station: 'kraeutertisch', x: 5, y: 1, b: 2, t: 1 },
    { station: 'gaerfass', x: 7, y: 1, b: 1, t: 1 },
    { station: 'backofen', x: 6, y: 3, b: 2, t: 2 },
  ],
  ladungen: [
    { station: 2, item: 'gerste', anzahl: 4, bereich: 'eingang' },
    { station: 3, item: 'mehl', anzahl: 2, bereich: 'eingang' },
    { station: 3, item: 'holz', anzahl: 4, bereich: 'brennstoff' },
  ],
  lampen: [{ x: 1, y: 1, brennstoff: 'holz', anzahl: 12 }],
  // Two buckets of lake water boil in the cauldron (no water source in the hut: the recipe takes the bucket itself).
  handwerk: { rezept: 'rezept_wasser_abgekocht_kessel', zutat: 'holzeimer_wasser', anzahl: 2 },
  frei: [{ x: -1, y: 6, b: 11, t: 3 }],
  nachlauf: 60,
  spieler: { x: 3, y: 2, blick: 'oben' },
  fackel: false,
  kreaturenFern: { x: 4, y: 3, feindeKacheln: VIEW_CLEARING_TILES, tiereKacheln: 8 },
};

/**
 * `kueche-hof`: in a row from west to east the camp fire (1), the smokehouse (4), the quern (6), the drying rack (8–9), the
 * pantry barrel (11) and the rain collector (12); the player south of the fire roasting a trout.
 */
const HOF: Bild = {
  name: KUECHE_HOF,
  description:
    'M7-25/M7-29/M7-30: Küchenhof um 11:00 im Grünhain – das brennende Lagerfeuer, an dem der Spieler eine Forelle brät, die Räucherkammer mit gesalzener Forelle (Glut am Fuß, befeuert), die Mühle mahlt Weizen, das Trockengestell trocknet gesalzenes Wildfleisch, daneben Vorratsfass und Regensammler',
  stunde: 11,
  minute: 0,
  teile: [
    { teil: 'vorratsfass', x: 11, y: 1, b: 1, t: 1 },
    { teil: 'regensammler', x: 12, y: 1, b: 1, t: 1 },
  ],
  stationen: [
    { station: 'raeucherkammer', x: 4, y: 1, b: 1, t: 1 },
    { station: 'muehle', x: 6, y: 1, b: 1, t: 1 },
    { station: 'trockengestell', x: 8, y: 1, b: 2, t: 1 },
  ],
  lagerfeuer: { x: 1, y: 1 },
  ladungen: [
    { station: 0, item: 'forelle', anzahl: 2, bereich: 'eingang' },
    { station: 0, item: 'salz', anzahl: 1, bereich: 'eingang' },
    { station: 0, item: 'holz', anzahl: 3, bereich: 'brennstoff' },
    { station: 1, item: 'weizen', anzahl: 4, bereich: 'eingang' },
    { station: 2, item: 'wildfleisch_roh', anzahl: 2, bereich: 'eingang' },
    { station: 2, item: 'salz', anzahl: 1, bereich: 'eingang' },
  ],
  lampen: [],
  handwerk: { rezept: 'rezept_gebratener_fisch', zutat: 'forelle', anzahl: 2 },
  frei: [{ x: -1, y: -1, b: 16, t: 6 }],
  nachlauf: 60,
  spieler: { x: 1, y: 3, blick: 'oben' },
  fackel: false,
  kreaturenFern: { x: 6, y: 2, feindeKacheln: VIEW_CLEARING_TILES, tiereKacheln: 9 },
};

/** Presentation time of the world behind the inventory [s] (like the other menu scenarios). */
const UI_WORLD_TIME = 1.3;
/** Frames until the inventory picture counts as stable: web font, glyph atlas and UI graphics. */
const UI_SETTLE_FRAMES = 45;
/** The dish eaten twice before the picture (its third bowl bores: §18 "3× an einem Tag → −50 %"). */
const DISH = 'fischsuppe';
const EATEN = 2;
/** Ticks between two bowls: one bowl and a margin. */
const EAT_TICKS = consumeTicks('gericht') + 10;
/** The bags after the meal (from slot 1 on; the soup stays in slot 0). */
const BAGS: ReadonlyArray<readonly [string, number]> = [
  ['brot', 3],
  ['raeucherfisch', 4],
  ['trockenfleisch', 2],
  ['kamillentee', 2],
  ['bier', 1],
  ['trinkschlauch', 1],
  ['wasser_abgekocht', 1],
  ['heiltrank', 2],
  ['wundsalbe', 1],
  ['mehl', 4],
  ['verdorbenes', 2],
];
/** The focused slot: the third bowl of fish soup. */
const FOCUS = '[data-slot="inventar:0"]';

/** What the inventory scenario needs of its context (`ScenarioContext`). */
interface KuecheUiContext {
  freezeAt(seconds: number): void;
  readonly render?: ScenarioRender;
  readonly session?: { command(raw: unknown): unknown; step(): void };
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
interface KuecheUiScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: KuecheUiContext): void;
  ready(): boolean;
}

/** The scenario `ui-kueche`. */
function kuecheUiScenario(): KuecheUiScenario {
  let render: ScenarioRender | null = null;
  let session: NonNullable<KuecheUiContext['session']> | null = null;
  let phase: 'welt' | 'essen' | 'spieler' | 'offen' | 'fertig' = 'welt';
  return {
    name: KUECHE_UI,
    description:
      'M7-26/M7-27: Inventar nach zwei Schüsseln Fischsuppe – Fokus auf der dritten mit Tooltip: Abschnitt „Mahlzeit“ (Zustände mit Minuten, Wohlfühlessen, Salz) und die Warnung Überdruss; in den Taschen Brot, Räucherfisch, Trockenfleisch, Tee, Bier, Trinkschlauch, abgekochtes Wasser, Heiltränke, Wundsalbe, Mehl und Verdorbenes',
    settleFrames: UI_SETTLE_FRAMES,
    setup(ctx) {
      if (ctx.render === undefined || ctx.session === undefined) throw new Error(`Szenario ${KUECHE_UI} braucht Renderer und Sitzung`);
      render = ctx.render;
      session = ctx.session;
      phase = 'welt';
      render.startGameCamera({ kind: 'titel' });
      for (const o of WORLD_OVERLAYS) render.setOverlay(o, false);
      render.showScene('spiel');
      render.setDebugView('off');
      ctx.freezeAt(UI_WORLD_TIME);
    },
    ready() {
      if (render === null || session === null || !render.sceneReady()) return false;
      const ui = activeGameScreens();
      if (ui === null) return false;
      switch (phase) {
        case 'welt':
          session.command({ type: 'player.spawn' });
          session.command({ type: 'inventory.give', item: DISH, count: EATEN + 1 });
          session.step();
          phase = 'essen';
          return false;
        case 'essen':
          for (let n = 0; n < EATEN; n++) {
            session.command({ type: 'action.eat', from: { bereich: 'inventar', index: 0 } });
            for (let i = 0; i < EAT_TICKS; i++) session.step();
          }
          for (const [item, count] of BAGS) session.command({ type: 'inventory.give', item, count });
          session.command({ type: 'player.selectHotbar', index: 0 });
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
          return atlasImagesVersion.value > 0;
      }
    },
  };
}

/** The scenarios of the kitchen (registered in src/debug/scenarios.ts). */
export function kuecheSzenarien(): Array<BasisSzenario | KuecheUiScenario> {
  return [basisSzenario(INNEN), basisSzenario(HOF), kuecheUiScenario()];
}
