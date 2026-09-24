/**
 * M1-30: Stufen-Äxte klar unterscheidbar. Die Steinaxt ist aus geschlagenem Stein (eigene Form mit
 * Schnurbindung, kein Metallkopf), Eisen und Stahl, Bronze und Sonnenstahl sind getrennt. Gemessen
 * wird der Farbabstand in OKLab über die Kopfpixel (die `stein`-Pixel der jeweiligen Form):
 * - mittlere Kopffarbe: je Paar aller acht Stufen,
 * - pixelweise über den gemeinsamen Metallkopf: je Paar der sieben Stufen mit derselben Form,
 * - die im Backlog genannten Paare mit einer höheren Schwelle.
 */
import { describe, expect, it } from 'vitest';
import axtStufen, { axtForm, axtGeschlagen } from '../../../assets-src/sprites/werkzeug/axt';
import { oklabDistance, paletteOklab, type Oklab } from '../../../assets-src/lib/color';
import { materialStufen } from '../../../assets-src/lib/recolor';
import { MATERIAL_BITS, TRANSPARENT, sprite, type Sprite } from '../../../assets-src/lib/sprite';
import { findRamp, paletteRef, rampStart } from '../../../assets-src/palette';
import { MATERIAL_SOURCE_RAMP, MATERIAL_TIERS } from '../../../assets-src/paletteRows';

/** Mindestabstand der mittleren Kopffarben je Paar (OKLab; ≈ 0,02 ist gerade sichtbar). */
const MIN_MEAN_DISTANCE = 0.05;
/** Mindestabstand pixelweise über den Kopf je Paar derselben Form. */
const MIN_PIXEL_DISTANCE = 0.07;
/** Mindestabstand der mittleren Kopffarben für die Paare, die M1-30 nennt. */
const MIN_NAMED_DISTANCE = 0.12;
const NAMED_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['stein', 'eisen'],
  ['eisen', 'stahl'],
  ['bronze', 'sonnenstahl'],
];
/** Höchstens so viel des Metallkopfs (Jaccard der Kopfmasken) darf die Steinform überdecken. */
const MAX_HEAD_OVERLAP = 0.6;

const LAB = paletteOklab();
const SOURCE_START = rampStart(MATERIAL_SOURCE_RAMP);
const SOURCE_LEN = findRamp(MATERIAL_SOURCE_RAMP)?.colors.length ?? 0;

function isSource(v: number): boolean {
  return v >= SOURCE_START && v < SOURCE_START + SOURCE_LEN;
}

/** Pixelpositionen des Kopfes einer Form (ihre `stein`-Pixel, die die Stufen umfärben). */
function headOf(form: Sprite): number[] {
  const out: number[] = [];
  form.frames[0]?.index.forEach((v, p) => {
    if (isSource(v)) out.push(p);
  });
  return out;
}

function tier(id: string): Sprite {
  const s = axtStufen.find((x) => x.id === `axt_${id}`);
  if (s === undefined) throw new Error(`axt_${id} fehlt`);
  return s;
}

function formOf(id: string): Sprite {
  return id === 'stein' ? axtGeschlagen : axtForm;
}

function colorAt(s: Sprite, p: number): Oklab {
  const v = s.frames[0]?.index[p] ?? TRANSPARENT;
  const c = LAB[v - 1];
  if (c === undefined) throw new Error(`${s.id}: Pixel ${p} ist leer`);
  return c;
}

function meanHead(id: string): Oklab {
  const s = tier(id);
  const head = headOf(formOf(id));
  let L = 0;
  let a = 0;
  let b = 0;
  for (const p of head) {
    const c = colorAt(s, p);
    L += c.L;
    a += c.a;
    b += c.b;
  }
  return { L: L / head.length, a: a / head.length, b: b / head.length };
}

const IDS = MATERIAL_TIERS.map((t) => t.id);
const PAIRS = IDS.flatMap((a, i) => IDS.slice(i + 1).map((b) => [a, b] as const));

