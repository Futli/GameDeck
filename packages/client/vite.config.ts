import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // @gamedeck/shared берём из исходников: правки в shared видны без пересборки.
  resolve: { conditions: ['source'] },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Клиент и сервер в разработке на разных портах. Прокси делает так, будто они на одном:
    // браузер ходит на 5173, а Vite пересылает /api и /socket.io на сервер 3000.
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
