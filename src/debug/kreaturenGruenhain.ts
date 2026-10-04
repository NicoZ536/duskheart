/**
 * Screenshot scenarios of the Grünhain creatures of M6-20 … M6-22 (MASTERPROMPT §4.6 "Gegner heben sich in jedem Biom und
 * nachts ab", §20.1, §31.5; docs/ART.md §15): each looks for the nearest open meadow around Grünhain's showcase, sets the
 * clock and clear weather, spawns the player (god mode: the foes may not end the picture) and the cast on their planned
 * spots, then steps the simulation a fixed number of times – the picture is the same on every run.
 *
 * - `kreaturen-gruenhain-gegner`: dusk (19:00 in spring) – a boar, a badger and a wolf pack of three round the player, their
 *   eyes starting to glow; all of them on the meadow (grey wolves on the grey builder paving kept only their outline).
 * - `kreaturen-gruenhain-gegner-nacht`: the same foes at 23:00, the player with a torch – in the dark their eyes and the
 *   rim of the torchlight.
 * - `kreaturen-gruenhain-klein`: a spring night at 23:00, the player with a torch – squirrel (asleep, it is awake by day) and
 *   two frogs in the torch's light on the meadow (without a light they were as dark as the ground, ADR-0168), two firefly
 *   swarms out in the dark; the drifting fireflies of the world surface keep clear of the creatures (M5-23: no second glow).
 * - `kreaturen-gruenhain-lauer`: noon – two Dornlinge, one far off still a berry bush, one right beside the player springing
 *   its ambush (0,4 s into the wind-up: the bush shakes, the eyes open), a wasp swarm, a squirrel and a frog.
 *
 * Only commands set the state up (`setTime`, `setWeather`, `player.spawn`, `debug.god`, the torch, `creature.spawn` with explicit
 * places; a picture with `clearStock` first clears the world's own creatures from its view – `despawn`,
 * src/debug/scenarioCreatures.ts – so only its cast stands in it). Registered in src/debug/scenarios.ts with one line.
 */
import { equipmentRef } from '../game/items/slots';
import type { Simulation } from '../game/sim';
import type { RenderSceneId } from '../render/scenes/ids';
import type { GameCameraStart } from '../render/world/gameScene';
import { surfaceWorldQuery, type SurfaceWorldQuery } from '../render/world/surfaceScene';
import { TILE_PX } from '../world/model/coords';
import { nothingInReach } from './biomScenarios';
import { clearCreatures, PAVED_GROUND, STOCK_CLEARING } from './scenarioCreatures';

/** Where the camera starts: Grünhain's showcase window (meadow, trees, grass). */
const START: GameCameraStart = { kind: 'biom', biome: 'gruenhain' };
/** Presentation time of the frozen picture [s] (idle breathing mid-cycle). */
const PICTURE_TIME = 0.4;
/** Frames until the picture counts as stable after the creatures appeared. */
const SETTLE_FRAMES = 8;
/** How far from the camera's tile the player's spot is looked for [tiles]. */
const SEARCH_TILES = 28;
/**
 * Tiles south of a creature's spot, and columns to each side, where no tree may stand: the crown of a big tree reaches this
 * far north of its trunk and half its width to the sides (world objects `baum_<art>`).
 */
const CROWN_TILES = 5;
const CROWN_SIDE_TILES = 1;
const TREE_PREFIX = 'baum_';
/** Simulation steps after the creatures appear when the scenario names none (their first thoughts; nobody walks off). */
const STEPS_AFTER = 2;
/** Dusk and night clock times (spring: dusk 18–20 h, night from 20 h). */
const DUSK = { hour: 19, minute: 0 } as const;
const NIGHT = { hour: 23, minute: 0 } as const;
const NOON = { hour: 12, minute: 0 } as const;

