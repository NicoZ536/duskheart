/**
 * Böden T0–T1 (M4-12/M4-13, docs/SPIEL.md §8): `bau_boden_holz`, `bau_boden_stein`, `bau_boden_lehm` –
 * Ebene Boden, je 2 Fassungen × 16 Masken (Frame `fassung · 16 + maske`, Kante an offenen Seiten;
 * Vertrag in `_bau.ts`). Beide Fassungen teilen die Lage der Fugen am Tile-Rand, deshalb stoßen sie in
 * jeder Anordnung nahtlos aneinander; innen verschieben sich Stöße, Maserung und Flecken.
 * - **Holz:** Dielen quer mit versetzten Stößen, Maserung und Nagelpaaren an den Stößen.
 * - **Stein:** gesägte Platten in Läufen verschiedener Höhe, versetzte Fugen, einzelne dunklere Platten.
 * - **Lehm:** gestampfter, geglätteter Lehm mit Besenbögen, feinen Trockenrissen und Häckselstroh.
 * Flach und ohne Richtungslicht; die Kante zeigt den Boden als Belag über dem Gelände.
 */
import { bodenSprite } from './_bau';

const holz = bodenSprite({
  id: 'bau_boden_holz',
  stil: { kontur: 'a' },
  fassungen: [
    `ddddddbddddddeed
     dcdddeadddcdddee
     dddddcbddddddcdd
     bbbbbbbbbbbbbbbb
     cccccccccccbcccc
     cdcccccccccacccd
     ccccdcccccbbcccc
     bbbbbbbbbbbbbbbb
     dddbddddddeddddd
     deeaddddcdddddcd
     dddbddcddddddddd
     bbbbbbbbbbbbbbbb
     cccccccccbcccccc
     ccdccccccaccccdc
     cccccdcccbcccccc
     bbbbbbbbbbbbbbbb`,
    `dddddddddddbdddd
     ddeeddddcddadddd
     dddddcdddddbddcd
     bbbbbbbbbbbbbbbb
     ccbcccccccccccdc
     ccacccdccccccccc
     ccbccccccccdcccc
     bbbbbbbbbbbbbbbb
     dddddddddddddbdd
     ddcddddeedddddad
     dddddddddcdddbdd
     bbbbbbbbbbbbbbbb
     ccccccbccccccccc
     cdccccacccccdccc
     ccccccbccccccccc
     bbbbbbbbbbbbbbbb`,
  ],
});

const stein = bodenSprite({
  id: 'bau_boden_stein',
  stil: { kontur: '1' },
  fassungen: [
    `4455442444444244
     4444442444554244
     4434442444444244
     4444442444434244
     4444442444444244
     5444442444444244
     2222222222222222
     4424444444244444
     4424455444244444
     4424444444244434
     4424444334244444
     2222222222222222
     4444424444442444
     4454424444552444
     4444424444442444
     2222222222222222`,
    `4442444444544444
     4452444444444444
     4442444443444444
     4442444444444444
     4442444444444444
     4442444444444444
     2222222222222222
     4444444244444442
     4455444244434442
     4444444244444442
     4444444244444442
     2222222222222222
     4244444442444444
     4244443342444554
     4244444442444444
     2222222222222222`,
  ],
});

const lehm = bodenSprite({
  id: 'bau_boden_lehm',
  stil: { kontur: 'q' },
  fassungen: [
    `CCCCCCDDCCCCCCCC
     CCCBBCCCCCCCCCCC
     CCCCCBBCCCCCCDDC
     CCDDCCCBCCCCCCCC
     CCCCCCCCCCBBCCCC
     CCCCCCCCCCCCBBCC
     CCCCEECCCCCCCCBC
     CCCCCCCCCCCCCCCC
     CBBCCCCCCCDDCCCC
     CCCBBCCCCCCCCCCC
     CCCCCBCCCCCCCCCC
     CCCCCCCCCCCCACCC
     CCDDCCCCCCCCCACC
     CCCCCCCCCBBCCCCC
     CCCCCCCCCCCBBCCC
     CCCCCCCCCCCCCCCC`,
    `CCCCCCCCCCCCCCCC
     CCCCCCCCBBCCCCCC
     CCDDCCCCCCBBCCCC
     CCCCCCCCCCCCBCCC
     CCCCCCACCCCCCCCC
     CCCCCCCACCCCCDDC
     CBBCCCCCCCCCCCCC
     CCCBBCCCCCCCCCCC
     CCCCCBBCCCCCCCCC
     CCCCCCCCCCEECCCC
     CCCCCCCCCCCCCCCC
     CCCCDDCCCCCCBBCC
     CCCCCCCCCCBBCCCC
     CCCCCCCCCBCCCCCC
     CCBBCCCCCCCCCCCC
     CCCCBBCCCCCCCCCC`,
  ],
});

export default [holz, stein, lehm];
