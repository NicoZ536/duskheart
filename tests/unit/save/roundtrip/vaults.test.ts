/**
 * Save roundtrip of the participant `vaults` (M7-10 … M7-16; docs/SPIEL.md §19, §27): an entered vault with a solved puzzle, a
 * half-done one, a taken key and an unlocked door, an opened chest and a trap in its cooldown survives save → load; a loaded
 * world continues exactly like the uninterrupted one (the closed doors still collide, the warning strikes at the same tick).
 */
import { describe, expect, it } from 'vitest';
import { createSimulation } from '../../../../src/game/setup';
import type { VaultsSnapshot } from '../../../../src/game/vaults/state';
import { kistenMap, partOrdinal, puzzleSolve, PUSH_DX, PUSH_DY } from '../../../../src/game/puzzles/index';
import type { PuzzleVariantDef } from '../../../../src/content/dungeons/schema';
import { expectRoundtrip } from '../../../../src/save/roundtrip';
import { gewoelbeWelt, VAULT_SLOT, type GewoelbeWelt } from '../../game/gewoelbe-testwelt';

/** Down, the lever puzzle solved, the bell puzzle one step in, the key taken and the lock opened, a chest opened. */
function play(w: GewoelbeWelt): void {
  w.goToTile(w.plan.entrance.tx, w.plan.entrance.ty + 1, 0);
  w.run(1, [{ type: 'vault.enter', vault: VAULT_SLOT }]);
  const lever = w.plan.puzzles.find((p) => p.type === 'hebel')!;
  const v = w.vaults.variantOf(VAULT_SLOT, lever.id) as PuzzleVariantDef;
  for (const a of puzzleSolve(v) ?? []) {
    const j = lever.parts.findIndex((x, i) => x.role === 'hebel' && partOrdinal(lever.parts, i) === a.part);
    w.useAt(lever.parts[j]!.tx, lever.parts[j]!.ty);
    w.run(40);
  }
  const bells = w.plan.puzzles.find((p) => p.type === 'glocken')!;
  const bv = w.vaults.variantOf(VAULT_SLOT, bells.id) as Extract<PuzzleVariantDef, { typ: 'glocken' }>;
  const first = bells.parts.find((x, i) => x.role === 'glocke' && partOrdinal(bells.parts, i) === bv.folge[0])!;
  w.useAt(first.tx, first.ty);
  const crates = w.plan.puzzles.find((p) => p.type === 'kisten')!;
  const kv = w.vaults.variantOf(VAULT_SLOT, crates.id) as Extract<PuzzleVariantDef, { typ: 'kisten' }>;
  const push = (puzzleSolve(kv) ?? [])[0]!;
  const origin = crates.parts.find((x) => x.role === 'ursprung')!;
  const m = kistenMap(kv);
  const cx = origin.tx + (push.part % m.w);
  const cy = origin.ty + Math.floor(push.part / m.w);
  w.goToTile(cx - (PUSH_DX[push.dir] as number), cy - (PUSH_DY[push.dir] as number));
  w.run(1, [{ type: 'vault.push', tx: cx, ty: cy }]);
  const key = w.plan.keys[0]!;
  w.useAt(key.tx, key.ty);
  const lock = w.plan.doors.find((d) => d.kind === 'schloss')!;
  w.useAt(lock.tx, lock.ty);
  const chest = w.plan.chests[0]!;
  w.useAt(chest.tx, chest.ty);
  w.run(3);
}

describe('save roundtrip: vaults', () => {
  it('restores doors, keys, chests, puzzles, traps and the guards risen', () => {
    const report = expectRoundtrip(gewoelbeWelt, play, (w) => w.vaults.save);
    expect(report.id).toBe('vaults');
    const data = JSON.parse(report.canonical) as VaultsSnapshot;
    const v = data.vaults.find((x) => x.slot === VAULT_SLOT);
    expect(v?.entered).toBe(true);
    expect(v?.guardsRisen).toBe(true);
    expect(v?.keysTaken).toBe(1);
    expect(v?.doorsOpen).not.toBe(0);
    expect(v?.chestsOpened).toBe(1);
    expect(v?.puzzles.some((p) => p.length > 0)).toBe(true);
  });

  it('save → load → continue: the same state, the same collisions, the same next steps', () => {
    const a = gewoelbeWelt();
    play(a);
    const b = gewoelbeWelt();
    b.goToTile(b.plan.entrance.tx, b.plan.entrance.ty + 1, 0);
    for (const p of a.sim.participants()) b.sim.participant(p.id).deserialize(structuredClone(p.serialize()));
    expect(b.vaults.save.serialize()).toEqual(a.vaults.save.serialize());
    for (const d of a.plan.doors) expect(b.vaults.blocks(-1, d.tx, d.ty), `door ${d.id}`).toBe(a.vaults.blocks(-1, d.tx, d.ty));
    const ea = a.run(120);
    const eb = b.run(120);
    expect(eb.get('vaultTrapTriggered')).toEqual(ea.get('vaultTrapTriggered'));
    expect(b.vaults.save.serialize()).toEqual(a.vaults.save.serialize());
  });

  it('the game simulation has the participant (empty at the start)', () => {
    expect(createSimulation({ seed: 3 }).participant('vaults').serialize()).toEqual({ vaults: [] });
  });

  it('rejects malformed snapshots and keeps the state it had', () => {
    const w = gewoelbeWelt();
    play(w);
    const good = w.vaults.save.serialize() as VaultsSnapshot;
    const first = good.vaults[0] as unknown as Record<string, unknown>;
    const bad: unknown[] = [null, { vaults: 'x' }, { vaults: [{ ...first, slot: -1 }] }, { vaults: [first, first] }, { vaults: [{ ...first, chestsOpened: 1.5 }] }, { vaults: [{ ...first, hint: [1] }] }, { vaults: [{ ...first, trapArmedTick: [] }] }];
    for (const data of bad) expect(() => w.vaults.save.deserialize(data), JSON.stringify(data)).toThrow(TypeError);
    expect(w.vaults.save.serialize()).toEqual(good);
  });
});
