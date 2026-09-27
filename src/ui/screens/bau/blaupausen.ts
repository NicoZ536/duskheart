/**
 * What the blueprints in view still need, as the build mode's status line says it (MASTERPROMPT §16.6
 * "Blaupausen: Pläne ohne Material platzieren; mit Hammer … fertigstellen, Material kommt aus Kisten im Umkreis";
 * §26 "Fehlermeldungen sagen, was fehlt und wie man es löst"; M4-24), unit tested in
 * tests/unit/ui/bau-blaupausen.test.ts:
 *
 * - **Area** (`blaupausenBereich`): half the view around the player in tiles – the internal image of the render
 *   viewport (270 px high, 360–640 px wide by the window's aspect, §4.2) over 16-px tiles, rounded up.
 * - **Line** (`blaupausenZeile`): nothing without blueprints; "Blaupausen brauchen noch: 4× Holzwand, 2× Strohdach"
 *   while pieces are missing (the parts with the most missing first, at most `NAMEN_MAX` names, then "+n"), else
 *   that everything is at hand and the hammer finishes them.
 */
import { TILE_PX } from '../../../world/model/coords';
import type { I18n } from '../../../i18n';
import { computeViewport } from '../../../render/viewport';

/** Most parts named in the line before "+n" (the line is at most 170 design px wide). */
export const NAMEN_MAX = 3;

/** What one part's blueprints need (a record of the session's `BlueprintNeedsSample`). */
export interface BlaupausenBedarf {
  readonly part: string;
  readonly blueprints: number;
  readonly atHand: number;
  readonly missing: number;
}

/** Half extents of the view around the player [tiles] for a window of `breite` × `hoehe` CSS px. */
export function blaupausenBereich(breite: number, hoehe: number): { readonly halbB: number; readonly halbH: number } {
  const v = computeViewport(breite, hoehe, 'sharp');
  return { halbB: Math.ceil(v.internalWidth / 2 / TILE_PX), halbH: Math.ceil(v.internalHeight / 2 / TILE_PX) };
}

/** The status line of the blueprints in view, or `null` when there are none. */
export function blaupausenZeile(i18n: I18n, bedarf: readonly BlaupausenBedarf[], name: (part: string) => string): { readonly text: string; readonly fehlt: boolean } | null {
  const plaene = bedarf.reduce((n, b) => n + b.blueprints, 0);
  if (plaene === 0) return null;
  const fehlt = bedarf.filter((b) => b.missing > 0).sort((a, b) => b.missing - a.missing || (a.part < b.part ? -1 : a.part > b.part ? 1 : 0));
  if (fehlt.length === 0) return { text: i18n.t('ui.bau.blaupausen.bereit', { count: plaene }), fehlt: false };
  const teile = fehlt.slice(0, NAMEN_MAX).map((b) => i18n.t('ui.bau.zutat', { anzahl: b.missing, name: name(b.part) }));
  const liste = fehlt.length > NAMEN_MAX ? i18n.t('ui.bau.blaupausen.mehr', { liste: teile.join(', '), anzahl: fehlt.length - NAMEN_MAX }) : teile.join(', ');
  return { text: i18n.t('ui.bau.blaupausen.brauchen', { liste }), fehlt: true };
}
