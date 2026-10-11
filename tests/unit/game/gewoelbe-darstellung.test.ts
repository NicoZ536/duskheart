/**
 * What the presentation reads of the vaults (M7-11 … M7-14, strand C; docs/SPIEL.md §19, §30 "C `src/render/game/vaults.ts`"):
 * the parts sampler (`VaultSampler.fill`, `GameSession.sampleVaultParts`) lists every moving part of the vault in a tile rectangle
 * with the state the simulation holds – doors shut and ground open, levers pulled in the order, crates where the pushes left
 * them on their plates, burning bowls, a real cracked wall's draft, the hint stele's order digits, the pedestals, the traps in
 * their phases (rest, warning, struck, spent; a blade on its beat) –, nothing off layer −1 or outside the rectangle; the vaults'
 * lights (`VaultsSystem.lightProvider`): a lit bowl burns, the floor runes glow around the player only while he is down there;
 * the debug command `vault.solve` solves by the rules' solver as if the player had (its doors open, `puzzleSolved`), and refuses
 * an unknown vault and a puzzle already solved.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import type { PuzzleVariantDef } from '../../../src/content/dungeons/schema';
import { CONTENT } from '../../../src/content/index';
import { createVaultPartsSample, HINT_DIGIT_BITS, HINT_DIGITS_MAX, TRAP_PHASE, VAULT_DOOR_KINDS, VAULT_PART, VaultSampler, type VaultPartKind, type VaultPartsSample } from '../../../src/game/samples/gewoelbe';
import { trapBeatTicks, trapRearmTicks, trapWarnTicks } from '../../../src/game/vaults/formulas';
import { vaultRaster } from '../../../src/world/gen/vaults/raster';
import type { VaultPlan, VaultTrapPlan } from '../../../src/world/gen/vaults/types';
import { TILE_PX } from '../../../src/world/model/coords';
import { gewoelbeWelt, VAULT_SLOT, type GewoelbeWelt } from './gewoelbe-testwelt';

function events<T>(map: Map<string, unknown[]>, type: string): T[] {
  return (map.get(type) ?? []) as T[];
}

/** Down the stairs (E at the entrance). */
function enter(w: GewoelbeWelt): void {
  w.goToTile(w.plan.entrance.tx, w.plan.entrance.ty + 1, 0);
  w.run(1, [{ type: 'vault.enter', vault: VAULT_SLOT }]);
}

/** The whole box of the vault, sampled with the player at (ptx, pty). */
function sampleBox(w: GewoelbeWelt, sampler: VaultSampler, out: VaultPartsSample, ptx = -1, pty = -1): VaultPartsSample {
  const b = w.plan.box;
  return sampler.fill(w.sim, -1, b.x0, b.y0, b.x0 + b.w - 1, b.y0 + b.h - 1, ptx, pty, out);
}

/** The sampled entries of `kind` as plain records, in sample order. */
function entries(s: VaultPartsSample, kind: VaultPartKind): { tx: number; ty: number; state: number; variant: number; aux: number; reach: number; ticks: number }[] {
  const out = [];
  for (let i = 0; i < s.count; i++) {
    if (s.kind[i] !== VAULT_PART[kind]) continue;
    out.push({ tx: s.tx[i] as number, ty: s.ty[i] as number, state: s.state[i] as number, variant: s.variant[i] as number, aux: s.aux[i] as number, reach: s.reach[i] as number, ticks: s.ticks[i] as number });
  }
  return out;
}

/** The parts of `role` of the puzzle of type `typ`, in plan order (their ordinals). */
function partsOf(w: GewoelbeWelt, typ: PuzzleVariantDef['typ'], role: string): { pz: VaultPlan['puzzles'][number]; v: PuzzleVariantDef; parts: { tx: number; ty: number }[] } {
  const k = w.plan.puzzles.findIndex((_, i) => w.vaults.variantOf(VAULT_SLOT, i)?.typ === typ);
  const pz = w.plan.puzzles[k]!;
  return { pz, v: w.vaults.variantOf(VAULT_SLOT, k) as PuzzleVariantDef, parts: pz.parts.filter((p) => p.role === role) };
}

