/**
 * Validator-Regel `ereignisse` (M7-38; tools/validator/ereignisse.ts) mit Fixtures: ein Register mit allen elf Ereignissen aus
 * §10 – eines umgesetzt mit HUD-Zeile, Funke-Hinweis und Chronik-Regel, die übrigen mit offenem Task – besteht. Ein fehlendes
 * oder fremdes Ereignis, ein umgesetztes ohne HUD-Text EN, ohne Restzeit, ohne Funke-Hinweis (oder einer auf dem falschen
 * Kanal, vom falschen Ereignis ausgelöst), ohne Chronik-Text EN oder ohne Chronik-Regel und ein nicht umgesetztes mit
 * erledigtem oder unbekanntem Task sind Fehler. Der echte Content besteht.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTENT } from '../../../src/content/index';
import { ContentRegistry, type ContentRegistryView } from '../../../src/content/registry';
import { idSchema } from '../../../src/content/schema/common';
import { checkWorldEvents, SECTION_10_EVENTS } from '../../../tools/validator/ereignisse';

const loose = z.object({ id: idSchema }).passthrough();
const PROGRESS = ['- [ ] M8-37 Ereignisse', '- [x] M7-01 erledigt'].join('\n');

interface Probe {
  /** Overrides of the implemented event `lumenregen`. */
  event?: Record<string, unknown>;
  /** Overrides of its Funke hint, or null for none. */
  hint?: Record<string, unknown> | null;
  /** Overrides of its chronicle rule, or null for none. */
  rule?: Record<string, unknown> | null;
  /** Register ids (default: §10's eleven). */
  ids?: readonly string[];
  /** The task of the events not implemented. */
  task?: string;
}

function registry(p: Probe = {}): ContentRegistryView {
  const events = (p.ids ?? SECTION_10_EVENTS).map((id) =>
    id === 'lumenregen'
      ? {
          id,
          ankuendigung: { vorlaufMinuten: 20, hud: { de: 'Lumenregen in {minuten} min', en: 'Lumen rain in {minuten} min' }, funke: 'funke_ereignis_lumenregen' },
          chronik: { de: 'Lumenregen.', en: 'Lumen rain.' },
          umgesetzt: true,
          ...p.event,
        }
      : { id, ankuendigung: { vorlaufMinuten: 20, hud: { de: '{minuten}', en: '{minuten}' }, funke: `funke_ereignis_${id}` }, chronik: { de: 'x', en: 'x' }, umgesetzt: { task: p.task ?? 'M8-37' } },
  );
  const hints =
    p.hint === null
      ? []
      : [{ id: 'funke_ereignis_lumenregen', kanal: 'funke', text: { de: 'Sterne!', en: 'Stars!' }, ausloeser: { art: 'ereignis', ereignis: 'worldEventAnnounced', wo: { event: 'lumenregen' } }, ...p.hint }];
  const rules =
    p.rule === null ? [] : [{ id: 'chronik_ereignis_lumenregen', ereignis: 'worldEventStarted', wo: { event: 'lumenregen' }, art: 'welt', text: { de: 'Lumenregen.', en: 'Lumen rain.' }, ...p.rule }];
  return new ContentRegistry().defineCollection('worldEvents', loose, events).defineCollection('guideHints', loose, hints).defineCollection('chronicleRules', loose, rules);
}

function errors(p: Probe = {}): string[] {
  return checkWorldEvents(registry(p), PROGRESS).errors;
}

describe('validator rule ereignisse', () => {
  it('passes a register with all eleven events, the implemented one announced and chronicled', () => {
    expect(errors()).toEqual([]);
  });

  it('wants every event of §10 and no other', () => {
    expect(errors({ ids: SECTION_10_EVENTS.filter((id) => id !== 'lawine') })).toEqual(['Ereignis lawine (§10) fehlt im Register worldEvents']);
    expect(errors({ ids: [...SECTION_10_EVENTS, 'kometensturm'] })).toEqual([expect.stringContaining('Ereignis kometensturm: steht nicht in §10')]);
  });

  it('an implemented event without its announcement is an error', () => {
    expect(errors({ event: { ankuendigung: { vorlaufMinuten: 20, hud: { de: 'Lumenregen in {minuten} min', en: '' }, funke: 'funke_ereignis_lumenregen' } } })).toEqual([
      'Ereignis lumenregen: Ankündigung ohne HUD-Text EN',
    ]);
    expect(errors({ event: { ankuendigung: { vorlaufMinuten: 20, hud: { de: 'Lumenregen bald', en: 'Lumen rain in {minuten} min' }, funke: 'funke_ereignis_lumenregen' } } })).toEqual([
      'Ereignis lumenregen: HUD-Text DE nennt die Restzeit nicht ({minuten})',
    ]);
    expect(errors({ hint: null })).toEqual([expect.stringContaining('Funke-Hinweis funke_ereignis_lumenregen der Ankündigung fehlt')]);
    expect(errors({ hint: { kanal: 'hinweis' } })).toEqual([expect.stringContaining('nicht auf dem Funke-Kanal')]);
    expect(errors({ hint: { ausloeser: { art: 'ereignis', ereignis: 'worldEventAnnounced', wo: { event: 'finstermond' } } } })).toEqual([
      expect.stringContaining('nicht von worldEventAnnounced mit event = lumenregen ausgelöst'),
    ]);
    expect(errors({ hint: { text: { de: 'Sterne!', en: ' ' } } })).toEqual([expect.stringContaining('ohne Text EN')]);
  });

  it('an implemented event without its chronicle entry is an error', () => {
    expect(errors({ event: { chronik: { de: 'Lumenregen.', en: '' } } })).toEqual(['Ereignis lumenregen: Chronik-Text EN fehlt']);
    expect(errors({ rule: null })).toEqual([expect.stringContaining('keine Chronik-Regel auf worldEventStarted mit event = lumenregen')]);
    expect(errors({ rule: { wo: { event: 'waldbrand' } } })).toEqual([expect.stringContaining('keine Chronik-Regel')]);
    expect(errors({ rule: { ereignis: 'worldEventAnnounced' } })).toEqual([expect.stringContaining('keine Chronik-Regel')]);
  });

  it('an event not yet implemented names a task that is still open in PROGRESS.md', () => {
    // Ten events with the done task: ten errors.
    expect(errors({ task: 'M7-01' })).toHaveLength(10);
    expect(errors({ task: 'M7-01' })[0]).toContain('Task M7-01 ist erledigt, das Ereignis aber nicht umgesetzt');
    expect(errors({ task: 'M99-1' })[0]).toContain('Task M99-1, der es umsetzt, fehlt in PROGRESS.md');
  });

  it('the real register passes: eleven events, four of them implemented in M7', () => {
    const result = checkWorldEvents(CONTENT, readFileSync('PROGRESS.md', 'utf8'));
    expect(result.errors).toEqual([]);
    const events = CONTENT.collection('worldEvents').values() as unknown as { id: string; umgesetzt: unknown }[];
    expect(events.map((e) => e.id).sort()).toEqual([...SECTION_10_EVENTS].sort());
    expect(events.filter((e) => e.umgesetzt === true).map((e) => e.id)).toEqual(['finstermond', 'lumenregen', 'sonnenfinsternis', 'waldbrand']);
  });
});
