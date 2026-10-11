/**
 * M7-77 Spielerclips `musizieren` und `angeln` im Spieler-Atlas (MASTERPROMPT §4.5 „Spieler … alle Aktionen“; docs/SPIEL.md §26
 * „Körperformen … neue M7-Clips wie `musizieren`, `angeln`“; src/render/game/playerFigure.ts):
 * - Clip im Atlas: der Grundkörper `spieler_basis` hat beide Aktionen in vier Richtungen (spielbar wie jede Figurenaktion),
 *   die Instrumente Flöte und Laute ihren Hand-Layer mit `musizieren_<richtung>` im Takt des Körpers (gleiche Bilder, gleiche
 *   Rate), die Noten (`spieler_noten`) zwei Clips;
 * - die Aktivität wählt die Aktion: Musizieren zeigt `musizieren` mit dem Instrument in der Hand (Nebenhand leer), Angeln
 *   `angeln` mit leerer Haupthand (die Rute zeichnet die Angel-Szene), beides auch beim Gehen;
 * - im Spiel: spielt der Spieler die Flöte, zeichnet die Figur die Musizierpose, die Flöte in der Hand und nach und nach
 *   steigende Noten über dem Kopf; hört er auf, nichts davon;
 * - beim Angeln trägt die Haupthand kein Item, meldet aber ihren Sockel als Handpunkt: dort beginnt die Rute der Angel-Szene
 *   (src/render/game/fishing.ts) – vor dem Bauch, auf der Seite der Schnur, nicht im Rumpf.
 */
import { describe, expect, it } from 'vitest';
import { AKTIONEN } from '../../../assets-src/sprites/figuren/_spieler_aktionen';
import { BALANCE } from '../../../src/content/balance';
import { itemLayerSpriteId } from '../../../src/content/items/index';
import { createCombatSample, type CombatSample } from '../../../src/game/combat/sample';
import { InstrumentsSystem } from '../../../src/game/instruments/system';
import { createPlayerSample, type PlayerSample } from '../../../src/game/session';
import type { AtlasData, AtlasManifest, AtlasSprite } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { slotBit } from '../../../src/render/anim/figure';
import { SpriteDesc, type SpriteFrameRef } from '../../../src/render/batch/spriteList';
import { ACTIVITY_ACTION, figureAction, figureActions, hiddenSlots, PLAYER_BODY_SPRITE, PLAYER_NOTES, PLAYER_NOTES_SPRITE, PlayerFigure } from '../../../src/render/game/playerFigure';
import type { RenderScene } from '../../../src/render/scene';
import { angelWelt } from '../game/angel-testwelt';
import { lifeWorld } from '../game/leben-testwelt';
import { meadow } from '../game/spieler-testwelt';

const MANIFEST: AtlasManifest = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
})();
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: new Uint8Array(4) }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
const DIRS = ['down', 'up', 'right', 'left'] as const;
const INSTRUMENTS = ['floete', 'laute'] as const;

function sprite(id: string): AtlasSprite {
  const s = MANIFEST.sprites[id];
  if (s === undefined) throw new Error(`Sprite ${id} fehlt im Atlas`);
  return s;
}

/** Atlas cell of a frame (socket items and the notes are drawn grounded: a frame of their own over the same cell). */
const cell = (f: SpriteFrameRef): string => `${f.x},${f.y},${f.w},${f.h}`;

/** The cells of clip `clip` of sprite `id` (every frame when `clip` is null). */
function cells(id: string, clip: string | null): Set<string> {
  const s = sprite(id);
  const frames = clip === null ? s.frames : (s.clips[clip]?.frames ?? []).map((i) => s.frames[i] as SpriteFrameRef);
  return new Set(frames.map(cell));
}

