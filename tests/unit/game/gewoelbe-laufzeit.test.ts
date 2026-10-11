/**
 * The vaults at runtime (M7-10 … M7-13; MASTERPROMPT §21 "Gewölbe … Rätsel"; docs/SPIEL.md §19 "Laufzeit"): down and up the
 * stairs, the guards rising once, closed doors colliding, every puzzle of a vault solved by its solver through the player's
 * own commands (E at levers, bowls with a torch, bells, cracked walls; crates pushed from behind) opening its door and
 * teaching, a wrong step resetting after a pause, keys valid only in their own vault and used up, hidden walls giving way, the
 * bell inscription playing its tune tone by tone, tablets read, the refusals.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { PUSH_DX, PUSH_DY, kistenMap, partOrdinal, puzzleSolve } from '../../../src/game/puzzles/index';
import { VAULT_KEY_ITEM } from '../../../src/game/vaults/system';
import type { PuzzleVariantDef } from '../../../src/content/dungeons/schema';
import { TILE_PX } from '../../../src/world/model/coords';
import { gewoelbeWelt, testVaultPlan, VAULT_SLOT, type GewoelbeWelt } from './gewoelbe-testwelt';

const TICK_HZ = BALANCE.time.tickHz;
/** Ticks for a lever's spring to pass. */
const SPRING = Math.ceil(BALANCE.puzzles.leverCooldownSeconds * TICK_HZ) + 1;

function events<T>(map: Map<string, unknown[]>, type: string): T[] {
  return (map.get(type) ?? []) as T[];
}

/** Down the stairs (E at the entrance). */
function enter(w: GewoelbeWelt): Map<string, unknown[]> {
  w.goToTile(w.plan.entrance.tx, w.plan.entrance.ty + 1, 0);
  return w.run(1, [{ type: 'vault.enter', vault: VAULT_SLOT }]);
}

/** Solves puzzle `k` of the plan with its solver's actions; returns every event of the way. */
function solve(w: GewoelbeWelt, k: number): Map<string, unknown[]>[] {
  const p = w.plan.puzzles[k]!;
  const v = w.vaults.variantOf(VAULT_SLOT, k) as PuzzleVariantDef;
  const out: Map<string, unknown[]>[] = [];
  if (v.typ === 'feuerschalen') w.hold('fackel');
  for (const a of puzzleSolve(v) ?? []) {
    if (v.typ === 'kisten') {
      const m = kistenMap(v);
      const origin = p.parts.find((x) => x.role === 'ursprung')!;
      const cx = origin.tx + (a.part % m.w);
      const cy = origin.ty + Math.floor(a.part / m.w);
      // Behind the crate, then push it away.
      w.goToTile(cx - (PUSH_DX[a.dir] as number), cy - (PUSH_DY[a.dir] as number));
      out.push(w.run(1, [{ type: 'vault.push', tx: cx, ty: cy }]));
      continue;
    }
    const role = v.typ === 'hebel' ? 'hebel' : v.typ === 'feuerschalen' ? 'schale' : v.typ === 'glocken' ? 'glocke' : 'risswand';
    const j = p.parts.findIndex((x, i) => x.role === role && partOrdinal(p.parts, i) === a.part);
    const part = p.parts[j]!;
    out.push(w.useAt(part.tx, part.ty));
    w.run(SPRING);
  }
  return out;
}

function all(maps: readonly Map<string, unknown[]>[], type: string): unknown[] {
  return maps.flatMap((m) => events(m, type));
}

describe('vaults: stairs and guards', () => {
  it('E at the stairs leads down beside the way up (vaultEntered, first time); E at the way up leads back to the surface', () => {
    const w = gewoelbeWelt();
    const down = enter(w);
    expect(w.rejections(down)).toEqual([]);
    expect(events(down, 'vaultEntered')).toEqual([expect.objectContaining({ vault: VAULT_SLOT, biome: 'gruenhain', erstmals: true })]);
    expect(w.body().layer).toBe(-1);
    const { tx, ty } = w.plan.entrance;
    expect(Math.abs(Math.floor(w.pos().x / TILE_PX) - tx) + Math.abs(Math.floor(w.pos().y / TILE_PX) - ty)).toBe(1);
    expect(w.vaults.state(VAULT_SLOT)?.guardsRisen).toBe(true);
    expect(w.creatures.countOwned(`gewoelbe:${VAULT_SLOT}`)).toBe(w.plan.guards.length);
    const up = w.run(1, [{ type: 'vault.leave', vault: VAULT_SLOT }]);
    expect(events(up, 'vaultLeft')).toHaveLength(1);
    expect(w.body().layer).toBe(0);
    // Again down: not the first time, no second rising.
    expect(events(enter(w), 'vaultEntered')).toEqual([expect.objectContaining({ erstmals: false })]);
    expect(w.creatures.countOwned(`gewoelbe:${VAULT_SLOT}`)).toBe(w.plan.guards.length);
  });

  it('refuses from afar and outside a vault', () => {
    const w = gewoelbeWelt();
    w.goToTile(w.plan.entrance.tx + 6, w.plan.entrance.ty, 0);
    expect(w.rejections(w.run(1, [{ type: 'vault.enter', vault: VAULT_SLOT }]))).toEqual(['outOfReach']);
    expect(w.rejections(w.run(1, [{ type: 'vault.enter', vault: 99 }]))).toEqual(['unknownVault']);
    expect(w.rejections(w.run(1, [{ type: 'vault.use', tx: 5, ty: 5 }]))).toEqual(['notInVault']);
  });
});

