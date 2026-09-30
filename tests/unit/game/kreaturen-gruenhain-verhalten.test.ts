/**
 * Das Verhalten der Grünhain-Kreaturen M6-20 … M6-22 in der Simulation (MASTERPROMPT §19.4, §20.1; docs/SPIEL.md §11):
 * - Dornling (getarnt): wartet als Busch, rührt sich nicht und wird nicht „gesichtet“, bis der Spieler in die Reichweite
 *   seines Überfalls kommt – dann enthüllt er sich (`creatureRevealed`) und holt sofort aus (der Überfall, 0,5 s, schwer);
 *   danach nur noch die Peitsche. Ein Treffer weckt ihn, er braucht `tarnung.erwachen` zum Aufwachen und handelt so lange
 *   nicht; in Ruhe gelassen tarnt er sich wieder. Tarnung und Enthüllung überleben das Speichern.
 * - Wespenschwarm: verteidigt sein Nest mit Giftstichen, flieht vor offenem Feuer (Fackel, Lagerfeuer, Brand – nicht vor
 *   einer Lampe) vom Feuer weg.
 * - Wolfsrudel (echter Inhalt, nachts): umstellt den Spieler, nur einer holt zugleich aus, die anderen umkreisen.
 * - Keiler: verteidigt seine Suhle mit dem Ansturm (0,6 s Ausholen, 0,2 s Anlauf zum Ziel).
 * - Friedliche: Eichhörnchen und Frosch fliehen, Glühwürmchen lassen weder Kadaver noch Beute.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { LIGHT_KINDS } from '../../../src/content/lights';
import type { Entity } from '../../../src/engine/ecs';
import type { HitResult } from '../../../src/game/combat/targets';
import { FLAME_LIGHT_KINDS, lightSystemFlames } from '../../../src/game/creatures/flames';
import { angularSpread, windupPoseTicks, windupTicks } from '../../../src/game/creatures/formulas';
import { creaturesSnapshotSchema } from '../../../src/game/creatures/state';
import { FIRE_LIGHT_KIND } from '../../../src/game/fire/system';
import type { SimLightSource } from '../../../src/game/light/system';
import type { SimEventMap, Simulation } from '../../../src/game/sim';
import { eventsOf } from './kampf-testwelt';
import { kreaturWelt, meadow, type KreaturWelt } from './kreatur-testwelt';

type Revealed = SimEventMap['creatureRevealed'];
type Telegraph = SimEventMap['creatureTelegraph'];
type Hit = SimEventMap['hitLanded'];

const TILE = 16;
const HZ = BALANCE.time.tickHz;

/** A hit on creature `e` from the player (the way the combat system hands it over). */
function hitOn(w: KreaturWelt, e: Entity, amount: number): void {
  const hit: HitResult = {
    attacker: w.sim.player,
    attackerTeam: 'spieler',
    amount,
    type: 'hieb',
    crit: false,
    parried: false,
    blocked: false,
    blockStamina: 0,
    knockback: 0,
    dirX: 0,
    dirY: 0,
    hitstopTicks: 0,
    staggerTicks: 0,
    condition: null,
    conditionSeconds: 0,
    armorBreak: 0,
    armorBreakSeconds: 0,
  };
  w.creatures.targets.applyHit(w.sim, e, hit);
}

/** Runs `n` ticks and collects the events of `type`. */
function collect<T>(w: KreaturWelt, n: number, type: string, commands?: Parameters<KreaturWelt['run']>[1]): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(...eventsOf<T>(w.run(1, i === 0 ? commands : undefined), type));
  return out;
}

