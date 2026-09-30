/**
 * Fasergewand (Set `faser`, T0, leicht; M6-12): Kappe, Hemd, Hose und Schuhe aus gewebten Pflanzenfasern – die Layer
 * `ausruestung_faserkappe` (Kopf), `_faserhemd` (Körper), `_faserhose` (Beine), `_faserschuhe` (Füße), aus den Posen des
 * Körpers umgefärbt (`_ruestung.ts`).
 *
 * Farbe: Strohtöne der Rampe `sand` (eine Stufe dunkler als die Haut, damit sich Gewand und Gesicht trennen), das Gewebe als feines Schachbrett aus zwei Tönen (Kette und Schuss), Schnüre in
 * dunklem Holz. Die Kappe bedeckt den Scheitel bis zur Stirn, das Hemd mit Ärmeln ersetzt die Tunika und wird von einer
 * Schnur gegürtet, die Hose ist in Bahnen gewickelt, die Schuhe sind Bastsohlen mit Wickelbändern über dem Knöchel.
 */
import { HAAR, HOSE, STOFF, ruestungsLayer, stiefelOben, type RuestungsStil } from './_ruestung';

const LEGENDE = { x: 'sand.0', y: 'sand.1', z: 'sand.2', Z: 'sand.3', q: 'holz.1', Q: 'holz.2' } as const;

/** Gewebe: zwei Töne im Schachbrett. */
const gewebe = (x: number, y: number): string => ((x + y) % 2 === 0 ? 'y' : 'z');

const STILE: readonly RuestungsStil[] = [
  {
    id: 'faserkappe',
    platz: 'kopf',
    legende: LEGENDE,
    // Scheitel bis zur Stirn: oben hell geflochten, die unterste Reihe als dunkler Saum.
    kopf: (c, x, y) => {
      if (!HAAR.has(c) || y > 3) return c;
      if (y === 3) return 'x';
      return c === '3' ? ((x + y) % 2 === 0 ? 'Z' : 'z') : c === '2' ? gewebe(x, y) : 'y';
    },
  },
  {
    id: 'faserhemd',
    platz: 'brust',
    legende: LEGENDE,
    rumpf: (c, x, y) => (c === 'b' ? 'x' : c === 't' ? gewebe(x, y) : c === 'T' ? 'Z' : c === 'g' ? 'q' : c === 'G' ? 'Q' : c),
    arm: (c, x, y) => (!STOFF.has(c) ? c : c === 'b' ? 'x' : c === 't' ? gewebe(x, y) : 'Z'),
  },
  {
    id: 'faserhose',
    platz: 'beine',
    legende: LEGENDE,
    // In Bahnen gewickelt: helle und dunkle Reihen.
    bein: (c, _x, y) => (c === 'p' ? (y % 2 === 0 ? 'y' : 'x') : c === 'P' ? 'z' : c),
  },
  {
    id: 'faserschuhe',
    platz: 'fuesse',
    legende: LEGENDE,
    // Bastschuh; die Wickelbänder reichen eine Reihe über den Knöchel.
    bein: (c, _x, y, t) => (c === 'E' ? 'z' : c === 'e' ? 'y' : HOSE.has(c) && y === stiefelOben(t) - 1 ? 'x' : c),
  },
];

export default STILE.map(ruestungsLayer);
