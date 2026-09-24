/**
 * M3-33 "jede Spieleraktion aus M3 hat Sound (Abdeckungsliste)": every event type of `SimEventMap` is
 * either mapped to sounds (`EVENT_SFX`) or declared silent with a reason (`SILENT_EVENTS`) – never both,
 * never neither –, and every player action of M3 below produces at least one sound whose preset exists.
 * Actions whose simulation events are not there yet (torch and campfire M3-22, crafting M3-16, filling
 * the bucket, the screens M3-29–M3-31) are listed with their prepared presets.
 */
import { describe, expect, it } from 'vitest';
import { EVENT_SFX, LOOP_SLOTS, SILENT_EVENTS, createEventSfxContext, cuesFor, isLoopCue, type AudioCue } from '../../../src/audio/eventMap';
import type { SfxCue } from '../../../src/audio/sfxPlayer';
import { CONTENT } from '../../../src/content/index';
import { type FEAR_STAGES } from '../../../src/content/balance/fear';
import { PLAYER_MOVE_STATES } from '../../../src/content/balance/player';
import { SFX_PRESETS } from '../../../src/content/sfx/index';
import { INVENTORY_CHANGES } from '../../../src/game/inventory/events';
import { HARVEST_MATERIALS } from '../../../src/game/gathering/rules';
import { SIM_EVENT_TYPES, type SimEventMap } from '../../../src/game/sim';
import { SURVIVAL_SFX } from '../../../src/game/survival/events';

const IDS = new Set(SFX_PRESETS.map((p) => p.id));
const ctx = createEventSfxContext();

/** An event of the coverage list. */
interface Example {
  readonly type: keyof SimEventMap;
  readonly payload: unknown;
}
/**
 * An event with the fields its sound depends on (the rest of the payload is the simulation's business
 * and may grow without touching this list).
 */
function ev<K extends keyof SimEventMap>(type: K, payload: Partial<Omit<SimEventMap[K], 'tick'>>): Example {
  return { type, payload: { ...payload, tick: 0 } };
}

function cues(e: Example): readonly AudioCue[] {
  return cuesFor(e.type, e.payload as SimEventMap[typeof e.type], ctx);
}

/** The one-shot and loop ids an event starts. */
function started(e: Example): string[] {
  return cues(e).flatMap((c) => (isLoopCue(c) ? (c.cue === null ? [] : [c.cue.id]) : [c.id]));
}

const E = 1;
const SLOT = { bereich: 'inventar', index: 0 } as const;

