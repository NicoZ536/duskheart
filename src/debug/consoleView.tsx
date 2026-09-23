/**
 * Debug console view (MASTERPROMPT §31.6): scrollback + input line. The game
 * opens it through the `debugConsole` action (^ / Backquote); inside the
 * input, the same key closes it again, Enter runs the line, ↑/↓ browse the
 * history and Tab completes command names and enum values.
 */
import type { Signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { DebugConsole, Translate } from './console';
import { injectDebugStyles } from './styles';

export interface DebugConsoleViewProps {
  readonly console: DebugConsole;
  readonly t: Translate;
  readonly open: Signal<boolean>;
}

/** Keys that toggle the console (German "^" key and the ISO key next to left Shift). */
const TOGGLE_CODES: ReadonlySet<string> = new Set(['Backquote', 'IntlBackslash']);

/** Longest common prefix of the completion candidates (for partial Tab completion). */
export function commonPrefix(values: readonly string[]): string {
  const first = values[0];
  if (first === undefined) return '';
  let end = first.length;
  for (const v of values) {
    let i = 0;
    while (i < end && i < v.length && v[i] === first[i]) i++;
    end = i;
  }
  return first.slice(0, end);
}

/** Strip the toggle character that a dead "^" key may leave behind when the console opens. */
export function stripToggleChars(value: string, previous: string): string {
  return previous.length === 0 ? value.replace(/^[\^`]+/, '') : value;
}

export function DebugConsoleView({ console: con, t, open }: DebugConsoleViewProps) {
  const [input, setInput] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [completions, setCompletions] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isOpen = open.value;

  useEffect(() => {
    if (typeof document !== 'undefined') injectDebugStyles(document);
  }, []);
  useEffect(() => con.subscribe(() => setRevision((r) => r + 1)), [con]);
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [revision, isOpen]);

  if (!isOpen) return null;

  const close = (): void => {
    open.value = false;
    setCompletions([]);
  };

  const recall = (index: number): void => {
    const history = con.history;
    setHistoryIndex(index);
    setInput(index < 0 ? '' : (history[history.length - 1 - index] ?? ''));
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (TOGGLE_CODES.has(e.code) || e.code === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    switch (e.code) {
      case 'Enter':
      case 'NumpadEnter':
        e.preventDefault();
        con.execute(input);
        setInput('');
        setHistoryIndex(-1);
        setCompletions([]);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (historyIndex + 1 < con.history.length) recall(historyIndex + 1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        recall(Math.max(-1, historyIndex - 1));
        break;
      case 'Tab': {
        e.preventDefault();
        const options = con.complete(input);
        if (options.length === 1 && options[0] !== undefined) {
          setInput(`${options[0]} `);
          setCompletions([]);
        } else if (options.length > 1) {
          const prefix = commonPrefix(options);
          if (prefix.length > input.length) setInput(prefix);
          setCompletions(options);
        }
        break;
      }
      default:
        break;
    }
  };

  return (
    <div class="dh-debug-console" role="dialog" aria-label={t('debug.console.title')}>
      <div class="dh-debug-console-title">{t('debug.console.title')}</div>
      <div class="dh-debug-scrollback" ref={scrollRef} role="log" aria-live="polite">
        {con.lines.map((line) => (
          <div key={line.id} class={`dh-debug-line dh-debug-line--${line.kind}`}>
            {line.text}
          </div>
        ))}
      </div>
      {completions.length > 1 ? <div class="dh-debug-completions">{completions.join('   ')}</div> : null}
      <input
        ref={inputRef}
        class="dh-debug-input"
        type="text"
        spellcheck={false}
        autocomplete="off"
        placeholder={t('debug.console.placeholder')}
        aria-label={t('debug.console.title')}
        value={input}
        onInput={(e) => setInput(stripToggleChars(e.currentTarget.value, input))}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
