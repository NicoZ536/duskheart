/**
 * M6-33 SFX Kampf und Kreaturen – Treffer je Material, Telegraph-Klänge, Abmischung der Kreaturenlaute (MASTERPROMPT
 * §19.1 „gestaffelte Sounds“, §19.4 „Telegraphs … klar sichtbar und hörbar“, §27 „Varianten gegen Wiederholung“,
 * „Untertitel für wichtige Laute“). Hörfreie Prüfung: die Regeln der Abmischung als Daten und am gerenderten Klang
 * (src/audio/dsp/render.ts, dieselbe Synthese wie im Browser):
 * - Treffer je Material: jedes Körpermaterial (`HIT_MATERIALS`, jede Kreatur des Contents) hat seine Schicht; ein Treffer
 *   auf eine Kreatur klingt nach Schadensart und Material (und kritisch mit Akzent), die Material-Schicht liegt leiser
 *   darunter; ein Treffer auf den Spieler trifft seine Rüstung: Metall (schwer) klirrt, Leder (mittel) klatscht dumpf,
 *   Stoff (leicht) und der bloße Leib fügen dem Schmerzlaut (`playerDamaged`) nichts hinzu (src/audio/armourProbe.ts liest
 *   das Brustteil der echten Ausrüstung).
 * - Telegraphs: ein kalter Ping für jedes Ausholen, darunter was ausholt – Flächenangriff grollt (anschwellend, tief),
 *   Schattenbrut zischt, Tiere und Gegner pingen; so laut wie die Treffer ringsum, von überall hörbar, wo der Schlag hörbar
 *   ist, untertitelt, und kein Ausholen eines Rudels wird verschluckt (Sperre höchstens ein Tick, genug Stimmen).
 * - Kreaturenlaute: wer den Spieler jagt, warnt (Ruf mit Untertitel, weit hörbar, lauter als jedes scheue Tier); jeder
 *   Todeslaut einer Kreatur, die in Mengen vorkommt, hat zwei verschiedene Takes und Streuung (nur der einzigartige
 *   Nachtmahr einen); kein Schmerzlaut übertönt den lautesten Treffer.
 * - Zählung: Kampf- und Kreaturklänge ≥ 80 (Akzeptanz M6-33), jede Kreatur hat Laut, Treffer, Tod und je Angriff einen Klang.
 */
import { describe, expect, it } from 'vitest';
import { ArmourProbe } from '../../../src/audio/armourProbe';
import { KAMPF_MATERIAL_SFX, KAMPF_RUESTUNG_SFX, TELEGRAPH_SFX, createEventSfxContext, cuesFor, isLoopCue, telegraphSound, type AudioCue } from '../../../src/audio/eventMap';
import { ARMOR_WEIGHT_CLASSES, type ArmorWeightClass } from '../../../src/content/schema/item';
import { kampfWelt } from '../game/kampf-testwelt';
import { KAMPF_KRITISCH_SFX, KAMPF_SCHWUNG_SFX, KAMPF_TREFFER_SFX } from '../../../src/audio/kampfKlaenge';
import { createBiquad, processBiquad, setBiquad } from '../../../src/audio/dsp/biquad';
import { renderSfx, renderTakes } from '../../../src/audio/dsp/render';
import { CONTENT } from '../../../src/content/index';
import { SFX_GROUPS, SFX_PRESETS, SFX_SAMPLE_RATE, type SfxPreset } from '../../../src/content/sfx/index';
import { HIT_MATERIALS, type HitMaterial } from '../../../src/game/combat/targets';
import type { SimEventMap } from '../../../src/game/sim';
import { BALANCE } from '../../../src/content/balance';

const BY_ID = new Map(SFX_PRESETS.map((p) => [p.id, p]));
const CREATURES = CONTENT.collection('creatures').values();
const PROFILES = CONTENT.collection('aiProfiles');
const ctx = createEventSfxContext();
/** One simulation tick [s]. */
const TICK_S = 1 / BALANCE.time.tickHz;

