/**
 * Screenshot scenarios of the light strand (M5-01 … M5-06; MASTERPROMPT §31.5): the game view in the Grünhain
 * showcase (trees, rocks, a cliff, water) at a set hour of a summer day, in a set weather and moon phase, the player
 * standing in the middle.
 *
 * - `debug-sdf`: the render debugger's `sdf` view at noon – the occluder distance field with its contours, trunks,
 *   rocks and raised terrain by class, the water's distance to the shore in blues.
 * - `sonne-0800`, `sonne-1200`, `sonne-1700`: the sun's silhouette shadows wander – long towards the west in the
 *   morning, short and north at noon, long towards the east in the late afternoon.
 * - `wolkenschatten`: an overcast late morning – cloud shadows drift with the wind over the meadow.
 * - `mond-voll`, `mond-neu`: 23:30 in a full-moon night (cool directed moonlight with faint shadows) and in the
 *   Finstermond (no moon: only the dark sky light).
 * - `lichtbaender-an`, `lichtbaender-aus`: a camp fire and a torch at night with the light bands (6–10 levels, 4×4
 *   Bayer dither) on and off.
 * - `fackel-schatten`: a moonless night, the player's torch and a torch on a stake among the trees – trunks and rocks
 *   throw soft shadows away from each flame (sphere tracing through the distance field with a penumbra, M5-05).
 *
 * Only commands set the state up (the scenario sees no simulation state besides `state()`): the player spawns under
 * the camera, the season, the weather and the hour are set (a full or new moon by jumping whole days), the camp by
 * the commands of the M3 light scenario. Registered in src/debug/scenarios.ts; stable once the view is complete.
 */
import type { GameCameraStart } from '../world/gameScene';
import type { RenderSceneId } from '../scenes/ids';
import { moonPhaseOfNight } from '../../world/calendar';
import { BALANCE } from '../../content/balance';
import { campCommands, STAKE_SPOTS } from '../game/lightsSzenario';
import { equipmentRef } from '../../game/items/slots';
import type { LightPipeline } from './pipeline';

/** Presentation time of the frozen pictures [s] (flames mid-flicker, clouds at a set drift). */
const PICTURE_TIME = 41.3;
/** Presentation time between `wolkenschatten` and `wolkenschatten-spaeter` [s]. */
export const CLOUD_LATER_SECONDS = 4;
/** Frames until a picture counts as stable after the state stands. */
const SETTLE_FRAMES = 6;
/** Where the camera starts and the player spawns. */
const START: GameCameraStart = { kind: 'biom', biome: 'gruenhain' };
const MINUTES_PER_DAY = 24 * 60;
/** Moon phases of the pictures (world/calendar.ts: 0 Finstermond, 4 full moon). */
const MOON = { voll: 4, neu: 0 } as const;

/** What the scenarios need of the renderer (`ScenarioRender`). */
interface SkyRender {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
  lighting?(): LightPipeline;
}

/** What the scenarios need of the session (`ScenarioSession`). */
interface SkySession {
  command(raw: unknown): unknown;
  step(): void;
  state(): { readonly day: number };
}

/** What the scenarios need of their context (`ScenarioContext`). */
interface SkyContext {
  freezeAt(seconds: number): void;
  readonly render?: SkyRender;
  readonly session?: SkySession;
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface SkyScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: SkyContext): void;
  ready(): boolean;
}

/** What a picture shows. */
export interface SkyPicture {
  readonly name: string;
  readonly description: string;
  readonly hour: number;
  readonly minute: number;
  readonly weather: string;
  /** Moon phase of the night (whole days are jumped until it comes). */
  readonly moon?: keyof typeof MOON;
  /** A camp fire and a torch on a stake beside the player, the player's torch burning. */
  readonly camp?: boolean;
  /** The player's torch burning and a torch on a stake at the first free of these tiles (relative to the player). */
  readonly torches?: ReadonlyArray<readonly [number, number]>;
  /** Presentation time of the picture [s] (absent: the pictures' common time; the clouds drift with it). */
  readonly seconds?: number;
  /** Where the player spawns relative to the showcase's centre tile [tiles] (absent: on it). */
  readonly spawn?: readonly [number, number];
  /** Light bands on or off (absent: the settings'). */
  readonly bands?: boolean;
  readonly debugView?: string;
}

