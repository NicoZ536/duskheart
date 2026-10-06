/**
 * The pictures of the field and of fishing (M7-19 … M7-24, strand D; MASTERPROMPT §31.5): the game view on the session's
 * world near the Grünhain showcase, summer, 12:00, clear, quality "Hoch", the presentation clock frozen, HUD off.
 *
 * - `feld`: a field of two rows on open meadow, hoed with the stone hoe tile by tile (`player.interact` on the aimed tile),
 *   and a row of garden beds (wood, stone) with a scarecrow beside them. The front row and the beds ripe (`farm.grow`):
 *   carrot, cabbage, wheat, maize, tomato, pumpkin; potato, turnip, bean, barley in the beds; the back row young: pea,
 *   lettuce, onion, strawberry, flax, chamomile. Fresh soil shows its dark furrows (moist).
 * - `angeln`: the player at a lake shore with the stick rod and a worm, cast into open water; the bite, the strike (the reel
 *   held), a few seconds of the fight with the tension kept near 0.6 – the rod bent, the line taut, the float pulled under.
 * - `angeln-hud`: the same with the fishing plate of the HUD laid over the picture (src/ui/hud/angeln/szenario.tsx).
 *
 * Only commands set the state up (season, clock, weather, spawn, items, hoeing, building, sowing, growing, casting,
 * reeling); the simulation is read (`ScenarioSession.sim`) only to find the spots and to see when a step is done.
 * Registered in src/debug/scenarios.ts.
 */
import { WORLD_OBJECTS } from '../content/worldObjects';
import type { QualityLevel } from '../engine/settings';
import type { FarmingSystem } from '../game/farming/system';
import type { FishingSystem } from '../game/fishing/system';
import { createHarvestPlan, type GatheringSystem, type HeldTool } from '../game/gathering/system';
import type { InteractionSystem } from '../game/interaction/system';
import type { InventorySystem } from '../game/inventory/system';
import type { Simulation } from '../game/sim';
import type { RenderSceneId } from '../render/scenes/ids';
import type { GameCameraStart } from '../render/world/gameScene';
import { surfaceWorldQuery } from '../render/world/surfaceScene';
import { mountAngelHudSzenario, type AngelHudSzenario } from '../ui/hud/angeln/szenario';
import { TILE_PX } from '../world/model/coords';

interface FeldRender {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
  setQuality?(level: QualityLevel | null): void;
}

interface FeldSession {
  command(raw: unknown): unknown;
  step(): void;
  sim?(): Simulation;
}

interface FeldContext {
  freezeAt(seconds: number): void;
  readonly render?: FeldRender;
  readonly session?: FeldSession;
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface FeldScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: FeldContext): void;
  ready(): boolean;
}

const QUALITY: QualityLevel = 'high';
const START: GameCameraStart = { kind: 'biom', biome: 'gruenhain' };
/** Presentation time of the frozen pictures [s] (crops and grass mid-sway). */
const PICTURE_TIME = 4.3;
const SETTLE_FRAMES = 8;
/** How far from the camera the open meadow or the shore is searched [tiles]. */
const SEARCH_RADIUS = 32;
/** Steps one hoe stroke may take at most (two swings of the stone hoe and the dig). */
const HOE_STEPS = 240;
/** Presses of E per tile at most (hoeing, picking up scatter). */
const HOE_PRESSES = 3;
/** Days of good growth: enough to ripen every crop; and the young row's days. */
const RIPE_DAYS = 40;
const YOUNG_DAYS = 6;
/** The cast: this many tiles out from the shore tile (the stick rod reaches 6 from the feet). */
const CAST_TILES = 5;
/** Steps of the fight before the picture, and the tension the reel keeps it at. */
const DRILL_STEPS = 60;
const DRILL_TENSION = 0.6;

/** The field: front row ripe, back row young, the beds ripe; the scarecrow at the bed row's end. */
const FRONT = ['karotte', 'kohl', 'weizen', 'mais', 'tomate', 'kuerbis'] as const;
const BACK = ['erbse', 'salat', 'zwiebel', 'erdbeere', 'flachs', 'kamille'] as const;
const BEDS = [
  ['beet_holz', 'kartoffel'],
  ['beet_holz', 'ruebe'],
  ['beet_stein', 'bohne'],
  ['beet_stein', 'gerste'],
] as const;
const WIDTH = 7;
const HEIGHT = 6;
/**
 * Rows of the area cleared of scatter (from `origin.y`): the two field rows, the row the hoe is swung from (a fibre grass
 * there would take E before the aimed tile) and the bed row.
 */
