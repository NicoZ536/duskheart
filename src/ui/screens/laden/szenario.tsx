/**
 * The loading screen for its screenshot scenario (`ui-laden`, src/debug/menueScenarios.ts; M7-50): a world in the middle
 * of its generation – the step "Erze und Vorkommen" (7 of 8) – with a fixed tip and a fixed line of lore, so the picture
 * is the same on every run.
 */
import { signal } from '@preact/signals';
import { render } from 'preact';
import type { I18n } from '../../../i18n';
import type { WorldLoadingView } from '../../App';
import { Ladebildschirm, type LadeQuelle } from './Ladebildschirm';

/** The scenario's world, step and texts. */
export const LADE_SZENARIO = { welt: 'Glutküste', schritt: 'ressourcen', index: 6, anzahl: 8, tipp: 'tipp_02', lore: 'tipp_29' } as const;

/** Mounts the loading screen of the scenario into `doc`; returns the function that removes it. */
export function mountLadeSzenario(doc: Document, i18n: I18n): () => void {
  const host = doc.body.appendChild(doc.createElement('div'));
  const view = signal<WorldLoadingView | null>({ kind: 'step', step: LADE_SZENARIO.schritt, index: LADE_SZENARIO.index, count: LADE_SZENARIO.anzahl });
  const quelle: LadeQuelle = {
    welt: LADE_SZENARIO.welt,
    fortschritt: view,
    bereit: signal(false),
    hinweis: signal(null),
    zufall: () => 0,
    feste: { tipp: LADE_SZENARIO.tipp, lore: LADE_SZENARIO.lore },
  };
  render(<Ladebildschirm i18n={i18n} quelle={quelle} />, host);
  return () => {
    render(null, host);
    host.remove();
  };
}
