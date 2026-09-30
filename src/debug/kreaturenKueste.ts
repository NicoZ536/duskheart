/**
 * Screenshot scenarios of the Salt Coast creatures and the shadow brood (M6-23 … M6-26, M6-29; MASTERPROMPT §4.6 "Gegner
 * heben sich in jedem Biom und nachts ab (emissive Augen, Rim-Licht)", §20.1, §31.5; docs/ART.md §15): each looks for the
 * nearest spot around a biome's showcase where every member of its cast finds its ground within two tiles of its planned
 * place (open dry land, or water for the swimmers), sets the clock and clear weather, spawns the player (god mode: the
 * foes may not end the picture) and the cast on those places, then steps the simulation a fixed number of times – the
 * picture is the same on every run.
 *
 * - `kreaturen-kueste`: the Salt Coast at noon – crabs, gulls and a seal on the beach, a jellyfish in the
 *   shallows, a lobster and a beach raider outside their hours (both hunt at dusk and night).
 * - `kreaturen-kueste-nacht`: the coast at 23:00, the player with a torch – the lobster's cold eyes, a pair of beach raiders
 *   with violet eyes, the jellyfish glowing in the water, a crab.
 * - `schattenbrut-materialisierung`: Grünhain at 23:00, the player with a torch – two stalkers, a crawler and a spitter
 *   forming out of the ink smoke 0,6 s after they appeared (from the ground up, a violet rim glowing at the edge of the
 *   smoke; src/render/batch/materialize.ts).
 * - `schattenbrut-augen-nacht`: the brood with a light eater at 01:00 without a torch, whole, a few tiles off – in the
 *   dark only their glowing eyes, the spitter's sac and the light eater's maw show.
 * - `nachtmahr`: Grünhain at 23:00, fear at its height, the player with a torch – the Nachtmahr whole, a few tiles off.
 *
 * Only commands set the state up (`setTime`, `setWeather`, `player.spawn`, `debug.god`, `fear.set`, the torch,
 * `creature.spawn` with explicit places). Registered in src/debug/scenarios.ts with one line.
 */
import { equipmentRef } from '../game/items/slots';
import type { RenderSceneId } from '../render/scenes/ids';
import type { GameCameraStart } from '../render/world/gameScene';
import { surfaceWorldQuery, type SurfaceWorldQuery } from '../render/world/surfaceScene';
import { TILE_PX } from '../world/model/coords';
import { nothingInReach } from './biomScenarios';

/** Presentation time of the frozen picture [s] (idle breathing mid-cycle; the smoke's drift). */
const PICTURE_TIME = 0.4;
/** Frames until the picture counts as stable after the creatures appeared. */
const SETTLE_FRAMES = 8;
/** How far from the camera's tile the player's spot is looked for [tiles]. */
const SEARCH_TILES = 32;
/** How far a role may stand from its planned spot when that tile is taken [tiles]. */
const ROLE_SLACK_TILES = 2;
/** Tiles south of a creature's spot, and columns to each side, where no tree may stand (a crown would hide it). */
const CROWN_TILES = 6;
const CROWN_SIDE_TILES = 2;
const TREE_PREFIX = 'baum_';
/** Simulation steps after the creatures appear when the picture names none (their first thoughts; nobody walks off). */
const STEPS_AFTER = 2;
const NOON = { hour: 12, minute: 0 } as const;
const NIGHT = { hour: 23, minute: 0 } as const;
const DEEP_NIGHT = { hour: 1, minute: 0 } as const;
/** Fear at the Nachtmahr's picture [points]: just below 100, so the fear system's own Nachtmahr stays away. */
const FEAR_HIGH = 95;

/** One member of the cast: a creature (or `count` of them as one pack) on a spot relative to the player [tiles]. */
interface Role {
  readonly creature: string;
  readonly dx: number;
  readonly dy: number;
  readonly count?: number;
  /** It needs water (swimmers) instead of dry land. */
  readonly water?: boolean;
}

/** One picture. */
interface Picture {
  readonly name: string;
  readonly description: string;
  readonly biome: string;
  readonly time: { readonly hour: number; readonly minute: number };
  readonly cast: readonly Role[];
  /** Steps after the creatures appeared (default `STEPS_AFTER`). */
  readonly steps?: number;
  /** The player holds a burning torch in the off hand. */
  readonly torch?: boolean;
  /** The player's fear [points]. */
  readonly fear?: number;
}

const BRUT: readonly Role[] = [
  { creature: 'schleicher', dx: 5, dy: -2, count: 2 },
  { creature: 'kriecher', dx: -5, dy: 1 },
  { creature: 'speier', dx: 3, dy: 3 },
  { creature: 'lichtfresser', dx: -3, dy: -3 },
];

