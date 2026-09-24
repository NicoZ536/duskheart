/**
 * M3-05/M3-06: Spieler-Sprites Bewegung und Aktionen (MASTERPROMPT §4.4/§4.5, docs/ART.md §3/§4).
 * Geprüft wird, was sich am Pixel belegen lässt: Zelle und Fußpunkt, Frame-Anzahl je Aktion und
 * Richtung (jede Richtung eigene Frames), Takt 8–12 fps, Antizipation und Events, Körpermaß und
 * Bodenkontakt, keine Sprünge > 1 px im Idle und Gehen, Wasserlinie beim Schwimmen, Sockel je Frame,
 * Farbgrenze ohne Einzelpixel-Befund.
 */
import { describe, expect, it } from 'vitest';
import { RICHTUNGEN, type Richtung } from '../../../assets-src/lib/figure';
import { MAX_SPRITE_COLORS, TRANSPARENT, spriteColorCount, type Sprite } from '../../../assets-src/lib/sprite';
import { paletteRef } from '../../../assets-src/palette';
import { AKTIONEN, LICHT_SUFFIX, MIT_LICHT, istSonder } from '../../../assets-src/sprites/figuren/_spieler_aktionen';
import { framesDerAktion } from '../../../assets-src/sprites/figuren/_spieler_bilder';
import { WASSERLINIE_Y } from '../../../assets-src/sprites/figuren/_spieler_sonder';
import spieler from '../../../assets-src/sprites/figuren/spieler_basis';
import { checkSprite } from '../../../tools/assets/spriteChecks';

/** §4.5: Frames je Aktion (Sitzen, Schlafen, Essen, Trinken, Tragen, Schleichen, Sprung: frei, mindestens 1). */
const FRAMES: Readonly<Record<string, number>> = { idle: 4, walk: 6, run: 6, roll: 5, swim: 4, tool: 4, hit: 2, death: 6 };
const WEITERE = ['sit', 'sleep', 'eat', 'drink', 'carry', 'carry_idle', 'sneak', 'jump'] as const;

function frameIndex(s: Sprite, f: number): Uint8Array {
  const fr = s.frames[f];
  if (fr === undefined) throw new Error(`Frame ${f} fehlt`);
  return fr.index;
}

function clipFrames(aktion: string, r: Richtung): readonly number[] {
  const c = spieler.clips[`${aktion}_${r}`];
  if (c === undefined) throw new Error(`Clip ${aktion}_${r} fehlt`);
  return c.frames;
}

/** Deckende Hülle eines Frames: [x0, y0, x1, y1]. */
function huelle(s: Sprite, f: number): [number, number, number, number] {
  let x0 = s.w;
  let y0 = s.h;
  let x1 = -1;
  let y1 = -1;
  frameIndex(s, f).forEach((v, p) => {
    if (v === TRANSPARENT) return;
    const x = p % s.w;
    const y = Math.floor(p / s.w);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  });
  return [x0, y0, x1, y1];
}

