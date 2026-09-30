/**
 * Die Schattenbrut in Zahlen (M6-25b, M6-26, M6-29; MASTERPROMPT §D „normale Gegner einer Stufe fallen nach 4–6 Treffern
 * mit stufengerechter Einhandwaffe; Elites ×4 … normaler Treffer 8–12 % des effektiven Lebens, schwere telegraphierte
 * Attacke 20–30 %; kein One-Shot auf Normal … Lumen-Scherben ≈ 15–25 pro aktiver Nacht auf Stufe 1, ×1,4 je Stufe“, §20.1
 * „Schattenbrut-Varianten je Biom über Palette und Modifikator“):
 * - jede Grundform der Stufe 0 und jede Biom-Variante auf der Stufe ihres Bioms – mit den Waffen- und Rüstungswerten dieser
 *   Stufe aus den Formeln (§D-Tabellen), nicht aus Inhalt, den es noch nicht gibt;
 * - der Nachtmahr (Stufe 1) hält wie ein Elite ×4 und schlägt schwer, aber nie tödlich aus vollem Leben;
 * - die Lumen-Scherben: Mittel je Kill steigt je Stufe um etwa ×1,4, eine aktive Nacht auf Stufe 1 bringt 15–25;
 * - die Palettenzeilen der Varianten gibt es, sie färben die Brut um, und die Validator-Regel meldet eine fehlende Zeile.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { KREATUREN_M6 } from '../../../assets-src/sprites/kreaturen/_katalog';
import { PALETTE_ROWS } from '../../../assets-src/paletteRows';
import { BALANCE } from '../../../src/content/balance';
import { SCHATTENBRUT_KREATUREN, SET_RUESTUNG_JE_STUFE } from '../../../src/content/creatures/schattenbrut';
import type { CreatureAttack, CreatureDef } from '../../../src/content/creatures/schema';
import { ATTACK_STRIKE_EVENT, creatureSpriteId } from '../../../src/content/creatures/schema';
import { CONTENT } from '../../../src/content/index';
import { ContentRegistry } from '../../../src/content/registry';
import { idSchema } from '../../../src/content/schema/common';
import { Rng } from '../../../src/engine/rng';
import { hitDamage, weaponDamage } from '../../../src/game/combat/formulas';
import type { DamageType } from '../../../src/game/combat/targets';
import { drawLoot, effectiveTier } from '../../../src/game/creatures/formulas';
import { checkCreatures, type CreatureSpriteInfo } from '../../../tools/validator/kreaturen';

const HP = BALANCE.survival.health.base;
const IDS = ['schleicher', 'kriecher', 'speier', 'lichtfresser'] as const;
const EINHAENDER = ['schwert', 'axt', 'keule', 'speer'] as const;
/** Heavy telegraphed attacks (§D 20–30 %): the Schleicher's leap, the Kriecher's grab (blow and bites), the Nachtmahr's. */
const SCHWER: Readonly<Record<string, readonly string[]>> = { schleicher: ['sprung'], kriecher: ['packen'], nachtmahr: ['stampfen', 'ansturm'] };
/** Tier of every biome (the spawn balance). */
const BIOM_STUFE = BALANCE.spawn.biomeTier;

function def(id: string): CreatureDef {
  return CONTENT.collection('creatures').get(id);
}

function classType(klasse: (typeof EINHAENDER)[number]): DamageType {
  const w = CONTENT.collection('items')
    .values()
    .find((i) => i.waffe?.klasse === klasse && i.stufe === 0)?.waffe;
  if (w === undefined) throw new Error(`no tier-0 ${klasse}`);
  return w.schadensart;
}

/** Blows of a tier's one-hander (§D base × class factor) a creature of `leben` HP takes to fall. */
function blows(c: CreatureDef, leben: number, tier: number, klasse: (typeof EINHAENDER)[number]): number {
  const type = classType(klasse);
  return Math.ceil(leben / hitDamage(weaponDamage(tier, klasse), c.resistenzen[type] ?? 0, c.ruestung, false, 0));
}

function conditionDps(id: string): number {
  return CONTENT.collection('conditions').get(id).wirkung.schadenProSekunde ?? 0;
}

