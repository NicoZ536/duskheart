/**
 * Tileset Klippe Grün (M2-18, MASTERPROMPT §4.4, docs/ART.md §3, docs/WORLD.md §7): Felsklippen der
 * Wiesenbiome (Grünhain, Nebelmoor – die Biomzeile tönt `stein`, `gras` und `erde` nach). Front:
 * gestaffelte, gerundete Felsbuckel – Oberseite `stein.4` (sieht den Himmel), Körper `stein.3`/`stein.2`,
 * Unterseite `stein.1`, Spalten `stein.0`, in der Variante ein geteilter Buckel mit Moos; die
 * Seitenflächen zeigen waagerechte Blockfugen, die Nordkante eine Reihe runder Kantensteine. Oben hängt
 * die Grasnarbe `gras.2` über den Rand, am Fuß liegt Geröll mit Grasbüscheln. Rampe: Erdhang mit hellem, gewundenem Trampelpfad; Treppe: Steinstufen mit Moos.
 */
import { GEOMETRIE_KLIPPE, klippenTileset } from './_klippe';

export default klippenTileset({
  gruppe: 'gruen',
  legende: { '0': 'stein.0', '1': 'stein.1', '2': 'stein.2', '3': 'stein.3', '4': 'stein.4', G: 'gras.2', H: 'gras.3', e: 'erde.1', E: 'erde.2', f: 'erde.3' },
  front: [
    `2321233333212323
     2321233333232223
     2321233433231123
     2321233433233413
     2321233433212333
     2221233432212423
     2120233332212423
     3430233332202421
     2320233333202421
     2420233332202321
     2421232221102321
     2421221114312321
     2321114443212321
     232134HG33212321
     2321233333212321
     2323233333212321`,
    `3233321232123332
     3233321232323432
     3233321232323432
     3233321222123432
     3233320212123432
     3233320343123332
     3233320232123322
     1233320242123322
     1222321242023322
     1111221242023332
     13HH111242023332
     123G431232023332
     1234323232123322
     1234323232122211
     1234323232111143
     1233323232134432`,
  ],
  seite: `022344
          023344
          023334
          012334
          022334
          023234
          023234
          013334
          022334
          022344
          012334
          023334
          023234
          022234
          012334
          022334`,
  randNord: `3443443344434434
             2332332233323323
             1_0110_1101_1011`,
  saum: 'gras.2',
  fuss: `................
         ................
         .......1........
         .12...134...12..
         1341.13443101341
         _21G_2332122G_21`,
  kontur: 'stein.0',
  oberkante: 'stein.4',
  lippe: { kante: 'gras.4', ueberhang: 'gras.2', schatten: 'stein.0' },
  rampe: `EEEEEfffffEEEEEE
          EEEEffffffEEEEEE
          EEEEfffeffEEEEEE
          EEEEEffffffEEeEE
          EEeEEfffffEEEeEE
          EEeEEEfffffEEEEE
          EEEEEEffeffEEEEE
          EEEEEEfffffEEEEE
          EEEEEfffffEEEEEE
          EEEEffffffEEEeEE
          EEEEfffeffEEEeEE
          EEeEffffffEEEEEE
          EEeEEfffffEEEEEE
          EEEEEEffffEEEEEE
          EEEEEfffffEEEEEE
          EEEEEfffffEEEEEE`,
  treppe: `4444434444444444
           3333323333332333
           2222212222221222
           1111111111111111
           4444444443444444
           3333333332333333
           2212222221222222
           1111111111111111
           4434444444444434
           3323333333333323
           2212222222222212
           1111111111111111
           4444444344444444
           333G333233333333
           22GG222122222222
           1111111111111111`,
  geometrie: GEOMETRIE_KLIPPE,
  buesche: [0, 0, 0, 1, 2, 0, 0, 0, 1, 0, 0, 2, 1, 0, 0, 0],
});
