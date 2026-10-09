import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/pdfjs-dist/cmaps/*', dest: 'cmaps' },
        { src: 'node_modules/pdfjs-dist/standard_fonts/*', dest: 'standard_fonts' },
      ],
    }),
  ],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  define: {
    global: 'window',
  },
  optimizeDeps: {
    include: ['epubjs', 'jszip'],
  },
});
