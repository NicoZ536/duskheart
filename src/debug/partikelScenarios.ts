/**
 * Screenshot and bench scenarios of the particle strand (MASTERPROMPT §31.5; M5-11, M5-12, M5-21):
 * - `partikel`: the particle showcase (`src/render/particles/showcase.ts`) – camp fire with sparks, embers, smoke and
 *   heat shimmer, sparking torches, a rising lumen storm, fireflies – on the Grünhain clearing at nightfall;
 * - `partikel-20000`: the same with three more lumen storms, ≥ 20 000 particles at once (bench `render:partikel-20000`);
 * - `partikel-gewitter`: the clearing at night in a thunderstorm, frozen in the first flash of a lightning strike;
 * - `regen`, `schnee`, `ascheregen`, `sandsturm`: the game view on the session's world with the weather forced by the
 *   game's own commands (`setWeather`, then an hour so the blend has settled) in the showcase of a fitting biome – the
 *   weather particles come from the simulation's weather, their wind from its weather period. A period whose wind blows
 *   straight up or down the screen hides the wind's angle, so the scenario forces the weather again (a new period, a
 *   new wind direction; the state stays, nothing blends) until the wind crosses the view.
 * Registered in src/debug/scenarios.ts.
 */
import type { SessionDebugState } from '../game/session';
import type { GameCameraStart } from '../render/world/gameScene';
import type { RenderSceneId } from '../render/scenes/ids';
import { THUNDERSTORM_FLASH_TIME } from '../render/particles/showcase';

/** What the scenarios need of the renderer (`ScenarioRender`). */
interface PartikelRender {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
  particleWind?(): { x: number; y: number } | null;
}

/** What the scenarios need of the session (`ScenarioSession`). */
interface PartikelSitzung {
  command(raw: unknown): unknown;
  step(): void;
  state(): SessionDebugState;
}

interface PartikelKontext {
  freezeAt(seconds: number): void;
  readonly render?: PartikelRender;
  readonly session?: PartikelSitzung;
}

/** The scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface PartikelSzenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: PartikelKontext): void;
  ready(): boolean;
}

/** Frames until the picture counts as stable (scene switch, the particles' start-over for the frozen time, one frame). */
const RUHE_FRAMES = 4;
/** Presentation time of the showcase pictures [s]: every source long in its steady state, flames mid-flicker. */
const SCHAU_ZEIT = 12.4;
/** Presentation time of the weather pictures [s]. */
const WETTER_ZEIT = 9.3;
/** Game minutes after forcing the weather: its blend (`CLIMATE_BALANCE.weatherBlendMinutes` = 45) has settled. */
const WETTER_NACHLAUF_MIN = 50;
/** Share of the wind's speed that must cross the view (east-west) for the picture to show the wind's angle. */
const QUERWIND_ANTEIL = 0.5;
/** Periods tried for a crosswind (six of the eight wind directions cross the view). */
const QUERWIND_VERSUCHE = 8;

/** A scenario that shows a render scene of the particle strand. */
function schauSzenario(name: string, description: string, scene: RenderSceneId, time: number): PartikelSzenario {
  let render: PartikelRender | null = null;
  return {
    name,
    description,
    settleFrames: RUHE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined) throw new Error(`Szenario ${name} braucht den Renderer`);
      render = r;
      r.showScene(scene);
      r.setDebugView('off');
      ctx.freezeAt(time);
    },
    ready: () => render?.sceneReady() ?? false,
  };
}

/** A weather picture of the game view: biome showcase, season, hour, weather state. */
interface Wetter {
  readonly name: string;
  readonly description: string;
  readonly biome: string;
  readonly season: 'fruehling' | 'sommer' | 'herbst' | 'winter';
  readonly hour: number;
  readonly minute: number;
  readonly weather: string;
}

type Phase = 'welt' | 'nachlauf' | 'wind' | 'warten' | 'fertig';

/** Whether `wind` [px/s] crosses the view (its east-west share is at least `QUERWIND_ANTEIL` of its speed). */
export function querwind(wind: { x: number; y: number }): boolean {
  const speed = Math.hypot(wind.x, wind.y);
  return speed > 0 && Math.abs(wind.x) >= QUERWIND_ANTEIL * speed;
}