const CLEAR_ROWS = [0, 1, 2, 3] as const;
/** Steps after the last pick before the picture (a second: the gathering motion ends, the figure stands idle). */
const IDLE_STEPS = 60;
/** Presses of E at the stand at most: scatter in reach picked by hand, then what it dropped (a focus label would cross the picture). */
const STAND_PICKUPS = 24;
/** The columns beside the field and the row below it (relative to `origin.x`), kept clear of trees. */
const EDGE_COLUMNS = [-1, WIDTH] as const;
const EDGE_ROW = Array.from({ length: WIDTH + 2 }, (_, k) => k - 1);
/**
 * Where the figure stands for the picture (tiles from `origin`, its feet): below the beds, out of the interaction's reach of
 * the ripe crops (2 tiles), the field above it in the frame; the first one where nothing is focused once the scatter in reach
 * is picked.
 */
const STANDS: ReadonlyArray<readonly [number, number]> = [
  [4.5, 6.5],
  [5.5, 6.5],
  [3.5, 6.5],
  [2.5, 6.5],
  [1.5, 6.5],
  [WIDTH + 0.5, 5.5],
];
/** Tiles (row × `WIDTH` + column) of the two field rows, the beds and the scarecrow: ground the hoe could till. */
const PLOT_TILES: ReadonlySet<number> = new Set([
  ...FRONT.map((_, k) => k),
  ...FRONT.map((_, k) => WIDTH + k),
  ...BEDS.map((_, k) => 3 * WIDTH + k),
  3 * WIDTH + BEDS.length + 1,
]);

function inventoryOf(sim: Simulation): InventorySystem {
  return sim.system('inventory') as InventorySystem;
}

/** Bag slot of `item` (hotbar first), or null. */
function slotOf(sim: Simulation, item: string): { bereich: 'schnellleiste' | 'inventar'; index: number } | null {
  const state = inventoryOf(sim).state;
  for (const bereich of ['schnellleiste', 'inventar'] as const) {
    const index = state[bereich].findIndex((s) => s?.item === item);
    if (index >= 0) return { bereich, index };
  }
  return null;
}

/** Selects `item` in the hotbar (moving it there from the bags if needed). */
function hold(s: FeldSession, item: string): void {
  const sim = (s.sim as () => Simulation)();
  const slot = slotOf(sim, item);
  if (slot === null) throw new Error(`Szenario: ${item} fehlt in den Taschen`);
  if (slot.bereich === 'inventar') {
    s.command({ type: 'inventory.move', from: slot, to: { bereich: 'schnellleiste', index: 8 } });
    s.command({ type: 'player.selectHotbar', index: 8 });
  } else s.command({ type: 'player.selectHotbar', index: slot.index });
  s.step();
}

/** Ground scatter that does not block (flowers, pebbles, leaves): picked up by hand, so a field or a bed may lie there. */
const SOFT_OBJECTS: ReadonlySet<string> = new Set(WORLD_OBJECTS.filter((o) => !o.blocking).map((o) => o.id));

/** Ground the hoe tills (`TILLABLE_GROUND` of the gathering): the field may lie on grass or bare earth. */
const FIELD_TERRAINS: ReadonlySet<string> = new Set(['gras', 'erde']);

/** The stone hoe as the gathering sees it in the hand (the tillage test of the search). */
const HOE: HeldTool = { kind: 'hacke', power: 1, broken: false };
const HOE_PLAN = createHarvestPlan();

/**
 * Open ground `WIDTH` × `HEIGHT` on one level near (tx, ty) (rings outwards) with nothing on it but ground scatter (cleared
 * by hand before the hoe and the beds); the fields, beds and the scarecrow (`PLOT_TILES`) on ground the hoe tills (grass or
 * bare earth, no ramp, road, cliff edge or place – the gathering's own `planTile` decides); beside it and in front of it (the columns left and right, the row below)
 * nothing that blocks – a tree there would hide the field – while the row behind may hold the forest's edge (its crowns
 * rise away from the field). The Grünhain is a forest: a full clear ring finds no spot near the showcase.
 * Null while the search square has not streamed in, undefined when there is none.
 */
