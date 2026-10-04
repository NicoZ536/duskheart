/**
 * Validator-Regel `kreatur`, Telegraph und Tarnung (M6-15d; MASTERPROMPT §19.4 „Ausholzeit 0,3–0,8 s“, ADR-0106;
 * docs/SPIEL.md §11 „Tarnung“, docs/ART.md §15.3; tools/validator/kreaturen.ts):
 * - Ausholzeit + Anlauf eines Angriffs höchstens 0,8 s – sonst Fehler, im Validator wie im Schema;
 * - ein getarntes Profil (`tarnung`) verlangt die Clips `tarnung` und `erwachen` in allen Richtungen;
 * - ein Überfall (`ausTarnung`) ohne Tarnprofil ist ein Fehler – im Validator und beim Aufbau des Kreatur-Katalogs.
 * Der echte Inhalt (22 Kreaturen, der Dornling mit seinem Sprite) besteht.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTENT } from '../../../src/content/index';
import { AI_PROFILES, CREATURES, LOOT_TABLES, SPAWN_TABLES, TRAPS } from '../../../src/content/creatures/index';
import { CREATURE_BASE_ACTIONS, CREATURE_HIDDEN_ACTION, CREATURE_REVEAL_ACTION, WINDUP_MAX_SECONDS, attackClipAction, creatureAttackSchema, creatureSpriteId } from '../../../src/content/creatures/schema';
import { ContentRegistry, type ContentRegistryView } from '../../../src/content/registry';
import { idSchema } from '../../../src/content/schema/common';
import { CreatureCatalog } from '../../../src/game/creatures/catalog';
import { checkCreatures, type CreatureClipInfo, type CreatureSpriteInfo } from '../../../tools/validator/kreaturen';
import { dornling } from '../../../assets-src/sprites/kreaturen/dornling';

const loose = z.object({ id: idSchema }).passthrough();
const TEXT = { de: 'Ein Text.', en: 'A text.' };
const FPS = 10;

function clip(frames: number, strikeAt?: number): CreatureClipInfo {
  return { frames: Array.from({ length: frames }, (_, i) => i), fps: FPS, events: strikeAt === undefined ? [] : [{ frame: strikeAt, name: 'schlag' }] };
}

/** An attack of `aushol` s wind-up and `anlauf` s run-up (absent: none), the strike clip matching it at 10 fps. */
interface Attack {
  name: string;
  ausholzeit: number;
  anlauf?: number;
  ausTarnung?: true;
}

/** A complete sprite for `attacks` (plus the camouflage clips when `tarnClips`). */
function sprite(attacks: readonly Attack[], tarnClips: boolean): CreatureSpriteInfo {
  const clips: Record<string, CreatureClipInfo> = {};
  const actions: string[] = [...CREATURE_BASE_ACTIONS, ...(tarnClips ? [CREATURE_HIDDEN_ACTION, CREATURE_REVEAL_ACTION] : [])];
  for (const action of actions) for (const dir of ['down', 'up', 'right']) clips[`${action}_${dir}`] = clip(4);
  const ausholen: Record<string, { von: number; bis: number }> = {};
  for (const a of attacks) {
    const pose = Math.round(a.ausholzeit * FPS);
    const strike = Math.round((a.ausholzeit + (a.anlauf ?? 0)) * FPS);
    for (const dir of ['down', 'up', 'right']) clips[`${attackClipAction(a.name)}_${dir}`] = clip(strike + 2, strike);
    ausholen[`${attackClipAction(a.name)}_down`] = { von: 0, bis: pose - 1 };
  }
  return { w: 32, h: 32, spiegelbar: true, emissiv: true, clips, ausholen };
}

