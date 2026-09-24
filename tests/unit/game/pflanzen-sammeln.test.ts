/**
 * M3-13 Pflanzen sammeln (MASTERPROMPT §14 "Fasergras, Beerensträucher (saisonal, nachwachsend),
 * Kräuter, Pilze (Ort und Tageszeit), Schilf, Kakteen (Stacheln), Blumen (Farbstoffe)"): picked by hand in
 * half a second (reeds need a sickle, cacti an axe), what a plant yields depends on the season, bushes
 * stand bare until they carry again, picked plants come back after their days – mushrooms only in the
 * cool hours of evening and morning, glowcaps under ground at any hour.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { NO_REGROW_TICK } from '../../../src/world/model/chunk';
import { MINUTES_PER_DAY } from '../../../src/engine/time';
import { inHourWindow, isRipe, regrowTick } from '../../../src/game/gathering/formulas';
import { STAGE_HARVESTED } from '../../../src/game/gathering/objectState';
import { field, gatherWorld, type GatherWorld } from './interaktion-testwelt';

const TICK_HZ = BALANCE.time.tickHz;
const G = BALANCE.gathering;
const M = BALANCE.harvest.mushrooms;
const drops = (id: string) => CONTENT.collection('worldObjects').get(id).drops ?? [];

function work(w: GatherWorld, max = 300): Map<string, unknown[]> {
  const ev = w.runUntil(() => !w.interaction.working, max, [{ type: 'player.interact', on: true }]);
  w.run(1, [{ type: 'player.interact', on: false }]);
  return ev;
}

/** A plant at map (4, 3), the player right below it. */
function plantWorld(ch: string): GatherWorld {
  const w = gatherWorld(field(10, 10, ['', '', '', `....${ch}`]));
  w.place(4, 4);
  w.body().facing = 'up';
  return w;
}

describe('Saison-Regeln', () => {
  it('a berry bush carries wild strawberries in spring, raspberries and blueberries in summer, blueberries in autumn, nothing in winter', () => {
    const bush = drops('busch_beeren');
    expect(['fruehling', 'sommer', 'herbst', 'winter'].map((s) => isRipe(bush, 'abbau', s as 'fruehling'))).toEqual([true, true, true, false]);
    // A hazel still gives its twigs in winter; herbs and flowers rest.
    expect(isRipe(drops('busch_hasel'), 'abbau', 'winter')).toBe(true);
    expect(isRipe(drops('pflanze_kraeuter'), 'abbau', 'winter')).toBe(false);
    expect(isRipe(drops('deko_blumen'), 'abbau', 'winter')).toBe(false);
    expect(isRipe(drops('deko_pilze'), 'abbau', 'fruehling')).toBe(false);
    expect(isRipe(drops('deko_pilze'), 'abbau', 'herbst')).toBe(true);
    expect(isRipe(drops('pflanze_fasergras'), 'abbau', 'winter')).toBe(true);
  });

  it('picking a berry bush in spring yields wild strawberries and leaves it bare for 3 days', () => {
    const w = plantWorld('B');
    w.run(1);
    expect(w.interaction.focus).toMatchObject({ kind: 'object', subject: 'busch_beeren', action: 'pfluecken', byHand: true, block: null });
    const ev = work(w);
    const picked = (ev.get('harvested') as { tick: number; xp: string }[])[0];
    expect(picked).toMatchObject({ xp: 'pflanze_gesammelt' });
    const { chunk, i } = w.at(4, 3);
    expect(chunk.objectState.get(i)).toMatchObject({ growth: STAGE_HARVESTED, regrowAtTick: (picked?.tick ?? 0) + G.bushRegrowDays * w.sim.clock.ticksPerDay });
    w.collect();
    expect(w.inventory.count('walderdbeeren')).toBeGreaterThanOrEqual(2);
    expect(w.inventory.count('himbeeren')).toBe(0);
    // Bare: pressing E again is refused.
    const again = w.run(2, [{ type: 'player.interact', on: true }]);
    expect(again.get('commandRejected')).toEqual([expect.objectContaining({ reason: 'regrowing' })]);
    w.run(1, [{ type: 'player.interact', on: false }]);
    w.sim.skipTicks(G.bushRegrowDays * w.sim.clock.ticksPerDay);
    const back = w.run(TICK_HZ);
    expect(back.get('objectRegrown')).toEqual([expect.objectContaining({ object: 'busch_beeren' })]);
    expect(chunk.objectState.get(i)).toBeUndefined();
  });

  it('in winter the bush is refused as not ripe; in summer it gives summer berries', () => {
    const winter = plantWorld('B');
    winter.season('winter');
    const refused = winter.run(2, [{ type: 'player.interact', on: true }]);
    expect(refused.get('commandRejected')).toEqual([expect.objectContaining({ type: 'player.interact', reason: 'notRipe' })]);
    expect(winter.interaction.focus.block).toBe('notRipe');
    const summer = plantWorld('B');
    summer.season('sommer');
    work(summer);
    summer.collect();
    expect(summer.inventory.count('himbeeren') + summer.inventory.count('blaubeeren')).toBeGreaterThanOrEqual(2);
    expect(summer.inventory.count('walderdbeeren')).toBe(0);
  });

  it('herbs train "Sammeln & Kräuter" as herbs; flowers only in their season', () => {
    const herbs = plantWorld('Q');
    herbs.season('sommer');
    const ev = work(herbs);
    expect(ev.get('harvested')).toEqual([expect.objectContaining({ target: 'pflanze_kraeuter', xp: 'kraut_gesammelt' })]);
    const flowers = plantWorld('L');
    flowers.season('sommer');
    work(flowers);
    flowers.collect();
    expect(flowers.inventory.count('blume_rot') + flowers.inventory.count('blume_gelb') + flowers.inventory.count('blume_blau')).toBeGreaterThan(0);
    // Scatter never comes back.
    expect(flowers.objectAt(4, 3)).toBe('');
    expect(flowers.gathering.regrowingCount).toBe(0);
  });
});

