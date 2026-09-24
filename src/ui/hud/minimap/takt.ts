/**
 * Frame-Takt der HUD-Anzeigen (M3-28/M3-29): Die Kompositionswurzel ruft einmal je gerendertem Frame
 * `frame()` (die Signals-Brücke bietet dafür `onFrame`). `HudFrame` liest dabei einmal die Lage der Welt
 * (`MinimapQuelle.lage`) und gibt sie an Minimap, Kompassbalken und Meldungen weiter – eine Abfrage je
 * Frame für alle, ohne Allokation.
 */
import { neueMinimapLage, type MinimapLage, type MinimapQuelle } from './lage';

/** Etwas, das je Frame benachrichtigt (die UI-Brücke: `bridge.onFrame`). */
export interface FrameTakt {
  onFrame(listener: () => void): () => void;
}

/** Die je Frame gelesene Lage und ihre Abonnenten. */
export class HudFrame implements FrameTakt {
  /** Die Lage des letzten Frames (vom Frame überschrieben; Abonnenten lesen sie im Rückruf). */
  readonly lage: MinimapLage = neueMinimapLage();
  private readonly hoerer = new Set<() => void>();

  constructor(readonly quelle: MinimapQuelle) {}

  onFrame(listener: () => void): () => void {
    this.hoerer.add(listener);
    return () => {
      this.hoerer.delete(listener);
    };
  }

  /** Liest die Lage und benachrichtigt alle Abonnenten. */
  frame(): void {
    this.quelle.lage(this.lage);
    for (const h of this.hoerer) h();
  }
}
