import { fileURLToPath } from 'node:url';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  main: {
    build: {
      outDir: `${root}dist/main`,
      externalizeDeps: { exclude: ['@cueweave/core'] },
      rollupOptions: {
        input: {
          index: `${root}src/main/index.ts`,
          service: `${root}src/services/index.ts`,
        },
      },
    },
  },
  preload: {
    build: {
      outDir: `${root}dist/preload`,
      externalizeDeps: false,
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: 'index.cjs', inlineDynamicImports: true },
      },
    },
  },
  renderer: {
    root: `${root}src/renderer`,
    publicDir: `${root}resources/public`,
    plugins: [react()],
    server: { host: '127.0.0.1', port: 5174, strictPort: true },
    build: { outDir: `${root}dist/renderer` },
  },
});