/** One member of the cast: a creature (or `count` of them as one pack) on a spot relative to the player [tiles]. */
export interface Role {
  readonly creature: string;
  readonly dx: number;
  readonly dy: number;
  readonly count?: number;
  /** It hovers above the ground (a firefly swarm): the ground it floats over does not decide how it reads. */
  readonly flies?: boolean;
}

/** One picture. */
export interface Picture {
  readonly name: string;
  readonly description: string;
  readonly time: { readonly hour: number; readonly minute: number };
  readonly cast: readonly Role[];
  /** Steps after the creatures appeared (default `STEPS_AFTER`). */
  readonly steps?: number;
  /** The player holds a burning torch in the off hand. */
  readonly torch?: boolean;
  /**
   * The cast stands on the biome's own ground, its packs' tiles too – not on the grey builder paving (`PAVED_GROUND`), where
   * grey fur keeps only its outline.
   */
  readonly naturalGround?: boolean;
  /** The world's own creatures leave the view before the cast appears (`STOCK_CLEARING`): only the cast stands in it. */
  readonly clearStock?: boolean;
  /**
   * No tree on the eight tiles round a role on the ground: its sprite would stand against the trunk (a boar under a pine,
   * a wolf beside a birch); tufts and finds may stay – the meadow is full of them.
   */
  readonly treeFree?: boolean;
}

const FOES: readonly Role[] = [
  { creature: 'keiler', dx: 4, dy: -2 },
  { creature: 'dachs', dx: -4, dy: 2 },
  { creature: 'wolf', dx: 2, dy: 3, count: 3 },
];

/**
 * The same foes on the meadow (`kreaturen-gruenhain-gegner`): the boar east, the badger west, the pack south of the player –
 * placed where all of them stand on grass, no trunk beside them (round the showcase the planned spots of `FOES` lie on the
 * paving of the ruin).
 */
const FOES_MEADOW: readonly Role[] = [
  { creature: 'keiler', dx: 4, dy: 0 },
  { creature: 'dachs', dx: -4, dy: 0 },
  { creature: 'wolf', dx: 0, dy: 3, count: 3 },
];

const PICTURES: readonly Picture[] = [
  {
    name: 'kreaturen-gruenhain-gegner',
    description: 'M6-21: Grünhain in der Abenddämmerung (19:00, Frühling) – ein Keiler, ein Dachs und ein Wolfsrudel aus drei Wölfen um den Spieler, alle auf der Wiese; die Augen der Nachtjäger beginnen zu glühen, jede Figur hebt sich mit Kontur vom Gras ab',
    time: DUSK,
    cast: FOES_MEADOW,
    naturalGround: true,
    treeFree: true,
    clearStock: true,
  },
  {
    name: 'kreaturen-gruenhain-gegner-nacht',
    description: 'M6-21: dieselben Gegner um 23:00, der Spieler mit Fackel – im Dunkeln tragen die emissiven Augen (feuer.3/4) und der Lichtsaum der Fackel die Lesbarkeit (§4.6)',
    time: NIGHT,
    cast: FOES,
    torch: true,
  },
  {
    name: 'kreaturen-gruenhain-klein',
    description: 'M6-20: Frühlingsnacht um 23:00, der Spieler mit Fackel – im Lichtkreis auf der Wiese ein schlafendes Eichhörnchen und zwei Frösche, draußen im Dunkeln zwei Glühwürmchen-Schwärme; die schwebenden Glühwürmchen der Oberfläche halten Abstand zu den Kreaturen, kein doppeltes Leuchten',
    time: NIGHT,
    // The small animals within the torch's bright core (light 0,5 lies 2–2,5 tiles out), the swarms beyond it in the dark,
    // where their own glow reads.
    cast: [
      { creature: 'eichhoernchen', dx: 2, dy: 1 },
      { creature: 'frosch', dx: -2, dy: 0 },
      { creature: 'frosch', dx: 0, dy: 2 },
      { creature: 'gluehwuermchen', dx: 5, dy: -2, flies: true },
      { creature: 'gluehwuermchen', dx: -4, dy: 3, flies: true },
    ],
    torch: true,
    naturalGround: true,
    treeFree: true,
    clearStock: true,
  },
  {
    name: 'kreaturen-gruenhain-lauer',
    description: 'M6-22: Mittag – ein Dornling in der Ferne als Beerenstrauch getarnt, ein zweiter direkt neben dem Spieler im Überfall (0,4 s ins Ausholen: der Busch bebt, die Augen öffnen sich), ein Wespenschwarm, ein Eichhörnchen und ein Frosch',
    time: NOON,
    cast: [
      { creature: 'dornling', dx: -5, dy: 1 },
      { creature: 'dornling', dx: 1, dy: 1 },
      { creature: 'wespenschwarm', dx: 4, dy: -1 },
      { creature: 'eichhoernchen', dx: -2, dy: 3 },
      { creature: 'frosch', dx: 3, dy: 3 },
    ],
    // 24 ticks: the ambush winds up for 30.
    steps: 24,
  },
];

