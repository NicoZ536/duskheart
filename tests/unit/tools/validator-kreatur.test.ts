/**
 * Validator-Regeln `kreatur` und `spawn` (M6-19, M6-27, MASTERPROMPT §31.4 „Jede Kreatur: Animationen aller Zustände,
 * Sounds, Beute, Bestiarium. Jedes Biom: Spawntabellen für Tag, Nacht und Jahreszeiten“; tools/validator/kreaturen.ts):
 * mit Fixtures – eine vollständige Kreatur besteht, eine fehlende Todesanimation, ein fehlender Laut, eine Ausholzeit, die
 * nicht zu den Ausholbildern passt, ein Nachtjäger ohne Augen, eine fehlende Beutetabelle oder ein fehlender
 * Bestiarium-Text sind Fehler; jedes Biom braucht seine Spawntabelle oder einen geplanten Eintrag mit offenem Task. Die
 * echten Kreaturen Hase, Reh, Wachtel und Nachtmahr bestehen die Regel mit ihren Sprites.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTENT } from '../../../src/content/index';
import { CREATURE_DIRECTIONS, CREATURE_BASE_ACTIONS, attackClipAction, creatureSpriteId } from '../../../src/content/creatures/schema';
import { ContentRegistry, type ContentRegistryView } from '../../../src/content/registry';
import { idSchema } from '../../../src/content/schema/common';
import { checkCreatures, checkSpawnTables, type CreatureClipInfo, type CreatureSpriteInfo } from '../../../tools/validator/kreaturen';
import { GEPLANTE_SPAWNTABELLEN } from '../../../tools/validator/spawn-geplant';
import type { KreaturErgebnis } from '../../../assets-src/lib/creature';
import { hase } from '../../../assets-src/sprites/kreaturen/hase';
import { reh } from '../../../assets-src/sprites/kreaturen/reh';
import { wachtel } from '../../../assets-src/sprites/kreaturen/wachtel';
import { nachtmahr } from '../../../assets-src/sprites/kreaturen/nachtmahr';

const loose = z.object({ id: idSchema }).passthrough();
const TEXT = { de: 'Ein Text.', en: 'A text.' };
const FPS = 10;

interface Probe {
  creature?: Record<string, unknown>;
  sprite?: Partial<CreatureSpriteInfo> | null;
  sfx?: string[];
  lootTables?: { id: string }[];
}

function clip(frames: number, strikeAt?: number): CreatureClipInfo {
  return { frames: Array.from({ length: frames }, (_, i) => i), fps: FPS, events: strikeAt === undefined ? [] : [{ frame: strikeAt, name: 'schlag' }] };
}

/** A complete sprite: every clip in down, up and right (mirrored left), the bite winding up 0,4 s (4 positions at 10 fps). */
function sprite(): CreatureSpriteInfo {
  const clips: Record<string, CreatureClipInfo> = {};
  for (const action of CREATURE_BASE_ACTIONS) for (const dir of ['down', 'up', 'right']) clips[`${action}_${dir}`] = clip(4);
  for (const dir of ['down', 'up', 'right']) clips[`${attackClipAction('biss')}_${dir}`] = clip(6, 4);
  return { w: 32, h: 32, spiegelbar: true, emissiv: true, clips, ausholen: { [`${attackClipAction('biss')}_down`]: { von: 0, bis: 3 } } };
}

function creature(): { id: string } & Record<string, unknown> {
  return {
    id: 'probe',
    familie: 'gegner',
    groesse: 32,
    aktiv: ['nacht'],
    augen: 'feuer',
    sounds: { laut: 'sfx_probe_laut', treffer: 'sfx_probe_treffer', tod: 'sfx_probe_tod' },
    angriffe: [{ name: 'biss', ausholzeit: 0.4, sound: 'sfx_probe_biss' }],
    ki: 'probe',
    beute: 'probe',
    biome: ['wiese'],
    bestiarium: { text: TEXT, hinweis: TEXT },
  };
}

function registry(p: Probe = {}): ContentRegistryView {
  const sfx = p.sfx ?? ['sfx_probe_laut', 'sfx_probe_treffer', 'sfx_probe_tod', 'sfx_probe_biss'];
  return new ContentRegistry()
    .defineCollection('sfx', loose, sfx.map((id) => ({ id })))
    .defineCollection('aiProfiles', loose, [{ id: 'probe' }])
    .defineCollection('lootTables', loose, p.lootTables ?? [{ id: 'probe' }])
    .defineCollection('creatures', loose, [{ ...creature(), ...(p.creature ?? {}) }])
    .defineCollection('spawnTables', loose, [{ id: 'wiese', tag: [{ kreatur: 'probe' }], nacht: [{ kreatur: 'probe' }] }]);
}

function sprites(p: Probe = {}): Map<string, CreatureSpriteInfo> {
  const m = new Map<string, CreatureSpriteInfo>();
  if (p.sprite !== null) m.set(creatureSpriteId('probe'), { ...sprite(), ...(p.sprite ?? {}) });
  return m;
}

