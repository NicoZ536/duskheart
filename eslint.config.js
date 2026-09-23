// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Presentation layers that the headless simulation must never import (MASTERPROMPT §3.2). */
const PRESENTATION = ['render', 'audio', 'ui', 'debug', 'i18n'];
const uiLibs = ['preact', 'preact/*', '@preact/*'];

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
  { ignores: ['dist/**', 'dev-dist/**', 'node_modules/**', 'src/generated/**', 'public/**', 'tools/out/**', 'shots/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
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
    files: ['tools/**/*.ts', 'tests/**/*.ts', '*.config.ts', '*.config.js'],
    rules: { 'no-console': 'off' },
  },
);
