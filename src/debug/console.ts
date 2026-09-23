/**
 * Debug console command registry (MASTERPROMPT §31.6). Concrete commands
 * (give, spawn, tp, time, weather, season, god, noclip, reveal, unlock, boss,
 * speed, kill) are registered by the modules that own the systems; this file
 * provides tokenizing, typed argument parsing, help, history and scrollback.
 * All user-facing messages are i18n keys resolved through the injected `t`.
 */

export type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string;

type EnumOptions = readonly string[] | (() => readonly string[]);

interface ArgBase {
  readonly name: string;
  /** Optional arguments may be omitted (value `undefined` unless a default is given). */
  readonly optional?: boolean;
}
export interface IntArg extends ArgBase {
  readonly type: 'int';
  readonly min?: number;
  readonly max?: number;
  readonly default?: number;
}
export interface FloatArg extends ArgBase {
  readonly type: 'float';
  readonly min?: number;
  readonly max?: number;
  readonly default?: number;
}
export interface StringArg extends ArgBase {
  readonly type: 'string';
  /** Consumes all remaining tokens joined by spaces (must be the last argument). */
  readonly rest?: boolean;
  readonly default?: string;
}
export interface EnumArg extends ArgBase {
  readonly type: 'enum';
  /** Allowed values (static list or provider, e.g. all item ids). Unique prefixes are accepted. */
  readonly options: EnumOptions;
  readonly default?: string;
}
export type ArgSpec = IntArg | FloatArg | StringArg | EnumArg;

type ArgValue<S> = S extends { readonly type: 'int' | 'float' }
  ? number
  : S extends { readonly type: 'enum'; readonly options: readonly (infer O extends string)[] }
    ? O
    : string;
type ArgValueOrMissing<S> = S extends { readonly default: string | number }
  ? ArgValue<S>
  : S extends { readonly optional: true }
    ? ArgValue<S> | undefined
    : ArgValue<S>;

/** Parsed argument object inferred from an argument spec tuple. */
export type ArgsOf<Specs extends readonly ArgSpec[]> = {
  [S in Specs[number] as S['name']]: ArgValueOrMissing<S>;
};

export interface CommandContext {
  readonly t: Translate;
  /** Append an extra output line (for commands that report progress). */
  print(text: string): void;
  /** Wipe the scrollback once the command has finished. */
  clearScrollback(): void;
}

/** Handlers return output text (one or more lines) or nothing (prints "OK"). */
export type CommandResult = string | readonly string[] | void;

export interface CommandInfo {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly args: readonly ArgSpec[];
  /** i18n key of the help text. */
  readonly help: string;
  readonly usage: string;
}

export interface ConsoleLine {
  readonly id: number;
  readonly kind: 'input' | 'output' | 'error';
  readonly text: string;
}

export interface ConsoleResult {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

/** Error with a translatable message; handlers may throw it for user errors. */
export class ConsoleError extends Error {
  readonly key: string;
  readonly params: Readonly<Record<string, string | number>>;
  constructor(key: string, params: Readonly<Record<string, string | number>> = {}) {
    super(key);
    this.name = 'ConsoleError';
    this.key = key;
    this.params = params;
  }
}

/** Remembered input lines (arrow-up recall). */
export const HISTORY_LIMIT = 100;
/** Scrollback lines kept for the console view. */
export const SCROLLBACK_LIMIT = 500;
/** Enum options listed in an error message before it is shortened with "…". */
export const ENUM_OPTIONS_SHOWN = 12;
/** Enum options short enough to be spelled out in the usage line. */
const USAGE_INLINE_OPTIONS = 6;
/** Maximum edit distance for "did you mean" suggestions. */
const SUGGEST_MAX_DISTANCE = 2;

/**
 * Split a command line into tokens. Whitespace separates tokens; single or
 * double quotes group text ("iron ingot"); backslash escapes the next char.
 */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inToken = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? '';
    if (ch === '\\' && i + 1 < line.length) {
      cur += line[i + 1] ?? '';
      inToken = true;
      i++;
    } else if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
    } else if (/\s/.test(ch)) {
      if (inToken) out.push(cur);
      cur = '';
      inToken = false;
    } else {
      cur += ch;
      inToken = true;
    }
  }
  if (quote) throw new ConsoleError('debug.console.error.unterminatedQuote');
  if (inToken) out.push(cur);
  return out;
}

