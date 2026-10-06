/**
 * The mechanics of strand F in the mechanics register (docs/SPIEL.md §23 "Vermittlungs-Register"; M7-32 … M7-37): each
 * taught by a hint (src/content/guide/leuchtfeuer.ts), a knowledge entry (src/content/wissen/leuchtfeuer.ts) and a tooltip.
 */
import type { MechanicInput } from './schema';

export const MECHANICS_F: readonly MechanicInput[] = [
  { id: 'mech_boss_kampf', paragraph: '§20.2', task: 'M7-32', hinweis: 'funke_boss_erwacht', wissen: 'wissen_bosse', tooltip: { art: 'content', sammlung: 'bosses', id: 'borkenvater' } },
  { id: 'mech_boss_schwachstellen', paragraph: '§20.2', task: 'M7-34', hinweis: 'funke_boss_knoten', wissen: 'wissen_bosse', tooltip: { art: 'content', sammlung: 'bosses', id: 'borkenvater' } },
  { id: 'mech_splitter_herz', paragraph: '§20.2', task: 'M7-32', hinweis: 'hinweis_herzsplitter', wissen: 'wissen_splitter', tooltip: { art: 'content', sammlung: 'items', id: 'herzsplitter' } },
  { id: 'mech_leuchtfeuer_entzuenden', paragraph: '§8', task: 'M7-35', hinweis: 'funke_leuchtfeuer_bereit', wissen: 'wissen_leuchtfeuer', tooltip: { art: 'content', sammlung: 'beacons', id: 'leuchtfeuer_1' } },
  { id: 'mech_leuchtfeuer_schutzzone', paragraph: '§12', task: 'M7-35', hinweis: 'funke_erleuchtet', wissen: 'wissen_leuchtfeuer', tooltip: { art: 'content', sammlung: 'conditions', id: 'erleuchtet' } },
  { id: 'mech_leuchtfeuer_freischaltungen', paragraph: '§23', task: 'M7-36', hinweis: 'funke_leuchtfeuer_entzuendet', wissen: 'wissen_leuchtfeuer', tooltip: { art: 'content', sammlung: 'unlocks', id: 'lf1_lumen_werkbank' } },
  { id: 'mech_licht_lumenlaterne', paragraph: '§12', task: 'M7-36', hinweis: 'hinweis_lumen_laterne', wissen: 'wissen_lumen_laterne', tooltip: { art: 'content', sammlung: 'items', id: 'lumen_laterne' } },
  { id: 'mech_reisen_schnellreise', paragraph: '§25', task: 'M7-37', hinweis: 'hinweis_schnellreise', wissen: 'wissen_schnellreise', tooltip: { art: 'content', sammlung: 'items', id: 'wegstein' } },
];
