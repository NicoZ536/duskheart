// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Presentation layers that the headless simulation must never import (MASTERPROMPT §3.2). */
const PRESENTATION = ['render', 'audio', 'ui', 'debug', 'i18n'];
/**
 * Preact belongs to the DOM overlay (MASTERPROMPT §3.1/§3.2): only src/ui and the developer views in
 * src/debug import it (ADR-0010); the composition root mounts the overlay through `mountApp` from
 * src/ui. Every other layer, src/main.tsx, the tools and the asset sources get this pattern (tests
 * may import Preact types to inspect rendered trees).
 */
const UI_LIBS_PATTERN = {
  group: ['preact', 'preact/*', '@preact/*'],
  message: 'Preact nur in src/ui und src/debug; die Kompositionswurzel bindet die UI über mountApp ein (MASTERPROMPT §3.2, ADR-0010).',
};
/**
 * Browser and timer globals the headless simulation layers must not touch (MASTERPROMPT §3.2: the
 * simulation runs in Node; time arrives through the loop, input through commands, storage by injection).
 */
const SIM_FORBIDDEN_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'setTimeout',
  'setInterval',
  'fetch',
].map((name) => ({ name, message: 'Simulationsschicht (MASTERPROMPT §3.2): kein Browser- oder Timer-Zugriff – Zeit kommt über den Loop, Eingaben über Commands, Speicher per Injektion.' }));
/** Self-explanatory numbers in system code: sign, identity, halving/doubling and decimal scales. */
const MAGIC_NUMBER_ALLOWLIST = [-1, 0, 0.5, 1, 2, 10, 100, 1000];

/**
 * Build a no-restricted-imports rule that forbids the given layer folders and Preact.
 * @param {string[]} layers
 */
function forbidLayers(layers) {
  const patterns = [UI_LIBS_PATTERN];
  if (layers.length > 0) {
    patterns.unshift({
      group: layers.flatMap((l) => [`**/${l}/**`, `**/${l}`]),
      message: 'Schichtverletzung (MASTERPROMPT §3.2): diese Schicht darf das Ziel nicht importieren.',
    });
  }
  return ['error', { patterns }];
}

export default tseslint.config(
  {
    // tests/fixtures/** holds deliberate violations; tests/unit/tooling lints them explicitly with this config.
    ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', 'src/generated/**', 'public/**', 'tools/out/**', 'shots/**', 'test-results/**', 'playwright-report/**', 'tests/fixtures/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    // Baseline: no Preact outside ui/debug. Must precede the layer blocks below, which replace
    // this rule for their folders (flat config does not merge rule options) and include the
    // Preact pattern themselves.
    files: ['src/**/*.{ts,tsx}', 'tools/**/*.ts', 'assets-src/**/*.ts'],
    ignores: ['src/ui/**', 'src/debug/**'],
    rules: { 'no-restricted-imports': forbidLayers([]) },
  },
  {
    files: ['src/engine/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': forbidLayers(['world', 'game', 'content', 'save', ...PRESENTATION]) },
  },
  {
    files: ['src/content/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': forbidLayers(['world', 'game', 'save', ...PRESENTATION]) },
  },
  {
    files: ['src/world/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': forbidLayers(['game', 'save', ...PRESENTATION]) },
  },
  {
    files: ['src/game/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': forbidLayers(['save', ...PRESENTATION]) },
  },
  {
    files: ['src/save/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': forbidLayers(PRESENTATION) },
  },
  {
    files: ['src/render/**/*.{ts,tsx}', 'src/audio/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': forbidLayers(['ui']) },
  },
  {
    files: ['src/world/**/*.{ts,tsx}', 'src/game/**/*.{ts,tsx}', 'src/content/**/*.{ts,tsx}', 'src/save/**/*.{ts,tsx}'],
    rules: { 'no-restricted-globals': ['error', ...SIM_FORBIDDEN_GLOBALS] },
  },
  {
    // MASTERPROMPT §2.4 "Keine Magic Numbers in Systemcode": numbers in world/game systems belong in
    // src/content/balance.ts (unit + reason) or in a named module constant. Content data and tests are
    // exempt; tools/forbidden.ts forbids switching this rule off with inline directives.
    files: ['src/game/**/*.{ts,tsx}', 'src/world/**/*.{ts,tsx}'],
    rules: {
      'no-magic-numbers': 'off',
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: MAGIC_NUMBER_ALLOWLIST,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreClassFieldInitialValues: true,
        },
      ],
    },
  },
  {
    files: ['tools/**/*.ts', 'tests/**/*.ts', '*.config.ts', '*.config.js'],
    rules: { 'no-console': 'off' },
  },
);
