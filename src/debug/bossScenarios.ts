/**
 * The pictures of the boss and the first beacon (M7-32 … M7-36, strand F; MASTERPROMPT §31.5): the game view on the session's
 * world at the Borkenvater's arena or the beacon site of the Grünhain, summer, clear, quality "Hoch", the presentation clock
 * frozen, HUD off (screenshot mode) – except the title card, which lays the boss HUD over the view in a layer of its own.
 *
 * - `boss-titelkarte` (M7-32): the player steps into the arena, the Borkenvater wakes – one second into the waking the title
 *   card stands across the middle, the boss bar with its two phase marks at the top.
 * - `boss-borkenvater` (M7-33): the fight in phase 1 – the boss winds up a root thrust: arms raised, the cracks run out from
 *   the trunk towards the player in a fan of five lines (the ground marker at ≥ 55 % of its wind-up).
 * - `leuchtfeuer-1-vorher` (M7-35): the beacon site with the cold beacon; around it the land lies corrupted (violet shift).
 * - `leuchtfeuer-1-nachher` (M7-35): the same place after the warden fell and the beacon was lit – the flame burns, the
 *   light wave has passed: the corruption is gone, the grade is warm and saturated (the vision that opened with the flame is
 *   seen and closed).
 * - `reisen-bildschirm` (M7-37): the travel screen at a named waystone beside the lit beacon – its destinations with their
 *   price in Lumen shards, the renaming below.
 * - `lumen-laterne-nacht` (M7-36): night in the arena of the fallen Borkenvater, the beacon lit (the corruption gone, its
 *   light far off), the player holds the Lumen lantern in the off hand – its cold light reaches eight tiles over the open
 *   root soil around the dead tree.
 *
 * Only commands set the state up (season, clock, weather, spawn, god mode, kill, items, `boss.debug`, `beacon.debug`); the
 * simulation is read (`ScenarioSession.sim`) only to find the arena and the site and to see when a step is done. Registered in
 * src/debug/scenarios.ts.
 */
import { BossesSystem } from '../game/bosses/system';
import { BeaconsSystem } from '../game/beacons/system';
import { TravelSystem } from '../game/travel/system';
import { equipmentRef } from '../game/items/slots';
import type { InventorySystem } from '../game/inventory/system';
import type { Simulation } from '../game/sim';
import type { QualityLevel } from '../engine/settings';
import type { RenderSceneId } from '../render/scenes/ids';
import type { GameCameraStart } from '../render/world/gameScene';
import { activeGameScreens } from '../ui/focus/GameScreens';
import { mountBossHudSzenario, type BossHudSzenario } from '../ui/hud/boss/szenario';
import { VISION_SCREEN } from '../ui/screens/vision/VisionScreen';
import { TILE_PX } from '../world/model/coords';

interface BossRender {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
  setQuality?(level: QualityLevel | null): void;
}

interface BossSession {
  command(raw: unknown): unknown;
  step(): void;
  sim?(): Simulation;
}

interface BossContext {
  freezeAt(seconds: number): void;
  readonly render?: BossRender;
  readonly session?: BossSession;
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface BossScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: BossContext): void;
  ready(): boolean;
}

const QUALITY: QualityLevel = 'high';
const START: GameCameraStart = { kind: 'biom', biome: 'gruenhain' };
/** Presentation time of the frozen pictures [s] (flames mid-flicker, the crown mid-breath). */
const PICTURE_TIME = 3.4;
const SETTLE_FRAMES = 8;
const BOSS = 'borkenvater';
const BEACON = 1;
/** The player's distance south of the boss [tiles]: inside the inner ring (it wakes), the whole tree in the picture. */
const BOSS_DISTANCE_TILES = 3;
/**
 * Where the player stands from the beacon's centre [tiles]: south-east of its foot, beyond the interaction's reach (no
 * prompt over the picture), near enough in height that the camera holds the whole beacon with its flame and storm.
 */
const BEACON_OFFSET = { dx: 4, dy: 2 } as const;
/** Ticks into the waking for the title card picture (one second of three). */
const TITLE_TICKS = 60;
/** Share of the root thrust's wind-up at which the fight picture is taken, and the most ticks waited for one. */
const WINDUP_SHARE = 0.55;
const FIGHT_MAX_TICKS = 60 * 60;
/** Ticks the light wave runs before the "after" picture (12 tiles/s: 4 s carry it far past the view). */
const WAVE_TICKS = 240;
/** Radius of the kill that clears the wildlife around the picture [tiles]. */
const CLEAR_RADIUS = 24;

