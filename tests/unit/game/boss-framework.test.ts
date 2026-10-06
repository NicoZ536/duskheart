/**
 * The boss framework (M7-32; MASTERPROMPT §20.2, §D, §4.6; docs/SPIEL.md §22 "Boss-Framework", "Fairness", "Wiedereinstieg"):
 * states, access, title card, seal, phases with marks and invulnerable transitions, weak points, telegraphed attacks of every
 * kind, servants, reset on death and flight, victory with its loot, the respawn before the arena – on a drawn arena
 * (leuchtfeuer-testwelt.ts), with the content's Borkenvater and fixture bosses of one attack per phase.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { BORKENVATER } from '../../../src/content/bosses/borkenvater';
import { bossSchema, type BossDef, type BossInput } from '../../../src/content/bosses/schema';
import { CONTENT } from '../../../src/content/index';
import { NULL_ENTITY, type Entity } from '../../../src/engine/ecs';
import { createCombatAttack } from '../../../src/game/combat/system';
import { createCombatantView } from '../../../src/game/combat/system';
import { hitShare, phaseFor, telegraphTicks } from '../../../src/game/bosses/formulas';
import type { BossSample } from '../../../src/game/bosses/types';
import { ARENA, ARENA_RADIUS, leuchtfeuerWelt, OFFSET, type LeuchtfeuerWelt } from './leuchtfeuer-testwelt';
import { eventsOf } from './kampf-testwelt';

const B = BALANCE.bosses;
const HZ = BALANCE.time.tickHz;
const TITLE = Math.round(B.titleCardSeconds * HZ);

/** A fixture boss: the Borkenvater with other phases or access. */
function probeBoss(phasen: BossInput['phasen'], zugang: BossInput['zugang'] = { art: 'betreten' }): BossDef {
  return bossSchema.parse({ ...BORKENVATER, id: 'probe_boss', sprite: 'boss_probe_boss', zugang, phasen }) as BossDef;
}

/** One line straight at the player (wide, long), the only attack of a phase. */
const LINE = { id: 'stoss', art: 'flaeche', form: 'linie', schaden: 20, schadensart: 'wucht', telegraphSekunden: 0.5, reichweitePx: 200, breitePx: 40, gewicht: 1, abklingSekunden: 1, clip: 'wurzelstoss' } as const;
const KNOTS = [{ id: 'knoten', dx: 0, dy: 30, radiusPx: 10 }];

/** Three phases of one attack each: line; weak points + leaf storm; burning arena. */
function threePhases(): BossDef {
  return probeBoss([
    { id: 'eins', abLebensanteil: 1, verwundbar: 'koerper', tempo: 1, uebergangSekunden: 0, angriffe: [LINE] },
    { id: 'zwei', abLebensanteil: 0.66, verwundbar: 'schwachstellen', schwachstellen: KNOTS, tempo: 1, uebergangSekunden: 1, angriffe: [{ id: 'sturm', art: 'arena', effekt: 'blaettersturm', sekunden: 4, gewicht: 1, abklingSekunden: 30, clip: 'blaettersturm' }] },
    { id: 'drei', abLebensanteil: 0.33, verwundbar: 'koerper', tempo: 1, uebergangSekunden: 1, resistenzen: { feuer: -1 }, angriffe: [{ id: 'brand', art: 'arena', effekt: 'arena_brennt', sekunden: 6, gewicht: 1, abklingSekunden: 30, clip: 'raserei' }] },
  ]);
}

/** A hit of the player on body `e` [HP of `damage` before resistances and armour]; returns the dealt amount. */
function strike(w: LeuchtfeuerWelt, e: Entity, damage: number, type: 'hieb' | 'feuer' = 'hieb'): number {
  const p = w.pos();
  const a = { ...createCombatAttack(), damage, type, critChance: 0, fromX: p.x, fromY: p.y };
  return w.combat.resolve(w.sim, w.sim.player, e, a)?.amount ?? 0;
}

/** Steps into the inner ring (wakes a boss of access `betreten` in that tick) and returns the events of that tick. */
function enter(w: LeuchtfeuerWelt): Map<string, unknown[]> {
  return w.goTo(ARENA.x, ARENA.y + 4);
}

