/**
 * The tablet screen's model (MASTERPROMPT §8 "Vermittlung über 60 Erbauer-Tafeln"; docs/SPIEL.md §19 "Erbauer-Tafeln", §30
 * "`tafel` (Tafel lesen) – Öffner `tabletRead`, Content"; M7-46, strand C): what the screen shows of a Builder tablet in the
 * player's language – its number of the sixty, its title, its text in the lines the Builders cut (one sentence a line), and
 * where such tablets lie. Pure – the screen renders it.
 */
import { CONTENT } from '../../../content/index';
import { TABLETS_TOTAL } from '../../../content/dungeons/schema';
import type { Lang } from '../../../i18n';

/** All Builder tablets of the game (§8 "60 Erbauer-Tafeln"; M7 places the first ten). */
export { TABLETS_TOTAL };

export interface TafelSeite {
  readonly id: string;
  readonly nummer: number;
  readonly titel: string;
  /** The text as the tablet's lines: one sentence each. */
  readonly zeilen: readonly string[];
  /** Where the tablet lies: in a vault (null), else the name of its place type. */
  readonly ort: string | null;
}

/** Splits a text after each sentence (., !, ? or … followed by a space) – the lines cut into the stone. */
export function tafelZeilen(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/u)
    .map((z) => z.trim())
    .filter((z) => z.length > 0);
}

/** The page of tablet `id` in `lang`, or null for an unknown tablet. */
export function tafelSeite(id: string, lang: Lang): TafelSeite | null {
  const t = CONTENT.collection('tablets').find(id);
  if (t === undefined) return null;
  const f = t.fundort;
  const ort = f.art === 'gewoelbe' ? null : (CONTENT.collection('locationTypes').find(f.ortstyp)?.name[lang] ?? f.ortstyp);
  return { id: t.id, nummer: t.nummer, titel: t.titel[lang], zeilen: tafelZeilen(t.text[lang]), ort };
}
