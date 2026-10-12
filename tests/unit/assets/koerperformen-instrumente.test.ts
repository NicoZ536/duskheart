/**
 * M7-113 Instrumente je Körperform (Kontaktbogen `koerperform-<form>.png`): beim Musizieren liegt das Instrument zwischen den
 * Händen des Körpers – in `schmal` stehen die Hände je 1 px enger, in `kraeftig` weiter. Die Flöte der Form `mittel` ragte am
 * schmalen Körper über die untere Hand hinaus und endete am kräftigen vor ihr; jede Form hat deshalb ihre Instrumente
 * (`ausruestung_floete_<form>`, `ausruestung_laute_<form>`), und der Renderer nimmt sie für die gewählte Form.
 * - Am Hand-Sockel jedes Musizier-Bilds der Form gesetzt, endet die Flöte der Form zwei Pixel hinter der Nebenhand (wie in
 *   `mittel`); die Laute beginnt ihren Hals über der Haupthand, ihr Korpus sitzt an der Nebenhand.
 * - `buildPlayerFigure` zeichnet in `schmal` und `kraeftig` die Flöte der Form, in `mittel` die bis M7-77.
 */
import { describe, expect, it } from 'vitest';
import { TRANSPARENT, type Sprite } from '../../../assets-src/lib/sprite';
import { spielerBilderFuer } from '../../../assets-src/sprites/figuren/_spieler_bilder';
import { KOERPERFORMEN } from '../../../assets-src/sprites/figuren/_spieler_formen';
import instrumente from '../../../assets-src/sprites/figuren/instrumente';
import type { AtlasManifest } from '../../../src/render/assets/atlas';
import { generatedAtlasModule, manifestFromGenerated } from '../../../src/render/assets/generated';
import { buildPlayerFigure, DRAWN_LOOK, formLayerSpriteId, START_CLOTHING } from '../../../src/render/game/playerFigure';

const RICHTUNGEN_MIT_INSTRUMENT = ['down', 'right', 'left'] as const;

function instrument(id: string, form: string): Sprite {
  const s = instrumente.find((i) => i.id === formLayerSpriteId(id, form as never));
  if (s === undefined) throw new Error(`${id} in ${form} fehlt`);
  return s;
}

/** Ob das Instrument, mit dem Anker auf `hand` gesetzt, das Körperpixel (x, y) deckt. */
function deckt(s: Sprite, frame: number, hand: readonly [number, number], x: number, y: number): boolean {
  const ix = x - hand[0] + s.anchor[0];
  const iy = y - hand[1] + s.anchor[1];
  if (ix < 0 || iy < 0 || ix >= s.w || iy >= s.h) return false;
  return (s.frames[frame]?.index[iy * s.w + ix] ?? TRANSPARENT) !== TRANSPARENT;
}

describe('M7-113 Instrumente je Körperform', () => {
  for (const form of KOERPERFORMEN) {
    it(`${form}: die Flöte endet zwei Pixel hinter der Nebenhand, die Laute liegt zwischen den Händen`, () => {
      const { bilder, clips } = spielerBilderFuer({ form });
      const floete = instrument('ausruestung_floete', form);
      const laute = instrument('ausruestung_laute', form);
      let geprueft = 0;
      for (const r of RICHTUNGEN_MIT_INSTRUMENT) {
        const clip = clips[`musizieren_${r}`];
        if (clip === undefined) throw new Error(`musizieren_${r} fehlt`);
        clip.frames.forEach((f, pos) => {
          const hand = bilder[f]?.sockel.hand;
          const neben = bilder[f]?.sockel.nebenhand;
          if (hand === undefined || neben === undefined) throw new Error(`Frame ${f} ohne Hände`);
          const sx = Math.sign(neben[0] - hand[0]);
          const sy = Math.sign(neben[1] - hand[1]);
          const ff = floete.clips[`musizieren_${r}`]?.frames[pos] ?? -1;
          const lf = laute.clips[`musizieren_${r}`]?.frames[pos] ?? -1;
          expect(deckt(floete, ff, hand, neben[0] + 2 * sx, neben[1] + 2 * sy), `${form} ${r}[${pos}]: Flötenende`).toBe(true);
          expect(deckt(floete, ff, hand, neben[0] + 3 * sx, neben[1] + 3 * sy), `${form} ${r}[${pos}]: nicht weiter`).toBe(false);
          expect(deckt(laute, lf, hand, hand[0], hand[1] - 1), `${form} ${r}[${pos}]: Lautenhals`).toBe(true);
          expect(deckt(laute, lf, hand, neben[0], neben[1] + 1), `${form} ${r}[${pos}]: Korpus an der Nebenhand`).toBe(true);
          geprueft++;
        });
      }
      expect(geprueft).toBeGreaterThanOrEqual(12);
    });
  }

  it('der Renderer nimmt das Instrument der gewählten Form (mittel: das gezeichnete)', () => {
    const mod = generatedAtlasModule();
    if (mod === null) throw new Error('Kein erzeugter Atlas – erst `npm run assets`');
    const m: AtlasManifest = manifestFromGenerated(mod);
    for (const form of KOERPERFORMEN) {
      const rig = buildPlayerFigure(m, START_CLOTHING, { hand: 'ausruestung_floete' }, { ...DRAWN_LOOK, form });
      expect(rig?.held, form).toEqual([formLayerSpriteId('ausruestung_floete', form)]);
    }
  });
});
