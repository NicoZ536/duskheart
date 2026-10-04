/**
 * Screenshot scenarios of the fight's presentation (M6-01, M6-05, M6-08, M6-15, M6-35, M6-38; MASTERPROMPT §31.5, §6.2
 * "Kampf", §19.1, §19.4, §31.6 "Overlays"):
 *
 * - `waffe-rotation`: the render scene of the same name – the player's weapons turned towards eight aims in the low-res
 *   buffer (src/render/game/combatShowcase.ts).
 * - `treffer`: Grünhain at 10:00 – the player strikes a roe deer with the bronze sword; the picture is the tick after the
 *   hit: the deer flashes white, tufts and blood fly from it, the swing's trail stands in front of the player, the damage
 *   number rises.
 * - `hitstop`: the same with a heavy blow of the wooden club (impact 5: six ticks of hitstop) three ticks into the hitstop –
 *   both bodies stand still in their poses (the player on the smear frame), the pieces fly on, the camera shakes.
 * - `telegraph`: evening in Grünhain, the player with a lit torch – the Nachtmahr three tiles from it winds up its stamp:
 *   the glint at its head, the ground marker of the area (dashed ring, growing inner ring, dithered fill) around the player.
 * - `brandflasche`: the player throws a fire flask at a tree – it burst and set the tree alight (the fire system burns
 *   trees and buildings) – and a second one is in flight with its shadow.
 * - `geschosse`: a fire arrow of the short bow in flight – rotated to its direction on screen, burning, its shadow on the
 *   ground below – the player in the bow's follow-through.
 * - `debug-pfade`, `debug-wahrnehmung`, `debug-spawnzonen`: the creature overlays (M6-35) over roe deer, hares and a
 *   Nachtmahr at night (the spawn ring on the widest view: 640 px show ±20 tiles, the ring begins at 16).
 * - `kreatur-betaeubt`, `kreatur-betaeubt-nacht` (M6-80): the player shoots blunt arrows at a wolf until one stuns it (one
 *   hit in four, 1,5 s) – the picture a moment later: the wolf in the stagger pose, three stars circling above its head; by
 *   day in Grünhain, and at night by the light of the player's torch, where the stars glow.
 *
 * Only commands set the state up (`setTime`, `setWeather`, `player.spawn`, `debug.god`, `inventory.give`/`move`,
 * `player.selectHotbar`, `creature.spawn` at explicit places, `player.aim`, `combat.attack`); the simulation steps a fixed
 * number of ticks or until an event count is reached (`SessionDebugState.events`), or repeats lines until the simulation
 * shows a state the debug state does not carry – a creature's condition, read from `ScenarioSession.sim` (`KampfProbe`) –
 * so every picture is the same on every run. Registered in src/debug/scenarios.ts.
 */
import { CONTENT } from '../content/index';
import { CreatureSystem } from '../game/creatures/system';
import { equipmentRef } from '../game/items/slots';
import type { SimEventMap, Simulation } from '../game/sim';
import type { SessionDebugState } from '../game/session';
import type { WorldOverlay } from '../render/debugOverlay';
import { WORLD_OVERLAYS } from '../render/debugOverlay';
import type { RenderSceneId } from '../render/scenes/ids';
import type { ViewportExample } from '../render/viewport';
import { VIEWPORT_EXAMPLES } from '../render/viewport';
import type { GameCameraStart } from '../render/world/gameScene';
import { surfaceWorldQuery, type SurfaceWorldQuery } from '../render/world/surfaceScene';
import { WEAPON_ROTATION_SCENE } from '../render/game/combatShowcase';
import { daysUntilMoonPhase } from '../render/light/scenarios';
import { TILE_PX } from '../world/model/coords';
import { nothingInReach } from './biomScenarios';

/** What the scenarios need of the renderer (`ScenarioRender`). */
interface ScenarioRenderPart {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  setOverlay(name: WorldOverlay, on: boolean): void;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
}