function meadow(sim: Simulation, tx: number, ty: number): { x: number; y: number } | null | undefined {
  const gathering = sim.system('gathering') as GatheringSystem;
  const tillable = (x: number, y: number): boolean => gathering.planTile(sim, 0, x, y, HOE, HOE_PLAN) && HOE_PLAN.block === null && HOE_PLAN.dig === 'feld';
  const q = surfaceWorldQuery();
  if (q === null) return null;
  q.layer = 0;
  // The whole search square resident first (the world streams in around the camera).
  const reach = SEARCH_RADIUS + WIDTH + 1;
  for (const [cx, cy] of [
    [tx - reach, ty - reach],
    [tx + reach, ty - reach],
    [tx - reach, ty + reach],
    [tx + reach, ty + reach],
  ] as const)
    if (q.groundAt(cx, cy) === null) return null;
  const soft = (x: number, y: number): boolean => {
    const object = q.objectAt(x, y);
    return object !== null && (object === '' || SOFT_OBJECTS.has(object));
  };
  const fits = (ox: number, oy: number): boolean => {
    const level = q.groundAt(ox, oy)?.level;
    for (let y = oy; y < oy + HEIGHT; y++) {
      for (let x = ox; x < ox + WIDTH; x++) {
        const g = q.groundAt(x, y);
        if (g === null || g.water || g.solid || g.level !== level || !soft(x, y)) return false;
        if (PLOT_TILES.has((y - oy) * WIDTH + (x - ox)) && !(FIELD_TERRAINS.has(g.terrain) && tillable(x, y))) return false;
      }
    }
    for (let y = oy; y <= oy + HEIGHT; y++) {
      for (const x of y === oy + HEIGHT ? EDGE_ROW : EDGE_COLUMNS) {
        const g = q.groundAt(ox + x, y);
        if (g === null || g.water || !soft(ox + x, y)) return false;
      }
    }
    return true;
  };
  for (let r = 0; r <= SEARCH_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && fits(tx + dx, ty + dy)) return { x: tx + dx, y: ty + dy };
      }
    }
  }
  return undefined;
}