function wetterSzenario(w: Wetter): PartikelSzenario {
  let render: PartikelRender | null = null;
  let session: PartikelSitzung | null = null;
  let phase: Phase = 'welt';
  let versuche = 0;
  return {
    name: w.name,
    description: w.description,
    settleFrames: RUHE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session === undefined) throw new Error(`Szenario ${w.name} braucht Renderer und Sitzung`);
      render = r;
      session = ctx.session;
      phase = 'welt';
      versuche = 0;
      r.startGameCamera({ kind: 'biom', biome: w.biome });
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(WETTER_ZEIT);
    },
    ready() {
      const r = render;
      const s = session;
      if (r === null || s === null || !r.sceneReady()) return false;
      switch (phase) {
        case 'welt': {
          const at = r.gameCamera();
          if (at === null) return false;
          s.command({ type: 'setSeason', season: w.season });
          s.command({ type: 'setTime', hour: w.hour, minute: w.minute });
          s.command({ type: 'setWeather', state: w.weather });
          s.step();
          phase = 'nachlauf';
          return false;
        }
        case 'nachlauf':
          s.command({ type: 'advanceTime', minutes: WETTER_NACHLAUF_MIN });
          s.step();
          phase = 'wind';
          return false;
        case 'wind': {
          // The frame drawn after the last command shows the period's wind.
          const wind = r.particleWind?.() ?? null;
          if (wind === null || querwind(wind) || versuche >= QUERWIND_VERSUCHE) {
            phase = 'warten';
            return false;
          }
          versuche++;
          s.command({ type: 'setWeather', state: w.weather });
          s.step();
          return false;
        }
        case 'warten':
          phase = 'fertig';
          return false;
        case 'fertig':
          return true;
      }
    },
  };
}

/** The particle strand's scenarios, in screenshot order. */
export function partikelSzenarien(): PartikelSzenario[] {
  return [
    schauSzenario(
      'partikel',
      'M5-11: GPU-Partikel auf der Grünhain-Lichtung bei Einbruch der Nacht – Lagerfeuer mit Funken, Glut und Rauch (von unten orange beleuchtet), Hitzeflimmern, funkende Fackeln, ein aufsteigender Lumen-Sturm, Glühwürmchen',
      'partikel',
      SCHAU_ZEIT,
    ),
    schauSzenario('partikel-20000', 'M5-11: Stressbild der GPU-Partikel – vier Lumen-Stürme, Lagerfeuer, Fackeln, Glühwürmchen: mindestens 20 000 Partikel zugleich', 'partikel-20000', SCHAU_ZEIT),
    schauSzenario('partikel-gewitter', 'M5-12: Gewitter über der Lichtung bei Nacht – Regen im Fackel- und Feuerschein, im ersten Lichtblitz eines Einschlags', 'partikel-gewitter', THUNDERSTORM_FLASH_TIME),
    wetterSzenario({
      name: 'regen',
      description: 'M5-12: Regen im Grünhain am Nachmittag (Wetter der Simulation) – schräge Striche im Windwinkel, drei Parallaxe-Schichten, Spritzer am Boden',
      biome: 'gruenhain',
      season: 'sommer',
      hour: 15,
      minute: 0,
      weather: 'regen',
    }),
    wetterSzenario({
      name: 'schnee',
      description: 'M5-12: Schneefall im Frostkamm zur Mittagszeit – schwankende Flocken in drei Parallaxe-Schichten, liegenbleibende Flocken, die schmelzen',
      biome: 'frostkamm',
      season: 'winter',
      hour: 12,
      minute: 0,
      weather: 'schnee',
    }),
    wetterSzenario({
      name: 'ascheregen',
      description: 'M5-12: Ascheregen im Aschenschlund in der Dämmerung – taumelnde graue Flocken, jede zehnte eine glimmende Glut',
      biome: 'aschenschlund',
      season: 'herbst',
      hour: 17,
      minute: 0,
      weather: 'ascheregen',
    }),
    wetterSzenario({
      name: 'sandsturm',
      description: 'M5-12: Sandsturm im Glutsand am Mittag – Körner und Staubschleier jagen in Windrichtung flach über den Boden',
      biome: 'glutsand',
      season: 'sommer',
      hour: 13,
      minute: 0,
      weather: 'sandsturm',
    }),
  ];
}