describe('Dornling: getarnt bis nah (M6-22)', () => {
  it('wartet als Busch: still, ohne Telegraph, nicht gesichtet – der Spieler in 4 Kacheln weckt ihn nicht', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.cheats.god = true;
    const d = w.creature('dornling', 24, 15);
    const at = w.where(d);
    expect(w.state(d).hidden).toBe(true);
    const telegraphs = collect<Telegraph>(w, 4 * HZ, 'creatureTelegraph');
    expect(telegraphs).toEqual([]);
    expect(w.state(d).hidden).toBe(true);
    expect(w.where(d)).toEqual(at);
    // Four seconds in plain view: a bush is not a sighting (the bestiary needs three seconds of a creature).
    expect(w.bestiary.entry('dornling').sighted).toBe(false);
  });

  it('überfällt, wer in seine Reichweite tritt: Enthüllung und Ausholen im selben Tick, der schwere Schlag nach 0,5 s', () => {
    // No god mode: an invulnerable player takes no hits at all.
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    const d = w.creature('dornling', 24, 15);
    let revealed: Revealed | undefined;
    let telegraph: Telegraph | undefined;
    for (let i = 0; i < 3 * HZ && revealed === undefined; i++) {
      const ev = w.run(1, i === 0 ? [{ type: 'player.move', dx: 1, dy: 0 }] : undefined);
      revealed = eventsOf<Revealed>(ev, 'creatureRevealed')[0];
      telegraph = eventsOf<Telegraph>(ev, 'creatureTelegraph')[0];
    }
    expect(revealed?.entity).toBe(d);
    expect(revealed?.ambush).toBe(true);
    expect(telegraph?.angriff).toBe('ueberfall');
    expect(telegraph?.tick).toBe(revealed?.tick);
    expect(telegraph?.ticks).toBe(windupTicks({ ausholzeit: 0.5 }, 'normal'));
    expect(w.state(d).hidden).toBe(false);
    // The player's edge was within the ambush's reach when it sprang (20 px), not before.
    const edge = Math.hypot(w.pos().x - w.where(d).x, w.pos().y - w.where(d).y) - BALANCE.combat.body.playerRadiusPx;
    expect(edge).toBeLessThanOrEqual(20 + 3);
    w.run(1, [{ type: 'player.move', dx: 0, dy: 0 }]);
    const hits = collect<Hit>(w, (telegraph?.ticks ?? 0) + 2, 'hitLanded').filter((h) => h.attacker === d && h.target === w.sim.player);
    expect(hits).toHaveLength(1);
    expect([26, 26 * BALANCE.combat.damage.critFactor].map((v) => Math.round(v * 1000))).toContain(Math.round((hits[0] as Hit).amount * 1000));
    // Revealed, it fights with its whip; the ambush was its one surprise – even once its cooldown (8 s) is over.
    w.cheats.god = true;
    const later = collect<Telegraph>(w, 12 * HZ, 'creatureTelegraph').filter((t) => t.entity === d);
    expect(later.length).toBeGreaterThan(0);
    expect(new Set(later.map((t) => t.angriff))).toEqual(new Set(['peitsche']));
  });

  it('ein Treffer weckt ihn; er braucht `erwachen` zum Aufwachen und tarnt sich in Ruhe wieder', () => {
    const w = kreaturWelt(meadow(64, 30), { x: 44, y: 15 });
    w.cheats.god = true;
    // Far beyond its sight (6 tiles) even at the end of its leash (8 tiles): it only knows the player from the hit.
    const d = w.creature('dornling', 10, 15);
    const at = w.where(d);
    hitOn(w, d, 3);
    const tarnTick = w.state(d).tarnTick;
    expect(w.state(d).hidden).toBe(false);
    expect(tarnTick).toBeGreaterThanOrEqual(0);
    const erwachen = Math.round(0.5 * HZ);
    // Waking it cannot act: it neither walks nor strikes while the reveal plays.
    w.run(erwachen - 2);
    expect(w.where(d)).toEqual(at);
    expect(w.state(d).attackPhase).toBe('keine');
    // Alarmed by the hit it goes for the player, turns back at its leash, forgets it and hides again after ten quiet seconds.
    let hid = -1;
    for (let i = 0; i < 40 * HZ && hid < 0; i++) {
      w.run(1);
      if (w.state(d).hidden) hid = i;
    }
    expect(hid).toBeGreaterThan(0);
    expect(w.state(d).tarnTick).toBeGreaterThan(tarnTick + 10 * HZ);
    expect(w.state(d).vx).toBe(0);
  });

  it('Tarnung und Enthüllung werden gespeichert; ein Spielstand ohne sie lädt ohne Tarnung', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    const hidden = w.creature('dornling', 6, 10);
    const shown = w.creature('dornling', 6, 20);
    hitOn(w, shown, 1);
    w.run(3);
    const snap = JSON.parse(JSON.stringify(w.creatures.save.serialize())) as { creatures: Record<string, unknown>[] };
    const before = [w.state(hidden).hidden, w.state(shown).hidden, w.state(shown).tarnTick];
    w.creatures.save.deserialize(snap);
    expect([w.state(hidden).hidden, w.state(shown).hidden, w.state(shown).tarnTick]).toEqual(before);
    expect(before).toEqual([true, false, expect.any(Number) as number]);
    // A save written before camouflage existed: the fields default (nothing hides).
    for (const c of snap.creatures) {
      delete c['hidden'];
      delete c['tarnTick'];
    }
    const old = creaturesSnapshotSchema.parse(snap);
    expect(old.creatures.every((c) => !c.hidden && c.tarnTick === -1)).toBe(true);
  });
});