describe('vaults: doors and puzzles', () => {
  it('every puzzle solved by its solver through E opens its door, teaches once, and its parts stop being used', () => {
    const w = gewoelbeWelt();
    enter(w);
    const xp = () => {
      const s = w.life.skills.skill('ueberleben');
      return s.level * 1e9 + s.xp;
    };
    for (const p of w.plan.puzzles) {
      const door = w.plan.doors.find((d) => d.kind === 'raetsel' && d.puzzle === p.id)!;
      expect(w.vaults.blocks(-1, door.tx, door.ty), `door of ${p.type} closed`).toBe(true);
      expect(w.rejections(w.useAt(door.tx, door.ty))).toEqual(['puzzleClosed']);
      const before = xp();
      const way = solve(w, p.id);
      expect(w.rejections(way.reduce((m, x) => new Map([...m, ...x]), new Map()))).toEqual([]);
      expect(all(way, 'puzzleSolved'), p.type).toEqual([expect.objectContaining({ vault: VAULT_SLOT, puzzle: p.id, typ: p.type })]);
      expect(all(way, 'vaultDoorOpened')).toEqual([expect.objectContaining({ door: door.id, puzzle: p.id })]);
      expect(w.vaults.isDoorOpen(VAULT_SLOT, door.id)).toBe(true);
      expect(w.vaults.blocks(-1, door.tx, door.ty)).toBe(false);
      expect(xp()).toBeGreaterThan(before);
      if (p.type !== 'kisten') expect(all(way, 'puzzleStep').length).toBeGreaterThan(0);
      else expect(all(way, 'vaultCratePushed').length).toBe(way.length);
    }
    // A solved puzzle refuses further steps.
    const lever = w.plan.puzzles.find((p) => p.type === 'hebel')!.parts.find((x) => x.role === 'hebel')!;
    expect(w.rejections(w.useAt(lever.tx, lever.ty))).toEqual(['solved']);
  });

  it('a wrong lever resets the sequence after a pause; the bowl needs fire in the hand', () => {
    const w = gewoelbeWelt();
    enter(w);
    const p = w.plan.puzzles.find((x) => x.type === 'hebel')!;
    const v = w.vaults.variantOf(VAULT_SLOT, p.id) as Extract<PuzzleVariantDef, { typ: 'hebel' }>;
    const leverTile = (ordinal: number) => p.parts.find((x, i) => x.role === 'hebel' && partOrdinal(p.parts, i) === ordinal)!;
    const first = leverTile(v.folge[0] as number);
    const right = w.useAt(first.tx, first.ty);
    expect(events(right, 'puzzleStep')).toEqual([expect.objectContaining({ richtig: true })]);
    // Too soon after a pull.
    expect(w.rejections(w.useAt(first.tx, first.ty))).toEqual(['cooling']);
    w.run(SPRING);
    const wrongOrdinal = [...Array(v.hebel).keys()].find((o) => o !== v.folge[1])!;
    const wrong = w.useAt(leverTile(wrongOrdinal).tx, leverTile(wrongOrdinal).ty);
    expect(events(wrong, 'puzzleStep')).toEqual([expect.objectContaining({ richtig: false })]);
    expect(events(wrong, 'puzzleReset')).toHaveLength(1);
    expect(w.vaults.puzzleState(VAULT_SLOT, p.id)[0]).toBe(0);
    // The parts spring back for `resetDelaySeconds`.
    w.run(SPRING);
    expect(w.rejections(w.useAt(first.tx, first.ty))).toEqual(['cooling']);
    w.run(Math.ceil(BALANCE.puzzles.resetDelaySeconds * TICK_HZ));
    const bowl = w.plan.puzzles.find((x) => x.type === 'feuerschalen')!.parts.find((x) => x.role === 'schale')!;
    expect(w.rejections(w.useAt(bowl.tx, bowl.ty))).toEqual(['noTorch']);
  });

  it('the bell inscription plays its tune tone by tone at the tone spacing', () => {
    const w = gewoelbeWelt();
    enter(w);
    const p = w.plan.puzzles.find((x) => x.type === 'glocken')!;
    const v = w.vaults.variantOf(VAULT_SLOT, p.id) as Extract<PuzzleVariantDef, { typ: 'glocken' }>;
    const hint = p.parts.find((x) => x.role === 'hinweis')!;
    const spacing = Math.max(1, Math.round(BALANCE.puzzles.toneSpacingSeconds * TICK_HZ));
    const ran = [w.useAt(hint.tx, hint.ty)];
    for (let i = 0; i < v.folge.length * spacing + 2; i++) ran.push(w.run(1));
    const tones = all(ran, 'vaultHintPlayed') as { index: number; ton: number; tick: number }[];
    expect(tones.map((t) => t.ton)).toEqual(v.folge.map((b) => v.toene[b]));
    expect(tones.map((t) => t.index)).toEqual(v.folge.map((_, i) => i));
    for (let i = 1; i < tones.length; i++) expect(tones[i]!.tick - tones[i - 1]!.tick).toBe(spacing);
    expect(w.vaults.state(VAULT_SLOT)?.hint).toEqual([]);
  });
});

