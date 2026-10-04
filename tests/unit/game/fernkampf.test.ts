/**
 * M6-07 Fernkampf (docs/SPIEL.md §10 "Projektile (M6-07, M6-08)"; MASTERPROMPT §19.2 "Bogen (Spannen 0,8 s) · Armbrust
 * (Nachladen 1,5 s) · Schleuder", §3.3 "Swept-Tests für schnelle Projektile", §12.2 "Leuchtpfeil 3 Tiles, 60 s"):
 * damage × tension, ammunition from the bags, reload, spread narrowed by aiming, projectiles as ECS rows swept against
 * tiles and bodies (no tunnelling), wind drift, arrows that stick (a drop with a chance) or sink in deep water, the glowing
 * arrow's light, conditions of ammunition, experience; a roll through a shot is the dodge's experience `ausweichrolle`
 * (M6-40), once per shot.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { secondsToTicks, shotSpeedShare, tension } from '../../../src/game/combat/formulas';
import { GLOW_LIGHT_KIND, PROJECTILE_COMPONENT, touchStep, type ProjectileLaunch } from '../../../src/game/combat/projectiles';
import { COMBAT_XP } from '../../../src/game/combat/system';
import { TILE_PX } from '../../../src/world/model/coords';
import { OFFSET, eventsOf, kampfCatalog, kampfWelt, meadow, type KampfWelt } from './kampf-testwelt';

const R = BALANCE.combat.ranged;
const DRAW = secondsToTicks(R.bowDrawSeconds);
const catalog = kampfCatalog();
const BOW = catalog.get('probe_bogen').waffe;
const XBOW = catalog.get('probe_armbrust').waffe;
if (BOW?.geschoss === undefined || XBOW?.geschoss === undefined) throw new Error('fixture bows without geschoss');

/** Draws for `ticks` and releases; returns the events of the release tick. */
function shoot(k: KampfWelt, ticks: number): Map<string, unknown[]> {
  k.run(ticks, [{ type: 'combat.attack', on: true }]);
  return k.run(1, [{ type: 'combat.attack', on: false }]);
}

/** Runs until no projectile flies (at most 5 s). */
function land(k: KampfWelt): Map<string, unknown[]> {
  const all = new Map<string, unknown[]>();
  for (let i = 0; i < 300 && k.combat.projectiles.size > 0; i++) k.run(1).forEach((v, key) => all.set(key, [...(all.get(key) ?? []), ...v]));
  return all;
}

describe('Bogen: Spannen 0,8 s, Schaden × Spannung', () => {
  it('voll gespannt: Waffe + Pfeil; halb gespannt: halber Schaden und langsamer; sofort losgelassen: die Mindestspannung', () => {
    expect(DRAW).toBe(48);
    for (const [held, t] of [
      [DRAW, 1],
      [DRAW / 2, 0.5],
      [1, R.minTension],
    ] as const) {
      const k = kampfWelt();
      k.hold('probe_bogen');
      k.pack('probe_pfeil', 10);
      k.aimBy(100, 0);
      const ev = shoot(k, held);
      const fired = eventsOf<{ tension: number; vx: number; item: string }>(ev, 'projectileFired');
      expect(fired).toHaveLength(1);
      expect(fired[0]?.tension).toBeCloseTo(t, 12);
      expect(fired[0]?.item).toBe('probe_pfeil');
      const row = 0;
      expect(k.combat.projectiles.columns.damage[row]).toBeCloseTo((BOW.schaden + 2) * t, 6);
      const speed = Math.hypot(k.combat.projectiles.columns.vx[row] as number, k.combat.projectiles.columns.vy[row] as number);
      expect(speed).toBeCloseTo((BOW.geschoss?.geschwindigkeit ?? 0) * (t < 1 ? shotSpeedShare(t) : 1), 6);
      expect(k.inventory.count('probe_pfeil')).toBe(9);
    }
    expect(tension(24, 48)).toBe(0.5);
  });

  it('ohne passende Munition verweigert der Bogen („noAmmo“); Bolzen passen nicht auf den Bogen', () => {
    const k = kampfWelt();
    k.hold('probe_bogen');
    k.pack('probe_bolzen', 5);
    expect(eventsOf(k.run(1, [{ type: 'combat.attack', on: true }]), 'commandRejected')).toEqual([expect.objectContaining({ type: 'combat.attack', reason: 'noAmmo' })]);
  });

  it('ein Projektil ist eine ECS-Entität mit der Spaltenkomponente „projectile“; nach der Landung ist es fort', () => {
    const k = kampfWelt();
    k.hold('probe_bogen');
    k.pack('probe_pfeil', 3);
    k.aimBy(100, 0);
    const ev = shoot(k, DRAW);
    const e = eventsOf<{ entity: number }>(ev, 'projectileFired')[0]?.entity ?? -1;
    expect(k.sim.ecs.alive(e)).toBe(true);
    expect(k.combat.projectiles.has(e)).toBe(true);
    expect(PROJECTILE_COMPONENT).toBe('projectile');
    land(k);
    expect(k.sim.ecs.alive(e)).toBe(false);
  });
});