describe('M1-30 Stufen-Äxte: Farbabstand', () => {
  it.each(PAIRS)('%s / %s: mittlere Kopffarben liegen weit genug auseinander', (a, b) => {
    expect(oklabDistance(meanHead(a), meanHead(b))).toBeGreaterThanOrEqual(MIN_MEAN_DISTANCE);
  });

  it('pixelweise über den gemeinsamen Metallkopf: jedes Paar derselben Form ist verschieden genug', () => {
    const head = headOf(axtForm);
    const metal = IDS.filter((id) => formOf(id) === axtForm);
    expect(metal).toHaveLength(IDS.length - 1);
    for (const [i, a] of metal.entries()) {
      for (const b of metal.slice(i + 1)) {
        const sum = head.reduce((acc, p) => acc + oklabDistance(colorAt(tier(a), p), colorAt(tier(b), p)), 0);
        expect(sum / head.length, `${a}/${b}`).toBeGreaterThanOrEqual(MIN_PIXEL_DISTANCE);
      }
    }
  });

  it.each(NAMED_PAIRS)('%s / %s (in M1-30 genannt) sind deutlich getrennt', (a, b) => {
    expect(oklabDistance(meanHead(a), meanHead(b))).toBeGreaterThanOrEqual(MIN_NAMED_DISTANCE);
  });

  it('Eisen ist dunkler als Stahl, Bronze dunkler und röter als Sonnenstahl', () => {
    expect(meanHead('eisen').L).toBeLessThan(meanHead('stahl').L);
    const bronze = meanHead('bronze');
    const sonne = meanHead('sonnenstahl');
    expect(bronze.L).toBeLessThan(sonne.L);
    // OKLab: a > 0 ist Richtung Rot, b > 0 Richtung Gelb – Bronze liegt näher am Rot als Sonnenstahl.
    expect(Math.atan2(bronze.b, bronze.a)).toBeLessThan(Math.atan2(sonne.b, sonne.a));
  });
});

describe('M1-30 Steinaxt aus geschlagenem Stein', () => {
  it('hat eine eigene Kopfform, teilt aber Zellgröße, Anker und Griff-Sockel mit der Metallform', () => {
    const stone = tier('stein');
    expect([stone.w, stone.h, ...stone.anchor]).toEqual([axtForm.w, axtForm.h, ...axtForm.anchor]);
    expect(stone.sockets).toEqual(axtForm.sockets);
    const metal = new Set(headOf(axtForm));
    const knapped = headOf(axtGeschlagen);
    const both = knapped.filter((p) => metal.has(p)).length;
    expect(both / (metal.size + knapped.length - both)).toBeLessThanOrEqual(MAX_HEAD_OVERLAP);
    expect(Array.from(stone.frames[0]?.index ?? [])).toEqual(Array.from(axtGeschlagen.frames[0]?.index ?? []));
  });

  it('ist mit Schnur (sand) an den Stiel gebunden, ohne Metallglanz', () => {
    const f = tier('stein').frames[0];
    const rope = Array.from(f?.index ?? []).filter((v) => v !== TRANSPARENT && paletteRef(v).startsWith('sand.'));
    expect(rope.length).toBeGreaterThanOrEqual(axtForm.w);
    expect(f?.material.some((m) => (m & MATERIAL_BITS.metall) !== 0)).toBe(false);
    // Alle anderen Stufen bleiben Metall bzw. Kristall.
    for (const id of IDS.filter((x) => x !== 'stein')) expect(tier(id).frames[0]?.material.some((m) => m !== 0), id).toBe(true);
  });

  it('materialStufen lehnt eigene Formen ab, die Größe, Anker oder Sockel nicht teilen, oder unbekannte Stufen', () => {
    const klein = sprite({ id: 'axt_klein', size: [2, 1], anchor: [1, 1], hoehe: 'block', legende: { k: 'nacht.1' }, frames: ['kk'] });
    expect(() => materialStufen(axtForm, undefined, { stein: klein })).toThrow(/Größe, Anker oder Sockeln/);
    expect(() => materialStufen(axtForm, undefined, { holz: axtGeschlagen })).toThrow(/unbekannte Stufe holz/);
  });
});