const at = <T extends { tx: number; ty: number }>(list: readonly T[], p: { tx: number; ty: number }): T | undefined => list.find((e) => e.tx === p.tx && e.ty === p.ty);

describe('vault parts for the presentation (VaultSampler)', () => {
  it('lists every moving part of the plan with its rest state; nothing on the surface, nothing outside the rectangle', () => {
    const w = gewoelbeWelt();
    const sampler = new VaultSampler();
    const s = createVaultPartsSample();
    enter(w);
    sampleBox(w, sampler, s);
    const p = w.plan;
    const doors = [...entries(s, 'tor_quer'), ...entries(s, 'tor_laengs')];
    expect(doors).toHaveLength(p.doors.length);
    for (const d of p.doors) {
      const e = at(doors, d)!;
      expect(e, `door ${d.id}`).toBeDefined();
      expect(VAULT_DOOR_KINDS[e.variant]).toBe(d.kind);
      expect(e.state, `door ${d.id}`).toBe(0);
    }
    expect(entries(s, 'tor_laengs')).toHaveLength(p.doors.filter((d) => d.vertical).length);
    const roles = (role: string) => p.puzzles.flatMap((z) => z.parts.filter((x) => x.role === role));
    for (const [role, kind] of [
      ['hebel', 'hebel'],
      ['schale', 'schale'],
      ['glocke', 'glocke'],
      ['risswand', 'risswand'],
      ['kiste', 'kiste'],
      ['platte', 'platte'],
      ['ruecksetzer', 'ruecksetzer'],
      ['hinweis', 'hinweis'],
    ] as const) {
      expect(entries(s, kind), kind).toHaveLength(roles(role).length);
    }
    expect(entries(s, 'hebel').every((e) => e.state === 0)).toBe(true);
    expect(entries(s, 'schale').every((e) => e.state === 0)).toBe(true);
    expect(entries(s, 'sockel_schluessel')).toEqual(p.keys.map((k) => expect.objectContaining({ tx: k.tx, ty: k.ty, state: 0 })));
    expect(entries(s, 'sockel_splitter')).toHaveLength(p.shard === null ? 0 : 1);
    expect(entries(s, 'falle')).toHaveLength(p.traps.length);
    // The real cracked wall breathes (1), the false ones stand still (0).
    const walls = partsOf(w, 'verborgene_wand', 'risswand');
    const echt = (walls.v as Extract<PuzzleVariantDef, { typ: 'verborgene_wand' }>).echt;
    walls.parts.forEach((part, i) => expect(at(entries(s, 'risswand'), part)?.state, `wall ${i}`).toBe(echt.includes(i) ? 1 : 0));
    // The lever stele shows each lever's step in the order (1-based) under its picture.
    const levers = partsOf(w, 'hebel', 'hebel');
    const folge = (levers.v as Extract<PuzzleVariantDef, { typ: 'hebel' }>).folge;
    const stele = levers.pz.parts.find((x) => x.role === 'hinweis');
    if (stele !== undefined) {
      const packed = at(entries(s, 'hinweis'), stele)!.aux;
      const n = packed >> (HINT_DIGIT_BITS * HINT_DIGITS_MAX);
      const digits = Array.from({ length: n }, (_, i) => (packed >> (HINT_DIGIT_BITS * i)) & ((1 << HINT_DIGIT_BITS) - 1));
      expect(digits).toEqual(levers.parts.map((_, i) => folge.indexOf(i) + 1));
    }
    // Off layer −1, or a rectangle beside the box: nothing.
    const b = p.box;
    expect(sampler.fill(w.sim, 0, b.x0, b.y0, b.x0 + b.w - 1, b.y0 + b.h - 1, -1, -1, s).count).toBe(0);
    expect(sampler.fill(w.sim, -1, b.x0 + b.w + 5, b.y0, b.x0 + b.w + 40, b.y0 + b.h, -1, -1, s).count).toBe(0);
    // A rectangle of one door's tile: only what stands there.
    const d0 = p.doors[0]!;
    sampler.fill(w.sim, -1, d0.tx, d0.ty, d0.tx, d0.ty, -1, -1, s);
    expect(s.count).toBe(1);
    expect(s.tick).toBe(w.sim.tick);
  });

  it('follows the simulation: a lever pulled in the order, then the puzzle solved – levers down, its door open', () => {
    const w = gewoelbeWelt();
    const sampler = new VaultSampler();
    const s = createVaultPartsSample();
    enter(w);
    const { pz, v, parts } = partsOf(w, 'hebel', 'hebel');
    const folge = (v as Extract<PuzzleVariantDef, { typ: 'hebel' }>).folge;
    const first = parts[folge[0]!]!;
    expect(w.rejections(w.useAt(first.tx, first.ty))).toEqual([]);
    sampleBox(w, sampler, s);
    expect(entries(s, 'hebel').filter((e) => e.state === 1)).toEqual([expect.objectContaining({ tx: first.tx, ty: first.ty })]);
    const door = w.plan.doors.find((d) => d.kind === 'raetsel' && d.puzzle === pz.id)!;
    const solved = w.run(1, [{ type: 'vault.solve', vault: VAULT_SLOT, puzzle: pz.id }]);
    expect(w.rejections(solved)).toEqual([]);
    expect(events(solved, 'puzzleSolved')).toEqual([expect.objectContaining({ vault: VAULT_SLOT, puzzle: pz.id, typ: 'hebel' })]);
    expect(events(solved, 'vaultDoorOpened')).toEqual([expect.objectContaining({ door: door.id })]);
    sampleBox(w, sampler, s);
    for (const i of folge) expect(at(entries(s, 'hebel'), parts[i]!)?.state, `lever ${i}`).toBe(1);
    expect(at([...entries(s, 'tor_quer'), ...entries(s, 'tor_laengs')], door)?.state).toBe(1);
  });

  it('crates stand where the solution pushed them, on their plates (pressed); a plate under the player is pressed', () => {
    const w = gewoelbeWelt();
    const sampler = new VaultSampler();
    const s = createVaultPartsSample();
    enter(w);
    const { pz } = partsOf(w, 'kisten', 'kiste');
    const plates = pz.parts.filter((p) => p.role === 'platte');
    sampleBox(w, sampler, s, plates[0]!.tx, plates[0]!.ty);
    expect(at(entries(s, 'platte'), plates[0]!)?.state).toBe(1);
    expect(plates.slice(1).every((p) => at(entries(s, 'platte'), p)?.state === 0)).toBe(true);
    w.run(1, [{ type: 'vault.solve', vault: VAULT_SLOT, puzzle: pz.id }]);
    sampleBox(w, sampler, s);
    const crates = entries(s, 'kiste');
    expect(crates.map((c) => `${c.tx},${c.ty}`).sort()).toEqual(plates.map((p) => `${p.tx},${p.ty}`).sort());
    expect(entries(s, 'platte').every((e) => e.state === 1)).toBe(true);
  });

  it('bowls burn once lit and light the vault; the runes glow around the player only while he is down there', () => {
    const w = gewoelbeWelt();
    const lights = new Map<number, { kind: string; layer: number; x: number; y: number; radius: number }>();
    const provider = w.vaults.lightProvider();
    const collect = (): typeof lights => {
      lights.clear();
      provider(w.sim, (id, kind, _farbe, layer, x, y, _h, radius) => lights.set(id, { kind, layer, x, y, radius }));
      return lights;
    };
    // Never entered: no light.
    expect(collect().size).toBe(0);
    enter(w);
    const runes = vaultRaster(w.plan).object.filter((o) => o === 'ort_gw_rune').length;
    expect(runes).toBeGreaterThan(0);
    const near = [...collect().values()];
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThanOrEqual(runes);
    expect(near.every((l) => l.kind === 'gewoelbe_rune' && l.layer === -1 && l.radius === BALANCE.vaults.runeLight.radiusTiles * TILE_PX)).toBe(true);
    const reach = BALANCE.vaults.runeLightReachTiles * TILE_PX + TILE_PX;
    const me = w.pos();
    expect(near.every((l) => Math.abs(l.x - me.x) <= reach && Math.abs(l.y - me.y) <= reach)).toBe(true);
    // The bowls: solved, every bowl of the order burns (one light each, at its bowl).
    const { pz, v, parts } = partsOf(w, 'feuerschalen', 'schale');
    w.run(1, [{ type: 'vault.solve', vault: VAULT_SLOT, puzzle: pz.id }]);
    const folge = (v as Extract<PuzzleVariantDef, { typ: 'feuerschalen' }>).folge;
    const bowls = [...collect().values()].filter((l) => l.kind === 'gewoelbe_schale');
    expect(bowls).toHaveLength(new Set(folge).size);
    for (const i of new Set(folge)) expect(bowls.some((l) => l.x === (parts[i]!.tx + 0.5) * TILE_PX), `bowl ${i}`).toBe(true);
    const sampler = new VaultSampler();
    const s = sampleBox(w, sampler, createVaultPartsSample());
    for (const i of new Set(folge)) expect(at(entries(s, 'schale'), parts[i]!)?.state, `bowl ${i}`).toBe(1);
    // Back up the stairs: the bowls still burn below, the runes no more.
    w.goToTile(w.plan.entrance.tx, w.plan.entrance.ty + 1);
    w.run(1, [{ type: 'vault.leave', vault: VAULT_SLOT }]);
    expect(w.body().layer).toBe(0);
    const up = [...collect().values()];
    expect(up.filter((l) => l.kind === 'gewoelbe_rune')).toEqual([]);
    expect(up.filter((l) => l.kind === 'gewoelbe_schale')).toHaveLength(bowls.length);
  });
});

