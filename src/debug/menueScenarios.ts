/**
 * Screenshot scenarios of the main menu (M7-50, M7-51, M7-56; MASTERPROMPT §31.5): the menu boots on its own fixed world
 * with the coast camp (src/render/world/menuScene.ts) – `isMenuScenario` tells the boot (src/main.tsx) to boot the menu
 * instead of the direct debug page. Time is frozen; each `ready()` steps the session once while the camp is set up, then
 * the clock and the weather are set, the menu's screen is opened and the focus frame placed – the same picture on every run.
 *
 * - `ui-hauptmenue`: the main menu over the camp at dusk – title, Weiter (three stored worlds), Neue Welt, Welten,
 *   Einstellungen, the world played last, the key hint, the version;
 * - `ui-weltauswahl`: the world selection with three stored worlds (only their metas, written by the scenario), the first
 *   selected;
 * - `ui-neue-welt`: the new-world form with its suggested seed (fixed in scenarios), the focus on the preset;
 * - `ui-einstellungen`: the settings, tab Grafik, the focus on the FPS limit;
 * - `ui-laden`: the loading screen in the middle of a world's generation (direct boot; src/ui/screens/laden/szenario.tsx);
 * - `ui-pause-welt`: the pause menu's world view of a running Hart world made peaceful (direct boot: the game, not the menu).
 * Registered in src/debug/scenarios.ts.
 */
import { WORLD_OVERLAYS } from '../render/debugOverlay';
import type { ScenarioRender } from '../render/runtime';
import { activeMenuScene } from '../render/world/menuScene';
import { resolveSimConfig } from '../game/sim';
import { createI18n, FALLBACK_LANG, isLang } from '../i18n';
import { openSaveDb } from '../save/db';
import { SAVE_SNAPSHOT_FORMAT } from '../save/registry';
import type { WorldMeta } from '../save/store';
import { activeGameScreens } from '../ui/focus/GameScreens';
import { activeMenu } from '../ui/menu/MenuApp';
import { mountLadeSzenario } from '../ui/screens/laden/szenario';
import type { WorldSizePreset } from '../content/balance';

/** Presentation time of the frozen picture [s] (flames mid-flicker, trees mid-sway). */
const WORLD_TIME = 1.3;
/** Frames until the picture counts as stable: web font, glyph atlas and UI graphics (like the other menu scenarios). */
const SETTLE_FRAMES = 45;
/** Clock of the pictures: dusk, the camp's lights against the last light of the day. */
const DUSK = { hour: 19, minute: 20 } as const;
/** Steps the camp may take to stand before the scenario gives up (each try of a spot is one). */
const SETUP_STEPS = 60;

/** The menu scenarios: their names boot the menu (`isMenuScenario`). */
export const MENU_SCENARIOS = ['ui-hauptmenue', 'ui-weltauswahl', 'ui-neue-welt', 'ui-einstellungen'] as const;

/** Whether scenario `name` shows the main menu (the boot then starts the menu, not the direct debug page). */
export function isMenuScenario(name: string): boolean {
  return (MENU_SCENARIOS as readonly string[]).includes(name);
}

/** Simulation ticks per hour of play at the menu worlds' day (60 Hz). */
const TICKS_PER_HOUR = 60 * 60 * 60;

/** A stored world of the pictures: name, seed, size, game day, hours played, when saved (UTC). */
const DEMO_WORLDS: ReadonlyArray<{ readonly id: string; readonly name: string; readonly seed: number; readonly size: WorldSizePreset; readonly day: number; readonly hours: number; readonly saved: string }> = [
  { id: 'welt-szenario-1', name: 'Glutküste', seed: 4_711_042, size: 'medium', day: 23, hours: 6.2, saved: '2026-10-05T19:42:00Z' },
  { id: 'welt-szenario-2', name: 'Nebelhain', seed: 918_273, size: 'small', day: 7, hours: 2.1, saved: '2026-10-03T16:05:00Z' },
  { id: 'welt-szenario-3', name: 'Letzte Glut', seed: 31_337, size: 'large', day: 41, hours: 12.8, saved: '2026-09-28T21:17:00Z' },
];

