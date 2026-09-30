/**
 * Die Schattenbrut-Grundfamilie im Kampf (M6-26, M6-15b, M6-29b; MASTERPROMPT §20.1 „Schleicher, Kriecher (hält fest),
 * Speier (Fernkampf) … Lichtfresser“, §12.4 „Der Lichtfresser löscht Fackeln und Laternen im Umkreis von 4 Tiles und saugt
 * Lumen-Ladungen ab“, §12.3 Nachtmahr; docs/SPIEL.md §10, §11):
 * - Speier: sein Spucken ist ein Kreatur-Geschoss des Kampfsystems (`CombatSystem.fireShot`) – es fliegt langsam, trifft
 *   mit Gift, geht an einem ausweichenden Spieler vorbei und übersteht Speichern und Laden;
 * - Kriecher: sein Packen hält den Spieler fest (keine Bewegung, keine Rolle), er beißt in Abständen; ein Treffer, ein
 *   Taumeln oder die Zeit lösen den Griff; ein geblockter Griff hält nicht;
 * - Lichtfresser: sein Saugen reicht jedem Lichtfresser-Haken den Kreis von 4 Kacheln und die Lumen-Ladung; das Lichtsystem
 *   löscht darin getragene und gesetzte Fackeln und Laternen – Feuer und Fackeln außerhalb brennen weiter;
 * - der Nachtmahr (M6-29b): besiegt sinkt die Furcht um `defeatFearRelief`, er kommt nicht sofort wieder;
 * - Biom-Varianten: im Nebelmoor erscheint die Moor-Variante mit ihren Vielfachen.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { NULL_ENTITY, type Entity } from '../../../src/engine/ecs';
import { grabBiteDue, grabHoldTicks, holdingPlayer, windupTicks } from '../../../src/game/creatures/formulas';
import type { SimEventMap } from '../../../src/game/sim';
import { TILE_PX } from '../../../src/world/model/coords';
import { eventsOf } from './kampf-testwelt';
import { kreaturWelt, meadow, type KreaturWelt } from './kreatur-testwelt';
import { lightWorld } from './licht-testwelt';

const HZ = BALANCE.time.tickHz;
type Telegraph = SimEventMap['creatureTelegraph'];

/** A dark night on an open field, the player lit (seen twice as far) at map tile (20, 15). */
function nacht(): KreaturWelt {
  const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
  w.cenv.phase = 'nacht';
  w.light.ambient = 0.05;
  w.light.lit = true;
  return w;
}

/** Runs until creature `e` telegraphs attack `angriff` (at most `max` ticks); returns the telegraph. */
function untilTelegraph(w: KreaturWelt, e: Entity, angriff: string, max = 20 * HZ): Telegraph {
  for (let i = 0; i < max; i++) {
    const t = eventsOf<Telegraph>(w.run(1), 'creatureTelegraph').find((x) => x.entity === e && x.angriff === angriff);
    if (t !== undefined) return t;
  }
  throw new Error(`no telegraph ${angriff}`);
}

function speier() {
  const a = CONTENT.collection('creatures').get('speier').angriffe.find((x) => x.name === 'spucken');
  if (a?.geschoss === undefined) throw new Error('speier spits');
  return { a, g: a.geschoss };
}

