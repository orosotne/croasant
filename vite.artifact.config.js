// Build used by scripts/build-artifact.mjs: relative asset paths, no public/
// copy (frames ship as packs), one CSS file, and Lenis taken from the global
// that the page's CDN script defines instead of being bundled.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  publicDir: false,
  resolve: {
    alias: [{ find: /^lenis$/, replacement: fileURLToPath(new URL('./src/lib/lenis-global.js', import.meta.url)) }],
  },
  build: {
    outDir: 'media/tmp/artifact-dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
  },
});