/** Writes the demo worlds' metas (the list shows only metas; nothing loads them). */
async function writeDemoWorlds(idb: IDBFactory): Promise<void> {
  const store = await openSaveDb(idb);
  try {
    await store.write((b) => {
      for (const w of DEMO_WORLDS) {
        const savedAt = Date.parse(w.saved);
        const meta: WorldMeta = {
          id: w.id,
          name: w.name,
          seed: w.seed,
          config: resolveSimConfig({ seed: w.seed, worldSize: w.size }),
          saveFormat: SAVE_SNAPSHOT_FORMAT,
          tick: Math.round(w.hours * TICKS_PER_HOUR),
          day: w.day,
          createdAt: savedAt - Math.round(w.hours * 3_600_000),
          savedAt,
        };
        b.putWorld(meta);
      }
    });
  } finally {
    store.close();
  }
}

/** What the scenarios need of their context (`ScenarioContext`). */
interface MenuScenarioContext {
  freezeAt(seconds: number): void;
  readonly render?: ScenarioRender;
  readonly session?: { command(raw: unknown): unknown; step(): void };
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface MenuScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: MenuScenarioContext): void;
  ready(): boolean;
}

interface MenuShot {
  readonly name: (typeof MENU_SCENARIOS)[number];
  readonly description: string;
  /** Write the demo worlds first. */
  readonly welten: boolean;
  /** The screen to open over the main menu, or none. */
  readonly screen: string | null;
  /** The element the focus frame rests on. */
  readonly fokus: string;
}

function menuShot(shot: MenuShot): MenuScenario {
  let render: ScenarioRender | null = null;
  let session: NonNullable<MenuScenarioContext['session']> | null = null;
  let phase: 'szene' | 'welten' | 'warten' | 'menue' | 'fokus' | 'fertig' = 'szene';
  let steps = 0;
  let written = false;
  return {
    name: shot.name,
    description: shot.description,
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      if (ctx.render === undefined || ctx.session === undefined) throw new Error(`Szenario ${shot.name} braucht Renderer und Sitzung`);
      render = ctx.render;
      session = ctx.session;
      phase = 'szene';
      render.startGameCamera({ kind: 'titel' });
      for (const o of WORLD_OVERLAYS) render.setOverlay(o, false);
      render.showScene('spiel');
      render.setDebugView('off');
      ctx.freezeAt(WORLD_TIME);
    },
    ready() {
      if (render === null || session === null || !render.sceneReady()) return false;
      switch (phase) {
        case 'szene': {
          const scene = activeMenuScene();
          if (scene === null) return false;
          // Time is frozen: the camp's commands take effect with the scenario's steps.
          if (!scene.ready) {
            if (++steps > SETUP_STEPS) throw new Error(`Szenario ${shot.name}: das Lager steht nach ${SETUP_STEPS} Schritten nicht`);
            session.step();
            return false;
          }
          session.command({ type: 'setTime', hour: DUSK.hour, minute: DUSK.minute });
          session.command({ type: 'setWeather', state: 'klar' });
          session.step();
          phase = 'welten';
          return false;
        }
        case 'welten':
          if (shot.welten) {
            void writeDemoWorlds(indexedDB).then(() => {
              written = true;
            });
            phase = 'warten';
          } else phase = 'menue';
          return false;
        case 'warten': {
          const menu = activeMenu();
          if (!written || menu === null) return false;
          menu.aktualisieren();
          phase = 'menue';
          return false;
        }
        case 'menue': {
          const menu = activeMenu();
          if (menu === null) return false;
          if (shot.screen !== null) menu.controller.open(shot.screen);
          phase = 'fokus';
          return false;
        }
        case 'fokus': {
          const menu = activeMenu();
          const el = document.querySelector(shot.fokus);
          if (menu === null || !(el instanceof HTMLElement)) return false;
          menu.focus.keysUsed();
          menu.focus.focus(el);
          phase = 'fertig';
          return false;
        }
        case 'fertig':
          return true;
      }
    },
  };
}

/** The loading screen (direct boot: it covers the view; the world behind it does not matter). */
function ladenShot(): MenuScenario {
  let mounted = false;
  return {
    name: 'ui-laden',
    description:
      'M7-50: Ladebildschirm – Weltname „Glutküste“, Pixel-Fortschrittsbalken bei „Erze und Vorkommen (7/8)“, ein Tipp auf Pergament (Herdfeuer hält die Schattenbrut fern) und eine Zeile Lore von Funke',
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      ctx.freezeAt(WORLD_TIME);
    },
    ready() {
      if (!mounted) {
        const lang = document.documentElement.lang;
        const i18n = createI18n(isLang(lang) ? lang : FALLBACK_LANG);
        i18n.onMissing((key, l) => console.error(`i18n: Schlüssel „${key}“ fehlt (${l})`));
        mountLadeSzenario(document, i18n);
        mounted = true;
        return false;
      }
      return true;
    },
  };
}