function errors(p: Probe = {}): string[] {
  return checkCreatures(registry(p), sprites(p)).errors;
}

describe('Regel `kreatur` (M6-19)', () => {
  it('eine vollständige Kreatur besteht', () => {
    const res = checkCreatures(registry(), sprites());
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
  });

  it('fehlende Todesanimation ⇒ Fehler', () => {
    const clips = { ...sprite().clips };
    delete clips.death_down;
    expect(errors({ sprite: { clips } })).toEqual(['Kreatur probe: Clip death_down fehlt']);
    const noMirror = { ...sprite().clips };
    expect(errors({ sprite: { clips: noMirror, spiegelbar: false } }).some((e) => e.includes('_left fehlt und das Sprite ist nicht spiegelbar'))).toBe(true);
  });

  it('fehlender Laut oder Angriffssound ⇒ Fehler', () => {
    expect(errors({ sfx: ['sfx_probe_treffer', 'sfx_probe_tod', 'sfx_probe_biss'] })).toEqual(['Kreatur probe: Sound laut fehlt (sfx_probe_laut)']);
    expect(errors({ sfx: ['sfx_probe_laut', 'sfx_probe_treffer', 'sfx_probe_tod'] })).toEqual(['Kreatur probe: Angriff biss ohne Sound (sfx_probe_biss)']);
  });

  it('die Ausholzeit der Daten muss die der Ausholbilder sein, der Schlag bei Ausholen + Anlauf', () => {
    expect(errors({ creature: { angriffe: [{ name: 'biss', ausholzeit: 0.6, sound: 'sfx_probe_biss' }] } }).join('\n')).toMatch(/schlägt im Bild nach 0\.400 s zu, die Daten sagen 0\.600 s/);
    expect(errors({ creature: { angriffe: [{ name: 'biss', ausholzeit: 0.3, anlauf: 0.1, sound: 'sfx_probe_biss' }] } }).join('\n')).toMatch(/holt im Bild 0\.400 s aus, die Daten sagen 0\.300 s/);
    const clips = { ...sprite().clips, [`${attackClipAction('biss')}_down`]: clip(6) };
    expect(errors({ sprite: { clips } }).join('\n')).toMatch(/kein Event „schlag“/);
  });

  it('Nachtjäger brauchen leuchtende Augen, und Augen emissive Pixel', () => {
    expect(errors({ creature: { augen: null } })).toEqual(['Kreatur probe: Nachtjäger ohne leuchtende Augen (docs/ART.md §8)']);
    expect(errors({ sprite: { emissiv: false } })).toEqual(['Kreatur probe: leuchtende Augen (feuer) angegeben, das Sprite hat aber keine emissiven Pixel']);
  });

  it('Sprite, Größe, Beutetabelle und Bestiarium', () => {
    expect(errors({ sprite: null })).toEqual(['Kreatur probe: Sprite kreatur_probe fehlt']);
    expect(errors({ sprite: { w: 16, h: 16 } })).toEqual(['Kreatur probe: Sprite kreatur_probe ist 16×16, die Größe ist 32']);
    expect(errors({ lootTables: [] })).toEqual(['Kreatur probe: Beutetabelle probe fehlt']);
    expect(errors({ creature: { beute: null } })).toEqual(['Kreatur probe: keine Beutetabelle und keine Begründung (ohneBeute)']);
    expect(errors({ creature: { beute: null, ohneBeute: 'Leuchtet nur.' }, lootTables: [] })).toEqual([]);
    expect(errors({ creature: { bestiarium: { text: { de: 'Nur deutsch.' }, hinweis: TEXT } } })).toEqual(['Kreatur probe: Bestiarium-Text: Übersetzung fehlt (EN)']);
  });
});

/** The sprite infos of a generator result (as the validator builds them from the atlas and the generator). */
function infoOf(e: KreaturErgebnis): CreatureSpriteInfo {
  const ausholen: Record<string, { von: number; bis: number }> = {};
  for (const c of e.clips) if (c.ausholen !== null) ausholen[c.clip] = c.ausholen;
  return { w: e.sprite.w, h: e.sprite.h, spiegelbar: e.sprite.spiegelbar, emissiv: e.sprite.frames.some((f) => f.emissive.some((v) => v !== 0)), clips: e.sprite.clips, ausholen };
}

describe('Die ersten Kreaturen bestehen die Regel (M6-19)', () => {
  it('Hase, Reh, Wachtel und Nachtmahr: Clips, Ausholzeiten = Ausholbilder, Augen, Sounds, Beute, Bestiarium', () => {
    const map = new Map<string, CreatureSpriteInfo>([hase, reh, wachtel, nachtmahr].map((e) => [e.sprite.id, infoOf(e)]));
    const res = checkCreatures(CONTENT, map);
    const mine = res.errors.filter((e) => /Kreatur (hase|reh|wachtel|nachtmahr):/.test(e));
    expect(mine).toEqual([]);
    for (const id of ['hase', 'reh', 'wachtel', 'nachtmahr']) {
      const s = map.get(creatureSpriteId(id));
      expect(s).toBeDefined();
      for (const dir of CREATURE_DIRECTIONS.filter((d) => d !== 'left')) expect(s?.clips[`death_${dir}`], `${id} death_${dir}`).toBeDefined();
    }
  });
});