describe('M7-77: Clips im Atlas', () => {
  it('spieler_basis spielt musizieren und angeln in vier Richtungen; Flöte und Laute laufen im Takt des Körpers', () => {
    const body = sprite(PLAYER_BODY_SPRITE);
    const actions = figureActions(body, true);
    expect(actions).toContain('musizieren');
    expect(actions).toContain('angeln');
    expect(ACTIVITY_ACTION.music).toBe('musizieren');
    expect(ACTIVITY_ACTION.fish).toBe('angeln');
    for (const d of DIRS) {
      for (const a of ['musizieren', 'angeln']) expect(body.clips[`${a}_${d}`]?.frames.length ?? 0, `${a}_${d}`).toBeGreaterThan(1);
      const bodyClip = body.clips[`musizieren_${d}`];
      for (const i of INSTRUMENTS) {
        const layer = sprite(itemLayerSpriteId(i)).clips[`musizieren_${d}`];
        expect(layer?.frames.length, `${i} ${d}`).toBe(bodyClip?.frames.length);
        expect(layer?.fps, `${i} ${d}`).toBe(bodyClip?.fps);
        expect(layer?.loop, `${i} ${d}`).toBe(true);
      }
    }
    expect(Object.keys(sprite(PLAYER_NOTES_SPRITE).clips).sort()).toEqual(['achtel', 'doppel']);
    // The rig's source (assets-src) lists both among the player's actions, at the rate the atlas plays them.
    for (const a of ['musizieren', 'angeln']) {
      const def = AKTIONEN.find((x) => x.name === a);
      expect(def, a).toBeDefined();
      expect(body.clips[`${a}_down`]?.fps, a).toBe(def?.fps);
      expect(body.clips[`${a}_down`]?.frames.length, a).toBe(def?.folge.length);
    }
  });

  it('die Aktivität wählt die Aktion – auch im Gehen; Musik hält das Instrument, Angeln leert die Haupthand', () => {
    const body = sprite(PLAYER_BODY_SPRITE);
    const available = new Set(figureActions(body, true));
    const byState = { idle: 'idle', walk: 'walk', sprint: 'run', sneak: 'sneak', roll: 'roll', swim: 'swim', jump: 'jump', climb: 'climb' } as const;
    expect(figureAction('idle', 'music', false, false, byState, available)).toBe('musizieren');
    expect(figureAction('walk', 'music', false, false, byState, available)).toBe('musizieren');
    expect(figureAction('idle', 'fish', false, false, byState, available)).toBe('angeln');
    // Swimming owns the body.
    expect(figureAction('swim', 'fish', false, false, byState, available)).toBe('swim');
    // Making music: the main hand shows (the instrument), the off hand and its light do not.
    expect(hiddenSlots('idle', 'music') & slotBit('waffe')).toBe(0);
    expect(hiddenSlots('idle', 'music')).not.toBe(0);
    // Fishing: the main hand is empty (the rod is drawn to the float).
    expect(hiddenSlots('idle', 'fish') & slotBit('waffe')).not.toBe(0);
  });
});

