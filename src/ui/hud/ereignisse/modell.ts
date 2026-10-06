/**
 * The HUD's world event lines (MASTERPROMPT §10 "Ankündigung … HUD"; docs/SPIEL.md §18 "HUD-Zeile mit Restzeit"; M7-38): one
 * line per announced or running event – an announced one in the register's words with the minutes to its start ("Lumenregen
 * in 12 min"), a running one with its name and the minutes it still lasts. Pure: the component (EreignisZeilen.tsx) feeds it
 * the session's sample.
 */
import { CONTENT } from '../../../content/index';
import type { WorldEventDef } from '../../../content/worldEvents/schema';
import type { WorldEventSample } from '../../../game/samples/orte';
import type { Lang } from '../../../i18n';

/** One line of the HUD. */
export interface EreignisZeile {
  readonly event: string;
  readonly aktiv: boolean;
  readonly name: string;
  readonly minuten: number;
  /** The announcement's text with the minutes filled in (announced events), else null (the component words a running one). */
  readonly ankuendigung: string | null;
}

function eventDef(id: string): WorldEventDef | undefined {
  return CONTENT.collection('worldEvents').find(id) as WorldEventDef | undefined;
}

/** The lines of `sample` in `lang` (empty without an announced or running event). */
export function ereignisZeilen(sample: Readonly<WorldEventSample>, lang: Lang): EreignisZeile[] {
  const out: EreignisZeile[] = [];
  for (let i = 0; i < sample.count; i++) {
    const l = sample.lines[i];
    if (l === undefined) continue;
    const def = eventDef(l.event);
    if (def === undefined) continue;
    const aktiv = l.phase === 'aktiv';
    out.push({
      event: l.event,
      aktiv,
      name: def.name[lang],
      minuten: l.minutes,
      ankuendigung: aktiv ? null : def.ankuendigung.hud[lang].replace('{minuten}', String(l.minutes)),
    });
  }
  return out;
}

/** Whether two line lists show the same (the component re-renders only on a change). */
export function gleicheZeilen(a: readonly EreignisZeile[], b: readonly EreignisZeile[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as EreignisZeile;
    const y = b[i] as EreignisZeile;
    if (x.event !== y.event || x.aktiv !== y.aktiv || x.minuten !== y.minuten || x.name !== y.name) return false;
  }
  return true;
}
