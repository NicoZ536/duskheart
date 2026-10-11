/**
 * M7-48 Perks der Nicht-Kampf-Fertigkeiten (MASTERPROMPT §23.2 "Bei 30/60/90 Wahl zwischen 2 Perks → 72 Perks, alle spürbar
 * (keine reinen +1-%-Perks)"; docs/SPIEL.md §23 "Perks M7"): je 6 für Holzfällen, Bergbau, Sammeln & Kräuter, Handwerk,
 * Schmieden, Kochen & Brauen und Überleben; `PerkEffects` summiert die gewählten; jeder Haken (gathering, crafting, stations,
 * vitals, player, die Modifikatoren des Spielers, der Ess-Haken) ändert, was der Spieler merkt – gegen dieselbe Welt ohne Perk.
 * Die Kampf-Perks prüft perks-kampf.test.ts; der Validator zählt alle (`perks` ≥ 60).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { COMBAT_PERK_SKILLS, PERK_EFFECTS, PERKS, type PerkEffect } from '../../../src/content/perks';
import { PERKS_M7 } from '../../../src/content/perksM7';
import { STATIONS } from '../../../src/content/stations';
import type { Nutrition } from '../../../src/game/actions/hooks';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { newStack } from '../../../src/game/items/stack';
import type { SkillState } from '../../../src/game/skills/state';
import { addPerkYield, harvestPowerPerk, NO_PERK_EFFECTS, perkEatHook, perkExtraPieces, perkFactor, PerkEffects, perkModifierSource, type PerkEffectsApi } from '../../../src/game/skills/perkEffects';
import { createPlayerModifiers } from '../../../src/game/survival/modifiers';
import { NULL_ENTITY } from '../../../src/engine/ecs';
import { field, gatherWorld, type GatherWorld } from './interaktion-testwelt';
import { eventsOf, stationWorld, TICK_HZ } from './stationen-testwelt';
import { meadow, testWorld } from './spieler-testwelt';

/** The seven non-combat skills with perks (docs/SPIEL.md §23 "Perks M7"). */
const M7_SKILLS = ['holzfaellen', 'bergbau', 'sammeln', 'handwerk', 'schmieden', 'kochen', 'ueberleben'] as const;
/** The effect kinds of M7-48 (after the combat kinds in `PERK_EFFECTS`). */
const M7_KINDS = PERK_EFFECTS.slice(PERK_EFFECTS.indexOf('holz_kraft'));
const catalog = contentItemCatalog();

/** A perk source with fixed values (the hooks of one system, without the skill system). */
function fixed(values: Partial<Record<PerkEffect, number>>): PerkEffectsApi {
  return { value: (e) => values[e] ?? 0 };
}

/** Skills with exactly the perks `ids` chosen (level 100). */
function chosen(...ids: string[]): { skill(id: string): Readonly<SkillState> } {
  const perks = ids.map((id) => {
    const p = PERKS.find((x) => x.id === id);
    if (p === undefined) throw new Error(`no perk ${id}`);
    return p;
  });
  return { skill: (s) => ({ level: BALANCE.skills.maxLevel, xp: 0, perks: perks.filter((p) => p.fertigkeit === s).map((p) => ({ level: p.stufe, choice: p.wahl })) }) };
}

describe('Perk-Inhalt M7', () => {
  it('42 Perks: je 6 für die sieben Fertigkeiten, je Perkstufe genau die Wahlen 0 und 1; mit dem Kampf 60, der Validator zählt sie', () => {
    expect(PERKS_M7).toHaveLength(42);
    for (const skill of M7_SKILLS) {
      const own = PERKS.filter((p) => p.fertigkeit === skill);
      expect(own, skill).toHaveLength(6);
      for (const level of BALANCE.skills.perkLevels) expect(own.filter((p) => p.stufe === level).map((p) => p.wahl).sort(), `${skill} ${level}`).toEqual([0, 1]);
    }
    expect(PERKS.filter((p) => !(COMBAT_PERK_SKILLS as readonly string[]).includes(p.fertigkeit))).toHaveLength(42);
    expect(CONTENT.countsByCategory().perks).toBeGreaterThanOrEqual(60);
    const ziele = JSON.parse(readFileSync('tools/validator/zielwerte.json', 'utf8')) as { ziele: Record<string, number> };
    expect(ziele.ziele.perks).toBeGreaterThanOrEqual(60);
    expect(CONTENT.countsByCategory().perks).toBeGreaterThanOrEqual(ziele.ziele.perks as number);
  });

  it('alle spürbar: jede M7-Wirkungsart wird genutzt, jeder Wert ist groß genug, um ihn zu merken, jede Beschreibung nennt ihn', () => {
    expect(new Set(PERKS_M7.flatMap((p) => p.wirkung.map((w) => w.art)))).toEqual(new Set(M7_KINDS));
    for (const p of PERKS_M7) {
      for (const w of p.wirkung) {
        const v = Math.abs(w.wert);
        // Fractions and chances at least 15 %, levels at least 10, degrees at least 3 – no "+1 %" perk (§23.2).
        const least = w.art === 'handwerk_qualitaet' ? 10 : w.art === 'ueberleben_kaelte' || w.art === 'ueberleben_hitze' ? 3 : 0.15;
        expect(v, `${p.id} ${w.art}`).toBeGreaterThanOrEqual(least);
      }
      expect(p.beschreibung.de, p.id).toMatch(/\d|doppelt|halben/);
      expect(p.beschreibung.en, p.id).toMatch(/\d|twice|half/);
      expect(p.name.de.length * p.name.en.length, p.id).toBeGreaterThan(0);
    }
  });
});

