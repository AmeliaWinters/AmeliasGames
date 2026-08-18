import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on the LAN so phones can reach it
    proxy: {
      // One origin for both HTTP and WebSocket keeps LAN + tunnel testing simple.
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