describe('trap phases for the presentation', () => {
  /** Free floor tiles of the start room (not the way up, nothing standing there). */
  function startFloor(plan: VaultPlan): { tx: number; ty: number }[] {
    const r = vaultRaster(plan);
    const room = plan.rooms.find((x) => x.node === plan.graph.start)!;
    const out: { tx: number; ty: number }[] = [];
    for (let ty = room.y0 + 2; ty < room.y0 + 14; ty++) {
      for (let tx = room.x0 + 2; tx < room.x0 + 14; tx++) {
        const i = (ty - r.y0) * r.w + (tx - r.x0);
        if (r.solid[i] === 0 && r.object[i] === null && i !== r.entrance) out.push({ tx, ty });
      }
    }
    return out;
  }

  it('rest, warning (ticks counting), struck, spent for the collapsing floor; a blade on its beat', () => {
    let spear = { tx: 0, ty: 0 };
    let floor = { tx: 0, ty: 0 };
    let blade = { tx: 0, ty: 0 };
    const w = gewoelbeWelt({
      plan: (p) => {
        const f = startFloor(p);
        spear = f[3]!;
        floor = f[f.length - 4]!;
        blade = f[Math.floor(f.length / 2)]!;
        const traps: VaultTrapPlan[] = [
          { id: 0, type: 'speerfalle', tx: spear.tx, ty: spear.ty, dir: 1, reach: 1 },
          { id: 1, type: 'einsturzboden', tx: floor.tx, ty: floor.ty, dir: 1, reach: 1 },
          { id: 2, type: 'pendelklinge', tx: blade.tx, ty: blade.ty, dir: 0, reach: 3 },
        ];
        return { ...p, traps };
      },
    });
    const sampler = new VaultSampler();
    const s = createVaultPartsSample();
    const traps = sampler.trapDefs;
    const def = (id: string) => CONTENT.collection('vaultTraps').get(id);
    enter(w);
    const trap = (p: { tx: number; ty: number }) => at(entries(sampleBox(w, sampler, s), 'falle'), p)!;
    expect(traps[trap(spear).variant]?.id).toBe('speerfalle');
    expect(trap(spear).state).toBe(TRAP_PHASE.ruhe);
    expect(trap(blade).reach).toBe(3);
    // The blade: its place in the two-beat swing, one tick further each tick.
    const beat = trapBeatTicks(def('pendelklinge'));
    const t0 = trap(blade);
    expect(t0.state).toBe(TRAP_PHASE.takt);
    expect(t0.ticks).toBeGreaterThanOrEqual(0);
    expect(t0.ticks).toBeLessThan(2 * beat);
    w.run(1);
    expect(trap(blade).ticks).toBe((t0.ticks + 1) % (2 * beat));
    // The spear plate: warning from the step on, counting; struck after its telegraph.
    w.goToTile(spear.tx, spear.ty);
    const warn = trapWarnTicks(def('speerfalle'));
    const armedTick = w.vaults.state(VAULT_SLOT)!.trapArmedTick[0]!;
    expect(armedTick).toBeGreaterThanOrEqual(0);
    expect(trap(spear)).toEqual(expect.objectContaining({ state: TRAP_PHASE.warnung, ticks: w.sim.tick - armedTick }));
    w.run(2);
    expect(trap(spear)).toEqual(expect.objectContaining({ state: TRAP_PHASE.warnung, ticks: w.sim.tick - armedTick }));
    w.run(warn);
    // Struck: the ticks since the strike (the rearm tick less the cooldown).
    const ready = w.vaults.state(VAULT_SLOT)!.trapReadyTick[0]!;
    expect(trap(spear)).toEqual(expect.objectContaining({ state: TRAP_PHASE.ausgeloest, ticks: w.sim.tick - (ready - trapRearmTicks(def('speerfalle'))) }));
    expect(trap(spear).ticks).toBeLessThan(warn);
    // The collapsing floor stays a hole: spent.
    w.goToTile(floor.tx, floor.ty);
    w.run(trapWarnTicks(def('einsturzboden')) + 2);
    w.goToTile(spear.tx - 1, spear.ty - 1);
    expect(trap(floor).state).toBe(TRAP_PHASE.verbraucht);
  });
});

