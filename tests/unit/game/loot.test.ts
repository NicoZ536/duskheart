/**
 * Beute, Kadaver und Zerlegen (M6-30, MASTERPROMPT §14 „Jagen & Zerlegen“: besiegte Tiere hinterlassen einen Kadaver, E
 * mit Messer zerlegt ihn; docs/SPIEL.md §11 „Beute, Jagen, Fallen“):
 * - Beutetabellen: gewichtet, geseedet, stufenabhängig (`stufeAb`, die Stufe des Bioms), mehrere Ziehungen addieren sich;
 * - Zerlegen: jede Ausbeute mit eigener Chance;
 * - der ganze Inhalt (die Registry aller Kreaturengruppen, src/content/creatures/index.ts – nicht nur der Kern): jede
 *   Kreatur hat eine Beutetabelle außer dem Glühwürmchen (MASTERPROMPT §20.1 „Jede Kreatur: … Beutetabelle“, SPIEL §11);
 *   die Regel je Familie (Tiere: Kadaver, keine Beute; Schattenbrut und die Feinde, die man nicht zerlegt: Beute, kein
 *   Kadaver); kein Feind lässt fallen, was die Welt zum Sammeln bietet (ADR-0105, SPIEL §14);
 * - im Spiel: ein besiegter Hase hinterlässt einen Kadaver statt Beute; E mit Messer zerlegt ihn (Stücke als Drops,
 *   Erfahrung, das Messer nutzt ab) – ohne Messer, zu weit weg oder ohne Kadaver nicht; unzerlegt verwest er.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { CREATURES, LOOT_TABLES } from '../../../src/content/creatures/index';
import { lootTableSchema } from '../../../src/content/creatures/schema';
import { buildItemIndex } from '../../../src/content/items/usage';
import { parseItemSource } from '../../../src/content/schema/item';
import { Rng } from '../../../src/engine/rng';
import { NULL_ENTITY } from '../../../src/engine/ecs';
import { carveYield, drawLoot, effectiveTier } from '../../../src/game/creatures/formulas';
import { carcassUses } from '../../../src/game/creatures/uses';
import { createUseOffer } from '../../../src/game/interaction/uses';
import type { SimEventMap } from '../../../src/game/sim';
import { TILE_PX } from '../../../src/world/model/coords';
import { eventsOf } from './kampf-testwelt';
import { kreaturWelt, meadow, tileOf } from './kreatur-testwelt';
import { m6Ids, missingM6, undocumentedSinceM6 } from '../content/stand';

const table = lootTableSchema.parse({
  id: 'probe',
  ziehungen: [2, 2],
  beute: [
    { item: 'knochen', gewicht: 1, anzahl: [1, 1] },
    { item: 'fell', gewicht: 3, anzahl: [2, 2] },
    { item: 'lumen_scherbe', gewicht: 10, anzahl: [1, 1], stufeAb: 3 },
  ],
  zerlegen: [
    { item: 'fell', chance: 1, anzahl: [1, 1] },
    { item: 'sehnen', chance: 0.25, anzahl: [1, 3] },
  ],
});

describe('Beutetabellen (M6-30)', () => {
  it('gewichtet: die Einträge kommen im Verhältnis ihrer Gewichte', () => {
    const rng = new Rng(21);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) {
      for (const d of drawLoot({ ...table, ziehungen: [1, 1] }, 0, rng)) counts[d.item] = (counts[d.item] ?? 0) + 1;
    }
    expect((counts.fell ?? 0) / 2000).toBeCloseTo(0.75, 1);
    expect((counts.knochen ?? 0) / 2000).toBeCloseTo(0.25, 1);
  });

  it('stufenabhängig: Einträge ab einer Stufe nur von ihr an; das Biom hebt die Stufe', () => {
    const low = new Set<string>();
    const high = new Set<string>();
    const rng = new Rng(2);
    for (let i = 0; i < 200; i++) {
      for (const d of drawLoot(table, 0, rng)) low.add(d.item);
      for (const d of drawLoot(table, 3, rng)) high.add(d.item);
    }
    expect(low.has('lumen_scherbe')).toBe(false);
    expect(high.has('lumen_scherbe')).toBe(true);
    expect(effectiveTier(1, 'glutsand')).toBe(BALANCE.spawn.biomeTier.glutsand);
    expect(effectiveTier(2, 'gruenhain')).toBe(2);
    expect(effectiveTier(2, null)).toBe(2);
  });

  it('geseedet; mehrere Ziehungen desselben Stücks addieren sich', () => {
    const a = drawLoot(table, 0, new Rng(9));
    const b = drawLoot(table, 0, new Rng(9));
    expect(a).toEqual(b);
    expect(new Set(a.map((d) => d.item)).size).toBe(a.length);
    expect(a.reduce((n, d) => n + (d.item === 'fell' ? d.count / 2 : d.count), 0)).toBe(2);
  });

  it('Zerlegen: jede Ausbeute mit ihrer Chance', () => {
    const rng = new Rng(5);
    let sinew = 0;
    for (let i = 0; i < 2000; i++) {
      const y = carveYield(table, rng);
      expect(y.find((d) => d.item === 'fell')?.count).toBe(1);
      if (y.some((d) => d.item === 'sehnen')) sinew++;
    }
    expect(sinew / 2000).toBeCloseTo(0.25, 1);
  });

});

/** The enemies that are animals: they leave a carcass to carve, like the peaceful game (§14 "Jagen & Zerlegen"). */
const ENEMY_ANIMALS = ['keiler', 'dachs', 'wolf', 'scherenkrebs'] as const;
/** The one creature without a loot table (docs/SPIEL.md §11 "außer Glühwürmchen: begründet leer erlaubt per Feld"). */
const WITHOUT_LOOT = ['gluehwuermchen'] as const;