/** Where the player stands: before the boss or before the beacon. */
type Ort = 'arena' | 'feuer';
type Zeit = 'mittag' | 'nacht';

interface Bild {
  readonly name: string;
  readonly description: string;
  readonly ort: Ort;
  readonly zeit: Zeit;
  /** The boss HUD layer over the view. */
  readonly hud?: boolean;
  /** What happens before the player is set down (the world is there; e.g. the boss falls before anyone enters its ring). */
  vorher?(s: BossSession): void;
  /** What happens after the player stands (returns true when the picture stands). */
  szene(s: BossSession, sim: Simulation, state: { ticks: number }): boolean;
}

function bosses(sim: Simulation): BossesSystem {
  const s = sim.systems.find((x) => x instanceof BossesSystem);
  if (!(s instanceof BossesSystem)) throw new Error('Szenario: die Simulation hat kein Boss-System');
  return s;
}

function beacons(sim: Simulation): BeaconsSystem {
  const s = sim.systems.find((x) => x instanceof BeaconsSystem);
  if (!(s instanceof BeaconsSystem)) throw new Error('Szenario: die Simulation hat kein Leuchtfeuer-System');
  return s;
}

/** Where the player stands for a picture at `ort` [tile], or null while the world is not there. */
function standplatz(sim: Simulation, ort: Ort): { tx: number; ty: number } | null {
  if (ort === 'arena') {
    const a = bosses(sim).arena(sim, BOSS);
    if (a === null) return null;
    return { tx: Math.floor(a.bossX / TILE_PX), ty: Math.floor(a.bossY / TILE_PX) + BOSS_DISTANCE_TILES };
  }
  const site = beacons(sim).site(sim, BEACON);
  return site === null ? null : { tx: site.tx + BEACON_OFFSET.dx, ty: site.ty + BEACON_OFFSET.dy };
}

function scenario(b: Bild): BossScenario {
  let render: BossRender | null = null;
  let session: BossSession | null = null;
  let hud: BossHudSzenario | null = null;
  let phase: 'welt' | 'platz' | 'szene' | 'ruhe' | 'fertig' = 'welt';
  const state = { ticks: 0 };
  return {
    name: b.name,
    description: b.description,
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session?.sim === undefined || r.setQuality === undefined) throw new Error(`Szenario ${b.name} braucht Renderer (mit Qualitätsstufen) und Sitzung mit Simulation`);
      render = r;
      session = ctx.session;
      phase = 'welt';
      state.ticks = 0;
      r.setQuality(QUALITY);
      r.startGameCamera(START);
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(PICTURE_TIME);
      hud?.dispose();
      hud = null;
      const simOf = ctx.session.sim;
      if (b.hud === true) hud = mountBossHudSzenario(document, () => simOf());
    },
    ready() {
      const r = render;
      const s = session;
      if (r === null || s === null || s.sim === undefined || !r.sceneReady()) return false;
      const sim = s.sim();
      switch (phase) {
        case 'welt': {
          if (r.gameCamera() === null) return false;
          s.command({ type: 'setSeason', season: 'sommer' });
          if (b.zeit === 'mittag') s.command({ type: 'setTime', hour: 11, minute: 10 });
          else s.command({ type: 'setTime', hour: 22, minute: 30 });
          s.command({ type: 'setWeather', state: 'klar' });
          s.command({ type: 'advanceTime', minutes: 50 });
          s.step();
          phase = 'platz';
          return false;
        }
        case 'platz': {
          // The world materialises with the first steps; the arena and the site are found from it.
          void sim.world.generated;
          b.vorher?.(s);
          const at = standplatz(sim, b.ort);
          if (at === null) throw new Error(`Szenario ${b.name}: die Welt hat keine ${b.ort === 'arena' ? 'Arena des Borkenvaters' : 'Leuchtfeuer-Stätte 1'}`);
          s.command({ type: 'player.spawn', tx: at.tx, ty: at.ty, layer: 0 });
          s.command({ type: 'debug.god', on: true });
          s.step();
          s.command({ type: 'creature.kill', radius: CLEAR_RADIUS });
          s.step();
          phase = 'szene';
          return false;
        }
        case 'szene':
          if (!b.szene(s, sim, state)) return false;
          phase = 'ruhe';
          return false;
        case 'ruhe':
          phase = 'fertig';
          return false;
        case 'fertig':
          return hud === null || hud.bereit;
      }
    },
  };
}

