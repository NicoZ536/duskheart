/**
 * Farbvarianten der Möbel (MASTERPROMPT §5 „Möbel-Farbvarianten“, M1-08 `farbVarianten`): dieselbe Zeichnung
 * mit getauschter Rampe, zur Wahl im Baumodus (`MOEBEL_FARBVARIANTEN` in src/content/items/moebel.ts). Sie
 * zählen nicht als eigene Möbel (§C) – ein Holzbett bleibt ein Holzbett, ob die Decke rot oder blau ist.
 * - Stoff (`laub` = Rot) → Grün, Blau, Violett, Ocker: Decke des Holzbetts, Sitzkissen, Wandfahne.
 * - Holz (`holz` = Eiche) → Nussbaum (`erde`), Birke (`sand`): Holztisch und Holzstuhl.
 */
import { farbVarianten, HOLZ_VARIANTEN, STOFF_VARIANTEN } from '../../lib/recolor';
import type { Sprite } from '../../lib/sprite';
import betten from './betten';
import sitzmoebel from './sitzmoebel';
import tische from './tische';
import wand from './wand';

function basis(liste: readonly Sprite[], id: string): Sprite {
  const s = liste.find((x) => x.id === id);
  if (s === undefined) throw new Error(`Farbvariante: Grundsprite ${id} fehlt`);
  return s;
}

/** Stoffvarianten ohne das gezeichnete Rot. */
const STOFFE = STOFF_VARIANTEN.filter((v) => v.id !== 'rot' && v.id !== 'grau');
/** Holzvarianten ohne die gezeichnete Eiche. */
const HOELZER = HOLZ_VARIANTEN.filter((v) => v.id !== 'eiche');

export default [
  ...farbVarianten(basis(betten, 'obj_holzbett'), STOFFE),
  ...farbVarianten(basis(sitzmoebel, 'obj_sitzkissen'), STOFFE),
  ...farbVarianten(basis(wand, 'obj_fahne_wand'), STOFFE),
  ...farbVarianten(basis(tische, 'obj_tisch_holz'), HOELZER),
  ...farbVarianten(basis(sitzmoebel, 'obj_stuhl_holz'), HOELZER),
];