describe('M7-77: Musizieren im Spiel', () => {
  it('Pose, Flöte in der Hand und steigende Noten über dem Kopf – nach dem Aufhören nichts davon', () => {
    const w = lifeWorld(meadow(24, 24));
    const instruments = w.sim.addSystem(new InstrumentsSystem({ player: w.player, inventory: w.inventory, collision: w.collision, night: () => w.env.night }));
    w.player.addMotionHold(instruments.holdsPlayer);
    w.spawn(10, 10);
    w.run(1, [{ type: 'inventory.give', item: 'floete', count: 1 }]);
    w.run(1, [{ type: 'inventory.move', from: { bereich: 'inventar', index: 0 }, to: { bereich: 'schnellleiste', index: 0 } }]);

    const body = cells(PLAYER_BODY_SPRITE, 'musizieren_down');
    const flute = cells(itemLayerSpriteId('floete'), null);
    const notes = cells(PLAYER_NOTES_SPRITE, null);
    const figure = new PlayerFigure();
    const session = {
      sim: w.sim,
      onEvent: () => () => undefined,
      samplePlayer(out: PlayerSample): boolean {
        Object.assign(out, createPlayerSample(), { x: 100, y: 200, facing: 'down', state: 'idle', health: 100, maxHealth: 100 });
        return true;
      },
      sampleCombat(out: CombatSample): boolean {
        Object.assign(out, createCombatSample());
        return true;
      },
    };
    const draw = (time: number): { body: number; flute: number; notes: { y: number; glow: number }[] } => {
      const seen = { body: 0, flute: 0, notes: [] as { y: number; glow: number }[] };
      const scene = {
        sprite: new SpriteDesc(),
        sprites: {
          push(d: SpriteDesc) {
            const f = cell(d.frame as SpriteFrameRef);
            if (body.has(f)) seen.body++;
            if (flute.has(f)) seen.flute++;
            if (notes.has(f)) seen.notes.push({ y: d.y, glow: d.emissiveBoost });
            return 0;
          },
        },
      } as unknown as RenderScene;
      expect(figure.place(scene, ATLAS, session, time, 100, 200)).toBe(true);
      return seen;
    };

    // Not playing: no pose, no flute (it sits in the hotbar, not in the hand), no notes.
    const before = draw(1);
    expect(before).toEqual({ body: 0, flute: 0, notes: [] });

    w.run(1, [{ type: 'instrument.play', from: { bereich: 'schnellleiste', index: 0 } }]);
    expect(instruments.isPlaying()).toBe(true);
    const first = draw(2);
    expect(first.body).toBe(1);
    expect(first.flute).toBe(1);
    // Notes rise one after another: a few periods later several are in the air, above the head (y < the feet at 200).
    const later = draw(2 + 3 * PLAYER_NOTES.periodSeconds);
    expect(later.body).toBe(1);
    expect(later.notes.length).toBeGreaterThanOrEqual(2);
    expect(later.notes.length).toBeLessThanOrEqual(Math.ceil(PLAYER_NOTES.lifeSeconds / PLAYER_NOTES.periodSeconds));
    for (const n of later.notes) {
      expect(n.y).toBeLessThan(200 - 16);
      expect(n.glow).toBeGreaterThan(0);
    }

    w.run(1, [{ type: 'instrument.stop' }]);
    expect(instruments.isPlaying()).toBe(false);
    w.run(BALANCE.time.tickHz);
    const after = draw(2 + 3 * PLAYER_NOTES.periodSeconds + 1);
    expect(after).toEqual({ body: 0, flute: 0, notes: [] });
  });
});

describe('M7-77: Angeln im Spiel', () => {
  it('die Rute beginnt in der Hand: der Handpunkt ist der Hand-Sockel des gezeichneten Bilds, vor dem Bauch', () => {
    const w = angelWelt();
    w.spawn(6, 5);
    w.hold('angel_holz');
    const p = w.px(10, 5);
    const refused = w.run(1, [{ type: 'fishing.cast', x: p.x, y: p.y }]).get('commandRejected');
    expect(refused).toBeUndefined();
    w.run(BALANCE.time.tickHz);
    expect(w.line().phase).toBe('warten');
    const figure = new PlayerFigure();
    const scene = { sprite: new SpriteDesc(), sprites: { push: () => 0 } } as unknown as RenderScene;
    const session = {
      sim: w.sim,
      onEvent: () => () => undefined,
      samplePlayer(out: PlayerSample): boolean {
        Object.assign(out, createPlayerSample(), { x: 100, y: 200, facing: 'right', state: 'idle', health: 100, maxHealth: 100 });
        return true;
      },
      sampleCombat(out: CombatSample): boolean {
        Object.assign(out, createCombatSample());
        return true;
      },
    };
    const body = sprite(PLAYER_BODY_SPRITE);
    const hand = body.sockets['hand'];
    for (const time of [1, 1.25, 1.5]) {
      expect(figure.place(scene, ATLAS, session, time, 100, 200)).toBe(true);
      const head = figure.lastCombat.weaponHead;
      expect(head?.drawn, `t=${time}`).toBe(true);
      expect(head?.item).toBe(false);
      // In front of the belly on the line's side, below the chest – where the angeln frames hold the rod's butt.
      expect(head?.x ?? 0).toBeGreaterThan(100 + 1);
      expect(200 - (head?.y ?? 0)).toBeGreaterThan(3);
      expect(200 - (head?.y ?? 0)).toBeLessThan(13);
    }
    // Every angeln frame has its hand socket (the rig drew them).
    for (const d of DIRS) for (const i of body.clips[`angeln_${d}`]?.frames ?? []) expect(hand?.[i], `angeln_${d} ${i}`).toBeTruthy();
  });
});
