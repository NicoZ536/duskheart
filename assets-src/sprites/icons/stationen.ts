/**
 * Item-Icons der Stationen T0–T1, des Herdfeuers und der Glutkerne (M4-05, M4-06, M4-20; docs/SPIEL.md
 * §8): `icon_<itemId>` (16×16, Konvention in `_icon.ts`). Lagerfeuer und Werkbank haben ihr Icon schon
 * aus M3-16 (`grundlagen.ts`). Stationen zeigen ihre Form im Kleinen; Flammen und Glut leuchten im Icon
 * nicht (ein getragenes Item ist keine Lichtquelle).
 *
 * Glutkerne `glutkern_1` … `glutkern_6` (einer je Leuchtfeuer): dieselbe geschliffene Glut auf einem
 * Steinsockel, je Kern eine eigene Glutfarbe und die Zahl als eingekerbte Punkte im Sockel – so bleiben
 * sie auch ohne Farbsehen unterscheidbar.
 */
import { icon } from './_icon';

/** Glutkern: Tropfen aus Glut über einem Sockel mit `n` Kerben; `a`…`d` = Glutstufen dunkel → hell. */
function glutkern(n: number, stufen: readonly [string, string, string, string]): ReturnType<typeof icon> {
  const kerben = ['......', '..k...', '..k.k.', '.k.k.k', 'k.kk.k', 'kk.k.k'][n - 1] ?? '......';
  // Sockelzeile: 8 px Stein, darin die Kerben als Konturpunkte.
  const sockel = `....k5${[...kerben].map((c) => (c === 'k' ? 'k' : '5')).join('')}5k..`;
  return icon(
    `glutkern_${n}`,
    `................
     .......kk.......
     ......kWWk......
     .....kWXXWk.....
     .....kXYYXk.....
     ....kWXYZYWk....
     ....kXYZZYXk....
     ....kWXYYXWk....
     .....kWXXWk.....
     ......kWWk......
     ....kkkkkkkk....
     ${sockel}
     ....k33333333k..
     ....kkkkkkkkk...
     ................
     ................`,
    { legende: { W: stufen[0], X: stufen[1], Y: stufen[2], Z: stufen[3] } },
  );
}

