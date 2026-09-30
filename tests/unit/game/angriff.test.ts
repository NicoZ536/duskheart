/**
 * M6-02 Angriffssystem (docs/SPIEL.md §10 "Eingabe (M6-02)", "Angriffe als Daten"; MASTERPROMPT §19.1 "Leichter Angriff
 * (LMB), schwerer Angriff (halten), Block/Zielen (RMB), Rolle (Leertaste) … Reichweite, Schlagbogen, Tempo,
 * Ausdauerkosten und Stagger-Wert je Waffe"): a press winds up (next tick), released in time the light blow lands after
 * the wind-up, held past `heavyHoldSeconds` the heavy one on release; reach and swing decide who is hit; stamina, stagger,
 * hitstop, wear and experience per the weapon's data; the input routes the primary and block buttons.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CommandQueue } from '../../../src/engine/commands';
import { BindingSet } from '../../../src/engine/input/bindings';
import { ActionReader } from '../../../src/engine/input/reader';
import { InputState } from '../../../src/engine/input/state';
import { hitstopTicks, secondsToTicks, weaponDamage } from '../../../src/game/combat/formulas';
import { COMBAT_XP } from '../../../src/game/combat/system';
import { primaryRoute } from '../../../src/game/combat/weapons';
import type { GameCommand } from '../../../src/game/commands';
import { InputCommandTranslator } from '../../../src/game/input';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { ToolsSystem } from '../../../src/game/tools/system';
import { eventsOf, kampfCatalog, kampfWelt } from './kampf-testwelt';

const A = BALANCE.combat.attack;
/** The fixture sword: tempo 0,5 s, 8 damage, stamina 8, stagger 0,2 s, impact 2, reach 20 px, swing 100°. */
const SWORD = kampfCatalog().get('probe_schwert').waffe;
if (SWORD === undefined) throw new Error('probe_schwert without waffe');
const WINDUP = Math.max(1, secondsToTicks(SWORD.tempo * A.windupShare));
const RECOVERY = secondsToTicks(SWORD.tempo) - WINDUP;
const HEAVY_HOLD = secondsToTicks(A.heavyHoldSeconds);

