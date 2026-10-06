/**
 * Item-Icons der Orte (M7-09; docs/SPIEL.md §18 "krater"): `icon_sternenerz` – ein Brocken schwarzvioletten Meteorgesteins
 * mit eingesprengten, eisblauen Sternsplittern (das Erz aus dem Meteoritenkrater, Stufe 2). Licht von oben, Kontur `nacht.1`.
 */
import { icon } from './_icon';

export default [
  icon(
    'sternenerz',
    `................
     ................
     ......kkkk......
     ....kkN~NNkk....
     ...kN~#NNNNnk...
     ..kNN#0#NN~Nnk..
     ..kNNN#NNN#Nnk..
     .knNNNNnn#0#nnk.
     .knnNNnnnn#nnnk.
     .kn#nnnnNnnnnKk.
     .kn0#nnnn#nnKKk.
     ..kn#nnn#0#KKk..
     ...kKnnnn#KKk...
     ....kkkkkkkk....
     ................
     ................`,
    { einzelpixel: 'Sternsplitter als einzelne Glanzpunkte im dunklen Gestein' },
  ),
];
