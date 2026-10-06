/**
 * The beacons (M7-35, M7-36; MASTERPROMPT §8, §4.1, §11.6, §23.1; docs/SPIEL.md §22 "Leuchtfeuer"): out while the guardian
 * lives, ready once it falls, the ignition sequence, lit – unlocks of LF1, the ember core, the vision to come, the light wave
 * that washes the corruption of the site away, the zone "Erleuchtet", the beacon as an obstacle, a light and a respawn
 * point; E at it (light it, then travel). On the drawn site of leuchtfeuer-testwelt.ts.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { beaconUses } from '../../../src/game/beacons/uses';
import { createUseOffer } from '../../../src/game/interaction/uses';
import { BLOCK_OBJECT } from '../../../src/world/collision/tiles';
import { eventsOf } from './kampf-testwelt';
import { leuchtfeuerWelt, OFFSET, SITE, type LeuchtfeuerWelt } from './leuchtfeuer-testwelt';

const BE = BALANCE.beacons;
const HZ = BALANCE.time.tickHz;
const IGNITION = Math.round(BE.ignitionSeconds * HZ);
const ST = { tx: OFFSET + SITE.x, ty: OFFSET + SITE.y };

/** The Borkenvater falls (debug), the next tick the beacon is ready. */
function defeatGuardian(w: LeuchtfeuerWelt): void {
  w.run(1, [{ type: 'boss.debug', boss: 'borkenvater', aktion: 'besiegen' }]);
  w.run(1);
}

/** Lights beacon 1 in reach and runs the sequence; returns the events of the whole ignition. */
function light(w: LeuchtfeuerWelt): Map<string, unknown[]> {
  defeatGuardian(w);
  w.goTo(SITE.x, SITE.y + 2);
  return w.run(IGNITION + 1, [{ type: 'beacon.ignite', beacon: 1 }]);
}

describe('Leuchtfeuer-Content', () => {
  it('sechs Leuchtfeuer in Biom-Reihenfolge; nur das erste ist in M7 umgesetzt, jedes nennt seinen Boss, Glutkern und seine Freischaltungen', () => {
    const beacons = CONTENT.collection('beacons').values();
    expect(beacons.map((b) => b.id)).toEqual(['leuchtfeuer_1', 'leuchtfeuer_2', 'leuchtfeuer_3', 'leuchtfeuer_4', 'leuchtfeuer_5', 'leuchtfeuer_6']);
    expect(beacons.map((b) => b.umgesetzt === true)).toEqual([true, false, false, false, false, false]);
    const first = CONTENT.collection('beacons').get('leuchtfeuer_1');
    expect(first).toMatchObject({ biom: 'gruenhain', boss: 'borkenvater', glutkern: 'glutkern_1', vision: 'vision_1' });
    expect(first.freischaltungen).toEqual(['lf1_lumen_werkbank', 'lf1_lumen_laterne', 'lf1_wegsteine', 'lf1_glutkern']);
    expect(CONTENT.has('bosses', first.boss)).toBe(true);
    const vision = CONTENT.collection('visions').get('vision_1');
    expect(vision.bilder.length).toBeGreaterThanOrEqual(3);
    for (const b of vision.bilder) for (const z of b.zeilen) expect(z.de.length * z.en.length, b.sprite).toBeGreaterThan(0);
  });
});

