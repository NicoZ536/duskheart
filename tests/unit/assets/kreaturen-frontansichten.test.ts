/**
 * M6-Gate, Kreatur-Kunst (Abnahmebilder kreaturen-gruenhain, -lauer, -kueste, wasser-ufer, kampf-nacht; MASTERPROMPT §4.5
 * „klare Silhouetten“, §4.6 Lesbarkeit, docs/ART.md §15): die Frontansichten, die bei 1× nicht als ihr Tier lasen, und das
 * Speier-Geschoss sind nachgebessert – hier festgeschrieben, jeweils an dem Merkmal, das vorher fehlte:
 * - Reh von vorn und hinten kein Pfahl: Läufe gespreizt, die Lauscher als V mit heller Muschel (vorher Ziegenkopf).
 * - Hase von vorn lange Löffel mit Spalt, helle Brust statt Umrissloch zwischen den Pfoten (vorher Katze/Kauz); von hinten
 *   dieselben Löffel statt runder Bärenohren.
 * - Möwe von vorn Kopf schmaler als die Schultern, von hinten grauer Mantel und schwarze Handschwingen (vorher Gespenst).
 * - Keiler von vorn die helle Rüsselscheibe mit dunklen Nüstern (vorher Käfer).
 * - Dornling gesträubt: einzelne Dornen mit roten Spitzen, kein verschmolzener Block.
 * - Geschoss `spucken`: Kern, Hülle, Glutrand und ein abreißender Tropfen, alles selbstleuchtend (übersteht Nacht und Drehung).
 */
import { describe, expect, it } from 'vitest';
import { KREATUREN_M6 } from '../../../assets-src/sprites/kreaturen/_katalog';
import geschossSpucken from '../../../assets-src/sprites/kreaturen/geschoss_spucken';
import { TRANSPARENT, type Sprite } from '../../../assets-src/lib/sprite';
import { paletteIndex } from '../../../assets-src/palette';

const KONTUR = paletteIndex('nacht.1');

function kreatur(id: string): { sprite: Sprite; clips: (typeof KREATUREN_M6)[number]['ergebnis']['clips'] } {
  const k = KREATUREN_M6.find((x) => x.id === id);
  if (k === undefined) throw new Error(id);
  return { sprite: k.ergebnis.sprite, clips: k.ergebnis.clips };
}

/** Eindeutige Frames eines Clips. */
function frames(s: Sprite, clip: string): number[] {
  const c = s.clips[clip];
  if (c === undefined) throw new Error(`${s.id}: ${clip} fehlt`);
  return [...new Set(c.frames)];
}

function pixel(s: Sprite, f: number): Uint8Array {
  const fr = s.frames[f];
  if (fr === undefined) throw new Error(`${s.id}: Frame ${f} fehlt`);
  return fr.index;
}

/** Begrenzung der deckenden Pixel. */
function rahmen(s: Sprite, f: number): { x0: number; x1: number; y0: number; y1: number } {
  const px = pixel(s, f);
  let x0 = s.w;
  let x1 = -1;
  let y0 = s.h;
  let y1 = -1;
  px.forEach((v, p) => {
    if (v === TRANSPARENT) return;
    const x = p % s.w;
    const y = Math.floor(p / s.w);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  });
  return { x0, x1, y0, y1 };
}

/** Deckende Läufe einer Zeile: [von, bis] je zusammenhängender Strecke. */
function laeufe(s: Sprite, f: number, y: number): [number, number][] {
  const px = pixel(s, f);
  const out: [number, number][] = [];
  for (let x = 0; x < s.w; x++) {
    if (px[y * s.w + x] === TRANSPARENT) continue;
    const letzter = out[out.length - 1];
    if (letzter !== undefined && letzter[1] === x - 1) letzter[1] = x;
    else out.push([x, x]);
  }
  return out;
}

/** Breite einer Zeile (äußerste deckende Pixel). */
function zeilenBreite(s: Sprite, f: number, y: number): number {
  const l = laeufe(s, f, y);
  const a = l[0];
  const b = l[l.length - 1];
  return a === undefined || b === undefined ? 0 : b[1] - a[0] + 1;
}

/** Größte Lücke zwischen den Läufen der untersten drei Zeilen (die Beine). */
function fussLuecke(s: Sprite, f: number): number {
  const { y1 } = rahmen(s, f);
  let luecke = 0;
  for (let y = y1; y > y1 - 3; y--) {
    const l = laeufe(s, f, y);
    for (let i = 1; i < l.length; i++) luecke = Math.max(luecke, (l[i]?.[0] ?? 0) - (l[i - 1]?.[1] ?? 0) - 1);
  }
  return luecke;
}