/** The boss is awake; `ticks` steps after it woke. */
function wachSeit(s: BossSession, sim: Simulation, ticks: number): boolean {
  const b = bosses(sim).state(BOSS);
  if (b.state !== 'erwacht') {
    s.step();
    if (bosses(sim).state(BOSS).state !== 'erwacht') throw new Error('Szenario: der Borkenvater erwacht nicht, als der Spieler die Arena betritt');
  }
  const awakened = bosses(sim).state(BOSS).awakenedTick;
  while (sim.tick < awakened + ticks) s.step();
  return true;
}

const BILDER: readonly Bild[] = [
  {
    name: 'boss-titelkarte',
    description: 'M7-32: der Spieler betritt die Arena, der Borkenvater erwacht – Titelkarte „Der Borkenvater“ quer über der Mitte, oben der Bossbalken mit zwei Phasenmarken; Mittag, klar',
    ort: 'arena',
    zeit: 'mittag',
    hud: true,
    szene: (s, sim) => wachSeit(s, sim, TITLE_TICKS),
  },
  {
    name: 'boss-borkenvater',
    description: 'M7-33: Kampf in Phase 1 – der Borkenvater holt zum Wurzelstoß aus (Arme hoch, Krone zurück), fünf Risslinien laufen vom Stamm auf den Spieler zu (Bodenmarkierung in der Warnfarbe); Mittag, klar',
    ort: 'arena',
    zeit: 'mittag',
    szene: (s, sim, state) => {
      if (state.ticks === 0) wachSeit(s, sim, 1);
      const system = bosses(sim);
      for (let k = 0; k < 120; k++, state.ticks++) {
        if (state.ticks > FIGHT_MAX_TICKS) throw new Error('Szenario boss-borkenvater: kein Wurzelstoß in einer Minute');
        const b = system.state(BOSS);
        if (b.attack === 'wurzelstoss' && b.attackEndTick > b.attackStartTick) {
          const share = (sim.tick - b.attackStartTick) / (b.attackEndTick - b.attackStartTick);
          if (share >= WINDUP_SHARE) return true;
        }
        s.step();
      }
      return false;
    },
  },
  {
    name: 'leuchtfeuer-1-vorher',
    description: 'M7-35: die Leuchtfeuer-Stätte des Grünhains vor dem Entzünden – das kalte Leuchtfeuer auf dem Platz der Erbauer, ringsum ist das Land verdorben (violette Verschiebung); Mittag, klar',
    ort: 'feuer',
    zeit: 'mittag',
    szene: () => true,
  },
  {
    name: 'leuchtfeuer-1-nachher',
    description: 'M7-35: dieselbe Stätte, nachdem der Borkenvater fiel und das Leuchtfeuer entzündet wurde – die Flamme brennt, die Lichtwelle ist durchgezogen: keine Verderbnis mehr, die Farben warm und satt; Mittag, klar',
    ort: 'feuer',
    zeit: 'mittag',
    szene: (s, sim) => {
      s.command({ type: 'boss.debug', boss: BOSS, aktion: 'besiegen' });
      s.step();
      s.command({ type: 'beacon.debug', beacon: BEACON, aktion: 'entzuenden' });
      s.step();
      if (beacons(sim).state(BEACON).state !== 'entzuendet') throw new Error('Szenario leuchtfeuer-1-nachher: das Leuchtfeuer brennt nicht');
      // The vision opened with the flame (it pauses the game): seen and closed, the picture shows the healed land.
      s.command({ type: 'beacon.visionSeen', beacon: BEACON });
      activeGameScreens()?.controller.close(VISION_SCREEN);
      for (let k = 0; k < WAVE_TICKS; k++) s.step();
      return true;
    },
  },
  {
    name: 'lumen-laterne-nacht',
    description: 'M7-36: Nacht in der Arena des gefallenen Borkenvaters, das Leuchtfeuer brennt (die Verderbnis ist gewichen), klar – der Spieler hält die Lumen-Laterne in der Nebenhand, ihr kaltes Licht reicht acht Kacheln weit über den offenen Wurzelboden',
    ort: 'arena',
    zeit: 'nacht',
    // The way to the lantern: the warden fell (before the player steps into its ring), the beacon burns and taught it.
    vorher: (s) => {
      s.command({ type: 'boss.debug', boss: BOSS, aktion: 'besiegen' });
      s.step();
      s.command({ type: 'beacon.debug', beacon: BEACON, aktion: 'entzuenden' });
      s.step();
      s.command({ type: 'beacon.visionSeen', beacon: BEACON });
      activeGameScreens()?.controller.close(VISION_SCREEN);
    },
    szene: (s, sim) => {
      // The light wave passes the arena (its light stays far beyond, at the site).
      for (let k = 0; k < WAVE_TICKS; k++) s.step();
      s.command({ type: 'inventory.give', item: 'lumen_laterne', count: 1 });
      s.command({ type: 'inventory.give', item: 'lumen_scherbe', count: 2 });
      s.step();
      const inv = sim.system('inventory') as InventorySystem;
      const index = inv.state.schnellleiste.findIndex((x) => x?.item === 'lumen_laterne');
      const from = index >= 0 ? { bereich: 'schnellleiste', index } : { bereich: 'inventar', index: inv.state.inventar.findIndex((x) => x?.item === 'lumen_laterne') };
      s.command({ type: 'inventory.move', from, to: equipmentRef('nebenhand') });
      s.step();
      s.command({ type: 'light.toggle' });
      s.step();
      return true;
    },
  },
  {
    name: 'reisen-bildschirm',
    description: 'M7-37: der Reisebildschirm am Wegstein „Am Pflaster“ neben dem entzündeten Leuchtfeuer – Ziele Leuchtfeuer: Grünhain und Wegstein „Vor der Arena des Hüters“ (24 Zeichen, der längste Name) mit Lumen-Preis, drei Lumen-Scherben in den Taschen, das Umbenennen des Wegsteins darunter; Mittag, klar',
    ort: 'feuer',
    zeit: 'mittag',
    vorher: (s) => {
      s.command({ type: 'boss.debug', boss: BOSS, aktion: 'besiegen' });
      s.step();
      s.command({ type: 'beacon.debug', beacon: BEACON, aktion: 'entzuenden' });
      s.step();
      s.command({ type: 'beacon.visionSeen', beacon: BEACON });
      activeGameScreens()?.controller.close(VISION_SCREEN);
    },
    szene: (s, sim) => {
      // The light wave heals the site first (the land behind the board warm, not corrupted).
      for (let k = 0; k < WAVE_TICKS; k++) s.step();
      const r = travel(sim);
      const at = standplatz(sim, 'feuer');
      if (at === null) throw new Error('Szenario reisen-bildschirm: keine Leuchtfeuer-Stätte');
      s.command({ type: 'inventory.give', item: 'wegstein', count: WEGSTEINE.length });
      s.command({ type: 'inventory.give', item: 'lumen_scherbe', count: 3 });
      s.step();
      for (const w of WEGSTEINE) {
        const before = r.state.waystones.length;
        s.command({ type: 'build.place', part: 'wegstein', tx: at.tx + w.dx, ty: at.ty + w.dy });
        s.step();
        const stone = r.state.waystones[before];
        if (stone === undefined) throw new Error(`Szenario reisen-bildschirm: kein Wegstein auf (${at.tx + w.dx}, ${at.ty + w.dy})`);
        s.command({ type: 'travel.rename', wegstein: stone.id, name: w.name });
        s.step();
      }
      // E at the nearer waystone: the screen opens on `travelOpened`.
      s.command({ type: 'travel.open' });
      s.step();
      return true;
    },
  },
];

/** The travel system of the page's simulation. */
function travel(sim: Simulation): TravelSystem {
  const s = sim.systems.find((x) => x instanceof TravelSystem);
  if (!(s instanceof TravelSystem)) throw new Error('Szenario: die Simulation hat kein Reise-System');
  return s;
}

/** Waystones of the travel picture: offset from the player [tiles] and name. */
const WEGSTEINE: readonly { readonly dx: number; readonly dy: number; readonly name: string }[] = [
  { dx: 2, dy: 0, name: 'Am Pflaster' },
  // The longest name a waystone takes (BALANCE.travel.nameMaxLength = 24): the board shows it whole.
  { dx: -3, dy: 1, name: 'Vor der Arena des Hüters' },
];

/** The scenarios of the boss and the first beacon. */
export function bossScenarios(): BossScenario[] {
  return BILDER.map(scenario);
}
