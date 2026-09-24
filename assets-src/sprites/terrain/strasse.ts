/**
 * Tileset Straße (M2-17/M2-18, docs/ART.md §3, docs/WORLD.md §7): zerfallenes Polygonpflaster der
 * Erbauer in `stein` (Biomzeilen tönen es mit). Vollfeld: unregelmäßige Platten mit Fugen `stein.1`,
 * an der Oberkante jeder Platte die helle Fase `stein.4` (sieht den Himmel), an der Unterkante der
 * Schatten `stein.2` über der Fuge (verdeckt), Moos `gras` in den Fugen, ein Sprung; selten ein
 * ausgebrochenes Loch mit Erde und Grasbüschel.
 * Nahtlos in jeder Anordnung: Fugen schneiden den linken und rechten Rand immer bei y = 5 und y = 12,
 * den oberen und unteren Rand bei x = 4 und x = 11; dazwischen läuft das Fugennetz je Variante anders.
 * Nicht spiegeln (die Fugen sitzen nicht symmetrisch).
 * Liegt tief (Gras, Erde und Sand überwachsen die Ränder); über Schlamm, Eis und Wasser zeigt es
 * ausgebrochene Plattenkanten (`GEOMETRIE_KANTIG`, Textur läuft bis an die Bruchkante).
 */
import { blobTileset } from '../../lib/blob';
import { GEOMETRIE_KANTIG, GRUPPE_TERRAIN, bandFaerbung, varianten } from './_quelle';

const LEGENDE = { a: 'stein.3', A: 'stein.4', d: 'stein.2', j: 'stein.1', m: 'gras.2', M: 'gras.3', e: 'erde.1', E: 'erde.2' } as const;

const VARIANTEN = varianten('strasse', LEGENDE, [
  // 0 Polygonplatten, Moos in einer Fuge.
  `aaaajaaaaaajaaaa
   aaaajaaaaaajdaaa
   aaaaAjaaaaaAjaaa
   aaaaajaaaaaajaaa
   ddaddjaaaaaajaad
   jjjjjjdadaadjajj
   AAaAAAjjjadjjjaA
   aaaaaaAaAjjjAAaa
   aaaaaaaaaAjAaaaa
   aaaaaaaaaajaaaaa
   aaaddaaaaajaaaaa
   dadjjddaddjadadd
   jjjAjjmmjjjdjjjj
   AaAajaAAAaAjAaAA
   aaaajaaaaaajaaaa
   aaaajaaaaaajaaaa`,
  // 1 große Mittelplatte mit Sprung, Moos in der Fuge darunter.
  `aaaajaaaaaajaaaa
   aaaajaaaaaajaaaa
   aaadjaaaaaajaaaa
   aaajAdaddajjadaa
   ddajdjjjjjAjjjad
   jjjjjaAAAaaAjajj
   AAdjAaaaaaaajaaA
   aajaaaaddaaajaaa
   aajaaaaaddaajaaa
   aajaaaaaaaadjaaa
   aajdaaddaddjAaaa
   dadjammjjjjjdadd
   jjjjjAAAaAAjjjjj
   AaAAjaaaaaajAaAA
   aaaajaaaaaajaaaa
   aaaajaaaaaajaaaa`,
  // 2 schräg versetzte Platten, Moos in der Kreuzfuge.
  `aaaajaaaaadjaaaa
   aaaajaaaaajAaaaa
   aaaajaaaaajaaaaa
   aaaajdaaaajaaaaa
   daaaajdaaajaaaad
   jaddaajaaaAjdajj
   AjmmjdjaaaddjjaA
   aAAaAjjdadjjjAaa
   aaaaadjjjjAAjaaa
   aaaaajAAAaaajaaa
   aaaadjaaaaaajaaa
   daddjAaaaaajdadd
   jjjjjaaaaaajjjjj
   AaAAjaaaaaajAaAA
   aaaajaaaaaajaaaa
   aaaajaaaaaajaaaa`,
  // 3 selten: ausgebrochenes Loch in der Platte – Erde mit Grasbüschel.
  `aaaajaaaaaajaaaa
   aaaajaaaaaajdaaa
   aaaaAjaaaaaAjaaa
   aaaaajaaaaaajaaa
   ddaddjaaaaaajaad
   jjjjjjdadaadjajj
   AAaAAAjjjadjjjaA
   aaajjjjaAjjjAAaa
   aajdddddjAjAaaaa
   aajeeMeejajaaaaa
   aaAEMMEAaajaaaaa
   dadjjddaddjadadd
   jjjAjjjjjjjdjjjj
   AaAajaAAAaAjAaAA
   aaaajaaaaaajaaaa
   aaaajaaaaaajaaaa`,
]);

export default blobTileset({
  id: 'tileset_strasse',
  group: GRUPPE_TERRAIN,
  art: 'ueberlagerung',
  geometrie: GEOMETRIE_KANTIG,
  varianten: VARIANTEN,
  ruhig: [0, 1, 2],
  basis: 'stein.3',
  fuellung: 'textur',
  faerbung: bandFaerbung({
    baender: { s: ['stein.1', 'stein.2'], n: ['stein.4'], w: ['stein.2'], o: ['stein.2'] },
  }),
});
