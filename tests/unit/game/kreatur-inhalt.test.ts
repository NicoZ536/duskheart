/**
 * Kreaturen als Daten (M6-13, M6-19 ff., docs/SPIEL.md §11 „Daten“, §14): die Aufzählungen des Inhalts passen zu denen der
 * Spielschicht (Teams, Material, Fortbewegung, Schadensarten), die ersten Kreaturen Hase, Reh und Wachtel sind vollständig –
 * Werte, KI-Profil, Beute, Sounds, Bestiarium, Spawn in Grünhain –, der Zählbericht zählt sie, die Jagdgüter sind Items mit
 * Quelle, und der Katalog der Simulation löst alles auf.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { BALANCE } from '../../../src/content/balance';
import { CREATURE_LOCOMOTION, CREATURE_MATERIALS, CREATURE_TEAMS, creatureCountCategories } from '../../../src/content/creatures/schema';
import { JAGD } from '../../../src/content/items/jagd';
import { COMBAT_TEAMS, DAMAGE_TYPES, HIT_MATERIALS } from '../../../src/game/combat/targets';
import { contentCreatureCatalog } from '../../../src/game/creatures/catalog';
import { MOVER_CLASSES } from '../../../src/world/path/types';

describe('Aufzählungen: Inhalt = Spielschicht', () => {
  it('Teams, Material und Fortbewegung sind die der Kampf- und Pfadschicht', () => {
    for (const t of CREATURE_TEAMS) expect(COMBAT_TEAMS).toContain(t);
    expect(CREATURE_TEAMS).not.toContain('spieler');
    expect([...CREATURE_MATERIALS]).toEqual([...HIT_MATERIALS]);
    expect([...CREATURE_LOCOMOTION]).toEqual([...MOVER_CLASSES]);
  });

  it('Resistenzen nennen nur Schadensarten', () => {
    for (const c of CONTENT.collection('creatures').values()) for (const k of Object.keys(c.resistenzen)) expect(DAMAGE_TYPES).toContain(k);
  });
});

describe('Die ersten Kreaturen: Hase, Reh, Wachtel (und der Nachtmahr)', () => {
  const creatures = CONTENT.collection('creatures');

  it('sind vollständig: Profil, Beutetabelle (= Id), Sounds, Bestiarium DE/EN, Grünhain', () => {
    for (const id of ['hase', 'reh', 'wachtel']) {
      const c = creatures.get(id);
      expect(c.familie).toBe('friedlich');
      expect(c.team).toBe('tier');
      expect(c.biome).toEqual(['gruenhain']);
      expect(CONTENT.collection('aiProfiles').has(c.ki)).toBe(true);
      expect(c.beute).toBe(id);
      expect(CONTENT.collection('lootTables').get(id).zerlegen.length).toBeGreaterThan(0);
      for (const s of Object.values(c.sounds)) expect(CONTENT.collection('sfx').has(s)).toBe(true);
      expect(c.bestiarium.text.de).not.toBe(c.bestiarium.text.en);
    }
    expect(creatures.get('hase').fangbar).toBe(true);
    expect(creatures.get('wachtel').fangbar).toBe(true);
    expect(creatures.get('reh').fangbar).toBe(false);
    // The deer kicks back: its one attack, telegraphed within §19.4's range.
    expect(creatures.get('reh').angriffe.map((a) => a.name)).toEqual(['tritt']);
    expect(creatures.get('nachtmahr').familie).toBe('schattenbrut');
    expect(creatures.get('nachtmahr').augen).not.toBeNull();
    expect(BALANCE.creatures.nightmare.creature).toBe('nachtmahr');
  });

  it('der Zählbericht zählt Kreaturen (und Elites doppelt)', () => {
    expect(creatureCountCategories({ familie: 'friedlich' })).toEqual(['creatures']);
    expect(creatureCountCategories({ familie: 'elite' })).toEqual(['creatures', 'elites']);
  });

  it('der Katalog der Simulation löst Profil, Beute, Regeln und Tempo auf', () => {
    const cat = contentCreatureCatalog();
    const hare = cat.get('hase');
    expect(hare.profile.id).toBe('hase');
    expect(hare.loot?.id).toBe('hase');
    expect(hare.carcass).toBe(true);
    expect(hare.runPx).toBeGreaterThan(hare.walkPx);
    expect(cat.get('nachtmahr').shadow).toBe(true);
    expect(cat.get('nachtmahr').carcass).toBe(false);
    expect(cat.spawnTable('gruenhain')?.id).toBe('gruenhain');
    expect(cat.trap('schlinge')?.groesseMax).toBe(16);
    expect(() => cat.get('gibtsnicht')).toThrow(RangeError);
  });
});

describe('Jagdgüter (M6-30)', () => {
  it('sind Items mit Icon-Konvention, Texten DE/EN und einer Quelle (Zerlegen, Beute oder Rezept)', () => {
    const sources = new Set<string>();
    for (const t of CONTENT.collection('lootTables').values()) {
      for (const b of t.beute) sources.add(b.item);
      for (const z of t.zerlegen) sources.add(z.item);
    }
    for (const r of CONTENT.collection('recipes').values()) sources.add(r.ergebnis.item);
    for (const item of JAGD) {
      expect(item.name.de.length).toBeGreaterThan(0);
      expect(item.name.en.length).toBeGreaterThan(0);
      expect(sources.has(item.id), item.id).toBe(true);
    }
  });
});