/** M3 player actions → an event that stands for them. */
const ABDECKUNG: ReadonlyArray<readonly [aktion: string, task: string, beispiel: Example]> = [
  ['Erscheinen am Startstrand', 'M3-08', ev('playerSpawned', { entity: E, x: 0, y: 0, layer: 0 })],
  ...CONTENT.collection('terrain')
    .values()
    .filter((t) => t.walkable)
    .map((t) => [`Gehen auf ${t.id}`, 'M3-08', ev('playerStep', { entity: E, terrain: t.id, water: 'none', noise: 1 })] as const),
  ['Schleichen (leise Schritte)', 'M3-08', ev('playerStep', { entity: E, terrain: 'gras', water: 'none', noise: 0.3 })],
  ['Waten', 'M3-09', ev('playerStep', { entity: E, terrain: 'sand', water: 'shallow', noise: 1 })],
  ['Schwimmzug', 'M3-09', ev('playerStep', { entity: E, terrain: 'sand', water: 'deep', noise: 1 })],
  ['Sprint beginnen', 'M3-08', ev('playerStateChanged', { entity: E, state: 'sprint', previous: 'walk' })],
  ['Schleichen beginnen', 'M3-08', ev('playerStateChanged', { entity: E, state: 'sneak', previous: 'idle' })],
  ['Ins tiefe Wasser', 'M3-09', ev('playerStateChanged', { entity: E, state: 'swim', previous: 'walk' })],
  ['Herunterspringen', 'M3-09', ev('playerStateChanged', { entity: E, state: 'jump', previous: 'walk' })],
  ['Klettern', 'M3-09', ev('playerStateChanged', { entity: E, state: 'climb', previous: 'idle' })],
  ['Rolle', 'M3-08', ev('playerRolled', { entity: E, dx: 1, dy: 0 })],
  ['Landen', 'M3-09', ev('playerLanded', { entity: E, levels: 1, damage: 0, fracture: false, water: false })],
  ['Landen im Wasser', 'M3-09', ev('playerLanded', { entity: E, levels: 2, damage: 0, fracture: false, water: true })],
  ['Knochenbruch', 'M3-09', ev('playerLanded', { entity: E, levels: 3, damage: 20, fracture: true, water: false })],
  ['E ohne Ziel', 'M3-10', ev('commandRejected', { type: 'player.interact', reason: 'nothingToInteract' })],
  ['Rolle ohne Ausdauer', 'M3-17', ev('commandRejected', { type: 'player.roll', reason: 'noStamina' })],
  ['Werkzeug schwingen', 'M3-10', ev('actionStarted', { kind: 'object', layer: 0, tx: 1, ty: 1, target: 'baum_eiche', action: 'faellen', byHand: false, hitsNeeded: 5 })],
  ['Arbeit abgebrochen (Ziel weg)', 'M3-10', ev('actionStopped', { kind: 'object', target: 'baum_eiche', action: 'faellen', reason: 'gone' })],
  ...HARVEST_MATERIALS.map((m) => [`Treffer ${m}`, 'M3-11…M3-14', ev('harvestHit', { layer: 0, tx: 0, ty: 0, x: 8, y: 8, target: 'ziel', action: 'abbauen', material: m, hits: 1, hitsNeeded: 3, tooHard: false })] as const),
  ['Zu hart (Funken)', 'M3-12', ev('harvestHit', { layer: 0, tx: 0, ty: 0, x: 8, y: 8, target: 'erz_kupfer', action: 'abbauen', material: 'erz', hits: 0, hitsNeeded: 3, tooHard: true })],
  ['Pflücken von Hand', 'M3-13', ev('harvestHit', { layer: 0, tx: 0, ty: 0, x: 8, y: 8, target: 'busch_beeren', action: 'pfluecken', material: 'pflanze', hits: 1, hitsNeeded: 1, tooHard: false })],
  ['Baum fällt', 'M3-11', ev('treeFelled', { layer: 0, tx: 0, ty: 0, object: 'baum_eiche', direction: 'rechts', landsAtTick: 60 })],
  ['Baum schlägt auf', 'M3-11', ev('treeLanded', { layer: 0, tx: 1, ty: 0, object: 'baum_eiche', direction: 'rechts' })],
  ['Stumpf roden', 'M3-11', ev('harvested', { layer: 0, tx: 0, ty: 0, x: 8, y: 8, target: 'stumpf', action: 'roden', material: 'holz', skill: 'holzfaellen' })],
  ['Felsen zerbricht', 'M3-12', ev('harvested', { layer: 0, tx: 0, ty: 0, x: 8, y: 8, target: 'felsen', action: 'abbauen', material: 'stein', skill: 'bergbau' })],
  ['Buddelstelle gefunden', 'M3-14', ev('digSpotFound', { layer: 0, tx: 0, ty: 0 })],
  ['Drop springt heraus', 'M3-15', ev('dropSpawned', { entity: E, item: 'holz', count: 1, layer: 0, fromX: 0, fromY: 0, x: 8, y: 8 })],
  ['Drop landet', 'M3-15', ev('dropLanded', { entity: E, item: 'holz', x: 8, y: 8 })],
  ['Drop per Magnet', 'M3-10', ev('dropPickedUp', { entity: E, item: 'holz', count: 1, x: 8, y: 8, magnet: true })],
  ...CONTENT.collection('items')
    .values()
    .map((i) => [`Aufheben ${i.id}`, 'M3-10', ev('itemsAdded', { item: i.id, count: 1 })] as const),
  ['Taschen voll', 'M3-10', ev('inventoryFull', { item: 'stein', count: 3 })],
  ['Taschen voll am Drop', 'M3-10', ev('dropBlocked', { entity: E, item: 'stein', count: 3 })],
  ...INVENTORY_CHANGES.filter((c) => c !== 'add').map((c) => [`Inventar ${c}`, 'M3-02', ev('inventoryChanged', { change: c })] as const),
  ['Schnellleiste wählen', 'M3-02', ev('hotbarSelected', { index: 2 })],
  ['Ausrüsten', 'M3-03', ev('equipmentChanged', { at: SLOT, item: 'steinaxt' })],
  ['Ablegen', 'M3-03', ev('equipmentChanged', { at: SLOT, item: null })],
  ['Werkzeug zerbricht', 'M3-03', ev('itemBroken', { at: SLOT, item: 'steinaxt' })],
  ['Essen', 'M3-25', ev('activityStarted', { entity: E, action: 'essen', item: 'himbeeren', ticks: 90 })],
  ['Schlucken', 'M3-25', ev('itemEaten', { entity: E, item: 'himbeeren', satiety: 5, thirst: 1, freshness: 'frisch', poisoned: false })],
  ['Trinken', 'M3-25', ev('activityStarted', { entity: E, action: 'trinken', item: null, ticks: 90 })],
  ['Schluck Wasser', 'M3-25', ev('waterDrunk', { entity: E, source: 'fluss', thirst: 10, fever: false })],
  ['Hinsetzen', 'M3-25', ev('activityStarted', { entity: E, action: 'sitzen', item: null, ticks: 0 })],
  ['Aufstehen', 'M3-25', ev('activityFinished', { entity: E, action: 'sitzen', item: null })],
  ['Essen unterbrochen', 'M3-25', ev('activityInterrupted', { entity: E, action: 'essen', item: 'apfel', reason: 'treffer' })],
  ['Werfen', 'M3-25', ev('itemThrown', { entity: E, item: 'stein', fromX: 0, fromY: 0, toX: 40, toY: 0, ticks: 20 })],
  ['Wurf landet', 'M3-25', ev('thrownItemLanded', { entity: E, item: 'stein', x: 40, y: 0, layer: 0, sunk: false })],
  ['Wurf versinkt', 'M3-25', ev('thrownItemLanded', { entity: E, item: 'stein', x: 40, y: 0, layer: 0, sunk: true })],
  ['Hinlegen', 'M3-24', ev('sleepStarted', { entity: E, place: 'grasbett', x: 0, y: 0, layer: 0, nap: false })],
  ['Aufwachen', 'M3-24', ev('sleepEnded', { entity: E, reason: 'morgen', rested: true })],
  ['Aufgeschreckt', 'M3-24', ev('sleepEnded', { entity: E, reason: 'angriff', rested: false })],
  ...(Object.keys(SURVIVAL_SFX.damage) as Array<keyof typeof SURVIVAL_SFX.damage>).map((cause) => [`Schaden ${cause}`, 'M3-17', ev('playerDamaged', { entity: E, cause, amount: 1, health: 50, lethal: false })] as const),
  ...Object.keys(SURVIVAL_SFX.stage).map((stage) => [`Stufe ${stage}`, 'M3-17/M3-18', ev('survivalStageChanged', { entity: E, stat: 'satiety', stage, previous: 'satt' })] as const),
  ...CONTENT.collection('conditions')
    .values()
    .map((c) => [`Zustand ${c.id}`, 'M3-19', ev('conditionApplied', { entity: E, id: c.id, outcome: 'neu', stacks: 1, remainingTicks: 60 })] as const),
  ['Zustand endet', 'M3-19', ev('conditionRemoved', { entity: E, id: 'blutung', reason: 'abgelaufen' })],
  ['Erbrechen', 'M3-19', ev('conditionPulse', { entity: E, id: 'lebensmittelvergiftung', satiety: -5, thirst: -5 })],
  ['Zustand verletzt', 'M3-19', ev('playerAfflicted', { entity: E, source: 'zustand', id: 'blutung', amount: 1, health: 40 })],
  ['Flüstern ab 40 Furcht', 'M3-23', ev('fearStageChanged', { entity: E, stage: 'fluestern', previous: 'unruhig', value: 41 })],
  ['Schreck', 'M3-23', ev('fearChanged', { entity: E, amount: 10, reason: 'sichtung', value: 50 })],
  ['Erleichterung', 'M3-23', ev('fearChanged', { entity: E, amount: -10, reason: 'wohlfuehlessen', value: 30 })],
  ['Trugbild erscheint', 'M3-23', ev('hallucinationAppeared', { entity: E, id: 1, x: 80, y: 0, harmful: false })],
  ['Trugbild verblasst', 'M3-23', ev('hallucinationVanished', { entity: E, id: 1, reason: 'licht' })],
  ['Nachtmahr', 'M3-23', ev('nightmareSummoned', { entity: E })],
  ['Nachtmahr weicht', 'M3-23', ev('nightmareEnded', { entity: E, reason: 'licht' })],
  ['Tod', 'M3-26', ev('playerDied', { entity: E, x: 0, y: 0, layer: 0, cause: 'sturz', grave: 1, permadeath: false })],
  ['Grab entsteht', 'M3-26', ev('graveCreated', { grave: 1, x: 0, y: 0, layer: 0, items: 5 })],
  ['Grab leeren', 'M3-26', ev('graveLooted', { grave: 1, taken: 5, remaining: 0 })],
  ['Wiedereinstieg', 'M3-26', ev('playerRespawned', { entity: E, x: 0, y: 0, layer: 0, at: 'strand' })],
  ['Bett als Wiedereinstieg', 'M3-26', ev('respawnPointSet', { x: 0, y: 0, layer: 0, kind: 'grasbett' })],
  ['Erfahrung', 'M3-32', ev('xpGained', { skill: 'holzfaellen', amount: 8, source: 'faellen' })],
  ['Stufenaufstieg', 'M3-32', ev('skillLevelUp', { skill: 'holzfaellen', level: 2 })],
];

