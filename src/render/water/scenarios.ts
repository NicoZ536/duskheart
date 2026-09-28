/**
 * Screenshot scenarios of the water (M5-07 … M5-09, M5-23; MASTERPROMPT §31.5), all on the game view of the session's
 * world (seed of the boot session), set up by commands only and stable once the view around the player is complete:
 * - `wasser-ufer` (M5-07): a Grünhain lake at 11:00 in sunshine, the player on its south bank – refraction of the
 *   ground under the small waves, depth colouring from the turquoise shallows to the deep blue, shore foam along the
 *   distance field, caustics in the sunny shallows.
 * - `wasser-spiegelung-tag` (M5-08): the same lake from its north bank at 15:00 – the player, the trees and the bank
 *   above the shoreline mirrored in the water, the day sky between them, sun glitter on the waves.
 * - `wasser-spiegelung-nacht` (M5-08, M5-23): the north bank at 23:00 in a clear full-moon night, a camp fire and a
 *   torch on a stake at the shore – the moon with its glitter path, the stars, the firelit figure and the bank wall
 *   mirrored.
 * - `wasser-wellen` (M5-09): the player swims out through the lake in the rain – the wake of the swimmer, the rings
 *   of the raindrops and of a fish, running out at the banks; the presentation clock steps with the simulation so the
 *   waves are the same on every run.
 * - `wasser-eis` (M5-09): the lake north of the Frostkamm showcase in winter at noon (far below freezing) – plates of
 *   ice with cracks grown from the bank over the open water, glacier ice with the same crack network around it.
 *
 * Places are searched, not hard-wired: the player spawns at the camera's tile (the showcase of the biome), then the
 * tiles around it are tried ring by ring in a fixed order against the water grid of the game view
 * (`ScenarioRender.waterDepth`, known once every chunk under the grid is loaded) – a bank tile is dry land with water
 * in front and water of the picture's depth two tiles out; without one in reach the player moves on to the picture's
 * next search place (`hops`). The world and the order are fixed, so the picture is the same on every run. Registered in
 * src/debug/scenarios.ts.
 */
import type { SessionDebugState } from '../../game/session';
import { TILE_PX } from '../../world/model/coords';
import type { RenderSceneId } from '../scenes/ids';
import type { GameCameraStart } from '../world/gameScene';
import { campCommands } from '../game/lightsSzenario';
import { WAVES } from './params';

/** What the scenarios need of the renderer (`ScenarioRender`). */
interface ScenarioRenderPart {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
  waterDepth?(tx: number, ty: number): number;
}

/** What the scenarios need of their context (`ScenarioContext`). */
interface WaterScenarioContext {
  freezeAt(seconds: number): void;
  readonly render?: ScenarioRenderPart;
  readonly session?: { command(raw: unknown): unknown; step(): void; state?(): SessionDebugState };
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface WaterScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: WaterScenarioContext): void;
  ready(): boolean;
}

/** Scenario names. */
export const WATER_SCENARIOS = {
  shore: 'wasser-ufer',
  mirrorDay: 'wasser-spiegelung-tag',
  mirrorNight: 'wasser-spiegelung-nacht',
  waves: 'wasser-wellen',
  ice: 'wasser-eis',
} as const;

/** Presentation time of the frozen pictures [s] (waves and foam mid-cycle). */
const PICTURE_TIME = 2.2;
/** Frames until a picture counts as stable once everything stands. */
const SETTLE_FRAMES = 6;
/** Largest distance from the player's tile searched for a bank [tiles]: within the water grid around the camera (±13 tiles down). */
const SEARCH_RADIUS = 12;
/** Simulation ticks per second (the swim run steps the simulation with the presentation clock). */
const TICK_HZ = 60;
/** The swim run of `wasser-wellen`: frames, simulation ticks per frame and the frame time [s] (the wave field's step). */
const SWIM_RUN = { frames: 48, ticksPerFrame: TICK_HZ / WAVES.stepHz, frameSeconds: 1 / WAVES.stepHz } as const;
/** The full moon (`SessionWorldDebugState.moonPhase`: 0 Finstermond … 4 full moon) and the most days waited for it. */
const FULL_MOON = 4;
const MOON_SEARCH_DAYS = 9;
/** Torches on stakes along the bank of the night picture (tiles from the player; the first free one takes it). */
const NIGHT_STAKES: ReadonlyArray<readonly [number, number]> = [
  [-3, 0],
  [3, 0],
  [-4, -1],
  [4, -1],
];