describe('leichter Schlag', () => {
  it('der Druck holt im nächsten Tick aus; nach der Ausholzeit trifft der Schlag, was vorne in Reichweite steht', () => {
    const k = kampfWelt();
    k.hold('probe_schwert');
    k.aimBy(20, 0);
    const front = k.dummy(16, 0);
    const behind = k.dummy(-16, 0);
    const far = k.dummy(16 + SWORD.reichweite, 0);
    const first = k.run(1, [{ type: 'combat.attack', on: true }]);
    expect(eventsOf(first, 'attackWindup')).toEqual([expect.objectContaining({ entity: k.sim.player, klasse: 'schwert', schwer: false, ticks: WINDUP })]);
    expect(k.combat.state.player.phase).toBe('ausholen');
    const early = k.run(WINDUP - 2, [{ type: 'combat.attack', on: false }]);
    expect(eventsOf(early, 'attackStarted')).toEqual([]);
    expect(front.hits).toEqual([]);
    const blow = k.run(1);
    expect(eventsOf(blow, 'attackStarted')).toEqual([expect.objectContaining({ klasse: 'schwert', schwer: false, kombo: 1, reichweite: SWORD.reichweite, bogen: SWORD.bogen, item: 'probe_schwert' })]);
    expect(front.hits).toHaveLength(1);
    expect(front.hits[0]).toMatchObject({ amount: expect.closeTo(SWORD.schaden, 6), staggerTicks: secondsToTicks(SWORD.stagger), hitstopTicks: hitstopTicks(SWORD.wucht) });
    expect(behind.hits).toEqual([]);
    expect(far.hits).toEqual([]);
    expect(eventsOf(blow, 'hitLanded')).toEqual([expect.objectContaining({ attacker: k.sim.player, target: front.entity, art: 'hieb', wucht: SWORD.wucht, material: 'fell', targetTeam: 'feind' })]);
    expect(k.combat.state.player.phase).toBe('erholung');
  });

  it('Ausdauer je Schlag, Verschleiß je Treffer, Erfahrung „nahkampf_treffer“', () => {
    const k = kampfWelt();
    k.hold('probe_schwert');
    k.aimBy(20, 0);
    k.dummy(14, 0);
    const before = k.vit().stamina;
    const events = k.run(WINDUP + 1, [{ type: 'combat.attack', on: true }, { type: 'combat.attack', on: false }]);
    expect(before - k.vit().stamina).toBeCloseTo(SWORD.ausdauer, 6);
    expect(k.inventory.selected()?.haltbarkeit).toBe(59);
    expect(eventsOf(events, 'xpGained')).toEqual([expect.objectContaining({ source: COMBAT_XP.meleeHit, skill: 'nahkampf' })]);
  });

  it('ein Schlag ins Leere kostet Ausdauer, aber keine Haltbarkeit', () => {
    const k = kampfWelt();
    k.hold('probe_schwert');
    k.run(WINDUP + 1, [{ type: 'combat.attack', on: true }, { type: 'combat.attack', on: false }]);
    expect(k.inventory.selected()?.haltbarkeit).toBe(60);
    expect(k.vit().stamina).toBeCloseTo(100 - SWORD.ausdauer, 6);
  });

  it('ein Druck während der Erholung verpufft still; danach geht es weiter', () => {
    const k = kampfWelt();
    k.hold('probe_schwert');
    k.run(WINDUP + 1, [{ type: 'combat.attack', on: true }, { type: 'combat.attack', on: false }]);
    const during = k.run(1, [{ type: 'combat.attack', on: true }, { type: 'combat.attack', on: false }]);
    expect(eventsOf(during, 'commandRejected')).toEqual([]);
    expect(eventsOf(during, 'attackWindup')).toEqual([]);
    k.run(RECOVERY);
    expect(k.combat.state.player.phase).toBe('bereit');
    expect(eventsOf(k.run(1, [{ type: 'combat.attack', on: true }]), 'attackWindup')).toHaveLength(1);
  });

  it('der Gegner wird besiegt: combatantDefeated und „nahkampf_sieg“', () => {
    const k = kampfWelt();
    k.hold('probe_schwert');
    k.aimBy(20, 0);
    const d = k.dummy(14, 0, { health: 5 });
    const events = k.run(WINDUP + 1, [{ type: 'combat.attack', on: true }, { type: 'combat.attack', on: false }]);
    expect(d.health).toBe(0);
    expect(eventsOf(events, 'combatantDefeated')).toEqual([expect.objectContaining({ entity: d.entity, by: k.sim.player })]);
    expect(eventsOf(events, 'xpGained').map((e) => (e as { source: string }).source)).toEqual([COMBAT_XP.meleeHit, COMBAT_XP.meleeWin]);
  });

  it('die Faust: ohne Item schlägt die Hand (T0-Grundschaden × Faustfaktor, Wucht)', () => {
    const k = kampfWelt();
    k.aimBy(0, 20);
    const d = k.dummy(0, 12);
    const windup = Math.max(1, secondsToTicks(BALANCE.combat.fist.tempoSekunden * A.windupShare));
    k.run(windup + 1, [{ type: 'combat.attack', on: true }, { type: 'combat.attack', on: false }]);
    expect(d.hits).toHaveLength(1);
    expect(d.hits[0]?.amount).toBeCloseTo(weaponDamage(0, 'faust'), 6);
    expect(d.hits[0]?.type).toBe('wucht');
  });

  it('ein Werkzeug schlägt als behelfsmäßige Waffe: Steinaxt hackt (Hieb) mit 60 % des T0-Schadens', () => {
    const k = kampfWelt();
    k.hold('steinaxt');
    k.aimBy(20, 0);
    const d = k.dummy(14, 0);
    const T = BALANCE.combat.tool;
    k.run(Math.max(1, secondsToTicks(T.tempoSekunden * A.windupShare)) + 1, [{ type: 'combat.attack', on: true }, { type: 'combat.attack', on: false }]);
    expect(d.hits[0]).toMatchObject({ type: 'hieb', amount: expect.closeTo(weaponDamage(0, 'schwert') * T.damageFactor, 6) });
  });
});

