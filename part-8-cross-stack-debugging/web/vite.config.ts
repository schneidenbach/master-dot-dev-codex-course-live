import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.API_PORT ?? 3108);
const webPort = Number(process.env.WEB_PORT ?? 5108);

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': `http://localhost:${apiPort}`,
      '/socket.io': { target: `http://localhost:${apiPort}`, ws: true },
    },
  },
});