describe('PerkEffects', () => {
  it('summiert die gewählten Perks einer Wirkungsart über die Stufen; nicht gewählte und die andere Wahl zählen nicht', () => {
    expect(new PerkEffects(chosen()).value('holz_kraft')).toBe(0);
    const e = new PerkEffects(chosen('kraftvolle_hiebe', 'holzhauer', 'genuegsam'));
    expect(e.value('holz_kraft')).toBeCloseTo(0.9, 12);
    expect(e.value('holz_ertrag')).toBeCloseTo(0.2, 12);
    expect(e.value('ueberleben_hunger')).toBeCloseTo(-0.3, 12);
    expect(e.value('holz_nachwuchs')).toBe(0);
    expect(new PerkEffects(chosen('reiche_staemme')).value('holz_kraft')).toBe(0);
    // Factors never fall below BALANCE.perkEffects.minFactor: Genügsam and Wildniskind make −70 % (×0,3).
    expect(perkFactor(new PerkEffects(chosen('genuegsam', 'wildniskind')), 'ueberleben_hunger')).toBeCloseTo(0.3, 12);
    expect(perkFactor(new PerkEffects(chosen('leiser_schritt', 'schattengaenger')), 'ueberleben_schleichen')).toBe(BALANCE.perkEffects.minFactor);
    expect(perkFactor(NO_PERK_EFFECTS, 'ueberleben_hunger')).toBe(1);
  });

  it('reine Bausteine: Trefferkraft je Fertigkeit (im Stollen mehr), +1 je Sorte nur mit Chance > 0, Extra-Stücke je Stück', () => {
    const p = fixed({ holz_kraft: 0.5, abbau_kraft: 0.3, abbau_stollen: 1, sammel_graben: 0.4 });
    expect([harvestPowerPerk(p, 'holzfaellen', false), harvestPowerPerk(p, 'bergbau', false), harvestPowerPerk(p, 'bergbau', true), harvestPowerPerk(p, 'sammeln', false), harvestPowerPerk(p, 'landwirtschaft', false)]).toEqual([0.5, 0.3, 1.3, 0.4, 0]);
    const drops = [{ item: 'holz', count: 4 }, { item: 'rinde', count: 1 }];
    let rolls = 0;
    addPerkYield(drops, 0, () => (rolls++, 0));
    expect(rolls).toBe(0);
    addPerkYield(drops, 0.5, () => (rolls++ === 0 ? 0.1 : 0.9));
    expect(drops).toEqual([{ item: 'holz', count: 5 }, { item: 'rinde', count: 1 }]);
    expect(perkExtraPieces(10, 0, () => 0)).toBe(0);
    expect(perkExtraPieces(4, 0.25, (() => { const r = [0.1, 0.3, 0.2, 0.9]; let i = 0; return () => r[i++] as number; })())).toBe(2);
  });
});

