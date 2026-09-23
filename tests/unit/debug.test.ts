import { describe, expect, it } from 'vitest';
import { MAX_DEBUG_SPEED, installDebugApi, isDebugEnabled, type DebugApiHost, type DebugExtension } from '../../src/debug/api';
import { ConsoleError, createDebugConsole, formatUsage, parseArgs, tokenize } from '../../src/debug/console';
import { commonPrefix, stripToggleChars } from '../../src/debug/consoleView';
import { formatStat } from '../../src/debug/overlay';
import {
  FrameMeter,
  createDebugStats,
  emptyDebugStats,
  isOverBudget,
  snapshotDebugStats,
  updateDebugStats,
} from '../../src/debug/stats';
import { DEBUG_CSS, DEBUG_STYLE_ID, injectDebugStyles, type StyleHost } from '../../src/debug/styles';
import { FixedStepLoop, MAX_TIME_SCALE } from '../../src/engine/loop';
import { createI18n } from '../../src/i18n/index';

const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;

function makeConsole(lang: 'de' | 'en' = 'en') {
  const i18n = createI18n(lang);
  const con = createDebugConsole({ t: i18n.t });
  const given: Array<{ item: string; count: number }> = [];
  con.register(
    'give',
    [
      { name: 'item', type: 'enum', options: () => ['stone', 'stick', 'iron_ingot'] },
      { name: 'count', type: 'int', min: 1, max: 999, default: 1 },
    ],
    ({ item, count }) => {
      given.push({ item, count });
      return `+${count} ${item}`;
    },
    'debug.console.help.help',
  );
  con.register('season', [{ name: 'season', type: 'enum', options: SEASONS }], ({ season }) => `season=${season}`, 'debug.console.help.help');
  con.register('tp', [{ name: 'x', type: 'float' }, { name: 'y', type: 'float' }, { name: 'z', type: 'int', min: -3, max: 0, optional: true }], ({ x, y, z }) => `tp ${x} ${y} ${z ?? 'same'}`, 'debug.console.help.help');
  con.register('say', [{ name: 'text', type: 'string', rest: true }], ({ text }) => text, 'debug.console.help.help');
  con.register('boom', [], () => {
    throw new Error('kaputt');
  }, 'debug.console.help.help');
  con.register('deny', [], () => {
    throw new ConsoleError('debug.console.error.disabled');
  }, 'debug.console.help.help');
  return { con, given, i18n };
}

describe('tokenizer', () => {
  it('splits on whitespace and honours quotes and escapes', () => {
    expect(tokenize('  give   stone 10 ')).toEqual(['give', 'stone', '10']);
    expect(tokenize('say "hello world" \'x y\'')).toEqual(['say', 'hello world', 'x y']);
    expect(tokenize('say a\\ b ""')).toEqual(['say', 'a b', '']);
    expect(() => tokenize('say "open')).toThrow(ConsoleError);
  });
});

describe('argument parsing', () => {
  it('parses int, float, enum and string with defaults', () => {
    const specs = [
      { name: 'n', type: 'int' },
      { name: 'f', type: 'float', optional: true },
      { name: 'e', type: 'enum', options: ['alpha', 'beta'], default: 'alpha' },
    ] as const;
    expect(parseArgs(specs, ['5'], 'u')).toEqual({ n: 5, f: undefined, e: 'alpha' });
    expect(parseArgs(specs, ['-5', '1,5', 'BE'], 'u')).toEqual({ n: -5, f: 1.5, e: 'beta' });
    expect(parseArgs(specs, ['5', '.25', 'a'], 'u')).toMatchObject({ f: 0.25, e: 'alpha' });
  });

  it('reports precise errors as i18n keys', () => {
    const err = (fn: () => unknown): ConsoleError => {
      try {
        fn();
      } catch (e) {
        if (e instanceof ConsoleError) return e;
      }
      throw new Error('expected ConsoleError');
    };
    expect(err(() => parseArgs([{ name: 'n', type: 'int' }], ['1.5'], 'u')).key).toBe('debug.console.error.notInt');
    expect(err(() => parseArgs([{ name: 'n', type: 'float' }], ['abc'], 'u')).key).toBe('debug.console.error.notFloat');
    expect(err(() => parseArgs([{ name: 'n', type: 'int', min: 1, max: 3 }], ['4'], 'u')).key).toBe('debug.console.error.outOfRange');
    expect(err(() => parseArgs([{ name: 'n', type: 'int' }], [], 'u')).key).toBe('debug.console.error.missingArg');
    expect(err(() => parseArgs([{ name: 'n', type: 'int' }], ['1', '2'], 'u')).key).toBe('debug.console.error.tooManyArgs');
    expect(err(() => parseArgs([{ name: 's', type: 'enum', options: SEASONS }], ['x'], 'u')).key).toBe('debug.console.error.badEnum');
    const ambiguous = err(() => parseArgs([{ name: 's', type: 'enum', options: ['stone', 'stick'] }], ['st'], 'u'));
    expect(ambiguous.key).toBe('debug.console.error.ambiguousEnum');
    expect(ambiguous.params.options).toBe('stone, stick');
  });

  it('builds usage lines', () => {
    expect(formatUsage('give', [{ name: 'item', type: 'string' }, { name: 'count', type: 'int', default: 1 }])).toBe('give <item> [count]');
    expect(formatUsage('season', [{ name: 's', type: 'enum', options: SEASONS }])).toBe('season <spring|summer|autumn|winter>');
    expect(formatUsage('say', [{ name: 'text', type: 'string', rest: true }])).toBe('say <text…>');
  });
});