describe('Armbrust: Nachladen 1,5 s', () => {
  it('ungeladen lädt der Druck nach (ein Bolzen aus den Taschen), geladen schießt der Druck sofort', () => {
    const k = kampfWelt();
    k.hold('probe_armbrust');
    k.pack('probe_bolzen', 2);
    k.aimBy(100, 0);
    const reload = secondsToTicks(R.crossbowReloadSeconds);
    expect(reload).toBe(90);
    k.run(1, [{ type: 'combat.attack', on: true }, { type: 'combat.attack', on: false }]);
    expect(k.combat.state.player.phase).toBe('nachladen');
    k.run(reload - 2);
    expect(k.combat.state.player.loaded).toBe('');
    k.run(1);
    expect(k.combat.state.player.loaded).toBe('probe_bolzen');
    expect(k.inventory.count('probe_bolzen')).toBe(1);
    const shot = k.run(1, [{ type: 'combat.attack', on: true }]);
    expect(eventsOf(shot, 'projectileFired')).toEqual([expect.objectContaining({ item: 'probe_bolzen', tension: 1, klasse: 'armbrust' })]);
    expect(k.combat.projectiles.columns.damage[0]).toBeCloseTo(XBOW.schaden + 3, 6);
    expect(k.combat.state.player.loaded).toBe('');
  });
});

describe('Schleuder', () => {
  it('schwingt kürzer als der Bogen und wirft Schleudersteine (Wucht)', () => {
    const k = kampfWelt();
    k.hold('probe_schleuder');
    k.pack('probe_schleuderstein', 5);
    k.aimBy(100, 0);
    const full = secondsToTicks(R.slingDrawSeconds);
    expect(full).toBeLessThan(DRAW);
    const ev = shoot(k, full);
    expect(eventsOf(ev, 'projectileFired')).toEqual([expect.objectContaining({ item: 'probe_schleuderstein', tension: 1 })]);
    const d = k.dummy(60, 0);
    land(k);
    expect(d.hits[0]?.type).toBe('wucht');
  });
});

describe('Swept-Kollision', () => {
  it('ein schneller Pfeil tunnelt nicht durch eine Wand: er steckt davor, das Ziel dahinter bleibt heil', () => {
    const rows = meadow(40, 20).map((row, y) => (y === 10 ? `${row.slice(0, 14)}#${row.slice(15)}` : row));
    const k = kampfWelt(rows, { x: 10, y: 10 });
    k.hold('probe_armbrust');
    k.pack('probe_bolzen', 1);
    k.combat.state.player.loaded = 'probe_bolzen';
    k.aimBy(160, 0);
    const behind = k.dummy(6 * TILE_PX, 0);
    k.run(1, [{ type: 'combat.attack', on: true }]);
    const ev = land(k);
    const stuck = eventsOf<{ wo: string; x: number }>(ev, 'projectileStuck');
    expect(stuck).toEqual([expect.objectContaining({ wo: 'wand' })]);
    // The wall's west face (map column 14); the bolt's circle stops in front of it.
    expect(stuck[0]?.x).toBeLessThanOrEqual((OFFSET + 14) * TILE_PX);
    expect(stuck[0]?.x).toBeGreaterThan((OFFSET + 14) * TILE_PX - TILE_PX);
    expect(behind.hits).toEqual([]);
  });

  it('ein kleiner Körper zwischen zwei Tick-Positionen wird trotzdem getroffen', () => {
    const k = kampfWelt();
    k.hold('probe_armbrust');
    k.combat.state.player.loaded = 'probe_bolzen';
    k.aimBy(200, 0);
    // 10 px per tick; a body of radius 1 sits between two step ends.
    const tiny = k.dummy(45, 0, { radius: 1 });
    k.run(1, [{ type: 'combat.attack', on: true }]);
    const ev = land(k);
    expect(tiny.hits).toHaveLength(1);
    expect(eventsOf(ev, 'projectileHit')).toEqual([expect.objectContaining({ target: tiny.entity })]);
    expect(eventsOf(ev, 'projectileStuck')).toEqual([expect.objectContaining({ wo: 'ziel' })]);
    expect(eventsOf(ev, 'xpGained')).toEqual([expect.objectContaining({ source: COMBAT_XP.rangedHit, skill: 'fernkampf' })]);
  });

  it('der Wind lenkt ab: seitliche Drift nach Wind und Flugzeit', () => {
    const calm = kampfWelt();
    const windy = kampfWelt();
    windy.wind.y = BALANCE.combat.projectile.windAccelPxPerSecond2;
    for (const k of [calm, windy]) {
      k.hold('probe_armbrust');
      k.combat.state.player.loaded = 'probe_bolzen';
      k.aimBy(200, 0);
      k.run(1, [{ type: 'combat.attack', on: true }]);
    }
    const flight = 20;
    calm.run(flight);
    windy.run(flight);
    const dy = (windy.combat.projectiles.columns.y[0] as number) - (calm.combat.projectiles.columns.y[0] as number);
    const t = (flight + 1) / 60;
    expect(dy).toBeGreaterThan(0);
    expect(dy).toBeCloseTo((BALANCE.combat.projectile.windAccelPxPerSecond2 * t * t) / 2, 0);
  });
});