/** Pixel der genannten Farben, getrennt nach linker und rechter Bildhälfte (Zellmitte). */
function zaehle(s: Sprite, f: number, farben: readonly string[], zeilen?: (y: number) => boolean): { links: number; rechts: number } {
  const idx = new Set(farben.map(paletteIndex));
  let links = 0;
  let rechts = 0;
  pixel(s, f).forEach((v, p) => {
    if (!idx.has(v)) return;
    const y = Math.floor(p / s.w);
    if (zeilen !== undefined && !zeilen(y)) return;
    if (p % s.w < s.w / 2) links++;
    else rechts++;
  });
  return { links, rechts };
}

/** Zusammenhängende Flächen (4er- oder 8er-Nachbarschaft) der Pixel, die `drin` erfüllen; liefert ihre Größen. */
function flaechen(w: number, h: number, drin: (i: number) => boolean, acht = false): number[] {
  const gesehen = new Uint8Array(w * h);
  const groessen: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (gesehen[start] === 1 || !drin(start)) continue;
    const stapel = [start];
    gesehen[start] = 1;
    let n = 0;
    while (stapel.length > 0) {
      const i = stapel.pop() ?? 0;
      n++;
      const x = i % w;
      const y = Math.floor(i / w);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || (!acht && dx !== 0 && dy !== 0)) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (gesehen[j] === 1 || !drin(j)) continue;
          gesehen[j] = 1;
          stapel.push(j);
        }
    }
    groessen.push(n);
  }
  return groessen;
}