/** A registry with one creature `probe` of `attacks` whose profile has `tarnung` or not. */
function registry(attacks: readonly Attack[], tarnung: boolean): ContentRegistryView {
  return new ContentRegistry()
    .defineCollection('sfx', loose, ['sfx_probe_laut', 'sfx_probe_treffer', 'sfx_probe_tod', 'sfx_probe_angriff'].map((id) => ({ id })))
    .defineCollection('aiProfiles', loose, [{ id: 'probe', ...(tarnung ? { tarnung: { erwachen: 0.5, tarnenNach: 10 } } : {}) }])
    .defineCollection('lootTables', loose, [{ id: 'probe' }])
    .defineCollection('creatures', loose, [
      {
        id: 'probe',
        familie: 'gegner',
        groesse: 32,
        aktiv: ['nacht'],
        augen: 'feuer',
        sounds: { laut: 'sfx_probe_laut', treffer: 'sfx_probe_treffer', tod: 'sfx_probe_tod' },
        angriffe: attacks.map((a) => ({ ...a, sound: 'sfx_probe_angriff' })),
        ki: 'probe',
        beute: 'probe',
        biome: ['wiese'],
        bestiarium: { text: TEXT, hinweis: TEXT },
      },
    ])
    .defineCollection('spawnTables', loose, [{ id: 'wiese', tag: [{ kreatur: 'probe' }], nacht: [{ kreatur: 'probe' }] }]);
}

function errors(attacks: readonly Attack[], opts: { tarnung?: boolean; tarnClips?: boolean } = {}): string[] {
  const tarnung = opts.tarnung ?? false;
  const s = new Map([[creatureSpriteId('probe'), sprite(attacks, opts.tarnClips ?? tarnung)]]);
  return checkCreatures(registry(attacks, tarnung), s).errors;
}

describe('Regel `kreatur`: Ausholzeit + Anlauf ≤ 0,8 s (M6-15d)', () => {
  it('0,8 s Ausholen, 0,6 + 0,2 s und 0,4 + 0,1 s bestehen; 0,6 + 0,3 s und 0,8 + 0,1 s sind Fehler', () => {
    expect(WINDUP_MAX_SECONDS).toBe(0.8);
    expect(errors([{ name: 'stampfen', ausholzeit: 0.8 }])).toEqual([]);
    expect(errors([{ name: 'ansturm', ausholzeit: 0.6, anlauf: 0.2 }])).toEqual([]);
    expect(errors([{ name: 'sprung', ausholzeit: 0.4, anlauf: 0.1 }])).toEqual([]);
    expect(errors([{ name: 'ansturm', ausholzeit: 0.6, anlauf: 0.3 }])).toEqual(['Kreatur probe: Angriff ansturm schlägt erst nach 0.900 s zu – Ausholzeit + Anlauf höchstens 0.8 s (§19.4)']);
    expect(errors([{ name: 'ansturm', ausholzeit: 0.8, anlauf: 0.1 }])).toEqual(['Kreatur probe: Angriff ansturm schlägt erst nach 0.900 s zu – Ausholzeit + Anlauf höchstens 0.8 s (§19.4)']);
  });

  it('auch ohne Sprite: die Simulation schlägt nach Ausholzeit + Anlauf zu', () => {
    const res = checkCreatures(registry([{ name: 'ansturm', ausholzeit: 0.7, anlauf: 0.2 }], false), new Map());
    expect(res.errors).toEqual(['Kreatur probe: Sprite kreatur_probe fehlt', 'Kreatur probe: Angriff ansturm schlägt erst nach 0.900 s zu – Ausholzeit + Anlauf höchstens 0.8 s (§19.4)']);
  });

  it('das Schema lehnt einen Angriff über 0,8 s ab, 0,6 + 0,2 s nimmt es an', () => {
    const base = { name: 'ansturm', art: 'nahkampf', schadensart: 'wucht', schaden: 10, reichweite: 16, bogen: 60, abklingzeit: 3, gewicht: 1, wucht: 3, stagger: 0.3, sound: 'sfx_probe_angriff' } as const;
    expect(creatureAttackSchema.safeParse({ ...base, ausholzeit: 0.6, anlauf: 0.2 }).success).toBe(true);
    const bad = creatureAttackSchema.safeParse({ ...base, ausholzeit: 0.7, anlauf: 0.2 });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.map((i) => i.path.join('.'))).toEqual(['anlauf']);
  });
});