describe('vaults: keys, hidden walls, tablets', () => {
  it('a key from its pedestal opens a lock of its own vault and is used up; the key of another vault does not fit', () => {
    const w = gewoelbeWelt();
    enter(w);
    const lock = w.plan.doors.find((d) => d.kind === 'schloss')!;
    expect(w.rejections(w.useAt(lock.tx, lock.ty))).toEqual(['locked']);
    // A key of another vault in the bags.
    w.inventory.give(w.sim, VAULT_KEY_ITEM, 1, { daten: { gewoelbe: VAULT_SLOT + 1 } });
    expect(w.rejections(w.useAt(lock.tx, lock.ty))).toEqual(['locked']);
    const key = w.plan.keys[0]!;
    const taken = w.useAt(key.tx, key.ty);
    expect(events(taken, 'vaultKeyTaken')).toEqual([expect.objectContaining({ vault: VAULT_SLOT })]);
    expect(w.vaults.blocks(-1, key.tx, key.ty)).toBe(false);
    expect(w.rejections(w.useAt(key.tx, key.ty))).toEqual(['nothingThere']);
    expect(w.inventory.count(VAULT_KEY_ITEM)).toBe(2);
    const opened = w.useAt(lock.tx, lock.ty);
    expect(events(opened, 'vaultDoorUnlocked')).toEqual([expect.objectContaining({ vault: VAULT_SLOT, door: lock.id, schluessel: VAULT_KEY_ITEM })]);
    expect(w.vaults.blocks(-1, lock.tx, lock.ty)).toBe(false);
    // The own key is gone, the foreign one stays.
    expect(w.inventory.count(VAULT_KEY_ITEM)).toBe(1);
  });

  it('a cracked wall to a secret room gives way to E', () => {
    // A plan with a hidden edge (seed search over the grammar's draws).
    const w = gewoelbeWelt({ seed: hiddenSeed(), puzzleTypes: 1 });
    enter(w);
    const wall = w.plan.doors.find((d) => d.kind === 'verborgen')!;
    expect(w.vaults.blocks(-1, wall.tx, wall.ty)).toBe(true);
    const found = w.useAt(wall.tx, wall.ty);
    expect(events(found, 'vaultHiddenFound')).toEqual([expect.objectContaining({ vault: VAULT_SLOT, door: wall.id })]);
    expect(w.vaults.blocks(-1, wall.tx, wall.ty)).toBe(false);
  });

  it('a tablet is read with E (tabletRead); an unknown one is refused', () => {
    const w = gewoelbeWelt();
    enter(w);
    const t = w.plan.tablets[0]!;
    expect(events(w.useAt(t.tx, t.ty), 'tabletRead')).toEqual([expect.objectContaining({ tablet: 'tafel_01', quelle: 'gewoelbe', ort: VAULT_SLOT })]);
    expect(w.rejections(w.run(1, [{ type: 'tablet.read', tablet: 'tafel_59' }]))).toEqual(['unknownTablet']);
  });
});

/** The first test seed whose ordinary vault (one puzzle type) has a hidden wall. */
function hiddenSeed(): number {
  for (let s = 11; s < 200; s++) if (testVaultPlan(s, 1).doors.some((d) => d.kind === 'verborgen')) return s;
  throw new Error('no seed with a hidden wall');
}
