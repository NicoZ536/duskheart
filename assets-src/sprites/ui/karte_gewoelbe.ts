/**
 * Kartensymbol des Ortstyps Gewölbe `karte_ort_gewoelbe` (M7-11, Strang C; docs/SPIEL.md §18 "Kartensymbol", §19): ein
 * Erbauer-Torbogen aus behauenem Stein (Licht links `stein.4`/`stein.3`, Schatten rechts `stein.2`/`stein.1`) über einer
 * Schwelle, dahinter das Dunkel des Abgangs (`nacht.0`) mit den ersten zwei Stufen – lesbar auf Pergament, im Nebel und auf
 * der Minimap wie die übrigen Ortssymbole (karte_orte.ts). Motiv mittig um [7, 7], Kontur `nacht.1`.
 */
import { uiSymbol } from './_ui';

export default [
  uiSymbol('karte_ort_gewoelbe', [
    `................
     .....kkkkkk.....
     ...kk554433kk...
     ..k554kkkk332k..
     ..k54kKKKKk32k..
     ..k4kKKKKKKk2k..
     ..k4kKKKKKKk2k..
     ..k4kKKKKKKk2k..
     ..k4kK3333Kk2k..
     ..k4k443322k2k..
     .kkkkkkkkkkkkkk.
     .k554444333222k.
     .kkkkkkkkkkkkkk.
     ................
     ................
     ................`,
  ]),
];
