// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Presentation layers that the headless simulation must never import (MASTERPROMPT §3.2). */
const PRESENTATION = ['render', 'audio', 'ui', 'debug', 'i18n'];
const uiLibs = ['preact', 'preact/*', '@preact/*'];
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
 * Build a no-restricted-imports rule that forbids the given layer folders.
 * @param {string[]} layers
 * @param {string[]} extra
 */
function forbidLayers(layers, extra = []) {
  return [
    'error',
    {
      patterns: [
        {
          group: [...layers.flatMap((l) => [`**/${l}/**`, `**/${l}`]), ...extra],
          message: 'Schichtverletzung (MASTERPROMPT §3.2): diese Schicht darf das Ziel nicht importieren.',
        },
      ],
    },
  ];
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
    files: ['src/engine/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': forbidLayers(['world', 'game', 'content', 'save', ...PRESENTATION], uiLibs) },
  },
  {
    files: ['src/content/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': forbidLayers(['world', 'game', 'save', ...PRESENTATION], uiLibs) },
  },
  {
    files: ['src/world/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': forbidLayers(['game', 'save', ...PRESENTATION], uiLibs) },
  },
  {
    files: ['src/game/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': forbidLayers(['save', ...PRESENTATION], uiLibs) },
  },
  {
    files: ['src/save/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': forbidLayers(PRESENTATION, uiLibs) },
  },
  {
    files: ['src/render/**/*.{ts,tsx}', 'src/audio/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': forbidLayers(['ui'], uiLibs) },
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