describe('debug command vault.solve', () => {
  it('solves every unsolved puzzle at once (every puzzle door opens); refuses an unknown vault and a solved puzzle', () => {
    const w = gewoelbeWelt();
    enter(w);
    expect(w.rejections(w.run(1, [{ type: 'vault.solve', vault: 99 }]))).toEqual(['unknownVault']);
    expect(w.rejections(w.run(1, [{ type: 'vault.solve', vault: VAULT_SLOT, puzzle: w.plan.puzzles.length }]))).toEqual(['nothingThere']);
    const ev = w.run(1, [{ type: 'vault.solve', vault: VAULT_SLOT }]);
    expect(w.rejections(ev)).toEqual([]);
    expect(events<{ puzzle: number }>(ev, 'puzzleSolved').map((e) => e.puzzle)).toEqual(w.plan.puzzles.map((p) => p.id));
    for (const p of w.plan.puzzles) expect(w.vaults.isSolved(VAULT_SLOT, p.id), `puzzle ${p.id}`).toBe(true);
    for (const d of w.plan.doors.filter((x) => x.kind === 'raetsel')) expect(w.vaults.isDoorOpen(VAULT_SLOT, d.id), `door ${d.id}`).toBe(true);
    expect(w.rejections(w.run(1, [{ type: 'vault.solve', vault: VAULT_SLOT, puzzle: 0 }]))).toEqual(['solved']);
    expect(w.rejections(w.run(1, [{ type: 'vault.solve', vault: VAULT_SLOT }]))).toEqual(['solved']);
  });
});