/** Share of the player's base health an attack (× `factor`) takes through the set armour of `tier`: blow, condition, a grab's bites. */
function share(a: CreatureAttack, tier: number, factor = 1, crit = false): number {
  const armor = SET_RUESTUNG_JE_STUFE[tier] as number;
  const blow = hitDamage(a.schaden * factor, 0, armor, crit, 0);
  const condition = a.zustand === undefined ? 0 : conditionDps(a.zustand.id) * a.zustand.sekunden;
  const grab = a.festhalten === undefined ? 0 : hitDamage(a.festhalten.schadenProSekunde * a.festhalten.sekunden * factor, 0, armor, false, 0);
  return (blow + condition + grab) / HP;
}

function expectShare(id: string, a: CreatureAttack, tier: number, factor = 1): void {
  const s = share(a, tier, factor);
  const heavy = SCHWER[id]?.includes(a.name) === true;
  const [lo, hi] = heavy ? [0.2, 0.3] : [0.08, 0.12];
  expect(s, `${id} ${a.name} T${tier}`).toBeGreaterThanOrEqual(lo - 1e-9);
  expect(s, `${id} ${a.name} T${tier}`).toBeLessThanOrEqual(hi + 1e-9);
  expect(share(a, tier, factor, true), `${id} ${a.name} crit`).toBeLessThan(1);
}

describe('Schattenbrut-Grundformen: Balance §D (Stufe 0)', () => {
  it('fallen nach 4–6 Treffern jeder Einhandwaffe der Stufe 0', () => {
    for (const id of IDS) {
      const c = def(id);
      expect(c.stufe).toBe(0);
      for (const k of EINHAENDER) {
        const n = blows(c, c.leben, 0, k);
        expect(n, `${id} × ${k}`).toBeGreaterThanOrEqual(4);
        expect(n, `${id} × ${k}`).toBeLessThanOrEqual(6);
      }
    }
  });

  it('Treffer: normal 8–12 %, schwer telegraphiert 20–30 % (Sprung, Griff) hinter T0-Rüstung, kein One-Shot', () => {
    for (const id of IDS) for (const a of def(id).angriffe) expectShare(id, a, 0);
    // The heavy ones are telegraphed at least half a second.
    for (const [id, names] of Object.entries(SCHWER)) for (const n of names) expect(def(id).angriffe.find((a) => a.name === n)?.ausholzeit ?? 0).toBeGreaterThanOrEqual(0.5);
  });

  it('Licht schneidet tief, der eigene Schatten kaum; der Lichtfresser verträgt Licht besser als seine Brut', () => {
    for (const id of IDS) {
      expect(def(id).resistenzen.licht ?? 0, id).toBeLessThan(0);
      expect(def(id).resistenzen.schatten ?? 0, id).toBeGreaterThan(0.5);
    }
    expect(def('lichtfresser').resistenzen.licht ?? 0).toBeGreaterThan(def('schleicher').resistenzen.licht ?? 0);
  });

  it('der Lichtfresser meidet nur gleißendes Licht (§12.4 „Ausnahmen: … Lichtfresser“), die übrige Brut Licht über 0,5', () => {
    const profiles = CONTENT.collection('aiProfiles');
    for (const id of ['schleicher', 'kriecher', 'speier']) expect(profiles.get(id).meidetLicht).toBe(BALANCE.creatures.shadowBrood.avoidLightAbove);
    expect(profiles.get('lichtfresser').meidetLicht).toBeGreaterThan(BALANCE.light.map.stages.glaringAbove - 1e-9);
    expect(profiles.get('speier').fernkampfAbstand).toBeGreaterThan(0);
    expect(profiles.get('schleicher').rudel).toBeDefined();
  });

  it('jeder Angriff trifft im Bild genau zur Datenzeit (Ausholen im Rahmen 0,3–0,8 s, auch das Saugen)', () => {
    for (const c of [...SCHATTENBRUT_KREATUREN, def('nachtmahr')]) {
      const art = KREATUREN_M6.find((k) => k.id === c.id);
      for (const a of c.angriffe) {
        const name = `attack_${a.name}_down`;
        const clip = art?.ergebnis.clips.find((x) => x.clip === name);
        const spriteClip = art?.ergebnis.sprite.clips[name];
        if (clip === undefined || clip.ausholen === null || spriteClip === undefined) throw new Error(`${c.id}: ${name} without wind-up`);
        const strike = spriteClip.events.find((e) => e.name === ATTACK_STRIKE_EVENT)?.frame ?? -1;
        expect(strike / clip.fps, `${c.id} ${a.name}`).toBeCloseTo(a.ausholzeit + (a.anlauf ?? 0), 5);
        expect(a.ausholzeit + (a.anlauf ?? 0), `${c.id} ${a.name}`).toBeLessThanOrEqual(0.8 + 1e-9);
      }
    }
  });
});

