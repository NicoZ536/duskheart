/**
 * Screenshot scenarios of the HUD modes (M3-27, MASTERPROMPT §31.5): `hud-voll`, `hud-kontextuell`,
 * `hud-minimal` – the page's own HUD over the game view at the start beach, in one and the same game
 * state, so the three pictures differ only by the mode (`hudVorgabe`, which also keeps the HUD visible in
 * screenshot mode). Registered in src/debug/scenarios.ts.
 *
 * The state is played through the page session with the game's own commands (deterministic: fixed seed,
 * frozen loop, single steps): the player spawns at 08:50 on a cold, rainy spring morning, gathered T0
 * resources and food go onto the hotbar (a rare find with its rim) and the belt, a lit torch into the
 * off-hand (its flame bar burns down, twice as fast in the rain); three wounds bleed,
 * poison and food poisoning take hold, the player catches fire and stands for 21 s of game time (health
 * falls to about 25, one bout of vomiting costs satiety and thirst, the rain soaks and cools – the felt
 * temperature leaves the comfort band, the core starts to fall); four flints thrown at the feet lie in
 * reach, two of them joined ("[E] Aufheben: Feuerstein ×2"); fear stands at 46 (whispers). The scenario waits until the
 * notifications of the given items and the stepped time have run their course (their own scenario is
 * `hud-meldungen`). Stable once the view is drawn, the hint is up and the atlas symbols are decoded.
 */
import type { GameCameraStart } from '../../render/world/gameScene';
import type { RenderSceneId } from '../../render/scenes/ids';
import { equipmentSlotIndex, type SlotRef } from '../../game/items/slots';
import { atlasImagesVersion } from '../screens/inventar/itemIcons';
import { aktiveHudBruecke, aktiveHudWelt, hudVorgabe } from './Hud';
import type { HudMode } from './modus';

/** What the scenarios need of the renderer (`ScenarioRender`). */
interface SzenarioRender {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
}

/** What the scenarios need of their context (`ScenarioContext`). */
interface SzenarioKontext {
  freezeAt(seconds: number): void;
  readonly render?: SzenarioRender;
  readonly session?: { command(raw: unknown): unknown; step(): void };
}

/** The scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface HudModusSzenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: SzenarioKontext): void;
  ready(): boolean;
}

/** Presentation time of the frozen world (the world scenes' torch and tree phase). */
const WELT_ZEIT = 1.3;
/** Frames until the picture counts as stable (font, UI graphics, the world behind). */
const RUHE_FRAMES = 45;
/**
 * Time of day and weather: morning of a rainy spring day – cold enough that the felt temperature (≈ 9 °C)
 * lies below the comfort band even in the linen clothes of the start (ADR-0028: +6 °C insulation; the band
 * reaches down to ≈ 14 °C when half soaked), so the core falls (thermometer arrow) and the contextual HUD
 * shows the thermometer. The rain begins at 08:00 and the clock jumps 50 minutes, so the weather's 45-minute
 * blend (docs/WORLD.md §6) is complete at 08:50; 21 s of conditions later the picture shows 09:11.
 */
const STUNDE = 8;
const MINUTE = 0;
const WETTER = 'regen';
const VORLAUF_MIN = 50;
/** Game time the conditions act before the picture [ticks]: 21 s – one bout of vomiting (every 20 s). */
const WIRKZEIT_TICKS = 1260;
/** Ticks stepped per frame while the conditions act (keeps every frame short). */
const TICKS_JE_FRAME = 90;
/** Most single steps waiting for the thrown flints to land in reach. */
const MAX_LANDESCHRITTE = 90;
/** Where the flints are thrown: just below the player's feet [px]. */
const WURF_VERSATZ_Y = 6;
/** Flints thrown (they pop out around the landing spot; close ones join one stack: "Feuerstein ×n"). */
const WURF_ANZAHL = 4;
/** Fear at the picture (stage „Flüstern“ from 40, §12.3). */
const FURCHT = 46;
/** Poison lasts 30 s here (it still acts at the picture). */
const GIFT_S = 30;

/** Items and where they go (hotbar, belt or off-hand slot); feuerstein keeps `WURF_ANZAHL` in the inventory to throw. */
const GEGENSTAENDE: ReadonlyArray<readonly [string, number, SlotRef | null, number?]> = [
  ['holz', 64, { bereich: 'schnellleiste', index: 0 }],
  ['stein', 41, { bereich: 'schnellleiste', index: 1 }],
  ['feuerstein', 10, { bereich: 'schnellleiste', index: 2 }, 6],
  ['fasern', 38, { bereich: 'schnellleiste', index: 3 }],
  ['zweig', 23, { bereich: 'schnellleiste', index: 4 }],
  ['harz', 5, { bereich: 'schnellleiste', index: 5 }],
  ['lehm', 12, { bereich: 'schnellleiste', index: 6 }],
  ['leuchtpilz', 4, { bereich: 'schnellleiste', index: 8 }],
  ['fackel', 1, { bereich: 'ausruestung', index: equipmentSlotIndex('nebenhand') }],
  ['apfel', 6, { bereich: 'guertel', index: 0 }],
  ['himbeeren', 14, { bereich: 'guertel', index: 1 }],
];

