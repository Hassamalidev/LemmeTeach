import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' keeps the build working at any path — a GitHub Pages subpath,
// a CDN folder, or file://. Never introduce an absolute base (§24).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Only the two libraries that are genuinely needed on first paint get
        // a stable chunk. Shiki is deliberately absent: highlight.ts imports
        // it dynamically, and naming it here would drag it back into the
        // initial load for a learner who may never see a code block.
        manualChunks: {
          katex: ['katex'],
          mathjs: ['mathjs'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'shared/**/*.test.ts', 'api/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
} as never);