function sample(): BossSample {
  return { active: false, boss: '', health: 0, maxHealth: 0, phase: 0, phaseMarks: [], titleUntilTick: 0 };
}

describe('Boss-Content (§20.2, §D, §4.6)', () => {
  const bosses = CONTENT.collection('bosses').values() as readonly BossDef[];

  it('jeder Boss: ≥ 3 Phasen ab vollem Leben absteigend, Sprite boss_<id>, jede Attacke telegraphiert ≥ 0,4 s', () => {
    expect(bosses.map((b) => b.id)).toContain('borkenvater');
    for (const b of bosses) {
      expect(b.phasen.length, b.id).toBeGreaterThanOrEqual(3);
      expect(b.phasen[0]?.abLebensanteil).toBe(1);
      expect(b.sprite).toBe(`boss_${b.id}`);
      for (const p of b.phasen) for (const a of p.angriffe) expect(telegraphTicks(a), `${b.id}/${p.id}/${a.id}`).toBeGreaterThanOrEqual(Math.round(B.telegraphMinSeconds * HZ));
    }
  });

  it('kein One-Shot auf Normal: kein Treffer über 45 % des maximalen Lebens gegen das schwächste Rüstungsset der Stufe davor', () => {
    const items = CONTENT.collection('items');
    const sets = CONTENT.collection('armorSets').values();
    const setArmor = (teile: readonly string[]): number => teile.reduce((sum, id) => sum + (items.get(id).werte?.ruestung ?? 0), 0);
    for (const b of bosses) {
      // The beacon of a boss's biome opens the next tier: the player meets it in the gear of the tier before (Borkenvater: T0).
      const beacon = CONTENT.collection('beacons').values().find((l) => l.boss === b.id);
      if (beacon === undefined) throw new Error(`no beacon guarded by ${b.id}`);
      const tier = beacon.nummer - 1;
      const armor = Math.min(...sets.filter((s) => items.get(s.teile[0] as string).stufe === tier).map((s) => setArmor(s.teile)));
      expect(armor, b.id).toBeGreaterThan(0);
      let worst = 0;
      for (const p of b.phasen) for (const a of p.angriffe) if (a.art === 'flaeche') worst = Math.max(worst, hitShare(a, 'normal', armor, BALANCE.survival.health.base));
      expect(worst, b.id).toBeLessThanOrEqual(B.maxHitShare);
      // And even without armour no blow takes the player from full health (§D "kein One-Shot").
      for (const p of b.phasen) for (const a of p.angriffe) if (a.art === 'flaeche') expect(hitShare(a, 'normal', 0, BALANCE.survival.health.base), a.id).toBeLessThan(1);
    }
  });

  it('Phase nach Lebensanteil: die letzte erreichte Schwelle', () => {
    const d = CONTENT.collection('bosses').get('borkenvater') as BossDef;
    expect(phaseFor(d, d.leben, d.leben)).toBe(0);
    expect(phaseFor(d, d.leben * 0.67, d.leben)).toBe(0);
    expect(phaseFor(d, d.leben * 0.66, d.leben)).toBe(1);
    expect(phaseFor(d, d.leben * 0.2, d.leben)).toBe(2);
  });
});

