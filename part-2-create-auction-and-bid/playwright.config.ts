import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:5102',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'edge',
      use: { channel: 'msedge' },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5102/api/health',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