describe('Leuchtfeuer zur Laufzeit (M7-35)', () => {
  it('erloschen, solange der Hüter lebt; bereit, sobald er fällt; außer Reichweite abgelehnt', () => {
    const w = leuchtfeuerWelt();
    w.goTo(SITE.x, SITE.y + 2);
    expect(w.beacons.state(1).state).toBe('erloschen');
    expect(w.rejections(w.run(1, [{ type: 'beacon.ignite', beacon: 1 }]))).toEqual(['notReady']);
    defeatGuardian(w);
    expect(w.beacons.state(1).state).toBe('bereit');
    expect(w.beacons.state(2).state).toBe('erloschen');
    w.goTo(SITE.x, SITE.y + BE.reachTiles + 4);
    expect(w.rejections(w.run(1, [{ type: 'beacon.ignite', beacon: 1 }]))).toEqual(['outOfReach']);
    expect(w.rejections(w.run(1, [{ type: 'beacon.ignite', beacon: 7 }]))).toEqual(['unknownBeacon']);
    // Beacons of later milestones wait for their task: debug-ready, but their boss does not exist yet.
    expect(w.rejections(w.run(1, [{ type: 'beacon.ignite', beacon: 2 }]))).toEqual(['noSite']);
  });

  it('Entzünden: Sequenz, dann entzündet – LF1-Freischaltungen (Quelle leuchtfeuer:1), Glutkern in die Taschen, Vision wartet', () => {
    const w = leuchtfeuerWelt();
    const ev = light(w);
    expect(eventsOf(ev, 'beaconIgnitionStarted')).toEqual([expect.objectContaining({ beacon: 1, biome: 'gruenhain' })]);
    const lit = eventsOf<{ tick: number }>(ev, 'beaconLit');
    expect(lit).toHaveLength(1);
    const st = w.beacons.state(1);
    expect(st.state).toBe('entzuendet');
    expect(st.litTick - st.ignitionTick).toBe(IGNITION);
    expect(eventsOf(ev, 'unlockGranted').map((u) => (u as { unlock: string }).unlock)).toEqual(['lf1_lumen_werkbank', 'lf1_lumen_laterne', 'lf1_wegsteine', 'lf1_glutkern']);
    expect(w.unlocks.granted().every((g) => g.source === 'leuchtfeuer:1')).toBe(true);
    expect(w.inventory.count('glutkern_1')).toBe(1);
    expect(w.beacons.litCount()).toBe(1);
    expect(st.visionShown).toBe(false);
    w.run(1, [{ type: 'beacon.visionSeen', beacon: 1 }]);
    expect(st.visionShown).toBe(true);
    expect(w.rejections(w.run(1, [{ type: 'beacon.ignite', beacon: 1 }]))).toEqual(['lit']);
    expect(w.rejections(w.run(1, [{ type: 'beacon.visionSeen', beacon: 2 }]))).toEqual(['notLit']);
  });

  it('volle Taschen: der Glutkern fällt vor dem Leuchtfeuer zu Boden', () => {
    const w = leuchtfeuerWelt();
    const state = w.inventory.state;
    for (const area of ['inventar', 'schnellleiste', 'rucksackfach'] as const) for (let i = 0; i < state[area].length; i++) w.inventory.give(w.sim, 'stein', 999);
    light(w);
    expect(w.inventory.count('glutkern_1')).toBe(0);
    expect(w.dropped.some((d) => d.stack.item === 'glutkern_1')).toBe(true);
  });

  it('Lichtwelle: die Verderbnis um die dunkle Stätte weicht hinter der Front, die Region heilt von 0 bis 1', () => {
    const w = leuchtfeuerWelt();
    w.run(1);
    const before = w.beacons.corruptionAt(0, ST.tx, ST.ty - 10, w.sim.tick);
    expect(before).toBeGreaterThan(0.5);
    expect(w.beacons.corruptionAt(0, ST.tx, ST.ty - BE.corruption.radiusTiles - 1, w.sim.tick)).toBe(0);
    expect(w.beacons.healing(0, w.sim.tick)).toBe(0);
    light(w);
    const lit = w.beacons.state(1).litTick;
    expect(w.beacons.healing(0, lit)).toBe(0);
    // The region's centre lies 10 tiles away: healed once the soft front has passed it.
    const passed = lit + Math.ceil(((10 + BE.waveFrontTiles) / BE.waveTilesPerSecond) * HZ);
    expect(w.beacons.healing(0, passed)).toBe(1);
    expect(w.beacons.healingAt(0, ST.tx, ST.ty - 10, passed)).toBe(1);
    expect(w.beacons.corruptionAt(0, ST.tx, ST.ty - 10, passed)).toBe(0);
    const half = lit + Math.round(((10 + BE.waveFrontTiles / 2) / BE.waveTilesPerSecond) * HZ);
    expect(w.beacons.healing(0, half)).toBeGreaterThan(0.3);
    expect(w.beacons.healing(0, half)).toBeLessThan(0.7);
    // Below ground nothing heals.
    expect(w.beacons.healingAt(-1, ST.tx, ST.ty, passed)).toBe(0);
  });

  it('Schutzzone „Erleuchtet“: im Radius der Zustand, draußen nicht; das Leuchtfeuer steht im Weg und leuchtet', () => {
    const w = leuchtfeuerWelt();
    light(w);
    expect(w.beacons.inZone(0, ST.tx + BE.zoneTiles - 1, ST.ty)).toBe(true);
    expect(w.beacons.inZone(0, ST.tx + BE.zoneTiles + 1, ST.ty)).toBe(false);
    w.run(HZ + 1);
    expect(w.life.conditions.has('erleuchtet')).toBe(true);
    // 3 × 3 footprint on the collision grid.
    w.collision.ensureTiles(0, ST.tx - 2, ST.ty - 2, ST.tx + 2, ST.ty + 2);
    expect(w.collision.grid.tileInfo(0, ST.tx + 1, ST.ty - 1) & BLOCK_OBJECT).toBe(BLOCK_OBJECT);
    expect(w.collision.grid.tileInfo(0, ST.tx + 2, ST.ty) & BLOCK_OBJECT).toBe(0);
    const lights: string[] = [];
    w.beacons.lightProvider()(w.sim, (_id, kind) => {
      lights.push(kind);
    });
    expect(lights).toEqual(['leuchtfeuer']);
  });

  it('E am Leuchtfeuer: „Entzünden“ blockiert, solange es schläft; frei, wenn bereit; danach „Reisen“', () => {
    const w = leuchtfeuerWelt();
    w.run(1);
    const uses = beaconUses(w.beacons, w.bosses, w.travel);
    const offer = createUseOffer();
    expect(uses.offer(w.sim, 0, ST.tx, ST.ty, offer)).toBe(true);
    expect(offer).toMatchObject({ action: 'entzuenden', subject: 'leuchtfeuer', block: 'leuchtfeuerSchlaeft' });
    defeatGuardian(w);
    uses.offer(w.sim, 0, ST.tx + 1, ST.ty + 1, offer);
    expect(offer).toMatchObject({ action: 'entzuenden', block: null });
    w.goTo(SITE.x, SITE.y + 2);
    uses.use(w.sim, 0, ST.tx, ST.ty, w.sim.tick);
    expect(w.beacons.state(1).state).toBe('entzuendung');
    expect(uses.offer(w.sim, 0, ST.tx, ST.ty, offer)).toBe(false);
    w.run(IGNITION + 1);
    uses.offer(w.sim, 0, ST.tx, ST.ty, offer);
    expect(offer).toMatchObject({ action: 'reisen', subject: 'leuchtfeuer', block: null });
    expect(uses.offer(w.sim, 0, ST.tx + 3, ST.ty, offer)).toBe(false);
  });

  it('Debug: bereit, entzünden, löschen – als Befehle', () => {
    const w = leuchtfeuerWelt();
    w.run(1, [{ type: 'beacon.debug', beacon: 1, aktion: 'entzuenden' }]);
    expect(w.beacons.state(1).state).toBe('entzuendet');
    w.run(1, [{ type: 'beacon.debug', beacon: 1, aktion: 'loeschen' }]);
    expect(w.beacons.state(1).state).toBe('bereit');
    expect(w.rejections(w.run(1, [{ type: 'beacon.debug', beacon: 1, aktion: 'loeschen' }]))).toEqual(['notLit']);
  });
});