describe('Wespenschwarm: Gift und Rauch (M6-22)', () => {
  it('verteidigt sein Nest mit Stichen, die vergiften', () => {
    // Its nest two tiles north of the player (a new creature faces south: it sees the player at once). No god mode.
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    const s = w.creature('wespenschwarm', 20, 13);
    let poisoned = false;
    let stings = 0;
    for (let i = 0; i < 30 * HZ && !poisoned; i++) {
      const ev = w.run(1);
      stings += eventsOf<Hit>(ev, 'hitLanded').filter((h) => h.attacker === s).length;
      poisoned = w.life.conditions.has('vergiftung');
    }
    expect(stings).toBeGreaterThan(0);
    expect(poisoned).toBe(true);
  });

  it('mit der Fackel in der Hand: der Schwarm weicht dem Rauch aus und sticht nicht, ohne Feuer verteidigt er wieder', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.cheats.god = true;
    const s = w.creature('wespenschwarm', 20, 13);
    // The torch: a flame where the player stands.
    w.creatures.useFlames({
      nearest(_sim, _layer, x, y, radius, out) {
        const p = w.pos();
        if ((p.x - x) ** 2 + (p.y - y) ** 2 > radius * radius) return false;
        out.x = p.x;
        out.y = p.y;
        return true;
      },
    });
    let fled = false;
    let farthest = 0;
    const telegraphs: Telegraph[] = [];
    for (let i = 0; i < 3 * HZ; i++) {
      telegraphs.push(...eventsOf<Telegraph>(w.run(1), 'creatureTelegraph').filter((t) => t.entity === s));
      if (w.state(s).state === 'fliehen') fled = true;
      farthest = Math.max(farthest, Math.hypot(w.where(s).x - w.pos().x, w.where(s).y - w.pos().y));
    }
    expect(fled).toBe(true);
    expect(farthest).toBeGreaterThan(3 * TILE);
    expect(telegraphs).toEqual([]);
    // Without the flame the swarm defends its nest again.
    w.creatures.useFlames({ nearest: () => false });
    const later: Telegraph[] = [];
    for (let i = 0; i < 10 * HZ && later.length === 0; i++) later.push(...eventsOf<Telegraph>(w.run(1), 'creatureTelegraph').filter((t) => t.entity === s));
    expect(later[0]?.angriff).toBe('stechen');
  });

  it('vor einem Lagerfeuer neben dem Nest flieht er vom Feuer weg, nicht bloß vom Spieler', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.cheats.god = true;
    const s = w.creature('wespenschwarm', 20, 13);
    // A camp fire a tile east of the nest (the player stands two tiles south of it).
    const fire = { x: w.where(s).x + TILE, y: w.where(s).y };
    w.creatures.useFlames({
      nearest(_sim, _layer, x, y, radius, out) {
        if ((fire.x - x) ** 2 + (fire.y - y) ** 2 > radius * radius) return false;
        out.x = fire.x;
        out.y = fire.y;
        return true;
      },
    });
    let farthest = 0;
    let farthestX = w.where(s).x;
    for (let i = 0; i < 2 * HZ; i++) {
      w.run(1);
      const d = Math.hypot(w.where(s).x - fire.x, w.where(s).y - fire.y);
      if (d > farthest) {
        farthest = d;
        farthestX = w.where(s).x;
      }
    }
    // Beyond the smoke (3 tiles), westwards: away from the fire, not north away from the player.
    expect(farthest).toBeGreaterThan(3 * TILE);
    expect(farthestX).toBeLessThan(fire.x - 2 * TILE);
  });

  it('offene Flammen sind Fackel, Lagerfeuer und Brand – keine Lampe; nur auf der eigenen Ebene, die nächste zählt', () => {
    const lamp = LIGHT_KINDS.find((k) => k.verhalten === 'lampe');
    expect(lamp).toBeDefined();
    expect(FLAME_LIGHT_KINDS.has('fackel')).toBe(true);
    expect(FLAME_LIGHT_KINDS.has('lagerfeuer')).toBe(true);
    expect(FLAME_LIGHT_KINDS.has(FIRE_LIGHT_KIND)).toBe(true);
    expect(FLAME_LIGHT_KINDS.has(lamp?.id ?? '')).toBe(false);
    const light = (kind: string, x: number, y: number, layer = 0): SimLightSource => ({ id: 1, layer, kind, farbe: 'feuer.3', mount: 'stand', brenndauer: 10, windowTiles: 6, x, y, height: 0, radius: 6, intensity: 1, flicker: 0, seed: 0, coneDirection: 0, coneAngle: Math.PI * 2 }) as unknown as SimLightSource;
    const list = [light(lamp?.id ?? '', 10, 0), light('fackel', 40, 0), light('lagerfeuer', 30, 0), light('fackel', 5, 0, -1)];
    const flames = lightSystemFlames({ sources: () => list });
    const out = { x: 0, y: 0 };
    const sim = null as unknown as Simulation;
    expect(flames.nearest(sim, 0, 0, 0, 48, out)).toBe(true);
    expect(out).toEqual({ x: 30, y: 0 });
    expect(flames.nearest(sim, 0, 0, 0, 20, out)).toBe(false);
  });
});

