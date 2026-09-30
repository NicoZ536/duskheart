/**
 * M6-11 Waffen T0–T1 aller Klassen, M6-08 Wurfmesser und Brandflasche, M6-09 Holz- und Bronzeschild, Munition (MASTERPROMPT
 * §19.2, §D "Waffenschaden Basis je Stufe × Klassenfaktor", "Haltbarkeit"; docs/SPIEL.md §14 "Waffen T0 (11) … T1 (11)",
 * "Munition", "Schilde"): the canonical weapons exist with their `waffe` blocks and count as weapons (22), their damage
 * follows §D, every class has a T0 and a T1 weapon (the crossbow T1 only, the sling T0 only), every ranged class its
 * ammunition, the recipes stand at the stations of their tier, and the real items fight as their class in the combat
 * system (a blow, a shot, a throw that sets the ground alight, a shield's block).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { RECIPES } from '../../../src/content/recipes/index';
import type { ItemDef } from '../../../src/content/schema/item';
import { hitDamage, secondsToTicks, weaponDamage } from '../../../src/game/combat/formulas';
import { createAttackProfile, resolveProfile } from '../../../src/game/combat/weapons';
import { contentItemCatalog } from '../../../src/game/items/catalog';
import { newStack } from '../../../src/game/items/stack';
import { eventsOf, kampfWelt } from './kampf-testwelt';

const catalog = contentItemCatalog();
const W_T0 = ['feuersteinklinge', 'steinkampfaxt', 'holzkeule', 'knochenkeule', 'steinspeer', 'knochendolch', 'felsbrecher', 'kurzbogen', 'schleuder', 'wurfmesser_feuerstein', 'brandflasche'];
const W_T1 = ['bronzeschwert', 'bronzekampfaxt', 'bronzestreitkolben', 'bronzespeer', 'bronzedolch', 'bronzezweihaender', 'bronzegrossaxt', 'bronzekriegshammer', 'kompositbogen', 'armbrust', 'wurfmesser_bronze'];
const AMMO = ['pfeil_feuerstein', 'pfeil_bronze', 'pfeil_stumpf', 'pfeil_feuer', 'pfeil_gift', 'pfeil_leucht', 'bolzen_bronze', 'schleuderstein'];

function def(id: string): ItemDef {
  return catalog.get(id);
}

function waffe(id: string): NonNullable<ItemDef['waffe']> {
  const w = def(id).waffe;
  if (w === undefined) throw new Error(`${id} has no waffe block`);
  return w;
}

describe('kanonische Waffen (docs/SPIEL.md §14)', () => {
  it('11 Waffen T0 und 11 T1, alle mit Angriffsdaten; der Validator zählt 22 Waffen', () => {
    for (const [ids, tier] of [
      [W_T0, 0],
      [W_T1, 1],
    ] as const) {
      expect(ids).toHaveLength(11);
      for (const id of ids) {
        expect(def(id).stufe, id).toBe(tier);
        expect(def(id).waffe, id).toBeDefined();
      }
    }
    const weapons = CONTENT.collection('items')
      .values()
      .filter((i) => i.waffe !== undefined)
      .map((i) => i.id);
    expect(new Set(weapons)).toEqual(new Set([...W_T0, ...W_T1]));
    expect(CONTENT.countsByCategory().weapons).toBe(22);
  });

  it('Schaden nach §D (Grundschaden der Stufe × Klassenfaktor), im Tooltip derselbe Wert; Haltbarkeit der Stufe', () => {
    for (const id of [...W_T0, ...W_T1]) {
      const d = def(id);
      const w = waffe(id);
      if (id !== 'brandflasche') expect(w.schaden, id).toBeCloseTo(weaponDamage(d.stufe, w.klasse), 9);
      if (d.kategorie === 'waffe') {
        expect(d.werte?.schaden, id).toBe(w.schaden);
        expect(d.haltbarkeit, id).toBe(BALANCE.items.durabilityByTier[d.stufe]);
        expect(d.stapel, id).toBe(1);
      } else {
        expect(d.kategorie, id).toBe('munition');
        expect(w.klasse, id).toBe('wurf');
        expect(d.stapel, id).toBe(BALANCE.items.stack.munition);
      }
    }
  });

  it('jede Nahkampfklasse hat eine T0- und eine T1-Waffe; Bogen und Wurf auch, Schleuder T0, Armbrust T1', () => {
    const classes = (ids: readonly string[]): Set<string> => new Set(ids.map((id) => waffe(id).klasse));
    for (const k of ['schwert', 'axt', 'keule', 'speer', 'dolch', 'zweihand', 'bogen', 'wurf']) {
      expect(classes(W_T0).has(k), `T0 ${k}`).toBe(true);
      expect(classes(W_T1).has(k), `T1 ${k}`).toBe(true);
    }
    expect(classes(W_T0).has('schleuder')).toBe(true);
    expect(classes(W_T1).has('armbrust')).toBe(true);
  });

  it('Klassenregeln: Kampfäxte fällen Bäume (Werkzeug Axt der Stufe), Schwerter kombinieren, Speere werfen, Zweihänder sind breit und langsam', () => {
    for (const id of ['steinkampfaxt', 'bronzekampfaxt']) {
      expect(def(id).werkzeug).toEqual({ art: 'axt', abbaukraft: BALANCE.tools.miningPowerByTier[def(id).stufe] });
      expect(waffe(id).schwer).toBe('ruestungsbruch');
    }
    for (const id of ['feuersteinklinge', 'bronzeschwert']) expect(waffe(id)).toMatchObject({ kombo: [1, 1, 1.5], schwer: 'rundumhieb' });
    for (const id of ['steinspeer', 'bronzespeer']) expect(waffe(id).schwer).toBe('wurf');
    const sword = waffe('bronzeschwert');
    for (const id of ['felsbrecher', 'bronzezweihaender', 'bronzegrossaxt', 'bronzekriegshammer']) {
      expect(waffe(id).bogen, id).toBeGreaterThan(sword.bogen);
      expect(waffe(id).tempo, id).toBeGreaterThan(sword.tempo);
    }
    expect(waffe('bronzedolch').tempo).toBeLessThan(sword.tempo);
    expect(waffe('bronzespeer').reichweite).toBeGreaterThan(sword.reichweite);
  });
});

describe('Munition und Schilde', () => {
  it('jede Munition gehört zu einer Fernwaffe, die es gibt; Feuer brennt, Gift vergiftet, Leucht leuchtet 3 Kacheln 60 s', () => {
    const shooters = new Set([...W_T0, ...W_T1].map((id) => waffe(id).klasse));
    for (const id of AMMO) {
      const m = def(id).munition;
      expect(m, id).toBeDefined();
      expect(shooters.has(m?.fuer ?? 'bogen'), id).toBe(true);
    }
    expect(def('pfeil_feuer').munition?.zustand).toMatchObject({ id: 'brennen', chance: 1 });
    expect(def('pfeil_gift').munition?.zustand).toMatchObject({ id: 'vergiftung', chance: 1 });
    expect(def('pfeil_leucht').munition?.licht).toEqual({ radius: 3, sekunden: 60 });
    expect(def('schleuderstein').munition?.fuer).toBe('schleuder');
    expect(def('bolzen_bronze').munition?.fuer).toBe('armbrust');
  });

  it('Holzschild 40 %, Bronzeschild 60 % Blockkraft, beide in der Nebenhand', () => {
    expect(def('holzschild')).toMatchObject({ kategorie: 'schild', ausruestung: 'nebenhand', stufe: 0, schild: { blockkraft: 0.4 }, werte: { blockkraft: 0.4 } });
    expect(def('bronzeschild')).toMatchObject({ kategorie: 'schild', ausruestung: 'nebenhand', stufe: 1, schild: { blockkraft: 0.6 }, werte: { blockkraft: 0.6 } });
  });
});

describe('Rezepte an den Stationen ihrer Stufe', () => {
  const recipeOf = (id: string) => RECIPES.find((r) => r.ergebnis.item === id);

  it('jede Waffe, Munition und jeder Schild hat ein Rezept; T0 an Werkbank I oder Steinmetzbank, T1 am Bronzeamboss oder an Werkbank II', () => {
    for (const id of [...W_T0, ...W_T1, ...AMMO, 'holzschild', 'bronzeschild']) {
      const r = recipeOf(id);
      expect(r, id).toBeDefined();
      if (id === 'steinspeer') continue;
      const allowed = def(id).stufe === 0 ? ['werkbank', 'steinmetzbank'] : ['amboss_bronze', 'werkbank_2'];
      expect(allowed, `${id} at ${r?.station}`).toContain(r?.station);
    }
  });

  it('Giftpfeile aus Fliegenpilz, Leuchtpfeile aus Leuchtpilz, Pfeile mit Federn aus der Jagd', () => {
    const items = (id: string): string[] => (recipeOf(id)?.zutaten ?? []).flatMap((z) => ('item' in z ? [z.item] : []));
    expect(items('pfeil_gift')).toContain('fliegenpilz');
    expect(items('pfeil_leucht')).toContain('leuchtpilz');
    expect(items('pfeil_feuerstein')).toContain('federn');
    expect(items('knochendolch')).toContain('knochen');
    expect(items('kompositbogen')).toEqual(expect.arrayContaining(['knochen', 'sehnen']));
  });
});

describe('die echten Waffen im Kampfsystem', () => {
  it('das Profil jeder Waffe ist das ihrer Klasse und ihrer Daten', () => {
    const p = createAttackProfile();
    for (const id of [...W_T0, ...W_T1]) {
      const d = def(id);
      const w = waffe(id);
      resolveProfile(d, newStack(d, 1), p);
      expect(p, id).toMatchObject({ item: id, klasse: w.klasse, art: w.schadensart, damage: w.schaden, reach: w.reichweite, source: 'waffe' });
    }
  });

  it('Bronzeschwert: ein leichter Hieb trifft mit 12 Schaden', () => {
    const k = kampfWelt();
    k.hold('bronzeschwert');
    k.aimBy(20, 0);
    const d = k.dummy(14, 0);
    const w = waffe('bronzeschwert');
    k.run(Math.max(1, secondsToTicks(w.tempo * BALANCE.combat.attack.windupShare)) + 1, [
      { type: 'combat.attack', on: true },
      { type: 'combat.attack', on: false },
    ]);
    expect(d.hits[0]).toMatchObject({ type: 'hieb', amount: expect.closeTo(d.hits[0]?.crit === true ? 12 * BALANCE.combat.damage.critFactor : 12, 6) });
  });

  it('Kurzbogen mit Feuersteinpfeilen: voll gespannt fliegt der Pfeil mit Waffen- plus Pfeilschaden', () => {
    const k = kampfWelt();
    k.hold('kurzbogen');
    k.pack('pfeil_feuerstein', 4);
    k.aimBy(100, 0);
    k.run(secondsToTicks(BALANCE.combat.ranged.bowDrawSeconds), [{ type: 'combat.attack', on: true }]);
    const ev = k.run(1, [{ type: 'combat.attack', on: false }]);
    expect(eventsOf(ev, 'projectileFired')).toEqual([expect.objectContaining({ item: 'pfeil_feuerstein', klasse: 'bogen' })]);
    expect(k.combat.projectiles.columns.damage[0]).toBeCloseTo(waffe('kurzbogen').schaden + (def('pfeil_feuerstein').munition?.schaden ?? 0), 5);
    expect(k.inventory.count('pfeil_feuerstein')).toBe(3);
  });

  it('Brandflasche: im Bogen geworfen setzt sie Ziel und Boden in Brand', () => {
    const k = kampfWelt();
    k.hold('brandflasche', 2);
    k.aimBy(80, 0);
    const d = k.dummy(80, 0);
    k.run(secondsToTicks(BALANCE.combat.ranged.throwDrawSeconds), [{ type: 'combat.attack', on: true }]);
    k.run(1, [{ type: 'combat.attack', on: false }]);
    for (let i = 0; i < 200 && k.combat.projectiles.size > 0; i++) k.run(1);
    expect(d.hits[0]).toMatchObject({ type: 'feuer', condition: 'brennen' });
    expect(k.ignited.length).toBeGreaterThan(0);
    expect(k.ignited.every((t) => t.cause === 'brandflasche')).toBe(true);
    expect(k.inventory.count('brandflasche')).toBe(1);
  });

  it('Bronzeschild: blockt 60 % eines Treffers', () => {
    const k = kampfWelt();
    k.offhand('bronzeschild');
    k.aimBy(30, 0);
    const foe = k.dummy(12, 0);
    k.run(20, [{ type: 'combat.block', on: true }]);
    expect(k.strikePlayer(foe, { critChance: 0, damage: 10 })?.amount).toBeCloseTo(hitDamage(10, 0, 0, false, 0.6), 9);
  });
});