function feldScenario(): FeldScenario {
  let render: FeldRender | null = null;
  let session: FeldSession | null = null;
  let phase: 'welt' | 'suche' | 'raeumen' | 'hacken' | 'beete' | 'saeen' | 'ruhe' | 'fertig' = 'welt';
  let centre = { tx: 0, ty: 0 };
  let origin = { x: 0, y: 0 };
  return {
    name: 'feld',
    description:
      'M7-19 … M7-23: Feld im Grünhain-Sommer, 12:00, klar, Qualität „Hoch“ – vorn reif Karotte, Kohl, Weizen, Mais, Tomate, Kürbis auf frisch gehacktem, feuchtem Acker; dahinter jung Erbse, Salat, Zwiebel, Erdbeere, Flachs, Kamille; Hochbeete aus Holz und Stein mit Kartoffel (blühend), Rübe, Bohne, Gerste; die Vogelscheuche daneben',
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session?.sim === undefined || r.setQuality === undefined) throw new Error('Szenario feld braucht Renderer (mit Qualitätsstufen) und Sitzung mit Simulation');
      render = r;
      session = ctx.session;
      phase = 'welt';
      r.setQuality(QUALITY);
      r.startGameCamera(START);
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(PICTURE_TIME);
    },
    ready() {
      const r = render;
      const s = session;
      if (r === null || s === null || s.sim === undefined || !r.sceneReady()) return false;
      const sim = s.sim();
      switch (phase) {
        case 'welt': {
          const at = r.gameCamera();
          if (at === null) return false;
          centre = { tx: at.tx, ty: at.ty };
          s.command({ type: 'setSeason', season: 'sommer' });
          s.command({ type: 'setTime', hour: 11, minute: 10 });
          s.command({ type: 'setWeather', state: 'klar' });
          s.command({ type: 'advanceTime', minutes: 50 });
          s.command({ type: 'player.spawn', tx: centre.tx, ty: centre.ty, layer: 0 });
          s.command({ type: 'debug.god', on: true });
          s.step();
          phase = 'suche';
          return false;
        }
        case 'suche': {
          const spot = meadow(sim, centre.tx, centre.ty);
          if (spot === null) return false;
          if (spot === undefined) throw new Error(`Szenario feld: keine offene Wiese ${WIDTH}×${HEIGHT} im Umkreis von ${SEARCH_RADIUS} Kacheln`);
          origin = spot;
          s.command({ type: 'inventory.give', item: 'steinhacke', count: 1 });
          s.step();
          hold(s, 'steinhacke');
          phase = 'raeumen';
          return false;
        }
        case 'raeumen': {
          // Ground scatter off the field rows, the hoeing row and the bed row, picked by hand from the tile below – all in
          // one frame (under SwiftShader a frame costs far more than the few hundred steps).
          const q = surfaceWorldQuery();
          if (q === null) return false;
          for (const row of CLEAR_ROWS) {
            for (let x = 0; x < WIDTH; x++) {
              const tx = origin.x + x;
              const ty = origin.y + row;
              if (q.objectAt(tx, ty) === '') continue;
              s.command({ type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty + 1.5) * TILE_PX, layer: 0 });
              s.command({ type: 'player.aim', x: Math.round((tx + 0.5) * TILE_PX), y: Math.round((ty + 0.5) * TILE_PX) });
              s.step();
              for (let press = 0; press < HOE_PRESSES && q.objectAt(tx, ty) !== ''; press++) {
                s.command({ type: 'player.interact', on: true });
                for (let k = 0; k < HOE_STEPS && q.objectAt(tx, ty) !== ''; k++) s.step();
                s.command({ type: 'player.interact', on: false });
                s.step();
              }
              if (q.objectAt(tx, ty) !== '') throw new Error(`Szenario feld: ${q.objectAt(tx, ty) ?? '?'} auf ${tx},${ty} ließ sich nicht aufheben`);
            }
          }
          phase = 'hacken';
          return false;
        }
        case 'hacken': {
          // Two rows of six fields, the front row first (the player stands on the row below it), all in one frame.
          const farming = sim.system('farming') as FarmingSystem;
          for (let k = 0; k < FRONT.length * 2; k++) {
            const tx = origin.x + (k % FRONT.length);
            const ty = origin.y + (k < FRONT.length ? 1 : 0);
            s.command({ type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty + 1.5) * TILE_PX, layer: 0 });
            s.command({ type: 'player.aim', x: Math.round((tx + 0.5) * TILE_PX), y: Math.round((ty + 0.5) * TILE_PX) });
            s.step();
            for (let press = 0; press < HOE_PRESSES && !farming.isPlot(0, tx, ty); press++) {
              s.command({ type: 'player.interact', on: true });
              for (let step = 0; step < HOE_STEPS && !farming.isPlot(0, tx, ty); step++) s.step();
              s.command({ type: 'player.interact', on: false });
              s.step();
            }
            if (!farming.isPlot(0, tx, ty)) throw new Error(`Szenario feld: Kachel ${tx},${ty} ließ sich nicht hacken`);
          }
          phase = 'beete';
          return false;
        }
        case 'beete': {
          const y = origin.y + 3;
          s.command({ type: 'player.teleport', x: (origin.x + 2.5) * TILE_PX, y: (y + 2.5) * TILE_PX, layer: 0 });
          s.step();
          BEDS.forEach(([part], k) => {
            s.command({ type: 'inventory.give', item: part, count: 1 });
            s.command({ type: 'build.place', part, tx: origin.x + k, ty: y });
            s.step();
          });
          s.command({ type: 'inventory.give', item: 'vogelscheuche', count: 1 });
          s.command({ type: 'build.place', part: 'vogelscheuche', tx: origin.x + BEDS.length + 1, ty: y });
          s.step();
          phase = 'saeen';
          return false;
        }
        case 'saeen': {
          // Front row and beds, grown ripe; then the back row, grown a little.
          const sow = (tx: number, ty: number, crop: string): void => {
            s.command({ type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty + 1.5) * TILE_PX, layer: 0 });
            s.command({ type: 'inventory.give', item: `saat_${crop}`, count: 1 });
            s.step();
            const slot = slotOf(sim, `saat_${crop}`);
            if (slot === null) throw new Error(`Szenario feld: saat_${crop} fehlt`);
            s.command({ type: 'player.useItem', slot, tx, ty });
            s.step();
          };
          FRONT.forEach((crop, k) => sow(origin.x + k, origin.y + 1, crop));
          BEDS.forEach(([, crop], k) => sow(origin.x + k, origin.y + 3, crop));
          s.command({ type: 'farm.grow', tage: RIPE_DAYS });
          s.step();
          BACK.forEach((crop, k) => sow(origin.x + k, origin.y, crop));
          s.command({ type: 'farm.grow', tage: YOUNG_DAYS });
          // An empty hand (a tool in it would focus the tile ahead).
          const empty = inventoryOf(sim).state.schnellleiste.findIndex((slot) => slot === null);
          if (empty < 0) throw new Error('Szenario feld: kein freier Platz in der Schnellleiste');
          s.command({ type: 'player.selectHotbar', index: empty });
          s.command({ type: 'creature.kill', radius: 24 });
          s.step();
          // The figure below the field, where the interaction focuses nothing (a focus label would cross the crops).
          const interaction = sim.system('interaction') as InteractionSystem;
          const stand = STANDS.find(([dx, dy]) => {
            s.command({ type: 'player.teleport', x: (origin.x + dx) * TILE_PX, y: (origin.y + dy) * TILE_PX, layer: 0 });
            s.step();
            s.step();
            // Scatter in reach picked by hand and what it drops picked up (into the bags: no item left lying in the picture).
            for (let k = 0; k < STAND_PICKUPS && (interaction.focus.kind === 'drop' || (interaction.focus.kind === 'object' && interaction.focus.byHand)); k++) {
              const f = interaction.focus;
              const kind = f.kind;
              const tx = f.tx;
              const ty = f.ty;
              const entity = f.entity;
              s.command({ type: 'player.interact', on: true });
              for (let step = 0; step < HOE_STEPS && f.kind === kind && f.tx === tx && f.ty === ty && f.entity === entity; step++) s.step();
              s.command({ type: 'player.interact', on: false });
              s.step();
            }
            return interaction.focus.kind === 'none';
          });
          if (stand === undefined) throw new Error('Szenario feld: kein Standplatz ohne Fokus unter dem Feld');
          // The last pick's motion played out: the figure stands idle in the picture, its hand empty again (a pick may have
          // landed in the selected slot).
          const bags = inventoryOf(sim).state;
          const held = bags.auswahl;
          const spare = bags.inventar.findIndex((slot) => slot === null);
          if (bags.schnellleiste[held] !== null && spare >= 0) s.command({ type: 'inventory.move', from: { bereich: 'schnellleiste', index: held }, to: { bereich: 'inventar', index: spare } });
          for (let k = 0; k < IDLE_STEPS; k++) s.step();
          phase = 'ruhe';
          return false;
        }
        case 'ruhe':
          phase = 'fertig';
          return false;
        case 'fertig':
          return true;
      }
    },
  };
}

