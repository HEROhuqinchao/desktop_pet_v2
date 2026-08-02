import { fileURLToPath } from 'node:url';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.join(projectRoot, 'src', 'renderer');

export default defineConfig({
  root: rendererRoot,
  base: './',
  plugins: [react()],
  publicDir: path.join(rendererRoot, 'public'),
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.join(projectRoot, 'dist', 'renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        pet: path.join(rendererRoot, 'pet', 'index.html'),
        settings: path.join(rendererRoot, 'settings', 'index.html'),
        game: path.join(rendererRoot, 'game', 'index.html'),
        panel: path.join(rendererRoot, 'panel', 'index.html'),
        bubble: path.join(rendererRoot, 'bubble', 'index.html'),
      },
    },
  },
});