describe('debug console', () => {
  it('executes commands with typed arguments', () => {
    const { con, given } = makeConsole();
    expect(con.execute('give stone 10')).toEqual({ ok: true, lines: ['+10 stone'] });
    expect(con.exec('GIVE iron')).toBe('+1 iron_ingot');
    expect(given).toEqual([
      { item: 'stone', count: 10 },
      { item: 'iron_ingot', count: 1 },
    ]);
    expect(con.exec('season win')).toBe('season=winter');
    expect(con.exec('tp 10,5 -2')).toBe('tp 10.5 -2 same');
    expect(con.exec('tp 1 2 -3')).toBe('tp 1 2 -3');
    expect(con.exec('say hello   brave "new world"')).toBe('hello brave new world');
  });

  it('gives translated, helpful error messages', () => {
    const { con } = makeConsole('de');
    const r = con.execute('give stone 0');
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toBe('<count> muss zwischen 1 und 999 liegen, erhalten: 0.');
    expect(con.exec('give')).toBe('Argument <item> fehlt. Verwendung: give <item> [count]');
    expect(con.exec('season monsoon')).toBe('Ungültiger Wert „monsoon“ für <season>. Erlaubt: spring, summer, autumn, winter');
    expect(con.exec('gvie stone')).toBe('Unbekannter Befehl „gvie“. Meintest du „give“?');
    expect(con.exec('xyzzy')).toBe('Unbekannter Befehl „xyzzy“. „help“ listet alle Befehle.');
    expect(con.exec('boom')).toBe('Befehl fehlgeschlagen: kaputt');
    expect(con.exec('deny')).toMatch(/Entwicklermodus/);
    expect(con.exec('say "open')).toBe('Anführungszeichen wurde nicht geschlossen.');
  });

  it('lists help and usage', () => {
    const { con } = makeConsole();
    const help = con.execute('help').lines;
    expect(help[0]).toBe('Available commands:');
    expect(help.some((l) => l.includes('give <item> [count]'))).toBe(true);
    expect(help.some((l) => l.includes('clear'))).toBe(true);
    expect(con.exec('help season')).toBe('Usage: season <spring|summer|autumn|winter>\nLists all commands or shows help for one command.');
    expect(con.exec('h nope')).toMatch(/Unknown command “nope”/);
    expect(con.commands().map((c) => c.name)).toContain('tp');
  });

  it('keeps history and scrollback, clear wipes the scrollback', () => {
    const { con } = makeConsole();
    let notified = 0;
    const off = con.subscribe(() => notified++);
    con.execute('give stone');
    con.execute('give stone');
    con.execute('season spring');
    con.execute('   ');
    expect(con.history).toEqual(['give stone', 'season spring']);
    expect(con.lines.map((l) => l.kind)).toEqual(['input', 'output', 'input', 'output', 'input', 'output']);
    expect(con.lines[0]?.text).toBe('> give stone');
    expect(notified).toBe(3);
    con.execute('cls');
    expect(con.lines).toEqual([]);
    off();
    con.execute('give stone');
    expect(notified).toBe(4);
  });

  it('limits history and scrollback', () => {
    const con = createDebugConsole({ t: createI18n('en').t, historyLimit: 3, scrollbackLimit: 4 });
    con.register('n', [{ name: 'v', type: 'int' }], ({ v }) => String(v), 'debug.console.help.help');
    for (let i = 0; i < 6; i++) con.execute(`n ${i}`);
    expect(con.history).toEqual(['n 3', 'n 4', 'n 5']);
    expect(con.lines.map((l) => l.text)).toEqual(['> n 4', '4', '> n 5', '5']);
  });

  it('completes command names and enum values', () => {
    const { con } = makeConsole();
    expect(con.complete('se')).toEqual(['season']);
    expect(con.complete('')).toContain('give');
    expect(con.complete('season s')).toEqual(['season spring', 'season summer']);
    expect(con.complete('give ')).toEqual(['give stone', 'give stick', 'give iron_ingot']);
    expect(con.complete('give stone ')).toEqual([]);
    expect(con.complete('nope x')).toEqual([]);
  });

  it('rejects invalid registrations and supports unregistering', () => {
    const { con } = makeConsole();
    expect(() => con.register('give', [], () => undefined, 'k')).toThrow(/already/);
    expect(() => con.register('Bad Name', [], () => undefined, 'k')).toThrow(/Invalid/);
    expect(() => con.register('x', [{ name: 'a', type: 'string', rest: true }, { name: 'b', type: 'int' }], () => undefined, 'k')).toThrow(/last/);
    const off = con.register('god', [], () => undefined, 'k', { aliases: ['g'] });
    expect(con.exec('g')).toBe('OK');
    off();
    expect(con.has('god')).toBe(false);
    expect(con.has('g')).toBe(false);
    expect(con.unregister('god')).toBe(false);
  });
});