/** A shore tile: free land with open water in one of the four directions for `CAST_TILES` + 1 tiles. */
function shore(tx: number, ty: number): { x: number; y: number; dx: number; dy: number } | null | undefined {
  const q = surfaceWorldQuery();
  if (q === null) return null;
  q.layer = 0;
  for (let r = 0; r <= SEARCH_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx;
        const y = ty + dy;
        const g = q.groundAt(x, y);
        if (g === null) return null;
        if (!q.freeAt(x, y)) continue;
        for (const [ux, uy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          let water = true;
          for (let k = 1; k <= CAST_TILES + 1 && water; k++) water = q.groundAt(x + ux * k, y + uy * k)?.water === true;
          if (water) return { x, y, dx: ux, dy: uy };
        }
      }
    }
  }
  return undefined;
}

function angelnScenario(name: string, description: string, withHud: boolean): FeldScenario {
  let render: FeldRender | null = null;
  let session: FeldSession | null = null;
  let phase: 'welt' | 'ufer' | 'warten' | 'drill' | 'fertig' = 'welt';
  let centre = { tx: 0, ty: 0 };
  let hud: AngelHudSzenario | null = null;
  return {
    name,
    description,
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session?.sim === undefined || r.setQuality === undefined) throw new Error('Szenario angeln braucht Renderer (mit Qualitätsstufen) und Sitzung mit Simulation');
      render = r;
      session = ctx.session;
      phase = 'welt';
      hud?.dispose();
      hud = null;
      if (withHud) {
        const simOf = ctx.session.sim;
        hud = mountAngelHudSzenario(document, () => simOf());
      }
      r.setQuality(QUALITY);
      r.startGameCamera(START);
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(PICTURE_TIME);
    },
    ready() {
      const r = render;
      const s = session;
      if (r === null || s === null || s.sim === undefined || !r.sceneReady()) return false;
      const sim = s.sim();
      const fishing = sim.system('fishing') as FishingSystem;
      switch (phase) {
        case 'welt': {
          const at = r.gameCamera();
          if (at === null) return false;
          centre = { tx: at.tx, ty: at.ty };
          s.command({ type: 'setSeason', season: 'sommer' });
          s.command({ type: 'setTime', hour: 11, minute: 10 });
          s.command({ type: 'setWeather', state: 'klar' });
          s.command({ type: 'advanceTime', minutes: 50 });
          s.command({ type: 'player.spawn', tx: centre.tx, ty: centre.ty, layer: 0 });
          s.command({ type: 'debug.god', on: true });
          s.command({ type: 'inventory.give', item: 'angel_holz', count: 1 });
          s.command({ type: 'inventory.give', item: 'regenwurm', count: 3 });
          s.step();
          hold(s, 'angel_holz');
          phase = 'ufer';
          return false;
        }
        case 'ufer': {
          const spot = shore(centre.tx, centre.ty);
          if (spot === null) return false;
          if (spot === undefined) throw new Error(`Szenario angeln: kein Ufer im Umkreis von ${SEARCH_RADIUS} Kacheln`);
          s.command({ type: 'player.teleport', x: (spot.x + 0.5) * TILE_PX, y: (spot.y + 0.5) * TILE_PX, layer: 0 });
          s.command({ type: 'creature.kill', radius: 24 });
          s.step();
          const x = Math.round((spot.x + spot.dx * CAST_TILES + 0.5) * TILE_PX);
          const y = Math.round((spot.y + spot.dy * CAST_TILES + 0.5) * TILE_PX);
          s.command({ type: 'player.aim', x, y });
          s.command({ type: 'fishing.cast', x, y });
          s.step();
          if (fishing.phase === 'aus') throw new Error('Szenario angeln: der Wurf wurde abgelehnt');
          phase = 'warten';
          return false;
        }
        case 'warten':
          for (let k = 0; k < 120 && fishing.phase !== 'biss'; k++) s.step();
          if (fishing.phase !== 'biss') return false;
          s.command({ type: 'fishing.reel', on: true });
          s.step();
          phase = 'drill';
          return false;
        case 'drill': {
          // A second of fight, the tension kept near `DRILL_TENSION` – the rod bent, the line taut, the fish still out.
          const sample = { phase: 'aus', floatX: 0, floatY: 0, tension: 0, pull: 0, fish: '', layer: 0, reeling: false, distance: 0, leaping: false, grund: '' } as Parameters<FishingSystem['sample']>[0];
          for (let k = 0; k < DRILL_STEPS; k++) {
            fishing.sample(sample);
            if (sample.phase !== 'drill') throw new Error(`Szenario angeln: der Drill endete zu früh (${sample.phase})`);
            s.command({ type: 'fishing.reel', on: sample.tension < DRILL_TENSION });
            s.step();
          }
          s.command({ type: 'fishing.reel', on: true });
          s.step();
          phase = 'fertig';
          return false;
        }
        case 'fertig':
          return hud === null || hud.bereit;
      }
    },
  };
}

/** The field and fishing pictures of strand D. */
export function feldScenarios(): FeldScenario[] {
  return [
    feldScenario(),
    angelnScenario(
      'angeln',
      'M7-24: Angeln am Grünhain-See, Sommer, 12:00, klar, Qualität „Hoch“ – der Spieler mit der Stockangel am Ufer, der Fisch hat angebissen: die Rute gebogen, die Schnur gespannt, die Pose unter Wasser, Wellenringe um den kämpfenden Fisch',
      false,
    ),
    angelnScenario(
      'angeln-hud',
      'M7-24: dasselbe Bild mit dem Angel-Minispiel im HUD – die Tafel unten in der Mitte über dem Interaktionshinweis: „Spannung halten!“, die Spannungsanzeige mit lockerer (links) und straffer Zone (rechts), grün gefüllt bis zur Spannung, golden gerahmt, weil die Rolle gehalten wird; Abstand des Fischs in Metern und die Steuerung',
      true,
    ),
  ];
}

