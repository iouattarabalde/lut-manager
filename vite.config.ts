import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Built for https://<user>.github.io/lut-manager/, but served from the root in
// dev so local URLs stay simple.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/lut-manager/' : '/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // Fonts and the app shell are precached so the tool works on set with
      // no network — the previous build pulled fonts from Google at runtime.
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
      },
      manifest: {
        name: 'LUT Manager',
        short_name: 'LUT Manager',
        description: 'Inspect, edit, batch-stamp and convert .cube LUTs in the browser.',
        theme_color: '#f2f0eb',
        background_color: '#f2f0eb',
        display: 'standalone',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
}));