describe('Speier: Fernkampf über das Geschoss-System (M6-15b)', () => {
  it('spuckt nach dem Telegraph ein Kreatur-Geschoss, das langsam fliegt und mit Gift trifft', () => {
    const w = nacht();
    const { a, g } = speier();
    // North of the player (it faces south when it appears): five tiles away.
    const e = w.creature('speier', 20, 10);
    const t = untilTelegraph(w, e, 'spucken');
    expect(t.ticks).toBe(windupTicks(a, 'normal'));
    const health = w.vit().health;
    let fired: SimEventMap['projectileFired'] | undefined;
    for (let i = 0; i < t.ticks + 2 && fired === undefined; i++) fired = eventsOf<SimEventMap['projectileFired']>(w.run(1), 'projectileFired')[0];
    expect(fired).toMatchObject({ owner: e, item: g.sprite });
    expect(Math.hypot(fired?.vx ?? 0, fired?.vy ?? 0)).toBeCloseTo(g.geschwindigkeit, 5);
    expect(w.combat.projectiles.size).toBe(1);
    expect(w.combat.projectileItem(0)).toBe('geschoss_spucken');
    let hit: SimEventMap['projectileHit'] | undefined;
    for (let i = 0; i < HZ && hit === undefined; i++) hit = eventsOf<SimEventMap['projectileHit']>(w.run(1), 'projectileHit')[0];
    expect(hit?.target).toBe(w.sim.player);
    expect(w.vit().health).toBeLessThan(health);
    // The glob leaves nothing where it stops.
    expect(w.landed).toEqual([]);
    expect(w.combat.projectiles.size).toBe(0);
  });

  it('ein Spieler, der zur Seite geht, lässt das Geschoss vorbeifliegen', () => {
    const w = nacht();
    w.cheats.god = false;
    const e = w.creature('speier', 20, 10);
    const t = untilTelegraph(w, e, 'spucken');
    // Out of the aim while it winds up: sideways, three tiles.
    w.run(t.ticks + 1, [{ type: 'player.move', dx: 1, dy: 0 }]);
    w.run(1, [{ type: 'player.move', dx: 0, dy: 0 }]);
    const hits: SimEventMap['projectileHit'][] = [];
    for (let i = 0; i < 2 * HZ; i++) hits.push(...eventsOf<SimEventMap['projectileHit']>(w.run(1), 'projectileHit'));
    expect(hits.filter((h) => h.target === w.sim.player)).toEqual([]);
  });

  it('ein fliegendes Geschoss übersteht Speichern und Laden', () => {
    const w = nacht();
    const e = w.creature('speier', 20, 10);
    const t = untilTelegraph(w, e, 'spucken');
    w.run(t.ticks + 1);
    expect(w.combat.projectiles.size).toBe(1);
    const participant = w.sim.participant('combat');
    const data = participant.serialize();
    participant.deserialize(JSON.parse(JSON.stringify(data)));
    expect(w.combat.projectileItem(0)).toBe('geschoss_spucken');
    expect(JSON.stringify(participant.serialize())).toBe(JSON.stringify(data));
  });

  it('er hält Abstand: kommt der Spieler zu nah, weicht er zurück', () => {
    const w = nacht();
    w.cheats.god = true;
    const e = w.creature('speier', 20, 13);
    let retreat = false;
    for (let i = 0; i < 3 * HZ && !retreat; i++) {
      w.run(1);
      retreat = w.state(e).state === 'rueckzug';
    }
    expect(retreat).toBe(true);
  });
});