/** What the scenarios need of their context (`ScenarioContext`). */
interface KampfScenarioContext {
  freezeAt(seconds: number): void;
  readonly render?: ScenarioRenderPart;
  readonly session?: { command(raw: unknown): unknown; step(): void; state(): SessionDebugState; sim?(): Simulation };
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface KampfScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  readonly viewports?: readonly ViewportExample[];
  setup(ctx: KampfScenarioContext): void;
  ready(): boolean;
}

/** Where the player stands after its spawn, in world px (the cast, aims and targets are relative to it). */
export interface Spot {
  readonly x: number;
  readonly y: number;
}

/**
 * What a script reads of the simulation (`ScenarioSession.sim`, only to read): where a creature stands and which
 * conditions act on it – the state a script waits for when the debug state does not carry it.
 */
export interface KampfProbe {
  /** The living creature `creature` nearest to the player [world px], or null (none, no player, no simulation to read). */
  nearest(creature: string): { readonly x: number; readonly y: number } | null;
  /** Whether condition `id` acted on that creature in the last completed tick. */
  hasCondition(creature: string, id: string): boolean;
}

/** A step of a scenario's script: commands, then ticks – a fixed count, or until an event reached a count. */
interface ScriptStep {
  readonly commands: (at: Spot, probe: KampfProbe) => readonly unknown[];
  readonly ticks: number;
  /** Step until `event` was drained this many more times than before the step (at most `ticks` ticks). */
  readonly until?: { readonly event: keyof SimEventMap; readonly count: number };
  /**
   * After this step: back to the `lines` lines that end with it (this one included) until `done` holds – at most `times`
   * rounds; a script that never gets there fails instead of showing a wrong picture.
   */
  readonly repeat?: { readonly lines: number; readonly times: number; readonly done: (probe: KampfProbe) => boolean };
}

/** The probe of a session's simulation (`KampfProbe`); it finds nothing without one. */
function probeOf(session: NonNullable<KampfScenarioContext['session']>): KampfProbe {
  const at = { x: 0, y: 0 };
  /** The entity of the living `creature` nearest to the player (its place in `at`), −1 for none. */
  const nearest = (creature: string): { sim: Simulation; system: CreatureSystem; entity: number } | null => {
    const sim = session.sim?.();
    const player = session.state().player;
    const system = sim?.system('creatures');
    if (sim === undefined || player === null || !(system instanceof CreatureSystem)) return null;
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    let bx = 0;
    let by = 0;
    for (let i = 0; i < system.store.size; i++) {
      const s = system.store.valueAt(i);
      const e = system.store.entityAt(i);
      if (s.creature !== creature || s.health <= 0 || !system.positionOf(e, at)) continue;
      const d = (at.x - player.x) ** 2 + (at.y - player.y) ** 2;
      if (d >= bestD) continue;
      bestD = d;
      best = e;
      bx = at.x;
      by = at.y;
    }
    at.x = bx;
    at.y = by;
    return best < 0 ? null : { sim, system, entity: best };
  };
  return {
    nearest(creature) {
      return nearest(creature) === null ? null : { x: at.x, y: at.y };
    },
    hasCondition(creature, id) {
      const n = nearest(creature);
      const s = n?.system.store.get(n.entity);
      return n !== null && s !== undefined && s.conditions.some((c) => c.id === id && n.sim.tick - 1 <= c.untilTick);
    },
  };
}

export interface KampfSpec {
  readonly name: string;
  readonly description: string;
  readonly start: GameCameraStart;
  readonly time: { readonly hour: number; readonly minute: number };
  /**
   * The night's moon phase (world/calendar.ts: 0 the Finstermond … 4 the full moon): whole days are jumped first so that
   * `time` falls into a night of it (absent: the session's own day).
   */
  readonly moonPhase?: number;
  readonly weather: string;
  /** Items handed to the player in this order; the first goes into the first hotbar slot and is held. */
  readonly items: readonly { readonly item: string; readonly count: number }[];
  /** Creatures and their spots relative to the player [tiles, fractions allowed]. */
  readonly cast: readonly { readonly creature: string; readonly dx: number; readonly dy: number }[];
  /**
   * The cast may stand anywhere – in the wood, under crowns (the debug overlays draw over everything); otherwise its
   * spots and the way to them must be open like the targets'.
   */
  readonly castAnywhere?: boolean;
  /** Points the player shoots or throws at, relative to it [tiles]: they and the way to them must be open too. */
  readonly targets?: readonly (readonly [number, number])[];
  /** A standing tree the player throws at, relative to it [tiles]: a tree on it, the way to it open (a fire burns trees and buildings). */
  readonly tree?: readonly [number, number];
  /** The player carries a lit torch in the off hand (the night pictures: warm light around it, §4.1). */
  readonly torch?: boolean;
  readonly script: readonly ScriptStep[];
  readonly overlays?: readonly WorldOverlay[];
  readonly viewports?: readonly ViewportExample[];
}

