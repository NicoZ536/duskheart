/**
 * M7-88 (docs/SPIEL.md §22 „Beschwörung (`spawnOwned` von `zweigling`, Besitzer `boss:<id>`)“; tools/validator/kreaturen.ts):
 * the rule `kreatur` warns about a wild creature in no spawn table – except a creature a boss summons (an attack
 * `art: 'beschwoerung'` naming it as `kreatur`): it only ever lives as an owned creature `boss:<id>`. Fixture registries
 * show both sides; the real content (the Zweigling of the Borkenvater) passes without that warning.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTENT } from '../../../src/content/index';
import { ContentRegistry, type ContentRegistryView } from '../../../src/content/registry';
import { idSchema } from '../../../src/content/schema/common';
import { checkCreatures, summonedCreatures } from '../../../tools/validator/kreaturen';

const loose = z.object({ id: idSchema }).passthrough();
const TEXT = { de: 'Ein Text.', en: 'A text.' };

/** A day creature with its loot table, AI profile, sounds and bestiary (no attacks: the rule needs no attack clips then). */
function kreatur(id: string): Record<string, unknown> & { id: string } {
  return {
    id,
    familie: 'gegner',
    groesse: 32,
    aktiv: ['tag'],
    sounds: { laut: 'sfx_laut', treffer: 'sfx_treffer', tod: 'sfx_tod' },
    angriffe: [],
    ki: 'probe',
    beute: id,
    biome: ['wiese'],
    bestiarium: { text: TEXT, hinweis: TEXT },
  };
}

/** A boss whose phases summon `beschworen` and use one non-summoning attack that names `nurGenannt` (not a summon). */
function boss(beschworen: readonly string[], nurGenannt?: string): Record<string, unknown> & { id: string } {
  return {
    id: 'probeboss',
    phasen: [
      { id: 'p1', angriffe: beschworen.slice(0, 1).map((k) => ({ id: `ruf_${k}`, art: 'beschwoerung', kreatur: k, anzahl: 2, maxGleichzeitig: 4 })) },
      {
        id: 'p2',
        angriffe: [
          ...beschworen.slice(1).map((k) => ({ id: `ruf_${k}`, art: 'beschwoerung', kreatur: k, anzahl: 1, maxGleichzeitig: 2 })),
          ...(nurGenannt === undefined ? [] : [{ id: 'stampfen', art: 'flaeche', kreatur: nurGenannt }]),
        ],
      },
    ],
  };
}

function registry(kreaturen: readonly string[], bosse: ReadonlyArray<Record<string, unknown> & { id: string }>, gespawnt: readonly string[]): ContentRegistryView {
  const r = new ContentRegistry()
    .defineCollection('sfx', loose, [{ id: 'sfx_laut' }, { id: 'sfx_treffer' }, { id: 'sfx_tod' }])
    .defineCollection('aiProfiles', loose, [{ id: 'probe' }])
    .defineCollection('lootTables', loose, kreaturen.map((id) => ({ id })))
    .defineCollection('creatures', loose, kreaturen.map(kreatur))
    .defineCollection('spawnTables', loose, [{ id: 'wiese', tag: gespawnt.map((k) => ({ kreatur: k })), nacht: [] }]);
  return bosse.length === 0 ? r : r.defineCollection('bosses', loose, [...bosse]);
}

/** Every creature's sprite: 32 px, every base clip – the rule then reports only what this test is about. */
function sprites(ids: readonly string[]) {
  const clip = { frames: [0, 1, 2, 3], fps: 10, events: [] };
  const clips: Record<string, typeof clip> = {};
  for (const action of ['idle', 'move', 'hit', 'death']) for (const dir of ['down', 'up', 'right']) clips[`${action}_${dir}`] = clip;
  return new Map(ids.map((id) => [`kreatur_${id}`, { w: 32, h: 32, spiegelbar: true, emissiv: false, clips }]));
}

const WARNUNG = (id: string): string => `Kreatur ${id} steht in keiner Spawntabelle`;

describe('Regel `kreatur`: beschworene Kreaturen ohne Spawntabelle (M7-88)', () => {
  it('beschworen ⇒ keine Warnung; weder gespawnt noch beschworen ⇒ Warnung', () => {
    const ids = ['wild', 'diener', 'streuner'];
    const res = checkCreatures(registry(ids, [boss(['diener'])], ['wild']), sprites(ids));
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([WARNUNG('streuner')]);
  });

  it('ohne Boss, der sie ruft, warnt die Regel weiter – auch wenn ein anderer Angriff die Kreatur nennt', () => {
    const ids = ['wild', 'diener'];
    expect(checkCreatures(registry(ids, [], ['wild']), sprites(ids)).warnings).toEqual([WARNUNG('diener')]);
    expect(checkCreatures(registry(ids, [boss([], 'diener')], ['wild']), sprites(ids)).warnings).toEqual([WARNUNG('diener')]);
  });

  it('Beschwörungen aller Phasen zählen', () => {
    const ids = ['wild', 'ast', 'wurzel'];
    const reg = registry(ids, [boss(['ast', 'wurzel'])], ['wild']);
    expect([...summonedCreatures(reg)].sort()).toEqual(['ast', 'wurzel']);
    expect(checkCreatures(reg, sprites(ids)).warnings).toEqual([]);
  });

  it('der echte Inhalt: der Borkenvater beschwört den Zweigling, und die Regel warnt über ihn nicht mehr', () => {
    expect([...summonedCreatures(CONTENT)]).toContain('zweigling');
    expect(CONTENT.collection('spawnTables').values().some((t) => [...t.tag, ...t.nacht].some((e) => e.kreatur === 'zweigling'))).toBe(false);
    const warnings = checkCreatures(CONTENT, new Map()).warnings;
    expect(warnings).not.toContain(WARNUNG('zweigling'));
  });
});