describe('Biom-Varianten (M6-25b): §D auf der Stufe ihres Bioms', () => {
  it('jede Brut hat eine Variante für jedes tiefere Biom, keine für die Biome der Stufe 0', () => {
    const tiefer = Object.entries(BIOM_STUFE)
      .filter(([, t]) => t > 0)
      .map(([b]) => b)
      .sort();
    for (const id of IDS) {
      const biome = (def(id).varianten ?? []).flatMap((v) => v.biome).sort();
      expect(biome, id).toEqual(tiefer);
    }
  });

  it('jede Variante fällt nach 4–6 Treffern der Einhandwaffen ihrer Stufe und trifft mit 8–12 % (schwer 20–30 %) hinter deren Rüstung', () => {
    for (const id of IDS) {
      const c = def(id);
      for (const v of c.varianten ?? []) {
        const tiers = new Set(v.biome.map((b) => BIOM_STUFE[b] ?? -1));
        expect(tiers.size, `${id}/${v.id}`).toBe(1);
        const tier = [...tiers][0] as number;
        for (const k of EINHAENDER) {
          const n = blows(c, c.leben * v.leben, tier, k);
          expect(n, `${id}/${v.id} × ${k} T${tier}`).toBeGreaterThanOrEqual(4);
          expect(n, `${id}/${v.id} × ${k} T${tier}`).toBeLessThanOrEqual(6);
        }
        for (const a of c.angriffe) expectShare(`${id}`, a, tier, v.schaden);
        expect(v.tempo).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('die Palettenzeilen der Varianten gibt es, und sie färben die Brut um', () => {
    const rows = new Map(PALETTE_ROWS.map((r) => [r.id, r.map]));
    for (const id of IDS) {
      const sprite = KREATUREN_M6.find((k) => k.id === id)?.ergebnis.sprite;
      const used = new Set<number>();
      for (const f of sprite?.frames ?? []) for (const i of f.index) if (i !== 0) used.add(i);
      for (const v of def(id).varianten ?? []) {
        const map = rows.get(v.palette);
        expect(map, `${id}/${v.id}: ${v.palette}`).toBeDefined();
        expect([...used].some((i) => map?.[i - 1] !== i), `${id}/${v.id} recolours`).toBe(true);
      }
    }
  });

  it('die Validator-Regel meldet eine unbekannte Palettenzeile und eine, die nichts umfärbt', () => {
    const loose = z.object({ id: idSchema }).passthrough();
    const TEXT = { de: 'Ein Text.', en: 'A text.' };
    const registry = new ContentRegistry()
      .defineCollection('sfx', loose, [{ id: 'sfx_probe_laut' }, { id: 'sfx_probe_treffer' }, { id: 'sfx_probe_tod' }])
      .defineCollection('aiProfiles', loose, [{ id: 'probe' }])
      .defineCollection('lootTables', loose, [{ id: 'probe' }])
      .defineCollection('creatures', loose, [
        {
          id: 'probe',
          familie: 'schattenbrut',
          groesse: 32,
          aktiv: ['tag'],
          augen: null,
          sounds: { laut: 'sfx_probe_laut', treffer: 'sfx_probe_treffer', tod: 'sfx_probe_tod' },
          angriffe: [],
          ki: 'probe',
          beute: 'probe',
          biome: [],
          bestiarium: { text: TEXT, hinweis: TEXT },
          varianten: [
            { id: 'gut', palette: 'zeile_gut', biome: ['x'] },
            { id: 'fehlt', palette: 'zeile_fehlt', biome: ['x'] },
            { id: 'blass', palette: 'zeile_identisch', biome: ['x'] },
          ],
        },
      ]);
    const clip = { frames: [0], fps: 8, events: [] };
    const clips = Object.fromEntries(['idle', 'move', 'hit', 'death'].flatMap((a) => ['down', 'up', 'right'].map((d) => [`${a}_${d}`, clip])));
    const sprite: CreatureSpriteInfo = { w: 32, h: 32, spiegelbar: true, emissiv: false, clips, farben: new Set([5, 6]) };
    const identity = Array.from({ length: 64 }, (_, i) => i + 1);
    const recolour = identity.map((v, i) => (i === 4 ? 9 : v));
    const rows = new Map<string, readonly number[]>([
      ['zeile_gut', recolour],
      ['zeile_identisch', identity],
    ]);
    const res = checkCreatures(registry, new Map([[creatureSpriteId('probe'), sprite]]), rows);
    expect(res.errors.filter((e) => e.includes('Variante'))).toEqual([
      'Kreatur probe: Variante fehlt nennt die unbekannte Palettenzeile zeile_fehlt',
      'Kreatur probe: Variante blass färbt nichts um – Palettenzeile zeile_identisch ändert keine Farbe des Sprites',
    ]);
  });
});

describe('Nachtmahr (M6-29): Elite-Stärke auf Stufe 1', () => {
  it('fällt nach 16–24 Treffern der Einhandwaffen der Stufe 1 (Elite ×4), schlägt schwer 20–30 %, nie tödlich', () => {
    const c = def('nachtmahr');
    expect(c.stufe).toBe(1);
    for (const k of EINHAENDER) {
      const n = blows(c, c.leben, 1, k);
      expect(n, k).toBeGreaterThanOrEqual(16);
      expect(n, k).toBeLessThanOrEqual(24);
    }
    for (const a of c.angriffe) expectShare('nachtmahr', a, 1);
    // Even a player of tier 0 survives every blow from full health, even critically.
    for (const a of c.angriffe) expect(share(a, 0, 1, true)).toBeLessThan(1);
    // Its eyes are the ice-white of its sprite.
    expect(c.augen).toBe('eis');
  });
});

describe('Lumen-Scherben (§D „15–25 pro aktiver Nacht auf Stufe 1, ×1,4 je Stufe“)', () => {
  /** Mean shards per kill of `id` at `tier` over `n` seeded draws. */
  function mean(id: string, tier: number, n = 4000): number {
    const table = CONTENT.collection('lootTables').get(id);
    const rng = new Rng(11 + tier);
    let sum = 0;
    for (let i = 0; i < n; i++) for (const d of drawLoot(table, tier, rng)) if (d.item === 'lumen_scherbe') sum += d.count;
    return sum / n;
  }

  it('das Mittel je Kill steigt je Stufe um etwa ×1,4', () => {
    let prev = mean('schleicher', 0);
    expect(prev).toBeGreaterThan(1.3);
    expect(prev).toBeLessThan(1.7);
    for (let t = 1; t <= 7; t++) {
      const m = mean('schleicher', t);
      expect(m / prev, `T${t}`).toBeGreaterThan(1.25);
      expect(m / prev, `T${t}`).toBeLessThan(1.55);
      prev = m;
    }
  });

  it('eine aktive Nacht auf Stufe 1 – etwa zehn Kills der gewöhnlichen Brut – bringt 15–25 Scherben', () => {
    // The spawner's mix: stalkers 4, crawlers 2, spitters 2, light eaters 1 (schattenbrutDaten.ts).
    const mix = { schleicher: 4, kriecher: 2, speier: 2, lichtfresser: 1 } as const;
    const total = Object.values(mix).reduce((a, b) => a + b, 0);
    const perKill = Object.entries(mix).reduce((s, [id, w]) => s + (mean(id, 1) * w) / total, 0);
    expect(perKill * 10).toBeGreaterThanOrEqual(15);
    expect(perKill * 10).toBeLessThanOrEqual(25);
    // Shadow brood killed in the Grünhain draws at the biome's tier (0), its own tier 0 too; deeper biomes raise it.
    expect(effectiveTier(0, 'gruenhain')).toBe(0);
    expect(effectiveTier(0, 'frostkamm')).toBe(2);
    // No carcass: shadow brood dissolves.
    for (const id of IDS) expect(CONTENT.collection('lootTables').get(id).zerlegen).toEqual([]);
  });
});
