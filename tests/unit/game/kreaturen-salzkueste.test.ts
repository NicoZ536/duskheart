/**
 * Die Kreaturen der Salzküste (M6-23, M6-24; MASTERPROMPT §20.1 „Salzküste: Krabbe, Möwe, Robbe · Scherenkrebs, Qualle,
 * Strandräuber (Gezeichnete)“, §19.4, §D; docs/SPIEL.md §11, §14):
 * - Inhalt: jede Kreatur vollständig (Sprite-Clips und Ausholphasen des Generators, Klänge, Profil, Beute, Bestiarium DE/EN),
 *   die Küste hat ihre Spawntabelle für Tag, Nacht und Jahreszeiten, nachts mit der Schattenbrut;
 * - Balance §D je Kreatur aus den Formeln: Gegner fallen nach 4–6 Treffern jeder stufengerechten Einhandwaffe, ihre
 *   Treffer nehmen 8–12 % (schwer telegraphiert 20–30 %) des Lebens hinter stufengerechter Rüstung, kein One-Shot auf
 *   Normal – auch nicht kritisch; friedliche Tiere fallen nach wenigen Schlägen und beißen höchstens wie ein normaler Gegner;
 * - Verhalten in der Testwelt: die Möwe fliegt übers Wasser davon, die Robbe flieht ins Wasser, die Qualle bleibt im Wasser
 *   und nesselt Watende (Gift), der Scherenkrebs holt 0,6 s zum Scherenschlag aus, der Strandräuber ficht mit der
 *   Feuersteinklinge und lässt Strandgut fallen, Krabbe und Krebs geben zerlegt Krebsfleisch.
 */
import { describe, expect, it } from 'vitest';
import { KREATUREN_M6 } from '../../../assets-src/sprites/kreaturen/_katalog';
import { BALANCE } from '../../../src/content/balance';
import { SALZKUESTE_KREATUREN } from '../../../src/content/creatures/salzkueste';
import { SET_RUESTUNG_JE_STUFE } from '../../../src/content/creatures/schattenbrut';
import type { CreatureAttack, CreatureDef } from '../../../src/content/creatures/schema';
import { ATTACK_STRIKE_EVENT } from '../../../src/content/creatures/schema';
import { CONTENT } from '../../../src/content/index';
import { Rng } from '../../../src/engine/rng';
import { armorReduction, hitDamage, weaponDamage } from '../../../src/game/combat/formulas';
import type { DamageType } from '../../../src/game/combat/targets';
import { carveYield, drawLoot, windupTicks } from '../../../src/game/creatures/formulas';
import type { SimEventMap } from '../../../src/game/sim';
import { TILE_PX } from '../../../src/world/model/coords';
import { eventsOf } from './kampf-testwelt';
import { kreaturWelt, meadow, OFFSET } from './kreatur-testwelt';

const HZ = BALANCE.time.tickHz;
const HP = BALANCE.survival.health.base;
const IDS = ['krabbe', 'moewe', 'robbe', 'scherenkrebs', 'qualle', 'strandraeuber'] as const;
/** The tier-0 one-handers of §D (the dagger is the fast class with its own count). */
const EINHAENDER = ['schwert', 'axt', 'keule', 'speer'] as const;
/** Heavy telegraphed attacks (§D 20–30 %); every other attack of a foe is a normal hit (8–12 %). */
const SCHWER: Readonly<Record<string, readonly string[]>> = { scherenkrebs: ['scherenschlag'] };

function def(id: string): CreatureDef {
  return CONTENT.collection('creatures').get(id);
}

/** Damage type of a one-hander class: the armoury's weapon of that class (the first of the tier). */
function classType(klasse: (typeof EINHAENDER)[number]): DamageType {
  const w = CONTENT.collection('items')
    .values()
    .find((i) => i.waffe?.klasse === klasse && i.stufe === 0)?.waffe;
  if (w === undefined) throw new Error(`no tier-0 ${klasse}`);
  return w.schadensart;
}

/** Blows of a tier's one-hander a creature takes to fall (no crit; §19.3 armour and resistance). */
function blows(c: CreatureDef, tier: number, klasse: (typeof EINHAENDER)[number]): number {
  const type = classType(klasse);
  return Math.ceil(c.leben / hitDamage(weaponDamage(tier, klasse), c.resistenzen[type] ?? 0, c.ruestung, false, 0));
}

/** Damage per second of a condition [HP/s] (conditions content). */
function conditionDps(id: string): number {
  return CONTENT.collection('conditions').get(id).wirkung.schadenProSekunde ?? 0;
}