describe('Regel `spawn` (M6-27)', () => {
  const biomes = [
    { id: 'wiese', layer: 0 },
    { id: 'hoehle', layer: -1 },
    { id: 'kueste', layer: 0 },
  ];
  const creatures = [
    { id: 'hase', familie: 'friedlich', biome: ['wiese'] },
    { id: 'olm', familie: 'friedlich', biome: ['hoehle'] },
    { id: 'schatten', familie: 'schattenbrut', biome: [] },
  ];
  const PROGRESS = '- [ ] M9-01 Küste\n- [x] M9-02 fertig';
  const all = { tag: [{ kreatur: 'hase' }], nacht: [{ kreatur: 'hase' }, { kreatur: 'schatten' }] };

  function spawnErrors(tables: ({ id: string } & Record<string, unknown>)[], geplant: Record<string, { task: string; grund: string }> = { kueste: { task: 'M9-01', grund: 'Küste' } }): string[] {
    const reg = new ContentRegistry()
      .defineCollection('biomes', loose, biomes)
      .defineCollection('creatures', loose, creatures)
      .defineCollection('spawnTables', loose, tables);
    return checkSpawnTables({ registry: reg, geplant, progress: PROGRESS }).errors;
  }

  it('jedes Biom hat seine Tabelle oder eine geplante mit offenem Task', () => {
    const ok = [
      { id: 'wiese', ...all },
      { id: 'hoehle', tag: [], nacht: [{ kreatur: 'olm' }] },
    ];
    expect(spawnErrors(ok)).toEqual([]);
    expect(spawnErrors(ok, {})).toEqual(['Biom kueste: keine Spawntabelle (Tag, Nacht, Jahreszeiten) und kein geplanter Eintrag']);
    expect(spawnErrors(ok, { kueste: { task: 'M9-02', grund: 'Küste' } })[0]).toMatch(/der Task ist erledigt/);
    expect(spawnErrors(ok, { kueste: { task: 'M9-01', grund: 'Küste' }, mond: { task: 'M9-01', grund: 'x' } })).toEqual(['Geplante Spawntabelle für unbekanntes Biom mond']);
  });

  it('Tag und Nacht in jeder Jahreszeit (oder begründet leer); im Untergrund nur Nacht; nur Bewohner des Bioms', () => {
    const base = { id: 'hoehle', tag: [], nacht: [{ kreatur: 'olm' }] };
    expect(spawnErrors([{ id: 'wiese', tag: [{ kreatur: 'hase', jahreszeiten: ['sommer'] }], nacht: all.nacht }, base])).toEqual([
      'Spawntabelle wiese: tag im fruehling ohne Kreatur und ohne Begründung (leer.tag)',
      'Spawntabelle wiese: tag im herbst ohne Kreatur und ohne Begründung (leer.tag)',
      'Spawntabelle wiese: tag im winter ohne Kreatur und ohne Begründung (leer.tag)',
    ]);
    expect(spawnErrors([{ id: 'wiese', tag: [], nacht: all.nacht, leer: { tag: 'Tagsüber schläft hier alles.' } }, base])).toEqual([]);
    expect(spawnErrors([{ id: 'wiese', ...all }, { ...base, tag: [{ kreatur: 'olm' }] }])).toEqual(['Spawntabelle hoehle: im Untergrund gibt es keinen Tag – die Einträge gehören nach nacht (gilt zu jeder Stunde)']);
    expect(spawnErrors([{ id: 'wiese', tag: [{ kreatur: 'olm' }], nacht: all.nacht }, base])).toEqual(['Spawntabelle wiese: olm lebt nicht in wiese (biome)']);
  });

  it('der echte Inhalt: jede Tabelle vollständig, jedes Biom ohne Tabelle mit offenem Task geplant', () => {
    const progress = readFileSync(join(process.cwd(), 'PROGRESS.md'), 'utf8');
    expect(checkSpawnTables({ registry: CONTENT, geplant: GEPLANTE_SPAWNTABELLEN, progress }).errors).toEqual([]);
    // The core's reference animals and the Grünhain group's additions by day and at dusk (M6-19 … M6-22).
    expect(CONTENT.collection('spawnTables').get('gruenhain').tag.map((e) => e.kreatur).sort()).toEqual(['dachs', 'dornling', 'eichhoernchen', 'frosch', 'hase', 'keiler', 'reh', 'wachtel', 'wespenschwarm', 'wolf']);
  });
});
