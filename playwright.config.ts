import { defineConfig, devices } from '@playwright/test'

// End-to-end suite (npm run e2e). Runs its own API + Vite on spare ports against
// a throwaway seeded DB (see e2e/start-api.mjs); never uses data/gold.db.
const API_PORT = process.env.E2E_API_PORT || '3901'
const WEB_PORT = process.env.E2E_WEB_PORT || '5901'

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: [
    {
      command: 'node e2e/start-api.mjs',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: { E2E_API_PORT: API_PORT },
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: { API_PORT },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
})
