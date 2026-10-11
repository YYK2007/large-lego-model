import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: { '/api': {
    target: 'http://127.0.0.1:3001',
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyRes', (upstream, _request, response) => {
        // An API restart must close a stream that has already sent its headers.
        upstream.once('aborted', () => response.destroy());
        upstream.once('error', () => response.destroy());
      });
    },
  } } },
});
