/**
 * Subtitles of important sounds (MASTERPROMPT §27 "Untertitel für wichtige Laute", §29 Barrierefreiheit;
 * M3-33): the audio kernel reports every sound whose preset carries a subtitle (`untertitel`, DE/EN at the
 * preset) while the setting `audio.subtitles` is on (`AudioRuntime.onSubtitle`); this display shows the
 * newest `UNTERTITEL.maxZeilen` of them bottom centre above the interaction hint, each for
 * `UNTERTITEL.dauerMs`. The same text again refreshes its line instead of stacking.
 */
import { useEffect, useState } from 'preact/hooks';
import type { LocalizedText } from '../../content/schema/common';
import type { Lang } from '../../i18n';
import './untertitel.css';

/** Where subtitles come from (the audio kernel's `onSubtitle`). */
export interface UntertitelQuelle {
  onSubtitle(listener: (text: LocalizedText) => void): () => void;
}

/** Lines shown at once, and how long one stays [ms]. */
export const UNTERTITEL = { maxZeilen: 3, dauerMs: 3000 } as const;

/** One subtitle line: its text and until when it shows [ms, the display's clock]. */
export interface UntertitelZeile {
  readonly id: number;
  readonly text: LocalizedText;
  readonly bis: number;
}

/** The lines after `text` arrived at `jetzt`: the same text refreshed (moved to the end), else appended; the oldest beyond the limit drop. */
export function untertitelAufnehmen(zeilen: readonly UntertitelZeile[], text: LocalizedText, jetzt: number, id: number): UntertitelZeile[] {
  const rest = zeilen.filter((z) => z.text.de !== text.de && z.bis > jetzt);
  rest.push({ id, text, bis: jetzt + UNTERTITEL.dauerMs });
  return rest.slice(-UNTERTITEL.maxZeilen);
}

/** The lines still showing at `jetzt`. */
export function untertitelAktuell(zeilen: readonly UntertitelZeile[], jetzt: number): UntertitelZeile[] {
  return zeilen.filter((z) => z.bis > jetzt);
}

export interface UntertitelProps {
  readonly quelle: UntertitelQuelle;
  readonly lang: Lang;
}

export function Untertitel({ quelle, lang }: UntertitelProps) {
  const [zeilen, setZeilen] = useState<readonly UntertitelZeile[]>([]);
  useEffect(() => {
    let naechste = 1;
    const timer = new Set<ReturnType<typeof setTimeout>>();
    const aus = quelle.onSubtitle((text) => {
      const id = naechste++;
      setZeilen((z) => untertitelAufnehmen(z, text, performance.now(), id));
      const t = setTimeout(() => {
        timer.delete(t);
        setZeilen((z) => untertitelAktuell(z, performance.now()));
      }, UNTERTITEL.dauerMs);
      timer.add(t);
    });
    return () => {
      aus();
      for (const t of timer) clearTimeout(t);
    };
  }, [quelle]);
  if (zeilen.length === 0) return null;
  return (
    <div class="dh-untertitel" aria-live="polite" data-testid="untertitel">
      {zeilen.map((z) => (
        <div key={z.id} class="dh-untertitel__zeile">
          {z.text[lang]}
        </div>
      ))}
    </div>
  );
}