function preset(id: string): SfxPreset {
  const p = BY_ID.get(id);
  if (p === undefined) throw new Error(`kein Preset ${id}`);
  return p;
}

function ids(cues: readonly AudioCue[]): string[] {
  return cues.flatMap((c) => (isLoopCue(c) ? [] : [c.id]));
}

/** A hit of the player's blade on a body of `material` (the fields the sound reads). */
function hit(material: HitMaterial, crit = false, targetTeam: SimEventMap['hitLanded']['targetTeam'] = 'tier'): SimEventMap['hitLanded'] {
  return { attacker: 1, target: 2, targetTeam, amount: 8, art: 'hieb', crit, wucht: 1, hitstopTicks: 2, knockback: 4, material, backstab: false, layer: 0, x: 40, y: 24, tick: 0 };
}

/** Energy of `buf` after a biquad of `type` at `hz` [sum of squares]. */
function bandEnergy(buf: Float32Array, type: 'tiefpass' | 'hochpass', hz: number): number {
  const f = createBiquad();
  setBiquad(f, type, hz, 0.707, SFX_SAMPLE_RATE);
  let e = 0;
  for (const v of buf) {
    const y = processBiquad(f, v);
    e += y * y;
  }
  return e;
}

/** RMS of `buf` between `a` and `b` seconds. */
function rms(buf: Float32Array, a: number, b: number): number {
  const i0 = Math.floor(a * SFX_SAMPLE_RATE);
  const i1 = Math.min(buf.length, Math.floor(b * SFX_SAMPLE_RATE));
  let s = 0;
  for (let i = i0; i < i1; i++) s += (buf[i] as number) ** 2;
  return Math.sqrt(s / Math.max(1, i1 - i0));
}

