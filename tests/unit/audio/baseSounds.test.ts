/**
 * M4-29 "jede Bau-/Crafting-Aktion hat Sound (Abdeckungsliste)": the sounds of the base.
 *
 * - The tables of src/audio/baseSounds.ts cover the content: every §16.2 material, every container, every door part;
 *   every station line has its own sounds in its content record (src/content/stations.ts, the only table of station
 *   sounds, which the audio plays as they are); each names an existing preset – loops where something keeps working,
 *   one-shots otherwise.
 * - The coverage list: every building, crafting, station, storage, hearth and fire action of M4 (every part placed and
 *   taken down, every door opened and closed, every station set up, every recipe finished …) makes a sound whose preset
 *   exists; the loops of working stations, blazes and the hearth are tested with the simulation in loopSources.test.ts.
 * - One sound per moment: what another event already voices stays silent here (the chest as a build part, the pieces
 *   arriving in the bags, the collapse for all its tiles).
 */
import { describe, expect, it } from 'vitest';
import {
  BREAK_SOUNDS,
  BUILD_AUDIO,
  BUILD_MATERIAL_SOUND,
  CHEST_ITEM_SOUND,
  CHEST_SOUNDS,
  DOOR_AUDIO,
  DOOR_SOUNDS,
  FIRE_AUDIO,
  HEARTH_AUDIO,
  SOUND_MATERIALS,
  STATION_EXTRA_AUDIO,
  STORAGE_AUDIO,
  doorSound,
} from '../../../src/audio/baseSounds';
import { KERNEL_SFX, createEventSfxContext, cuesFor, isLoopCue, recipeSound, type AudioCue, type EventSfxContext } from '../../../src/audio/eventMap';
import type { SfxCue } from '../../../src/audio/sfxPlayer';
import { BALANCE } from '../../../src/content/balance';
import { BUILD_MATERIALS } from '../../../src/content/balance/building';
import { OPENABLE_KINDS } from '../../../src/content/buildParts';
import { CONTENT } from '../../../src/content/index';
import { SFX_PRESETS } from '../../../src/content/sfx/index';
import type { StationDef } from '../../../src/content/stations';
import { PART_REMOVE_REASONS } from '../../../src/game/building/events';
import { CRAFTING_SFX } from '../../../src/game/crafting/events';
import { LIGHT_SFX } from '../../../src/game/light/events';
import type { StationStopReason } from '../../../src/game/stations/state';
import type { SimEventMap } from '../../../src/game/sim';
import type { GameCommandType } from '../../../src/game/commands';
import { TILE_PX } from '../../../src/world/model/coords';

const PRESETS = new Map(SFX_PRESETS.map((p) => [p.id, p]));
const ctx = createEventSfxContext();
const stations = CONTENT.collection('stations').values();
const parts = CONTENT.collection('buildParts').values();
const recipes = CONTENT.collection('recipes').values();

interface Example {
  readonly type: keyof SimEventMap;
  readonly payload: unknown;
}

/** An entry of the coverage list: the action, its task, an event that stands for it. */
type Entry = readonly [aktion: string, task: string, beispiel: Example];

function entry(aktion: string, task: string, beispiel: Example): Entry {
  return [aktion, task, beispiel];
}

/** An event with the fields its sound depends on. */
function ev<K extends keyof SimEventMap>(type: K, payload: Partial<Omit<SimEventMap[K], 'tick'>>): Example {
  return { type, payload: { ...payload, tick: 0 } };
}

function cues(e: Example, lookups: EventSfxContext = ctx): readonly AudioCue[] {
  return cuesFor(e.type, e.payload as SimEventMap[typeof e.type], lookups);
}

/** The ids an event starts (one-shots and loops). */
function started(e: Example, lookups: EventSfxContext = ctx): string[] {
  return cues(e, lookups).flatMap((c) => (isLoopCue(c) ? (c.cue === null ? [] : [c.cue.id]) : [c.id]));
}

function isLoop(id: string): boolean {
  return PRESETS.get(id)?.schleife !== undefined;
}

const AT = { layer: 0, x: 40, y: 56 } as const;
const TILE = { layer: 0, tx: 2, ty: 3 } as const;
const CHEST = { chest: 1, ...AT } as const;
const HEARTH = { hearth: 1, ...AT } as const;
const FIRE = { ...TILE, ...AT } as const;