/** Days from night `day` until a night of moon phase `phase` (0 … cycle − 1). */
export function daysUntilMoonPhase(day: number, phase: number): number {
  for (let k = 0; k < BALANCE.calendar.moonCycleDays; k++) if (moonPhaseOfNight(day + k) === phase) return k;
  throw new Error(`Mondphase ${phase} kommt in keinem Zyklus vor`);
}

/** Bag slots of the torches in a fresh session: both go to the hotbar. */
const TORCH_SLOTS = { hand: { bereich: 'schnellleiste', index: 0 }, stake: { bereich: 'schnellleiste', index: 1 } } as const;

/** Commands that light the player's torch and set a second one on a stake at the first free of `stakes` around (tx, ty). */
export function torchCommands(tx: number, ty: number, stakes: ReadonlyArray<readonly [number, number]>): unknown[] {
  const cmds: unknown[] = [
    { type: 'inventory.give', item: 'fackel', count: 2 },
    { type: 'inventory.move', from: TORCH_SLOTS.hand, to: equipmentRef('nebenhand') },
  ];
  for (const [dx, dy] of stakes) cmds.push({ type: 'light.place', from: TORCH_SLOTS.stake, tx: tx + dx, ty: ty + dy });
  cmds.push({ type: 'light.toggle' });
  return cmds;
}

export function skyScenario(p: SkyPicture): SkyScenario {
  let render: SkyRender | null = null;
  let session: SkySession | null = null;
  let phase: 'welt' | 'zeit' | 'wetter' | 'fertig' = 'welt';
  return {
    name: p.name,
    description: p.description,
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session === undefined) throw new Error(`Szenario ${p.name} braucht Renderer und Sitzung`);
      render = r;
      session = ctx.session;
      phase = 'welt';
      r.startGameCamera(START);
      r.showScene('spiel');
      r.setDebugView('off');
      if (p.bands !== undefined) {
        const pipeline = r.lighting?.();
        if (pipeline === undefined) throw new Error(`Szenario ${p.name} braucht die Licht-Pipeline des Renderers`);
        pipeline.configure({ ...pipeline.settings, banding: p.bands });
      }
      ctx.freezeAt(p.seconds ?? PICTURE_TIME);
    },
    ready() {
      const r = render;
      const s = session;
      if (r === null || s === null || !r.sceneReady()) return false;
      switch (phase) {
        case 'welt': {
          const at = r.gameCamera();
          if (at === null) return false;
          s.command({ type: 'setSeason', season: 'sommer' });
          s.command({ type: 'setWeather', state: p.weather });
          const [dx, dy] = p.spawn ?? [0, 0];
          s.command({ type: 'player.spawn', tx: at.tx + dx, ty: at.ty + dy, layer: 0 });
          s.command({ type: 'debug.god', on: true });
          s.step();
          phase = 'zeit';
          return false;
        }
        case 'zeit': {
          // The weather is forced before the clock jumps: the jump blends it in completely.
          s.command({ type: 'setWeather', state: p.weather });
          if (p.moon !== undefined) {
            // The season began at 06:00 of today: tonight is night `day`; jump whole days to the wanted phase.
            const k = daysUntilMoonPhase(s.state().day, MOON[p.moon]);
            if (k > 0) s.command({ type: 'advanceTime', minutes: k * MINUTES_PER_DAY });
            s.step();
          }
          s.command({ type: 'setWeather', state: p.weather });
          s.command({ type: 'setTime', hour: p.hour, minute: p.minute });
          s.step();
          phase = 'wetter';
          return false;
        }
        case 'wetter': {
          if (p.camp === true || p.torches !== undefined) {
            const at = r.gameCamera();
            if (at === null) return false;
            for (const cmd of p.camp === true ? campCommands(at.tx, at.ty) : torchCommands(at.tx, at.ty, p.torches ?? STAKE_SPOTS)) s.command(cmd);
          }
          s.step();
          r.setDebugView(p.debugView ?? 'off');
          phase = 'fertig';
          return false;
        }
        case 'fertig':
          return true;
      }
    },
  };
}