describe('Treffer je Material (M6-33)', () => {
  it('jedes Körpermaterial hat seine Schicht; jede Kreatur des Contents ist aus einem davon', () => {
    for (const m of HIT_MATERIALS) expect(BY_ID.has(KAMPF_MATERIAL_SFX[m]), m).toBe(true);
    expect(new Set(Object.values(KAMPF_MATERIAL_SFX)).size).toBe(HIT_MATERIALS.length);
    for (const c of CREATURES) expect(HIT_MATERIALS as readonly string[], c.id).toContain(c.material);
  });

  it('ein Treffer auf eine Kreatur klingt nach Schadensart und Material, kritisch mit Akzent; auf den Spieler nur der Schmerzlaut', () => {
    for (const m of HIT_MATERIALS) {
      expect(ids(cuesFor('hitLanded', hit(m), ctx))).toEqual([KAMPF_TREFFER_SFX.hieb, KAMPF_MATERIAL_SFX[m]]);
      expect(ids(cuesFor('hitLanded', hit(m, true), ctx))).toEqual([KAMPF_TREFFER_SFX.hieb, KAMPF_MATERIAL_SFX[m], KAMPF_KRITISCH_SFX]);
    }
    // Every hit sound is placed at the body.
    for (const c of cuesFor('hitLanded', hit('schatten', true, 'schattenbrut'), ctx)) expect(c).toMatchObject({ x: 40, y: 24, layer: 0 });
    expect(cuesFor('hitLanded', hit('fleisch', false, 'spieler'), ctx)).toEqual([]);
  });

  it('ein Treffer auf den Spieler trifft seine Rüstung: schwer klirrt Metall, mittel klatscht Leder, leicht nichts', () => {
    const worn = (w: ArmorWeightClass | null): string[] => ids(cuesFor('hitLanded', hit('fleisch', true, 'spieler'), createEventSfxContext({ playerArmour: () => w })));
    expect(worn('schwer')).toEqual(['sfx_kampf_material_metall']);
    expect(worn('mittel')).toEqual(['sfx_kampf_material_leder']);
    expect(worn('leicht')).toEqual([]);
    expect(worn(null)).toEqual([]);
    for (const w of ARMOR_WEIGHT_CLASSES) {
      const id = KAMPF_RUESTUNG_SFX[w];
      if (id !== null) expect(BY_ID.has(id), w).toBe(true);
    }
    // At the body that was struck, and only with the armour: the hurt sound stays playerDamaged's.
    expect(cuesFor('hitLanded', hit('fleisch', false, 'spieler'), createEventSfxContext({ playerArmour: () => 'schwer' }))).toEqual([{ id: 'sfx_kampf_material_metall', x: 40, y: 24, layer: 0 }]);
  });

  it('die Rüstung liest das Brustteil der Ausrüstung: Bronze schwer, Leder mittel, Fasern leicht, nackt nichts', () => {
    const probe = new ArmourProbe();
    const k = kampfWelt();
    expect(probe.chestOf(k.sim)).toBeNull();
    for (const [item, weight] of [
      ['faserhemd', 'leicht'],
      ['lederwams', 'mittel'],
      ['bronzebrustpanzer', 'schwer'],
    ] as const) {
      k.wear(item, 'brust');
      expect(probe.chestOf(k.sim), item).toBe(weight);
    }
    // A helmet is not the chest: the chest piece decides.
    k.wear('lederkappe', 'kopf');
    expect(probe.chestOf(k.sim)).toBe('schwer');
  });

  it('gerendert: Metall klingt heller und länger nach als Leder; beide liegen leiser unter den Treffern', () => {
    const metal = renderSfx(preset(KAMPF_RUESTUNG_SFX.schwer));
    const leather = renderSfx(preset(KAMPF_RUESTUNG_SFX.mittel));
    const bright = (b: Float32Array): number => bandEnergy(b, 'hochpass', 2000) / Math.max(1e-12, bandEnergy(b, 'tiefpass', 400));
    expect(bright(metal)).toBeGreaterThan(10 * bright(leather));
    expect(rms(metal, 0.06, 0.12)).toBeGreaterThan(rms(leather, 0.06, 0.12));
    const quietestHit = Math.min(...Object.values(KAMPF_TREFFER_SFX).map((id) => preset(id).lautstaerke));
    for (const id of [KAMPF_RUESTUNG_SFX.schwer, KAMPF_RUESTUNG_SFX.mittel]) expect(preset(id).lautstaerke, id).toBeLessThan(quietestHit);
  });

  it('die Material-Schicht liegt leiser unter jeder Schadensart, kurz, mit Takes und Stimmen wie die Treffer', () => {
    const typeHits = Object.values(KAMPF_TREFFER_SFX).map(preset);
    const quietestHit = Math.min(...typeHits.map((p) => p.lautstaerke));
    for (const m of HIT_MATERIALS) {
      const p = preset(KAMPF_MATERIAL_SFX[m]);
      expect(p.lautstaerke, m).toBeLessThan(quietestHit);
      expect(p.varianten, m).toBeGreaterThanOrEqual(3);
      expect(p.stimmen, m).toBeGreaterThanOrEqual(preset(KAMPF_TREFFER_SFX.hieb).stimmen);
      expect(renderSfx(p).length / SFX_SAMPLE_RATE, m).toBeLessThanOrEqual(0.3);
    }
  });

  it('die Materialien klingen verschieden: Fell dumpfer als Fleisch, Panzer und Stein heller als Holz und Fell (gerendert)', () => {
    const bright = (m: HitMaterial): number => {
      const buf = renderSfx(preset(KAMPF_MATERIAL_SFX[m]));
      return bandEnergy(buf, 'hochpass', 2000) / Math.max(1e-12, bandEnergy(buf, 'tiefpass', 400));
    };
    expect(bright('fell')).toBeLessThan(bright('fleisch'));
    for (const hard of ['panzer', 'stein'] as const) for (const soft of ['holz', 'fell'] as const) expect(bright(hard), `${hard} > ${soft}`).toBeGreaterThan(bright(soft));
  });
});