describe('Pfeile stecken oder gehen unter', () => {
  it('am Ende der Reichweite steckt der Pfeil im Boden; mit Chance lässt er sich aufheben', () => {
    let drops = 0;
    const N = 40;
    for (let i = 0; i < N; i++) {
      const k = kampfWelt(meadow(40, 20), { x: 10, y: 10 }, 100 + i);
      k.hold('probe_bogen');
      k.pack('probe_pfeil', 1);
      k.aimBy(0, 200);
      shoot(k, DRAW);
      const ev = land(k);
      const stuck = eventsOf<{ wo: string; drop: boolean }>(ev, 'projectileStuck');
      expect(stuck).toHaveLength(1);
      expect(stuck[0]?.wo).toBe('boden');
      if (stuck[0]?.drop === true) {
        drops++;
        expect(k.landed.at(-1)?.stack).toEqual({ item: 'probe_pfeil', count: 1 });
      }
    }
    expect(drops).toBeGreaterThan(N * 0.25);
    expect(drops).toBeLessThan(N * 0.75);
  });

  it('in tiefem Wasser geht er unter – ohne Drop', () => {
    const rows = meadow(40, 30).map((row, y) => (y >= 18 ? 'w'.repeat(40) : row));
    const k = kampfWelt(rows, { x: 10, y: 10 });
    k.hold('probe_bogen');
    k.pack('probe_pfeil', 1);
    k.aimBy(0, 200);
    shoot(k, DRAW);
    const ev = land(k);
    expect(eventsOf(ev, 'projectileStuck')).toEqual([expect.objectContaining({ wo: 'wasser', drop: false })]);
    expect(k.landed).toEqual([]);
  });
});

describe('Munition mit Wirkung', () => {
  it('Leuchtpfeil: steckt und leuchtet 3 Kacheln weit für 60 s; im Ziel folgt das Licht dem Körper', () => {
    const k = kampfWelt();
    k.hold('probe_bogen');
    k.pack('probe_pfeil_leucht', 2);
    k.aimBy(0, 200);
    shoot(k, DRAW);
    land(k);
    expect(k.combat.state.glows).toHaveLength(1);
    const lights: Array<{ kind: string; radius: number; seconds: number }> = [];
    const provider = k.combat.lightProvider();
    provider(k.sim, (_id, kind, _farbe, _layer, _x, _y, _h, radius, _i, _f, seconds) => lights.push({ kind, radius, seconds }));
    expect(lights).toEqual([{ kind: GLOW_LIGHT_KIND, radius: 3 * TILE_PX, seconds: expect.closeTo(60, 0) }]);
    k.run(secondsToTicks(60) + 1);
    expect(k.combat.state.glows).toEqual([]);
    // Into a body: the light walks with it.
    k.run(60);
    k.aimBy(100, 0);
    const d = k.dummy(40, 0, { health: 1000, maxHealth: 1000 });
    shoot(k, DRAW);
    land(k);
    expect(k.combat.state.glows[0]?.target).toBe(d.entity);
    d.x += 30;
    k.run(1);
    expect(k.combat.state.glows[0]?.x).toBe(d.x);
  });

  it('Feuerpfeil: Feuerschaden und „Brennen“ am Ziel', () => {
    const k = kampfWelt();
    k.hold('probe_bogen');
    k.pack('probe_pfeil_feuer', 1);
    k.aimBy(100, 0);
    const d = k.dummy(40, 0);
    shoot(k, DRAW);
    land(k);
    expect(d.hits[0]).toMatchObject({ type: 'feuer', condition: 'brennen', conditionSeconds: 4 });
  });
});

