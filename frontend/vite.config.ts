import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    // Here is our box of pretend office supplies!
    nodePolyfills({
      include: ['http', 'https', 'buffer', 'crypto', 'stream', 'util'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  resolve: {
    alias: {
      // This is the specific pretend stapler it was crying about
      https: 'agent-base',
    },
  },
  // ==========================================
  // NEW: The Bridge to your Relayer Backend!
  // ==========================================
  server: {
    proxy: {
      // Any request starting with /api...
      '/api': {
        // ...gets securely forwarded to your Express backend
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});