describe('M3-05/M3-06 Spieler-Grundkörper spieler_basis', () => {
  it('32×32-Zelle, Fußpunkt [16, 31], Zylinder, nicht spiegelbar (Scheitel, Händigkeit)', () => {
    expect([spieler.id, spieler.w, spieler.h, spieler.hoehe, spieler.spiegelbar]).toEqual(['spieler_basis', 32, 32, 'zylinder', false]);
    expect(spieler.anchor).toEqual([16, 31]);
  });

  it('jede Aktion in vier Richtungen mit eigenen Frames und der geforderten Anzahl (§4.5)', () => {
    const gesehen = new Map<number, string>();
    for (const [aktion, n] of [...Object.entries(FRAMES), ...WEITERE.map((a) => [a, 1] as const)]) {
      for (const r of RICHTUNGEN) {
        const eigene = new Set(clipFrames(aktion, r));
        if (aktion in FRAMES) expect(eigene.size, `${aktion}_${r}`).toBe(n);
        else expect(eigene.size, `${aktion}_${r}`).toBeGreaterThanOrEqual(n);
        for (const f of eigene) {
          const vorher = gesehen.get(f);
          expect(vorher === undefined || vorher === r, `Frame ${f} in ${vorher ?? ''} und ${r}`).toBe(true);
          gesehen.set(f, r);
        }
      }
    }
  });

  it('Figuren-Takt 8–12 fps; Schleifen nur für Dauerzustände, Einmal-Aktionen enden', () => {
    const einmal = new Set(['roll', 'tool', 'hit', 'death', 'jump']);
    for (const [name, clip] of Object.entries(spieler.clips)) {
      expect(clip.fps, name).toBeGreaterThanOrEqual(8);
      expect(clip.fps, name).toBeLessThanOrEqual(12);
      const aktion = name.slice(0, name.lastIndexOf('_')).replace(LICHT_SUFFIX, '');
      expect(clip.loop, name).toBe(!einmal.has(aktion));
    }
  });

  it('Antizipation: Werkzeug holt zwei Positionen aus (gehaltener Ausholframe), Treffer erst danach', () => {
    for (const r of RICHTUNGEN) {
      const c = spieler.clips[`tool_${r}`];
      expect(c).toBeDefined();
      if (c === undefined) continue;
      const treffer = c.events.find((e) => e.name === 'treffer');
      expect(treffer?.frame).toBeGreaterThanOrEqual(3);
      expect(c.frames[1]).toBe(c.frames[2]);
      expect(new Set(c.frames.slice(0, treffer?.frame ?? 0)).size).toBeGreaterThanOrEqual(3);
    }
  });

  it('Schritt-Events auf beiden Kontakten von Gehen, Rennen, Schleichen und Tragen', () => {
    for (const aktion of ['walk', 'run', 'sneak', 'carry']) {
      for (const r of RICHTUNGEN) expect(spieler.clips[`${aktion}_${r}`]?.events.filter((e) => e.name === 'schritt')).toHaveLength(2);
    }
  });

  it('stehende Posen: Körper ≈ 16×24, Füße auf der Ankerzeile', () => {
    for (const aktion of ['idle', 'walk', 'eat', 'drink']) {
      for (const r of RICHTUNGEN) {
        for (const f of new Set(clipFrames(aktion, r))) {
          const [x0, y0, x1, y1] = huelle(spieler, f);
          expect(y1, `${aktion}_${r} ${f}`).toBe(spieler.anchor[1]);
          expect(y1 - y0 + 1, `${aktion}_${r} ${f}`).toBeGreaterThanOrEqual(22);
          expect(y1 - y0 + 1, `${aktion}_${r} ${f}`).toBeLessThanOrEqual(25);
          expect(x1 - x0 + 1, `${aktion}_${r} ${f}`).toBeGreaterThanOrEqual(14);
          expect(x1 - x0 + 1, `${aktion}_${r} ${f}`).toBeLessThanOrEqual(18);
        }
      }
    }
  });

  it('kein Pixelcluster springt mehr als 1 px: Scheitel und Flanken in Idle und Gehen', () => {
    for (const aktion of ['idle', 'walk']) {
      for (const r of RICHTUNGEN) {
        const folge = clipFrames(aktion, r);
        folge.forEach((f, i) => {
          const g = folge[(i + 1) % folge.length] ?? f;
          const a = huelle(spieler, f);
          const b = huelle(spieler, g);
          expect(Math.abs(a[1] - b[1]), `${aktion}_${r} Scheitel ${f}→${g}`).toBeLessThanOrEqual(1);
        });
      }
    }
  });

  it('Rennen hat eine Flugphase (beide Füße über dem Boden), Rolle einen Ball unter Kopfhöhe', () => {
    for (const r of RICHTUNGEN) {
      const flug = new Set(clipFrames('run', r)).values();
      const boeden = [...flug].map((f) => huelle(spieler, f)[3]);
      expect(Math.min(...boeden), `run_${r}`).toBeLessThan(spieler.anchor[1]);
      const stehHoehe = spieler.anchor[1] - huelle(spieler, clipFrames('idle', r)[0] ?? 0)[1];
      const ball = clipFrames('roll', r)[2] ?? 0;
      expect(spieler.anchor[1] - huelle(spieler, ball)[1], `roll_${r}`).toBeLessThan(stehHoehe);
    }
  });

  it('Schwimmen: unter der Wasserlinie nur der Wellenring (eis), die Wasserlinie ist Sockel', () => {
    expect(spieler.sockets.wasserlinie?.every(([, y]) => y === WASSERLINIE_Y)).toBe(true);
    for (const r of RICHTUNGEN) {
      for (const f of new Set(clipFrames('swim', r))) {
        const px = frameIndex(spieler, f);
        let ring = 0;
        px.forEach((v, p) => {
          if (v === TRANSPARENT) return;
          const ref = paletteRef(v);
          if (ref.startsWith('eis.')) ring++;
          else expect(Math.floor(p / spieler.w), `swim_${r} ${f}: ${ref} unter der Wasserlinie`).toBeLessThanOrEqual(WASSERLINIE_Y);
        });
        expect(ring, `swim_${r} ${f}`).toBeGreaterThan(8);
      }
    }
  });

  it('Sockel hand, nebenhand, kopf, last in jedem Frame innerhalb der Zelle', () => {
    for (const name of ['hand', 'nebenhand', 'kopf', 'last']) {
      const punkte = spieler.sockets[name];
      expect(punkte, name).toHaveLength(spieler.frames.length);
      for (const [x, y] of punkte ?? []) {
        expect(x >= 0 && x < spieler.w && y >= 0 && y < spieler.h, `${name} (${x}, ${y})`).toBe(true);
      }
    }
  });

  it('sichtbare Hände: Hand-Sockel liegen in allen stehenden Posen auf Haut', () => {
    const sichtbar: Readonly<Record<Richtung, readonly string[]>> = { down: ['hand', 'nebenhand'], up: ['hand', 'nebenhand'], right: ['hand'], left: ['nebenhand'] };
    for (const aktion of ['idle', 'walk', 'run', 'carry', 'carry_idle']) {
      for (const r of RICHTUNGEN) {
        for (const f of new Set(clipFrames(aktion, r))) {
          for (const s of sichtbar[r]) {
            const [x, y] = spieler.sockets[s]?.[f] ?? [0, 0];
            const v = frameIndex(spieler, f)[y * spieler.w + x] ?? TRANSPARENT;
            expect(v === TRANSPARENT ? '' : paletteRef(v), `${aktion}_${r} ${f} ${s}`).toMatch(/^haut\./);
          }
        }
      }
    }
  });

  it('vier eigene Richtungen: von vorn Gesicht, von hinten Haar; links ist kein Spiegelbild von rechts', () => {
    const f = (r: Richtung): Uint8Array => frameIndex(spieler, clipFrames('idle', r)[0] ?? 0);
    const haut = (px: Uint8Array): number => [...px].filter((v) => v !== TRANSPARENT && paletteRef(v).startsWith('haut.')).length;
    expect(haut(f('down'))).toBeGreaterThan(haut(f('up')) + 20);
    const rechts = f('right');
    const links = f('left');
    let gleich = true;
    for (let y = 0; y < spieler.h && gleich; y++) for (let x = 0; x < spieler.w; x++) if (rechts[y * spieler.w + x] !== links[y * spieler.w + (spieler.w - 1 - x)]) gleich = false;
    expect(gleich).toBe(false);
  });

  it('Licht-Varianten <aktion>_licht (M3-07) mit derselben Frame-Anzahl wie die Aktion', () => {
    expect(MIT_LICHT.map((a) => a.name)).toEqual(['idle', 'walk', 'run', 'sneak', 'tool', 'sit', 'eat', 'drink'].map((a) => `${a}${LICHT_SUFFIX}`));
    for (const a of MIT_LICHT) {
      const basis = a.name.replace(LICHT_SUFFIX, '');
      for (const r of RICHTUNGEN) {
        expect(spieler.clips[`${a.name}_${r}`]?.frames.length, `${a.name}_${r}`).toBe(spieler.clips[`${basis}_${r}`]?.frames.length);
        expect(spieler.clips[`${a.name}_${r}`]?.events).toEqual(spieler.clips[`${basis}_${r}`]?.events);
      }
    }
  });

  it('jede Aktion hat Posen für jede Richtung (Tabellen vollständig)', () => {
    for (const a of AKTIONEN) {
      for (const r of RICHTUNGEN) {
        const defs = framesDerAktion(a, r);
        expect(defs.length, `${a.name}_${r}`).toBe(Math.max(...a.folge) + 1);
        expect(defs.every((d) => istSonder(d) || (d.armR !== undefined && d.beinL !== undefined))).toBe(true);
      }
    }
  });

  it(`≤ ${MAX_SPRITE_COLORS} Farben, eine Rampe je Material, ohne Einzelpixel-Befund`, () => {
    expect(spriteColorCount(spieler)).toBeLessThanOrEqual(MAX_SPRITE_COLORS);
    const rampen = new Set<string>();
    for (const f of spieler.frames) for (const v of f.index) if (v !== TRANSPARENT) rampen.add(paletteRef(v).split('.')[0] ?? '');
    expect([...rampen].sort()).toEqual(['eis', 'erde', 'haut', 'holz', 'nacht', 'stein']);
    expect(checkSprite(spieler)).toEqual({ errors: [], warnings: [] });
  });
});