/** Each part as a placed, taken down and destroyed piece. */
const PART_EXAMPLES = parts.flatMap((p): Entry[] => {
  const base = { part: p.id, ...TILE, ebene: 'struktur' as const, material: p.material };
  return [
    entry(`${p.id} setzen`, 'M4-12', ev('partPlaced', { ...base, rot: 0, mirror: false, blueprint: false })),
    entry(`${p.id} als Blaupause`, 'M4-24', ev('partPlaced', { ...base, rot: 0, mirror: false, blueprint: true })),
    entry(`${p.id} abbauen`, 'M4-25', ev('partRemoved', { ...base, reason: 'abgebaut', refund: 'ganz' })),
    entry(`${p.id} zerstört`, 'M4-28', ev('partRemoved', { ...base, reason: 'zerstoert', refund: 'keine' })),
    entry(`${p.id} beschädigt`, 'M4-28', ev('partDamaged', { ...base, hp: 10 })),
    entry(`${p.id} fertiggestellt`, 'M4-24', ev('blueprintCompleted', base)),
  ];
});

/** Doors opened and closed. */
const DOOR_EXAMPLES = parts
  .filter((p) => OPENABLE_KINDS.includes(p.art))
  .flatMap((p): Entry[] => [
    entry(`${p.id} öffnen`, 'M4-12', ev('doorToggled', { part: p.id, ...TILE, open: true })),
    entry(`${p.id} schließen`, 'M4-12', ev('doorToggled', { part: p.id, ...TILE, open: false })),
  ]);

/** Stations set up and taken down (the camp fire is set up by the light system). */
const STATION_EXAMPLES = stations
  .filter((s) => s.brennt !== true)
  .flatMap((s): Entry[] => [
    entry(`${s.id} aufstellen`, 'M4-05/M4-06', ev('stationPlaced', { id: 1, station: s.id, ...AT, tx: 2, ty: 3 })),
    entry(`${s.id} abbauen`, 'M4-05/M4-06', ev('stationRemoved', { id: 1, station: s.id, ...AT })),
  ]);

/** Every recipe finished: in the hand, at a hand station – a processing station's batch comes out of its slots. */
const CRAFT_EXAMPLES = recipes.flatMap((r): Entry[] => {
  const def = r.station === null ? undefined : CONTENT.collection('stations').get(r.station);
  if (def?.art === 'verarbeitung') return [entry(`${r.id} als Charge fertig`, 'M4-04', ev('stationProduced', { id: 1, station: def.id, ...AT, recipe: r.id, item: r.ergebnis.item, count: 1 }))];
  return [entry(`${r.id} hergestellt`, 'M4-02', ev('craftCompleted', { recipe: r.id, item: r.ergebnis.item, count: r.ergebnis.anzahl, qualitaet: 1, aufgewertet: false }))];
});