describe('Kriecher: hält fest (M6-26)', () => {
  const packen = CONTENT.collection('creatures').get('kriecher').angriffe[0];
  const grab = packen?.festhalten;

  /** The Kriecher right next to the player, until its grab lands; returns the world, its entity and the landing tick. */
  function gepackt(): { w: KreaturWelt; e: Entity } {
    const w = nacht();
    // The game binds the grab as a motion hold of the player (src/game/setup.ts); the test world does it here.
    w.player.addMotionHold(w.creatures.holdsPlayer);
    const e = w.creature('kriecher', 20, 14);
    const t = untilTelegraph(w, e, 'packen');
    w.run(t.ticks);
    return { w, e };
  }

  it('der Griff hält den Spieler: keine Bewegung, keine Rolle, Bisse in Abständen', () => {
    expect(grab).toBeDefined();
    if (grab === undefined) return;
    const { w, e } = gepackt();
    expect(holdingPlayer(w.state(e), CONTENT.collection('creatures').get('kriecher').angriffe, w.sim.tick)).toBe(true);
    expect(w.creatures.holdsPlayer(w.sim)).toBe(true);
    const p = w.pos();
    const rolled = w.run(1, [{ type: 'player.roll', dx: 1, dy: 0 }]);
    expect(eventsOf<SimEventMap['commandRejected']>(rolled, 'commandRejected').some((r) => r.type === 'player.roll')).toBe(true);
    const health = w.vit().health;
    const bites: SimEventMap['creatureAttack'][] = [];
    for (let i = 0; i < grabHoldTicks(grab) - 2; i++) bites.push(...eventsOf<SimEventMap['creatureAttack']>(w.run(1, i === 0 ? [{ type: 'player.move', dx: 1, dy: 0 }] : undefined), 'creatureAttack'));
    // Held: only the bites' knockback nudges the player (walking would have carried it ten tiles).
    expect(Math.hypot(w.pos().x - p.x, w.pos().y - p.y)).toBeLessThan(TILE_PX);
    expect(bites.filter((b) => b.entity === e)).toHaveLength(grab.bisse);
    expect(w.vit().health).toBeLessThan(health);
    // Its time runs out: the player walks again.
    w.run(4);
    expect(w.creatures.holdsPlayer(w.sim)).toBe(false);
    w.run(10, [{ type: 'player.move', dx: 1, dy: 0 }]);
    expect(w.pos().x).toBeGreaterThan(p.x + 4);
  });

  it('ein Treffer löst den Griff', () => {
    const { w, e } = gepackt();
    expect(w.creatures.holdsPlayer(w.sim)).toBe(true);
    w.hold('probe_schwert');
    const at = w.where(e);
    const p = w.pos();
    w.aimBy(at.x - p.x, at.y - p.y);
    // The grab's blow staggered the player: it strikes as soon as it can (a press every tenth of a second).
    let freed = false;
    for (let i = 0; i < HZ && !freed; i++) {
      const press = i % 6;
      w.run(1, press === 0 ? [{ type: 'combat.attack', on: true }] : press === 1 ? [{ type: 'combat.attack', on: false }] : undefined);
      freed = !w.creatures.holdsPlayer(w.sim);
    }
    expect(freed).toBe(true);
    expect(w.state(e).health).toBeLessThan(w.state(e).maxHealth);
  });

  it('die Bisse verteilen sich gleichmäßig über den Griff', () => {
    if (grab === undefined) throw new Error('kriecher grabs');
    const due = Array.from({ length: grabHoldTicks(grab) + 1 }, (_, t) => grabBiteDue(grab, t)).filter(Boolean).length;
    expect(due).toBe(grab.bisse);
    expect(grabBiteDue(grab, 0)).toBe(false);
    // No bite beyond the last: the count stays the same however long one asks.
    const later = Array.from({ length: 3 * grabHoldTicks(grab) }, (_, t) => grabBiteDue(grab, t)).filter(Boolean).length;
    expect(later).toBe(grab.bisse);
  });
});

describe('Lichtfresser: löscht Fackeln und Laternen im Umkreis von 4 Kacheln (M6-26, §12.4)', () => {
  it('sein Saugen reicht den Lichtfresser-Haken seinen Ort, 4 Kacheln und eine Lumen-Ladung', () => {
    const w = nacht();
    w.cheats.god = true;
    const calls: { x: number; y: number; r: number; lumen: number }[] = [];
    w.creatures.addLightEater((_s, _layer, x, y, r, lumen) => {
      calls.push({ x, y, r, lumen });
      return 0;
    });
    const e = w.creature('lichtfresser', 20, 12);
    const t = untilTelegraph(w, e, 'saugen');
    expect(t.flaeche?.radius).toBe(4 * TILE_PX);
    w.run(t.ticks + 1);
    expect(calls).toHaveLength(1);
    const at = w.where(e);
    expect(calls[0]).toMatchObject({ r: 4 * TILE_PX, lumen: 1 });
    expect(Math.hypot((calls[0]?.x ?? 0) - at.x, (calls[0]?.y ?? 0) - at.y)).toBeLessThan(1);
  });

  it('ein Treffer im Ausholen bricht das Saugen ab: kein Licht erlischt', () => {
    const w = nacht();
    w.cheats.god = true;
    let calls = 0;
    w.creatures.addLightEater(() => ++calls);
    const e = w.creature('lichtfresser', 20, 14);
    untilTelegraph(w, e, 'saugen');
    w.hold('probe_keule');
    const at = w.where(e);
    const p = w.pos();
    w.aimBy(at.x - p.x, at.y - p.y);
    w.run(1, [{ type: 'combat.attack', on: true }]);
    w.run(HZ, [{ type: 'combat.attack', on: false }]);
    expect(calls).toBe(0);
  });

  it('das Lichtsystem löscht darin die getragene Fackel und gesetzte Fackeln; weiter weg und Feuer brennen weiter', () => {
    const w = lightWorld(meadow(40, 30));
    w.spawn(20, 15);
    w.give('fackel', 4);
    w.give('lagerfeuer', 1);
    w.give('holz', 4);
    w.equipTorch();
    w.step(1, [{ type: 'light.toggle' }]);
    const near = w.place('fackel', 22, 15);
    const far = w.place('fackel', 27, 15);
    const fire = w.place('lagerfeuer', 19, 15);
    w.step(1, [{ type: 'light.fuel', light: fire, from: w.slotOf('holz'), count: 2 }]);
    const ft = w.tile(19, 15);
    w.step(1, [{ type: 'light.ignite', tx: ft.tx, ty: ft.ty }]);
    expect(w.light.carried?.burn.lit).toBe(true);
    expect(w.light.placed(fire)?.fire?.lit).toBe(true);
    const p = w.pos();
    // The light eater a tile north of the player: its circle of 4 tiles reaches the player, the near torch and the fire.
    const out = w.light.putOutNear(w.sim, 0, p.x, p.y - TILE_PX, 4 * TILE_PX, 'lichtfresser');
    expect(out).toBe(2);
    expect(w.light.carried?.burn.lit).toBe(false);
    expect(w.light.placed(near)?.torch?.lit).toBe(false);
    expect(w.light.placed(far)?.torch?.lit).toBe(true);
    expect(w.light.placed(fire)?.fire?.lit).toBe(true);
    const ev = w.sim.events;
    ev.drain(() => undefined);
    // They light again like any light put out.
    w.step(1, [{ type: 'light.toggle' }]);
    expect(w.light.carried?.burn.lit).toBe(true);
  });
});