function resolveOptions(options: EnumOptions): readonly string[] {
  return typeof options === 'function' ? options() : options;
}

function isOptional(spec: ArgSpec): boolean {
  return spec.optional === true || spec.default !== undefined;
}

/** Human-readable usage line, e.g. "give <item> [count]" or "season <spring|summer|autumn|winter>". */
export function formatUsage(name: string, args: readonly ArgSpec[]): string {
  const parts = args.map((a) => {
    let label = a.type === 'string' && a.rest ? `${a.name}…` : a.name;
    if (a.type === 'enum' && typeof a.options !== 'function' && a.options.length <= USAGE_INLINE_OPTIONS) label = a.options.join('|');
    return isOptional(a) ? `[${label}]` : `<${label}>`;
  });
  return [name, ...parts].join(' ');
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min((prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + 1, diag + cost);
      diag = tmp;
    }
  }
  return prev[b.length] ?? 0;
}

function parseNumber(spec: IntArg | FloatArg, token: string, usage: string): number {
  const normalized = spec.type === 'float' && /^[+-]?\d+,\d+$/.test(token) ? token.replace(',', '.') : token;
  const pattern = spec.type === 'int' ? /^[+-]?\d+$/ : /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
  const value = Number(normalized);
  if (!pattern.test(normalized) || !Number.isFinite(value)) {
    throw new ConsoleError(spec.type === 'int' ? 'debug.console.error.notInt' : 'debug.console.error.notFloat', { arg: spec.name, value: token, usage });
  }
  if ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max)) {
    throw new ConsoleError('debug.console.error.outOfRange', {
      arg: spec.name,
      value: token,
      min: spec.min ?? Number.NEGATIVE_INFINITY,
      max: spec.max ?? Number.POSITIVE_INFINITY,
    });
  }
  return value;
}

function parseEnum(spec: EnumArg, token: string): string {
  const options = resolveOptions(spec.options);
  const lower = token.toLowerCase();
  const exact = options.find((o) => o.toLowerCase() === lower);
  if (exact !== undefined) return exact;
  const matches = options.filter((o) => o.toLowerCase().startsWith(lower));
  if (matches.length === 1 && matches[0] !== undefined) return matches[0];
  const list = (list: readonly string[]): string =>
    list.length > ENUM_OPTIONS_SHOWN ? `${list.slice(0, ENUM_OPTIONS_SHOWN).join(', ')}, …` : list.join(', ');
  if (matches.length > 1) throw new ConsoleError('debug.console.error.ambiguousEnum', { arg: spec.name, value: token, options: list(matches) });
  throw new ConsoleError('debug.console.error.badEnum', { arg: spec.name, value: token, options: list(options) });
}

/** Parse tokens against an argument spec; throws `ConsoleError` with a translatable message. */
export function parseArgs(args: readonly ArgSpec[], tokens: readonly string[], usage: string): Record<string, string | number | undefined> {
  const out: Record<string, string | number | undefined> = {};
  let consumed = 0;
  for (let i = 0; i < args.length; i++) {
    const spec = args[i];
    if (!spec) continue;
    if (spec.type === 'string' && spec.rest) {
      const rest = tokens.slice(i).join(' ');
      consumed = tokens.length;
      if (rest.length > 0) out[spec.name] = rest;
      else if (!isOptional(spec)) throw new ConsoleError('debug.console.error.missingArg', { arg: spec.name, usage });
      else out[spec.name] = spec.default;
      break;
    }
    const token = tokens[i];
    if (token === undefined) {
      if (!isOptional(spec)) throw new ConsoleError('debug.console.error.missingArg', { arg: spec.name, usage });
      out[spec.name] = spec.default;
      continue;
    }
    consumed = i + 1;
    switch (spec.type) {
      case 'int':
      case 'float':
        out[spec.name] = parseNumber(spec, token, usage);
        break;
      case 'enum':
        out[spec.name] = parseEnum(spec, token);
        break;
      case 'string':
        out[spec.name] = token;
        break;
    }
  }
  if (tokens.length > Math.max(consumed, args.length)) throw new ConsoleError('debug.console.error.tooManyArgs', { usage });
  return out;
}