describe('Telegraph-Klänge (M6-15, M6-33)', () => {
  const allAttacks = CREATURES.flatMap((c) => c.angriffe.map((a) => ({ c, a })));

  it('Fläche grollt, Schattenbrut zischt, Tiere und Gegner pingen – für jeden Angriff jeder Kreatur', () => {
    for (const { c, a } of allAttacks) {
      const flaeche = a.flaeche !== undefined;
      const expected = flaeche ? TELEGRAPH_SFX.flaeche : c.familie === 'schattenbrut' ? TELEGRAPH_SFX.brut : TELEGRAPH_SFX.schlag;
      expect(telegraphSound(c.id, flaeche), `${c.id}/${a.name}`).toBe(expected);
      const e: SimEventMap['creatureTelegraph'] = {
        entity: 1,
        creature: c.id,
        angriff: a.name,
        ticks: 30,
        poseTicks: 20,
        angle: 0,
        flaeche: flaeche ? { x: 8, y: 8, radius: 32 } : null,
        layer: 0,
        x: 8,
        y: 8,
        tick: 0,
      };
      expect(ids(cuesFor('creatureTelegraph', e, ctx)), `${c.id}/${a.name}`).toEqual([expected]);
    }
    // Every kind of telegraph occurs in the M6 content.
    const used = new Set(allAttacks.map(({ c, a }) => telegraphSound(c.id, a.flaeche !== undefined)));
    expect(used).toEqual(new Set(Object.values(TELEGRAPH_SFX)));
  });

  it('klar hörbar: so laut wie die Treffer, weiter als jeder Schlag, untertitelt, kein Ausholen wird verschluckt', () => {
    const quietestHit = Math.min(...Object.values(KAMPF_TREFFER_SFX).map((id) => preset(id).lautstaerke));
    const loudestSwing = Math.max(...Object.values(KAMPF_SCHWUNG_SFX).map((id) => preset(id).lautstaerke));
    const farthestBlow = Math.max(...allAttacks.map(({ a }) => preset(a.sound as string).reichweite));
    const packs = PROFILES.values().filter((p) => p.rudel !== undefined).length;
    expect(packs).toBeGreaterThan(0);
    for (const id of Object.values(TELEGRAPH_SFX)) {
      const p = preset(id);
      expect(p.lautstaerke, id).toBeGreaterThanOrEqual(quietestHit);
      expect(p.lautstaerke, id).toBeGreaterThan(loudestSwing);
      expect(p.reichweite, id).toBeGreaterThanOrEqual(farthestBlow);
      expect(p.untertitel?.de, id).toBeTruthy();
      expect(p.untertitel?.en, id).toBeTruthy();
      // A lock at most one tick, and voices for a pack's staggered wind-ups plus a spitter.
      expect(p.sperrzeit, id).toBeLessThanOrEqual(TICK_S + 1e-9);
      expect(p.stimmen, id).toBeGreaterThanOrEqual(4);
      expect(p.varianten, id).toBeGreaterThanOrEqual(2);
    }
  });

  it('gerendert: der Ping trägt alle drei; die Fläche schwillt tief an bis zum Schlag, die Brut trägt mehr Tiefe als der Ping', () => {
    const ping = renderSfx(preset(TELEGRAPH_SFX.schlag));
    const brut = renderSfx(preset(TELEGRAPH_SFX.brut));
    const flaeche = renderSfx(preset(TELEGRAPH_SFX.flaeche));
    // The ping (~3,1 kHz) is at the start of all three.
    for (const [name, buf] of [
      ['schlag', ping],
      ['brut', brut],
      ['flaeche', flaeche],
    ] as const) {
      const head = buf.subarray(0, Math.floor(0.05 * SFX_SAMPLE_RATE));
      expect(bandEnergy(head, 'hochpass', 2500), name).toBeGreaterThan(0.2 * bandEnergy(head, 'tiefpass', 2500));
    }
    const low = (b: Float32Array): number => bandEnergy(b, 'tiefpass', 900) / Math.max(1e-12, bandEnergy(b, 'hochpass', 900));
    expect(low(brut)).toBeGreaterThan(4 * low(ping));
    expect(low(flaeche)).toBeGreaterThan(low(brut));
    // The area rumble swells: louder just before the typical blow (0,4–0,5 s) than right after the ping (0,15–0,25 s).
    const rumble = new Float32Array(flaeche.length);
    const f = createBiquad();
    setBiquad(f, 'tiefpass', 300, 0.707, SFX_SAMPLE_RATE);
    flaeche.forEach((v, i) => (rumble[i] = processBiquad(f, v)));
    expect(rms(rumble, 0.4, 0.5)).toBeGreaterThan(2 * rms(rumble, 0.15, 0.25));
    expect(flaeche.length / SFX_SAMPLE_RATE).toBeGreaterThanOrEqual(0.6);
  });
});