describe('Nachtmahr: nach dem Sieg nicht sofort wieder (M6-29b)', () => {
  it('besiegt sinkt die Furcht um defeatFearRelief; bei Furcht 100 im Dunkel kommt er erst nach dieser Zeit wieder', () => {
    const w = kreaturWelt(meadow(60, 50), { x: 30, y: 25 });
    w.cenv.phase = 'nacht';
    w.light.ambient = 0.05;
    w.cheats.god = true;
    w.run(2, [{ type: 'fear.set', value: BALANCE.fear.max }]);
    const mare = w.creatures.nightmareEntity;
    expect(mare).not.toBe(NULL_ENTITY);
    const ev = w.run(1, [{ type: 'creature.kill', radius: 30 }]);
    expect(eventsOf<SimEventMap['nightmareEnded']>(ev, 'nightmareEnded')[0]?.reason).toBe('besiegt');
    expect(eventsOf<SimEventMap['fearChanged']>(ev, 'fearChanged')[0]).toMatchObject({ reason: 'nachtmahr' });
    expect(w.life.fear.state.value).toBeCloseTo(BALANCE.fear.max - BALANCE.creatures.nightmare.defeatFearRelief, 0);
    expect(w.life.fear.pursued).toBe(false);
    // In the dark fear climbs again at +1/s: no Nachtmahr for 30 s.
    const summoned: unknown[] = [];
    for (let s = 0; s < 30; s++) summoned.push(...eventsOf(w.run(HZ), 'nightmareSummoned'));
    expect(summoned).toEqual([]);
    expect(w.creatures.nightmareEntity).toBe(NULL_ENTITY);
  });
});

describe('Biom-Varianten der Schattenbrut (M6-25b)', () => {
  it('im Nebelmoor erscheint die Moor-Variante mit ihrem Leben', () => {
    const w = nacht();
    w.cenv.biomeId = 'nebelmoor';
    const e = w.creature('schleicher', 20, 10);
    const def = CONTENT.collection('creatures').get('schleicher');
    const v = def.varianten?.findIndex((x) => x.biome.includes('nebelmoor')) ?? -1;
    expect(v).toBeGreaterThanOrEqual(0);
    expect(w.state(e).variant).toBe(v);
    expect(w.state(e).maxHealth).toBeCloseTo(def.leben * (def.varianten?.[v]?.leben ?? 0), 5);
    const base = nacht();
    const b = base.creature('schleicher', 20, 10);
    expect(base.state(b).variant).toBe(-1);
  });
});
