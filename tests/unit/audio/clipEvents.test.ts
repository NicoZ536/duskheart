/**
 * M3-06/M3-33: the frame events of the player's body clips (`schritt`, `abrollen`, `zug`, `absprung`,
 * `landung`, `treffer`, `getroffen`, `aufprall`, `biss`, `schluck`) each have a decision about their
 * sound – voiced by the clip (`CLIP_EVENT_SFX`) or by the simulation's event (`CLIP_EVENTS_VOICED_BY_SIM`),
 * never both, never neither – and a clip sound waits for the loop the action's start does not voice.
 */
import { describe, expect, it } from 'vitest';
import { CLIP_EVENT_SFX, CLIP_EVENTS_VOICED_BY_SIM, clipEventCue } from '../../../src/audio/clipEvents';
import { SFX_PRESETS } from '../../../src/content/sfx/index';
import { ACTION_SFX } from '../../../src/game/actions/events';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { PLAYER_BODY_SPRITE } from '../../../src/render/game/playerFigure';

const IDS = new Set(SFX_PRESETS.map((p) => p.id));

/** Every frame event name of the player's body clips in the game atlas. */
function bodyClipEvents(): Set<string> {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  const body = manifestFromGenerated(mod).sprites[PLAYER_BODY_SPRITE];
  if (body === undefined) throw new Error(`${PLAYER_BODY_SPRITE} fehlt im Spielatlas`);
  const names = new Set<string>();
  for (const clip of Object.values(body.clips)) for (const e of clip.events ?? []) names.add(e.name);
  return names;
}

describe('Clip-Ereignisse der Spielerfigur → Klang', () => {
  it('jedes Ereignis der Körper-Clips ist entweder vom Clip oder von der Simulation vertont – nie beides, nie keins, keins erfunden', () => {
    const events = bodyClipEvents();
    expect([...events].sort()).toEqual(['abrollen', 'absprung', 'aufprall', 'biss', 'getroffen', 'landung', 'schluck', 'schritt', 'treffer', 'zug']);
    for (const name of events) {
      const byClip = name in CLIP_EVENT_SFX;
      const bySim = name in CLIP_EVENTS_VOICED_BY_SIM;
      expect(byClip !== bySim, `${name}: genau eine Entscheidung`).toBe(true);
    }
    for (const name of [...Object.keys(CLIP_EVENT_SFX), ...Object.keys(CLIP_EVENTS_VOICED_BY_SIM)]) expect(events.has(name), `${name} kommt in keinem Clip vor`).toBe(true);
    for (const reason of Object.values(CLIP_EVENTS_VOICED_BY_SIM)) expect(reason.length).toBeGreaterThan(10);
  });

  it('jeder Clip-Klang ist ein vorhandenes Preset', () => {
    for (const [name, sound] of Object.entries(CLIP_EVENT_SFX)) expect(IDS.has(sound.id), `${name} → ${sound.id}`).toBe(true);
  });

  it('Bisse und Schlucke klingen erst ab der zweiten Schleife (die erste vertont der Beginn des Essens/Trinkens), der Aufprall sofort', () => {
    expect(clipEventCue('biss', 0)).toBeNull();
    expect(clipEventCue('biss', 1)).toEqual({ id: ACTION_SFX.eat });
    expect(clipEventCue('biss', 4)).toEqual({ id: ACTION_SFX.eat });
    expect(clipEventCue('schluck', 0)).toBeNull();
    expect(clipEventCue('schluck', 2)).toEqual({ id: ACTION_SFX.swallow });
    expect(clipEventCue('aufprall', 0)).toEqual({ id: 'sfx_spieler_aufprall' });
    for (const name of Object.keys(CLIP_EVENTS_VOICED_BY_SIM)) for (const cycle of [0, 1, 5]) expect(clipEventCue(name, cycle)).toBeNull();
    expect(clipEventCue('unbekannt', 3)).toBeNull();
  });
});
