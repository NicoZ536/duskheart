/**
 * M2-14/M2-GATE: the title card's loading line – the running step of the session world's generation
 * while it runs (DE/EN), the reason if it failed (it stays), nothing once the world is ready.
 */
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { createI18n } from '../../../src/i18n';
import { createWorldLoadingStatus } from '../../../src/ui';
import { TitleCard, worldLoadingText } from '../../../src/ui/TitleCard';

type Props = Record<string, unknown> & { children?: unknown };

function children(node: unknown): unknown[] {
  const c = (node as VNode<Props>).props.children;
  return (Array.isArray(c) ? c : [c]).filter((x) => x !== null && x !== undefined && x !== false);
}

describe('Titelzeile: Ladezeile der Weltgenerierung', () => {
  it('nennt den laufenden Schritt, nach dem Fehlschlag den Grund, und verschwindet, wenn die Welt steht', () => {
    const status = createWorldLoadingStatus();
    expect(status.view.value).toBeNull();
    status.step('untergrund', 5, 8);
    expect(status.view.value).toEqual({ kind: 'step', step: 'untergrund', index: 5, count: 8 });
    const de = createI18n('de', { strict: true });
    const en = createI18n('en', { strict: true });
    const step = status.view.value;
    if (step === null) throw new Error('no step');
    expect(worldLoadingText(de, step)).toBe('Welt wird erschaffen … Höhlen und Schächte (6/8)');
    expect(worldLoadingText(en, step)).toMatch(/\(6\/8\)$/);
    status.fail('Failed to fetch module script');
    const failed = status.view.value;
    if (failed === null) throw new Error('no failure');
    expect(worldLoadingText(de, failed)).toBe('Die Welt konnte nicht erschaffen werden: Failed to fetch module script');
    expect(worldLoadingText(en, failed)).toBe('The world could not be created: Failed to fetch module script');
    status.done();
    expect(status.view.value).toBeNull();
  });

  it('zeigt die Zeile nur während der Erzeugung, den Fehler als Warnung (role alert)', () => {
    const i18n = createI18n('de', { strict: true });
    expect(children(TitleCard({ i18n }))).toHaveLength(2);
    const running = children(TitleCard({ i18n, loading: { kind: 'step', step: 'weltplan', index: 0, count: 8 } }));
    expect(running).toHaveLength(3);
    expect((running[2] as VNode<Props>).props).toMatchObject({ class: 'dh-loading', role: 'status', 'data-testid': 'ui-world-loading' });
    const failed = children(TitleCard({ i18n, loading: { kind: 'failed', error: 'x' } }));
    expect((failed[2] as VNode<Props>).props).toMatchObject({ class: 'dh-loading dh-loading--fehler', role: 'alert' });
    expect(children(failed[2])).toEqual(['Die Welt konnte nicht erschaffen werden: x']);
  });
});