describe('Beutetabellen des ganzen Inhalts (alle Kreaturengruppen)', () => {
  it('jede Kreatur hat ihre Beutetabelle – außer dem Glühwürmchen; jede Tabelle gehört zu einer Kreatur', () => {
    // The registry, not one group: the 22 creatures of M6 (core, Grünhain, Salzküste and the shadow brood), none lost; every
    // later one is a canonical id of M7 (docs/SPIEL.md §29; tests/unit/content/stand.ts, ADR-0208) and has its table like them.
    expect(CREATURES.filter((c) => m6Ids('creatures').includes(c.id))).toHaveLength(22);
    expect(missingM6('creatures')).toEqual([]);
    expect(undocumentedSinceM6('creatures')).toEqual([]);
    expect(CREATURES.filter((c) => c.beute === null).map((c) => c.id)).toEqual([...WITHOUT_LOOT]);
    for (const c of CREATURES) if (c.beute !== null) expect(LOOT_TABLES.some((t) => t.id === c.beute), c.id).toBe(true);
    expect(LOOT_TABLES.map((t) => t.id).sort()).toEqual(CREATURES.filter((c) => c.beute !== null).map((c) => c.id).sort());
  });

  it('Tiere hinterlassen Kadaver und keine Beute, Schattenbrut und die übrigen Feinde Beute und keinen Kadaver – je Familie', () => {
    for (const c of CREATURES) {
      const t = LOOT_TABLES.find((x) => x.id === c.beute);
      if (t === undefined) continue;
      const carcass = c.familie === 'friedlich' || (c.familie === 'gegner' && (ENEMY_ANIMALS as readonly string[]).includes(c.id));
      if (carcass) {
        expect(t.zerlegen.length, c.id).toBeGreaterThan(0);
        expect(t.ziehungen, c.id).toEqual([0, 0]);
        expect(t.beute, c.id).toEqual([]);
      } else {
        expect(t.zerlegen, c.id).toEqual([]);
        expect(t.beute.length, c.id).toBeGreaterThan(0);
        expect(t.ziehungen[0], c.id).toBeGreaterThanOrEqual(1);
      }
    }
    expect(CREATURES.filter((c) => c.familie === 'schattenbrut').map((c) => c.id)).toEqual(['nachtmahr', 'schleicher', 'kriecher', 'speier', 'lichtfresser']);
  });

  it('kein Feind lässt fallen, was die Welt zum Sammeln oder Graben bietet (ADR-0105)', () => {
    const index = buildItemIndex(CONTENT);
    const worldMaterial = (item: string): boolean =>
      (index.sources.get(item) ?? []).some((raw) => {
        const s = parseItemSource(raw);
        return s !== null && (s.kind === 'welt' || s.kind === 'graben');
      });
    const offenders: string[] = [];
    for (const c of CREATURES) {
      if (c.familie === 'friedlich') continue;
      const t = LOOT_TABLES.find((x) => x.id === c.beute);
      if (t === undefined) continue;
      for (const e of [...t.beute, ...t.zerlegen]) if (worldMaterial(e.item)) offenders.push(`${c.id}: ${e.item}`);
    }
    expect(offenders).toEqual([]);
    // The rule's own check: flint, salt and driftwood are world material.
    expect(['feuerstein', 'salz', 'treibholz'].every(worldMaterial)).toBe(true);
  });
});

