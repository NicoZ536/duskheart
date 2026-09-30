/**
 * Die Grünhain-Kreaturen M6-20 … M6-22 als Daten (MASTERPROMPT §20.1, §19.4, §D; docs/SPIEL.md §11, §14; docs/ART.md §15.3):
 * jede ist vollständig (Profil, Beute oder begründet keine, Laute je Angriff, Bestiarium DE/EN, Spawn in Grünhain), und ihre
 * Werte halten §D – gerechnet mit denselben Formeln wie das Spiel:
 * - normale Gegner einer Stufe fallen nach 4–6 Treffern jeder stufengerechten Einhandwaffe (T0: Feuersteinklinge,
 *   Steinkampfaxt, Holz- und Knochenkeule, Steinspeer) durch Rüstung R/(R+50) und Resistenzen;
 * - ein normaler Treffer nimmt gegen die T0-Rüstung (Fasergewand, R 6) 8–12 % der 100 Leben (Gift mitgerechnet), ein
 *   schwerer, telegraphierter 20–30 %; kein Treffer tötet auf Normal aus vollem Leben, auch kritisch und ohne Rüstung nicht;
 * - jede Ausholzeit (mit Anlauf) liegt in 0,3–0,8 s, der Keiler-Ansturm höchstens 0,8 s;
 * - der Dornling hat Tarn- und Enthüllungs-Clip im Atlas, sein Überfall kommt nur aus der Tarnung;
 * - die Glühwürmchen erscheinen genau in den Nächten der schwebenden Glühwürmchen der Oberfläche (M5-23).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../../src/content/balance';
import { CONTENT } from '../../../src/content/index';
import { CREATURE_GROUPS } from '../../../src/content/creatures/index';
import { GRUENHAIN_GRUPPE, GRUENHAIN_KREATUREN } from '../../../src/content/creatures/gruenhain';
import { CREATURE_HIDDEN_ACTION, CREATURE_REVEAL_ACTION, WINDUP_MAX_SECONDS, WINDUP_MIN_SECONDS, attackClipAction, creatureSpriteId, type CreatureAttack, type CreatureDef } from '../../../src/content/creatures/schema';
import { hitDamage } from '../../../src/game/combat/formulas';
import { creatureDamage } from '../../../src/game/creatures/formulas';
import { LIGHT_KINDS } from '../../../src/content/lights';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SURFACE_PARAMS } from '../../../src/render/surface/params';

const IDS = ['eichhoernchen', 'gluehwuermchen', 'frosch', 'keiler', 'dachs', 'wolf', 'dornling', 'wespenschwarm'] as const;
const FOES = ['keiler', 'dachs', 'wolf', 'dornling', 'wespenschwarm'] as const;
/** The heavy, telegraphed attacks (§D 20–30 %); every other attack is a normal hit (8–12 %). */
const HEAVY = new Set(['keiler.ansturm', 'wolf.sprung', 'dornling.ueberfall']);
/** One-handed melee classes whose tier weapons must fell a normal foe in 4–6 hits; the dagger is the fast class. */
const ONE_HANDED = new Set(['schwert', 'axt', 'keule', 'speer']);
const HEALTH = BALANCE.survival.health.base;

const creatures = CONTENT.collection('creatures');
const items = CONTENT.collection('items').values();

/** The game atlas (built by `npm run assets`, which `npm run check` runs first). */
const MANIFEST = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();

function creature(id: string): CreatureDef {
  return creatures.get(id);
}

/** Armour of a set: the sum of its pieces' `werte.ruestung`. */
function setArmor(set: string): number {
  const s = CONTENT.collection('armorSets').get(set);
  return s.teile.reduce((sum, id) => sum + (CONTENT.collection('items').get(id).werte?.ruestung ?? 0), 0);
}

