import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  base: './',
  define: { __DH_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['generated/icon.svg'],
      manifest: {
        name: 'DUSKHEARTH',
        short_name: 'Duskhearth',
        description: 'Entzünde die sechs Feuer – 2D-Survival im Browser.',
        lang: 'de',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#14101c',
        theme_color: '#14101c',
        icons: [
          { src: 'generated/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'generated/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'generated/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json,wasm}'],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 4096,
  },
  server: { port: 5173, strictPort: false },
  preview: { port: 4173, strictPort: true },
});
