import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const parsePort = (value?: string) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num <= 0 || num > 65535) return null;
  return Math.floor(num);
};

const consensusPort = parsePort(process.env.CONSENSUS_PORT) ?? 8787;

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname),
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: `ws://localhost:${consensusPort}`,
        ws: true,
      },
      '/api': `http://localhost:${consensusPort}`,
    },
  },
});
