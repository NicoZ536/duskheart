/**
 * Betäubung an der Spielfigur sichtbar (M7-69; MASTERPROMPT §11.3 „Jeder Zustand: … sichtbare Wirkung“, §4.6 Lesbarkeit;
 * ADR-0173 für Kreaturen): ein Zustand mit dem Bildhaken `sterne` (Betäubt) lässt über dem Kopf der Spielfigur die drei
 * Sterne der Kreaturen kreisen (`statusMarks.ts`, `HeadStars`) – auf der Bahn der Kreaturen (vorn die großen, hinten die
 * matten), leuchtend, über dem höchsten Pixel jeder Frisur und Kopfbedeckung in jeder Körperform; ohne den Zustand keine.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONDITIONS } from '../../../src/content/conditions';
import { HAIRSTYLES, BODY_SHAPES } from '../../../src/content/appearance/index';
import { createCombatSample, type CombatSample } from '../../../src/game/combat/sample';
import { equipmentRef } from '../../../src/game/items/slots';
import { APPEARANCE_SYSTEM_ID } from '../../../src/game/appearance/state';
import type { AppearanceSystem } from '../../../src/game/appearance/system';
import { createPlayerSample, GameSession, type PlayerSample } from '../../../src/game/session';
import type { AtlasData, AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { SpriteDesc, type SpriteFrameRef } from '../../../src/render/batch/spriteList';
import { createConditionLook, LOOK_HOOKS, sampleConditionLook } from '../../../src/render/game/conditionLook';
import { PlayerFigure } from '../../../src/render/game/playerFigure';
import { hairHeadroom, orbitHeight, orbitRadius, PLAYER_STARS_SPRITE, PLAYER_STUN, STATUS_CLIPS, STATUS_SPRITE, STUN } from '../../../src/render/game/statusMarks';
import type { RenderScene } from '../../../src/render/scene';
import { decodePng } from '../../../tools/lib/png';

const MOD = (() => {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return mod;
})();
const MANIFEST: AtlasManifest = manifestFromGenerated(MOD);
const ALBEDO = decodePng(readFileSync(join(process.cwd(), 'public', MOD.ATLAS.albedoUrl)));
const ATLAS: AtlasData = { manifest: MANIFEST, albedo: { kind: 'pixels', pixels: ALBEDO.rgba }, normal: { kind: 'pixels', pixels: new Uint8Array(4) } };
/** The player's stars: the creatures' with a dark rim (the creatures' 5 × 5 stars faded on sand). */
const STATUS = MANIFEST.sprites[PLAYER_STARS_SPRITE];
/** The creatures' stars (they must not be drawn over the player while the rimmed ones exist). */
const CREATURE_FRAMES = new Set<SpriteFrameRef>(MANIFEST.sprites[STATUS_SPRITE]?.frames ?? []);
const FRONT = new Set<SpriteFrameRef>((STATUS?.clips[STATUS_CLIPS.star]?.frames ?? []).map((i) => STATUS?.frames[i] as SpriteFrameRef));
const BACK = new Set<SpriteFrameRef>((STATUS?.clips[STATUS_CLIPS.farStar]?.frames ?? []).map((i) => STATUS?.frames[i] as SpriteFrameRef));
const STATUS_FRAMES = new Set<SpriteFrameRef>(STATUS?.frames ?? []);
/** The sprite of every atlas rectangle (the hair and headgear drawn are checked by their sprite; a layer may draw a copy of its frame record). */
const OWNER = (() => {
  const owner = new Map<string, string>();
  for (const sp of Object.values(MANIFEST.sprites)) for (const f of sp.frames) owner.set(`${f.x},${f.y},${f.w},${f.h}`, sp.id);
  return owner;
})();
/** A generated small world: more than the default limit on a loaded machine. */
const TIMEOUT_MS = 120_000;
const X = 100;
const Y = 200;
/** A star (7 × 7 with its rim, anchor in its middle) reaches this far below its anchor [px]. */
const STAR_BELOW = (() => {
  const f = STATUS?.frames[0];
  if (f === undefined) throw new Error(`${PLAYER_STARS_SPRITE} fehlt – npm run assets`);
  return f.h - 1 - f.ay;
})();

interface Gezeichnet {
  readonly stars: { x: number; y: number; depth: number; height: number; glow: number; front: boolean }[];
  /** The highest opaque pixel of everything else the figure drew [screen y]. */
  readonly top: number;
  /** The sprites the figure drew. */
  readonly sprites: Set<string>;
}

/** The highest opaque row of a frame [px from its top], −1 none. */
function topRow(f: SpriteFrameRef): number {
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if ((ALBEDO.rgba[((f.y + y) * ALBEDO.width + f.x + x) * 4 + 3] as number) !== 0) return y;
  return -1;
}