/** Minutes of a day (the jump to a night of the wanted moon phase). */
const MINUTES_PER_DAY = 24 * 60;
/** Presentation time of the frozen pictures [s] (the loops of idle and flames mid-cycle). */
const PICTURE_TIME = 0.4;
/** Frames until a picture counts as stable after its script ran. */
const SETTLE_FRAMES = 6;
/** How far from the camera's tile the player's spot is looked for [tiles]. */
const SEARCH_TILES = 40;
/** Steps after the cast appeared before the script begins (their first thought; nobody walks off in two ticks). */
const STEPS_AFTER_CAST = 2;
/** Ticks before the overlay pictures (the creatures' first decisions; nobody has left the view yet). */
const OVERLAY_TICKS = 45;
/**
 * Ticks before the picture of the paths: the Nachtmahr has set out on its roaming paths by then – two searched paths with
 * their goals and labels in the view (at 45 ticks only one, its goal at the picture's edge; M6 gate visual:stale-shot-evidence).
 */
const PATH_TICKS = 150;
/** The widest example view (21:9, 640 × 270 internal): the spawn ring of the shadow brood begins 16 tiles out. */
const WIDE_VIEW = VIEWPORT_EXAMPLES.reduce((a, b) => (b.internalWidth > a.internalWidth ? b : a));

/** The world pixel of a spot `dx`, `dy` tiles from the player. */
function beside(at: Spot, dx: number, dy: number): { x: number; y: number } {
  return { x: Math.round(at.x + dx * TILE_PX), y: Math.round(at.y + dy * TILE_PX) };
}

/** Crowns reach this many tiles north of their trunks: the tiles south of an open tile must be free of objects too. */
const CROWN_TILES = 3;
/** World objects that are trees (`baum_<art>`, src/content/worldObjects.ts). */
const TREE_PREFIX = 'baum_';

/** Whether tile (tx, ty) is open ground on `level` with no object on it or on the tiles whose crowns reach it; null while not resident. */
function openTile(q: SurfaceWorldQuery, tx: number, ty: number, level: number | undefined): boolean | null {
  const g = q.groundAt(tx, ty);
  if (g === null) return null;
  if (g.water || g.solid || g.level !== level) return false;
  for (let k = 0; k <= CROWN_TILES; k++) {
    const o = q.objectAt(tx, ty + k);
    if (o === null) return null;
    if (o !== '') return false;
  }
  return true;
}

/** Tile `k` of `n` on the way from (0, 0) to (px, py) [relative tiles]. */
function along(px: number, py: number, k: number, n: number): readonly [number, number] {
  return [Math.round((px * k) / n), Math.round((py * k) / n)];
}

/**
 * Whether the player on (tx, ty) makes the picture: nothing in its reach (no hint over the picture), every tile on the
 * way to each of `points` (cast and targets, relative tiles) open ground on its level, and – with `tree` – a standing tree
 * at its end with the way to it open; null while not resident.
 */