describe('Abmischung der Kreaturenlaute (M6-33)', () => {
  it('jede Kreatur hat Laut, Treffer, Tod und je Angriff einen Klang', () => {
    expect(CREATURES.length).toBeGreaterThanOrEqual(22);
    for (const c of CREATURES) {
      for (const id of [c.sounds.laut, c.sounds.treffer, c.sounds.tod]) expect(BY_ID.has(id), `${c.id}: ${id}`).toBe(true);
      for (const a of c.angriffe) expect(BY_ID.has(a.sound ?? ''), `${c.id}/${a.name}`).toBe(true);
    }
  });

  it('wer den Spieler jagt, warnt: Ruf mit Untertitel, weit hörbar, lauter als jedes scheue Tier', () => {
    const haltung = (c: (typeof CREATURES)[number]): string => PROFILES.get(c.ki).haltung;
    const shy = CREATURES.filter((c) => haltung(c) === 'scheu');
    const hunters = CREATURES.filter((c) => haltung(c) === 'aggressiv' || haltung(c) === 'jaeger');
    expect(shy.length).toBeGreaterThan(0);
    expect(hunters.length).toBeGreaterThanOrEqual(8);
    const loudestShy = Math.max(...shy.map((c) => preset(c.sounds.laut).lautstaerke));
    for (const c of hunters) {
      const call = preset(c.sounds.laut);
      expect(call.untertitel, c.id).toBeDefined();
      expect(call.reichweite, c.id).toBeGreaterThanOrEqual(32);
      expect(call.lautstaerke, c.id).toBeGreaterThan(loudestShy);
    }
  });

  it('Todeslaute: zwei verschiedene Takes mit Streuung für jede Kreatur, die in Mengen vorkommt (nur der Nachtmahr einen)', () => {
    for (const c of CREATURES) {
      const p = preset(c.sounds.tod);
      if (c.id === 'nachtmahr') {
        expect(p.varianten).toBe(1);
        continue;
      }
      expect(p.varianten, c.id).toBeGreaterThanOrEqual(2);
      expect(p.streuung.tonhoehe, c.id).toBeGreaterThan(0);
      const [a, b] = renderTakes(p);
      expect(a, c.id).not.toEqual(b);
    }
  });

  it('die Sprünge von Rudel und Ansturm wiederholen sich nicht gleich; kein Schmerzlaut übertönt den lautesten Treffer', () => {
    for (const id of ['sfx_kreatur_wolf_sprung', 'sfx_kreatur_keiler_ansturm']) {
      expect(preset(id).varianten, id).toBeGreaterThanOrEqual(2);
      expect(preset(id).streuung.tonhoehe, id).toBeGreaterThan(0);
    }
    const loudestHit = Math.max(...Object.values(KAMPF_TREFFER_SFX).map((id) => preset(id).lautstaerke));
    for (const c of CREATURES) expect(preset(c.sounds.treffer).lautstaerke, c.id).toBeLessThanOrEqual(loudestHit);
  });

  it('Zählung: Kampf- und Kreaturklänge ≥ 80 (Akzeptanz M6-33)', () => {
    const groups = ['kampf', 'kreaturen', 'kreaturen_gruenhain', 'kreaturen_salzkueste', 'kreaturen_schattenbrut'] as const;
    const n = groups.reduce((sum, g) => sum + SFX_GROUPS[g].length, 0);
    expect(n).toBeGreaterThanOrEqual(80);
  });
});
