/**
 * Alle UI-Grafiken (MASTERPROMPT §5 "UI-Grafik", §26). `npm run assets` rastert sie zu
 * `public/generated/ui/<id>.png`, schreibt die 9-Slice-Regeln nach `src/generated/ui-kit.css`, das
 * Maß-Manifest nach `src/generated/ui.ts` und den Kontaktbogen `tools/out/sheets/ui-kit.png`
 * (`tools/assets/ui-step.ts`). Neue Grafiken hier eintragen.
 */
import type { UiGrafikQuelle } from './format';
import { KNOPF, KNOPF_GEDRUECKT, KNOPF_GESPERRT, KNOPF_HOVER } from './knopf';
import { LEISTE, LEISTE_AUSDAUER, LEISTE_DURST, LEISTE_LEBEN, LEISTE_SAETTIGUNG } from './leiste';
import { RAHMEN_EISEN, RAHMEN_HOLZ, RAHMEN_PERGAMENT } from './rahmen';
import { SCROLL_BAHN, SCROLL_GRIFF, SCROLL_HOCH, SCROLL_RILLEN, SCROLL_RUNTER } from './scroll';
import { SLOT, SLOT_AKTIV, SLOT_HOVER } from './slot';

export const UI_GRAFIK_QUELLEN: readonly UiGrafikQuelle[] = [
  RAHMEN_HOLZ,
  RAHMEN_EISEN,
  RAHMEN_PERGAMENT,
  SLOT,
  SLOT_HOVER,
  SLOT_AKTIV,
  KNOPF,
  KNOPF_HOVER,
  KNOPF_GEDRUECKT,
  KNOPF_GESPERRT,
  LEISTE,
  LEISTE_LEBEN,
  LEISTE_AUSDAUER,
  LEISTE_SAETTIGUNG,
  LEISTE_DURST,
  SCROLL_BAHN,
  SCROLL_GRIFF,
  SCROLL_RILLEN,
  SCROLL_HOCH,
  SCROLL_RUNTER,
];