describe('Haken: Sammeln und Abbau (gathering)', () => {
  /** A meadow with an oak (2 tiles wide) at map (5, 5); the player beside it with the stone axe. */
  function oak(perks: PerkEffectsApi): GatherWorld {
    const w = gatherWorld(field(14, 12, ['', '', '', '', '', '.....E']));
    w.gathering.usePerkEffects(perks);
    w.spawn(5, 7);
    w.hold('probe_steinaxt');
    return w;
  }
  function fell(w: GatherWorld): Record<string, number> {
    w.runUntil(() => !w.interaction.working, 600, [{ type: 'player.interact', on: true }]);
    w.run(1, [{ type: 'player.interact', on: false }]);
    w.run(2 * TICK_HZ);
    const out: Record<string, number> = {};
    for (const d of w.dropList()) out[d.item] = (out[d.item] ?? 0) + d.count;
    return out;
  }

  it('Kraftvolle Hiebe / Meister der Axt: die Eiche fällt nach 4 bzw. 3 statt 5 Hieben', () => {
    for (const [kraft, hits] of [[0, 5], [0.5, 4], [1, 3]] as const) {
      const w = oak(fixed({ holz_kraft: kraft }));
      w.run(1, [{ type: 'player.interact', on: true }]);
      expect(w.interaction.focus.hitsTotal, `holz_kraft ${kraft}`).toBe(hits);
    }
  });

  it('Reiche Stämme: jede Sorte des gefällten Baums ein Stück mehr (Chance 1); Förster: der Stumpf wächst in der halben Zeit nach', () => {
    const plain = oak(NO_PERK_EFFECTS);
    const base = fell(plain);
    const rich = fell(oak(fixed({ holz_ertrag: 1 })));
    expect(Object.keys(rich).sort()).toEqual(Object.keys(base).sort());
    for (const item of Object.keys(base)) expect(rich[item], item).toBe((base[item] as number) + 1);
    const regrow = (w: GatherWorld): number => {
      const { chunk, i } = w.at(5, 5);
      return (chunk.objectState.get(i)?.regrowAtTick ?? 0) - w.sim.tick;
    };
    const forester = oak(fixed({ holz_nachwuchs: -0.5 }));
    fell(forester);
    expect(regrow(forester) / regrow(plain)).toBeCloseTo(0.5, 2);
  });
});

describe('Haken: Handwerk, Schmieden, Kochen (crafting, stations)', () => {
  it('Heiße Esse: der Amboss schmiedet 50 % schneller; Sparsamer Schmied (Chance 1): der Bronzebarren kommt zurück', () => {
    const run = (perks: PerkEffectsApi): { ticks: number; barren: number; naegel: number } => {
      const w = stationWorld();
      w.crafting.usePerkEffects(perks);
      w.place('amboss_bronze', 5, 3);
      w.give('bronzebarren', 1);
      w.run(1);
      const ev = w.run(BALANCE.crafting.durationSeconds.werkzeug * TICK_HZ + 2, [{ type: 'craft.start', recipe: 'rezept_nagel_bronze', count: 1 }]);
      return { ticks: eventsOf<{ ticks: number }>(ev, 'craftStarted')[0]?.ticks ?? 0, barren: w.has('bronzebarren'), naegel: w.has('nagel_bronze') };
    };
    const base = run(NO_PERK_EFFECTS);
    expect(base).toMatchObject({ barren: 0, naegel: 8 });
    const fast = run(fixed({ schmied_tempo: 0.5 }));
    expect(fast.ticks / base.ticks).toBeCloseTo(1 / 1.5, 1);
    expect(run(fixed({ schmied_sparen: 1 }))).toMatchObject({ barren: 1, naegel: 8 });
    // Handwerk's tempo does not touch the anvil, Schmieden's not the hand.
    expect(run(fixed({ handwerk_tempo: 1 })).ticks).toBe(base.ticks);
  });

  it('Feinarbeit: die Steinaxt aus der Hand bekommt einen Stern mehr; Geschickte Hände: schneller', () => {
    const run = (perks: PerkEffectsApi): { ticks: number; stars: number } => {
      const w = stationWorld();
      w.crafting.usePerkEffects(perks);
      w.give('zweig', 2);
      w.give('stein', 2);
      w.give('faserseil', 1);
      const ev = w.run(BALANCE.crafting.durationSeconds.werkzeug * TICK_HZ + 2, [{ type: 'craft.start', recipe: 'rezept_steinaxt', count: 1 }]);
      return { ticks: eventsOf<{ ticks: number }>(ev, 'craftStarted')[0]?.ticks ?? 0, stars: eventsOf<{ qualitaet: number }>(ev, 'craftCompleted')[0]?.qualitaet ?? 0 };
    };
    const base = run(NO_PERK_EFFECTS);
    expect(base.stars).toBe(1);
    expect(run(fixed({ handwerk_qualitaet: 40 })).stars).toBe(2);
    expect(run(fixed({ handwerk_tempo: 0.5 })).ticks / base.ticks).toBeCloseTo(1 / 1.5, 1);
  });

  it('Reiche Schmelze / Vorratskoch (Chance 1): wer Barren aus dem Schmelzofen und Brot aus dem Backofen nimmt, bekommt je Stück eins dazu', () => {
    const take = (perks: PerkEffectsApi, station: string, item: string): number => {
      const w = stationWorld();
      w.stations.usePerkEffects(perks);
      const id = w.place(station, 6, 5);
      const proc = w.stations.station(id)?.proc;
      if (proc === null || proc === undefined) throw new Error('no slots');
      proc.ausgang[0] = { ...newStack(catalog.get(item), 3) };
      w.run(1, [{ type: 'station.takeAll', station: id }]);
      return w.has(item);
    };
    expect(take(NO_PERK_EFFECTS, 'schmelzofen', 'kupferbarren')).toBe(3);
    expect(take(fixed({ schmied_ausbeute: 1 }), 'schmelzofen', 'kupferbarren')).toBe(6);
    // The oven bakes for Kochen (its experience is `gericht_gekocht`): Schmieden's perk does nothing there.
    expect(STATIONS.find((s) => s.id === 'backofen')?.erfahrung).toBe('gericht_gekocht');
    expect(take(fixed({ schmied_ausbeute: 1 }), 'backofen', 'brot')).toBe(3);
    expect(take(fixed({ koch_portion: 1 }), 'backofen', 'brot')).toBe(6);
  });

  it('Große Portionen: ein Gericht macht 30 % satter, rohe Beeren nicht', () => {
    const hook = perkEatHook(fixed({ koch_saettigung: 0.3 }));
    const eat = (item: string): Nutrition => {
      const out: Nutrition = { satiety: 20, thirst: 0, fearRelief: 0 };
      const def = catalog.get(item);
      hook.nutrition?.(null as never, { item, def, stack: newStack(def, 1), tick: 0 }, out);
      return out;
    };
    expect(catalog.get('eintopf').mahlzeit).toBeDefined();
    expect(eat('eintopf').satiety).toBeCloseTo(26, 12);
    expect(eat('himbeeren').satiety).toBe(20);
  });
});

