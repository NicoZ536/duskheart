/**
 * The vault pictures of M7 (M7-11, M7-14; MASTERPROMPT §21 "Gewölbe/Dungeons", §31.5; docs/SPIEL.md §19, strand C): the game
 * view on the session's world (seed 20260923, medium) inside a Grünhain vault on layer −1, quality "Hoch", the presentation
 * clock frozen, HUD off (screenshot mode). The player goes down the way a player does – spawned beside the stairs of the
 * vault's entrance, `vault.enter` –, the vault's guards are cleared (`creature.kill`), god mode keeps the traps off him, and a
 * burning torch hangs in his off hand: a vault is dark.
 *
 * - `gewoelbe-gruenhain` (M7-11): the vault nearest the start beach (the one with ≥ 4 puzzle types, §32), in the room of its
 *   fire bowls (else its levers, else its first puzzle): Builder stone and floor of the Grünhain tileset, the hint stele with
 *   the order digits, the first three bowls lit in their order (their sparks and their light), the torch's warm island.
 * - `gewoelbe-fallen` (M7-14): the player stands three tiles into the lane of a Grünhain dart thrower or boulder – the one
 *   from whose lane the most kinds of traps are in view –, which warns half way through its telegraph (≥ 0.4 s before it
 *   strikes, §4.6): the thrower's eyes glow, the boulder's rune glows and it hops and sheds dust; a blade in view swings.
 *
 * Only commands set the state up (clock, weather, spawn, god mode, `vault.enter`, `vault.use`, items, light, teleport, kill);
 * the simulation is read (`ScenarioSession.sim`) only to find the vault, its rooms and parts. Registered in
 * src/debug/scenarios.ts.
 */
import type { QualityLevel } from '../engine/settings';
import { BALANCE } from '../content/balance';
import { CONTENT } from '../content/index';
import { equipmentRef } from '../game/items/slots';
import { InteractionSystem } from '../game/interaction/system';
import type { Simulation } from '../game/sim';
import { DIR_DX, DIR_DY, trapWarnTicks } from '../game/vaults/formulas';
import type { RenderSceneId } from '../render/scenes/ids';
import type { GameCameraStart } from '../render/world/gameScene';
import type { VaultPlan } from '../world/gen/vaults/types';
import { TILE_PX } from '../world/model/coords';

interface GwRender {
  showScene(id: RenderSceneId): void;
  setDebugView(name: string): void;
  sceneReady(): boolean;
  startGameCamera(start: GameCameraStart): void;
  gameCamera(): { layer: number; tx: number; ty: number } | null;
  setQuality?(level: QualityLevel | null): void;
}

interface GwSession {
  command(raw: unknown): unknown;
  step(): void;
  sim?(): Simulation;
}

interface GwContext {
  freezeAt(seconds: number): void;
  readonly render?: GwRender;
  readonly session?: GwSession;
}

/** A scenario (shape of `Scenario`, src/debug/scenarios.ts). */
export interface GwScenario {
  readonly name: string;
  readonly description: string;
  readonly settleFrames: number;
  setup(ctx: GwContext): void;
  ready(): boolean;
}

const QUALITY: QualityLevel = 'high';
/** Presentation time of the frozen pictures [s] (flames mid-flicker, dust mid-drift). */
const PICTURE_TIME = 9.7;
const SETTLE_FRAMES = 10;
/**
 * Radius of the kill that clears the vault's guards [tiles]: the console's largest (`creature.kill`, 64) – from the start room
 * in the box's middle cell it reaches every corner of the 80 × 80 box (≈ 57 tiles).
 */
const CLEAR_RADIUS = 64;
/** The vault layer (ADR-0207). */
const VAULT_LAYER = -1;
/** Ticks the scenario lets pass between two uses of a puzzle part (its spring, `BALANCE.puzzles.leverCooldownSeconds`). */
const USE_PAUSE_TICKS = Math.ceil(BALANCE.puzzles.leverCooldownSeconds * BALANCE.time.tickHz) + 1;
/** Bowls lit in the first picture (of three to five: the order nearly done – one bowl stays cold beside the burning ones). */
const BOWLS_LIT = 3;
/** Tiles into a trap's lane the player stands in the trap picture. */
const LANE_STAND_TILES = 3;
/** Frames the view gets to stream the vault's chunks around the player before the picture. */
const STREAM_FRAMES = 4;

const TORCH_TO_OFF_HAND: readonly unknown[] = [
  { type: 'inventory.move', from: { bereich: 'schnellleiste', index: 0 }, to: equipmentRef('nebenhand') },
  { type: 'light.toggle' },
];

function teleport(tx: number, ty: number, layer: number): unknown {
  return { type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty + 0.5) * TILE_PX, layer };
}

