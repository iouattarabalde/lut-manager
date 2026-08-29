import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Built for https://<user>.github.io/lut-header-editor/, but served from the
// root in dev so local URLs stay simple.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/lut-header-editor/' : '/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // Fonts and the app shell are precached so the tool works on set with
      // no network — the previous build pulled fonts from Google at runtime.
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
      },
      manifest: {
        name: 'LUT Header Editor',
        short_name: 'LUT Editor',
        description: 'Edit .cube LUT metadata headers without touching the LUT data.',
        theme_color: '#f2f0eb',
        background_color: '#f2f0eb',
        display: 'standalone',
        icons: [],
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
}));
