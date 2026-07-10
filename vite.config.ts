import { defineConfig } from 'vite';

export default defineConfig({
  base: '/Kingdom-Eclipse/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
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