describe('Bosse zur Laufzeit (M7-32)', () => {
  it('Zugang „betreten“: der innere Ring weckt – Titelkarte 3 s unverwundbar ohne Angriff, Arena versiegelt, Furcht +10', () => {
    const w = leuchtfeuerWelt();
    w.run(1);
    expect(w.bosses.state('borkenvater').state).toBe('schlafend');
    // At the rim (outside the inner ring) nothing happens.
    w.goTo(ARENA.x, ARENA.y + ARENA_RADIUS - 1);
    w.run(2);
    expect(w.bosses.awake()).toBeNull();
    const fear = w.life.fear.state.value;
    const ev = enter(w);
    expect(eventsOf(ev, 'bossAwakened')).toHaveLength(1);
    const b = w.bosses.state('borkenvater');
    expect(b.state).toBe('erwacht');
    expect(b.sealed).toBe(true);
    expect(w.life.fear.state.value).toBeCloseTo(fear + B.sightingFear, 5);
    // The seal: the rim blocks while awake, the inside does not.
    expect(w.bosses.blocksTile(0, OFFSET + ARENA.x, OFFSET + ARENA.y + ARENA_RADIUS)).toBe(true);
    expect(w.bosses.blocksTile(0, OFFSET + ARENA.x + 4, OFFSET + ARENA.y + 4)).toBe(false);
    // The title card: invulnerable, no telegraph.
    const view = createCombatantView();
    expect(w.bosses.targets.view(w.sim, b.entity, view)).toBe(true);
    expect(view.invulnerable).toBe(true);
    expect(strike(w, b.entity, 50)).toBe(0);
    const during = w.run(TITLE - 1);
    expect(eventsOf(during, 'bossTelegraph')).toHaveLength(0);
    expect(w.bosses.sample(sample())).toMatchObject({ active: true, boss: 'borkenvater', phase: 0, phaseMarks: [0.66, 0.33], maxHealth: 1600, titleUntilTick: b.awakenedTick + TITLE });
    w.run(1);
    expect(w.bosses.targets.view(w.sim, b.entity, view) && view.invulnerable).toBe(false);
    expect(strike(w, b.entity, 50)).toBeGreaterThan(0);
  });

  it('jede Fläche telegraphiert, dann trifft sie: der Stoß in der Linie, nicht daneben', () => {
    const w = leuchtfeuerWelt({ bosses: [threePhases()] });
    enter(w);
    w.run(TITLE - 1);
    let tele: { ticks: number; angriff: string }[] = [];
    let hit = false;
    const before = w.vit().health;
    for (let i = 0; i < 4 * HZ && !hit; i++) {
      const ev = w.run(1);
      tele = tele.concat(eventsOf(ev, 'bossTelegraph'));
      hit = eventsOf(ev, 'bossAttack').length > 0;
    }
    expect(tele[0]?.angriff).toBe('stoss');
    expect(tele[0]?.ticks).toBe(Math.round(LINE.telegraphSekunden * HZ));
    expect(hit).toBe(true);
    expect(w.vit().health).toBeCloseTo(before - LINE.schaden, 5);
    // Beside the line (aim locked at the telegraph), the next blow misses.
    let next = false;
    for (let i = 0; i < 4 * HZ && !next; i++) {
      const ev = w.run(1);
      if (eventsOf(ev, 'bossTelegraph').length > 0) w.goTo(ARENA.x + 5, ARENA.y);
      next = eventsOf(ev, 'bossAttack').length > 0;
    }
    expect(next).toBe(true);
    expect(w.vit().health).toBeCloseTo(before - LINE.schaden, 5);
  });

  it('Phasen: Schwelle → Phasenwechsel mit Übergang; Phase 2 nur Schwachstellen verwundbar, Blättersturm senkt die Sicht; Phase 3 Arena brennt', () => {
    const w = leuchtfeuerWelt({ bosses: [threePhases()] });
    enter(w);
    w.run(TITLE);
    const b = w.bosses.state('probe_boss');
    const ev = w.run(1, [{ type: 'boss.debug', boss: 'probe_boss', aktion: 'phase', phase: 1 }]);
    expect(eventsOf(ev, 'bossPhaseChanged')).toEqual([expect.objectContaining({ boss: 'probe_boss', phase: 1 })]);
    // Transition: invulnerable for its seconds.
    expect(b.weakPoints).toHaveLength(1);
    expect(strike(w, b.weakPoints[0] as Entity, 30)).toBe(0);
    w.run(Math.round(1 * HZ));
    // The bark turns every blow; the knot takes it.
    expect(strike(w, b.entity, 30)).toBe(0);
    const h = b.health;
    expect(strike(w, b.weakPoints[0] as Entity, 30)).toBeGreaterThan(0);
    expect(b.health).toBeLessThan(h);
    // The leaf storm.
    let storm = false;
    for (let i = 0; i < 3 * HZ && !storm; i++) storm = eventsOf(w.run(1), 'bossAttack').length > 0;
    expect(storm).toBe(true);
    const p = w.pos();
    expect(w.bosses.stormAt(0, p.x, p.y, w.sim.tick)).toBe(B.leafStormSight);
    // Phase 3 by damage: fire doubled; the arena burns, a player in a patch catches fire.
    while (b.phase < 2) strike(w, b.weakPoints[0] as Entity, 200);
    expect(b.phase).toBe(2);
    w.run(Math.round(1 * HZ));
    const view = createCombatantView();
    w.bosses.targets.view(w.sim, b.entity, view);
    expect(view.resist.feuer).toBe(-1);
    let burning = false;
    for (let i = 0; i < 3 * HZ && !burning; i++) burning = eventsOf(w.run(1), 'bossAttack').length > 0;
    expect(burning).toBe(true);
    const a = w.bosses.arena(w.sim, 'probe_boss');
    const patch = a?.burnTiles[0];
    if (patch === undefined) throw new Error('no burning patch');
    w.goTo(patch.tx - OFFSET, patch.ty - OFFSET);
    w.run(HZ + 1);
    expect(w.life.conditions.has('brennen')).toBe(true);
  });

  it('Beschwörung: Diener als eigene Kreaturen des Bosses, nie mehr als erlaubt; sie zerfallen beim Reset', () => {
    const summon = { id: 'diener', art: 'beschwoerung', kreatur: 'zweigling', anzahl: 2, maxGleichzeitig: 3, gewicht: 1, abklingSekunden: 0.5, clip: 'beschwoeren' } as const;
    const w = leuchtfeuerWelt({ bosses: [probeBoss([{ id: 'eins', abLebensanteil: 1, verwundbar: 'koerper', tempo: 1, uebergangSekunden: 0, angriffe: [summon] }, { id: 'zwei', abLebensanteil: 0.5, verwundbar: 'koerper', tempo: 1, uebergangSekunden: 0, angriffe: [LINE] }, { id: 'drei', abLebensanteil: 0.2, verwundbar: 'koerper', tempo: 1, uebergangSekunden: 0, angriffe: [LINE] }])] });
    enter(w);
    w.run(TITLE + 8 * HZ);
    expect(w.creatures.countOwned('boss:probe_boss')).toBe(3);
    const ev = w.run(1, [{ type: 'boss.debug', boss: 'probe_boss', aktion: 'zuruecksetzen' }]);
    expect(eventsOf(ev, 'bossReset')).toEqual([expect.objectContaining({ grund: 'debug' })]);
    expect(w.creatures.countOwned('boss:probe_boss')).toBe(0);
  });

  it('Tod des Spielers → Reset (voll geheilt, offen); Wiedereinstieg „Vor der Arena“ draußen auf der Seite der Stätte', () => {
    const w = leuchtfeuerWelt();
    enter(w);
    w.run(TITLE + 1);
    const b = w.bosses.state('borkenvater');
    strike(w, b.entity, 200);
    expect(b.health).toBeLessThan(1600);
    const died = w.run(2, [{ type: 'death.kill' }]);
    expect(eventsOf<{ spots: string[] }>(died, 'playerDied')[0]?.spots[0]).toBe('arena');
    expect(eventsOf(died, 'bossReset')).toEqual([expect.objectContaining({ boss: 'borkenvater', grund: 'tod' })]);
    expect(b).toMatchObject({ state: 'schlafend', health: 1600, sealed: false });
    expect(w.bosses.blocksTile(0, OFFSET + ARENA.x, OFFSET + ARENA.y + ARENA_RADIUS)).toBe(false);
    const back = w.run(1, [{ type: 'death.respawn', at: 'arena' }]);
    expect(eventsOf(back, 'playerRespawned')).toEqual([expect.objectContaining({ at: 'arena' })]);
    const p = w.pos();
    const dy = p.y / 16 - (OFFSET + ARENA.y + 0.5);
    expect(dy).toBeGreaterThan(ARENA_RADIUS);
    expect(Math.abs(p.x / 16 - (OFFSET + ARENA.x + 0.5))).toBeLessThan(2);
    // Standing outside, nothing wakes.
    w.run(10);
    expect(w.bosses.awake()).toBeNull();
  });

  it('Flucht aus der Arena → Reset „verlassen“', () => {
    const w = leuchtfeuerWelt();
    enter(w);
    w.run(5);
    const ev = w.goTo(ARENA.x, ARENA.y + ARENA_RADIUS + B.leaveMarginTiles + 2);
    expect(eventsOf(ev, 'bossReset')).toEqual([expect.objectContaining({ grund: 'verlassen' })]);
    expect(w.bosses.state('borkenvater')).toMatchObject({ state: 'schlafend', sealed: false });
  });

  it('Sieg: einzigartige Drops, Trophäe, Herzsplitter und der Rest; Arena offen, Stamm fort, bossDefeated einmal', () => {
    const w = leuchtfeuerWelt();
    enter(w);
    w.run(TITLE + 1);
    const b = w.bosses.state('borkenvater');
    let n = 0;
    const view = createCombatantView();
    while (b.state === 'erwacht' && n++ < 400) {
      const target = b.phase === 1 ? (b.weakPoints[0] as Entity) : b.entity;
      if (w.bosses.targets.view(w.sim, target, view) && view.invulnerable) w.run(1);
      else strike(w, target, 120, 'feuer');
    }
    expect(b.state).toBe('besiegt');
    // The blows fell between the steps: their events come with the next one – one victory.
    const ev = w.run(1);
    expect(eventsOf(ev, 'bossDefeated')).toHaveLength(1);
    expect(eventsOf(w.run(1), 'bossDefeated')).toHaveLength(0);
    const items = w.dropped.map((d) => d.stack.item);
    for (const id of ['kernholz', 'trophaee_borkenvater', 'herzsplitter', 'borkenharz', 'lumen_scherbe']) expect(items, id).toContain(id);
    const count = (id: string): number => w.dropped.filter((d) => d.stack.item === id).reduce((s, d) => s + d.stack.count, 0);
    expect(count('borkenharz')).toBeGreaterThanOrEqual(3);
    expect(count('borkenharz')).toBeLessThanOrEqual(5);
    expect(b.sealed).toBe(false);
    expect(b.entity).toBe(NULL_ENTITY);
    expect(w.bosses.blocksTile(0, OFFSET + ARENA.x, OFFSET + ARENA.y)).toBe(false);
    expect(w.bosses.defeated('borkenvater')).toBe(true);
    // Defeated stays defeated: the arena wakes nothing.
    enter(w);
    expect(w.bosses.awake()).toBeNull();
  });

  it('Beschwörung am Altar: ohne Opfergabe abgelehnt, außerhalb der Arena abgelehnt, mit ihr erwacht der Boss und die Gabe ist fort', () => {
    const phases = BORKENVATER.phasen;
    const w = leuchtfeuerWelt({ bosses: [probeBoss(phases, { art: 'beschwoerung', item: 'kernholz' })] });
    w.goTo(ARENA.x, ARENA.y + 4);
    w.run(5);
    expect(w.bosses.awake()).toBeNull();
    expect(w.rejections(w.run(1, [{ type: 'boss.summon', boss: 'probe_boss' }]))).toEqual(['missingItem']);
    w.inventory.give(w.sim, 'kernholz', 1);
    w.goTo(ARENA.x, ARENA.y + ARENA_RADIUS + 4);
    expect(w.rejections(w.run(1, [{ type: 'boss.summon', boss: 'probe_boss' }]))).toEqual(['notInArena']);
    w.goTo(ARENA.x, ARENA.y + 4);
    const ev = w.run(1, [{ type: 'boss.summon', boss: 'probe_boss' }]);
    expect(eventsOf(ev, 'bossAwakened')).toHaveLength(1);
    expect(w.inventory.count('kernholz')).toBe(0);
    expect(w.rejections(w.run(1, [{ type: 'boss.summon', boss: 'unbekannt' }]))).toEqual(['unknownBoss']);
  });

  it('Spawnsperre in der Arena; ohne Arena (Welt noch nicht da) schläft der Boss und weckt nichts', () => {
    const w = leuchtfeuerWelt();
    expect(w.bosses.arenaAt(0, OFFSET + ARENA.x, OFFSET + ARENA.y)).toBeNull();
    w.run(1);
    expect(w.bosses.arenaAt(0, OFFSET + ARENA.x + 3, OFFSET + ARENA.y)).toBe('borkenvater');
    expect(w.bosses.arenaAt(0, OFFSET + ARENA.x, OFFSET + ARENA.y + ARENA_RADIUS + 2)).toBeNull();
    const none = leuchtfeuerWelt({ arena: false });
    none.goTo(ARENA.x, ARENA.y);
    none.run(3);
    expect(none.bosses.awake()).toBeNull();
    expect(none.rejections(none.run(1, [{ type: 'boss.debug', boss: 'borkenvater', aktion: 'wecken' }]))).toEqual(['noArena']);
  });
});
