import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The game server reads the same variable. Hardcoding 8787 here meant setting
// GAME_PORT to dodge a launcher collision silently broke the dev client.
const GAME_PORT = Number(process.env.GAME_PORT ?? 8787);

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on the LAN so phones can reach it
    proxy: {
      // One origin for both HTTP and WebSocket keeps LAN + tunnel testing simple.
      '/ws': { target: `ws://localhost:${GAME_PORT}`, ws: true },
    },
  },
});