/**
 * The pause menu's world view (M7-51 "Schwierigkeit jederzeit änderbar außer Unbarmherzig"): a running world set to Hart and
 * made peaceful by the commands the view itself sends, the pause menu opened and its entry Welt chosen, the focus on Friedlich.
 */
function pauseWeltShot(): MenuScenario {
  let render: ScenarioRender | null = null;
  let session: NonNullable<MenuScenarioContext['session']> | null = null;
  let phase: 'welt' | 'pause' | 'welt-oeffnen' | 'fokus' | 'fertig' = 'welt';
  return {
    name: 'ui-pause-welt',
    description:
      'M7-51: Welt-Ansicht des Pausemenüs über der laufenden Welt – Voreinstellung Hart, Friedlich an (Fokus), Jahreszeitenlänge, Hunger/Durst und Gegnerschaden „Vorgabe (×1,25/×1,3)“, Schattenflut, Logistik-Realismus; darunter Faktoren, Todesstrafe und die feste Weltkonfiguration (Seed zum Teilen, Tageslänge, Ressourcen)',
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      if (ctx.render === undefined || ctx.session === undefined) throw new Error('Szenario ui-pause-welt braucht Renderer und Sitzung');
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
          session.command({ type: 'world.setDifficulty', schwierigkeit: 'hart' });
          session.command({ type: 'world.setSettings', friedlich: true });
          session.step();
          phase = 'pause';
          return false;
        case 'pause':
          if (!ui.controller.open('pause')) return false;
          phase = 'welt-oeffnen';
          return false;
        case 'welt-oeffnen': {
          const button = document.querySelector('[data-testid="pause-welt-oeffnen"]');
          if (!(button instanceof HTMLElement)) return false;
          button.click();
          phase = 'fokus';
          return false;
        }
        case 'fokus': {
          const el = document.querySelector('[data-zeile="friedlich"]');
          if (!(el instanceof HTMLElement)) return false;
          ui.focus.keysUsed();
          ui.focus.focus(el);
          phase = 'fertig';
          return false;
        }
        case 'fertig':
          return true;
      }
    },
  };
}

/** The menu's screenshot scenarios. */
export function menueSzenarien(): MenuScenario[] {
  return [
    menuShot({
      name: 'ui-hauptmenue',
      description:
        'M7-50: Hauptmenü über dem Küstenlager in der Abenddämmerung (Lagerfeuer und zwei Fackeln, kein Spieler im Bild, Kamera frei) – Titel und Untertitel, Holztafel mit Weiter, Neue Welt, Welten, Einstellungen (Fokusrahmen auf „Weiter“), darunter die zuletzt gespielte Welt, der Tastenhinweis und die Version',
      welten: true,
      screen: null,
      fokus: '[data-testid="menue-weiter"]',
    }),
    menuShot({
      name: 'ui-weltauswahl',
      description:
        'M7-50/M7-58: Weltauswahl über dem abgedunkelten Menü – drei Welten (Name, Speicherzeit, Tag, Größe, Spielzeit), die erste gewählt und fokussiert; Laden, Exportieren, Seed kopieren, Löschen; Neue Welt, Importieren, Zurück',
      welten: true,
      screen: 'weltauswahl',
      fokus: '[data-welt]',
    }),
    menuShot({
      name: 'ui-neue-welt',
      description:
        'M7-51: Neue Welt – Name und Seed als Textfelder (Seed vorgeschlagen, Zufall), Regler Größe, Voreinstellung (Fokus), Friedlich, Tageslänge, Jahreszeitenlänge, Ressourcendichte, Hunger/Durst, Gegnerschaden, Schattenflut, Logistik-Realismus; darunter Faktoren und Todesstrafe der Voreinstellung; Welt erschaffen, Zurück',
      welten: false,
      screen: 'neue-welt',
      fokus: '[data-zeile="schwierigkeit"]',
    }),
    menuShot({
      name: 'ui-einstellungen',
      description:
        'M7-55/M7-56: Einstellungen – sechs Reiter (Grafik aktiv), die Grafik-Zeilen mit Qualitätsstufe, Licht-Bänderung, Dithering, Skalierung, Bildratenlimit (Fokus, „An Bildwiederholrate“), CRT …; Beschreibung der Zeile auf Pergament; Abschnitt und alles zurücksetzen, Zurück',
      welten: false,
      screen: 'einstellungen',
      fokus: '[data-zeile="graphics.fpsLimit"]',
    }),
    ladenShot(),
    pauseWeltShot(),
  ];
}
