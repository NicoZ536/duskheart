/**
 * Contribution of strand C (Gewölbe) to the reference save of save version 4 (docs/SPIEL.md §27 "Gewölbe mit gelöstem Rätsel
 * und offener Tür", §19; M7-10 … M7-16): a vault entered, one of its puzzles solved and its door opened, made by commands only,
 * and its facts for the migration test – read through the vaults system's public API (`VaultsSystem`), never from the snapshot
 * layout.
 *
 * `playGewoelbe(sim)` goes to the vault nearest the player (the fixture world, seed 3 small, has its vaults), steps beside its
 * stairs and goes down (`vault.enter`: the guards rise), clears the guards (`creature.kill` within the box from the start
 * room – the mini-boss falls with them: `bossDefeated`, the end chest stays closed), solves the first of its puzzles by the puzzle rules' solver – a lever, bell, wall or bowl used from the tile south of
 * it (`vault.use`), a crate pushed from the tile behind it (`vault.push`) – so the puzzle's door grinds open, goes back up the
 * stairs (`vault.leave`) and returns to where the player stood.
 * Use (integrator, tools/save/fixture.ts): after `playOrte(sim)` and before the fight (the fight must stay the last thing before
 * the save), `gewoelbeFacts(sim)` beside `saveFacts`. Fixtures of versions 1–3 load with `EMPTY_GEWOELBE_FACTS` (no vault was
 * ever entered before M7; the participant `vaults` migrates from 0 to nothing).
 */
import { z } from 'zod';
import type { PuzzleVariantDef } from '../../../src/content/dungeons/schema';
import { CONTENT } from '../../../src/content/index';
import { BALANCE } from '../../../src/content/balance';
import type { GameCommand } from '../../../src/game/commands';
import type { PlayerSystem } from '../../../src/game/player/system';
import { kistenMap, kistenStep, PUSH_DX, PUSH_DY, puzzleSolve } from '../../../src/game/puzzles/index';
import type { Simulation } from '../../../src/game/sim';
import { VaultsSystem, VAULT_LAYER } from '../../../src/game/vaults/system';
import type { VaultPlan } from '../../../src/world/gen/vaults/types';
import { TILE_PX, type Layer } from '../../../src/world/model/coords';

/** Ticks for the zone to stream the chunks around a teleport target. */
const SETTLE_TICKS = 30;
/** Radius of the guard kill from the start room [tiles] (the console's largest: it covers the 80-tile box from its middle). */
const GUARD_KILL_TILES = 64;
/** Ticks between two uses of a puzzle part: the part's spring (`BALANCE.puzzles.leverCooldownSeconds`) and one more. */
const USE_PAUSE_TICKS = Math.ceil(BALANCE.puzzles.leverCooldownSeconds * BALANCE.time.tickHz) + 1;
/** The order the fixture prefers its puzzle in: the ones solved by plain uses first, the bowls (a torch in hand) last. */
const PREFERRED: readonly PuzzleVariantDef['typ'][] = ['hebel', 'glocken', 'verborgene_wand', 'kisten', 'feuerschalen'];
/** The part role a sequence puzzle's step uses. */
const STEP_ROLE: Readonly<Record<Exclude<PuzzleVariantDef['typ'], 'kisten'>, string>> = { hebel: 'hebel', feuerschalen: 'schale', glocken: 'glocke', verborgene_wand: 'risswand' };

function vaults(sim: Simulation): VaultsSystem {
  const v = sim.system('vaults');
  if (!(v instanceof VaultsSystem)) throw new Error('gewoelbe: die Simulation hat kein System vaults');
  return v;
}

/** Runs `commands` then `ticks − 1` more ticks; throws if a command was refused. Returns the event types seen. */
function run(sim: Simulation, what: string, commands: readonly GameCommand[], ticks = 1): Set<string> {
  const seen = new Set<string>();
  const refused: string[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(i === 0 ? commands : undefined);
    sim.events.drain((type, payload) => {
      seen.add(type);
      if (type === 'commandRejected') refused.push(JSON.stringify(payload));
    });
  }
  if (refused.length > 0) throw new Error(`Fixture-Szenario (Gewölbe): ${what} abgelehnt: ${refused.join(', ')}`);
  return seen;
}

function teleport(tx: number, ty: number, layer: Layer): GameCommand {
  return { type: 'player.teleport', x: (tx + 0.5) * TILE_PX, y: (ty + 0.5) * TILE_PX, layer };
}

function variantOf(id: string): PuzzleVariantDef {
  for (const t of CONTENT.collection('puzzleTypes').values()) for (const v of t.varianten) if (v.id === id) return v;
  throw new Error(`Fixture-Szenario (Gewölbe): Rätselvariante ${id} fehlt`);
}

