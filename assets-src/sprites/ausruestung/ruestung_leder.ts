/**
 * Ledersatz (Set `leder`, T1, mittel; M6-31): Kappe, Wams, Hose und Stiefel aus gegerbtem Leder – die Layer
 * `ausruestung_lederkappe` (Kopf), `_lederwams` (Körper), `_lederhose` (Beine), `_lederstiefel` (Füße), aus den Posen
 * des Körpers umgefärbt (`_ruestung.ts`).
 *
 * Farbe: Rampe `erde` (Tiefe bis Licht), Nähte und Schnürung in hellem Garn (`sand`). Die Kappe sitzt tief mit
 * Ohrenklappen; das Wams ist ärmellos (das graue Unterkleid bleibt an den Armen sichtbar), vorn geschnürt, mit breitem
 * Gürtel und heller Schnalle, und endet eine Reihe unter dem Gürtel; die Hose ist glatt; die Stiefel sind eine Reihe
 * höher als die Schuhe des Unterkleids und haben einen hellen Umschlag.
 */
import { HAAR, HOSE, ruestungsLayer, stiefelOben, type RuestungsStil } from './_ruestung';

const LEGENDE = { x: 'erde.0', y: 'erde.1', z: 'erde.2', Z: 'erde.3', q: 'sand.3' } as const;

/** Letzte Rumpfzeile des Wamses (Kragen 0, Gürtel 5, Saum 6). */
const WAMS_SAUM = 6;

const STILE: readonly RuestungsStil[] = [
  {
    id: 'lederkappe',
    platz: 'kopf',
    legende: LEGENDE,
    // Bis über die Stirn, darunter der dunkle Rand; die Ohrenklappen decken das Haar an den Seiten (im Profil hinten).
    kopf: (c, x, y, _t, info) => {
      if (!HAAR.has(c)) return c;
      if (y <= 3) return c === '3' ? 'Z' : c === '2' ? 'z' : 'y';
      if (y === 4) return 'x';
      const seite = info.richtung === 'right' || info.richtung === 'left' || x <= 2 || x >= 13;
      return y <= 7 && seite ? 'y' : c;
    },
  },
  {
    id: 'lederwams',
    platz: 'brust',
    legende: LEGENDE,
    rumpf: (c, x, y, _t, info) => {
      if (y > WAMS_SAUM) return c;
      if (c === 'g') return 'x';
      if (c === 'G') return 'Z';
      if (c !== 'b' && c !== 't' && c !== 'T') return c;
      // Schnürung vorn in der Mitte (Spalten 7 und 8 des Rumpfs von vorn).
      if (info.richtung === 'down' && (x === 7 || x === 8) && y >= 1 && y <= 4) return y % 2 === 1 ? 'q' : 'x';
      return c === 'b' ? 'x' : c === 't' ? 'y' : 'z';
    },
  },
  {
    id: 'lederhose',
    platz: 'beine',
    legende: LEGENDE,
    bein: (c) => (c === 'p' ? 'y' : c === 'P' ? 'z' : c),
  },
  {
    id: 'lederstiefel',
    platz: 'fuesse',
    legende: LEGENDE,
    // Schaft eine Reihe höher, dort der helle Umschlag.
    bein: (c, _x, y, t) => (c === 'E' ? 'z' : c === 'e' ? 'x' : HOSE.has(c) && y === stiefelOben(t) - 1 ? 'Z' : c),
  },
];

export default STILE.map(ruestungsLayer);
