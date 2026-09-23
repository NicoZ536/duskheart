/**
 * Zusätzliche Farb-Tokens des UI-Kits (MASTERPROMPT §4.3 "eine Palette"): Farben, die das Kit neben
 * den acht UI-Farben braucht, als Verweis auf die Master-Palette. `tools/assets/ui-step.ts` schreibt
 * sie als `--dh-kit-<name>` nach `src/generated/ui-kit.css`; Stylesheets enthalten keine eigenen
 * Farbwerte.
 */
export const UI_KIT_FARBEN = {
  /** Beschriftung gesperrter Schaltflächen (auf kaltem Grau). */
  gesperrt: 'stein.3',
  /** Schrift auf Pergament. */
  tinte: 'erde.0',
  /** Schatten unter heller Schrift. */
  schatten: 'nacht.0',
} as const;