describe('Fasergras', () => {
  it('is picked by hand in half a second, yields fibres, leaves the tile and is back after 2 days', () => {
    const w = plantWorld('F');
    const ev = work(w);
    const started = (ev.get('actionStarted') as { tick: number }[])[0]?.tick ?? 0;
    const done = (ev.get('harvested') as { tick: number }[])[0]?.tick ?? 0;
    expect(done - started).toBe(BALANCE.harvest.handPickSeconds * TICK_HZ);
    expect(w.objectAt(4, 3)).toBe('');
    w.collect();
    expect(w.inventory.count('fasern')).toBeGreaterThanOrEqual(1);
    const t = w.tile(4, 3);
    expect(w.gathering.regrowAt(0, t.tx, t.ty)).toBe(done + G.plantRegrowDays * w.sim.clock.ticksPerDay);
    w.sim.skipTicks(G.plantRegrowDays * w.sim.clock.ticksPerDay);
    w.run(TICK_HZ);
    expect(w.objectAt(4, 3)).toBe('pflanze_fasergras');
  });

  it('while E stays held the player picks one plant after the other, never the same twice', () => {
    const w = gatherWorld(field(10, 10, ['', '', '', '...FFF']));
    w.place(4, 4);
    w.body().facing = 'up';
    const ev = w.run(TICK_HZ * 3, [{ type: 'player.interact', on: true }]);
    w.run(1, [{ type: 'player.interact', on: false }]);
    expect((ev.get('harvested') ?? []).length).toBe(3);
    expect([w.objectAt(3, 3), w.objectAt(4, 3), w.objectAt(5, 3)]).toEqual(['', '', '']);
    expect((ev.get('commandRejected') ?? []).length).toBe(0);
  });
});