function openSpot(q: SurfaceWorldQuery, tx: number, ty: number, points: readonly (readonly [number, number])[], tree: readonly [number, number] | undefined): boolean | null {
  const reach = nothingInReach(q, tx, ty);
  if (reach !== true) return reach;
  const level = q.groundAt(tx, ty)?.level;
  // The spawn puts the player on a free tile – one whose neighbours are open alike: the spot and its eight neighbours.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const g = q.groundAt(tx + dx, ty + dy);
      const o = q.objectAt(tx + dx, ty + dy);
      if (g === null || o === null) return null;
      if (g.water || g.solid || g.level !== level || o !== '') return false;
    }
  }
  for (const [px, py] of points) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(px), Math.abs(py))));
    for (let k = 0; k <= n; k++) {
      const [dx, dy] = along(px, py, k, n);
      const ok = openTile(q, tx + dx, ty + dy, level);
      if (ok !== true) return ok;
    }
  }
  if (tree === undefined) return true;
  const o = q.objectAt(tx + tree[0], ty + tree[1]);
  if (o === null) return null;
  if (!o.startsWith(TREE_PREFIX)) return false;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(tree[0]), Math.abs(tree[1]))));
  for (let k = 1; k < n; k++) {
    const [dx, dy] = along(tree[0], tree[1], k, n);
    const g = q.groundAt(tx + dx, ty + dy);
    const t = q.objectAt(tx + dx, ty + dy);
    if (g === null || t === null) return null;
    if (g.water || g.solid || g.level !== level || t !== '') return false;
  }
  return true;
}

/** The open spot nearest to (tx, ty), ring by ring (deterministic); null while a chunk is missing. */
function findSpot(q: SurfaceWorldQuery, tx: number, ty: number, points: readonly (readonly [number, number])[], tree: readonly [number, number] | undefined, name: string): { tx: number; ty: number } | null {
  for (let d = 0; d <= SEARCH_TILES; d++) {
    for (let dy = -d; dy <= d; dy++) {
      for (let dx = -d; dx <= d; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        const ok = openSpot(q, tx + dx, ty + dy, points, tree);
        if (ok === null) return null;
        if (ok) return { tx: tx + dx, ty: ty + dy };
      }
    }
  }
  throw new Error(`Szenario ${name}: keine offene Stelle im Umkreis von ${SEARCH_TILES} Kacheln um (${tx}, ${ty})`);
}

/** The torch of the night pictures. */
const TORCH_ITEM = 'fackel';
/** Item categories the bags put into the hotbar first (the rule of `addStack`, src/game/inventory/ops.ts). */
const HAND_CATEGORIES: readonly string[] = ['werkzeug', 'waffe', 'licht', 'schild'];

/**
 * The commands that hand `items` to a fresh player and hold the first: tools and weapons go into the hotbar in the order
 * they come (the first into slot 0), everything else into the bags – a first item of that kind (a throwable of the
 * category ammunition) is moved from the first bag slot into the hotbar's first.
 */
function equip(items: KampfSpec['items'], torch: boolean): unknown[] {
  // The torch first: it takes the hotbar's first slot and goes on to the off hand, the weapons follow into the hotbar.
  const light = torch
    ? [
        { type: 'inventory.give', item: TORCH_ITEM, count: 1 },
        { type: 'inventory.move', from: { bereich: 'schnellleiste', index: 0 }, to: equipmentRef('nebenhand') },
        { type: 'light.toggle' },
      ]
    : [];
  const first = items[0];
  if (first === undefined) return light;
  const toHand = !HAND_CATEGORIES.includes(CONTENT.collection('items').get(first.item).kategorie);
  return [
    ...light,
    { type: 'inventory.give', item: first.item, count: first.count },
    ...(toHand ? [{ type: 'inventory.move', from: { bereich: 'inventar', index: 0 }, to: { bereich: 'schnellleiste', index: 0 } }] : []),
    ...items.slice(1).map((i) => ({ type: 'inventory.give', item: i.item, count: i.count })),
    { type: 'player.selectHotbar', index: 0 },
  ];
}

/** A creature appears `dx`, `dy` tiles from the player (the simulation stands it on the nearest tile it can stand on). */
export function spawnAt(at: Spot, creature: string, dx: number, dy: number): unknown {
  return { type: 'creature.spawn', creature, count: 1, ...beside(at, dx, dy), layer: 0 };
}

