import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Optional throwaway test key for the P0.4 spike. Lives in git-ignored key.txt.
const keyFile = resolve(__dirname, 'key.txt');
const geminiKey = existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '';

export default defineConfig({
  define: {
    __GEMINI_API_KEY__: JSON.stringify(geminiKey),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        options: resolve(__dirname, 'options.html'),
        'background/service-worker': resolve(
          __dirname,
          'src/background/service-worker.ts',
        ),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