describe('Pilze (Ort und Tageszeit)', () => {
  it('the window 18:00–10:00 wraps past midnight', () => {
    const window = { fromHour: M.fromHour, toHour: M.toHour };
    expect(inHourWindow(18 * 60, window)).toBe(true);
    expect(inHourWindow(2 * 60, window)).toBe(true);
    expect(inHourWindow(9 * 60 + 59, window)).toBe(true);
    expect(inHourWindow(10 * 60, window)).toBe(false);
    expect(inHourWindow(12 * 60, window)).toBe(false);
    expect(inHourWindow(8 * 60, { fromHour: 6, toHour: 9 })).toBe(true);
  });

  it('regrowTick: a mushroom picked at noon is back two days later at 18:00, one picked at night after exactly two days', () => {
    const day = 86_400;
    const minute = day / MINUTES_PER_DAY;
    const window = { fromHour: M.fromHour, toHour: M.toHour };
    expect(regrowTick(1000, 2, day, 12 * 60, window)).toBe(1000 + 2 * day + 6 * 60 * minute);
    expect(regrowTick(1000, 2, day, 22 * 60, window)).toBe(1000 + 2 * day);
    expect(regrowTick(1000, 2, day, 9 * 60 + 30, window)).toBe(1000 + 2 * day);
    // Without a window (glowcaps under ground, every other plant): exactly the days.
    expect(regrowTick(1000, 2, day, 12 * 60, null)).toBe(1000 + 2 * day);
  });

  it('a porcini picked at noon in summer grows back in the evening of its regrow day, not at noon', () => {
    const w = plantWorld('P');
    w.season('sommer');
    // Noon: six hours after the 06:00 start of the day.
    w.sim.skipTicks(6 * w.sim.clock.ticksPerGameHour);
    expect(w.sim.clock.hour).toBe(12);
    const ev = work(w);
    const t = w.tile(4, 3);
    const due = w.gathering.regrowAt(0, t.tx, t.ty);
    const picked = (ev.get('harvested') as { tick: number }[])[0]?.tick ?? 0;
    expect(due).toBeGreaterThan(picked + G.plantRegrowDays * w.sim.clock.ticksPerDay);
    w.sim.skipTicks(picked + G.plantRegrowDays * w.sim.clock.ticksPerDay - w.sim.tick + TICK_HZ);
    w.run(TICK_HZ);
    expect(w.objectAt(4, 3)).toBe('');
    w.sim.skipTicks(due - w.sim.tick);
    expect(w.sim.clock.hour).toBe(M.fromHour);
    w.run(TICK_HZ);
    expect(w.objectAt(4, 3)).toBe('pflanze_steinpilz');
  });

  it('a mushroom cluster on the ground only has chanterelles and fly agarics in summer and autumn', () => {
    const w = plantWorld('U');
    const spring = w.run(2, [{ type: 'player.interact', on: true }]);
    expect(spring.get('commandRejected')).toEqual([expect.objectContaining({ reason: 'notRipe' })]);
  });
});

describe('Schilf und Kakteen', () => {
  it('reeds need a sickle, cacti an axe; by hand the press names the tool', () => {
    const reed = plantWorld('Z');
    const refused = reed.run(2, [{ type: 'player.interact', on: true }]);
    expect(refused.get('commandRejected')).toEqual([expect.objectContaining({ reason: 'needsTool' })]);
    expect(reed.interaction.focus).toMatchObject({ block: 'needsTool', needs: 'sichel' });
    reed.run(1, [{ type: 'player.interact', on: false }]);
    reed.hold('probe_sichel');
    const cut = work(reed);
    expect(cut.get('harvested')).toEqual([expect.objectContaining({ target: 'pflanze_schilf', action: 'schneiden' })]);
    const cactus = plantWorld('Y');
    cactus.run(1);
    expect(cactus.interaction.focus).toMatchObject({ block: 'needsTool', needs: 'axt' });
    cactus.hold('probe_steinaxt');
    cactus.run(1);
    expect(cactus.interaction.focus).toMatchObject({ subject: 'pflanze_kaktus', action: 'schneiden', block: null, hitsTotal: 5 });
  });

  it('thorny bushes of later biomes are too hard for T0 tools', () => {
    const w = plantWorld('N');
    w.hold('probe_sichel');
    w.run(1);
    expect(w.interaction.focus).toMatchObject({ subject: 'busch_dornbusch', tooWeak: true });
    expect(w.gathering.regrowAt(0, w.tile(4, 3).tx, w.tile(4, 3).ty)).toBe(NO_REGROW_TICK);
  });
});
