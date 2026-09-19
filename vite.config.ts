import { defineConfig } from 'vitest/config';

// The bridge (bridge/bridge.py) owns controller I/O on :8777. In dev, Vite proxies to it.
const BRIDGE = 'http://127.0.0.1:8777';

export default defineConfig({
  server: {
    port: 5173,
    proxy: { '/stream': BRIDGE, '/state': BRIDGE, '/quit': BRIDGE },
  },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 800 }, // three.js is most of the bundle
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
