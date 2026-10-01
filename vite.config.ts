/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    // Windows' native watcher drops rapid back-to-back writes and atomic
    // replaces (temp file + rename), leaving Vite serving stale modules.
    // Polling costs a little CPU but never misses a change.
    watch: process.platform === 'win32' ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      '/api': {
        // API_PORT lets parallel checkouts run their own API server.
        // 127.0.0.1, not localhost: Windows may resolve localhost to ::1 while the
        // API listens on IPv4 loopback only.
        target: `http://127.0.0.1:${process.env.API_PORT || 3001}`,
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'shared/**/*.test.ts'],
    // Component tests opt into jsdom with a `// @vitest-environment jsdom` docblock.
    setupFiles: ['./vitest.setup.ts'],
    // Page render tests (jsdom + large fixtures) can exceed 5 s on a busy machine.
    testTimeout: 15_000,
  },
})
