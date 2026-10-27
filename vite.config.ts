import {defineConfig} from 'vite';

// Relative asset paths: the same build works at a domain root and under a subpath such as GitHub Pages.
export default defineConfig({
  base: './',
  // Three.js is one ~680 kB chunk that loads after the page shell, so the default 500 kB warning is noise here.
  build: {target: 'es2022', chunkSizeWarningLimit: 800},
});
