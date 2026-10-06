/**
 * M6-46: docs/SPIEL.md nennt die kanonischen IDs, an die sich parallele Stränge halten (§8 M4, §14 M6) – die Listen
 * dort stimmen mit dem Content überein: alle Stationen samt denen der Rüstkammer (`webstuhl`, `schneidertisch`,
 * `gerbrahmen`), die drei Rüstungssets mit ihren Teilen und Boni, die Figuren-Layer mit `fuesse`, die Kreaturen und der
 * Trophäenschmuck. Ändert sich der Content, schlägt der Test an, bis die Doku nachgeführt ist.
 *
 * Nach Meilensteinen (M7-01, ADR-0208): §8 und §14 sind der Stand bis M6 und bleiben genau –
 * genau 15 Stationen und 22 Kreaturen, jede im Content –; was danach dazukommt, muss in §29 (kanonische IDs M7) stehen
 * („Content ⊆ Doku“). Dass jede in §29 genannte Station und Kreatur auch im Content ist, schaltet der Integrator am M7-Gate
 * scharf.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../../../src/content/index';
import { FIGURE_LAYERS, ITEM_GROUPS } from '../../../src/content/items/index';
import { RUESTUNGSSETS, type ArmorSetDef } from '../../../src/content/ruestungssets';
import type { ItemStat } from '../../../src/content/schema/item';
import { M7_IDS } from './stand';

const DOC = readFileSync(join(process.cwd(), 'docs/SPIEL.md'), 'utf8');

/** The text of section `n` ("## n. …" up to the next "## "). */
function section(n: number): string {
  const start = DOC.indexOf(`\n## ${n}. `);
  if (start < 0) throw new Error(`docs/SPIEL.md: Abschnitt ${n} fehlt`);
  const end = DOC.indexOf('\n## ', start + 1);
  return DOC.slice(start, end < 0 ? undefined : end);
}

/** The bullet of `text` that starts with `- **<title>`. */
function bullet(text: string, title: string): string {
  const line = text.split('\n').find((l) => l.startsWith(`- **${title}`));
  if (line === undefined) throw new Error(`docs/SPIEL.md: Punkt „${title}“ fehlt`);
  return line;
}

/** The backticked words of `text`, in order. */
function ids(text: string): string[] {
  return [...text.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1] as string);
}

/** How the doc writes a set bonus's stats (German labels, percent for the tempo). */
const STAT_TEXT: Partial<Record<ItemStat, (v: number) => string>> = {
  maxAusdauer: (v) => `+${v} max. Ausdauer`,
  maxLeben: (v) => `+${v} max. Leben`,
  ruestung: (v) => `+${v} Rüstung`,
  isolation: (v) => `+${v} Isolation`,
  tempo: (v) => `+${Math.round(v * 100)} % Tempo`,
};

/** The doc's text of the bonuses of `set`: "`leder` 2: +2 Isolation · 4: +2 Rüstung, +15 max. Ausdauer". */
function bonusText(set: ArmorSetDef): string {
  const boni = set.boni.map((b) => {
    const werte = Object.entries(b.werte).map(([stat, v]) => {
      const f = STAT_TEXT[stat as ItemStat];
      if (f === undefined) throw new Error(`Statistik ${stat} ohne Doku-Text`);
      return f(v as number);
    });
    return `${b.teile}: ${werte.join(', ')}`;
  });
  return `\`${set.id}\` ${boni.join(' · ')}`;
}

describe('docs/SPIEL.md §8/§14 stimmen mit dem Content (M6-46)', () => {
  it('§8 nennt genau die 15 Stationen bis M6, auch die der Rüstkammer, jede im Content; jede spätere steht in §29', () => {
    const s8 = section(8);
    const stations = [...CONTENT.collection('stations').values()].map((s) => s.id);
    const fields = new Set([...CONTENT.collection('stations').values()].flatMap((s) => Object.keys(s)));
    const named = s8
      .split('\n')
      .filter((l) => l.startsWith('- **Stationen'))
      .flatMap((l) => ids(l))
      // What the stations make (items) and the fields of their records (`stufe`) are named with them; anything else must
      // be a station.
      .filter((id) => CONTENT.has('stations', id) || (!CONTENT.has('items', id) && !fields.has(id)));
    // The M6 list exactly: 15 stations, none lost, renamed or unknown.
    expect(new Set(named).size).toBe(15);
    expect(named.filter((id) => !CONTENT.has('stations', id))).toEqual([]);
    expect(named).toEqual(expect.arrayContaining(['webstuhl', 'schneidertisch', 'gerbrahmen']));
    // Every station beyond it is a canonical id of M7 (Content ⊆ Doku §29).
    expect(stations.filter((id) => !named.includes(id) && !M7_IDS.has(id))).toEqual([]);
  });

  it('§14 nennt die Stationen der Rüstkammer wie ihre Itemgruppe', () => {
    const line = bullet(section(14), 'Stationen:');
    expect(ids(line)).toEqual(ITEM_GROUPS.ruestung_stationen.map((i) => i.id));
  });

  it('§14: drei Rüstungssets mit ihren Teilen in Platzreihenfolge und ihren Boni', () => {
    const line = bullet(section(14), 'Rüstung');
    const sets = [...line.matchAll(/Set `([a-z_]+)` \(([^;)]*)/g)].map((m) => ({ id: m[1] as string, teile: ids(m[2] as string) }));
    expect(sets.map((s) => s.id).sort()).toEqual(RUESTUNGSSETS.map((s) => s.id).sort());
    expect(sets).toHaveLength(3);
    for (const set of RUESTUNGSSETS) {
      expect(sets.find((s) => s.id === set.id)?.teile, set.id).toEqual(set.teile);
      expect(line, set.id).toContain(bonusText(set));
    }
  });

  it('§14: die Figuren-Layer mit `fuesse`', () => {
    const line = bullet(section(14), 'Figuren-Layer');
    const listed = ids(line.slice(line.indexOf('):') + 2, line.indexOf(' – ')));
    expect(listed).toEqual([...FIGURE_LAYERS]);
    expect(listed).toContain('fuesse');
  });

  it('§14: die 22 Kreaturen bis M6, jede im Content; jede spätere steht in §29', () => {
    const line = bullet(section(14), 'Kreaturen');
    const creatures = [...CONTENT.collection('creatures').values()].map((c) => c.id);
    const named = ids(line);
    // The M6 list exactly: 22 creatures, none lost, renamed or unknown, and the doc's count says so.
    expect(new Set(named).size).toBe(22);
    expect(named.filter((id) => !CONTENT.has('creatures', id))).toEqual([]);
    expect(line).toContain(`(${new Set(named).size})`);
    // Every creature beyond it is a canonical id of M7 (Content ⊆ Doku §29).
    expect(creatures.filter((id) => !named.includes(id) && !M7_IDS.has(id))).toEqual([]);
  });

  it('§14: die Sonderteile von Wolf und Keiler und ihr Schmuck gibt es im Content', () => {
    const line = bullet(section(14), 'Jagdgüter');
    for (const id of ['wolfszahn', 'keilerhauer', 'wolfszahnkette', 'haueramulett']) {
      expect(ids(line), id).toContain(id);
      expect(CONTENT.has('items', id), id).toBe(true);
    }
  });
});