describe('Kadaver und Zerlegen im Spiel (M6-30)', () => {
  function killedHare(): { w: ReturnType<typeof kreaturWelt>; carcass: number } {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.creature('hase', 21, 15);
    const ev = w.run(1, [{ type: 'creature.kill', radius: 3 }]);
    const died = eventsOf<SimEventMap['creatureDied']>(ev, 'creatureDied')[0];
    expect(died?.creature).toBe('hase');
    expect(died?.loot).toBe(false);
    expect(died?.carcass).not.toBe(NULL_ENTITY);
    expect(w.spilled).toEqual([]);
    return { w, carcass: died?.carcass as number };
  }

  it('E mit Messer zerlegt den Kadaver: Fleisch und Fell als Drops, Erfahrung, das Messer nutzt ab', () => {
    const { w, carcass } = killedHare();
    w.hold('steinmesser');
    const durability = w.inventory.selected()?.haltbarkeit;
    const xp = w.life.skills.skill('sammeln').xp;
    const ev = w.run(1, [{ type: 'carcass.carve', carcass }]);
    const carved = eventsOf<SimEventMap['carcassCarved']>(ev, 'carcassCarved')[0];
    expect(carved?.creature).toBe('hase');
    const items = w.spilled.map((s) => s.stack.item);
    expect(items).toContain('wildfleisch_roh');
    expect(items).toContain('fell');
    expect(carved?.pieces).toBe(w.spilled.reduce((n, s) => n + s.stack.count, 0));
    expect(w.creatures.carcasses.has(carcass)).toBe(false);
    expect(w.life.skills.skill('sammeln').xp).toBeGreaterThan(xp);
    expect(w.inventory.selected()?.haltbarkeit).toBeLessThan(durability as number);
  });

  it('ohne Messer, zu weit weg oder ohne Kadaver nicht – der Hinweis nennt das Messer', () => {
    const { w, carcass } = killedHare();
    const reject = (type: string) => eventsOf<SimEventMap['commandRejected']>(w.run(1, [{ type: 'carcass.carve', carcass }]), 'commandRejected').map((r) => r.reason)[0] ?? type;
    expect(reject('ok')).toBe('noKnife');
    const c = w.creatures.carcasses.get(carcass);
    const offer = createUseOffer();
    const { tx, ty } = tileOf({ x: c?.x ?? 0, y: c?.y ?? 0 });
    expect(carcassUses(w.creatures).offer(w.sim, 0, tx, ty, offer)).toBe(true);
    expect(offer).toMatchObject({ action: 'zerlegen', subject: 'hase', block: 'keinMesser' });
    w.hold('steinmesser');
    expect(carcassUses(w.creatures).offer(w.sim, 0, tx, ty, offer)).toBe(true);
    expect(offer.block).toBeNull();
    w.run(1, [{ type: 'player.teleport', x: w.pos().x + 5 * TILE_PX, y: w.pos().y, layer: 0 }]);
    expect(reject('ok')).toBe('tooFar');
    const none = eventsOf<SimEventMap['commandRejected']>(w.run(1, [{ type: 'carcass.carve', carcass: carcass + 1000 }]), 'commandRejected');
    expect(none[0]?.reason).toBe('noCarcass');
  });

  it('E auf dem Kadaver zerlegt ihn über die Interaktion', () => {
    const { w, carcass } = killedHare();
    w.hold('steinmesser');
    const c = w.creatures.carcasses.get(carcass);
    const { tx, ty } = tileOf({ x: c?.x ?? 0, y: c?.y ?? 0 });
    carcassUses(w.creatures).use(w.sim, 0, tx, ty, w.sim.eventTick);
    expect(w.creatures.carcasses.has(carcass)).toBe(false);
    expect(w.spilled.length).toBeGreaterThan(0);
  });

  it('unzerlegt verwest er nach seiner Zeit', () => {
    const { w, carcass } = killedHare();
    const c = w.creatures.carcasses.get(carcass);
    expect(c?.untilTick).toBe(w.sim.tick - 1 + Math.round(BALANCE.creatures.hunting.carcassGameHours * w.sim.clock.ticksPerGameHour));
    (c as { untilTick: number }).untilTick = w.sim.tick + 1;
    const ev = w.run(BALANCE.time.tickHz * 2);
    expect(eventsOf<SimEventMap['carcassRotted']>(ev, 'carcassRotted')[0]?.carcass).toBe(carcass);
    expect(w.creatures.carcasses.has(carcass)).toBe(false);
  });
});