describe('Haken: Überleben (vitals, player, Modifikatoren)', () => {
  it('Genügsam: Hunger und Durst sinken 30 % langsamer', () => {
    const drain = (perks: PerkEffectsApi): { satiety: number; thirst: number } => {
      const w = testWorld(meadow(10, 10));
      w.vitals.usePerkEffects(perks);
      w.spawn(5, 5);
      const v0 = { ...w.vit() };
      w.run(10 * TICK_HZ);
      return { satiety: v0.satiety - w.vit().satiety, thirst: v0.thirst - w.vit().thirst };
    };
    const base = drain(NO_PERK_EFFECTS);
    const frugal = drain(fixed({ ueberleben_hunger: -0.3, ueberleben_durst: -0.3 }));
    expect(base.satiety).toBeGreaterThan(0);
    expect(frugal.satiety / base.satiety).toBeCloseTo(0.7, 6);
    expect(frugal.thirst / base.thirst).toBeCloseTo(0.7, 6);
  });

  it('Ausdauerschwimmer: Schwimmen kostet 60 % weniger Ausdauer; Leiser Schritt: schleichend 60 % leiser', () => {
    // A lake (rows 0–2) with a shallow shore: the player wades in and treads water.
    const lake = ['wwwwwwwwww', 'wwwwwwwwww', 'wwwwwwwwww', 'ssssssssss', 'ssssssssss'];
    const swim = (perks: PerkEffectsApi): number => {
      const w = testWorld(lake);
      w.player.usePerkEffects(perks);
      w.spawn(4, 4);
      w.run(TICK_HZ, [{ type: 'player.move', dx: 0, dy: -1 }]);
      expect(w.body().swimming).toBe(true);
      const s0 = w.vit().stamina;
      w.run(TICK_HZ, [{ type: 'player.move', dx: 0, dy: 0 }]);
      return s0 - w.vit().stamina;
    };
    const base = swim(NO_PERK_EFFECTS);
    expect(base).toBeGreaterThan(0);
    expect(base).toBeCloseTo(BALANCE.survival.stamina.swimPerSecond, 6);
    expect(swim(fixed({ ueberleben_schwimmen: -0.6 })) / base).toBeCloseTo(0.4, 6);
    const sneak = (perks: PerkEffectsApi): number => {
      const w = testWorld(meadow(12, 6));
      w.player.usePerkEffects(perks);
      w.spawn(2, 3);
      w.run(5, [{ type: 'player.sneak', on: true }, { type: 'player.move', dx: 1, dy: 0 }]);
      expect(w.body().state).toBe('sneak');
      return w.body().noise;
    };
    expect(sneak(fixed({ ueberleben_schleichen: -0.6 })) / sneak(NO_PERK_EFFECTS)).toBeCloseTo(0.4, 9);
  });

  it('Abgehärtet: +5 °C Isolation und Kühlung über die Modifikatoren des Spielers', () => {
    const m = createPlayerModifiers();
    perkModifierSource(fixed({ ueberleben_kaelte: 5, ueberleben_hitze: 5 }))(null as never, NULL_ENTITY, m);
    expect([m.insulation, m.cooling]).toEqual([5, 5]);
  });
});
