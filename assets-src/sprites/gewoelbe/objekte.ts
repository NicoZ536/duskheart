/**
 * Welt-Objekte der Gewölbe (M7-11, M7-46, Strang C; Content src/content/dungeons/objekte.ts, Objektart `ort`): die Zierde der
 * Raumvorlagen (Säulen, Statuen, Wurzeln, Moos, Bodenrunen, kalte Becken), die Erbauer-Tafel, Ab- und Aufgang und das Loch eines
 * eingestürzten Bodens. Raster aus dem Generator in scratchpad (Formen, dann Kontur); Konventionen `_gewoelbe.ts`.
 *
 * - `ort_gw_saeule` (16×32, Anker [8, 30], `zylinder`): Erbauer-Säule: eckiger Schaft mit zwei Kanneluren, Band in der Mitte, Kapitell und Sockel, Moos auf dem Kapitell und am Fuß; Variante 2 mit einer Wurzel, die sich am Schaft herabwindet.
 * - `ort_gw_statue` (16×32, Anker [8, 30], `zylinder`): Erbauer-Statue: eine verhüllte Gestalt auf dem Sockel, die Hände halten eine Scheibe vor der Brust, Moos auf den Schultern.
 * - `ort_gw_wurzeln` (16×16, Anker [8, 15], `flach`): Eingewachsene Wurzeln: ein dicker Strang mit zwei Abzweigen quer über die Platten (zwei Varianten).
 * - `ort_gw_moos` (16×16, Anker [8, 15], `flach`): Moospolster: ein großes und ein kleines Polster, oben hell, am Rand dunkel (zwei Varianten).
 * - `ort_gw_rune` (16×16, Anker [8, 15], `flach`): Leuchtende Bodenrune: ein eingemeißelter Ring, innen kaltes Runenlicht (emissiv) – ein Zeichen der Erbauer, das auch im Dunkeln liegt.
 * - `ort_gw_becken` (16×24, Anker [8, 22], `zylinder`): Kaltes Kohlebecken: Bronzeschale auf drei Beinen, darin kalte Asche (Zierde; die Rätsel-Schalen sind eigene Teile).
 * - `ort_erbauer_tafel` (16×28, Anker [8, 26], `block`): Erbauer-Tafel: ein aufrechter Stein mit runder Kappe, vier Zeilen eingemeißelter Zeichen (Rinne dunkel, Fase hell) und einem glimmenden Zeichen oben – E liest sie.
 * - `ort_gw_abgang` (32×24, Anker [16, 19], `flach`): Gewölbe-Abgang an der Oberfläche: ein Rahmen aus behauenen Steinen um einen Schacht, dessen Stufen nach Norden ins Dunkel führen; Moos an den Ecken.
 * - `ort_gw_aufgang` (16×24, Anker [8, 19], `flach`): Gewölbe-Aufgang im Startraum: Stufen, die nach Norden ins Tageslicht steigen – oben hell (`sand.3`/`sand.4`), unten im Stein.
 * - `ort_gw_einsturz` (16×16, Anker [8, 15], `flach`): Eingestürzter Boden: ein Loch mit gebrochenem Plattenrand, an der Nordkante die Wand des Schachts, Risse und Steinchen ringsum (Einsturz-Bildsprache docs/ART.md §7).
 */
import { gw } from './_gewoelbe';

