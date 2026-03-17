import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/chat/',
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
});