interface Registered extends CommandInfo {
  readonly handler: (args: Record<string, string | number | undefined>, ctx: CommandContext) => CommandResult;
}

export interface RegisterOptions {
  readonly aliases?: readonly string[];
}

export interface DebugConsoleOptions {
  readonly t: Translate;
  readonly historyLimit?: number;
  readonly scrollbackLimit?: number;
}

export interface DebugConsole {
  /**
   * Register a command. `help` is an i18n key. Argument types are inferred from
   * the spec tuple, e.g. `register('give', [{ name: 'item', type: 'string' },
   * { name: 'count', type: 'int', min: 1, default: 1 }], ({ item, count }) => …)`.
   * Returns a function that unregisters the command.
   */
  register<const Specs extends readonly ArgSpec[]>(
    name: string,
    args: Specs,
    handler: (args: ArgsOf<Specs>, ctx: CommandContext) => CommandResult,
    help: string,
    opts?: RegisterOptions,
  ): () => void;
  unregister(name: string): boolean;
  has(name: string): boolean;
  commands(): CommandInfo[];
  /** Parse and run one line; the line and its output are added to the scrollback. */
  execute(line: string): ConsoleResult;
  /** `execute` returning the output as one string (used by `window.__dh.exec`). */
  exec(line: string): string;
  /** Completions for the partially typed line (command names, enum values). */
  complete(partial: string): string[];
  readonly history: readonly string[];
  readonly lines: readonly ConsoleLine[];
  clear(): void;
  subscribe(listener: () => void): () => void;
}