/** The pictures of the light strand (registered in src/debug/scenarios.ts). */
export const SKY_PICTURES: readonly SkyPicture[] = [
  {
    name: 'debug-sdf',
    description:
      'M5-01: Render-Debugger „sdf“ im Grünhain-Schaufenster um 12:00 – Distanzfeld der Occluder (grau, Höhenlinie alle 8 px), Stämme und Felsen ocker nach Höhe, Wände rot, erhöhtes Gelände violett nach Stufe, die Uferentfernung des Wassers in Blautönen',
    hour: 12,
    minute: 0,
    weather: 'klar',
    debugView: 'sdf',
  },
  {
    name: 'sonne-0800',
    description: 'M5-02: Grünhain um 08:00 im Sommer – die Morgensonne im Osten wirft lange, weiche Silhouettenschatten der Bäume, Felsen und Klippen nach Westen',
    hour: 8,
    minute: 0,
    weather: 'klar',
  },
  {
    name: 'sonne-1200',
    description: 'M5-02: dieselbe Stelle um 12:00 – die Sonne steht im Süden, die Schatten sind kurz und fallen nach Norden',
    hour: 12,
    minute: 0,
    weather: 'klar',
  },
  {
    name: 'sonne-1700',
    description: 'M5-02: dieselbe Stelle um 17:00 – die Nachmittagssonne im Westen, lange Schatten nach Osten, das Licht wird golden',
    hour: 17,
    minute: 0,
    weather: 'klar',
  },
  {
    name: 'wolkenschatten',
    description: 'M5-03: bewölkter Vormittag (11:00) – Wolkenschatten ziehen mit dem Wind über Wiese, Wasser und Kronen; unter den Kronen Lichtflecken im Blätterdach-Schatten',
    hour: 11,
    minute: 0,
    weather: 'bewoelkt',
  },
  {
    name: 'wolkenschatten-spaeter',
    description: `M5-03: dieselbe Stelle wie „wolkenschatten“ ${CLOUD_LATER_SECONDS} s später – die Wolkenschatten sind mit dem Wind weitergezogen (Vergleichsbild des E2E-Tests tests/e2e/wolkenschatten.spec.ts)`,
    hour: 11,
    minute: 0,
    weather: 'bewoelkt',
    seconds: PICTURE_TIME + CLOUD_LATER_SECONDS,
  },
  {
    name: 'mond-voll',
    description: 'M5-04: Vollmondnacht um 23:30 – kühles gerichtetes Mondlicht mit schwachen, langen Schatten, Relief über die Normal-Maps, der Himmel in der Nachtfarbe des Grünhains',
    hour: 23,
    minute: 30,
    weather: 'klar',
    moon: 'voll',
  },
  {
    name: 'mond-neu',
    description: 'M5-04: Finstermond um 23:30 – kein Mond, keine Schatten, nur das dunkle Himmelslicht',
    hour: 23,
    minute: 30,
    weather: 'klar',
    moon: 'neu',
  },
  {
    name: 'fackel-schatten',
    description:
      'M5-05: Finstermond um 22:30 im Grünhain – die Fackel des Spielers und eine Fackel auf einem Pfahl zwischen den Bäumen: Stämme, Felsen und die Klippenkante werfen weiche Schatten von jeder Flamme weg (Sphere-Tracing durch das Distanzfeld mit Halbschatten), die Flammen flackern',
    hour: 22,
    minute: 30,
    weather: 'klar',
    moon: 'neu',
    // In the forest west of the lake: trunks, rocks and mushrooms around the player, the stake torch among them.
    spawn: [-10, 2],
    torches: [
      [-4, 1],
      [-4, 0],
      [-5, 1],
      [-3, 1],
      [-2, -1],
      ...STAKE_SPOTS,
    ],
  },
  {
    name: 'lichtbaender-an',
    description: 'M5-06: Lager bei Nacht (22:00) mit Lagerfeuer und Fackeln, Lichtbänder an – das Punktlicht in flachen Stufen mit 4×4-Bayer-Dither an den Säumen',
    hour: 22,
    minute: 0,
    weather: 'klar',
    camp: true,
    bands: true,
  },
  {
    name: 'lichtbaender-aus',
    description: 'M5-06: dasselbe Lager mit abgeschalteten Lichtbändern – stufenloser Verlauf',
    hour: 22,
    minute: 0,
    weather: 'klar',
    camp: true,
    bands: false,
  },
];

/** The scenarios of the light strand's pictures. */
export function skyScenarios(): SkyScenario[] {
  return SKY_PICTURES.map(skyScenario);
}
