/**
 * M0-10 Debug-Konsole: Befehlsregister (Tokenizer, typisierte Argumente, Fehlermeldungen,
 * Verlauf, Vervollständigung), `help` listet alle registrierten Befehle, die ab M0 registrierten
 * Befehle `set`, `speed`, `freeze` und die Tastenbelegung von Konsole und F3-Overlay.
 * Browserseite (Overlay sichtbar, Tippen in der Konsole): tests/e2e/debug.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { MAX_DEBUG_SPEED } from '../../../src/debug/api';
import { MIN_CONSOLE_SPEED, keyMatches, registerCoreCommands, type KeyEventLike } from '../../../src/debug/boot';
import { ConsoleError, createDebugConsole, formatUsage, parseArgs, tokenize } from '../../../src/debug/console';
import { DEFAULT_BINDINGS, key } from '../../../src/engine/input/bindings';
import { createSettingsStore } from '../../../src/engine/settings';
import { createI18n, type Lang } from '../../../src/i18n/index';

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

function setup(lang: Lang = 'en') {
  const i18n = createI18n(lang);
  const settings = createSettingsStore(null, { navigatorLanguage: lang });
  const calls: string[] = [];
  const con = createDebugConsole({ t: i18n.t });
  registerCoreCommands(con, {
    t: i18n.t,
    settings,
    api: {
      setSpeed: (f) => calls.push(`speed:${f}`),
      freezeTime: (on) => calls.push(`freeze:${String(on)}`),
    },
  });
  return { i18n, settings, calls, con };
}

function press(code: string, mods: Partial<Omit<KeyEventLike, 'code'>> = {}): KeyEventLike {
  return { code, ctrlKey: false, shiftKey: false, altKey: false, ...mods };
}

describe('Debug-Konsole: Befehle ab M0', () => {
  it('help listet set, speed, freeze, help und clear mit übersetzter Hilfe', () => {
    for (const lang of ['de', 'en'] as const) {
      const { con, i18n } = setup(lang);
      expect(con.commands().map((c) => c.name)).toEqual(['clear', 'freeze', 'help', 'set', 'speed']);
      const out = con.execute('help');
      expect(out.ok).toBe(true);
      const text = out.lines.join('\n');
      for (const usage of ['set <path> <value>', 'speed <factor>', 'freeze <on|off>', 'help [command]', 'clear']) expect(text).toContain(usage);
      for (const c of con.commands()) {
        expect(i18n.has(c.help, lang), `${lang}: ${c.help}`).toBe(true);
        expect(text).toContain(i18n.t(c.help));
      }
      expect(i18n.missingKeys()).toEqual([]);
    }
  });

  it('speed setzt das Tempo über die Debug-API', () => {
    const { con, calls, i18n } = setup('de');
    const out = con.execute('speed 4');
    expect(out).toEqual({ ok: true, lines: [i18n.t('debug.speed', { factor: 4 })] });
    expect(con.execute('speed 0,5').ok).toBe(true);
    expect(calls).toEqual(['speed:4', 'speed:0.5']);
  });

  it('speed lehnt Werte außerhalb des erlaubten Bereichs ab', () => {
    const { con, calls } = setup();
    expect(con.execute(`speed ${MAX_DEBUG_SPEED * 2}`).ok).toBe(false);
    expect(con.execute('speed 0').ok).toBe(false);
    expect(con.execute('speed fast').ok).toBe(false);
    expect(con.execute(`speed ${MIN_CONSOLE_SPEED}`).ok).toBe(true);
    expect(con.execute(`speed ${MAX_DEBUG_SPEED}`).ok).toBe(true);
    expect(calls).toEqual([`speed:${MIN_CONSOLE_SPEED}`, `speed:${MAX_DEBUG_SPEED}`]);
  });

  it('freeze on/off friert die Zeit ein und gibt sie wieder frei', () => {
    const { con, calls, i18n } = setup();
    expect(con.execute('freeze on').lines).toEqual([i18n.t('debug.timeFrozen')]);
    expect(con.execute('freeze off').lines).toEqual([i18n.t('debug.timeRunning')]);
    expect(con.execute('freeze maybe').ok).toBe(false);
    expect(con.execute('freeze').ok).toBe(false);
    expect(calls).toEqual(['freeze:true', 'freeze:false']);
  });

  it('set ändert Einstellungen und meldet ungültige Pfade', () => {
    const { con, settings, i18n } = setup();
    expect(con.execute('set language de').lines).toEqual([i18n.t('debug.cmd.set.done', { path: 'language', value: 'de' })]);
    expect(settings.get().language).toBe('de');
    expect(con.execute('set game.nichtDa 1').lines).toEqual([i18n.t('debug.cmd.set.invalid', { path: 'game.nichtDa' })]);
  });
});

describe('Debug-Tasten aus den Eingabe-Belegungen', () => {
  it('^/Backquote und IntlBackslash öffnen die Konsole, F3 das Overlay', () => {
    expect(keyMatches(DEFAULT_BINDINGS.debugConsole, press('Backquote'))).toBe(true);
    expect(keyMatches(DEFAULT_BINDINGS.debugConsole, press('IntlBackslash'))).toBe(true);
    expect(keyMatches(DEFAULT_BINDINGS.debugConsole, press('Backquote', { shiftKey: true }))).toBe(true);
    expect(keyMatches(DEFAULT_BINDINGS.debugConsole, press('KeyC'))).toBe(false);
    expect(keyMatches(DEFAULT_BINDINGS.debugOverlay, press('F3'))).toBe(true);
    expect(keyMatches(DEFAULT_BINDINGS.debugOverlay, press('F4'))).toBe(false);
  });

  it('Akkord-Belegungen brauchen ihre Modifikatoren', () => {
    const chord = [key('KeyD', { ctrl: true, shift: true })];
    expect(keyMatches(chord, press('KeyD'))).toBe(false);
    expect(keyMatches(chord, press('KeyD', { ctrlKey: true }))).toBe(false);
    expect(keyMatches(chord, press('KeyD', { ctrlKey: true, shiftKey: true }))).toBe(true);
  });
});