export default [
  gw({
    id: 'ort_gw_saeule',
    size: [16, 32],
    anchor: [8, 30],
    hoehe: 'zylinder',
    frames: [`................
    .11111111111111.
    145hih55555ih541
    1444h4444444h441
    1444444444444441
    1333333333333331
    .11111111111111.
    ..123434434321..
    ..123434434321..
    ..123434434321..
    ..123434434321..
    ..123434434321..
    ..123434434321..
    ..123434434321..
    ..123434434321..
    ..155555555551..
    ..122222222221..
    ..123434434321..
    ..123434434321..
    ..123434434321..
    ..123434434321..
    ..123434434321..
    ..123434434321..
    ..1g3434434321..
    .11h34344343211.
    13hih5555555hh31
    1444444444444441
    1333333333333331
    1333333333333331
    1222222222222221
    .kkkkkkkkkkkkkk.
    ................`, `................
    .11111111111111.
    145hih55555ih541
    1444h4444444h441
    1444444444444441
    1333333333333331
    .111b1111111111.
    ..123c34434321..
    ..123b34434321..
    ..1234c4434321..
    ..12343b434321..
    ..123434c34321..
    ..123434b34321..
    ..123434bc4321..
    ..123434b34321..
    ..155555bb5551..
    ..12222bc2b221..
    ..12343b43b321..
    ..1234c4434b21..
    ..123b34434b21..
    ..12bc344343a1..
    ..12b434434321..
    ..12b434434321..
    ..1gb434434321..
    .11b34344343211.
    13hbh5555555hh31
    1444444444444441
    1333333333333331
    1333333333333331
    1222222222222221
    .kkkkkkkkkkkkkk.
    ................`],
  }),
  gw({
    id: 'ort_gw_statue',
    size: [16, 32],
    anchor: [8, 30],
    hoehe: 'zylinder',
    frames: [`................
    ................
    ................
    ......1111......
    .....134431.....
    ....13444431....
    ....13444431....
    ...1344114431...
    ...1331111331...
    ....13121131....
    ....13312331....
    ....1i3333h1....
    ...1hh34432h1...
    ....12344321....
    ....12555521....
    ...1255665521...
    ...1235545321...
    ...1234344321...
    ..123443443321..
    ..123443443321..
    ..123443443321..
    .1234443434321..
    .12344434344321.
    .12344434344321.
    .12344434344321.
    1234444343444g21
    13hi55555555hh31
    1444444444444441
    1333333333333331
    1222222222222221
    .kkkkkkkkkkkkkk.
    ................`],
  }),
  gw({
    id: 'ort_gw_wurzeln',
    size: [16, 16],
    anchor: [8, 15],
    hoehe: 'flach',
    frames: [`........aa......
    .......abba.....
    aa....abaa......
    ccaa..aba.......
    bbccaaaba.......
    aabbccba........
    ..aabbba........
    ....aabca.......
    ......abcaa.....
    .......abcbaa...
    ........abbcca..
    ........ababbcaa
    ........abaaabcc
    .........aba.abb
    .........aba..aa
    ..........a.....`, `................
    ...............a
    .............aac
    ...........aaccb
    .........aaccbba
    ........abcbbaa.
    .......acbbaa...
    ......acbaba....
    .....acbaabbaa..
    .....aca..aabba.
    ....abba....aa..
    ..aacba.........
    aaccbaba........
    ccbbaaba........
    bbaa..aba.......
    aa.....aba......`],
  }),
  gw({
    id: 'ort_gw_moos',
    size: [16, 16],
    anchor: [8, 15],
    hoehe: 'flach',
    frames: [`................
    ................
    ..........GGGGG.
    .........GijjjiG
    ......GGGGiiiiiG
    ...GGGiiiGgggggG
    ..GiiiijiiiiGGG.
    .GiijjjjjjjiiG..
    .GiiiiiiiiiiiG..
    .GhhhhhhhhhhhG..
    .GhhhhhhhhhhhG..
    ..GgggggggggG...
    ...GGGgggGGG....
    ......GGG.......
    ................
    ................`, `................
    ................
    ....GGGG........
    ..GGiiiiGG......
    .GiijjjjiiG.....
    .GiiiiiiiiG.....
    .GhhhhhhhhG.....
    .GhhhhhhhhGGG...
    ..GGggggiiiiiG..
    ....GGGijjjjjiG.
    .....GiiiiiiiiiG
    .....GhhhhhhhhhG
    ......GhhhhhhhG.
    .......GgggggG..
    ........GGGGG...
    ................`],
  }),
  gw({
    id: 'ort_gw_rune',
    size: [16, 16],
    anchor: [8, 15],
    hoehe: 'flach',
    frames: [`................
    ................
    ................
    ....22@@@@22....
    ...2@......@2...
    ..2@....^...@2..
    ..@....^.^...@..
    ..@...^.@.^..@..
    ..@..^^^^^^^.@..
    ..@..........@..
    ..2@....@...@2..
    ...2@..222.@2...
    ....22@@@@22....
    ................
    ................
    ................`],
    einzelpixel: 'Glanzpunkte des Runenlichts im Ring',
  }),
  gw({
    id: 'ort_gw_becken',
    size: [16, 24],
    anchor: [8, 22],
    hoehe: 'zylinder',
    frames: [`................
    ................
    ................
    ................
    ................
    ................
    ....kkkkkkkk....
    ..kk22222222kk..
    .k333343331333k.
    .kXX33333433XXk.
    kXXTPPPPPPPPTXXk
    .kXXXXXXXXXXXXk.
    ..kWWWWWWWWWWk..
    ...kWWWWWWWWk...
    ...kWkkkQkkWk...
    ..kWk..kQk.kWk..
    ..kWk..kQk.kWk..
    ..kWk..kQk.kWk..
    ..kWk..kQk.kWk..
    .kWk...kQk..kWk.
    .kWk...kQk..kWk.
    .kQk...kQk..kQk.
    ..k.....k....k..
    ................`],
  }),
  gw({
    id: 'ort_erbauer_tafel',
    size: [16, 28],
    anchor: [8, 26],
    hoehe: 'block',
    frames: [`................
    .......1........
    ....11141111....
    ...1555555551...
    ..14454444541...
    ..14444^^44441..
    ..13444@@44431..
    ..134444444431..
    ..134444444431..
    ..134422242431..
    ..134455545431..
    ..134444444431..
    ..134222424431..
    ..134555454431..
    ..134444444431..
    ..134424222431..
    ..134454555431..
    ..134444444431..
    ..134242244431..
    ..134545544431..
    ..134444444431..
    .1hih4444444hg1.
    .15555555555551.
    .13333333333331.
    .13333333333331.
    .12222222222221.
    ..kkkkkkkkkkkk..
    ................`],
    einzelpixel: 'Glimmende Zeichen und Zeichenlücken der eingemeißelten Zeilen',
  }),
  gw({
    id: 'ort_gw_abgang',
    size: [32, 24],
    anchor: [16, 19],
    hoehe: 'flach',
    frames: [`................................
    .....1111111111111111111111.....
    ....155555255555255552555551....
    ....13i444444444444444444431....
    ....1hh444444444444444444431....
    ....134411111111111111114431....
    ....13441KKKKKKKKKKKKKK14431....
    ....13441KKKKKKKKKKKKKK14431....
    ....12441NNNNNNNNNNNNNN14421....
    ....13441nnnnnnnnnnnnnn14431....
    ....13441nnnnnnnnnnnnnn14431....
    ....134412222222222222214431....
    ....13441NNNNNNNNNNNNNN14431....
    ....13441NNNNNNNNNNNNNN14431....
    ....134413333333333333314431....
    ....124412222222222222214421....
    ....134412222222222222214431....
    ....134414444444444444414431....
    ....1344144444444444444144g1....
    ....134444444444444444444h31....
    ....13444444444444444444h431....
    ....133333233hi3233332333331....
    .....1111111111111111111111.....
    ................................`],
  }),
  gw({
    id: 'ort_gw_aufgang',
    size: [16, 24],
    anchor: [8, 19],
    hoehe: 'flach',
    frames: [`.11111111111111.
    12EEEEEEEEEEEE21
    12EEEEEEEEEEEE21
    12EEEEEEEEEEEE21
    12EEEEEEEEEEEE21
    12DDDDDDDDDDDD21
    1233333333333321
    12EEEEEEEEEEEE21
    12EEEEEEEEEEEE21
    1255555555555521
    1233333333333321
    1266666666666621
    1266666666666621
    1244444444444421
    1233333333333321
    1255555555555521
    1255555555555521
    1233333333333321
    1233333333333321
    1244444444444421
    1244444444444421
    1222222222222221
    1233333333333321
    .11111111111111.`],
  }),
  gw({
    id: 'ort_gw_einsturz',
    size: [16, 16],
    anchor: [8, 15],
    hoehe: 'flach',
    frames: [`................
    ................
    ....11111111...1
    ...1433223331.1.
    .1132222222231..
    113NNNNNNNNNN31.
    134NNNNNNNNNN331
    13NNNNNNNNNNNN41
    13KKKKKKKKKKKK31
    13KKKKKKKKKKKK31
    143KKKKKKKKKK331
    .13KKKKKKKKKK41.
    ..15KKKKKKKK31..
    ...1333KK43341..
    ..1.1111111111..
    ..............1.`],
    einzelpixel: 'Abgesprengte Steinchen um das Loch',
  }),
];
