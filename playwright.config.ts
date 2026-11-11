import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './web/tests',
  testIgnore:['player-ownership.spec.ts','hosted-ownership.spec.ts','privy-access.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  outputDir: '.local/playwright-results',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    channel: 'chrome',
    viewport: { width: 1440, height: 1100 },
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'GAME_API_PORT=3101 cargo run -p alchemy-sandbox --bin game-api --locked',
      url: 'http://127.0.0.1:3101/api/state',
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
    {
      command: `VITE_PUBLIC_LOCAL_SANDBOX=true VITE_PUBLIC_SUPABASE_URL=https://example.supabase.co VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_browser_test GAME_API_PORT=3101 npm run dev -- --port 5174`,
      url: 'http://127.0.0.1:5174',
      timeout: 30_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
  ],
});