export function createDebugConsole(opts: DebugConsoleOptions): DebugConsole {
  const t = opts.t;
  const historyLimit = opts.historyLimit ?? HISTORY_LIMIT;
  const scrollbackLimit = opts.scrollbackLimit ?? SCROLLBACK_LIMIT;
  const registry = new Map<string, Registered>();
  const aliasMap = new Map<string, string>();
  const history: string[] = [];
  let lines: ConsoleLine[] = [];
  let nextLineId = 1;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const l of [...listeners]) l();
  }

  function push(kind: ConsoleLine['kind'], text: string): void {
    lines.push({ id: nextLineId++, kind, text });
    if (lines.length > scrollbackLimit) lines = lines.slice(lines.length - scrollbackLimit);
  }

  function find(name: string): Registered | undefined {
    const key = name.toLowerCase();
    return registry.get(key) ?? registry.get(aliasMap.get(key) ?? '');
  }

  function translateError(e: unknown): string {
    if (e instanceof ConsoleError) return t(e.key, e.params);
    const message = e instanceof Error ? e.message : String(e);
    return t('debug.console.error.failed', { message });
  }

  function suggestion(name: string): string | undefined {
    let best: string | undefined;
    let bestDist = SUGGEST_MAX_DISTANCE + 1;
    const candidates = [...registry.keys(), ...aliasMap.keys()];
    for (const c of candidates) {
      const d = c.startsWith(name) ? 1 : editDistance(name, c);
      if (d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return best;
  }

  const api: DebugConsole = {
    register(name, args, handler, help, regOpts = {}) {
      const key = name.toLowerCase();
      if (!/^[a-z][a-z0-9_-]*$/.test(key)) throw new Error(`Invalid console command name: ${name}`);
      if (registry.has(key) || aliasMap.has(key)) throw new Error(`Console command already registered: ${name}`);
      const restIdx = args.findIndex((a) => a.type === 'string' && a.rest === true);
      if (restIdx >= 0 && restIdx !== args.length - 1) throw new Error(`Rest argument must be last: ${name}`);
      const aliases = (regOpts.aliases ?? []).map((a) => a.toLowerCase());
      for (const a of aliases) {
        if (registry.has(a) || aliasMap.has(a)) throw new Error(`Console alias already registered: ${a}`);
      }
      registry.set(key, {
        name: key,
        aliases,
        args,
        help,
        usage: formatUsage(key, args),
        // The typed handler receives exactly the object parseArgs builds from `args`.
        handler: handler as unknown as Registered['handler'],
      });
      for (const a of aliases) aliasMap.set(a, key);
      return () => {
        api.unregister(key);
      };
    },
    unregister(name) {
      const cmd = find(name);
      if (!cmd) return false;
      registry.delete(cmd.name);
      for (const a of cmd.aliases) aliasMap.delete(a);
      return true;
    },
    has(name) {
      return find(name) !== undefined;
    },
    commands() {
      return [...registry.values()]
        .map(({ name, aliases, args, help, usage }) => ({ name, aliases, args, help, usage }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    execute(line) {
      const trimmed = line.trim();
      if (trimmed.length === 0) return { ok: true, lines: [] };
      if (history[history.length - 1] !== trimmed) history.push(trimmed);
      if (history.length > historyLimit) history.splice(0, history.length - historyLimit);
      push('input', `> ${trimmed}`);

      const output: string[] = [];
      let ok = true;
      let clearAfter = false;
      try {
        const tokens = tokenize(trimmed);
        const [name = '', ...rest] = tokens;
        const cmd = find(name);
        if (!cmd) {
          const s = suggestion(name.toLowerCase());
          throw s
            ? new ConsoleError('debug.console.error.unknownCommandSuggest', { name, suggestion: s })
            : new ConsoleError('debug.console.error.unknownCommand', { name });
        }
        const args = parseArgs(cmd.args, rest, cmd.usage);
        const ctx: CommandContext = {
          t,
          print: (text) => {
            output.push(text);
          },
          clearScrollback: () => {
            clearAfter = true;
          },
        };
        const result = cmd.handler(args, ctx);
        if (typeof result === 'string') output.push(result);
        else if (Array.isArray(result)) output.push(...(result as readonly string[]));
        if (output.length === 0) output.push(t('debug.console.ok'));
      } catch (e) {
        ok = false;
        output.push(translateError(e));
      }
      for (const text of output) push(ok ? 'output' : 'error', text);
      if (clearAfter) lines = [];
      notify();
      return { ok, lines: output };
    },
    exec(line) {
      return api.execute(line).lines.join('\n');
    },
    complete(partial) {
      const hasTrailingSpace = /\s$/.test(partial);
      let tokens: string[];
      try {
        tokens = tokenize(partial);
      } catch {
        return [];
      }
      if (tokens.length <= 1 && !hasTrailingSpace) {
        const prefix = (tokens[0] ?? '').toLowerCase();
        return [...registry.keys()].filter((n) => n.startsWith(prefix)).sort();
      }
      const cmd = find(tokens[0] ?? '');
      if (!cmd) return [];
      const argIndex = hasTrailingSpace ? tokens.length - 1 : tokens.length - 2;
      const spec = cmd.args[argIndex];
      if (!spec || spec.type !== 'enum') return [];
      const prefix = hasTrailingSpace ? '' : (tokens[tokens.length - 1] ?? '').toLowerCase();
      const head = (hasTrailingSpace ? tokens : tokens.slice(0, -1)).join(' ');
      return resolveOptions(spec.options)
        .filter((o) => o.toLowerCase().startsWith(prefix))
        .map((o) => `${head} ${o}`);
    },
    get history() {
      return history;
    },
    get lines() {
      return lines;
    },
    clear() {
      lines = [];
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  // Built-in commands.
  api.register(
    'help',
    [{ name: 'command', type: 'string', optional: true }],
    ({ command }) => {
      if (command !== undefined) {
        const cmd = find(command);
        if (!cmd) throw new ConsoleError('debug.console.error.unknownCommand', { name: command });
        return [t('debug.console.help.usage', { usage: cmd.usage }), t(cmd.help)];
      }
      return [t('debug.console.help.header'), ...api.commands().map((c) => `  ${c.usage} – ${t(c.help)}`)];
    },
    'debug.console.help.help',
    { aliases: ['h'] },
  );
  api.register('clear', [], (_args, ctx) => ctx.clearScrollback(), 'debug.console.clear.help', { aliases: ['cls'] });

  return api;
}
