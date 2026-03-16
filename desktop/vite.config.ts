import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react()],
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
