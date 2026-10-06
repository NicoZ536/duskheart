/**
 * The Borkenvater fought by a script (M7-34; MASTERPROMPT §20.2 "Borkenvater: Phase 1 Wurzelstöße in Linien + Zweiglinge; Phase 2
 * Borkenpanzer (nur glühende Knoten verwundbar), Blättersturm senkt Sicht; Phase 3 Raserei, Feuer ×2, Arena brennt teilweise.
 * Drop: Kernholz", §D "Kampfdauer 3–6 min … kein One-Shot auf Normal"; docs/SPIEL.md §22 "Integrationstest: Skript-Kampf besiegt
 * ihn, alle Phasen erreicht, kein Treffer über der Schwelle"): in the gear of the tier before (the fibre garb, a bronze mace),
 * the player wakes it, strikes the trunk – in the bark phase the glowing knot –, drinks to half health (a stand-in for the
 * potions of a real fight) and wins: every phase reached, every attack kind seen, no single blow above
 * `BALANCE.bosses.maxHitShare` of the maximum health, the heartwood and the trophy on the ground, and the bronze pickaxe the
 * only recipe that needs the heartwood (the gating of §13.2).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/content/balance';
import { CONTENT } from '../../src/content/index';
import type { BossDef } from '../../src/content/bosses/schema';
import type { Entity } from '../../src/engine/ecs';
import { createCombatantView } from '../../src/game/combat/system';
import { ARENA, leuchtfeuerWelt } from '../unit/game/leuchtfeuer-testwelt';
import { eventsOf } from '../unit/game/kampf-testwelt';

const HZ = BALANCE.time.tickHz;
/** Longest the script may take [ticks]: §D "Kampfdauer 3–6 min" – the script never dodges, so it is quicker. */
const MAX_TICKS = 6 * 60 * HZ;

describe('Borkenvater: Skript-Kampf (M7-34)', () => {
  it('besiegt ihn in allen drei Phasen, ohne dass ein Treffer mehr als 45 % des Lebens nimmt', () => {
    const w = leuchtfeuerWelt({ spawnAt: { x: ARENA.x, y: ARENA.y + 14 } });
    const garb = [
      ['faserkappe', 'kopf'],
      ['faserhemd', 'brust'],
      ['faserhose', 'beine'],
      ['faserschuhe', 'fuesse'],
    ] as const;
    for (const [item, slot] of garb) w.wear(item, slot);
    const armor = w.equipment.stats().werte.ruestung;
    expect(armor).toBe(6);
    w.hold('bronzestreitkolben');
    w.run(2);
    const def = CONTENT.collection('bosses').get('borkenvater') as BossDef;
    // Into the inner ring, south of the trunk: the mace reaches the trunk and the southern knot from here.
    w.goTo(ARENA.x, ARENA.y + 2);
    const b = w.bosses.state('borkenvater');
    expect(b.state).toBe('erwacht');
    const phases = new Set<number>();
    const attacks = new Set<string>();
    const hits: number[] = [];
    let drinks = 0;
    const resets: string[] = [];
    let ticks = 0;
    let attacking = false;
    const probe = createCombatantView();
    const spot = w.centre(ARENA.x, ARENA.y + 2);
    while (b.state === 'erwacht' && ticks < MAX_TICKS) {
      phases.add(b.phase);
      const target: Entity = def.phasen[b.phase]?.verwundbar === 'schwachstellen' ? (b.weakPoints[2] as Entity) : b.entity;
      if (w.bosses.targets.view(w.sim, target, probe)) {
        const p = w.pos();
        w.aimBy(probe.x - p.x, probe.y - p.y);
      }
      // Click by click: pressed one tick, released the next (held, it would become the heavy attack). Knocked back by a
      // blow, the script steps back to its spot (a teleport stands in for the walk).
      attacking = !attacking;
      const here = w.pos();
      const back = Math.hypot(here.x - spot.x, here.y - spot.y) > 8 ? [{ type: 'player.teleport' as const, x: spot.x, y: spot.y, layer: 0 }] : [];
      const ev = w.run(1, [...back, { type: 'combat.attack', on: attacking }]);
      ticks++;
      for (const a of eventsOf<{ angriff: string }>(ev, 'bossAttack')) attacks.add(a.angriff);
      for (const r of eventsOf<{ grund: string }>(ev, 'bossReset')) resets.push(r.grund);
      for (const d of eventsOf<{ amount: number; cause: string }>(ev, 'playerDamaged')) if (d.cause !== 'brennen') hits.push(d.amount);
      // Worn through by the blows (60 uses each), the garb is mended (a fresh set stands in for the repair): every blow is
      // measured against the armour of the tier.
      if (w.equipment.stats().werte.ruestung < armor) {
        for (const [item, slot] of garb) w.wear(item, slot);
      }
      // A potion at half health: the script fights on (its blows are what is measured).
      const v = w.vit();
      if (v.health < v.maxHealth / 2) {
        v.health = v.maxHealth;
        drinks++;
      }
    }
    expect(b.state).toBe('besiegt');
    expect(resets).toEqual([]);
    expect([...phases].sort()).toEqual([0, 1, 2]);
    // Every kind of its attacks came: root thrusts, the root ring, servants, the leaf storm, the fist, the burning arena.
    for (const id of ['wurzelstoss', 'wurzelring', 'zweiglinge', 'blaettersturm', 'wurzelfaust', 'arena_brennt']) expect(attacks, id).toContain(id);
    expect(hits.length).toBeGreaterThan(0);
    const maxHealth = BALANCE.survival.health.base;
    expect(Math.max(...hits) / maxHealth).toBeLessThanOrEqual(BALANCE.bosses.maxHitShare);
    // §D "Kampfdauer 3–6 min" with a player who dodges: the script stands and swings, so it is quicker – but not trivial.
    expect(ticks / HZ).toBeGreaterThan(60);
    expect(drinks).toBeGreaterThan(0);
    // The spoils lie in front of the dead tree.
    const items = w.dropped.map((d) => d.stack.item);
    for (const id of ['kernholz', 'trophaee_borkenvater', 'herzsplitter']) expect(items, id).toContain(id);
    // The heartwood gates tier 1: only the bronze pickaxe's recipe asks for it, and only the boss gives it.
    const needing = CONTENT.collection('recipes')
      .values()
      .filter((r) => r.zutaten.some((z) => 'item' in z && z.item === 'kernholz'))
      .map((r) => r.id);
    expect(needing).toEqual(['rezept_bronzespitzhacke']);
    expect(CONTENT.collection('items').get('kernholz').quellen).toEqual(['boss:borkenvater']);
  });
});

