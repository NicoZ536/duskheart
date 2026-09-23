/** Debug-Statistik und F3-Overlay: Signale, §30-Budgetgrenzen, Bildzeitmittel, Formatierung, Stylesheet. */
import { describe, expect, it } from 'vitest';
import { commonPrefix, stripToggleChars } from '../../../src/debug/consoleView';
import { formatStat } from '../../../src/debug/overlay';
import {
  FrameMeter,
  createDebugStats,
  isOverBudget,
  snapshotDebugStats,
  updateDebugStats,
} from '../../../src/debug/stats';
import { DEBUG_CSS, DEBUG_STYLE_ID, injectDebugStyles, type StyleHost } from '../../../src/debug/styles';
import { createI18n } from '../../../src/i18n/index';

describe('stats & overlay helpers', () => {
  it('updates signals in a batch and snapshots them', () => {
    const stats = createDebugStats();
    let renders = 0;
    const stop = stats.fps.subscribe(() => renders++);
    updateDebugStats(stats, { fps: 58, drawCalls: 120, heapMb: 210.5 });
    expect(snapshotDebugStats(stats)).toMatchObject({ fps: 58, drawCalls: 120, heapMb: 210.5, sprites: 0 });
    stop();
    expect(renders).toBe(2);
    expect(stats.visible.value).toBe(false);
  });

  it('flags values outside the §30 budgets', () => {
    expect(isOverBudget('fps', 59)).toBe(true);
    expect(isOverBudget('fps', 60)).toBe(false);
    expect(isOverBudget('simMs', 3.2)).toBe(true);
    expect(isOverBudget('drawCalls', 150)).toBe(false);
    expect(isOverBudget('heapMb', null)).toBe(false);
    expect(isOverBudget('entities', 1e9)).toBe(false);
  });

  it('frame meter averages over a rolling window', () => {
    const m = new FrameMeter(4);
    expect(m.fps).toBe(0);
    for (const ms of [10, 20, 30, 40]) m.push(ms);
    expect(m.averageMs).toBe(25);
    expect(m.worstMs).toBe(40);
    m.push(40);
    expect(m.averageMs).toBe(32.5);
    m.push(Number.NaN);
    expect(m.averageMs).toBe(32.5);
    expect(m.fps).toBeCloseTo(1000 / 32.5);
    m.reset();
    expect(m.averageMs).toBe(0);
  });

  it('formats overlay values per language', () => {
    const de = createI18n('de');
    expect(formatStat('simMs', 1.234, 'de', de.t)).toBe('1,23 ms');
    expect(formatStat('heapMb', 123.45, 'de', de.t)).toBe('123,5 MB');
    expect(formatStat('sprites', 6000, 'de', de.t)).toBe('6.000');
    expect(formatStat('heapMb', null, 'de', de.t)).toBe('n. v.');
    const en = createI18n('en');
    expect(formatStat('frameMs', 16.6667, 'en', en.t)).toBe('16.67 ms');
  });

  it('console view helpers', () => {
    expect(commonPrefix(['season spring', 'season summer'])).toBe('season s');
    expect(commonPrefix([])).toBe('');
    expect(stripToggleChars('^', '')).toBe('');
    expect(stripToggleChars('^give', '')).toBe('give');
    expect(stripToggleChars('say ^', 'say ')).toBe('say ^');
  });

  it('injects the stylesheet once', () => {
    const appended: unknown[] = [];
    const ids = new Set<string>();
    const doc: StyleHost = {
      getElementById: (id) => (ids.has(id) ? {} : null),
      createElement: () => ({ id: '', textContent: null }),
      head: {
        appendChild: (node) => {
          appended.push(node);
          ids.add((node as { id: string }).id);
          return node;
        },
      },
    };
    expect(injectDebugStyles(doc)).toBe(true);
    expect(injectDebugStyles(doc)).toBe(false);
    expect(appended).toEqual([{ id: DEBUG_STYLE_ID, textContent: DEBUG_CSS }]);
    expect(DEBUG_CSS).toContain('.dh-debug-overlay');
    expect(DEBUG_CSS).toContain('.dh-debug-console');
  });
});