describe('schwerer Schlag', () => {
  it(`gehalten ab ${A.heavyHoldSeconds} s trifft er beim Loslassen: Schaden, Ausdauer, Stagger, Wucht höher`, () => {
    const k = kampfWelt();
    k.hold('probe_keule');
    k.aimBy(20, 0);
    const d = k.dummy(14, 0);
    const club = kampfCatalog().get('probe_keule').waffe;
    if (club === undefined) throw new Error('no club');
    const windup = Math.max(1, secondsToTicks(club.tempo * A.windupShare));
    const charge = k.run(windup, [{ type: 'combat.attack', on: true }]);
    expect(eventsOf(charge, 'attackWindup')).toEqual([expect.objectContaining({ schwer: false }), expect.objectContaining({ schwer: true })]);
    expect(k.combat.state.player.phase).toBe('aufladen');
    expect(d.hits).toEqual([]);
    k.run(HEAVY_HOLD - windup);
    const stamina = k.vit().stamina;
    const release = k.run(1, [{ type: 'combat.attack', on: false }]);
    expect(eventsOf(release, 'attackStarted')).toEqual([expect.objectContaining({ schwer: true })]);
    expect(d.hits[0]).toMatchObject({
      amount: expect.closeTo(club.schaden * A.heavy.damageFactor, 6),
      staggerTicks: secondsToTicks(club.stagger * A.heavy.staggerFactor),
      hitstopTicks: hitstopTicks(club.wucht + A.heavy.wuchtBonus),
    });
    expect(stamina - k.vit().stamina).toBeCloseTo(club.ausdauer * A.heavy.staminaFactor, 6);
  });

  it('zu früh losgelassen wird es ein leichter Schlag (beim Loslassen)', () => {
    const k = kampfWelt();
    k.hold('probe_keule');
    k.aimBy(20, 0);
    const d = k.dummy(14, 0);
    k.run(HEAVY_HOLD - 2, [{ type: 'combat.attack', on: true }]);
    expect(d.hits).toEqual([]);
    const release = k.run(1, [{ type: 'combat.attack', on: false }]);
    expect(eventsOf(release, 'attackStarted')).toEqual([expect.objectContaining({ schwer: false })]);
    expect(d.hits).toHaveLength(1);
  });
});

describe('Hitstop in der Simulation', () => {
  it('nach einem Treffer steht der Spieler hitstopTicks still – Bewegung und Angriffstakt', () => {
    const k = kampfWelt();
    k.hold('probe_schwert');
    k.aimBy(20, 0);
    k.dummy(14, 0);
    k.run(WINDUP, [{ type: 'combat.attack', on: true }, { type: 'combat.attack', on: false }]);
    expect(k.combat.state.player.phase).toBe('erholung');
    const stop = hitstopTicks(SWORD.wucht);
    const x0 = k.pos().x;
    k.run(stop, [{ type: 'player.move', dx: 0, dy: 1 }]);
    expect(k.pos().x).toBe(x0);
    expect(k.pos().y).toBe(k.body().prevY);
    expect(k.combat.state.player.phaseTicks).toBe(0);
    expect(k.combat.frozen(k.sim.tick)).toBe(false);
    k.run(1);
    expect(k.combat.state.player.phaseTicks).toBe(1);
    expect(k.body().vy).toBeGreaterThan(0);
  });

  it('im Hitstop lehnt die Rolle ab (busy)', () => {
    const k = kampfWelt();
    k.hold('probe_schwert');
    k.aimBy(20, 0);
    k.dummy(14, 0);
    k.run(WINDUP, [{ type: 'combat.attack', on: true }, { type: 'combat.attack', on: false }]);
    expect(eventsOf(k.run(1, [{ type: 'player.roll', dx: 1, dy: 0 }]), 'commandRejected')).toEqual([expect.objectContaining({ type: 'player.roll', reason: 'busy' })]);
  });

  it('Schwingen verlangsamt das Gehen', () => {
    const free = kampfWelt();
    free.run(10, [{ type: 'player.move', dx: 0, dy: 1 }]);
    const swinging = kampfWelt();
    swinging.hold('probe_zweihand');
    swinging.run(10, [{ type: 'player.move', dx: 0, dy: 1 }, { type: 'combat.attack', on: true }]);
    const walked = free.pos().y - free.centre(10, 10).y;
    const slow = swinging.pos().y - swinging.centre(10, 10).y;
    expect(slow).toBeCloseTo(walked * A.moveFactor, 0);
  });
});

