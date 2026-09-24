/**
 * M3-20 visible condition effects at the player (MASTERPROMPT §11.3 "sichtbare Wirkung", §11.1 "Müde …
 * Lidschlag-Effekt", §11.2 "Frierend … Zittern", "Unterkühlt … Frostrand"): every visual hook of the
 * condition content has an effect or names what carries it; the conditions switch the right effects on;
 * shivering, limping, blinking and the complexion are pure functions of presentation time (a frozen frame
 * shows the same picture); the particles (flames, drops, breath, shiver marks) come from the atlas and do
 * not depend on anything but time; the post pass's eyelids and frost rim follow their formulas.
 */
import { describe, expect, it } from 'vitest';
import { CONDITIONS, CONDITION_VISUALS } from '../../../src/content/conditions';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import type { AtlasManifest } from '../../../src/render/assets/atlas';
import { SpriteDesc } from '../../../src/render/batch/spriteList';
import {
  BLINK,
  COLD_TINT,
  COMPLEXION,
  LIMP,
  LOOK_HOOKS,
  createConditionLook,
  figureTint,
  lidClosure,
  limpDip,
  limpTime,
  sampleConditionLook,
  shiverOffset,
  swayOffset,
  type ConditionLook,
} from '../../../src/render/game/conditionLook';
import { createFigureFxFrame, FigureFx, FX_SPRITES, SHIVER_MARKS } from '../../../src/render/game/figureFx';
import { FROST_REACH_PX, frostShare, LID_SOFT_PX, lidCovers } from '../../../src/render/passes/postPass';
import type { RenderScene } from '../../../src/render/scene';

function loadManifest(): AtlasManifest {
  const mod = generatedAtlasModule();
  if (mod === null) throw new Error('Spielatlas fehlt – npm run assets');
  return manifestFromGenerated(mod);
}
/** The game atlas (one instance: frames are told apart by identity). */
const MANIFEST = loadManifest();
const manifest = (): AtlasManifest => MANIFEST;

function look(...ids: string[]): ConditionLook {
  return sampleConditionLook(
    ids.map((id) => ({ id })),
    ids.length,
    createConditionLook(),
  );
}

/** A scene that records the sprites pushed into it. */
function recordingScene(): { scene: RenderScene; pushed: { sprite: string; x: number; y: number; heightBase: number; fade: number }[] } {
  const pushed: { sprite: string; x: number; y: number; heightBase: number; fade: number }[] = [];
  const m = manifest();
  const owner = new Map<unknown, string>();
  for (const s of Object.values(m.sprites)) for (const f of s.frames) owner.set(f, s.id);
  const scene = {
    sprite: new SpriteDesc(),
    sprites: {
      push(d: SpriteDesc) {
        pushed.push({ sprite: owner.get(d.frame) ?? '?', x: d.x, y: d.y, heightBase: d.heightBase, fade: d.fade });
        return pushed.length - 1;
      },
    },
  } as unknown as RenderScene;
  return { scene, pushed };
}

