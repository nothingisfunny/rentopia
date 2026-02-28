import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBase = env.VITE_API_BASE;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: apiBase
        ? {}
        : {
            // Forward API calls to the Vercel local dev server (run `vercel dev --listen 3000`).
            '/api': 'http://localhost:3000'
          }
    }
  };
});
