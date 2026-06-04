import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer/overlay',
  base: './',
  resolve: {
    alias: {
      '../../shared': path.resolve(__dirname, 'src/shared'),
      '../../../shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer/overlay'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/renderer/overlay/index.html'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