describe('M6-Gate Kreatur-Kunst: Frontansichten und Speier-Geschoss', () => {
  it('Reh von vorn und hinten kein Pfahl: Läufe gespreizt, Lauscher als V mit heller Muschel', () => {
    const { sprite: s } = kreatur('reh');
    for (const r of ['down', 'up'] as const) {
      // Before the gate the front and back legs stood 2 px apart (outline between them, a 8 × 22 px pillar).
      for (const f of frames(s, `idle_${r}`)) expect(fussLuecke(s, f), `idle_${r} Frame ${f} Läufe`).toBeGreaterThanOrEqual(5);
    }
    for (const f of frames(s, 'idle_down')) {
      const { y0 } = rahmen(s, f);
      // The ears stand apart as a V: the top three rows are two separate runs (before: antlers and ears one dark block).
      for (let y = y0; y < y0 + 3; y++) expect(laeufe(s, f, y).length, `idle_down Frame ${f} Zeile ${y}`).toBe(2);
      // Light inner ear on both sides (`sand.3`, only seen from the front).
      const muschel = zaehle(s, f, ['sand.3'], (y) => y < y0 + 5);
      expect(Math.min(muschel.links, muschel.rechts), `idle_down Frame ${f} Muschel`).toBeGreaterThanOrEqual(2);
    }
  });

  it('Hase von vorn: lange Löffel mit Spalt und rosa Muschel, helle Brust statt Umrissloch zwischen den Pfoten; von hinten dieselben Löffel', () => {
    const { sprite: s } = kreatur('hase');
    for (const f of frames(s, 'idle_down')) {
      const { y0, y1 } = rahmen(s, f);
      // At least two rows of ears side by side with a gap (before: one row, the ears a horizontal wedge pair).
      let spalt = 0;
      for (let y = y0; y <= y1; y++) if (laeufe(s, f, y).length === 2 && y < y0 + 4) spalt++;
      expect(spalt, `idle_down Frame ${f} Ohrenspalt`).toBeGreaterThanOrEqual(2);
      const innen = zaehle(s, f, ['haut.3'], (y) => y < y0 + 5);
      expect(Math.min(innen.links, innen.rechts), `idle_down Frame ${f} Muschel`).toBeGreaterThanOrEqual(1);
      // The light chest fills the lower body between the forelegs (before: a 2 × 3 px outline block there).
      const mitte = (y0 + y1) / 2;
      const brust = zaehle(s, f, ['sand.3', 'sand.4'], (y) => y > mitte);
      expect(brust.links + brust.rechts, `idle_down Frame ${f} Brust`).toBeGreaterThanOrEqual(3);
      let dunkleZeilen = 0;
      for (let y = Math.ceil(mitte); y <= y1; y++) {
        const px = pixel(s, f);
        const l = laeufe(s, f, y);
        const a = l[0]?.[0] ?? 0;
        const b = l[l.length - 1]?.[1] ?? -1;
        let lauf = 0;
        let max = 0;
        for (let x = a + 1; x < b; x++) {
          lauf = px[y * s.w + x] === KONTUR ? lauf + 1 : 0;
          max = Math.max(max, lauf);
        }
        if (max >= 2) dunkleZeilen++;
      }
      expect(dunkleZeilen, `idle_down Frame ${f} Umrissloch`).toBeLessThanOrEqual(1);
    }
    for (const f of frames(s, 'idle_up')) {
      const { y0 } = rahmen(s, f);
      // From behind the same long ears with a gap (before: two round bumps touching each other, a teddy bear).
      let spalt = 0;
      for (let y = y0; y < y0 + 4; y++) if (laeufe(s, f, y).length === 2) spalt++;
      expect(spalt, `idle_up Frame ${f} Ohrenspalt`).toBeGreaterThanOrEqual(2);
    }
  });

  it('Möwe: von vorn Kopf schmaler als die Schultern, von hinten grauer Mantel mit schwarzen Handschwingen', () => {
    const { sprite: s } = kreatur('moewe');
    for (const clip of ['idle_down', 'gehen_down']) {
      for (const f of frames(s, clip)) {
        const { y0, y1 } = rahmen(s, f);
        let breiteste = 0;
        for (let y = y0; y <= y1; y++) breiteste = Math.max(breiteste, zeilenBreite(s, f, y));
        const kopf = (zeilenBreite(s, f, y0) + zeilenBreite(s, f, y0 + 1) + zeilenBreite(s, f, y0 + 2)) / 3;
        // Before: the head as wide as the body (a rounded block, 2.7 px narrower on average).
        expect(breiteste - kopf, `${clip} Frame ${f} Kopf/Schultern`).toBeGreaterThanOrEqual(4);
        const grau = zaehle(s, f, ['stein.2', 'stein.3', 'stein.4']);
        expect(Math.min(grau.links, grau.rechts), `${clip} Frame ${f} Flügel`).toBeGreaterThanOrEqual(6);
      }
    }
    for (const f of frames(s, 'idle_up')) {
      const grau = zaehle(s, f, ['stein.2', 'stein.3', 'stein.4']);
      const weiss = zaehle(s, f, ['eis.2', 'eis.3', 'eis.4']);
      // Grey mantle between the wings: before the back was white (grey : white 0.37–0.47), now 0.9.
      expect(grau.links + grau.rechts, `idle_up Frame ${f} Mantel`).toBeGreaterThanOrEqual(0.75 * (weiss.links + weiss.rechts));
      const spitzen = zaehle(s, f, ['nacht.2']);
      expect(Math.min(spitzen.links, spitzen.rechts), `idle_up Frame ${f} Handschwingen`).toBeGreaterThanOrEqual(2);
    }
  });

  it('Keiler von vorn: helle Rüsselscheibe mit zwei dunklen Nüstern, spiegelgleich zur Mitte', () => {
    const { sprite: s } = kreatur('keiler');
    const scheibe = new Set(['haut.2', 'haut.3'].map(paletteIndex));
    const nuester = paletteIndex('nacht.2');
    for (const f of frames(s, 'idle_down')) {
      const px = pixel(s, f);
      const n = zaehle(s, f, ['haut.2', 'haut.3']);
      expect(n.links + n.rechts, `idle_down Frame ${f} Scheibe`).toBeGreaterThanOrEqual(4);
      expect(n.links, `idle_down Frame ${f} Scheibe symmetrisch`).toBe(n.rechts);
      // Nostrils: dark pixels framed by the disc (left and right neighbour or below), one each side of the centre.
      let links = 0;
      let rechts = 0;
      px.forEach((v, p) => {
        if (v !== nuester) return;
        const nachbarn = [p - 1, p + 1, p + s.w].filter((q) => scheibe.has(px[q] ?? 0)).length;
        if (nachbarn === 0) return;
        if (p % s.w < s.w / 2) links++;
        else rechts++;
      });
      expect([links, rechts], `idle_down Frame ${f} Nüstern`).toEqual([1, 1]);
    }
  });

  it('Dornling gesträubt: einzelne Dornen mit roten Spitzen, nirgends ein verschmolzener Dornenblock', () => {
    const { sprite: s, clips } = kreatur('dornling');
    const dorn = paletteIndex('laub.0');
    const spitze = paletteIndex('laub.2');
    for (const r of ['down', 'up', 'right'] as const) {
      const info = clips.find((c) => c.aktion === 'attack_ueberfall' && c.richtung === r);
      if (info === undefined || info.ausholen === null) throw new Error(`ueberfall_${r}`);
      const gehalten = [...new Set(info.frames.slice(2, info.ausholen.bis + 1))];
      for (const f of [...gehalten, ...frames(s, `idle_${r}`)]) {
        const px = pixel(s, f);
        // No 2 × 2 block of the dark thorn base (before: on the right a 4 × 3 dark red block of parallel thorns).
        for (let y = 0; y + 1 < s.h; y++)
          for (let x = 0; x + 1 < s.w; x++) {
            const block = [px[y * s.w + x], px[y * s.w + x + 1], px[(y + 1) * s.w + x], px[(y + 1) * s.w + x + 1]].every((v) => v === dorn);
            expect(block, `${r} Frame ${f} Dornenblock bei (${x}, ${y})`).toBe(false);
          }
        // Red tips on the silhouette: tip pixels touching the outline (berries sit inside the leaves).
        const kontur = paletteIndex('gras.0');
        let tips = 0;
        px.forEach((v, p) => {
          if (v !== spitze) return;
          if ([p - 1, p + 1, p - s.w, p + s.w].some((q) => px[q] === kontur || px[q] === TRANSPARENT)) tips++;
        });
        expect(tips, `${r} Frame ${f} Dornspitzen`).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it('Geschoss spucken: Kern, Hülle und Glutrand selbstleuchtend, Tropfen abgesetzt, gedreht ohne Einzelpixel', () => {
    const s = geschossSpucken;
    const toene = ['verderb.2', 'verderb.3', 'verderb.4'].map(paletteIndex);
    const rand = paletteIndex('verderb.1');
    for (const f of frames(s, 'flug')) {
      const fr = s.frames[f];
      if (fr === undefined) throw new Error(`Frame ${f}`);
      // Everything but the ink outline glows (before: rim and drop in non-emissive `verderb.1`, lost in the night tint).
      fr.index.forEach((v, p) => {
        if (v === TRANSPARENT || v === rand) return;
        expect(fr.emissive[p], `flug Frame ${f} Pixel ${p} emissiv`).toBe(1);
      });
      for (const t of toene) expect(fr.index.includes(t), `flug Frame ${f} Ton ${t}`).toBe(true);
      // The bright core lies inside: no core pixel touches the outline or the outside.
      const kern = paletteIndex('verderb.4');
      fr.index.forEach((v, p) => {
        if (v !== kern) return;
        for (const q of [p - 1, p + 1, p - s.w, p + s.w]) expect(fr.index[q] === TRANSPARENT || fr.index[q] === rand, `flug Frame ${f} Kern am Rand`).toBe(false);
      });
      // Blob and trailing drop: at least two glowing areas, none a single pixel.
      const gl = flaechen(s.w, s.h, (i) => fr.emissive[i] === 1);
      expect(gl.length, `flug Frame ${f} Tropfen`).toBeGreaterThanOrEqual(2);
      // Turned freely in the low-res buffer (nearest pixel around the anchor): the glow keeps no lone pixels.
      for (const grad of [30, 100, 135, 200, 260, 315]) {
        const a = (grad * Math.PI) / 180;
        const C = 20;
        const gedreht = new Uint8Array(C * C);
        for (let y = 0; y < C; y++)
          for (let x = 0; x < C; x++) {
            const dx = x + 0.5 - C / 2;
            const dy = y + 0.5 - C / 2;
            const sx = Math.floor(Math.cos(a) * dx + Math.sin(a) * dy + s.anchor[0]);
            const sy = Math.floor(-Math.sin(a) * dx + Math.cos(a) * dy + s.anchor[1] - 6);
            if (sx >= 0 && sy >= 0 && sx < s.w && sy < s.h) gedreht[y * C + x] = fr.emissive[sy * s.w + sx] ?? 0;
          }
        // Diagonal attached pixels count as attached (they read as one stroke).
        const teile = flaechen(C, C, (i) => gedreht[i] === 1, true);
        expect(Math.min(...teile), `flug Frame ${f} gedreht ${grad}°`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
