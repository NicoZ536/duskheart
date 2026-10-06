/**
 * M7-02 Abdeckung der Klänge (PROGRESS M7-02 "Nachrüstung aller Aktionen aus M3–M6 ohne Sound — Validator zählt ≥ 100 SFX;
 * Abdeckungsliste M3–M6 = 100 %"; MASTERPROMPT §11.4 "Aktionen: Sammeln, Interagieren, Werfen, Essen/Trinken, Sitzen,
 * Schlafen, Musizieren"):
 *
 * - every event of the systems of M3–M6 is either voiced (`EVENT_SFX`) or silent with its reason (`SILENT_EVENTS`): 100 %;
 * - the actions of M3–M6 that sounded only borrowed or not at all have their own sound since M7-02 (the retrofit list):
 *   a perk chosen (the menu click before), the heavy attack drawn back (silent before), a new bestiary stage (the recipe
 *   chime before); the cures' own sounds are ready for their items (`sounds.benutzen`, src/content/items);
 * - every action of §11.4 sounds, making music through the songs of the instruments (src/content/music);
 * - the SFX engine: at least 100 presets, the new wavetable source renders, deterministic, and sounds.
 */
import { describe, expect, it } from 'vitest';
import { EVENT_SFX, KERNEL_SFX, RETROFIT_SFX, SILENT_EVENTS, createEventSfxContext, cuesFor, isLoopCue } from '../../../src/audio/eventMap';
import { renderTakes } from '../../../src/audio/dsp/render';
import { CONTENT } from '../../../src/content/index';
import { MUSIC_PIECES, SONGS } from '../../../src/content/music/index';
import { SFX_PRESETS } from '../../../src/content/sfx/index';
import { BEACON_EVENT_TYPES } from '../../../src/game/beacons/events';
import { BOSS_EVENT_TYPES } from '../../../src/game/bosses/events';
import { FARMING_EVENT_TYPES } from '../../../src/game/farming/events';
import { FISHING_EVENT_TYPES } from '../../../src/game/fishing/events';
import { INSTRUMENT_EVENT_TYPES } from '../../../src/game/instruments/events';
import { PLACE_EVENT_TYPES } from '../../../src/game/places/events';
import { SHARD_EVENT_TYPES } from '../../../src/game/shards/events';
import { TRAVEL_EVENT_TYPES } from '../../../src/game/travel/events';
import { UNLOCK_EVENT_TYPES } from '../../../src/game/unlocks/events';
import { WORLD_SETTINGS_EVENT_TYPES } from '../../../src/game/worldsettings/events';
import { SIM_EVENT_TYPES, type SimEventMap } from '../../../src/game/sim';

const PRESETS = new Map(SFX_PRESETS.map((p) => [p.id, p]));
const ctx = createEventSfxContext();

/** The events of the systems of M7 (their own coverage comes with their strands). */
const M7_EVENTS: ReadonlySet<string> = new Set<string>([
  ...PLACE_EVENT_TYPES,
  ...WORLD_SETTINGS_EVENT_TYPES,
  ...FARMING_EVENT_TYPES,
  ...FISHING_EVENT_TYPES,
  ...BOSS_EVENT_TYPES,
  ...BEACON_EVENT_TYPES,
  ...UNLOCK_EVENT_TYPES,
  ...SHARD_EVENT_TYPES,
  ...TRAVEL_EVENT_TYPES,
  ...INSTRUMENT_EVENT_TYPES,
]);

/** The one-shot and loop ids an event starts. */
function started<K extends keyof SimEventMap>(type: K, payload: Partial<SimEventMap[K]>): string[] {
  return cuesFor(type, { tick: 0, ...payload } as SimEventMap[K], ctx).flatMap((c) => (isLoopCue(c) ? (c.cue === null ? [] : [c.cue.id]) : [c.id]));
}