/** Building, crafting and the base of M4 → an event that stands for the action. */
const ABDECKUNG: readonly Entry[] = [
  ...PART_EXAMPLES,
  ...DOOR_EXAMPLES,
  entry('Blaupause verwerfen', 'M4-24', ev('partRemoved', { part: 'wand_holz', ...TILE, ebene: 'struktur', reason: 'abgebaut', refund: 'keine', material: 'holz' })),
  entry('Wandmöbel fällt herab', 'M4-19', ev('partRemoved', { part: 'regal_wand', ...TILE, ebene: 'wandobjekt', reason: 'abgefallen', refund: 'ganz', material: 'holz' })),
  entry('Dach stürzt ein', 'M4-14', ev('roofCollapsed', { layer: 0, tiles: [2, 3, 3, 3], x: 48, y: 56 })),
  entry('Aufwerten an Ort und Stelle', 'M4-25', ev('partUpgraded', { from: 'wand_holz', to: 'wand_stein', ...TILE, ebene: 'struktur', material: 'stein' })),
  entry('Flächenreparatur', 'M4-25', ev('partRepaired', { part: 'wand_holz', ...TILE, ebene: 'struktur', hp: 300, material: 'holz' })),
  ...STATION_EXAMPLES,
  entry('Rezept entdeckt', 'M4-01', ev('recipeDiscovered', { recipe: 'rezept_brett' })),
  entry('Auftrag in die Warteschlange', 'M4-02', ev('craftQueued', { recipe: 'rezept_faserseil', count: 3, index: 0 })),
  entry('Herstellen aus der Hand beginnt', 'M3-16', ev('craftStarted', { recipe: 'rezept_faserseil', ticks: 60 })),
  entry('Auftrag abgebrochen', 'M4-02', ev('craftCancelled', { recipe: 'rezept_brett', pieces: 2, reason: 'abgebrochen' })),
  ...CRAFT_EXAMPLES,
  entry('Station aufgewertet (Werkbank I → II)', 'M4-03', ev('stationUpgraded', { id: 1, from: 'werkbank', to: 'werkbank_2', ...AT })),
  entry('Brennstoff nachlegen', 'M4-04', ev('stationLoaded', { id: 1, station: 'lehmofen', bereich: 'brennstoff', item: 'holz', count: 2, ...AT })),
  entry('Station steht still: Ausgang voll', 'M4-04', ev('stationStopped', { id: 1, station: 'lehmofen', reason: 'ausgang', ...AT })),
  entry('Station steht still: kein Brennstoff', 'M4-04', ev('stationStopped', { id: 1, station: 'schmelzofen', reason: 'brennstoff', ...AT })),
  entry('Station steht still: nichts mehr zu tun (Ofen kühlt ab)', 'M4-04', ev('stationStopped', { id: 1, station: 'koehlermeiler', reason: 'eingang', ...AT })),
  entry('Reparieren', 'M4-09', ev('itemRepaired', { item: 'steinaxt', slot: { bereich: 'inventar', index: 0 }, haltbarkeit: 60, station: 'werkbank', materialien: { holz: 1 } })),
  ...Object.keys(BALANCE.storage.containers).flatMap(
    (item) =>
      [
        entry(`${item} öffnen`, 'M4-21', ev('chestOpened', { ...CHEST, item })),
        entry(`${item} schließen`, 'M4-21', ev('chestClosed', { ...CHEST, item })),
      ],
  ),
  entry('Einlagern', 'M4-21', ev('chestStored', { ...CHEST, item: 'kiste_holz', stored: 'holz', count: 5, by: 'spieler' })),
  entry('Alles einlagern', 'M4-21', ev('chestStored', { ...CHEST, item: 'kiste_holz', stored: 'holz', count: 5, by: 'alles' })),
  entry('Kiste sortieren', 'M4-21', ev('chestSorted', { ...CHEST, item: 'kiste_holz' })),
  entry('Kiste umbenennen', 'M4-21', ev('chestRenamed', { ...CHEST, item: 'kiste_holz', name: 'Holz' })),
  entry('Icon-Etikett', 'M4-21', ev('chestLabeled', { ...CHEST, item: 'kiste_holz', label: 'holz' })),
  entry('Schnellablage', 'M4-21', ev('quickStashed', { count: 12, chests: 2 })),
  entry('Herdfeuer: Brennstoff', 'M4-20', ev('hearthFueled', { ...HEARTH, item: 'holz', count: 4, stored: 4 })),
  entry('Herdfeuer entzünden', 'M4-20', ev('hearthIgnited', { ...HEARTH, radiusTiles: 12 })),
  entry('Herdfeuer erlischt', 'M4-20', ev('hearthOut', { ...HEARTH, reason: 'brennstoff' })),
  entry('Herdfeuer löschen', 'M4-20', ev('hearthOut', { ...HEARTH, reason: 'geloescht' })),
  entry('Glutkern einsetzen', 'M4-20', ev('hearthCoreSet', { ...HEARTH, index: 0, core: 'glutkern_1', radiusTiles: 16 })),
  entry('Glutkern nehmen', 'M4-20', ev('hearthCoreTaken', { ...HEARTH, index: 0, core: 'glutkern_1', radiusTiles: 12 })),
  entry('Feuer bricht aus (Fackel)', 'M4-28', ev('fireStarted', { ...FIRE, cause: 'fackel' })),
  entry('Feuer breitet sich aus', 'M4-28', ev('fireStarted', { ...FIRE, cause: 'ausbreitung' })),
  entry('Regen löscht', 'M4-28', ev('fireOut', { ...FIRE, reason: 'regen' })),
  entry('Abgebrannt', 'M4-28', ev('fireOut', { ...FIRE, reason: 'abgebrannt' })),
  entry('Baum brennt nieder', 'M4-28', ev('treeBurned', FIRE)),
  entry('Graben zuschütten', 'M4-40', ev('itemUsed', { item: 'erde', from: { bereich: 'schnellleiste', index: 0 }, use: 'zuschuetten', cured: [], ...AT })),
];

