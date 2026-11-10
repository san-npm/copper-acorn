import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./web/tests',testMatch:'hosted-ownership.spec.ts',workers:1,timeout:90_000,expect:{timeout:20_000},outputDir:'.local/hosted-owned-results',use:{baseURL:'http://127.0.0.1:5182',channel:'chrome',headless:true,viewport:{width:1440,height:1100},reducedMotion:'reduce',trace:'retain-on-failure'},webServer:[
  {command:'GAME_API_PORT=3911 cargo run -p alchemy-sandbox --bin game-api --locked',url:'http://127.0.0.1:3911/api/state',timeout:120_000,gracefulShutdown:{signal:'SIGTERM',timeout:10_000}},
  {command:'VITE_PUBLIC_PLAYER_OWNERSHIP=true VITE_PUBLIC_LOCAL_SANDBOX=false VITE_PUBLIC_LOCAL_ART=true VITE_PUBLIC_SUPABASE_URL=https://example.supabase.co VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_browser_test GAME_API_PORT=3911 npm run dev -- --port 5182',url:'http://127.0.0.1:5182',timeout:30_000,gracefulShutdown:{signal:'SIGTERM',timeout:5_000}},
]});
