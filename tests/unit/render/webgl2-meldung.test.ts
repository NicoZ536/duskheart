/**
 * M0-11: Fehlt WebGL2, liefert `createGlContext` ein Ergebnis statt einer Ausnahme, und
 * `NoWebGl2` erklärt auf Deutsch und Englisch, was los ist und wie man es behebt.
 * Browserbeleg: tests/e2e/webgl2-fehlt.spec.ts.
 */
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { createI18n, type Lang } from '../../../src/i18n/index';
import { createGlContext, type GlCanvas } from '../../../src/render/gl/context';
import { NoWebGl2 } from '../../../src/ui/NoWebGl2';

/** All text inside a rendered VNode tree (function components are not expected here). */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  const v = node as VNode<{ children?: unknown }>;
  return textOf(v.props.children);
}

function findAll(node: unknown, tag: string): Array<VNode<Record<string, unknown>>> {
  if (node === null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((n) => findAll(n, tag));
  const v = node as VNode<Record<string, unknown>>;
  return [...(v.type === tag ? [v] : []), ...findAll(v.props['children'], tag)];
}

describe('fehlender WebGL2-Kontext', () => {
  it('createGlContext meldet ihn, statt abzustürzen', () => {
    const none: GlCanvas = { getContext: () => null };
    expect(createGlContext(none)).toEqual({ ok: false, reason: 'no-webgl2' });
    const throwing: GlCanvas = {
      getContext: () => {
        throw new Error('GPU process unavailable');
      },
    };
    expect(createGlContext(throwing)).toEqual({ ok: false, reason: 'no-webgl2' });
  });

  it.each([
    ['de', 'WebGL2 ist nicht verfügbar', /Hardwarebeschleunigung/, 'Erneut versuchen'],
    ['en', 'WebGL2 is not available', /hardware acceleration/, 'Try again'],
  ] as const)('NoWebGl2 erklärt das Problem verständlich (%s)', (lang: Lang, title, hint, retry) => {
    const i18n = createI18n(lang, { strict: true });
    const vnode = NoWebGl2({ i18n }) as VNode<Record<string, unknown>>;
    expect(vnode.props['role']).toBe('alert');
    expect(vnode.props['data-testid']).toBe('no-webgl2');
    const [h1] = findAll(vnode, 'h1');
    expect(textOf(h1)).toBe(title);
    const text = textOf(vnode);
    expect(text).toContain(i18n.t('ui.error.webgl2.body'));
    expect(text).toMatch(hint);
    const [button] = findAll(vnode, 'button');
    expect(textOf(button)).toBe(retry);
    expect(typeof button?.props['onClick']).toBe('function');
    expect(i18n.missingKeys()).toEqual([]);
  });

  it('beide Sprachen haben alle Texte der Meldung', () => {
    for (const key of ['ui.error.webgl2.title', 'ui.error.webgl2.body', 'ui.error.webgl2.hint', 'ui.error.webgl2.retry']) {
      const de = createI18n('de', { strict: true }).t(key);
      const en = createI18n('en', { strict: true }).t(key);
      expect(de.length, key).toBeGreaterThan(5);
      expect(en, key).not.toBe(de);
    }
  });
});
