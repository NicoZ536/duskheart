/**
 * The perk choice's model (MASTERPROMPT §23.2 "Bei 30/60/90 Wahl zwischen 2 Perks"; docs/SPIEL.md §30 "`perkwahl` –
 * `perkChoiceOpened` – sampleSkills"; M7-48): the first open choice of the skills (skill order, then level) with its two perks
 * – name and what they do – and how many more choices wait. Pure; the screen (PerkwahlScreen.tsx) feeds it the session's sample.
 */
import { CONTENT } from '../../../content/index';
import type { PerkDef } from '../../../content/perks';
import type { SkillsSample } from '../../../game/samples/chronik';
import type { Lang } from '../../../i18n';

/** One of the two perks of a choice. */
export interface PerkKarte {
  readonly wahl: number;
  readonly id: string;
  readonly name: string;
  readonly beschreibung: string;
}

/** What the perk choice shows. */
export interface PerkwahlAnsicht {
  readonly fertigkeit: string;
  readonly fertigkeitName: string;
  readonly stufe: number;
  readonly karten: readonly PerkKarte[];
  /** Open choices besides this one. */
  readonly weitere: number;
}

/** The perks of `skill` at `level` in choice order. */
export function perksDerWahl(skill: string, level: number, perks: readonly PerkDef[] = CONTENT.collection('perks').values()): PerkDef[] {
  return perks.filter((p) => p.fertigkeit === skill && p.stufe === level).sort((a, b) => a.wahl - b.wahl);
}

/** Key of the choice of `skill` at `level` (the screen's set of choices already sent). */
export function wahlSchluessel(skill: string, level: number): string {
  return `${skill}:${level}`;
}

/**
 * The first open choice of `sample` that has perks, in `lang`; `null` when none waits. `gesendet` holds the choices taken on
 * this screen: the screen pauses the game, so their commands apply only when it closes – until then they count as taken.
 */
export function perkwahlAnsicht(
  sample: Readonly<SkillsSample>,
  lang: Lang,
  perks: readonly PerkDef[] = CONTENT.collection('perks').values(),
  gesendet: ReadonlySet<string> = new Set(),
): PerkwahlAnsicht | null {
  const offen = sample.open.filter((o) => !gesendet.has(wahlSchluessel(o.skill, o.level)) && perksDerWahl(o.skill, o.level, perks).length > 0);
  const erste = offen[0];
  if (erste === undefined) return null;
  const skill = CONTENT.collection('skills').find(erste.skill);
  return {
    fertigkeit: erste.skill,
    fertigkeitName: skill?.name[lang] ?? erste.skill,
    stufe: erste.level,
    karten: perksDerWahl(erste.skill, erste.level, perks).map((p) => ({ wahl: p.wahl, id: p.id, name: p.name[lang], beschreibung: p.beschreibung[lang] })),
    weitere: offen.length - 1,
  };
}