describe('isDebugEnabled', () => {
  it('requires ?debug=1 or developer mode', () => {
    expect(isDebugEnabled('https://example.org/game/?debug=1', false)).toBe(true);
    expect(isDebugEnabled('https://example.org/?seed=4&debug=true#x', false)).toBe(true);
    expect(isDebugEnabled('https://example.org/?debug=0', false)).toBe(false);
    expect(isDebugEnabled('https://example.org/', false)).toBe(false);
    expect(isDebugEnabled('https://example.org/', true)).toBe(true);
    expect(isDebugEnabled('/index.html?debug=1', false)).toBe(true);
    expect(isDebugEnabled('?debug=1', false)).toBe(true);
  });
});

describe('window.__dh', () => {
  function install() {
    const calls: string[] = [];
    const host: DebugApiHost = {};
    const { con } = makeConsole();
    const handle = installDebugApi(host, {
      version: '0.1.0',
      getState: () => ({ tick: 42 }),
      exec: (line) => con.exec(line),
      freezeTime: (on) => calls.push(`freeze:${on}`),
      setSpeed: (x) => calls.push(`speed:${x}`),
      setScreenshotMode: (on) => calls.push(`shot:${on}`),
      getStats: () => ({ ...emptyDebugStats(), fps: 60 }),
    });
    return { host, handle, calls };
  }

  it('exposes the documented shape', () => {
    const { host, handle } = install();
    const api = host.__dh;
    expect(api).toBeDefined();
    if (!api) return;
    expect(api.ready).toBe(false);
    handle.setReady(true);
    expect(api.ready).toBe(true);
    expect(api.version).toBe('0.1.0');
    expect(api.state()).toEqual({ tick: 42 });
    expect(api.exec('give stone 3')).toBe('+3 stone');
    expect(api.stats().fps).toBe(60);
    for (const fn of ['state', 'exec', 'freezeTime', 'setSpeed', 'screenshotMode', 'stats', 'call', 'extensions'] as const) {
      expect(typeof api[fn]).toBe('function');
    }
  });

  it('freezes time, sets speed and handles screenshot mode', () => {
    const { host, calls } = install();
    const api = host.__dh;
    if (!api) throw new Error('missing api');
    api.freezeTime(true);
    expect(api.timeFrozen).toBe(true);
    api.freezeTime(false);
    api.setSpeed(4);
    expect(api.speed).toBe(4);
    expect(() => api.setSpeed(0)).toThrow(RangeError);
    expect(() => api.setSpeed(MAX_DEBUG_SPEED + 1)).toThrow(RangeError);
    expect(() => api.setSpeed(Number.NaN)).toThrow(RangeError);
    api.screenshotMode(true);
    expect(api.screenshot).toBe(true);
    expect(api.timeFrozen).toBe(true);
    api.screenshotMode(true);
    api.screenshotMode(false);
    expect(api.timeFrozen).toBe(false);
    expect(calls).toEqual(['freeze:true', 'freeze:false', 'speed:4', 'freeze:true', 'shot:true', 'freeze:false', 'shot:false']);
  });

  it('accepts exactly the speeds the loop can apply and keeps state when the dependency rejects', () => {
    expect(MAX_DEBUG_SPEED).toBe(MAX_TIME_SCALE);
    const host: DebugApiHost = {};
    const loop = new FixedStepLoop({ now: () => 0, schedule: () => 0, cancel: () => undefined, update: () => undefined, render: () => undefined });
    let frozenCalls = 0;
    installDebugApi(host, {
      version: 'x',
      getState: () => null,
      exec: () => '',
      freezeTime: () => {
        frozenCalls++;
        throw new Error('freeze failed');
      },
      setSpeed: (f) => loop.setTimeScale(f),
      setScreenshotMode: () => undefined,
      getStats: () => emptyDebugStats(),
    });
    const api = host.__dh;
    if (!api) throw new Error('missing api');
    api.setSpeed(MAX_DEBUG_SPEED);
    expect(loop.timeScale).toBe(MAX_DEBUG_SPEED);
    expect(api.speed).toBe(MAX_DEBUG_SPEED);
    expect(() => api.freezeTime(true)).toThrow('freeze failed');
    expect(frozenCalls).toBe(1);
    expect(api.timeFrozen).toBe(false);
  });

  it('supports extensions and uninstall', () => {
    const { host, handle } = install();
    const scenario: DebugExtension = (name: string) => `loaded ${name}`;
    const off = handle.extend('scenario', scenario);
    expect(() => handle.extend('scenario', scenario)).toThrow(/already/);
    expect(host.__dh?.extensions()).toEqual(['scenario']);
    expect(host.__dh?.call('scenario', 'night')).toBe('loaded night');
    off();
    expect(() => host.__dh?.call('scenario')).toThrow(/unknown extension/);
    handle.uninstall();
    expect(host.__dh).toBeUndefined();
  });
});

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