/** What the scenario needs of the renderer (`ScenarioRender`). */
interface ScenarioRenderPart {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
}

/** What the scenario needs of its context (`ScenarioContext`). */
interface ScenarioContextPart {
  freezeAt(seconds: number): void;
  readonly render?: ScenarioRenderPart;
  readonly session?: { command(raw: unknown): unknown; step(): void; sim?(): Simulation };
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface GruenhainCreatureScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: ScenarioContextPart): void;
  ready(): boolean;
}

/** What the spot search reads of the world (`SurfaceWorldQuery`). */
type WorldQuery = Pick<SurfaceWorldQuery, 'groundAt' | 'objectAt'>;

/** Whether tile (x, y) is paved (`PAVED_GROUND`); null while its chunk is not resident. */
function paved(q: WorldQuery, x: number, y: number): boolean | null {
  const g = q.groundAt(x, y);
  return g === null ? null : PAVED_GROUND.includes(g.terrain);
}

/**
 * Whether the player on (tx, ty) makes the picture: nothing in its reach, every role's spot open ground on the player's level
 * with no object on it and no tree whose crown could hide it – with `naturalGround` unpaved, a pack's spot with its eight
 * neighbours (its other members take the free tiles round its spot: `creature.spawn` looks ring by ring), with `treeFree` no
 * tree on the eight tiles round it; fliers excepted from both; null while a chunk is not resident.
 */
export function goodSpot(q: WorldQuery, tx: number, ty: number, cast: readonly Role[], naturalGround = false, treeFree = false): boolean | null {
  const reach = nothingInReach(q, tx, ty);
  if (reach !== true) return reach;
  const level = q.groundAt(tx, ty)?.level;
  for (const c of cast) {
    const g = q.groundAt(tx + c.dx, ty + c.dy);
    if (g === null) return null;
    if (g.water || g.solid || g.level !== level) return false;
    const here = q.objectAt(tx + c.dx, ty + c.dy);
    if (here === null) return null;
    if (here !== '') return false;
    for (let k = 0; k <= CROWN_TILES; k++) {
      for (let side = -CROWN_SIDE_TILES; side <= CROWN_SIDE_TILES; side++) {
        const o = q.objectAt(tx + c.dx + side, ty + c.dy + k);
        if (o === null) return null;
        if (o.startsWith(TREE_PREFIX)) return false;
      }
    }
    if (treeFree && c.flies !== true) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const o = q.objectAt(tx + c.dx + dx, ty + c.dy + dy);
          if (o === null) return null;
          if (o.startsWith(TREE_PREFIX)) return false;
        }
      }
    }
    if (naturalGround && c.flies !== true) {
      const ring = (c.count ?? 1) > 1 ? 1 : 0;
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          const p = paved(q, tx + c.dx + dx, ty + c.dy + dy);
          if (p !== false) return p === null ? null : false;
        }
      }
    }
  }
  return true;
}

