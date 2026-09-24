/**
 * Tileset Meeresgrund (M2-17, docs/ART.md §3, docs/WORLD.md §7): der Grund unter dem Meer, wie er durch
 * das Wasser erscheint (`wasser`-Rampe; der Wasser-Pass legt später Tiefenfärbung, Wellen und
 * Uferschaum darüber, MASTERPROMPT §6.1 Pass 7). Wasser liegt immer unten – Meeresgrund ist
 * **Saum-Terrain**: Seine Frames decken die Kachel ganz und zeigen zu jedem fremden Nachbarn eine
 * **Uferbank** (Flachwasser `wasser.4` über der Abbruchkante `wasser.3`/`wasser.1`); unter einer
 * Landkachel liegt die reine Bank (Blob 0), damit das Flachwasser unter dem Rand des Landes
 * weiterläuft. Vollfeld: Tiefgrund `wasser.2` mit Lichtwellen `wasser.3`, dunklen Senken `wasser.1`,
 * selten ein Stein oder Seegras. Kantenstücke: `GEOMETRIE_WEICH`.
 */
import { blobTileset } from '../../lib/blob';
import { BANK, GEOMETRIE_WEICH, GRUPPE_TERRAIN, bandFaerbung, varianten } from './_quelle';

const LEGENDE = { w: 'wasser.2', W: 'wasser.1', l: 'wasser.3', o: 'stein.1', O: 'stein.2', g: 'gras.1', G: 'gras.2' } as const;

const VARIANTEN = varianten('meeresgrund', LEGENDE, [
  // 0 ruhig: zwei Lichtwellen.
  `wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwlllwwwwwwwwww
   wwwwwwllwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwlllww
   wwwwwwwwwllwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww`,
  // 1 Senke: weiche dunkle Mulde, darüber eine Welle.
  `wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwllwwwww
   wwwwwwwwwwwllwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwWWWwwwwwww
   wwwwWWWWWWwwwwww
   wwwwwWWWWWWwwwww
   wwwwwwwWWWwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwlllwwwwwwwwwww
   wwwwwllwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww`,
  // 2 Stein am Grund mit Kontaktschatten, Welle unten.
  `wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwOOOwwwwwwwww
   wwwOOoOOwwwwwwww
   wwwoooooWwwwwwww
   wwwwWWWWwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwlllwww
   wwwwwwwwwwwwllww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww`,
  // 3 selten: Seegrasbüschel (`gras`, von der Biomzeile getönt).
  `wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwGwwGwww
   wwwwwwwwGgwGgwww
   wwwwwwwwGgwGgGww
   wwwwwwwwwgGggGww
   wwwwwwwwwgggGwww
   wwwwwwwwWWWWWwww
   wwwwwwwwwwwwwwww
   wwlllwwwwwwwwwww
   wwwwllwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww
   wwwwwwwwwwwwwwww`,
]);

/** Uferbank (außen, ab zwei Reihen vor der Abbruchkante): Flachwasser mit hellen Sandrippeln. */
const BANK_RASTER = [
  '4444444444444444',
  '4444444444444444',
  '4444455444444444',
  '4444444554444444',
  '4444444444444444',
  '4444444444444444',
  '4444444444444554',
  '4444444444455444',
  '4444444444444444',
  '4444444444444444',
  '4445544444444444',
  '4444455444444444',
  '4444444444444444',
  '4444444444444444',
  '4444444444444444',
  '4444444444444444',
];

export default blobTileset({
  id: 'tileset_meeresgrund',
  group: GRUPPE_TERRAIN,
  art: 'saum',
  geometrie: GEOMETRIE_WEICH,
  varianten: VARIANTEN,
  ruhig: [0, 1],
  basis: 'wasser.2',
  fuellung: 'motive',
  motivAbstand: 3,
  faerbung: bandFaerbung({
    baender: { s: ['wasser.1'], n: ['wasser.3', 'wasser.1'], w: ['wasser.1'], o: ['wasser.1'] },
    breiter: { n: [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0] },
    aussen: { s: ['wasser.4', 'wasser.4', BANK], n: ['wasser.3', 'wasser.4', BANK], w: ['wasser.4', 'wasser.4', BANK], o: ['wasser.4', 'wasser.4', BANK] },
    bank: (x, y) => `wasser.${BANK_RASTER[y]?.[x] ?? '4'}`,
  }),
});