describe('Ablehnungen', () => {
  it('ohne Ausdauer, im Wasser, in der Rolle, tot – jeweils mit Grund', () => {
    const k = kampfWelt();
    k.vit().stamina = 0;
    expect(eventsOf(k.run(1, [{ type: 'combat.attack', on: true }]), 'commandRejected')).toEqual([expect.objectContaining({ type: 'combat.attack', reason: 'noStamina' })]);
    k.vit().stamina = 100;
    k.run(1, [{ type: 'player.roll', dx: 1, dy: 0 }]);
    expect(eventsOf(k.run(1, [{ type: 'combat.attack', on: true }]), 'commandRejected')).toEqual([expect.objectContaining({ reason: 'busy' })]);
    k.run(30);
    k.vit().health = 0;
    expect(eventsOf(k.run(1, [{ type: 'combat.attack', on: true }]), 'commandRejected')).toEqual([expect.objectContaining({ reason: 'dead' })]);
    const water = kampfWelt(['.....', '.www.', '.www.', '.www.', '.....'], { x: 0, y: 0 });
    const lake = water.centre(2, 2);
    water.run(1, [{ type: 'player.teleport', x: lake.x, y: lake.y, layer: 0 }]);
    expect(water.body().swimming).toBe(true);
    expect(eventsOf(water.run(1, [{ type: 'combat.attack', on: true }]), 'commandRejected')).toEqual([expect.objectContaining({ reason: 'swimming' })]);
  });

  it('ein Werkzeugwechsel mitten im Ausholen bricht den Schlag ab', () => {
    const k = kampfWelt();
    k.hold('probe_schwert');
    k.run(2, [{ type: 'combat.attack', on: true }]);
    k.hold('probe_keule', 1, 1);
    const events = k.run(WINDUP, [{ type: 'combat.attack', on: false }]);
    expect(eventsOf(events, 'attackStarted')).toEqual([]);
    expect(k.combat.state.player.phase).toBe('bereit');
  });
});

describe('Primärtaste über player.useItem (Werkzeug-System)', () => {
  it('Waffe oder leere Hand: der Primärgebrauch ist ein leichter Schlag, ohne Ablehnung; ein Gebrauch aus dem Platz bleibt abgelehnt', () => {
    const k = kampfWelt();
    const tools = k.sim.addSystem(new ToolsSystem({ player: k.player, inventory: k.inventory }));
    tools.useLife(k.life);
    tools.useCombat(k.combat);
    k.hold('probe_schwert');
    k.aimBy(20, 0);
    const d = k.dummy(14, 0);
    const events = k.run(WINDUP, [{ type: 'player.useItem' }]);
    expect(eventsOf(events, 'commandRejected')).toEqual([]);
    expect(eventsOf(events, 'attackStarted')).toHaveLength(1);
    expect(d.hits).toHaveLength(1);
    // Recovery (held still by the hit's hitstop), then ready again.
    k.run(RECOVERY + hitstopTicks(SWORD.wucht) + 1);
    expect(k.combat.state.player.phase).toBe('bereit');
    const fromSlot = k.run(1, [{ type: 'player.useItem', slot: { bereich: 'schnellleiste', index: 0 } }]);
    expect(eventsOf(fromSlot, 'commandRejected')).toEqual([expect.objectContaining({ reason: 'notUsable' })]);
    k.inventory.bags.replace({ ...k.inventory.state, schnellleiste: k.inventory.state.schnellleiste.map(() => null) });
    const bare = k.run(1, [{ type: 'player.useItem' }]);
    expect(eventsOf(bare, 'attackWindup')).toEqual([expect.objectContaining({ klasse: 'faust' })]);
  });
});