/** Share of the player's health one blow of `a` takes on Normal through armour `armor`, its poison included [0–1]. */
function blowShare(a: CreatureAttack, armor: number, crit = false): number {
  const direct = hitDamage(creatureDamage(a.schaden, 'normal'), 0, armor, crit, 0);
  const z = a.zustand;
  const poison = z === undefined ? 0 : (CONTENT.collection('conditions').get(z.id).wirkung?.schadenProSekunde ?? 0) * z.sekunden;
  return (direct + poison) / HEALTH;
}

describe('Grünhain-Kreaturen: vollständig (M6-20 … M6-22, Validator-Regel „kreatur“)', () => {
  it('sind eine Gruppe mit einer Zeile in CREATURE_GROUPS und ergänzen die Grünhain-Tabelle des Kerns', () => {
    expect(CREATURE_GROUPS.filter((g) => g === GRUENHAIN_GRUPPE)).toHaveLength(1);
    expect(GRUENHAIN_KREATUREN.map((c) => c.id)).toEqual([...IDS]);
    expect(GRUENHAIN_GRUPPE.spawnTabellen).toEqual([]);
    const table = CONTENT.collection('spawnTables').get('gruenhain');
    for (const id of IDS) expect([...table.tag, ...table.nacht].some((e) => e.kreatur === id), id).toBe(true);
  });

  it('jede: Grünhain, Profil, Beute (Glühwürmchen begründet ohne), Laute je Angriff, Bestiarium DE/EN, Sprite-Clips', () => {
    const manifest = MANIFEST;
    for (const id of IDS) {
      const c = creature(id);
      expect(c.biome, id).toEqual(['gruenhain']);
      expect(c.stufe, id).toBe(0);
      expect(CONTENT.collection('aiProfiles').has(c.ki), id).toBe(true);
      if (id === 'gluehwuermchen') {
        expect(c.beute).toBeNull();
        expect(c.ohneBeute).toBeDefined();
      } else {
        expect(c.beute).toBe(id);
        const t = CONTENT.collection('lootTables').get(id);
        expect(t.beute.length + t.zerlegen.length, id).toBeGreaterThan(0);
      }
      for (const s of [c.sounds.laut, c.sounds.treffer, c.sounds.tod, ...c.angriffe.map((a) => a.sound)]) expect(CONTENT.collection('sfx').has(s), `${id}: ${s}`).toBe(true);
      for (const t of [c.name, c.beschreibung, c.bestiarium.text, c.bestiarium.hinweis]) {
        expect(t.de.length, id).toBeGreaterThan(0);
        expect(t.en.length, id).toBeGreaterThan(0);
      }
      // The texts are written in both languages, not copied (a name like „Wolf“ may be the same).
      for (const t of [c.beschreibung, c.bestiarium.text, c.bestiarium.hinweis]) expect(t.de, id).not.toBe(t.en);
      const sprite = manifest.sprites[creatureSpriteId(id)];
      expect(sprite, id).toBeDefined();
      expect(sprite?.size[0], id).toBe(c.groesse);
      for (const action of ['idle', 'move', 'hit', 'death', ...c.angriffe.map((a) => attackClipAction(a.name))]) {
        for (const dir of ['down', 'up', 'right']) expect(sprite?.clips[`${action}_${dir}`], `${id}: ${action}_${dir}`).toBeDefined();
      }
    }
  });

  it('die Gegner sind Nachtjäger mit glühenden Augen, wo sie nachts wach sind; die Friedlichen kämpfen nicht', () => {
    for (const id of FOES) {
      const c = creature(id);
      expect(c.familie).toBe('gegner');
      expect(c.team).toBe('feind');
      if (c.aktiv.includes('nacht')) expect(c.augen, id).not.toBeNull();
      expect(c.angriffe.length, id).toBeGreaterThan(0);
    }
    for (const id of ['eichhoernchen', 'gluehwuermchen', 'frosch']) {
      expect(creature(id).familie).toBe('friedlich');
      expect(creature(id).angriffe).toEqual([]);
    }
    // The wolves hunt as a pack (M6-18), the Dornling hides, the wasps shy from fire.
    const profile = (id: string) => CONTENT.collection('aiProfiles').get(creature(id).ki);
    expect(profile('wolf').rudel?.angreiferZugleich).toBe(1);
    expect(profile('dornling').tarnung).toBeDefined();
    expect(profile('wespenschwarm').scheutFeuer).toBeGreaterThan(0);
    expect(creature('wespenschwarm').angriffe[0]?.zustand?.id).toBe('vergiftung');
  });
});