describe('Zielen mit der Fernwaffe', () => {
  it('ruhigere Hand: die Streuung schrumpft beim Zielen (Blocktaste)', () => {
    const spread = (aiming: boolean): number => {
      let max = 0;
      for (let i = 0; i < 30; i++) {
        const k = kampfWelt(meadow(40, 20), { x: 10, y: 10 }, 500 + i);
        k.hold('probe_bogen');
        k.pack('probe_pfeil', 1);
        k.aimBy(100, 0);
        if (aiming) k.run(1, [{ type: 'combat.block', on: true }]);
        shoot(k, DRAW);
        const c = k.combat.projectiles.columns;
        max = Math.max(max, Math.abs((c.vy[0] as number) / (c.vx[0] as number)));
      }
      return max;
    };
    const free = spread(false);
    const aimed = spread(true);
    expect(free).toBeLessThanOrEqual(Math.tan((R.spreadDeg.bogen * Math.PI) / 180) + 1e-9);
    expect(aimed).toBeLessThanOrEqual(Math.tan((R.spreadDeg.bogen * Math.PI) / 180) * BALANCE.combat.aimMode.spreadFactor + 1e-9);
    expect(aimed).toBeLessThan(free);
  });
});

describe('Ausweichrolle durch ein Geschoss (M6-40)', () => {
  /** A glob of spit 80 px east of the player, flying at him; the player rolls after `rollAfter` ticks (−1: never) in `dir`. */
  function spitAt(rollAfter: number, dir: { dx: number; dy: number } = { dx: 1, dy: 0 }): { k: KampfWelt; events: Map<string, unknown[]>; health: number } {
    const k = kampfWelt(meadow(40, 20), { x: 20, y: 10 });
    const foe = k.dummy(80, 0, { team: 'feind' });
    k.combat.addShot('geschoss_spucken', null);
    const p = k.pos();
    const launch: ProjectileLaunch = { owner: foe.entity, team: 'feind', klasse: 'wurf', item: 'geschoss_spucken', layer: 0, level: 0, x: foe.x, y: foe.y, dirX: p.x - foe.x, dirY: 0, tension: 1, speed: 150, range: 160, damage: 10, art: 'gift', wucht: 1, staggerSeconds: 0, arc: false, aiming: false, carried: null };
    launch.dirX = -1;
    const health = k.vit().health;
    k.combat.fireShot(k.sim, launch, k.sim.tick);
    const events = new Map<string, unknown[]>();
    const add = (ev: Map<string, unknown[]>): void => ev.forEach((v, key) => events.set(key, [...(events.get(key) ?? []), ...v]));
    for (let i = 0; i < 90 && k.combat.projectiles.size > 0; i++) add(k.run(1, i === rollAfter ? [{ type: 'player.roll', ...dir }] : undefined));
    return { k, events, health };
  }

  it('rollt der Spieler durch das Geschoss, gibt es einmal EP „ausweichrolle“ und keinen Schaden', () => {
    const { k, events, health } = spitAt(20);
    expect(eventsOf(events, 'xpGained')).toEqual([expect.objectContaining({ source: COMBAT_XP.dodge })]);
    expect(COMBAT_XP.dodge).toBe('ausweichrolle');
    expect(eventsOf<{ target: number }>(events, 'projectileHit').filter((h) => h.target === k.sim.player)).toEqual([]);
    expect(k.vit().health).toBe(health);
  });

  it('ohne Rolle trifft es (keine EP); eine Rolle abseits der Flugbahn gibt keine EP', () => {
    const hit = spitAt(-1);
    expect(eventsOf<{ target: number }>(hit.events, 'projectileHit').map((h) => h.target)).toEqual([hit.k.sim.player]);
    expect(eventsOf<{ source: string }>(hit.events, 'xpGained').filter((x) => x.source === COMBAT_XP.dodge)).toEqual([]);
    // Rolled out of the way before the glob came near: it passes by, no dodge.
    const away = spitAt(0, { dx: 0, dy: 1 });
    expect(eventsOf<{ source: string }>(away.events, 'xpGained').filter((x) => x.source === COMBAT_XP.dodge)).toEqual([]);
  });

  it('hinter einer Wand gibt die Rolle keine EP, auch wenn der Schritt, der an der Wand endet, bis zum Spieler reichte', () => {
    // A rock column right east of the player; a fast glob (25 px a tick) whose step across the rock would reach him.
    const rows = Array.from({ length: 20 }, (_, y) => (y >= 8 && y <= 13 ? '.'.repeat(21) + '#' + '.'.repeat(18) : '.'.repeat(40)));
    const k = kampfWelt(rows, { x: 10, y: 10 });
    // Right beside the rock (the spawn keeps a tile's distance from it; a teleport does not).
    const beside = k.centre(20, 10);
    k.run(1, [{ type: 'player.teleport', x: beside.x, y: beside.y, layer: 0 }]);
    expect(k.centre(21, 10).x - k.pos().x).toBe(16);
    const foe = k.dummy(80, 0, { team: 'feind' });
    k.combat.addShot('geschoss_spucken', null);
    k.combat.fireShot(k.sim, { owner: foe.entity, team: 'feind', klasse: 'wurf', item: 'geschoss_spucken', layer: 0, level: 0, x: foe.x, y: foe.y, dirX: -1, dirY: 0, tension: 1, speed: 1500, range: 160, damage: 10, art: 'gift', wucht: 1, staggerSeconds: 0, arc: false, aiming: false, carried: null }, k.sim.tick);
    const events = new Map<string, unknown[]>();
    for (let i = 0; i < 20; i++) k.run(1, i === 0 ? [{ type: 'player.roll', dx: 0, dy: 1 }] : undefined).forEach((v, key) => events.set(key, [...(events.get(key) ?? []), ...v]));
    expect(eventsOf<{ wo: string }>(events, 'projectileStuck').map((x) => x.wo)).toEqual(['wand']);
    expect(eventsOf<{ source: string }>(events, 'xpGained').filter((x) => x.source === COMBAT_XP.dodge)).toEqual([]);
  });

  it('touchStep: wo der Schritt den Körper zuerst berührt', () => {
    expect(touchStep(-20, 0, 0, 0, 0, 0, 5)).toBeCloseTo(0.75, 12);
    // Starting inside: at once; missing or stopping short: never.
    expect(touchStep(-2, 0, 10, 0, 0, 0, 5)).toBe(0);
    expect(touchStep(-20, 10, 20, 10, 0, 0, 5)).toBe(-1);
    expect(touchStep(-20, 0, -10, 0, 0, 0, 5)).toBe(-1);
    expect(touchStep(3, 3, 3, 3, 0, 0, 1)).toBe(-1);
  });

  it('wann immer die Rolle den Spieler durch das Geschoss trägt: genau einmal EP; das Geschoss merkt es sich über Speichern', () => {
    for (const after of [10, 14, 16, 18]) {
      const { events } = spitAt(after);
      expect(eventsOf<{ source: string }>(events, 'xpGained').filter((x) => x.source === COMBAT_XP.dodge), `Rolle nach ${after} Ticks`).toHaveLength(1);
    }
    // Saved mid-dodge: the flag goes with the shot, a loaded game grants no second dodge.
    const k = kampfWelt(meadow(40, 20), { x: 20, y: 10 });
    const foe = k.dummy(80, 0, { team: 'feind' });
    k.combat.addShot('geschoss_spucken', null);
    k.combat.fireShot(k.sim, { owner: foe.entity, team: 'feind', klasse: 'wurf', item: 'geschoss_spucken', layer: 0, level: 0, x: foe.x, y: foe.y, dirX: -1, dirY: 0, tension: 1, speed: 150, range: 160, damage: 10, art: 'gift', wucht: 1, staggerSeconds: 0, arc: false, aiming: false, carried: null }, k.sim.tick);
    let xp = 0;
    for (let i = 0; i < 40 && xp === 0; i++) xp += eventsOf<{ source: string }>(k.run(1, i === 16 ? [{ type: 'player.roll', dx: 1, dy: 0 }] : undefined), 'xpGained').filter((x) => x.source === COMBAT_XP.dodge).length;
    expect(xp).toBe(1);
    const saved = k.combat.save.serialize() as { projectiles: Record<string, unknown>[] };
    expect(saved.projectiles[0]?.dodged).toBe(true);
    k.combat.save.deserialize(saved);
    for (let i = 0; i < 20; i++) xp += eventsOf<{ source: string }>(k.run(1), 'xpGained').filter((x) => x.source === COMBAT_XP.dodge).length;
    expect(xp).toBe(1);
  });
});