/** Search places of the ice picture after its start [tiles]: northwards, a view height apart. */
const ICE_HOPS: ReadonlyArray<readonly [number, number]> = [
  [0, -24],
  [0, -48],
  [0, -72],
  [0, -96],
];

/** Tile offsets around a centre, ring by ring (Chebyshev 1 … radius), within a ring nearest first (a fixed order). */
export function ringOrder(radius: number): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (let r = 1; r <= radius; r++) {
    const ring: Array<readonly [number, number]> = [];
    for (let dx = -r; dx <= r; dx++) ring.push([dx, -r]);
    for (let dy = -r + 1; dy <= r; dy++) ring.push([r, dy]);
    for (let dx = r - 1; dx >= -r; dx--) ring.push([dx, r]);
    for (let dy = r - 1; dy > -r; dy--) ring.push([-r, dy]);
    ring.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
    out.push(...ring);
  }
  return out;
}

/** How a scenario sets up its picture. */
interface WaterPicture {
  readonly name: string;
  readonly description: string;
  readonly start: GameCameraStart;
  readonly season: 'fruehling' | 'sommer' | 'herbst' | 'winter';
  readonly hour: number;
  readonly weather: string;
  /**
   * Directions of the water from the bank [tiles], in the order they are tried at each candidate (the player stands
   * on land, deep water two tiles that way); the first that fits is the picture's.
   */
  readonly water: ReadonlyArray<readonly [number, number]>;
  /** Tiles the player steps back from the bank, away from the water (the shore then lies off the picture's centre). */
  readonly inland: number;
  /** Depth class the water two tiles out must have (1 shallow or deeper, 2 deep). */
  readonly depth: 1 | 2;
  /** Wait for a full-moon night. */
  readonly fullMoon: boolean;
  /**
   * Where to look next when no bank lies within `SEARCH_RADIUS` of the start [tiles from the start, in order]: the
   * player is teleported there, the camera follows, and the search starts again once the view and the water grid
   * around it are complete.
   */
  readonly hops?: ReadonlyArray<readonly [number, number]>;
  /** Commands once the player stands on the bank (tile of the player). */
  readonly extra?: (tx: number, ty: number) => unknown[];
  /** Swim out and let it rain: the wave run. */
  readonly swimRun: boolean;
}

type Phase = 'welt' | 'mond' | 'suchen' | 'weiter' | 'extra' | 'hinein' | 'schwimmen' | 'fertig';