describe('Wolfsrudel und Keiler (M6-21)', () => {
  it('drei Wölfe umstellen den Spieler nachts: nur einer holt zugleich aus, die anderen umkreisen, Streuung über 90°', () => {
    const w = kreaturWelt(meadow(60, 40), { x: 30, y: 20 });
    w.cheats.god = true;
    w.cenv.phase = 'nacht';
    const before = w.creatures.store.size;
    w.run(1, [{ type: 'creature.spawn', creature: 'wolf', count: 3, x: w.centre(30, 12).x, y: w.centre(30, 12).y, layer: 0 }]);
    const wolves = Array.from({ length: w.creatures.store.size - before }, (_, i) => w.creatures.store.entityAt(before + i));
    expect(wolves).toHaveLength(3);
    expect(new Set(wolves.map((e) => w.state(e).pack)).size).toBe(1);
    w.run(10 * HZ);
    const spreads: number[] = [];
    let circling = 0;
    for (let k = 0; k < 20; k++) {
      w.run(15);
      const p = w.pos();
      spreads.push(angularSpread(wolves.map((e) => Math.atan2(w.where(e).y - p.y, w.where(e).x - p.x))));
      expect(wolves.filter((e) => w.state(e).attackPhase === 'ausholen').length).toBeLessThanOrEqual(1);
      circling += wolves.filter((e) => w.state(e).state === 'umkreisen').length;
    }
    expect(circling).toBeGreaterThan(0);
    const median = [...spreads].sort((a, b) => a - b)[Math.floor(spreads.length / 2)] as number;
    expect(median).toBeGreaterThan(Math.PI / 2);
  });

  it('der Keiler stürmt auf den Eindringling: 0,6 s Pose, 0,2 s Anlauf zum Ziel, Schlag nach 0,8 s', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    // Two tiles north of the player: within the charge's reach (40 px), not the tusks' (16 px).
    const k = w.creature('keiler', 20, 13);
    let telegraph: Telegraph | undefined;
    for (let i = 0; i < 3 * HZ && telegraph === undefined; i++) telegraph = eventsOf<Telegraph>(w.run(1), 'creatureTelegraph').find((t) => t.entity === k);
    expect(telegraph?.angriff).toBe('ansturm');
    const a = { ausholzeit: 0.6, anlauf: 0.2 };
    expect(telegraph?.ticks).toBe(windupTicks(a, 'normal'));
    expect(telegraph?.ticks).toBe(Math.round(0.8 * HZ));
    expect(telegraph?.poseTicks).toBe(windupPoseTicks(a, 'normal'));
    const from = w.where(k);
    // The pose: it stands.
    w.run((telegraph?.poseTicks ?? 0) - 1);
    expect(w.where(k)).toEqual(from);
    // The run-up carries it to the player; the blow lands at the announced tick.
    const hits = collect<Hit>(w, (telegraph?.ticks ?? 0) - (telegraph?.poseTicks ?? 0) + 2, 'hitLanded').filter((h) => h.attacker === k);
    expect(Math.hypot(w.where(k).x - from.x, w.where(k).y - from.y)).toBeGreaterThan(8);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.tick).toBe((telegraph?.tick ?? 0) + (telegraph?.ticks ?? 0));
  });
});

describe('Die Friedlichen (M6-20)', () => {
  it('Eichhörnchen und Frosch fliehen vor dem nahen Spieler', () => {
    for (const [id, phase] of [
      ['eichhoernchen', 'tag'],
      ['frosch', 'nacht'],
    ] as const) {
      const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
      w.cenv.phase = phase;
      const c = w.creature(id, 20, 13);
      const start = w.pos().y - w.where(c).y;
      let fled = false;
      for (let i = 0; i < HZ; i++) {
        w.run(1);
        if (w.state(c).state === 'fliehen') fled = true;
      }
      expect(fled, id).toBe(true);
      expect(Math.hypot(w.where(c).x - w.pos().x, w.where(c).y - w.pos().y), id).toBeGreaterThan(start + TILE);
    }
  });

  it('Glühwürmchen: fallen ohne Kadaver und ohne Beute (ihr Licht geht mit ihnen aus)', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.cenv.phase = 'nacht';
    const g = w.creature('gluehwuermchen', 26, 15);
    hitOn(w, g, 5);
    expect(w.creatures.store.get(g)?.health ?? 0).toBe(0);
    w.run(2);
    expect(w.creatures.carcasses.size).toBe(0);
    expect(w.spilled).toEqual([]);
    expect(w.creatures.store.get(g)).toBeUndefined();
  });
});
