/**
 * Bronzerüstung (Set `bronze`, T1, schwer; M6-12): Helm, Brustpanzer, Beinschienen und Bronzeschuhe – die Layer
 * `ausruestung_bronzehelm` (Kopf), `_bronzebrustpanzer` (Körper), `_bronzebeinschienen` (Beine), `_bronzestiefel` (Füße),
 * aus den Posen des Körpers umgefärbt (`_ruestung.ts`).
 *
 * Metall in der Rampe `stein` (Tiefe `x` bis Glanz `X`), über die Materialstufe zu Bronze umgefärbt (Metallflag, wie die
 * Waffen); Lederteile in `erde`. Der Helm deckt Scheitel und Stirn mit dunklem Rand, Wangenklappen und im Profil und von
 * hinten einen Nackenschutz; der Panzer deckt den Rumpf bis zum Gürtel (Glanz auf der Brust) mit kleinen Schulterstücken,
 * darunter hängen Lederstreifen (Pteryges); die Beinschienen decken die Schienbeine über den Schuhen; die Bronzeschuhe
 * reichen bis über den Knöchel.
 */
import { abstandZumDrehpunkt, HAAR, HOSE, STOFF, ruestungsLayer, stiefelOben, type RuestungsStil } from './_ruestung';

const LEGENDE = { x: 'stein.1', y: 'stein.2', z: 'stein.3', Z: 'stein.4', X: 'stein.5', q: 'erde.1', Q: 'erde.2' } as const;

/** Rumpfzeilen: Panzer bis zum Gürtel (5), Pteryges darunter bis Zeile 8. */
const PANZER_UNTEN = 5;
const PTERYGES_UNTEN = 8;

const STILE: readonly RuestungsStil[] = [
  {
    id: 'bronzehelm',
    platz: 'kopf',
    legende: LEGENDE,
    bronze: true,
    kopf: (c, x, y, _t, info) => {
      if (!HAAR.has(c)) return c;
      if (y <= 4) return c === '3' ? (y <= 1 ? 'X' : 'Z') : c === '2' ? 'z' : 'y';
      if (y === 5) return 'x';
      // Wangenklappen vorn, Nackenschutz hinten und im Profil.
      const schutz = info.richtung === 'up' ? y <= 7 : info.richtung === 'down' ? x <= 2 || x >= 13 : true;
      return y <= 8 && schutz ? 'y' : c;
    },
  },
  {
    id: 'bronzebrustpanzer',
    platz: 'brust',
    legende: LEGENDE,
    bronze: true,
    rumpf: (c, x, y) => {
      if (y <= PANZER_UNTEN) {
        if (c === 'g' || c === 'G') return 'y';
        if (!STOFF.has(c)) return c;
        return c === 'b' ? 'x' : c === 't' ? 'z' : y <= 2 ? 'X' : 'Z';
      }
      if (y <= PTERYGES_UNTEN && STOFF.has(c)) return x % 2 === 0 ? 'q' : 'Q';
      return c;
    },
    // Schulterstücke: das Stück Ärmel an der Schulter.
    arm: (c, x, y, t) => (STOFF.has(c) && abstandZumDrehpunkt(t, x, y) <= 1 ? (c === 'b' ? 'y' : c === 't' ? 'z' : 'Z') : c),
  },
  {
    id: 'bronzebeinschienen',
    platz: 'beine',
    legende: LEGENDE,
    bronze: true,
    // Die zwei Reihen über dem Schuh.
    bein: (c, _x, y, t) => {
      const oben = stiefelOben(t);
      return HOSE.has(c) && y >= oben - 2 && y < oben ? (c === 'p' ? 'z' : 'Z') : c;
    },
  },
  {
    id: 'bronzestiefel',
    platz: 'fuesse',
    legende: LEGENDE,
    bronze: true,
    bein: (c, _x, y, t) => (c === 'E' ? 'Z' : c === 'e' ? 'y' : HOSE.has(c) && y === stiefelOben(t) - 1 ? 'z' : c),
  },
];

export default STILE.map(ruestungsLayer);