/** Solves puzzle `pz` with the solver's actions, each from beside its part. */
function solve(sim: Simulation, pz: VaultPlan['puzzles'][number]): void {
  const v = variantOf(pz.variant);
  const solution = puzzleSolve(v);
  if (solution === null) throw new Error(`Fixture-Szenario (Gewölbe): ${pz.variant} ohne Lösung`);
  if (v.typ === 'kisten') {
    const origin = pz.parts.find((p) => p.role === 'ursprung');
    if (origin === undefined) throw new Error(`Fixture-Szenario (Gewölbe): ${pz.variant} ohne Ursprung`);
    const m = kistenMap(v);
    for (const a of solution) {
      const cx = origin.tx + (a.part % m.w);
      const cy = origin.ty + Math.floor(a.part / m.w);
      // Behind the crate, opposite the push.
      run(sim, 'hinter die Kiste', [teleport(cx - (PUSH_DX[a.dir] as number), cy - (PUSH_DY[a.dir] as number), VAULT_LAYER)]);
      run(sim, 'Kiste schieben', [{ type: 'vault.push', tx: cx, ty: cy }]);
      if (kistenStep(m, a.part, a.dir) < 0) throw new Error('Fixture-Szenario (Gewölbe): Schub aus der Karte');
    }
    return;
  }
  const role = STEP_ROLE[v.typ];
  const parts = pz.parts.filter((p) => p.role === role);
  if (v.typ === 'feuerschalen') {
    // A burning light in the hand: the torch, selected in the hotbar.
    run(sim, 'Fackel', [{ type: 'inventory.give', item: 'fackel', count: 1 }]);
    run(sim, 'Fackel wählen', [{ type: 'player.selectHotbar', index: 0 }]);
  }
  for (const a of solution) {
    const part = parts[a.part];
    if (part === undefined) throw new Error(`Fixture-Szenario (Gewölbe): ${pz.variant} ohne Teil ${a.part}`);
    run(sim, 'vor das Teil', [teleport(part.tx, part.ty + 1, VAULT_LAYER)]);
    run(sim, 'Teil benutzen', [{ type: 'vault.use', tx: part.tx, ty: part.ty }], USE_PAUSE_TICKS);
  }
}

/** Plays the vault part of the reference save (see module comment); throws if a step does not have its effect. */
export function playGewoelbe(sim: Simulation): void {
  const v = vaults(sim);
  const player = sim.system('player') as PlayerSystem;
  const at = { x: 0, y: 0 };
  if (!player.position(sim, at)) throw new Error('Fixture-Szenario (Gewölbe): kein Spieler');
  const home = { tx: Math.floor(at.x / TILE_PX), ty: Math.floor(at.y / TILE_PX) };
  let plan: VaultPlan | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  v.forEachVault((p) => {
    const d = (p.entrance.tx - home.tx) ** 2 + (p.entrance.ty - home.ty) ** 2;
    if (p.puzzles.length > 0 && d < bestD) {
      bestD = d;
      plan = p;
    }
  });
  const target = plan as VaultPlan | null;
  if (target === null) throw new Error('Fixture-Szenario (Gewölbe): keine Gewölbe mit Rätsel');
  const { tx, ty } = target.entrance;
  run(sim, 'zum Abgang', [teleport(tx, ty + 1, 0)], SETTLE_TICKS);
  const down = run(sim, 'hinab', [{ type: 'vault.enter', vault: target.slot }], SETTLE_TICKS);
  if (!down.has('vaultEntered')) throw new Error('Fixture-Szenario (Gewölbe): nicht hinabgestiegen');
  run(sim, 'Wächter', [{ type: 'creature.kill', radius: GUARD_KILL_TILES }]);
  const pz = PREFERRED.map((t) => target.puzzles.find((p) => variantOf(p.variant).typ === t)).find((p) => p !== undefined);
  if (pz === undefined) throw new Error('Fixture-Szenario (Gewölbe): kein Rätsel');
  solve(sim, pz);
  if (!v.isSolved(target.slot, pz.id)) throw new Error(`Fixture-Szenario (Gewölbe): ${pz.variant} nicht gelöst`);
  const door = target.doors.find((d) => d.kind === 'raetsel' && d.puzzle === pz.id);
  if (door !== undefined && !v.isDoorOpen(target.slot, door.id)) throw new Error('Fixture-Szenario (Gewölbe): die Rätseltür ist zu');
  run(sim, 'zum Aufgang', [teleport(tx, ty + 1, VAULT_LAYER)], 2);
  run(sim, 'hinauf', [{ type: 'vault.leave', vault: target.slot }], 2);
  run(sim, 'zurück', [teleport(home.tx, home.ty, 0)], SETTLE_TICKS);
}

/** Facts of the vaults: every entered vault with what the player did there. */
export const gewoelbeFactsSchema = z
  .object({
    gewoelbe: z.array(
      z
        .object({
          slot: z.number().int().min(0),
          biome: z.string().min(1),
          completed: z.boolean(),
          /** Door ids that are open (locks unlocked, puzzle doors ground open, hidden walls found). */
          doorsOpen: z.array(z.number().int().min(0)),
          /** Puzzle ids that are solved. */
          solved: z.array(z.number().int().min(0)),
          keysTaken: z.array(z.number().int().min(0)),
          chestsOpen: z.array(z.number().int().min(0)),
          shardTaken: z.boolean(),
          bossDefeated: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
export type GewoelbeFacts = z.output<typeof gewoelbeFactsSchema>;

/** A world before M7: no vault was entered. */
export const EMPTY_GEWOELBE_FACTS: GewoelbeFacts = { gewoelbe: [] };

/** The entered vaults of `sim`, read through the vaults system. */
export function gewoelbeFacts(sim: Simulation): GewoelbeFacts {
  const v = vaults(sim);
  const out: GewoelbeFacts['gewoelbe'] = [];
  v.forEachVault((plan, state) => {
    if (state === undefined || !state.entered) return;
    const s = plan.slot;
    out.push({
      slot: s,
      biome: plan.biome,
      completed: state.completed,
      doorsOpen: plan.doors.filter((d) => v.isDoorOpen(s, d.id)).map((d) => d.id),
      solved: plan.puzzles.filter((p) => v.isSolved(s, p.id)).map((p) => p.id),
      keysTaken: plan.keys.map((_, i) => i).filter((i) => v.keyTaken(s, i)),
      chestsOpen: plan.chests.filter((c) => v.chestOpen(s, c.id)).map((c) => c.id),
      shardTaken: state.shardTaken,
      bossDefeated: state.bossDefeated,
    });
  });
  return { gewoelbe: out.sort((a, b) => a.slot - b.slot) };
}