describe('Fixture-Beitrag „Leuchtfeuer“ (Referenzspielstand v4, tools/save/fixtureM7/leuchtfeuer.ts)', () => {
  it('nur über Befehle: Borkenvater besiegt, Leuchtfeuer 1 entzündet, LF1 frei, ein benannter Wegstein, ein Herzsplitter benutzt', async () => {
    const { createSimulation } = await import('../../src/game/setup');
    const { emptyLeuchtfeuerFacts, LEUCHTFEUER_FIXTURE, leuchtfeuerFacts, leuchtfeuerFactsSchema, playLeuchtfeuer } = await import('../../tools/save/fixtureM7/leuchtfeuer');
    const sim = createSimulation({ seed: 3, worldSize: 'small' });
    // The world materialises (the arena and the site are found from it), as it is by the time the fixture plays this part.
    void sim.world.generated;
    // The player on the start beach, the chunks around streamed (as the fixture's own first steps do).
    sim.step([{ type: 'player.spawn' }]);
    for (let i = 0; i < 30; i++) sim.step();
    sim.events.drain(() => undefined);
    const empty = emptyLeuchtfeuerFacts();
    expect(leuchtfeuerFacts(sim)).toEqual(empty);
    playLeuchtfeuer(sim);
    const facts = leuchtfeuerFactsSchema.parse(leuchtfeuerFacts(sim));
    expect(facts.bosses).toEqual(empty.bosses.map((b) => (b.boss === LEUCHTFEUER_FIXTURE.boss ? { ...b, state: 'besiegt', health: 0, lootGiven: true, defeated: true } : b)));
    expect(facts.beacons).toEqual(empty.beacons.map((b) => (b.nummer === LEUCHTFEUER_FIXTURE.beacon ? { ...b, state: 'entzuendet', lit: true, visionShown: true } : b)));
    expect(facts.unlocks).toEqual(['lf1_glutkern', 'lf1_lumen_laterne', 'lf1_lumen_werkbank', 'lf1_wegsteine'].map((id) => ({ id, source: 'leuchtfeuer:1' })));
    expect(facts.shards).toEqual({ herz: 1, glut: 0 });
    expect(facts.waystones).toEqual([{ id: 1, name: LEUCHTFEUER_FIXTURE.waystoneName }]);
  });
});