export function kampfScenario(spec: KampfSpec): KampfScenario {
  let render: ScenarioRenderPart | null = null;
  let session: NonNullable<KampfScenarioContext['session']> | null = null;
  let phase: 'welt' | 'ort' | 'tiere' | 'skript' | 'fertig' = 'welt';
  let at: Spot = { x: 0, y: 0 };
  let steps = 0;
  let line = 0;
  let rounds = 0;
  let aimCmd: unknown = null;
  let probe: KampfProbe | null = null;
  const points: readonly (readonly [number, number])[] = [...(spec.castAnywhere === true ? [] : spec.cast.map((c) => [c.dx, c.dy] as const)), ...(spec.targets ?? [])];
  return {
    name: spec.name,
    description: spec.description,
    settleFrames: SETTLE_FRAMES,
    ...(spec.viewports === undefined ? {} : { viewports: spec.viewports }),
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session === undefined) throw new Error(`Szenario ${spec.name} braucht Renderer und Sitzung`);
      render = r;
      session = ctx.session;
      probe = probeOf(ctx.session);
      phase = 'welt';
      steps = 0;
      line = 0;
      rounds = 0;
      aimCmd = null;
      r.startGameCamera(spec.start);
      for (const o of WORLD_OVERLAYS) r.setOverlay(o, spec.overlays?.includes(o) ?? false);
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(PICTURE_TIME);
    },
    ready() {
      const r = render;
      const s = session;
      const pr = probe;
      if (r === null || s === null || pr === null || !r.sceneReady()) return false;
      switch (phase) {
        case 'welt': {
          if (r.gameCamera() === null) return false;
          if (spec.moonPhase !== undefined) {
            const days = daysUntilMoonPhase(s.state().day, spec.moonPhase);
            if (days > 0) s.command({ type: 'advanceTime', minutes: days * MINUTES_PER_DAY });
          }
          s.command({ type: 'setTime', hour: spec.time.hour, minute: spec.time.minute });
          s.command({ type: 'setWeather', state: spec.weather });
          s.step();
          phase = 'ort';
          return false;
        }
        case 'ort': {
          const cam = r.gameCamera();
          const q = surfaceWorldQuery();
          if (cam === null || q === null) return false;
          q.layer = 0;
          const spot = findSpot(q, cam.tx, cam.ty, points, spec.tree, spec.name);
          if (spot === null) return false;
          s.command({ type: 'player.spawn', tx: spot.tx, ty: spot.ty, layer: 0 });
          s.command({ type: 'debug.god', on: true });
          s.step();
          // Where the player stands (the spawn takes the nearest free tile): the cast, aims and targets are relative to it.
          const p = s.state().player;
          at = p === null ? { x: (spot.tx + 1 / 2) * TILE_PX, y: (spot.ty + 1 / 2) * TILE_PX } : { x: p.x, y: p.y };
          for (const cmd of equip(spec.items, spec.torch === true)) s.command(cmd);
          s.step();
          phase = 'tiere';
          return false;
        }
        case 'tiere': {
          if (steps === 0) {
            for (const c of spec.cast) s.command({ type: 'creature.spawn', creature: c.creature, count: 1, ...beside(at, c.dx, c.dy), layer: 0 });
          }
          s.step();
          steps++;
          if (steps >= STEPS_AFTER_CAST) phase = 'skript';
          return false;
        }
        case 'skript': {
          const step = spec.script[line];
          if (step === undefined) {
            phase = 'fertig';
            return false;
          }
          // The frames between two lines aim at the cursor (`player.aim` from the pointer, M6-01): the script's aim again first.
          if (aimCmd !== null) s.command(aimCmd);
          for (const cmd of step.commands(at, pr)) {
            if ((cmd as { type?: string }).type === AIM_COMMAND) aimCmd = cmd;
            s.command(cmd);
          }
          const until = step.until;
          const from = until === undefined ? 0 : s.state().events[until.event];
          for (let k = 0; k < step.ticks; k++) {
            s.step();
            if (until !== undefined && s.state().events[until.event] - from >= until.count) break;
          }
          const again = step.repeat;
          if (again !== undefined && !again.done(pr)) {
            rounds++;
            if (rounds >= again.times) throw new Error(`Szenario ${spec.name}: Zeile ${line} nach ${again.times} Runden nicht erreicht`);
            line -= again.lines - 1;
            return false;
          }
          if (again !== undefined) rounds = 0;
          line++;
          return false;
        }
        case 'fertig':
          return true;
      }
    },
  };
}