describe('Abdeckung M3–M6', () => {
  it('jedes Ereignis der Systeme aus M3–M6 klingt oder schweigt mit Grund: 100 %', () => {
    const m3m6 = SIM_EVENT_TYPES.filter((t) => !M7_EVENTS.has(t));
    expect(m3m6.length).toBeGreaterThan(150);
    const covered = m3m6.filter((t) => (EVENT_SFX[t] !== undefined) !== (SILENT_EVENTS[t] !== undefined));
    expect(covered).toEqual(m3m6);
    for (const t of m3m6) if (SILENT_EVENTS[t] !== undefined) expect((SILENT_EVENTS[t] as string).length, t).toBeGreaterThanOrEqual(10);
    expect(covered.length / m3m6.length).toBe(1);
  });

  it('Nachrüstung: Perk-Wahl, schwerer Angriff und Bestiarium klingen eigen; die Heilklänge liegen für ihre Items bereit', () => {
    const before = { perk: 'sfx_ui_klick', bestiary: 'sfx_handwerk_entdeckt' };
    // A perk chosen: a seal of its own instead of the menu click.
    expect(started('perkChosen', { skill: 'kampf', level: 5, choice: 0 })).toEqual([KERNEL_SFX.perkChosen]);
    expect(KERNEL_SFX.perkChosen).not.toBe(before.perk);
    // The heavy attack drawn back: silent before (a pose only), now its own rush of breath.
    expect(started('attackWindup', { entity: 1, klasse: 'axt', schwer: true, ticks: 30 })).toEqual([RETROFIT_SFX.heavyWindup]);
    // A bow drawn keeps its draw sound; a light melee wind-up stays a pose (the blow sounds with attackStarted).
    expect(started('attackWindup', { entity: 1, klasse: 'axt', schwer: false, ticks: 12 })).toEqual([]);
    // A new bestiary stage: a page turned and written instead of the recipe chime.
    expect(started('bestiaryUnlocked', { creature: 'wolf', stage: 'gesichtet' })).toEqual([RETROFIT_SFX.bestiary]);
    expect(RETROFIT_SFX.bestiary).not.toBe(before.bestiary);
    for (const id of [KERNEL_SFX.perkChosen, RETROFIT_SFX.heavyWindup, RETROFIT_SFX.bestiary, 'sfx_heilen_verband', 'sfx_heilen_schiene']) {
      const p = PRESETS.get(id);
      expect(p, id).toBeDefined();
      if (p === undefined) continue;
      for (const take of renderTakes(p)) {
        let peak = 0;
        for (const v of take) peak = Math.max(peak, Math.abs(v));
        expect(peak, id).toBeGreaterThan(0.05);
      }
    }
    // The cures sound through their items' use sound (itemUsed); bandage and splint have one.
    for (const item of ['verband', 'schiene']) expect(started('itemUsed', { item, use: 'heilen', x: 0, y: 0, layer: 0 }).length, item).toBe(1);
  });

  it('jede Aktion aus §11.4 klingt – Musizieren über die Lieder der Instrumente', () => {
    const E = 1;
    const aktionen: ReadonlyArray<readonly [string, string[]]> = [
      ['Gehen', started('playerStep', { entity: E, terrain: 'gras', water: 'none', noise: 1 })],
      ['Sprint', started('playerStateChanged', { entity: E, state: 'sprint', previous: 'walk' })],
      ['Rolle', started('playerRolled', { entity: E, dx: 1, dy: 0 })],
      ['Schwimmen', started('playerStep', { entity: E, terrain: 'sand', water: 'deep', noise: 1 })],
      ['Herunterspringen', started('playerLanded', { entity: E, levels: 1, damage: 0, fracture: false, water: false })],
      ['Sammeln', started('harvestHit', { layer: 0, tx: 0, ty: 0, x: 8, y: 8, target: 'baum_eiche', action: 'faellen', material: 'holz', hits: 1, hitsNeeded: 3, tooHard: false })],
      ['Interagieren (E ohne Ziel)', started('commandRejected', { type: 'player.interact', reason: 'nothingToInteract' })],
      ['Werfen', started('itemThrown', { entity: E, item: 'stein', fromX: 0, fromY: 0, toX: 40, toY: 0, ticks: 20 })],
      ['Essen', started('activityStarted', { entity: E, action: 'essen', item: 'himbeeren', ticks: 90 })],
      ['Trinken', started('activityStarted', { entity: E, action: 'trinken', item: null, ticks: 90 })],
      ['Sitzen', started('activityStarted', { entity: E, action: 'sitzen', item: null, ticks: 0 })],
      ['Schlafen', started('sleepStarted', { entity: E, place: 'grasbett', x: 0, y: 0, layer: 0, nap: false })],
      ['Aufheben', started('itemsAdded', { item: 'holz', count: 1 })],
      ['Taschen voll', started('inventoryFull', { item: 'stein', count: 3 })],
      ['Kescher', started('netSwung', { fang: 'gluehwuermchen', layer: 0, x: 0, y: 0 })],
    ];
    for (const [aktion, ids] of aktionen) {
      expect(ids.length, aktion).toBeGreaterThan(0);
      for (const id of ids) expect(PRESETS.has(id), `${aktion}: ${id}`).toBe(true);
    }
    // Making music: every song of every instrument is a piece that plays notes.
    const pieces = new Map(MUSIC_PIECES.map((p) => [p.id, p]));
    for (const item of CONTENT.collection('items').values()) {
      for (const lied of item.instrument?.lieder ?? []) {
        const song = SONGS.find((s) => s.id === lied);
        const piece = pieces.get(song?.stueck ?? '');
        expect(piece, `${item.id}/${lied}`).toBeDefined();
        expect(piece?.patterns.some((pat) => pat.zeilen.some((row) => /[A-G][-#][0-8]/.test(row))), lied).toBe(true);
      }
    }
  });
});

describe('SFX-Engine', () => {
  it('mindestens 100 Presets; die Wavetable-Quelle klingt, deterministisch, aus den Tabellen der Musik', () => {
    expect(SFX_PRESETS.length).toBeGreaterThanOrEqual(100);
    expect(CONTENT.countsByCategory().sfx).toBe(SFX_PRESETS.length);
    const withTable = SFX_PRESETS.filter((p) => p.schichten.some((s) => s.quelle.art === 'wavetable'));
    expect(withTable.length).toBeGreaterThanOrEqual(3);
    const tables = new Set(CONTENT.collection('wavetables').values().map((t) => t.id));
    for (const p of withTable) {
      for (const s of p.schichten) if (s.quelle.art === 'wavetable') expect(tables.has(s.quelle.tabelle), `${p.id}: ${s.quelle.tabelle}`).toBe(true);
      const a = renderTakes(p);
      const b = renderTakes(p);
      expect(Buffer.from(a[0]?.buffer as ArrayBuffer).equals(Buffer.from(b[0]?.buffer as ArrayBuffer)), p.id).toBe(true);
      let peak = 0;
      for (const v of a[0] as Float32Array) peak = Math.max(peak, Math.abs(v));
      expect(peak, p.id).toBeGreaterThan(0.05);
    }
  });
});