export default [
  icon(
    'saegebock',
    `................
     ................
     ......kkkk......
     ......kddk......
     .kkkkkk55kkkkkk.
     .kddcddaaddcddk.
     .kccccbaacbccck.
     .kbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkk.
     ..kd.dk..kd.dk..
     ...kdk....kdk...
     ...kdk....kdk...
     ..kd.dk..kd.dk..
     .kd...dkkd...dk.
     .kk...kkkk...kk.
     ................`,
  ),
  icon(
    'steinmetzbank',
    `................
     ................
     ..kkkkkkkk......
     .k55665565k.....
     .k55555555k.kkk.
     .k44434443kkdek.
     .k43443434kkcbk.
     .k33333333kkkdk.
     .kkkkkkkkkkkkbk.
     .keeeedddeeeeek.
     .kbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkk.
     ..kcbk....kcbk..
     ..kcbk....kcbk..
     ..kkkk....kkkk..
     ................`,
  ),
  icon(
    'trockengestell',
    `................
     .kkk........kkk.
     .kdk........kdk.
     .kdkkkkkkkkkkdk.
     .kddddddddddddk.
     .kdkkkkkkkkkkdk.
     .kdk.kDDkkmkkdk.
     .kdkkhiikkmkkdk.
     .kdkhijjhkmkkdk.
     .kdkkhiikkmkkdk.
     .kdk.khk..k.kdk.
     .kdk..k.....kdk.
     .kdk........kdk.
     .kbk........kbk.
     .kkk........kkk.
     ................`,
    { material: { wind: 'hijlmD' } },
  ),
  icon(
    'koehlermeiler',
    `................
     ................
     ......kkkk......
     ....kktkktkk....
     ...ktssssssstk..
     ...ksihssssssk..
     ..kssihisssssrk.
     ..kssssssrsssrk.
     ..ksrssssssssrk.
     .krssssssrsrsrk.
     .krsskkrrrkkrqk.
     .kqrrkkrrrkkqqk.
     .kqqqqqqqqqqqqk.
     ..kkkkkkkkkkkk..
     ................
     ................`,
  ),
  icon(
    'lehmofen',
    `................
     .......kk.......
     ......kqqk......
     ....kkDDDDkk....
     ...kDEEDDDDDk...
     ..kDEDDDDDDDCk..
     ..kDDDDDDDDDCk..
     .kCDDDDDDDDDCCk.
     .kCDDDkkkkDDCCk.
     .kCCDkfffFkDCBk.
     .kBCCkfFFFkCCBk.
     .kBBCkffFfkCBBk.
     .k4443kkkk4443k.
     .k333333333333k.
     .kkkkkkkkkkkkkk.
     ................`,
  ),
  icon(
    'werkbank_2',
    `................
     .kkkkkkkkkkkkk..
     .kckkkcbkcckbk..
     .kc5555kcckckk..
     .kckkkcbkkcbck..
     .kccbccbcckcbk..
     .kkkkkkkkkkkkk..
     .kkkkkkkkkkkkkk.
     .keeeeeeeeeeeek.
     .kddddddddddddk.
     .kbbbbbbbbbbbbk.
     .kkkkkkkkkkkkkk.
     ..kcbk....kcbk..
     ..kcbk....kcbk..
     ..kkkk....kkkk..
     ................`,
  ),
  icon(
    'schmelzofen',
    `................
     ......kkkk......
     .....kfFFfk.....
     .....ksqqsk.....
     .....ksssrk.....
     ....kqqqqqqk....
     ....ksssssrk....
     ....kssrsssrk...
     ...kqqqqqqqqk...
     ...ksssskksssk..
     ...kssskFfksrk..
     ..kkssskffksrrk.
     ..k44444444443k.
     ..k33333333333k.
     ..kkkkkkkkkkkkk.
     ................`,
  ),
  icon(
    'amboss_bronze',
    `................
     ................
     ................
     ...kkkkkkkkkkk..
     ..kMMMooMMMMMMk.
     .kmMMMMMMMMMMMk.
     ..kkmmmmmmmmmk..
     ....kkmmmmlkk...
     ......kmmlk.....
     .....kmmmmlk....
     ....kllllllk....
     ....kkkkkkkk....
     ....kddeeddk....
     ....kbccccbk....
     ....kkkkkkkk....
     ................`,
    { material: { metall: 'lmMo' } },
  ),
  icon(
    'schleifstein',
    `................
     ....kkkkkk......
     ...k455554k.....
     ..k45555554k....
     .k4555kk5554kk..
     .k4555kk5554kbk.
     .k4455555544kbk.
     ..k34555543k.k..
     ...k333333k.....
     .kkkkkkkkkkkkk..
     .kbkzYzzzYzkbk..
     .kbkyyyyyyykbk..
     .kbkkkkkkkkkbk..
     .kbk.......kbk..
     .kkk.......kkk..
     ................`,
    { material: { nass: 'yzY' } },
  ),
  icon(
    'spinnrad',
    `................
     .kk...kkkkk.....
     .kEk.kdddddk....
     .kEkkd..k..dk...
     .kEkd...k...dk..
     ..kd....k....dk.
     ..kd....k....dk.
     ..kdkkkkkkkkkdk.
     ..kd....k....dk.
     ...kd...k...dk..
     ....kkcccccck...
     ..kkkkkkkkkkkkk.
     ..kdddddddddddk.
     ...kdk.....kdk..
     ...kkk.....kkk..
     ................`,
  ),
  icon(
    'herdfeuer',
    `................
     .......kk.......
     ......kFFk......
     .....kFuuFk.....
     .....kFuvFk.....
     ....kFuvvuFk....
     ...kkkFuuFkkk...
     ..k555kkkk555k..
     .k554kfbbfk455k.
     .k55kkkkkkkk55k.
     .k455555555554k.
     .k233233233232k.
     .k322322322323k.
     ..kkkkkkkkkkkk..
     ................
     ................`,
  ),
  glutkern(1, ['feuer.1', 'feuer.2', 'feuer.4', 'feuer.5']),
  glutkern(2, ['sand.1', 'sand.2', 'sand.3', 'sand.4']),
  glutkern(3, ['laub.0', 'laub.1', 'laub.3', 'laub.4']),
  glutkern(4, ['wasser.2', 'wasser.3', 'wasser.4', 'wasser.5']),
  glutkern(5, ['eis.0', 'eis.1', 'eis.3', 'eis.4']),
  glutkern(6, ['gras.2', 'gras.3', 'gras.4', 'gras.5']),
];