/** What `figure` draws for `session`'s player standing at (X, Y) facing `facing`. */
function zeichne(figure: PlayerFigure, session: GameSession, time: number, facing: PlayerSample['facing'] = 'down'): Gezeichnet {
  const s = {
    sim: session.sim,
    onEvent: () => () => undefined,
    samplePlayer(out: PlayerSample): boolean {
      Object.assign(out, createPlayerSample(), { x: X, y: Y, facing, state: 'idle', health: 100, maxHealth: 100 });
      return true;
    },
    sampleCombat(out: CombatSample): boolean {
      Object.assign(out, createCombatSample());
      return true;
    },
  };
  const stars: Gezeichnet['stars'] = [];
  let top = Number.POSITIVE_INFINITY;
  const sprites = new Set<string>();
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        const f = d.frame as SpriteFrameRef;
        sprites.add(OWNER.get(`${f.x},${f.y},${f.w},${f.h}`) ?? '?');
        expect(CREATURE_FRAMES.has(f), 'die Sterne ohne Rand der Kreaturen').toBe(false);
        if (STATUS_FRAMES.has(f)) {
          // Only the stars' clips: a big one in front, a small one behind – no dazzle spark.
          expect(FRONT.has(f) || BACK.has(f)).toBe(true);
          stars.push({ x: d.x, y: d.y, depth: d.depth, height: d.heightBase, glow: d.emissiveBoost, front: FRONT.has(f) });
        }
        else {
          const t = topRow(f);
          if (t >= 0) top = Math.min(top, d.y - f.ay + t);
        }
        return 0;
      },
    },
  } as unknown as RenderScene;
  expect(figure.place(scene, ATLAS, s, time, X, Y)).toBe(true);
  return { stars, top, sprites };
}

function newSession(): GameSession {
  const session = new GameSession({ config: { seed: 3, worldSize: 'small', dayLengthMinutes: 24 } });
  session.command({ type: 'player.spawn' });
  session.step();
  return session;
}