describe('Regel `kreatur`: Tarnung (M6-15d)', () => {
  const ueberfall: Attack = { name: 'ueberfall', ausholzeit: 0.5, ausTarnung: true };
  const peitsche: Attack = { name: 'peitsche', ausholzeit: 0.5 };

  it('ein Tarnprofil verlangt die Clips `tarnung` und `erwachen` in allen Richtungen', () => {
    expect(errors([peitsche, ueberfall], { tarnung: true })).toEqual([]);
    expect(errors([peitsche, ueberfall], { tarnung: true, tarnClips: false })).toEqual([
      'Kreatur probe: Clip tarnung_down fehlt',
      'Kreatur probe: Clip tarnung_up fehlt',
      'Kreatur probe: Clip tarnung_right bzw. tarnung_left fehlt',
      'Kreatur probe: Clip erwachen_down fehlt',
      'Kreatur probe: Clip erwachen_up fehlt',
      'Kreatur probe: Clip erwachen_right bzw. erwachen_left fehlt',
    ]);
    // Without camouflage the clips are not needed.
    expect(errors([peitsche])).toEqual([]);
  });

  it('ein Überfall (`ausTarnung`) ohne Tarnprofil ist ein Fehler', () => {
    expect(errors([peitsche, ueberfall])).toEqual(['Kreatur probe: Angriff ueberfall springt aus der Tarnung (ausTarnung), das KI-Profil probe hat aber keine tarnung']);
  });

  it('der Kreatur-Katalog lehnt einen Überfall ohne Tarnprofil ab', () => {
    const def = CREATURES.find((c) => c.id === 'dornling');
    const profile = AI_PROFILES.find((p) => p.id === 'dornling');
    if (def === undefined || profile === undefined) throw new Error('no dornling');
    const { tarnung: _t, ...plain } = profile;
    const profiles = AI_PROFILES.map((p) => (p.id === 'dornling' ? plain : p));
    expect(() => new CreatureCatalog(CREATURES, profiles, LOOT_TABLES, SPAWN_TABLES, TRAPS)).toThrow(/dornling has an ambush \(ausTarnung\) but its AI profile dornling no tarnung/);
    expect(() => new CreatureCatalog(CREATURES, AI_PROFILES, LOOT_TABLES, SPAWN_TABLES, TRAPS)).not.toThrow();
  });
});

describe('Der echte Inhalt besteht (M6-15d)', () => {
  it('alle Angriffe der 22 Kreaturen schlagen nach höchstens 0,8 s zu; der Dornling hat seine Tarnclips', () => {
    const map = new Map<string, CreatureSpriteInfo>();
    const e = dornling;
    const ausholen: Record<string, { von: number; bis: number }> = {};
    for (const c of e.clips) if (c.ausholen !== null) ausholen[c.clip] = c.ausholen;
    map.set(e.sprite.id, { w: e.sprite.w, h: e.sprite.h, spiegelbar: e.sprite.spiegelbar, emissiv: true, clips: e.sprite.clips, ausholen });
    const res = checkCreatures(CONTENT, map);
    expect(res.errors.filter((m) => /schlägt erst nach|ausTarnung|Clip (tarnung|erwachen)_/.test(m))).toEqual([]);
    expect(res.errors.filter((m) => m.startsWith('Kreatur dornling:'))).toEqual([]);
    expect(CREATURES).toHaveLength(22);
    for (const c of CREATURES) for (const a of c.angriffe) expect(a.ausholzeit + (a.anlauf ?? 0), `${c.id}.${a.name}`).toBeLessThanOrEqual(WINDUP_MAX_SECONDS);
  });
});