/** The Grünhain vault nearest the start beach (the vault with ≥ 4 puzzle types, docs/SPIEL.md §19 "Vielfalt"). */
export function nearestGruenhainVault(sim: Simulation): VaultPlan | null {
  const g = sim.world.generated;
  let best: VaultPlan | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const v of g.vaults) {
    if (v.biome !== 'gruenhain') continue;
    const d = (v.entrance.tx - g.spawn.x) ** 2 + (v.entrance.ty - g.spawn.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

/** Half the view around the player [tiles]: the traps the picture can show (30 × 17 tiles at the internal resolution). */
const VIEW_HALF = { x: 13, y: 7 } as const;

/** A trap picture: the vault, the trap that warns (its lane leads to the player) and the tile the player stands on. */
export interface TrapPicture {
  readonly plan: VaultPlan;
  readonly trap: VaultPlan['traps'][number];
  readonly tx: number;
  readonly ty: number;
}

/**
 * The trap picture of the world: over the dart throwers and boulders of the Grünhain vaults, the stand `LANE_STAND_TILES`
 * into the lane from which the most kinds of traps are in view (then the most traps, a dart thrower's glowing eyes before a
 * boulder, the lowest slot).
 */
export function trapPicture(sim: Simulation): TrapPicture | null {
  const defs = CONTENT.collection('vaultTraps');
  let best: TrapPicture | null = null;
  let score = -1;
  for (const plan of sim.world.generated.vaults) {
    if (plan.biome !== 'gruenhain') continue;
    for (const trap of plan.traps) {
      if (defs.get(trap.type).ausloeser !== 'naehe') continue;
      const k = Math.min(LANE_STAND_TILES, Math.min(trap.reach, BALANCE.vaults.trapLaneMaxTiles));
      if (k < 1) continue;
      const tx = trap.tx + (DIR_DX[trap.dir] as number) * k;
      const ty = trap.ty + (DIR_DY[trap.dir] as number) * k;
      const seen = plan.traps.filter((t) => Math.abs(t.tx - tx) <= VIEW_HALF.x && Math.abs(t.ty - ty) <= VIEW_HALF.y);
      const s = new Set(seen.map((t) => t.type)).size * 100 + seen.length * 10 + (trap.type === 'pfeilwerfer' ? 1 : 0);
      if (s > score) {
        score = s;
        best = { plan, trap, tx, ty };
      }
    }
  }
  return best;
}

type Phase = 'welt' | 'abstieg' | 'raum' | 'strom' | 'fertig';

/** The common frame of both pictures: the world, the descent, then the picture's own room (`room`), then streaming. */
function gwScenario(name: string, description: string, room: (s: GwSession, sim: Simulation, plan: VaultPlan) => void, pick: (sim: Simulation) => VaultPlan | null): GwScenario {
  let render: GwRender | null = null;
  let session: GwSession | null = null;
  let phase: Phase = 'welt';
  let plan: VaultPlan | null = null;
  let frames = 0;
  return {
    name,
    description,
    settleFrames: SETTLE_FRAMES,
    setup(ctx) {
      const r = ctx.render;
      if (r === undefined || ctx.session?.sim === undefined || r.setQuality === undefined) throw new Error(`Szenario ${name} braucht Renderer (mit Qualitätsstufen) und Sitzung mit Simulation`);
      render = r;
      session = ctx.session;
      phase = 'welt';
      plan = null;
      frames = 0;
      r.setQuality(QUALITY);
      r.startGameCamera({ kind: 'biom', biome: 'gruenhain' });
      r.showScene('spiel');
      r.setDebugView('off');
      ctx.freezeAt(PICTURE_TIME);
    },
    ready() {
      const r = render;
      const s = session;
      if (r === null || s === null || s.sim === undefined || !r.sceneReady()) return false;
      switch (phase) {
        case 'welt': {
          if (r.gameCamera() === null) return false;
          const sim = s.sim();
          plan = pick(sim);
          if (plan === null) throw new Error(`Szenario ${name}: die Welt hat kein passendes Grünhain-Gewölbe`);
          s.command({ type: 'setTime', hour: 12, minute: 0 });
          s.command({ type: 'setWeather', state: 'klar' });
          // Beside the stairs (the tile south of them, as the way up leads back), within the use reach.
          s.command({ type: 'player.spawn', tx: plan.entrance.tx, ty: plan.entrance.ty + 1, layer: 0 });
          s.command({ type: 'debug.god', on: true });
          s.step();
          phase = 'abstieg';
          return false;
        }
        case 'abstieg': {
          const p = plan as VaultPlan;
          s.command({ type: 'vault.enter', vault: p.slot });
          s.step();
          s.command({ type: 'creature.kill', radius: CLEAR_RADIUS });
          s.command({ type: 'inventory.give', item: 'fackel', count: 1 });
          s.step();
          phase = 'raum';
          return false;
        }
        case 'raum':
          room(s, s.sim(), plan as VaultPlan);
          phase = 'strom';
          return false;
        case 'strom':
          if (++frames < STREAM_FRAMES) return false;
          phase = 'fertig';
          return false;
        case 'fertig':
          return true;
      }
    },
  };
}

/** `gewoelbe-gruenhain`: the bowls' room (else the levers', else the first puzzle's), two bowls lit in their order. */
function puzzleRoom(s: GwSession, _sim: Simulation, plan: VaultPlan): void {
  const pz = plan.puzzles.find((p) => p.type === 'feuerschalen') ?? plan.puzzles.find((p) => p.type === 'hebel') ?? plan.puzzles[0];
  if (pz === undefined) throw new Error(`Szenario gewoelbe-gruenhain: Gewölbe ${plan.slot} hat kein Rätsel`);
  const variant = CONTENT.collection('puzzleTypes')
    .values()
    .flatMap((t) => t.varianten)
    .find((v) => v.id === pz.variant);
  const hint = pz.parts.find((p) => p.role === 'hinweis') ?? pz.parts[0];
  if (variant === undefined || hint === undefined) throw new Error(`Szenario gewoelbe-gruenhain: Rätsel ${pz.variant} unbekannt`);
  if (variant.typ === 'feuerschalen') {
    // The torch in the hand lights the first bowls of the order, each from the tile south of it.
    const bowls = pz.parts.filter((p) => p.role === 'schale');
    for (let k = 0; k < Math.min(BOWLS_LIT, variant.folge.length - 1); k++) {
      const b = bowls[variant.folge[k] as number];
      if (b === undefined) continue;
      s.command(teleport(b.tx, b.ty + 1, VAULT_LAYER));
      s.step();
      s.command({ type: 'vault.use', tx: b.tx, ty: b.ty });
      for (let t = 0; t < USE_PAUSE_TICKS; t++) s.step();
    }
  }
  for (const cmd of TORCH_TO_OFF_HAND) s.command(cmd);
  // Beside the stele, out of every part's use reach (no use line across the picture): the stele with its digits, the row of
  // bowls below and the room's walls in view. The first spot where the interaction focuses nothing.
  for (const [dx, dy] of STELE_SPOTS) {
    s.command(teleport(hint.tx + dx, hint.ty + dy, VAULT_LAYER));
    s.command({ type: 'player.move', dx: 0, dy: 1 });
    s.step();
    s.command({ type: 'player.move', dx: 0, dy: 0 });
    s.command(teleport(hint.tx + dx, hint.ty + dy, VAULT_LAYER));
    s.step();
    if (!focused(s)) return;
  }
}

/** Spots beside a hint stele [tiles from it], tried in turn: right of it, left of it, a row lower. */
const STELE_SPOTS: readonly (readonly [number, number])[] = [
  [3, 1],
  [-3, 1],
  [3, 2],
  [-3, 2],
];

/** Whether the interaction has a focus (a use line would cross the picture). */
function focused(s: GwSession): boolean {
  const interaction = s.sim?.().systems.find((x) => x instanceof InteractionSystem);
  return interaction instanceof InteractionSystem && interaction.focus.kind !== 'none';
}

/** `gewoelbe-fallen`: three tiles into the lane of the trap picture's dart thrower or boulder, half way through its warning. */
function trapRoom(s: GwSession, sim: Simulation, plan: VaultPlan): void {
  const p = trapPicture(sim);
  if (p === null || p.plan !== plan) throw new Error('Szenario gewoelbe-fallen: kein Pfeilwerfer oder Rollstein in einem Grünhain-Gewölbe');
  for (const cmd of TORCH_TO_OFF_HAND) s.command(cmd);
  // Facing the trap: one tick of walking towards it turns the figure.
  s.command(teleport(p.tx, p.ty, VAULT_LAYER));
  s.command({ type: 'player.move', dx: -(DIR_DX[p.trap.dir] as number), dy: -(DIR_DY[p.trap.dir] as number) });
  s.step();
  s.command({ type: 'player.move', dx: 0, dy: 0 });
  s.command(teleport(p.tx, p.ty, VAULT_LAYER));
  // Half way through the warning (the trap armed on the first tick in its lane).
  const half = Math.floor(trapWarnTicks(CONTENT.collection('vaultTraps').get(p.trap.type)) / 2);
  for (let t = 0; t < half; t++) s.step();
}

export const gewoelbeScenarios: readonly GwScenario[] = [
  gwScenario(
    'gewoelbe-gruenhain',
    'M7-11: Grünhain-Gewölbe nächst dem Startstrand (≥ 4 Rätseltypen), Raum der Feuerschalen – Erbauer-Stein, Hinweis-Stele mit Zahlzeichen, drei Schalen in ihrer Folge entzündet, Fackel in der Nebenhand, Qualität „Hoch“',
    puzzleRoom,
    nearestGruenhainVault,
  ),
  gwScenario(
    'gewoelbe-fallen',
    'M7-14: Grünhain-Gewölbe – die Figur steht drei Kacheln in der Bahn eines Pfeilwerfers/Rollsteins (die meisten Fallenarten im Blick), der mitten in seiner Warnung glüht (§4.6), Fackel in der Nebenhand, Qualität „Hoch“',
    trapRoom,
    (sim) => trapPicture(sim)?.plan ?? null,
  ),
];
