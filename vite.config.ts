import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/Kingdom-Eclipse/',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    minify: 'esbuild',
    target: 'es2020',
  },
  server: {
    port: 3000,
    host: true,
  },
  preview: {
    port: 3000,
  },
});