/** The forming brood, near enough for the torch's light (the light eater stays out: its area telegraph would cover the picture). */
const FORMING: readonly Role[] = [
  { creature: 'schleicher', dx: 4, dy: -2, count: 2 },
  { creature: 'kriecher', dx: -4, dy: 1 },
  { creature: 'speier', dx: 3, dy: 3 },
];

const PICTURES: readonly Picture[] = [
  {
    name: 'kreaturen-kueste',
    description: 'M6-23/M6-24: die Salzküste am Mittag – zwei Krabben, zwei Möwen und eine Robbe am Strand, eine Qualle im flachen Wasser, ein Scherenkrebs und ein Strandräuber außerhalb ihrer Stunden (beide jagen erst in Dämmerung und Nacht); jede Figur hebt sich vom Sand ab',
    biome: 'salzkueste',
    time: NOON,
    cast: [
      { creature: 'krabbe', dx: 2, dy: 1 },
      { creature: 'krabbe', dx: -2, dy: 3 },
      { creature: 'moewe', dx: -4, dy: -2 },
      { creature: 'moewe', dx: 1, dy: -3 },
      { creature: 'robbe', dx: -6, dy: 1 },
      { creature: 'qualle', dx: 5, dy: 0, water: true },
      { creature: 'scherenkrebs', dx: -2, dy: -3 },
      { creature: 'strandraeuber', dx: -5, dy: 4 },
    ],
  },
  {
    name: 'kreaturen-kueste-nacht',
    description: 'M6-24: die Küste um 23:00, der Spieler mit Fackel – die kalten Augen des Scherenkrebses, zwei Strandräuber mit violetten Augen, die im Wasser leuchtende Qualle und eine Krabbe; im Dunkeln tragen die emissiven Augen und der Lichtsaum der Fackel die Lesbarkeit (§4.6)',
    biome: 'salzkueste',
    time: NIGHT,
    cast: [
      { creature: 'scherenkrebs', dx: 1, dy: -2 },
      { creature: 'strandraeuber', dx: -4, dy: 1, count: 2 },
      { creature: 'qualle', dx: 4, dy: 1, water: true },
      { creature: 'krabbe', dx: 1, dy: 3 },
    ],
    torch: true,
  },
  {
    name: 'schattenbrut-materialisierung',
    description: 'M6-25: Grünhain um 23:00, der Spieler mit Fackel – zwei Schleicher, ein Kriecher und ein Speier formen sich 0,6 s nach ihrem Erscheinen aus Tinten-Rauch: vom Boden her, am Rand des Rauchs ein glühender violetter Saum',
    biome: 'gruenhain',
    time: NIGHT,
    cast: FORMING,
    // 36 ticks: the brood forms over 54 (`MATERIALIZE.formSeconds`) – a third of the body is still smoke.
    steps: 36,
    torch: true,
  },
  {
    name: 'schattenbrut-augen-nacht',
    description: 'M6-25: dieselbe Brut um 01:00 ohne Fackel, ganz geformt – im Dunkeln zeigen sich nur die glühenden Augen, der Glutsack des Speiers und der Schlund des Lichtfressers (§12.2 „Gegner im Dunkeln sind nur als Augen erkennbar“)',
    biome: 'gruenhain',
    time: DEEP_NIGHT,
    cast: BRUT,
    // 60 ticks: whole (the forming takes 54).
    steps: 60,
  },
  {
    name: 'nachtmahr',
    description: 'M6-29: Grünhain um 23:00 bei Furcht 95, der Spieler mit Fackel – der Nachtmahr ganz geformt, ein paar Kacheln entfernt: ein gehörnter Schattenhengst mit glühenden Rissen, offenem glimmendem Maul und eisweißen Augen',
    biome: 'gruenhain',
    time: NIGHT,
    cast: [{ creature: 'nachtmahr', dx: 4, dy: -1 }],
    steps: 56,
    torch: true,
    fear: FEAR_HIGH,
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
  readonly session?: { command(raw: unknown): unknown; step(): void };
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface CoastCreatureScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: ScenarioContextPart): void;
  ready(): boolean;
}

/** A role's place [tile]. */
interface Place {
  readonly tx: number;
  readonly ty: number;
}

/**
 * Whether a role can stand on (x, y) with the player on `level`: its ground (water for swimmers, open dry land on the
 * player's level for the rest) with no object on it and no tree whose crown could hide it; null while a chunk is missing.
 */
function roleGround(q: SurfaceWorldQuery, x: number, y: number, role: Role, level: number): boolean | null {
  const g = q.groundAt(x, y);
  if (g === null) return null;
  if (role.water === true) return g.water;
  if (g.water || g.solid || g.level !== level) return false;
  const o = q.objectAt(x, y);
  if (o === null) return null;
  if (o !== '') return false;
  for (let k = 0; k <= CROWN_TILES; k++) {
    for (let side = -CROWN_SIDE_TILES; side <= CROWN_SIDE_TILES; side++) {
      const t = q.objectAt(x + side, y + k);
      if (t === null) return null;
      if (t.startsWith(TREE_PREFIX)) return false;
    }
  }
  return true;
}

