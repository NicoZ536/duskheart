/**
 * F3 performance overlay (MASTERPROMPT §31.6). Reads signal-based stats, so
 * producers update values without re-rendering the rest of the UI. Values
 * outside the §30 budgets are highlighted.
 */
import { useEffect } from 'preact/hooks';
import type { Lang } from '../i18n';
import { formatNumber } from '../i18n/format';
import type { Translate } from './console';
import { DEBUG_BUDGETS, DEBUG_STAT_KEYS, isOverBudget, type DebugStatKey, type DebugStats } from './stats';
import { injectDebugStyles } from './styles';

export interface DebugOverlayProps {
  readonly stats: DebugStats;
  readonly t: Translate;
  readonly lang: Lang;
}

/** Fraction digits for millisecond values (sub-millisecond precision matters for budgets). */
const MS_DIGITS = 2;
/** Fraction digits for the heap size. */
const MB_DIGITS = 1;

const MS_KEYS: ReadonlySet<DebugStatKey> = new Set(['frameMs', 'simMs', 'renderMs']);

/** Text for one stat value (exported for reuse in bench reports). */
export function formatStat(key: DebugStatKey, value: number | null, lang: Lang, t: Translate): string {
  if (value === null) return t('debug.overlay.unavailable');
  if (MS_KEYS.has(key)) return t('debug.overlay.unitMs', { value: formatNumber(lang, value, MS_DIGITS, MS_DIGITS) });
  if (key === 'heapMb') return t('debug.overlay.unitMb', { value: formatNumber(lang, value, MB_DIGITS, MB_DIGITS) });
  return formatNumber(lang, Math.round(value));
}

function budgetTitle(key: DebugStatKey, lang: Lang, t: Translate): string | undefined {
  const b = DEBUG_BUDGETS[key];
  if (!b) return undefined;
  const limit = formatStat(key, b.limit, lang, t);
  return t('debug.overlay.budget', { value: `${b.kind === 'max' ? '≤' : '≥'} ${limit}` });
}

export function DebugOverlay({ stats, t, lang }: DebugOverlayProps) {
  useEffect(() => {
    if (typeof document !== 'undefined') injectDebugStyles(document);
  }, []);

  if (!stats.visible.value) return null;

  return (
    <div class="dh-debug-overlay" role="status" aria-label={t('debug.overlay.title')}>
      <div class="dh-debug-title">{t('debug.overlay.title')}</div>
      {DEBUG_STAT_KEYS.map((key) => {
        const value = stats[key].value;
        const over = isOverBudget(key, value);
        const budget = budgetTitle(key, lang, t);
        return (
          <div class="dh-debug-row" key={key} title={over ? `${t('debug.overlay.overBudget')} – ${budget ?? ''}` : budget}>
            <span class="dh-debug-label">{t(`debug.overlay.${key}`)}</span>
            <span class={over ? 'dh-debug-value dh-debug-over' : 'dh-debug-value'}>
              {formatStat(key, value, lang, t)}
              {over ? ' !' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