/** Share of the player's base health an attack takes through the set armour of `tier` [0–1]: the blow, its condition, a grab's bites. */
function share(a: CreatureAttack, tier: number, crit = false): number {
  const blow = hitDamage(a.schaden, 0, SET_RUESTUNG_JE_STUFE[tier] as number, crit, 0);
  const condition = a.zustand === undefined ? 0 : conditionDps(a.zustand.id) * a.zustand.sekunden;
  const grab = a.festhalten === undefined ? 0 : hitDamage(a.festhalten.schadenProSekunde * a.festhalten.sekunden, 0, SET_RUESTUNG_JE_STUFE[tier] as number, false, 0);
  return (blow + condition + grab) / HP;
}

describe('Salzküste: Inhalt (M6-23, M6-24)', () => {
  it('alle sechs Kreaturen, jede mit Klängen, Profil, Beute oder begründet ohne, Bestiarium DE/EN', () => {
    expect(SALZKUESTE_KREATUREN.map((c) => c.id)).toEqual([...IDS]);
    const sfx = CONTENT.collection('sfx');
    for (const c of SALZKUESTE_KREATUREN) {
      for (const s of [c.sounds.laut, c.sounds.treffer, c.sounds.tod, ...c.angriffe.map((a) => a.sound)]) expect(sfx.has(s), `${c.id}: ${s}`).toBe(true);
      expect(CONTENT.collection('aiProfiles').has(c.ki)).toBe(true);
      if (c.beute === null) expect(c.ohneBeute?.length ?? 0).toBeGreaterThan(20);
      else expect(CONTENT.collection('lootTables').has(c.beute)).toBe(true);
      for (const t of [c.bestiarium.text, c.bestiarium.hinweis]) {
        expect(t.de.length).toBeGreaterThan(40);
        expect(t.en.length).toBeGreaterThan(40);
        expect(t.en).not.toBe(t.de);
      }
    }
  });

  it('jeder Angriff trifft im Bild genau zur Datenzeit: Ausholphase und Schlag-Event des Generators', () => {
    for (const c of SALZKUESTE_KREATUREN) {
      const art = KREATUREN_M6.find((k) => k.id === c.id);
      expect(art, c.id).toBeDefined();
      for (const a of c.angriffe) {
        const name = `attack_${a.name}_down`;
        const clip = art?.ergebnis.clips.find((x) => x.clip === name);
        const spriteClip = art?.ergebnis.sprite.clips[name];
        expect(clip, `${c.id} ${a.name}`).toBeDefined();
        if (clip === undefined || clip.ausholen === null || spriteClip === undefined) throw new Error(`${c.id}: ${name} without wind-up`);
        const strike = spriteClip.events.find((e) => e.name === ATTACK_STRIKE_EVENT)?.frame ?? -1;
        expect(strike / clip.fps).toBeCloseTo(a.ausholzeit + (a.anlauf ?? 0), 5);
        expect((clip.ausholen.bis - clip.ausholen.von + 1) / clip.fps).toBeCloseTo(a.ausholzeit, 5);
      }
    }
  });

  it('Nachtjäger mit leuchtenden Augen; die Qualle schwimmt, die Möwe fliegt, die Robbe kann beides', () => {
    expect(def('scherenkrebs').augen).toBe('eis');
    expect(def('strandraeuber').augen).toBe('verderb');
    expect(def('qualle').fortbewegung).toBe('schwimmer');
    expect(def('moewe').fortbewegung).toBe('flieger');
    expect(def('robbe').fortbewegung).toBe('amphibie');
    expect(def('krabbe').fangbar).toBe(true);
  });

  it('Spawntabelle der Küste: Tag und Nacht in jeder Jahreszeit, nachts mit der Schattenbrut', () => {
    const t = CONTENT.collection('spawnTables').get('salzkueste');
    for (const season of ['fruehling', 'sommer', 'herbst', 'winter'] as const) {
      for (const list of [t.tag, t.nacht]) expect(list.some((e) => e.jahreszeiten === undefined || e.jahreszeiten.includes(season))).toBe(true);
    }
    expect(t.tag.map((e) => e.kreatur)).toEqual(expect.arrayContaining(['krabbe', 'moewe', 'robbe', 'qualle']));
    expect(t.nacht.map((e) => e.kreatur)).toEqual(expect.arrayContaining(['scherenkrebs', 'strandraeuber', 'schleicher', 'kriecher', 'speier', 'lichtfresser']));
    // The raiders come in pairs (they flank).
    expect(t.nacht.find((e) => e.kreatur === 'strandraeuber')?.gruppe).toEqual([2, 2]);
  });
});