/** Conditions at the start: three bleeding wounds, poison, food poisoning, fire, and a boon. */
const ZUSTAENDE: ReadonlyArray<{ readonly id: string; readonly seconds?: number }> = [
  { id: 'blutung' },
  { id: 'blutung' },
  { id: 'blutung' },
  { id: 'vergiftung', seconds: GIFT_S },
  { id: 'lebensmittelvergiftung' },
  { id: 'brennen' },
  { id: 'ausgeruht' },
];

type Phase = 'welt' | 'packen' | 'wirken' | 'werfen' | 'landen' | 'ende' | 'meldungen' | 'fertig';

/** Scenario `name` showing the HUD in `modus` (`description`: what the picture shows). */
export function hudModusSzenario(name: string, description: string, modus: HudMode): HudModusSzenario {
  let render: SzenarioRender | null = null;
  let session: NonNullable<SzenarioKontext['session']> | null = null;
  let phase: Phase = 'welt';
  let gewirkt = 0;
  let landeschritte = 0;
  const schritt = (n = 1): void => {
    for (let i = 0; i < n; i++) session?.step();
  };
  return {
    name,
    description,
    settleFrames: RUHE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session === undefined) throw new Error(`Szenario ${name} braucht Renderer und Sitzung`);
      render = r;
      session = ctx.session;
      hudVorgabe.value = { modus };
      r.startGameCamera({ kind: 'titel' });
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(WELT_ZEIT);
    },
    ready() {
      const s = session;
      const bruecke = aktiveHudBruecke();
      if (render === null || s === null || bruecke === null || !render.sceneReady()) return false;
      switch (phase) {
        case 'welt':
          s.command({ type: 'player.spawn' });
          s.command({ type: 'setTime', hour: STUNDE, minute: MINUTE });
          s.command({ type: 'setWeather', state: WETTER });
          s.command({ type: 'advanceTime', minutes: VORLAUF_MIN });
          for (const [item, count] of GEGENSTAENDE) s.command({ type: 'inventory.give', item, count });
          schritt();
          phase = 'packen';
          return false;
        case 'packen': {
          const bags = bruecke.state.bags.peek();
          if (bags === null || !bruecke.state.player.present.peek()) return false;
          // Equipment first: a light arrives on the hotbar (hand items do) and must leave its slot before
          // the raw materials take theirs; everything else waits in the main inventory.
          const reihenfolge = [...GEGENSTAENDE].sort((a, b) => Number(b[2]?.bereich === 'ausruestung') - Number(a[2]?.bereich === 'ausruestung'));
          for (const [item, , ziel, anzahl] of reihenfolge) {
            if (ziel === null) continue;
            const imInventar = bags.inventar.findIndex((st) => st?.item === item);
            const inLeiste = bags.schnellleiste.findIndex((st) => st?.item === item);
            const from: SlotRef | null = imInventar >= 0 ? { bereich: 'inventar', index: imInventar } : inLeiste >= 0 ? { bereich: 'schnellleiste', index: inLeiste } : null;
            if (from === null) continue;
            s.command({ type: 'inventory.move', from, to: ziel, ...(anzahl === undefined ? {} : { count: anzahl }) });
          }
          s.command({ type: 'player.selectHotbar', index: 0 });
          for (const z of ZUSTAENDE) s.command({ type: 'conditions.apply', id: z.id, ...(z.seconds === undefined ? {} : { seconds: z.seconds }) });
          schritt();
          phase = 'wirken';
          return false;
        }
        case 'wirken': {
          // The torch in the off-hand is lit (in the rain it burns down twice as fast: its flame bar).
          if (gewirkt === 0) s.command({ type: 'light.toggle' });
          const n = Math.min(TICKS_JE_FRAME, WIRKZEIT_TICKS - gewirkt);
          schritt(n);
          gewirkt += n;
          if (gewirkt >= WIRKZEIT_TICKS) phase = 'werfen';
          return false;
        }
        case 'werfen': {
          const bags = bruecke.state.bags.peek();
          const pos = bruecke.state.controlled.peek();
          if (bags === null || pos === null) return false;
          const index = bags.inventar.findIndex((st) => st?.item === 'feuerstein');
          if (index >= 0) for (let i = 0; i < WURF_ANZAHL; i++) s.command({ type: 'action.throw', from: { bereich: 'inventar', index }, x: pos.x, y: pos.y + WURF_VERSATZ_Y });
          schritt();
          phase = 'landen';
          return false;
        }
        case 'landen': {
          const hint = bruecke.state.hud.interaction.peek();
          if ((hint !== null && hint.verb === 'ui.interaction.action.aufheben') || landeschritte >= MAX_LANDESCHRITTE) {
            phase = 'ende';
            return false;
          }
          landeschritte++;
          schritt();
          return false;
        }
        case 'ende':
          s.command({ type: 'fear.set', value: FURCHT });
          schritt();
          phase = 'meldungen';
          return false;
        case 'meldungen': {
          // The pickups of the given items and the warnings of the stepped time run their course
          // (presentation clock); the picture shows the HUD without them (their scenario: hud-meldungen).
          const w = aktiveHudWelt()?.warteschlange;
          if (w !== undefined && (w.sichtbar.length > 0 || w.wartend > 0)) return false;
          phase = 'fertig';
          return false;
        }
        case 'fertig':
          return atlasImagesVersion.value > 0;
      }
    },
  };
}