/** Commands of the base a click or key sends once: refused, they answer with the error sound. */
const BASE_COMMANDS: readonly GameCommandType[] = [
  'station.place',
  'station.remove',
  'station.use',
  'station.put',
  'station.take',
  'station.takeAll',
  'repair.item',
  'build.place',
  'build.blueprint',
  'build.complete',
  'build.remove',
  'build.upgrade',
  'build.door',
  'build.repair',
  'storage.open',
  'storage.put',
  'storage.take',
  'storage.takeAll',
  'storage.storeAll',
  'storage.quickStash',
  'storage.sort',
  'storage.rename',
  'storage.label',
  'hearth.use',
  'hearth.fuel',
  'hearth.take',
  'hearth.ignite',
  'hearth.douse',
  'hearth.core',
  'hearth.uncore',
];

describe('Klänge der Basis: Tabellen decken den Content', () => {
  it('jedes Material (§16.2) setzt, baut ab, birst und nimmt Schaden mit eigenem Klang', () => {
    for (const m of BUILD_MATERIALS) expect(SOUND_MATERIALS, m).toContain(BUILD_MATERIAL_SOUND[m]);
    for (const m of SOUND_MATERIALS) {
      for (const id of [BUILD_AUDIO.place[m], BUILD_AUDIO.dismantle[m]]) expect(PRESETS.has(id), `${m}: ${id}`).toBe(true);
    }
    for (const b of BREAK_SOUNDS) for (const id of [BUILD_AUDIO.destroyed[b], BUILD_AUDIO.damaged[b]]) expect(PRESETS.has(id), id).toBe(true);
    // Placement per material (wood, straw, stone, clay, glass, metal): six different sounds, and six for taking down.
    expect(new Set(Object.values(BUILD_AUDIO.place)).size).toBe(SOUND_MATERIALS.length);
    expect(new Set(Object.values(BUILD_AUDIO.dismantle)).size).toBe(SOUND_MATERIALS.length);
    // Palisade and timber frame are wood; glass breaks like glass, clay like masonry.
    expect([BUILD_MATERIAL_SOUND.palisade, BUILD_MATERIAL_SOUND.fachwerk]).toEqual(['holz', 'holz']);
  });

  it('jede Stationslinie hat eigenen Aufbau-Klang, eine Arbeitsschleife und ein eigenes „fertig“', () => {
    // The sounds of a line are those of its first stage (src/content/stations.ts).
    const lines = new Map<string, StationDef['sounds']>();
    for (const s of stations) if (s.stufe === 1) lines.set(s.linie, s.sounds);
    expect(new Set(lines.keys())).toEqual(new Set(stations.map((s) => s.linie)));
    const loops = new Set<string>();
    const done = new Set<string>();
    for (const [line, a] of lines) {
      expect(SOUND_MATERIALS).toContain(a.koerper);
      expect(isLoop(a.laeuft), `${line}: ${a.laeuft} ist eine Schleife`).toBe(true);
      expect(PRESETS.has(a.fertig) && !isLoop(a.fertig), `${line}: ${a.fertig}`).toBe(true);
      loops.add(a.laeuft);
      done.add(a.fertig);
    }
    // Fire, kiln, smelter bellows, saw, grindstone, spinning wheel … each station line sounds like itself.
    expect(loops.size).toBe(lines.size);
    expect(done.size).toBe(lines.size);
    expect(lines.get('amboss_bronze')?.koerper).toBe('metall');
    // Every stage of a line sounds like its line (Werkbank II like Werkbank I).
    for (const s of stations) expect(s.sounds, s.id).toEqual(lines.get(s.linie));
    // The audio plays what the station's record says – there is no second table: other sounds, other cues.
    const own: StationDef = { ...CONTENT.collection('stations').get('lehmofen'), sounds: { koerper: 'glas', laeuft: 'sfx_feuer_knistern', fertig: 'sfx_handwerk_fertig' } };
    const probe: EventSfxContext = { ...ctx, station: (id) => (id === own.id ? own : ctx.station(id)) };
    expect(started(ev('stationPlaced', { id: 1, station: own.id, ...AT, tx: 2, ty: 3 }), probe)).toEqual(['sfx_bau_setzen_glas']);
    expect(started(ev('stationRemoved', { id: 1, station: own.id, ...AT }), probe)).toEqual(['sfx_bau_abbauen_glas']);
    expect(started(ev('stationProduced', { id: 1, station: own.id, ...AT, recipe: 'rezept_ziegel', item: 'ziegel', count: 1 }), probe)).toEqual(['sfx_handwerk_fertig']);
    for (const id of Object.values(STATION_EXTRA_AUDIO)) expect(PRESETS.has(id) && !isLoop(id), id).toBe(true);
  });

  it('jeder Behälter (§16.7) hat seinen Deckel; jede Tür ihre Art', () => {
    for (const item of Object.keys(BALANCE.storage.containers)) expect(CHEST_ITEM_SOUND[item], item).toBeDefined();
    for (const c of CHEST_SOUNDS) for (const id of Object.values(STORAGE_AUDIO.lid[c])) expect(PRESETS.has(id), id).toBe(true);
    for (const id of [STORAGE_AUDIO.stored, STORAGE_AUDIO.all, STORAGE_AUDIO.sorted, STORAGE_AUDIO.labelled, STORAGE_AUDIO.quickStash]) expect(PRESETS.has(id), id).toBe(true);
    for (const d of DOOR_SOUNDS) for (const id of Object.values(DOOR_AUDIO[d])) expect(PRESETS.has(id), id).toBe(true);
    const doors = parts.filter((p) => OPENABLE_KINDS.includes(p.art));
    expect(doors.map((p) => [p.id, doorSound(p.id, p.art)])).toEqual([
      ['tuer_holz', 'holz'],
      ['tuer_verstaerkt', 'beschlagen'],
      ['tor_holz', 'tor'],
      ['falltuer_holz', 'falltuer'],
    ]);
  });

  it('Feuer und Herdfeuer: Schleifen brennen, Momente sind One-Shots, Wichtiges hat Untertitel', () => {
    expect(isLoop(FIRE_AUDIO.burning)).toBe(true);
    expect(isLoop(HEARTH_AUDIO.burning)).toBe(true);
    for (const id of [...Object.values(FIRE_AUDIO), ...Object.values(HEARTH_AUDIO)].filter((i) => i !== FIRE_AUDIO.burning && i !== HEARTH_AUDIO.burning)) expect(PRESETS.has(id) && !isLoop(id), id).toBe(true);
    // §27 "Untertitel für wichtige Laute": a fire breaking out, a burning tree, the base losing or gaining its protection,
    // a collapse, destruction, a station standing still, a batch done out of sight.
    const important = [
      FIRE_AUDIO.breaksOut,
      FIRE_AUDIO.treeBurned,
      HEARTH_AUDIO.ignited,
      HEARTH_AUDIO.out,
      HEARTH_AUDIO.doused,
      BUILD_AUDIO.collapse,
      ...Object.values(BUILD_AUDIO.destroyed),
      STATION_EXTRA_AUDIO.standstill,
      ...stations.filter((s) => s.art === 'verarbeitung').map((s) => s.sounds.fertig),
    ];
    for (const id of important) expect(PRESETS.get(id)?.untertitel, id).toBeDefined();
  });
});

