import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const workspaceRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@openclaw/pair-sdk': path.resolve(workspaceRoot, 'packages/pair-sdk/src/index.ts'),
      '@openclaw/message-sdk': path.resolve(workspaceRoot, 'packages/message-sdk/src/index.ts')
    }
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true
  },
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: process.env.TAURI_DEBUG ? false : 'esbuild'
  }
});