const AIM_COMMAND = 'player.aim';

/** Aim at a point `dx`, `dy` tiles from the player (the hand's height: the aim is a world pixel on the ground). */
export function aim(at: Spot, dx: number, dy: number): unknown {
  return { type: AIM_COMMAND, ...beside(at, dx, dy) };
}

const GRUENHAIN: GameCameraStart = { kind: 'biom', biome: 'gruenhain' };
/**
 * The deer appears on the tile east of the player – within the sword's (22 px) and the club's (18 px) reach – one tick
 * before the blow lands (a roe deer flees at once: it gets no time for it).
 */
const DEER_DX = 1;
/** The sword's wind-up after the press: the press tick, then the release and this many ticks until the tick before the blow. */
const SWORD_WAIT_TICKS = 8;
/** The club is held this long (its wind-up, then the heavy charge: 0,4 s from the press), the deer appearing in the last tick. */
const CLUB_HOLD_TICKS = 29;

/**
 * The stunned wolf (M6-80): it appears this far east of the player [tiles] – at night nearer, in the torch's light; the
 * bow is drawn this long [ticks] (fully: 0,8 s), the arrow then has this long to land [ticks]; at most this many shots
 * until one stuns it (one hit in four); the picture this many ticks after the shot that did (the hit clip played, the
 * stagger pose held – 1,5 s of stun).
 */
const STUN_WOLF_DX = 3;
const STUN_WOLF_DX_NIGHT = 2;
const STUN_DRAW_TICKS = 50;
const STUN_FLIGHT_TICKS = 15;
const STUN_SHOTS = 40;
const STUN_PICTURE_TICKS = 14;

/** Aims at the `creature` nearest to the player (where it was cast, `dx` tiles east, while there is none to read). */
function aimAtNearest(at: Spot, probe: KampfProbe, creature: string, dx: number): unknown {
  const c = probe.nearest(creature);
  return c === null ? aim(at, dx, 0) : { type: AIM_COMMAND, x: Math.round(c.x), y: Math.round(c.y) };
}

/**
 * The stunned wolf by day or at night (`kreatur-betaeubt`, `-nacht`): blunt arrows at the wolf `dx` tiles east until one
 * stuns it, then the picture.
 */
function stunnedWolf(name: string, description: string, time: KampfSpec['time'], torch: boolean, dx: number): KampfSpec {
  return {
    name,
    description,
    start: GRUENHAIN,
    time,
    weather: 'klar',
    items: [
      { item: 'kurzbogen', count: 1 },
      { item: 'pfeil_stumpf', count: STUN_SHOTS },
    ],
    torch,
    cast: [{ creature: 'wolf', dx, dy: 0 }],
    script: [
      { commands: (at, probe) => [aimAtNearest(at, probe, 'wolf', dx), { type: 'combat.attack', on: true }], ticks: STUN_DRAW_TICKS },
      {
        commands: (at, probe) => [aimAtNearest(at, probe, 'wolf', dx), { type: 'combat.attack', on: false }],
        ticks: STUN_FLIGHT_TICKS,
        repeat: { lines: 2, times: STUN_SHOTS, done: (probe) => probe.hasCondition('wolf', 'betaeubt') },
      },
      { commands: () => [], ticks: STUN_PICTURE_TICKS },
    ],
  };
}

/** A render scenario of the weapon rotation scene (stable once the game atlas is there). */
function weaponRotationScenario(): KampfScenario {
  let render: ScenarioRenderPart | null = null;
  return {
    name: WEAPON_ROTATION_SCENE,
    description:
      'M6-01/M6-38: die Spielfigur zielt in acht Richtungen (Spalten 0°, 45° … 315°) mit Bronzeschwert im Schmier-Bild, voll gespanntem Kurzbogen und Bronzespeer im Stoß – der Körper in seinen vier Richtungen, die Waffe um den Griff frei gedreht im Low-Res-Puffer; ein Punkt 22 px entlang jedes Ziels',
    settleFrames: SETTLE_FRAMES,
    viewports: [VIEWPORT_EXAMPLES[0] as ViewportExample],
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined) throw new Error(`Szenario ${WEAPON_ROTATION_SCENE} braucht den Renderer`);
      render = r;
      r.showScene(WEAPON_ROTATION_SCENE);
      r.setDebugView('off');
      ctx.freezeAt(PICTURE_TIME);
    },
    ready: () => render?.sceneReady() ?? false,
  };
}