describe('Grünhain-Gegner: Balance nach §D (Normal, Stufe 0)', () => {
  const weapons = items.filter((i) => i.stufe === 0 && i.waffe !== undefined && ONE_HANDED.has(i.waffe.klasse));
  const daggers = items.filter((i) => i.stufe === 0 && i.waffe?.klasse === 'dolch');

  it('die T0-Einhandwaffen und das Fasergewand sind die des Inhalts (§D: T0 Schaden 8 × Klasse, Set-Rüstung 6)', () => {
    expect(weapons.map((w) => w.id).sort()).toEqual(['feuersteinklinge', 'holzkeule', 'knochenkeule', 'steinkampfaxt', 'steinspeer']);
    expect(setArmor('faser')).toBe(6);
  });

  it.each(FOES.map((id) => [id]))('%s fällt nach 4–6 Treffern jeder T0-Einhandwaffe (Dolch: höchstens 10)', (id) => {
    const c = creature(id);
    for (const w of weapons) {
      const waffe = w.waffe as NonNullable<typeof w.waffe>;
      const hits = Math.ceil(c.leben / hitDamage(waffe.schaden, c.resistenzen[waffe.schadensart] ?? 0, c.ruestung, false, 0));
      expect(hits, `${id} mit ${w.id}`).toBeGreaterThanOrEqual(4);
      expect(hits, `${id} mit ${w.id}`).toBeLessThanOrEqual(6);
    }
    for (const w of daggers) {
      const waffe = w.waffe as NonNullable<typeof w.waffe>;
      const hits = Math.ceil(c.leben / hitDamage(waffe.schaden, c.resistenzen[waffe.schadensart] ?? 0, c.ruestung, false, 0));
      expect(hits, `${id} mit ${w.id}`).toBeLessThanOrEqual(10);
    }
  });

  it.each(FOES.map((id) => [id]))('%s trifft normal mit 8–12 %, schwer und telegraphiert mit 20–30 % – nie tödlich aus vollem Leben', (id) => {
    const armor = setArmor('faser');
    for (const a of creature(id).angriffe) {
      const share = blowShare(a, armor);
      if (HEAVY.has(`${id}.${a.name}`)) {
        expect(share, `${id}.${a.name}`).toBeGreaterThanOrEqual(0.2);
        expect(share, `${id}.${a.name}`).toBeLessThanOrEqual(0.3);
      } else {
        expect(share, `${id}.${a.name}`).toBeGreaterThanOrEqual(0.08);
        expect(share, `${id}.${a.name}`).toBeLessThanOrEqual(0.12);
      }
      // No one-shot on Normal: a critical blow without any armour leaves the player standing.
      expect(blowShare(a, 0, true), `${id}.${a.name}`).toBeLessThan(1);
    }
  });

  it('die Friedlichen fallen nach ein bis zwei Schlägen der Feuersteinklinge', () => {
    const blade = (items.find((i) => i.id === 'feuersteinklinge')?.waffe?.schaden ?? 0) as number;
    for (const id of ['eichhoernchen', 'gluehwuermchen', 'frosch']) expect(Math.ceil(creature(id).leben / blade), id).toBeLessThanOrEqual(2);
  });
});