describe('Klänge der Basis: Abdeckungsliste', () => {
  it('die Liste deckt jedes Bauteil, jede Tür, jede Station, jedes Rezept und jeden Behälter', () => {
    expect(PART_EXAMPLES.length).toBe(parts.length * 6);
    expect(DOOR_EXAMPLES.length).toBe(8);
    expect(CRAFT_EXAMPLES.length).toBe(recipes.length);
    expect(ABDECKUNG.length).toBeGreaterThan(parts.length * 6 + recipes.length);
  });

  it.each(ABDECKUNG.map(([aktion, task, beispiel]) => [`${aktion} (${task})`, beispiel] as const))('%s hat Klang', (_label, beispiel) => {
    const ids = started(beispiel);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(PRESETS.has(id), id).toBe(true);
  });

  it.each(BASE_COMMANDS)('abgelehnt: %s → Fehlerklang', (type) => {
    expect(started(ev('commandRejected', { type, reason: 'outOfReach' }))).toEqual(['sfx_ui_fehler']);
  });

  it('Stille Rückmeldungen: Kisten schließen immer, Feuer aus der Konsole', () => {
    expect(started(ev('commandRejected', { type: 'storage.close', reason: 'unknownChest' }))).toEqual([]);
    expect(started(ev('commandRejected', { type: 'fire.ignite', reason: 'nothingToBurn' }))).toEqual([]);
  });
});