/** The combat scenarios. */
export function kampfScenarios(): KampfScenario[] {
  return [
    weaponRotationScenario(),
    kampfScenario({
      name: 'treffer',
      description:
        'M6-05: Grünhain um 10:00 – der Spieler trifft ein Reh mit dem Bronzeschwert; Bild im Tick nach dem Treffer: das Reh blitzt weiß, Fellbüschel und Blut fliegen vom Treffer weg, die Schlagspur steht vor dem Spieler, die Schadenszahl steigt',
      start: GRUENHAIN,
      time: { hour: 10, minute: 0 },
      weather: 'klar',
      items: [{ item: 'bronzeschwert', count: 1 }],
      cast: [],
      targets: [[DEER_DX, 0]],
      script: [
        { commands: (at) => [aim(at, DEER_DX, 0), { type: 'combat.attack', on: true }], ticks: 1 },
        { commands: () => [{ type: 'combat.attack', on: false }], ticks: SWORD_WAIT_TICKS },
        { commands: (at) => [spawnAt(at, 'reh', DEER_DX, 0)], ticks: 10, until: { event: 'hitLanded', count: 1 } },
        { commands: () => [], ticks: 1 },
      ],
    }),
    kampfScenario({
      name: 'hitstop',
      description:
        'M6-05: derselbe Ort – ein schwerer Schlag der Holzkeule (Wucht 5: sechs Ticks Hitstop), drei Ticks in den Hitstop: Spieler und Reh stehen in ihren Posen still (der Spieler im Schmier-Bild), die Stücke fliegen weiter, die Kamera wackelt, die Zahl steigt',
      start: GRUENHAIN,
      time: { hour: 10, minute: 0 },
      weather: 'klar',
      items: [{ item: 'holzkeule', count: 1 }],
      cast: [],
      targets: [[DEER_DX, 0]],
      script: [
        { commands: (at) => [aim(at, DEER_DX, 0), { type: 'combat.attack', on: true }], ticks: CLUB_HOLD_TICKS },
        { commands: (at) => [spawnAt(at, 'reh', DEER_DX, 0)], ticks: 1 },
        { commands: () => [{ type: 'combat.attack', on: false }], ticks: 10, until: { event: 'hitLanded', count: 1 } },
        { commands: () => [], ticks: 3 },
      ],
    }),
    kampfScenario({
      name: 'telegraph',
      description:
        'M6-15: Grünhain am Abend, der Spieler mit brennender Fackel – der Nachtmahr drei Kacheln vor ihm holt zum Stampfen aus: der Glint an seinem Kopf, die Bodenmarkierung der Fläche um den Spieler (gestrichelter Warnring, wachsender Innenring, geditherte Füllung), unter allen Körpern',
      start: GRUENHAIN,
      time: { hour: 20, minute: 30 },
      weather: 'klar',
      items: [],
      torch: true,
      cast: [{ creature: 'nachtmahr', dx: 3, dy: 0 }],
      script: [
        // Its first attack at this distance is the charge (0,6 s wind-up, 5 s cooldown); the next, with the charge still
        // cooling down, is the stamp – the area attack with the ground marker.
        { commands: () => [], ticks: 600, until: { event: 'creatureTelegraph', count: 2 } },
        { commands: () => [], ticks: 6 },
      ],
    }),
    kampfScenario({
      name: 'brandflasche',
      description:
        'M6-08: Grünhain um 16:00 – eine Brandflasche ist an einem Baum vier Kacheln östlich zerplatzt und hat ihn entzündet (der brennende Baum, Funken, Rauch); die zweite fliegt im Bogen mit ihrem Schatten',
      start: GRUENHAIN,
      time: { hour: 16, minute: 0 },
      weather: 'klar',
      items: [{ item: 'brandflasche', count: 3 }],
      cast: [],
      tree: [4, 0],
      targets: [[1, -3]],
      script: [
        { commands: (at) => [aim(at, 4, 0), { type: 'combat.attack', on: true }], ticks: 30 },
        { commands: () => [{ type: 'combat.attack', on: false }], ticks: 120, until: { event: 'projectileHit', count: 1 } },
        { commands: () => [], ticks: 50 },
        { commands: (at) => [aim(at, 1, -3), { type: 'combat.attack', on: true }], ticks: 30 },
        { commands: () => [{ type: 'combat.attack', on: false }], ticks: 60, until: { event: 'projectileFired', count: 1 } },
        { commands: () => [], ticks: 10 },
      ],
    }),
    kampfScenario({
      name: 'geschosse',
      description:
        'M6-07: Grünhain um 11:00 – ein Brandpfeil des Kurzbogens fliegt schräg nach unten rechts, in seine Richtung gedreht und brennend, sein Schatten darunter; der Spieler im Nachschwung des Bogens',
      start: GRUENHAIN,
      time: { hour: 11, minute: 0 },
      weather: 'klar',
      items: [
        { item: 'kurzbogen', count: 1 },
        { item: 'pfeil_feuer', count: 3 },
      ],
      cast: [],
      targets: [[4, 2]],
      script: [
        { commands: (at) => [aim(at, 4, 2), { type: 'combat.attack', on: true }], ticks: 50 },
        { commands: () => [{ type: 'combat.attack', on: false }], ticks: 60, until: { event: 'projectileFired', count: 1 } },
        { commands: () => [], ticks: 5 },
      ],
    }),
    ...(['pfade', 'wahrnehmung', 'spawnzonen'] as const).map((overlay) =>
      kampfScenario({
        name: `debug-${overlay}`,
        description: `M6-35: Overlay „${overlay}“ in einer Grünhain-Nacht – Rehe, Hasen und ein Nachtmahr um den Spieler${overlay === 'spawnzonen' ? ' (die breiteste Ansicht, 640 px: der Spawnring beginnt 16 Kacheln entfernt)' : ''}`,
        start: GRUENHAIN,
        time: { hour: 23, minute: 0 },
        weather: 'klar',
        items: [],
        torch: true,
        cast: [
          { creature: 'reh', dx: -6, dy: -3 },
          { creature: 'reh', dx: -7, dy: 2 },
          { creature: 'hase', dx: 5, dy: -4 },
          { creature: 'hase', dx: 8, dy: 3 },
          { creature: 'nachtmahr', dx: 11, dy: 0 },
        ],
        castAnywhere: true,
        overlays: [overlay],
        script: [{ commands: () => [], ticks: overlay === 'pfade' ? PATH_TICKS : OVERLAY_TICKS }],
        ...(overlay === 'spawnzonen' ? { viewports: [WIDE_VIEW] } : {}),
      }),
    ),
    kampfScenario(
      stunnedWolf(
        'kreatur-betaeubt',
        'M6-80: Grünhain um 10:00 – ein stumpfer Pfeil hat den Wolf betäubt (1,5 s): er steht in der Taumelpose (Trefferclip, eingesackt, einen Pixel schwankend), drei gelbe Sterne kreisen über seinem Kopf, die hinteren kleiner und matter',
        { hour: 10, minute: 0 },
        false,
        STUN_WOLF_DX,
      ),
    ),
    kampfScenario(
      stunnedWolf(
        'kreatur-betaeubt-nacht',
        'M6-80: dieselbe Betäubung in einer Grünhain-Nacht am Rand des Fackelscheins – der Wolf in der Taumelpose (die Augen geschlossen), die Sterne über seinem Kopf leuchten (emissiv) und zeigen ihn auch dort, wo das Dunkel seinen Körper nimmt',
        { hour: 22, minute: 30 },
        true,
        STUN_WOLF_DX_NIGHT,
      ),
    ),
  ];
}