/** Actions whose sim events come with their tasks; their presets are ready. */
const VORBEREITET: ReadonlyArray<readonly [aktion: string, task: string, preset: string]> = [
  ['Fackel entzünden (F)', 'M3-22', 'sfx_fackel_entzuenden'],
  ['Fackel löschen (F, Regen)', 'M3-22', 'sfx_fackel_erloeschen'],
  ['Fackel brennt (Schleife)', 'M3-22', 'sfx_fackel_brennen'],
  ['Lagerfeuer entzünden', 'M3-22', 'sfx_feuer_entzuenden'],
  ['Lagerfeuer knistert (Schleife)', 'M3-22', 'sfx_feuer_knistern'],
  ['Lagerfeuer erlischt', 'M3-22', 'sfx_feuer_erloeschen'],
  ['Herstellen läuft', 'M3-16', 'sfx_handwerk_arbeiten'],
  ['Hergestellt', 'M3-16', 'sfx_handwerk_fertig'],
  ['Eimer füllen', 'M3-15', 'sfx_wasser_schoepfen'],
  ['Bildschirm öffnen', 'M3-30', 'sfx_ui_oeffnen'],
  ['Bildschirm schließen', 'M3-30', 'sfx_ui_schliessen'],
  ['Knopf', 'M3-31', 'sfx_ui_klick'],
  ['Fokus/Hover', 'M3-31', 'sfx_ui_hover'],
  ['Meldung', 'M3-29', 'sfx_ui_meldung'],
];

