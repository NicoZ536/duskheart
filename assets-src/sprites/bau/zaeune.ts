/**
 * Zäune T0–T1 (M4-12/M4-13, docs/SPIEL.md §8): `bau_zaun_holz`, `bau_zaun_stein` – Frames = Nachbarmaske
 * (Vertrag in `_bau.ts`), verbinden mit Zäunen und Toren.
 * - **Holz:** Pfosten mit schrägem, hellem Kopf in der Tile-Mitte, zwei gespaltene Riegel (10 und 5 px
 *   über Grund) zu den verbundenen Seiten; Nord-Süd-Läufe zeigen die Riegel von oben als Linie.
 * - **Stein:** Trockenmauer aus runden Feldsteinen, 8 px hoch, dunkle offene Fugen, Moos auf der Krone.
 */
import { wandSprite, zaunSprite } from './_bau';

const holz = zaunSprite({
  id: 'bau_zaun_holz',
  stil: { kontur: 'a' },
  pfosten: `.ee.
            deed
            bddc
            bcdc
            bcdb
            bcdc
            bddc
            bcdc
            bcdc
            bccb
            bcdc
            bcdc
            qccq`,
  riegelQuer: `................
               ................
               dddddeddddddeddd
               bbcbbbbbcbbbbbcb
               ................
               ................
               ................
               dddeddddddeddddd
               bbbbcbbbbbbcbbbb`,
  riegelLaengs: `dc
                 dc
                 dd
                 cd
                 dc
                 dc
                 cc
                 dc
                 dd
                 dc
                 cd
                 dc
                 dc
                 dd
                 dc
                 cc`,
});

const stein = wandSprite({
  id: 'bau_zaun_stein',
  stil: { kontur: '1' },
  hoehe: 8,
  muster: {
    kappeQuer: `1111111111111111
                4555514555ii1455
                4455515555ii1555
                3444513445521445
                2333312334421344
                1222211222211223`,
    kappeLaengs: `145551
                  155551
                  145541
                  133331
                  121121
                  145ii1
                  15ii51
                  144441
                  133331
                  112211
                  145551
                  155551
                  145541
                  133431
                  123321
                  112211`,
    knoten: `115511
             155661
             1ii551
             145541
             133331
             112211`,
    front: [
      `5541455514555145
       4431444413444134
       3321333312333123
       1111222111122211
       4551455514455514
       4441444413444413
       3331333312333312
       2211222211122211`,
    ],
    pfosten: `145541
              144441
              133331
              112211
              455541
              444431
              333321
              122211`,
  },
});

export default [holz, stein];