describe('Eingabe: Primär- und Blocktaste (src/game/input.ts)', () => {
  function chain(hand: string | null) {
    const state = new InputState();
    const reader = new ActionReader(state, new BindingSet());
    const translator = new InputCommandTranslator();
    const catalog = contentItemCatalog();
    translator.useProbe({ hand: () => (hand === null ? null : catalog.get(hand)), position: () => false });
    const queue = new CommandQueue<GameCommand>();
    const frame = (): GameCommand[] => {
      reader.update();
      translator.translate(reader, queue, 'player');
      state.endFrame();
      const out: GameCommand[] = [];
      queue.drainForTick(0, (c) => out.push(c));
      return out;
    };
    return { state, reader, frame };
  }

  it('Waffe, Werkzeug oder leere Hand: Drücken und Loslassen als combat.attack', () => {
    for (const hand of ['steinspeer', 'steinaxt', null]) {
      const { state, frame } = chain(hand);
      state.mouseButtonDown(0);
      expect(frame(), String(hand)).toEqual([{ type: 'combat.attack', on: true }]);
      expect(frame()).toEqual([]);
      state.mouseButtonUp(0);
      expect(frame()).toEqual([{ type: 'combat.attack', on: false }]);
    }
  });

  it('Essen, Verband, Fackel, Eimer, Erde: weiter player.useItem', () => {
    for (const hand of ['apfel', 'verband', 'fackel', 'holzeimer_wasser', 'erde']) {
      const { state, frame } = chain(hand);
      state.mouseButtonDown(0);
      expect(frame(), hand).toEqual([{ type: 'player.useItem' }]);
      state.mouseButtonUp(0);
      expect(frame(), hand).toEqual([]);
    }
    expect(primaryRoute(contentItemCatalog().get('lagerfeuer'))).toBe('use');
    expect(primaryRoute(contentItemCatalog().get('holz'))).toBe('combat');
  });

  it('ein Tipp innerhalb eines Frames drückt und lässt im selben Frame los', () => {
    const { state, frame } = chain('steinspeer');
    state.mouseButtonDown(0);
    state.mouseButtonUp(0);
    expect(frame()).toEqual([{ type: 'combat.attack', on: true }, { type: 'combat.attack', on: false }]);
  });

  it('die Blocktaste sendet ihren gehaltenen Zustand – im Baumodus und in Menüs nicht (sie lösen ihn)', () => {
    const { state, reader, frame } = chain('steinspeer');
    state.mouseButtonDown(2);
    expect(frame()).toEqual([{ type: 'combat.block', on: true }]);
    expect(frame()).toEqual([]);
    reader.setContext('build');
    expect(frame()).toEqual([{ type: 'combat.block', on: false }]);
    reader.setContext('ui');
    expect(frame()).toEqual([]);
    reader.setContext('play');
    expect(frame()).toEqual([{ type: 'combat.block', on: true }]);
    state.mouseButtonUp(2);
    expect(frame()).toEqual([{ type: 'combat.block', on: false }]);
  });

  it('im Baumodus gehört die Primärtaste dem Baumodus; ein gehaltener Angriff wird dort losgelassen', () => {
    const { state, reader, frame } = chain(null);
    state.mouseButtonDown(0);
    expect(frame()).toEqual([{ type: 'combat.attack', on: true }]);
    reader.setContext('build');
    expect(frame()).toEqual([{ type: 'combat.attack', on: false }]);
    state.mouseButtonUp(0);
    state.mouseButtonDown(0);
    expect(frame()).toEqual([]);
  });

  it('ohne Hand-Sonde bleibt jeder Druck player.useItem (Werkzeug-System schlägt dann selbst)', () => {
    const state = new InputState();
    const reader = new ActionReader(state, new BindingSet());
    const translator = new InputCommandTranslator();
    const queue = new CommandQueue<GameCommand>();
    state.mouseButtonDown(0);
    reader.update();
    translator.translate(reader, queue, 'player');
    const out: GameCommand[] = [];
    queue.drainForTick(0, (c) => out.push(c));
    expect(out).toEqual([{ type: 'player.useItem' }]);
  });
});