/**
 * The places of the cast with the player on (tx, ty): nothing in the player's reach, the player on dry land, and every role
 * on the nearest free tile of its ground within `ROLE_SLACK_TILES` of its planned spot (ring by ring: deterministic); false
 * when a role finds none, null while a chunk is not resident.
 */
function castPlaces(q: SurfaceWorldQuery, tx: number, ty: number, cast: readonly Role[]): Place[] | false | null {
  const reach = nothingInReach(q, tx, ty);
  if (reach !== true) return reach === null ? null : false;
  const here = q.groundAt(tx, ty);
  if (here === null) return null;
  if (here.water || here.solid) return false;
  const places: Place[] = [];
  for (const role of cast) {
    let found: Place | null = null;
    for (let r = 0; r <= ROLE_SLACK_TILES && found === null; r++) {
      for (let oy = -r; oy <= r && found === null; oy++) {
        for (let ox = -r; ox <= r && found === null; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          const x = tx + role.dx + ox;
          const y = ty + role.dy + oy;
          if ((x === tx && y === ty) || places.some((p) => p.tx === x && p.ty === y)) continue;
          const ok = roleGround(q, x, y, role, here.level);
          if (ok === null) return null;
          if (ok) found = { tx: x, ty: y };
        }
      }
    }
    if (found === null) return false;
    places.push(found);
  }
  return places;
}

/** The player's spot nearest to (tx, ty) within `SEARCH_TILES` and the cast's places (ring by ring: deterministic); null while a chunk is missing. */
function pictureSpot(q: SurfaceWorldQuery, tx: number, ty: number, p: Picture): { player: Place; cast: Place[] } | null {
  for (let r = 0; r <= SEARCH_TILES; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cast = castPlaces(q, tx + dx, ty + dy, p.cast);
        if (cast === null) return null;
        if (cast !== false) return { player: { tx: tx + dx, ty: ty + dy }, cast };
      }
    }
  }
  throw new Error(`Szenario ${p.name}: kein Platz für das Bild im Umkreis von ${SEARCH_TILES} Kacheln um (${tx}, ${ty})`);
}

function scenario(p: Picture): CoastCreatureScenario {
  let render: ScenarioRenderPart | null = null;
  let session: NonNullable<ScenarioContextPart['session']> | null = null;
  let phase: 'welt' | 'ort' | 'tiere' | 'fertig' = 'welt';
  let steps = 0;
  let places: Place[] = [];
  let player: Place = { tx: 0, ty: 0 };
  let equipped = false;
  const total = p.steps ?? STEPS_AFTER;
  const start: GameCameraStart = { kind: 'biom', biome: p.biome };
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
      equipped = false;
      r.startGameCamera(start);
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
          places = spot.cast;
          player = spot.player;
          s.command({ type: 'player.spawn', tx: spot.player.tx, ty: spot.player.ty, layer: 0 });
          s.command({ type: 'debug.god', on: true });
          if (p.fear !== undefined) s.command({ type: 'fear.set', value: p.fear });
          // The torch once (a second search moves the player only).
          if (p.torch === true && !equipped) {
            equipped = true;
            s.command({ type: 'inventory.give', item: 'fackel', count: 1 });
            s.command({ type: 'inventory.move', from: { bereich: 'schnellleiste', index: 0 }, to: equipmentRef('nebenhand') });
            s.command({ type: 'light.toggle' });
          }
          s.step();
          phase = 'tiere';
          return false;
        }
        case 'tiere': {
          const q = surfaceWorldQuery();
          if (q === null) return false;
          if (steps === 0) {
            // The world objects of a chunk can arrive after its ground: the spot is checked again on the finished world
            // before the cast appears, and looked for anew (around the player) when an object has turned up in reach.
            q.layer = 0;
            const again = castPlaces(q, player.tx, player.ty, p.cast);
            if (again === null) return false;
            if (again === false) {
              phase = 'ort';
              return false;
            }
            places = again;
            p.cast.forEach((c, i) => {
              const at = places[i] as Place;
              s.command({ type: 'creature.spawn', creature: c.creature, count: c.count ?? 1, x: (at.tx + 0.5) * TILE_PX, y: (at.ty + 0.5) * TILE_PX, layer: 0 });
            });
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

/** The screenshot scenarios of the Salt Coast creatures, the shadow brood and the Nachtmahr. */
export function coastCreatureScenarios(): CoastCreatureScenario[] {
  return PICTURES.map(scenario);
}