describe('Salzküste: Balance §D auf Normal', () => {
  it('Gegner fallen nach 4–6 Treffern jeder Einhandwaffe ihrer Stufe', () => {
    for (const id of ['scherenkrebs', 'qualle', 'strandraeuber']) {
      const c = def(id);
      for (const k of EINHAENDER) {
        const n = blows(c, c.stufe, k);
        expect(n, `${id} × ${k}`).toBeGreaterThanOrEqual(4);
        expect(n, `${id} × ${k}`).toBeLessThanOrEqual(6);
      }
    }
    // The lobster's shell: the club cracks it faster than a blade cuts it.
    expect(blows(def('scherenkrebs'), 0, 'keule')).toBeLessThan(blows(def('scherenkrebs'), 0, 'schwert'));
  });

  it('friedliche Tiere fallen nach wenigen Schlägen', () => {
    expect(blows(def('krabbe'), 0, 'keule')).toBe(1);
    expect(blows(def('krabbe'), 0, 'schwert')).toBe(2);
    expect(blows(def('moewe'), 0, 'schwert')).toBe(2);
    for (const k of EINHAENDER) expect(blows(def('robbe'), 0, k)).toBeLessThanOrEqual(6);
  });

  it('Treffer: normal 8–12 %, schwer telegraphiert 20–30 % hinter T0-Rüstung, Friedliche höchstens 12 %, kein One-Shot', () => {
    expect(armorReduction(SET_RUESTUNG_JE_STUFE[0] as number)).toBeCloseTo(6 / 56, 10);
    for (const id of IDS) {
      const c = def(id);
      for (const a of c.angriffe) {
        const s = share(a, c.stufe);
        const heavy = SCHWER[id]?.includes(a.name) === true;
        if (c.familie === 'friedlich') expect(s, `${id} ${a.name}`).toBeLessThanOrEqual(0.12);
        else if (heavy) {
          expect(s, `${id} ${a.name}`).toBeGreaterThanOrEqual(0.2);
          expect(s, `${id} ${a.name}`).toBeLessThanOrEqual(0.3);
          // A heavy blow is telegraphed long: at least 0,6 s.
          expect(a.ausholzeit + (a.anlauf ?? 0)).toBeGreaterThanOrEqual(0.6);
        } else {
          expect(s, `${id} ${a.name}`).toBeGreaterThanOrEqual(0.08);
          expect(s, `${id} ${a.name}`).toBeLessThanOrEqual(0.12);
        }
        // No one-shot on Normal: not even a critical blow, not even without armour.
        expect(share(a, c.stufe, true)).toBeLessThan(1);
        expect((a.schaden * BALANCE.combat.damage.critFactor) / HP).toBeLessThan(0.6);
      }
    }
  });

  it('der Strandräuber ficht mit der Feuersteinklinge der Rüstkammer', () => {
    const blade = CONTENT.collection('items').get('feuersteinklinge').waffe;
    const hieb = def('strandraeuber').angriffe[0];
    expect(blade).toBeDefined();
    expect(hieb).toMatchObject({ schadensart: blade?.schadensart, reichweite: blade?.reichweite, bogen: blade?.bogen, wucht: blade?.wucht, stagger: blade?.stagger });
  });

  it('Beute: Krebsfleisch aus Krabbe und Krebs, viel Fett aus der Robbe, Nesselfäden der Qualle, Fischergut und selten die Klinge vom Räuber – kein Weltmaterial (ADR-0105)', () => {
    const loot = CONTENT.collection('lootTables');
    const rng = new Rng(7);
    expect(carveYield(loot.get('krabbe'), rng).map((d) => d.item)).toEqual(['krebsfleisch_roh']);
    const krebs = carveYield(loot.get('scherenkrebs'), rng);
    expect(krebs[0]?.item).toBe('krebsfleisch_roh');
    expect(krebs[0]?.count).toBeGreaterThanOrEqual(2);
    expect(carveYield(loot.get('robbe'), rng).find((d) => d.item === 'fett')?.count).toBeGreaterThanOrEqual(2);
    const seen = new Map<string, number>();
    for (let i = 0; i < 400; i++) for (const d of drawLoot(loot.get('strandraeuber'), 0, rng)) seen.set(d.item, (seen.get(d.item) ?? 0) + 1);
    expect([...seen.keys()].sort()).toEqual(['faserseil', 'feuersteinklinge', 'krebsfleisch_roh', 'verband']);
    // The blade is the rare piece: about one draw in nine.
    expect(seen.get('feuersteinklinge') ?? 0).toBeLessThan((seen.get('faserseil') ?? 0) / 2);
    expect(loot.get('strandraeuber').zerlegen).toEqual([]);
    // The jellyfish runs out into the sand: its stinging threads, no carcass.
    expect(drawLoot(loot.get('qualle'), 0, rng).map((d) => d.item)).toEqual(['nesselfaden']);
    expect(loot.get('qualle').zerlegen).toEqual([]);
  });
});