describe('M3-20: Zustände → sichtbare Wirkung', () => {
  it('jeder Bild-Haken des Zustands-Contents hat eine Wirkung oder nennt, was ihn trägt', () => {
    for (const hook of CONDITION_VISUALS) {
      const entry = LOOK_HOOKS[hook];
      expect(entry, hook).toBeDefined();
      const text = 'effect' in entry ? entry.effect : entry.carriedBy;
      expect(text.length, hook).toBeGreaterThan(8);
    }
    for (const c of CONDITIONS) expect(LOOK_HOOKS[c.sichtbar], c.id).toBeDefined();
    // The five of M3-20 have a picture of their own.
    for (const hook of ['zittern', 'hinken', 'flammen', 'tropfen', 'lidschlag'] as const) expect('effect' in LOOK_HOOKS[hook], hook).toBe(true);
  });

  it('die Zustände schalten ihre Wirkungen: Frierend zittert und haucht, Unterkühlt/Erfrierend mit Frostrand, Knochenbruch hinkt, Brennen flammt, Durchnässt tropft, Müde/Erschöpft blinzeln', () => {
    expect(look()).toEqual(createConditionLook());
    expect(look('frierend')).toMatchObject({ shiver: 1, breath: true, frost: 0 });
    expect(look('unterkuehlt')).toMatchObject({ shiver: 2, breath: true });
    expect(look('unterkuehlt').frost).toBeGreaterThan(0);
    expect(look('erfrierend').frost).toBe(1);
    expect(look('unterkuehlt').frost).toBeLessThan(look('erfrierend').frost);
    expect(look('knochenbruch')).toMatchObject({ limp: true, shiver: 0 });
    expect(look('brennen')).toMatchObject({ flames: true });
    expect(look('durchnaesst')).toMatchObject({ drips: true });
    expect(look('blutung')).toMatchObject({ blood: true });
    expect(look('erhitzt')).toMatchObject({ sweat: true });
    expect(look('muede').lid).toBe(1);
    expect(look('erschoepft').lid).toBe(2);
    expect(look('beschwipst').sway).toBe(true);
    expect(look('vergiftung').complexion).toBe('giftschimmer');
    expect(look('erschuettert', 'vergiftung').complexion).toBe('giftschimmer');
    expect(look('erschuettert').complexion).toBe('blaesse');
    // Several at once add up; only the first `count` entries count.
    const both = look('brennen', 'durchnaesst', 'knochenbruch');
    expect(both).toMatchObject({ flames: true, drips: true, limp: true });
    const partial = sampleConditionLook([{ id: 'brennen' }, { id: 'durchnaesst' }], 1, createConditionLook());
    expect(partial).toMatchObject({ flames: true, drips: false });
  });

  it('Zittern: ganze Pixel, höchstens 1 px, schneller bei Unterkühlung, im Standbild fest', () => {
    const at = (level: number): number[] => Array.from({ length: 60 }, (_, i) => shiverOffset(level, i / 60));
    expect(at(0).every((v) => v === 0)).toBe(true);
    for (const level of [1, 2]) {
      const v = at(level);
      expect(v.every((x) => Number.isInteger(x) && Math.abs(x) <= 1)).toBe(true);
      expect(new Set(v).size).toBe(3);
    }
    const changes = (v: number[]): number => v.filter((x, i) => i > 0 && x !== v[i - 1]).length;
    expect(changes(at(2))).toBeGreaterThan(changes(at(1)));
    expect(shiverOffset(1, 1.234)).toBe(shiverOffset(1, 1.234));
    expect(Number.isInteger(swayOffset(0.7))).toBe(true);
  });

  it('Hinken: das kranke Bein trägt länger (langsamer Schritt) und sinkt 1 px ein; die Clipzeit läuft nie rückwärts', () => {
    const cycle = 0.6;
    let prev = -1;
    for (let i = 0; i <= 240; i++) {
      const t = i / 120;
      const warped = limpTime(t, cycle);
      expect(warped).toBeGreaterThanOrEqual(prev);
      prev = warped;
    }
    // After LIMP.badLegShare of the cycle's time only half of the clip has played (the bad leg's step).
    expect(limpTime(cycle * LIMP.badLegShare, cycle)).toBeCloseTo(cycle / 2, 9);
    expect(limpTime(cycle, cycle)).toBeCloseTo(cycle, 9);
    expect(limpDip(cycle * 0.1, cycle)).toBe(LIMP.dipPx);
    expect(limpDip(cycle * 0.9, cycle)).toBe(0);
    expect(limpTime(1.3, 0)).toBe(1.3);
  });

  it('Lidschlag: müde blinzelt ab und zu ganz zu, erschöpft öfter und mit hängenden Lidern; sonst offen', () => {
    const samples = (level: number): number[] => Array.from({ length: 1200 }, (_, i) => lidClosure(level, i / 60));
    expect(samples(0).every((v) => v === 0)).toBe(true);
    const tired = samples(1);
    expect(Math.max(...tired)).toBe(1);
    expect(tired.filter((v) => v === 0).length / tired.length).toBeGreaterThan(0.9);
    const exhausted = samples(2);
    expect(Math.min(...exhausted)).toBeCloseTo(BLINK.droop[2], 9);
    const shut = (v: number[]): number => v.filter((x) => x === 1).length;
    expect(shut(exhausted)).toBeGreaterThan(shut(tired));
    for (const v of [...tired, ...exhausted]) expect(v >= 0 && v <= 1).toBe(true);
  });

  it('Teint: Kältebleiche vor allem anderen, Gift und Fieber pulsieren zwischen Untergrenze und voller Stärke', () => {
    const out = { color: 0, strength: 0 };
    expect(figureTint(createConditionLook(), 1, out)).toEqual({ color: 0, strength: 0 });
    expect(figureTint(look('frierend', 'vergiftung'), 1, out)).toEqual({ color: COLD_TINT.color, strength: COLD_TINT.strength[1] });
    expect(figureTint(look('erfrierend'), 1, out).strength).toBe(COLD_TINT.strength[2]);
    const poison = Array.from({ length: 120 }, (_, i) => figureTint(look('vergiftung'), i / 60, out).strength);
    expect(Math.max(...poison)).toBeCloseTo(COMPLEXION.giftschimmer.strength, 3);
    expect(Math.min(...poison)).toBeGreaterThan(0.3 * COMPLEXION.giftschimmer.strength);
    expect(figureTint(look('erschuettert'), 5, out)).toEqual({ color: COMPLEXION.blaesse.color, strength: COMPLEXION.blaesse.strength });
  });
});

