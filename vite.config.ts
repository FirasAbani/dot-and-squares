import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Lets the Quit button in the UI stop this process.
 *
 * A page cannot kill the server it is talking to, so the app POSTs to
 * `/__shutdown` and this middleware exits Vite. Nothing listens on 5173 again
 * until someone runs `npm run dev` — which is the "stays off until the players
 * ask for it back" half of the Quit button.
 *
 * Dev and preview only: neither hook runs for `vite build`, so the route can
 * never end up in a production bundle.
 */
function shutdownEndpoint(): Plugin {
  const handle = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    // Only POST stops the server, so a stray GET (a prefetch, someone poking
    // the URL) can't take the game down.
    if (req.method !== 'POST') {
      next();
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));

    // Let the response flush before the process disappears, or the browser
    // sees a dropped socket instead of a clean confirmation.
    setTimeout(() => process.exit(0), 100);
  };

  return {
    name: 'dots-and-squares:shutdown-endpoint',
    configureServer(server) {
      server.middlewares.use('/__shutdown', handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/__shutdown', handle);
    },
  };
}

export default defineConfig({
  plugins: [react(), shutdownEndpoint()],
  server: {
    // Keeps Vite's HMR while talking to a real Durable Object: run
    // `npm run dev:worker` alongside `npm run dev`. `ws: true` is required or
    // the WebSocket upgrade never reaches the worker.
    proxy: {
      // WORKER_PORT lets the worker move when 8787 is taken by another project;
      // set the same value on `wrangler dev --port`.
      '/api': {
        target: `http://127.0.0.1:${process.env.WORKER_PORT ?? 8787}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  // The client needs jsdom; the worker's room logic is pure and runs in node.
  // They cannot share one environment, so they are separate projects.
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'client',
          globals: true,
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['./src/test-setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'worker',
          globals: true,
          environment: 'node',
          include: ['worker/**/*.test.ts'],
        },
      },
    ],
  },
});
