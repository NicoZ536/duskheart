/**
 * Validator-Regel `boss` (M7-32; tools/validator/boss.ts; docs/SPIEL.md §22 „Fixture-Test: 7 Clips ⇒ Fehler“) mit Fixtures: ein
 * vollständiger Boss besteht; 7 Clips, ein zu kleines Sprite, ein Angriff mit fremdem Clip, eine fehlende oder fremde
 * Arena-Vorlage, zwei Phasen, ein Drop mit zweiter Quelle, eine Trophäe ohne Wandmöbel, ein Herzsplitter ohne Block, eine
 * Titelkarte ohne Englisch und ein fehlendes Musikstück sind Fehler. Der echte Content besteht mit seinem Sprite.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTENT } from '../../../src/content/index';
import { ContentRegistry, type ContentRegistryView } from '../../../src/content/registry';
import { idSchema } from '../../../src/content/schema/common';
import { checkBosses, MIN_BOSS_CLIPS, type BossSpriteInfo } from '../../../tools/validator/boss';

const loose = z.object({ id: idSchema }).passthrough();
const TEXT = { de: 'Der Probe', en: 'The Probe' };
const CLIPS = ['idle', 'erwachen', 'wurzelstoss', 'beschwoeren', 'panzer', 'blaettersturm', 'raserei', 'treffer', 'tod'];
const attack = (clip: string) => ({ id: `a_${clip}`, art: 'arena', effekt: 'blaettersturm', sekunden: 1, gewicht: 1, abklingSekunden: 1, clip });
const PHASES = [0, 1, 2].map((i) => ({ id: `p${i}`, angriffe: [attack('wurzelstoss')] }));

type Row = { id: string } & Record<string, unknown>;

interface Probe {
  boss?: Record<string, unknown>;
  items?: Row[];
  parts?: Row[];
  layouts?: Row[];
  music?: boolean;
}

function registry(p: Probe = {}): ContentRegistryView {
  const r = new ContentRegistry()
    .defineCollection('items', loose, p.items ?? [
      { id: 'herz', quellen: ['boss:probe'] },
      { id: 'krone', quellen: ['boss:probe'] },
      { id: 'splitter', splitter: { art: 'herz' } },
    ])
    .defineCollection('buildParts', loose, p.parts ?? [{ id: 'krone', art: 'wandmoebel' }])
    .defineCollection('placeLayouts', loose, p.layouts ?? [{ id: 'arena_probe', ortstyp: 'bossarena' }])
    .defineCollection('bosses', loose, [
      { id: 'probe', sprite: 'boss_probe', arena: 'arena_probe', titel: TEXT, musik: 'probe_lied', phasen: PHASES, beute: { einzigartig: ['herz'], trophaee: 'krone', herzsplitter: 'splitter', weitere: [] }, ...p.boss },
    ]);
  return p.music === false ? r : r.defineCollection('music', loose, [{ id: 'probe_lied' }]);
}

function sprites(info: Partial<BossSpriteInfo> = {}): Map<string, BossSpriteInfo> {
  return new Map([['boss_probe', { w: 128, h: 128, clips: CLIPS, ...info }]]);
}

describe('Validator-Regel boss', () => {
  it('ein vollständiger Boss besteht', () => {
    expect(checkBosses(registry(), sprites())).toEqual({ errors: [], warnings: [] });
  });

  it('7 Clips ⇒ Fehler; ein Sprite unter 96 px; ein Angriff mit einem Clip, den das Sprite nicht hat; kein Sprite', () => {
    expect(MIN_BOSS_CLIPS).toBe(8);
    expect(checkBosses(registry(), sprites({ clips: CLIPS.slice(0, 7) })).errors).toEqual(['Boss probe: Sprite boss_probe hat 7 Clips, verlangt sind ≥ 8 eigene']);
    expect(checkBosses(registry(), sprites({ w: 64 })).errors).toEqual(['Boss probe: Sprite-Breite 64 px außerhalb 96–160 px']);
    expect(checkBosses(registry(), sprites({ clips: CLIPS.filter((c) => c !== 'wurzelstoss').concat('extra') })).errors).toHaveLength(3);
    expect(checkBosses(registry(), new Map()).errors).toEqual(['Boss probe: Sprite boss_probe fehlt']);
  });

  it('Arena-Vorlage fehlt oder gehört einem anderen Ortstyp; zwei Phasen', () => {
    expect(checkBosses(registry({ layouts: [] }), sprites()).errors).toEqual(['Boss probe: Arena-Vorlage arena_probe fehlt']);
    expect(checkBosses(registry({ layouts: [{ id: 'arena_probe', ortstyp: 'schrein' }] }), sprites()).errors[0]).toMatch(/Ortstyp schrein/);
    expect(checkBosses(registry({ boss: { phasen: PHASES.slice(0, 2) } }), sprites()).errors).toEqual(['Boss probe: 2 Phasen, verlangt sind ≥ 3']);
  });

  it('Drops: einzigartig nur mit der einzigen Quelle boss:<id>; Trophäe als Wandmöbel; Herzsplitter mit Block', () => {
    const shared = registry({ items: [{ id: 'herz', quellen: ['boss:probe', 'welt:baum'] }, { id: 'krone' }, { id: 'splitter', splitter: { art: 'herz' } }] });
    expect(checkBosses(shared, sprites()).errors).toEqual(['Boss probe: kein einzigartiger Drop (ein Item mit der einzigen Quelle boss:probe)', 'Boss probe: herz ist nicht einzigartig – seine einzige Quelle muss boss:probe sein']);
    expect(checkBosses(registry({ parts: [{ id: 'krone', art: 'moebel' }] }), sprites()).errors).toEqual(['Boss probe: Trophäe krone ist kein Wandmöbel-Bauteil']);
    const noShard = registry({ items: [{ id: 'herz', quellen: ['boss:probe'] }, { id: 'krone' }, { id: 'splitter' }] });
    expect(checkBosses(noShard, sprites()).errors).toEqual(['Boss probe: splitter ist kein Herzsplitter (Block splitter, Art herz)']);
  });

  it('Titelkarte DE/EN, Musikstück vorhanden (ohne Sammlung eine Warnung)', () => {
    expect(checkBosses(registry({ boss: { titel: { de: 'Der Probe', en: ' ' } } }), sprites()).errors).toEqual(['Boss probe: Titelkarte ohne Text in DE oder EN']);
    expect(checkBosses(registry({ boss: { musik: 'stille' } }), sprites()).errors).toEqual(['Boss probe: Musikstück stille fehlt']);
    const noMusic = checkBosses(registry({ music: false }), sprites());
    expect(noMusic.errors).toEqual([]);
    expect(noMusic.warnings).toHaveLength(1);
  });

  it('der echte Content besteht mit seinen Clips', () => {
    const real = new Map([['boss_borkenvater', { w: 128, h: 128, clips: [...CLIPS, 'stampfen'] }]]);
    expect(checkBosses(CONTENT, real).errors).toEqual([]);
  });
});
