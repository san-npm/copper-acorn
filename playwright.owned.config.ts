import {defineConfig} from '@playwright/test';
const flags='PLAYER_OWNERSHIP=true LOCAL_REFEREE_TOKEN=local-preview-referee-no-real-assets GAME_API_PORT=3901';
export default defineConfig({
  testDir:'./web/tests',testMatch:'player-ownership.spec.ts',workers:1,timeout:180_000,
  expect:{timeout:25_000},outputDir:'.local/owned-results',
  use:{actionTimeout:15_000,baseURL:'http://127.0.0.1:5180',channel:'chrome',headless:true,reducedMotion:'reduce',viewport:{width:1440,height:1100},trace:'retain-on-failure'},
  webServer:[
    {command:`${flags} cargo run -p alchemy-sandbox --bin game-api --locked`,url:'http://127.0.0.1:3901/api/health',timeout:120_000,gracefulShutdown:{signal:'SIGTERM',timeout:10_000}},
    {command:`${flags} VITE_PUBLIC_LOCAL_SANDBOX=true VITE_PUBLIC_SUPABASE_URL= VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY= npm run dev -- --port 5180`,url:'http://127.0.0.1:5180',timeout:30_000,gracefulShutdown:{signal:'SIGTERM',timeout:5_000}},
  ],
});