describe('Ereignis → Klang', () => {
  it('jedes Sim-Ereignis ist entweder vertont oder begründet still – nie beides, nie keins', () => {
    const problems: string[] = [];
    for (const type of SIM_EVENT_TYPES) {
      const mapped = EVENT_SFX[type] !== undefined;
      const silent = SILENT_EVENTS[type] !== undefined;
      if (mapped === silent) problems.push(`${type}: ${mapped ? 'vertont und still' : 'weder vertont noch still – in src/audio/eventMap.ts abbilden oder in SILENT_EVENTS begründen'}`);
    }
    for (const type of [...Object.keys(EVENT_SFX), ...Object.keys(SILENT_EVENTS)]) {
      if (!(SIM_EVENT_TYPES as readonly string[]).includes(type)) problems.push(`${type}: kein Sim-Ereignis`);
    }
    expect(problems).toEqual([]);
    for (const reason of Object.values(SILENT_EVENTS)) expect(reason.length).toBeGreaterThan(10);
  });

  it.each(ABDECKUNG.map(([aktion, task, beispiel]) => [`${aktion} (${task})`, beispiel] as const))('Abdeckungsliste: %s hat Klang', (_label, beispiel) => {
    const ids = started(beispiel);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(IDS.has(id), id).toBe(true);
  });

  it.each(VORBEREITET.map(([aktion, task, id]) => [`${aktion} (${task})`, id] as const))('vorbereitet: %s → %s', (_label, id) => {
    expect(IDS.has(id)).toBe(true);
  });

  it('jede Id, die irgendein Ereignis erzeugen kann, existiert (alle Zweige der Tabelle)', () => {
    // Every branch above yields existing ids; this sweeps the enumerations once more for the state machine.
    for (const state of PLAYER_MOVE_STATES) {
      for (const id of started(ev('playerStateChanged', { entity: E, state, previous: 'idle' }))) expect(IDS.has(id), `${state}: ${id}`).toBe(true);
    }
  });

  it('Schritte: lauter beim Rennen, leiser beim Schleichen, positionslos beim Spieler', () => {
    const vol = (noise: number): number => (cues(ev('playerStep', { entity: E, terrain: 'gras', water: 'none', noise }))[0] as SfxCue).volume ?? 1;
    expect(vol(0.3)).toBeLessThan(vol(1));
    expect(vol(1.5)).toBeGreaterThan(vol(1));
    const step = cues(ev('playerStep', { entity: E, terrain: 'moorschlamm', water: 'none', noise: 1 }))[0] as SfxCue;
    expect(step.id).toBe('sfx_schritt_schlamm');
    expect(step.x).toBeUndefined();
    expect(cues(ev('playerStep', { entity: E, terrain: 'fels', water: 'none', noise: 1 }))).toEqual([]);
  });

  it('Welt-Klänge tragen ihre Position: Treffer, Baumsturz (Kachelmitte), Drops', () => {
    const hit = cues(ev('harvestHit', { layer: -1, tx: 3, ty: 4, x: 56, y: 72, target: 'fels', action: 'abbauen', material: 'stein', hits: 1, hitsNeeded: 3, tooHard: false }))[0] as SfxCue;
    expect(hit).toMatchObject({ id: 'sfx_sammeln_stein', x: 56, y: 72, layer: -1 });
    const crash = cues(ev('treeLanded', { layer: 0, tx: 3, ty: 4, object: 'baum_eiche', direction: 'links' }))[0] as SfxCue;
    expect(crash).toMatchObject({ id: 'sfx_baum_aufprall', x: 56, y: 72, layer: 0 });
  });

  it('Furcht: Flüstern ab „fluestern“, Herzschlag ab „bedrohlich“, beides endet in Ruhe', () => {
    const loops = (stage: (typeof FEAR_STAGES)[number]): Record<string, string | null> =>
      Object.fromEntries(
        cues(ev('fearStageChanged', { entity: E, stage, previous: 'ruhig', value: 0 }))
          .filter(isLoopCue)
          .map((c) => [c.loop, c.cue?.id ?? null]),
      );
    expect(loops('unruhig')).toEqual({ [LOOP_SLOTS.whispers]: null, [LOOP_SLOTS.heartbeat]: null });
    expect(loops('fluestern')).toEqual({ [LOOP_SLOTS.whispers]: 'sfx_furcht_fluestern', [LOOP_SLOTS.heartbeat]: null });
    expect(loops('bedrohlich')).toEqual({ [LOOP_SLOTS.whispers]: 'sfx_furcht_fluestern', [LOOP_SLOTS.heartbeat]: 'sfx_furcht_herzschlag' });
    for (const id of ['sfx_furcht_fluestern', 'sfx_furcht_herzschlag']) expect(SFX_PRESETS.find((p) => p.id === id)?.schleife).toBeDefined();
  });

  it('Schlaf: Atmen als Schleife, endet beim Aufwachen und beim Tod', () => {
    const start = cues(ev('sleepStarted', { entity: E, place: 'bett', x: 0, y: 0, layer: 0, nap: true }));
    expect(start).toContainEqual({ loop: LOOP_SLOTS.sleep, cue: { id: 'sfx_schlaf_atmen' } });
    expect(cues(ev('sleepEnded', { entity: E, reason: 'geweckt', rested: false }))).toContainEqual({ loop: LOOP_SLOTS.sleep, cue: null });
    expect(cues(ev('sleepEnded', { entity: E, reason: 'tod', rested: false }))).toEqual([{ loop: LOOP_SLOTS.sleep, cue: null }]);
    expect(cues(ev('playerDied', { entity: E, x: 0, y: 0, layer: 0, cause: 'x', grave: null, permadeath: false }))).toContainEqual({ loop: LOOP_SLOTS.sleep, cue: null });
  });

  it('abgelehnte Dauereingaben (Bewegen, Zielen, Sprint) bleiben still', () => {
    for (const type of ['player.move', 'player.aim', 'player.sprint', 'player.sneak', 'setTime'] as const) {
      expect(cues(ev('commandRejected', { type, reason: 'noPlayer' })), type).toEqual([]);
    }
    expect(cues(ev('commandRejected', { type: 'player.roll', reason: 'busy' }))).toEqual([]);
  });

  it('Aufheben klingt nach dem Material des Items; Hinzufügen ohne Doppel-Klang', () => {
    expect(started(ev('itemsAdded', { item: 'feuerstein', count: 3 }))).toEqual(['sfx_item_stein']);
    expect(started(ev('inventoryChanged', { change: 'add' }))).toEqual([]);
    expect(started(ev('dropPickedUp', { entity: E, item: 'holz', count: 1, x: 0, y: 0, magnet: false }))).toEqual([]);
  });
});