/** The spot nearest to (tx, ty) within `SEARCH_TILES` (ring by ring: deterministic); null while a chunk is missing. */
function pictureSpot(q: WorldQuery, tx: number, ty: number, p: Picture): { tx: number; ty: number } | null {
  for (let r = 0; r <= SEARCH_TILES; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const good = goodSpot(q, tx + dx, ty + dy, p.cast, p.naturalGround === true, p.treeFree === true);
        if (good === null) return null;
        if (good) return { tx: tx + dx, ty: ty + dy };
      }
    }
  }
  throw new Error(`Szenario ${p.name}: kein Platz für das Bild im Umkreis von ${SEARCH_TILES} Kacheln um (${tx}, ${ty})`);
}

function scenario(p: Picture): GruenhainCreatureScenario {
  let render: ScenarioRenderPart | null = null;
  let session: NonNullable<ScenarioContextPart['session']> | null = null;
  let phase: 'welt' | 'ort' | 'raeumen' | 'tiere' | 'fertig' = 'welt';
  let steps = 0;
  let player = { tx: 0, ty: 0 };
  const total = p.steps ?? STEPS_AFTER;
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
      steps = 0;
      r.startGameCamera(START);
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(PICTURE_TIME);
    },
    ready() {
      const r = render;
      const s = session;
      if (r === null || s === null || !r.sceneReady()) return false;
      switch (phase) {
        case 'welt': {
          if (r.gameCamera() === null) return false;
          s.command({ type: 'setTime', hour: p.time.hour, minute: p.time.minute });
          s.command({ type: 'setWeather', state: 'klar' });
          s.step();
          phase = 'ort';
          return false;
        }
        case 'ort': {
          const at = r.gameCamera();
          const q = surfaceWorldQuery();
          if (at === null || q === null) return false;
          q.layer = 0;
          const spot = pictureSpot(q, at.tx, at.ty, p);
          if (spot === null) return false;
          player = spot;
          s.command({ type: 'player.spawn', tx: spot.tx, ty: spot.ty, layer: 0 });
          s.command({ type: 'debug.god', on: true });
          if (p.torch === true) {
            s.command({ type: 'inventory.give', item: 'fackel', count: 1 });
            s.command({ type: 'inventory.move', from: { bereich: 'schnellleiste', index: 0 }, to: equipmentRef('nebenhand') });
            s.command({ type: 'light.toggle' });
          }
          s.step();
          phase = p.clearStock === true ? 'raeumen' : 'tiere';
          return false;
        }
        case 'raeumen': {
          // The stock of the chunks was seeded on the world tick of the spawn: it leaves the view, then the cast appears.
          clearCreatures(s, 0, (player.tx + 0.5) * TILE_PX, (player.ty + 0.5) * TILE_PX, STOCK_CLEARING);
          s.step();
          phase = 'tiere';
          return false;
        }
        case 'tiere': {
          const q = surfaceWorldQuery();
          if (q === null) return false;
          if (steps === 0) {
            if (p.cast.some((c) => q.groundAt(player.tx + c.dx, player.ty + c.dy) === null)) return false;
            for (const c of p.cast) {
              s.command({ type: 'creature.spawn', creature: c.creature, count: c.count ?? 1, x: (player.tx + c.dx + 0.5) * TILE_PX, y: (player.ty + c.dy + 0.5) * TILE_PX, layer: 0 });
            }
          }
          s.step();
          steps++;
          if (steps >= total) phase = 'fertig';
          return false;
        }
        case 'fertig':
          return true;
      }
    },
  };
}

/** The picture `name` of this file (its cast and options – tests), or undefined. */
export function gruenhainPicture(name: string): Picture | undefined {
  return PICTURES.find((p) => p.name === name);
}

/** The screenshot scenarios of the Grünhain creatures. */
export function gruenhainCreatureScenarios(): GruenhainCreatureScenario[] {
  return PICTURES.map(scenario);
}