describe('Salzküste: Verhalten (Testwelt)', () => {
  /** The coast: meadow in the west, shallows (`s`) and the sea (`w`) in the east. */
  function kueste(): string[] {
    return Array.from({ length: 30 }, () => `${'.'.repeat(20)}${'s'.repeat(6)}${'w'.repeat(14)}`);
  }

  it('die Möwe fliegt vor dem Spieler übers Wasser davon', () => {
    const w = kreaturWelt(kueste(), { x: 12, y: 15 });
    w.cenv.phase = 'tag';
    const gull = w.creature('moewe', 17, 15);
    let overWater = false;
    for (let i = 0; i < 8 * HZ && !overWater; i++) {
      w.run(1, i % 20 === 0 ? [{ type: 'player.move', dx: 1, dy: 0 }] : undefined);
      if (!w.creatures.store.has(gull)) break;
      const at = w.where(gull);
      overWater = Math.floor(at.x / TILE_PX) - OFFSET >= 26;
    }
    expect(overWater).toBe(true);
  });

  it('die Qualle bleibt im Wasser und nesselt, wer in sie hineinwatet – mit Gift', () => {
    const w = kreaturWelt(kueste(), { x: 21, y: 15 });
    w.cenv.phase = 'tag';
    // Next to the wading player: it notices what touches it (`nearTiles`) and defends its water.
    const jelly = w.creature('qualle', 22, 15);
    const health = w.vit().health;
    const events: SimEventMap['creatureAttack'][] = [];
    let poisoned = false;
    for (let i = 0; i < 10 * HZ; i++) {
      const ev = w.run(1);
      events.push(...eventsOf<SimEventMap['creatureAttack']>(ev, 'creatureAttack'));
      poisoned ||= w.life.conditions.has('vergiftung');
      const at = w.where(jelly);
      // Never on dry land.
      expect(Math.floor(at.x / TILE_PX) - OFFSET).toBeGreaterThanOrEqual(20);
    }
    expect(events.some((e) => e.creature === 'qualle' && e.angriff === 'nesseln')).toBe(true);
    expect(w.vit().health).toBeLessThan(health);
    expect(poisoned).toBe(true);
  });

  it('der Scherenkrebs holt 0,6 s zum Scherenschlag aus (36 Ticks auf Normal)', () => {
    const a = def('scherenkrebs').angriffe.find((x) => x.name === 'scherenschlag');
    expect(a).toBeDefined();
    if (a !== undefined) expect(windupTicks(a, 'normal')).toBe(36);
  });

  it('der Strandräuber fällt ohne Kadaver und lässt Fischergut; zerlegt geben Krabbe Krebsfleisch', () => {
    const w = kreaturWelt(meadow(40, 30), { x: 20, y: 15 });
    w.cenv.phase = 'nacht';
    w.cheats.god = true;
    w.creature('strandraeuber', 23, 15);
    w.creature('krabbe', 21, 15);
    const ev = w.run(1, [{ type: 'creature.kill', radius: 8 }]);
    const died = eventsOf<SimEventMap['creatureDied']>(ev, 'creatureDied');
    const raider = died.find((d) => d.creature === 'strandraeuber');
    const crab = died.find((d) => d.creature === 'krabbe');
    expect(raider?.loot).toBe(true);
    expect(raider?.carcass).toBe(-1);
    expect(crab?.carcass).not.toBe(-1);
    expect(w.spilled.length).toBeGreaterThan(0);
    for (const s of w.spilled) expect(['faserseil', 'feuersteinklinge', 'krebsfleisch_roh', 'verband']).toContain(s.stack.item);
    // The crab's carcass carved with a knife.
    w.hold('steinmesser');
    const carved = w.run(1, [{ type: 'carcass.carve', carcass: crab?.carcass ?? -1 }]);
    expect(eventsOf<SimEventMap['carcassCarved']>(carved, 'carcassCarved')).toHaveLength(1);
    expect(w.spilled.some((s) => s.stack.item === 'krebsfleisch_roh')).toBe(true);
  });
});