function waterScenario(p: WaterPicture): WaterScenario {
  const order = ringOrder(SEARCH_RADIUS);
  let render: ScenarioRenderPart | null = null;
  let session: NonNullable<WaterScenarioContext['session']> | null = null;
  let freeze: ((s: number) => void) | null = null;
  let phase: Phase = 'welt';
  let centre = { tx: 0, ty: 0, layer: 0 };
  let start = { tx: 0, ty: 0 };
  let hop = 0;
  let days = 0;
  let bank = { tx: 0, ty: 0 };
  let dir: readonly [number, number] = [0, 1];
  let frame = 0;

  const read = (): SessionDebugState => {
    const s = session?.state;
    if (s === undefined || session === null) throw new Error(`Szenario ${p.name} braucht den Zustand der Sitzung`);
    return s.call(session);
  };
  const teleport = (tx: number, ty: number): boolean => {
    session?.command({ type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty + 0.5) * TILE_PX, layer: centre.layer });
    session?.step();
    return read().player?.swimming === true;
  };

  return {
    name: p.name,
    description: p.description,
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session === undefined) throw new Error(`Szenario ${p.name} braucht Renderer und Sitzung`);
      render = r;
      session = ctx.session;
      freeze = (s) => ctx.freezeAt(s);
      phase = 'welt';
      days = 0;
      hop = 0;
      frame = 0;
      r.startGameCamera(p.start);
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(PICTURE_TIME);
    },
    ready() {
      const s = session;
      if (render === null || s === null || freeze === null || !render.sceneReady()) return false;
      switch (phase) {
        case 'welt': {
          const at = render.gameCamera();
          if (at === null) return false;
          centre = at;
          start = { tx: at.tx, ty: at.ty };
          s.command({ type: 'setSeason', season: p.season });
          s.command({ type: 'setTime', hour: p.hour, minute: 0 });
          s.command({ type: 'player.spawn', tx: at.tx, ty: at.ty, layer: at.layer });
          s.step();
          s.command({ type: 'setWeather', state: p.weather });
          s.step();
          phase = p.fullMoon ? 'mond' : 'suchen';
          return false;
        }
        case 'mond':
          // One day per frame until the night of the full moon (the phase turns at noon).
          if (read().world.moonPhase === FULL_MOON) {
            s.command({ type: 'setWeather', state: p.weather });
            s.step();
            phase = 'suchen';
            return false;
          }
          if (++days > MOON_SEARCH_DAYS) throw new Error(`Szenario ${p.name}: kein Vollmond in ${MOON_SEARCH_DAYS} Tagen`);
          s.command({ type: 'setTime', hour: 12, minute: 0 });
          s.step();
          s.command({ type: 'setTime', hour: p.hour, minute: 0 });
          s.step();
          return false;
        case 'suchen': {
          // The bank from the water grid around the camera (the render side knows the tiles): land, water in front.
          const depth = render.waterDepth;
          if (depth === undefined) throw new Error(`Szenario ${p.name} braucht die Wassertiefe der Spielansicht (ScenarioRender.waterDepth)`);
          if (depth.call(render, centre.tx, centre.ty) < 0) return false;
          for (const o of order) {
            const tx = centre.tx + o[0];
            const ty = centre.ty + o[1];
            if (depth.call(render, tx, ty) !== 0) continue;
            const found = p.water.find(([dx, dy]) => depth.call(render, tx + dx, ty + dy) >= 1 && depth.call(render, tx + dx * 2, ty + dy * 2) >= p.depth);
            if (found === undefined) continue;
            teleport(tx, ty);
            bank = { tx, ty };
            dir = found;
            phase = 'extra';
            return false;
          }
          const next = p.hops?.[hop];
          if (next === undefined) throw new Error(`Szenario ${p.name}: kein Ufer im Umkreis von ${SEARCH_RADIUS} Kacheln um ${1 + hop} Suchorte`);
          hop++;
          centre = { tx: start.tx + next[0], ty: start.ty + next[1], layer: centre.layer };
          teleport(centre.tx, centre.ty);
          phase = 'weiter';
          return false;
        }
        case 'weiter': {
          // The camera follows the player to the next place; search once it is there (the grid then lies around it).
          const at = render.gameCamera();
          if (at === null || Math.abs(at.tx - centre.tx) > 1 || Math.abs(at.ty - centre.ty) > 1) return false;
          phase = 'suchen';
          return false;
        }
        case 'extra':
          for (const cmd of p.extra?.(bank.tx, bank.ty) ?? []) s.command(cmd);
          // Face the water, then stand still.
          s.command({ type: 'player.move', dx: dir[0], dy: dir[1] });
          s.step();
          s.command({ type: 'player.move', dx: 0, dy: 0 });
          s.step();
          teleport(bank.tx - dir[0] * p.inland, bank.ty - dir[1] * p.inland);
          phase = p.swimRun ? 'hinein' : 'fertig';
          return false;
        case 'hinein':
          // Into the deep water, facing out.
          teleport(bank.tx + dir[0] * 2, bank.ty + dir[1] * 2);
          s.command({ type: 'setWeather', state: 'regen' });
          s.step();
          phase = 'schwimmen';
          return false;
        case 'schwimmen':
          // The clock and the simulation step together: the same wake, rain and rings on every run.
          s.command({ type: 'player.move', dx: dir[0], dy: dir[1] });
          for (let t = 0; t < SWIM_RUN.ticksPerFrame; t++) s.step();
          freeze(PICTURE_TIME + ++frame * SWIM_RUN.frameSeconds);
          if (frame >= SWIM_RUN.frames) {
            s.command({ type: 'player.move', dx: 0, dy: 0 });
            s.step();
            phase = 'fertig';
          }
          return false;
        case 'fertig':
          return render.sceneReady();
      }
    },
  };
}

