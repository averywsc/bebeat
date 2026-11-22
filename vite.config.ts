import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

function bebeatRoutingPlugin(): Plugin {
  return {
    name: 'bebeat-routing',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        if ((url.pathname === '/' || url.pathname === '/index.html') && req.method === 'GET') {
          req.url = '/app.html';
          return next();
        }
        if ((url.pathname === '/download' || url.pathname === '/download/') && req.method === 'GET') {
          const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(html);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), bebeatRoutingPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: path.resolve(__dirname, 'app.html'),
    },
  },
});