describe('Grünhain-Gegner: lesbare Ausholphasen (§19.4, docs/ART.md §15.3)', () => {
  it('jede Ausholzeit samt Anlauf liegt in 0,3–0,8 s – der Keiler-Ansturm 0,6 + 0,2 s', () => {
    for (const id of FOES) {
      for (const a of creature(id).angriffe) {
        const total = a.ausholzeit + (a.anlauf ?? 0);
        expect(total, `${id}.${a.name}`).toBeGreaterThanOrEqual(WINDUP_MIN_SECONDS);
        expect(total, `${id}.${a.name}`).toBeLessThanOrEqual(WINDUP_MAX_SECONDS + 1e-9);
      }
    }
    const ansturm = creature('keiler').angriffe.find((a) => a.name === 'ansturm');
    expect([ansturm?.ausholzeit, ansturm?.anlauf]).toEqual([0.6, 0.2]);
    const sprung = creature('wolf').angriffe.find((a) => a.name === 'sprung');
    expect([sprung?.ausholzeit, sprung?.anlauf]).toEqual([0.4, 0.1]);
  });

  it('im Atlas schlägt jeder Angriffs-Clip nach Ausholzeit + Anlauf zu', () => {
    const manifest = MANIFEST;
    for (const id of FOES) {
      const sprite = manifest.sprites[creatureSpriteId(id)];
      for (const a of creature(id).angriffe) {
        const clip = sprite?.clips[`${attackClipAction(a.name)}_down`];
        const strike = clip?.events?.find((e) => e.name === 'schlag');
        expect(strike, `${id}.${a.name}`).toBeDefined();
        expect(((strike?.frame ?? 0) / (clip?.fps ?? 1)).toFixed(3), `${id}.${a.name}`).toBe((a.ausholzeit + (a.anlauf ?? 0)).toFixed(3));
      }
    }
  });

  it('der Dornling: Tarn- und Enthüllungs-Clip, die Enthüllung dauert `tarnung.erwachen`; der Überfall nur aus der Tarnung', () => {
    const manifest = MANIFEST;
    const sprite = manifest.sprites[creatureSpriteId('dornling')];
    const tarnung = CONTENT.collection('aiProfiles').get('dornling').tarnung;
    for (const dir of ['down', 'up', 'right']) {
      expect(sprite?.clips[`${CREATURE_HIDDEN_ACTION}_${dir}`]?.loop, dir).toBe(true);
      const reveal = sprite?.clips[`${CREATURE_REVEAL_ACTION}_${dir}`];
      expect(reveal, dir).toBeDefined();
      expect((reveal?.frames.length ?? 0) / (reveal?.fps ?? 1)).toBeCloseTo(tarnung?.erwachen ?? 0, 6);
    }
    const attacks = creature('dornling').angriffe;
    expect(attacks.filter((a) => a.ausTarnung === true).map((a) => a.name)).toEqual(['ueberfall']);
    for (const c of CONTENT.collection('creatures').values()) {
      // An ambush needs camouflage: only a creature whose profile hides has one.
      if (c.angriffe.some((a) => a.ausTarnung === true)) expect(CONTENT.collection('aiProfiles').get(c.ki).tarnung, c.id).toBeDefined();
    }
  });
});

describe('Glühwürmchen und die schwebenden Glühwürmchen der Oberfläche (M5-23)', () => {
  it('erscheinen nachts in den Jahreszeiten und im Biom der Oberflächen-Glühwürmchen, leuchten, sind keine Lichtquelle', () => {
    const table = CONTENT.collection('spawnTables').get('gruenhain');
    expect(table.tag.some((e) => e.kreatur === 'gluehwuermchen')).toBe(false);
    const night = table.nacht.filter((e) => e.kreatur === 'gluehwuermchen');
    expect(night).toHaveLength(1);
    expect([...(night[0]?.jahreszeiten ?? [])].sort()).toEqual([...SURFACE_PARAMS.fireflies.seasons].sort());
    expect(SURFACE_PARAMS.fireflies.biomes).toContain('gruenhain');
    expect(creature('gluehwuermchen').aktiv).toEqual(['nacht']);
    const manifest = MANIFEST;
    expect(manifest.sprites[creatureSpriteId('gluehwuermchen')]?.emissive).toBe(true);
    // It glows, but it lights nothing (§12.1, like the surface's fireflies): no light kind of that name.
    expect(LIGHT_KINDS.some((k) => k.id === 'gluehwuermchen' || k.gegenstand === 'gluehwuermchen')).toBe(false);
  });
});