/** The water scenarios (registered in src/debug/scenarios.ts). */
export function waterScenarios(): WaterScenario[] {
  const gruenhain: GameCameraStart = { kind: 'biom', biome: 'gruenhain' };
  return [
    waterScenario({
      name: WATER_SCENARIOS.shore,
      description:
        'M5-07: Wasser I – Grünhain-See um 11:00 im Sonnenschein, die Figur am Südufer: der Grund unter den kleinen Wellen gebrochen (ganze Pixel), Tiefenfärbung vom türkisen Flachwasser ins Tiefblau, Uferschaum entlang des Wasser-Distanzfelds, Kaustiken im sonnigen Flachen',
      start: gruenhain,
      season: 'sommer',
      hour: 11,
      weather: 'klar',
      water: [[0, -1]],
      inland: 1,
      depth: 2,
      fullMoon: false,
      swimRun: false,
    }),
    waterScenario({
      name: WATER_SCENARIOS.mirrorDay,
      description:
        'M5-08: Wasser II – derselbe See vom Nordufer um 15:00: Figur, Bäume und Ufer über der Uferlinie spiegeln sich im Wasser, dazwischen der Taghimmel, Sonnenglitzern auf den Wellen',
      start: gruenhain,
      season: 'sommer',
      hour: 15,
      weather: 'klar',
      water: [[0, 1]],
      inland: 0,
      depth: 2,
      fullMoon: false,
      swimRun: false,
    }),
    waterScenario({
      name: WATER_SCENARIOS.mirrorNight,
      description:
        'M5-08/M5-23: Wasser II bei Nacht – das Nordufer um 23:00 in klarer Vollmondnacht, Lagerfeuer und Fackel am Ufer: der Mond mit Glitzerpfad, die Sterne, die feuerbeschienene Figur und die Uferwand spiegeln sich im Wasser',
      start: gruenhain,
      season: 'sommer',
      hour: 23,
      weather: 'klar',
      water: [[0, 1]],
      inland: 0,
      depth: 2,
      fullMoon: true,
      extra: (tx, ty) => campCommands(tx, ty, NIGHT_STAKES),
      swimRun: false,
    }),
    waterScenario({
      name: WATER_SCENARIOS.waves,
      description:
        'M5-09: Wasser III – die Figur schwimmt im Regen vom Nordufer hinaus: die Bugwelle des Schwimmers, die Ringe der Regentropfen und eines Fischs, am Ufer auslaufend (Wellengleichung in der Ping-Pong-Textur um die Kamera, Uhr und Simulation im Gleichschritt)',
      start: gruenhain,
      season: 'sommer',
      hour: 10,
      weather: 'regen',
      water: [[0, 1]],
      inland: 0,
      depth: 2,
      fullMoon: false,
      swimRun: true,
    }),
    waterScenario({
      name: WATER_SCENARIOS.ice,
      description:
        'M5-09: Winter-Eis – der See nördlich des Frostkamm-Schaufensters im Winter um 12:00, tief unter dem Gefrierpunkt: vom Ufer über das offene Wasser gewachsene Eisplatten mit Rissen (dunkler Kern, helle Kante), dahinter das offene Wasser; ringsum Gletschereis mit demselben Rissnetz',
      start: { kind: 'biom', biome: 'frostkamm' },
      season: 'winter',
      hour: 12,
      weather: 'klar',
      water: [[0, 1], [0, -1], [1, 0], [-1, 0]],
      inland: 0,
      depth: 2,
      fullMoon: false,
      swimRun: false,
      // The showcase lies between frozen-over glacier ground and a shallow stream; the lake of the Frostkamm lies north of it.
      hops: ICE_HOPS,
    }),
  ];
}