describe('Betäubt: Sterne über dem Kopf der Spielfigur (M7-69)', () => {
  it('der Bildhaken `sterne` schaltet die Sterne der Figur; andere Haken nicht', () => {
    const stun = CONDITIONS.find((c) => c.sichtbar === 'sterne');
    expect(stun?.id).toBe('betaeubt');
    expect('effect' in LOOK_HOOKS.sterne).toBe(true);
    expect(sampleConditionLook([{ id: 'betaeubt' }], 1, createConditionLook()).stars).toBe(true);
    expect(sampleConditionLook([{ id: 'geblendet' }, { id: 'brennen' }], 2, createConditionLook()).stars).toBe(false);
    expect(createConditionLook().stars).toBe(false);
  });

  it('die Kopffreiheit je Frisur aus ihrer Vorschau: Irokese 4 px, Dutt und Stacheln 3, Locken und Wuschel 2, glattes Haar 0', () => {
    const body = MANIFEST.sprites['spieler_basis'];
    if (body === undefined) throw new Error('spieler_basis fehlt');
    const soll: Record<string, number> = { irokese: 4, dutt: 3, stacheln: 3, locken: 2, wuschel: 2, scheitel: 0, pony: 0, lang: 0, zopf: 0, pferdeschwanz: 0, zoepfe: 0, straehne: 0 };
    expect(Object.keys(soll).sort()).toEqual(HAIRSTYLES.map((h) => h.id).sort());
    for (const h of HAIRSTYLES) expect(hairHeadroom(MANIFEST, body, `frisur_${h.id}`), h.id).toBe(soll[h.id]);
    // The body's own hair and the hair under a helmet rise nowhere.
    expect(hairHeadroom(MANIFEST, body, null)).toBe(0);
    expect(hairHeadroom(MANIFEST, body, 'frisur_scheitel_helm')).toBe(0);
  });

  it(
    'drei Sterne auf der Bahn der Kreaturen über dem Scheitel, vorn die großen, hinten die matten, leuchtend – nur solange die Betäubung wirkt',
    () => {
      const session = newSession();
      const figure = new PlayerFigure();
      expect(zeichne(figure, session, 1).stars).toEqual([]);
      session.command({ type: 'conditions.apply', id: 'betaeubt', seconds: 30 });
      session.step();
      const rx = orbitRadius(PLAYER_STUN.cellPx);
      const ry = orbitHeight(rx);
      const xs = new Set<number>();
      for (let k = 0; k < 60; k++) {
        const time = 1 + k / 60;
        const g = zeichne(figure, session, time);
        expect(g.stars, `t ${time}`).toHaveLength(STUN.stars);
        const front = g.stars.filter((s) => s.front).length;
        expect(front, `t ${time}`).toBeGreaterThanOrEqual(1);
        expect(front, `t ${time}`).toBeLessThanOrEqual(2);
        for (const s of g.stars) {
          xs.add(s.x);
          // Around the head's centre within the orbit, the lowest pixel above everything the figure drew.
          expect(Math.abs(s.x - X), `t ${time}`).toBeLessThanOrEqual(rx);
          expect(s.y + STAR_BELOW, `t ${time}`).toBeLessThan(g.top - PLAYER_STUN.clearPx + 1);
          expect(Number.isInteger(s.x) && Number.isInteger(s.y), `t ${time}`).toBe(true);
          expect(s.glow).toBe(STUN.glow);
          // In front of the figure the big stars, behind it the small ones.
          expect(Math.sign(s.depth - Y), `t ${time}`).toBe(s.front ? 1 : -1);
          expect(Math.abs(s.depth - Y)).toBeLessThan(0.1);
          // Its height over the ground (the light and the shadow passes read it) is above the figure's.
          expect(s.height, `t ${time}`).toBeGreaterThan(Y - g.top);
        }
        // The orbit's height: the stars' rows stay within its two half heights.
        const rows = g.stars.map((s) => s.y);
        expect(Math.max(...rows) - Math.min(...rows)).toBeLessThanOrEqual(2 * ry);
      }
      // They circle: over a second they stand on more than a handful of columns.
      expect(xs.size).toBeGreaterThan(6);
      session.command({ type: 'conditions.cure', id: 'betaeubt' });
      session.step();
      expect(zeichne(figure, session, 3).stars).toEqual([]);
      figure.dispose();
    },
    TIMEOUT_MS,
  );

  it(
    'über jeder Frisur in jeder Körperform und über jeder Kopfbedeckung, in allen vier Richtungen',
    () => {
      const session = newSession();
      session.command({ type: 'conditions.apply', id: 'betaeubt', seconds: 600 });
      session.step();
      const appearance = session.sim.systems.find((s) => s.id === APPEARANCE_SYSTEM_ID) as AppearanceSystem | undefined;
      if (appearance === undefined) throw new Error('kein Aussehen');
      const figure = new PlayerFigure();
      const facings = ['down', 'up', 'left', 'right'] as const;
      let checked = 0;
      const body = MANIFEST.sprites['spieler_basis'];
      if (body === undefined) throw new Error('spieler_basis fehlt');
      const check = (what: string, sprite: string, hairSprite: string): void => {
        const room = hairHeadroom(MANIFEST, body, hairSprite);
        for (const facing of facings) {
          // Over a whole turn of the orbit the lowest star reaches its lowest point once: `clearPx` above the top of the hair
          // or headgear seen from the front (the view the headroom is read from), never into it from any side, and from the
          // other sides never higher than the hairstyle's headroom above that (a bun seen from behind sits lower).
          let lowest = Number.NEGATIVE_INFINITY;
          let top = Number.NaN;
          for (let k = 0; k < 40; k++) {
            const g = zeichne(figure, session, 1 + k / 30, facing);
            expect([...g.sprites].some((id) => id.startsWith(sprite)), `${what} ${facing}: ${[...g.sprites].join(', ')}`).toBe(true);
            expect(g.stars, `${what} ${facing}`).toHaveLength(STUN.stars);
            top = g.top;
            for (const s of g.stars) lowest = Math.max(lowest, s.y + STAR_BELOW);
          }
          if (facing === 'down') expect(lowest, `${what} ${facing}`).toBe(top - PLAYER_STUN.clearPx);
          expect(lowest, `${what} ${facing}`).toBeLessThanOrEqual(top - PLAYER_STUN.clearPx);
          expect(lowest, `${what} ${facing}`).toBeGreaterThanOrEqual(top - PLAYER_STUN.clearPx - room);
          checked++;
        }
      };
      for (const form of BODY_SHAPES) {
        for (const hair of HAIRSTYLES) {
          appearance.save.deserialize({ ...appearance.appearance, form: form.id, frisur: hair.id, gewaehlt: true });
          // The side parting is the body's own hair (ADR-0268); every other style is its layer.
          check(`${form.id}/${hair.id}`, hair.id === 'scheitel' ? 'spieler_' : `frisur_${hair.id}`, `frisur_${hair.id}`);
        }
      }
      // The headgear (it hides the hair: `frisur_<id>_helm`), the tallest hairstyle under it, every shape.
      for (const helm of ['faserkappe', 'lederkappe', 'bronzehelm']) {
        session.command({ type: 'inventory.give', item: helm, count: 1 });
        session.command({ type: 'inventory.move', from: { bereich: 'inventar', index: 0 }, to: equipmentRef('kopf') });
        session.step();
        for (const form of BODY_SHAPES) {
          appearance.save.deserialize({ ...appearance.appearance, form: form.id, frisur: 'irokese', gewaehlt: true });
          // Under headgear the hair is the parting's helmet mask (`frisur_scheitel_helm`, ADR-0268): no headroom.
          check(`${form.id}/${helm}`, `ausruestung_${helm}`, 'frisur_scheitel_helm');
        }
        session.command({ type: 'inventory.move', from: equipmentRef('kopf'), to: { bereich: 'inventar', index: 10 } });
        session.step();
      }
      expect(checked).toBe(BODY_SHAPES.length * (HAIRSTYLES.length + 3) * facings.length);
      figure.dispose();
    },
    TIMEOUT_MS,
  );
});