describe('Klänge der Basis: je Material, Art und Station das Richtige, am richtigen Ort', () => {
  it('Setzen und Abbauen klingen nach dem Material, an der Kachelmitte', () => {
    const placed = (part: string, material: SimEventMap['partPlaced']['material']): SfxCue => cues(ev('partPlaced', { part, ...TILE, ebene: 'struktur', rot: 0, mirror: false, blueprint: false, material }))[0] as SfxCue;
    expect(placed('wand_holz', 'holz')).toEqual({ id: 'sfx_bau_setzen_holz', x: 2 * TILE_PX + TILE_PX / 2, y: 3 * TILE_PX + TILE_PX / 2, layer: 0 });
    expect(placed('dach_stroh', 'stroh').id).toBe('sfx_bau_setzen_stroh');
    expect(placed('wand_stein', 'stein').id).toBe('sfx_bau_setzen_stein');
    expect(placed('boden_lehm', 'lehm').id).toBe('sfx_bau_setzen_lehm');
    expect(placed('fenster_glas', 'glas').id).toBe('sfx_bau_setzen_glas');
    expect(placed('wand_palisade', 'palisade').id).toBe('sfx_bau_setzen_holz');
    // The anvil is set up with a clang, the kiln with clay, the bench with wood.
    const station = (id: string): string => started(ev('stationPlaced', { id: 1, station: id, ...AT, tx: 2, ty: 3 }))[0] ?? '';
    expect([station('amboss_bronze'), station('lehmofen'), station('werkbank'), station('schleifstein')]).toEqual(['sfx_bau_setzen_metall', 'sfx_bau_setzen_lehm', 'sfx_bau_setzen_holz', 'sfx_bau_setzen_stein']);
    expect(started(ev('stationRemoved', { id: 1, station: 'amboss_bronze', ...AT }))).toEqual(['sfx_bau_abbauen_metall']);
    const destroyed = (material: SimEventMap['partRemoved']['material']): string[] => started(ev('partRemoved', { part: 'x', ...TILE, ebene: 'struktur', reason: 'zerstoert', refund: 'keine', material }));
    expect([destroyed('fachwerk'), destroyed('lehm'), destroyed('glas')]).toEqual([['sfx_bau_bersten_holz'], ['sfx_bau_bersten_stein'], ['sfx_bau_bersten_glas']]);
  });

  it('Türen: geöffnet und geschlossen klingen verschieden, je Art', () => {
    const door = (part: string, open: boolean): string[] => started(ev('doorToggled', { part, ...TILE, open }));
    expect(door('tuer_holz', true)).toEqual(['sfx_tuer_holz_auf']);
    expect(door('tuer_holz', false)).toEqual(['sfx_tuer_holz_zu']);
    expect(door('tuer_verstaerkt', true)).toEqual(['sfx_tuer_beschlagen_auf']);
    expect(door('tor_holz', false)).toEqual(['sfx_tor_holz_zu']);
    expect(door('falltuer_holz', true)).toEqual(['sfx_falltuer_auf']);
  });

  it('Herstellen: fertig je Station; eigener Klang des Rezepts vor der Station; aus der Hand der Handwerksklang', () => {
    expect(recipeSound('rezept_brett', ctx)).toBe('sfx_station_saege_fertig');
    expect(recipeSound('rezept_bronzeaxt', ctx)).toBe('sfx_station_amboss_fertig');
    expect(recipeSound('rezept_garn', ctx)).toBe('sfx_station_spinnrad_fertig');
    expect(recipeSound('rezept_holzkohle_lagerfeuer', ctx)).toBe('sfx_station_brutzeln_fertig');
    // A Werkbank II recipe sounds like the bench.
    expect(recipeSound('rezept_amboss_bronze', ctx)).toBe('sfx_station_werkbank_fertig');
    expect(recipeSound('rezept_faserseil', ctx)).toBe('sfx_handwerk_fertig');
    expect(recipeSound('rezept_holzeimer_wasser', ctx)).toBe('sfx_wasser_schoepfen');
    // At a station the work is its loop (loopSources.ts), not the knocking of the hand.
    expect(started(ev('craftStarted', { recipe: 'rezept_brett', ticks: 60 }))).toEqual([]);
    expect(started(ev('craftStarted', { recipe: 'rezept_faserseil', ticks: 60 }))).toEqual(['sfx_handwerk_arbeiten']);
    // An upgrade recipe: the station changing sounds (stationUpgraded), not a finished piece.
    expect(started(ev('craftCompleted', { recipe: 'rezept_werkbank_2', item: 'werkbank_2', count: 1, qualitaet: 1, aufgewertet: true }))).toEqual([]);
    expect(started(ev('stationUpgraded', { id: 1, from: 'werkbank', to: 'werkbank_2', ...AT }))).toEqual([BUILD_AUDIO.upgraded]);
  });

  it('der Klang eines fertigen Stücks: der eigene des Rezepts (Wasser schöpfen), sonst der seiner Station, aus der Hand und ohne Rezept das Handwerk-Glöckchen', () => {
    // The mapping of src/audio/eventMap.ts `recipeSound` (it replaced the game module's `craftCompletedSound`).
    expect(recipeSound('rezept_holzeimer_wasser', ctx)).toBe('sfx_wasser_schoepfen');
    expect(CONTENT.collection('recipes').get('rezept_steinaxt').station).toBeNull();
    expect(recipeSound('rezept_steinaxt', ctx)).toBe(CRAFTING_SFX.done);
    expect(recipeSound('rezept_gibt_es_nicht', ctx)).toBe(CRAFTING_SFX.done);
    expect(started(ev('craftCompleted', { recipe: 'rezept_steinaxt', item: 'steinaxt', count: 1, qualitaet: 1, aufgewertet: false }))).toEqual([CRAFTING_SFX.done]);
  });

  it('Verarbeitung: Charge fertig an der Station, Stillstand je Grund', () => {
    const produced = cues(ev('stationProduced', { id: 1, station: 'schmelzofen', ...AT, recipe: 'rezept_bronzebarren', item: 'bronzebarren', count: 1 }));
    expect(produced).toEqual([{ id: 'sfx_station_schmelzen_fertig', ...AT }]);
    const stopped = (station: string, reason: StationStopReason): string[] => started(ev('stationStopped', { id: 1, station, reason, ...AT }));
    expect(stopped('lehmofen', 'ausgang')).toEqual([STATION_EXTRA_AUDIO.standstill]);
    expect(stopped('lehmofen', 'brennstoff')).toEqual(['sfx_feuer_erloeschen']);
    expect(stopped('lehmofen', 'eingang')).toEqual([STATION_EXTRA_AUDIO.cooling]);
    // The drying rack burns nothing: its last batch already sounded.
    expect(stopped('trockengestell', 'eingang')).toEqual([]);
    // Input goes in with the bags' own sound; fuel feeds the fire.
    expect(started(ev('stationLoaded', { id: 1, station: 'lehmofen', bereich: 'eingang', item: 'lehm', count: 2, ...AT }))).toEqual([]);
    expect(started(ev('stationLoaded', { id: 1, station: 'lehmofen', bereich: 'brennstoff', item: 'holz', count: 2, ...AT }))).toEqual([STATION_EXTRA_AUDIO.fuel]);
  });

  it('ein Klang je Moment: was ein anderes Ereignis vertont, bleibt hier still', () => {
    // Removed by a collapse or an upgrade: `roofCollapsed` and `partUpgraded` sound once for all tiles.
    for (const reason of PART_REMOVE_REASONS.filter((r) => r === 'eingestuerzt' || r === 'aufgewertet')) {
      expect(started(ev('partRemoved', { part: 'dach_stroh', ...TILE, ebene: 'dach', reason, refund: 'anteilig', material: 'stroh' })), reason).toEqual([]);
    }
    // The quick stash sounds once, not per chest.
    expect(started(ev('chestStored', { ...CHEST, item: 'kiste_holz', stored: 'holz', count: 5, by: 'schnellablage' }))).toEqual([]);
    // A blueprint finished: the hammer and the part's material.
    expect(started(ev('blueprintCompleted', { part: 'wand_stein', ...TILE, ebene: 'struktur', material: 'stein' }))).toEqual([BUILD_AUDIO.finished, 'sfx_bau_setzen_stein']);
    // A furniture light comes with its build part (`partPlaced` sounds with the material); a torch set up by hand sounds itself.
    expect(started(ev('lightPlaced', { light: 1, kind: 'harzlampe', mount: 'stand', ...TILE, lit: false }))).toEqual([]);
    expect(started(ev('lightPlaced', { light: 1, kind: 'kamin_stein', mount: 'boden', ...TILE, lit: false }))).toEqual([]);
    expect(started(ev('lightRemoved', { light: 1, kind: 'harzlampe', ...TILE, reason: 'abgebaut' }))).toEqual([]);
    expect(started(ev('lightPlaced', { light: 1, kind: 'fackel', mount: 'boden', ...TILE, lit: true }))).toEqual([LIGHT_SFX.place]);
  });

  it('Deckel und Herdfeuer klingen an ihrem Ort; Kisten öffnen je Art', () => {
    expect(cues(ev('chestOpened', { ...CHEST, item: 'truhe' }))).toEqual([{ id: 'sfx_truhe_oeffnen', ...AT }]);
    expect(started(ev('chestClosed', { ...CHEST, item: 'lagerregal' }))).toEqual(['sfx_regal_schliessen']);
    expect(started(ev('chestOpened', { ...CHEST, item: 'kiste_holz' }))).toEqual(['sfx_kiste_oeffnen']);
    expect(cues(ev('hearthIgnited', { ...HEARTH, radiusTiles: 12 }))).toEqual([{ id: HEARTH_AUDIO.ignited, ...AT }]);
    expect(cues(ev('fireStarted', { ...FIRE, cause: 'debug' }))).toEqual([{ id: FIRE_AUDIO.breaksOut, ...AT }]);
  });

  it('Graben zuschütten (M4-40): die Erde fällt hörbar in die Kachel, nicht das Klicken eines Items ohne Klang', () => {
    const used = (item: string, use: SimEventMap['itemUsed']['use']): Example => ev('itemUsed', { item, from: { bereich: 'schnellleiste', index: 0 }, use, cured: [], ...AT });
    // Earth has no use sound of its own; the filled tile sounds at its centre.
    expect(CONTENT.collection('items').get('erde').sounds.benutzen).toBeUndefined();
    expect(cues(used('erde', 'zuschuetten'))).toEqual([{ id: 'sfx_graben_zuschuetten', ...AT }]);
    expect(KERNEL_SFX.filled).toBe('sfx_graben_zuschuetten');
    expect(PRESETS.get(KERNEL_SFX.filled)?.bus).toBe('effekte');
    expect(isLoop(KERNEL_SFX.filled)).toBe(false);
    // Other uses keep the item's own sound (or the click of an item without one).
    expect(started(used('verband', 'heilen'))).toEqual([ctx.itemSound('verband', 'benutzen') ?? KERNEL_SFX.itemUsed]);
  });

  it('Brennstoff: auf ein Feuer gelegt klingt das Nachlegen, in eine Lampe der Brennstoff selbst', () => {
    const logs = ev('fireFueled', { light: 7, item: 'holz', count: 2, fuelSeconds: 90, ...AT });
    // The camp fire (and the fireplace) like a fired station: a log onto the embers.
    expect(LIGHT_SFX.fuel).toBe('sfx_feuer_nachlegen');
    expect(LIGHT_SFX.fuel).toBe(STATION_EXTRA_AUDIO.fuel);
    expect(cues(logs, createEventSfxContext({ placedLightKind: () => 'lagerfeuer' }))).toEqual([{ id: 'sfx_feuer_nachlegen', ...AT }]);
    expect(started(logs, createEventSfxContext({ placedLightKind: () => 'kamin_stein' }))).toEqual(['sfx_feuer_nachlegen']);
    // Without the simulation (a light it does not know) fuel lands on a fire, too.
    expect(started(logs)).toEqual(['sfx_feuer_nachlegen']);
    // Resin into a lamp's bowl: the resin's own sound, no log thunking onto embers.
    const resin = ev('fireFueled', { light: 7, item: 'harz', count: 1, fuelSeconds: 21600, ...AT });
    expect(started(resin, createEventSfxContext({ placedLightKind: () => 'harzlampe' }))).toEqual([CONTENT.collection('items').get('harz').sounds.aufheben]);
    expect(started(resin, createEventSfxContext({ placedLightKind: () => 'laterne_stehend' }))).not.toContain('sfx_feuer_nachlegen');
  });
});