describe('M3-20: Partikel an der Figur', () => {
  const frame = (time: number) => Object.assign(createFigureFxFrame(), { x: 400, y: 300, time, facing: 'down' as const });

  it('jedes Partikel-Sprite liegt im Spielatlas', () => {
    const m = manifest();
    for (const id of Object.values(FX_SPRITES)) expect(m.sprites[id], id).toBeDefined();
    expect(m.sprites[FX_SPRITES.flamme]?.emissive).toBe(true);
  });

  it('Brennen: emissive Flammenzungen am Körper, im Standbild immer dieselben', () => {
    const fx = new FigureFx();
    const a = recordingScene();
    fx.drawFigure(a.scene, manifest(), look('brennen'), frame(1.3));
    const flames = a.pushed.filter((p) => p.sprite === FX_SPRITES.flamme);
    expect(flames.length).toBeGreaterThanOrEqual(4);
    for (const p of flames) {
      expect(Math.abs(p.x - 400)).toBeLessThanOrEqual(6);
      expect(p.y).toBeLessThanOrEqual(300);
    }
    const b = recordingScene();
    new FigureFx().drawFigure(b.scene, manifest(), look('brennen'), frame(1.3));
    expect(b.pushed).toEqual(a.pushed);
  });

  it('Durchnässt: Tropfen fallen vom Körper und spritzen an den Füßen; ohne Zustand keine Partikel', () => {
    const fx = new FigureFx();
    const seen = new Set<number>();
    let drops = 0;
    for (let i = 0; i < 60; i++) {
      const r = recordingScene();
      fx.drawFigure(r.scene, manifest(), look('durchnaesst'), frame(i / 30));
      for (const p of r.pushed) {
        expect(p.sprite).toBe(FX_SPRITES.tropfen);
        seen.add(300 - p.y);
        drops++;
      }
    }
    expect(drops).toBeGreaterThan(30);
    // Falling (above the feet) and splashing (at the feet).
    expect(seen.has(0)).toBe(true);
    expect([...seen].some((h) => h > 4)).toBe(true);
    const none = recordingScene();
    fx.drawFigure(none.scene, manifest(), createConditionLook(), frame(1));
    expect(none.pushed).toEqual([]);
  });

  it('Frierend: Atemwölkchen in Blickrichtung und Zitterstriche beiderseits des Körpers in Schüben', () => {
    const fx = new FigureFx();
    const period = SHIVER_MARKS.period[1];
    const during = recordingScene();
    fx.drawFigure(during.scene, manifest(), look('frierend'), frame(period * 0.2));
    const marks = during.pushed.filter((p) => p.sprite === FX_SPRITES.zittern);
    expect(marks.map((p) => p.x - 400).sort((x, y) => x - y)).toEqual([-SHIVER_MARKS.sidePx, SHIVER_MARKS.sidePx]);
    const pause = recordingScene();
    fx.drawFigure(pause.scene, manifest(), look('frierend'), frame(period * 0.9));
    expect(pause.pushed.filter((p) => p.sprite === FX_SPRITES.zittern)).toEqual([]);
    let breaths = 0;
    for (let i = 0; i < 40; i++) {
      const r = recordingScene();
      fx.drawFigure(r.scene, manifest(), look('frierend'), Object.assign(frame(i / 20), { facing: 'right' as const }));
      for (const p of r.pushed.filter((q) => q.sprite === FX_SPRITES.atem)) {
        breaths++;
        expect(p.x).toBeGreaterThan(400);
      }
    }
    expect(breaths).toBeGreaterThan(0);
  });
});

describe('M3-20: Lider und Frostrand im Post-Pass', () => {
  it('Lider decken bei Schluss 0 nichts, bei 1 das ganze Bild; der Rand ist über LID_SOFT_PX Zeilen gedithert', () => {
    const h = 270;
    for (let d = 0; d < h / 2; d++) expect(lidCovers(d, h, 0, 0.01)).toBe(false);
    // Shut means shut: even the dithered edge has passed the middle of the picture.
    for (let d = 0; d < h / 2; d++) expect(lidCovers(d, h, 1, 0.99)).toBe(true);
    const lidPx = 0.3 * (h * 0.5 + LID_SOFT_PX);
    expect(lidCovers(lidPx - LID_SOFT_PX - 1, h, 0.3, 0.99)).toBe(true);
    expect(lidCovers(lidPx + 1, h, 0.3, 0.01)).toBe(false);
    expect(lidCovers(lidPx - 1, h, 0.3, 0.2)).toBe(true);
    expect(lidCovers(lidPx - 1, h, 0.3, 0.5)).toBe(false);
  });

  it('Frost kriecht mit der Stärke vom Rand herein, am Rand am dichtesten', () => {
    expect(frostShare(0, 0)).toBe(0);
    expect(frostShare(0, 1)).toBe(1);
    expect(frostShare(FROST_REACH_PX, 1)).toBe(0);
    expect(frostShare(10, 1)).toBeGreaterThan(frostShare(20, 1));
    expect(frostShare(10, 1)).toBeGreaterThan(frostShare(10, 0.5));
    expect(frostShare(FROST_REACH_PX * 0.6, 0.5)).toBe(0);
  });
});
